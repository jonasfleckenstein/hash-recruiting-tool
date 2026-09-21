import type { Criterion, RoleBrief, SkillMatch } from "./types";

export const CRUSTDATA_ENDPOINT = "https://api.crustdata.com/person/search";
export const CRUSTDATA_API_VERSION = "2025-11-01";

/**
 * Operator semantics, from the Person Search reference. These are easy to get
 * wrong because the tutorial pages describe `(.)` as a regex. It is not.
 *
 *   (.)  all-words match, case-insensitive. Every word in the value must
 *        appear somewhere in the field, in any order, with no typo tolerance
 *        and no partial words. A "|" in the value is NOT an or: the value is
 *        split into words that must ALL match. So never build a regex here.
 *        (.) "Software Engineer" matches "Senior Software Engineer" and
 *        "Engineer, Software". It does not match "Software Eng".
 *
 *   [.]  exact-phrase match. The words must be contiguous and in order.
 *        [.] "Software Engineer" matches "Senior Software Engineer" but not
 *        "Engineer, Software".
 *
 *   (!)  fuzzy negation, excludes substring matches.
 *
 *   =, in, not_in  match the WHOLE stored value, never part of it. A title
 *        list under `in` is an exact-string test and misses almost everyone.
 *
 * The way to express "or" is an `or` group of conditions, one value each.
 */
export const TEXT_OP_ALL_WORDS = "(.)";
export const TEXT_OP_PHRASE = "[.]";

/**
 * How many profiles one search buys.
 *
 * Every result costs 0.03 credits and, more to the point, every result
 * fetched is a profile the scoring model will later read. Keeping this
 * small while the scoring prompt is still moving is the difference between
 * iterating for free and re-buying the pool every time.
 */
export const DEFAULT_FETCH_LIMIT = 25;

/**
 * Fields a criterion may filter on directly.
 *
 * Deliberately short. Technologies go through the skills path and job
 * histories through the backgrounds path, so this is only what neither
 * covers. `basic_profile.headline` is excluded on purpose: under all-words
 * matching it is far too loose to filter on.
 */
export const FIELD_CATALOG: Record<
  string,
  { op: string; numeric?: boolean; note: string }
> = {
  "experience.employment_details.company_name": {
    op: TEXT_OP_ALL_WORDS,
    note: "any employer, current or past, e.g. a specific company or lab",
  },
  "experience.employment_details.current.company_headcount_latest": {
    op: "=<",
    numeric: true,
    note: "headcount of their current employer, for 'has worked somewhere small'",
  },
  "education.schools.school": {
    op: TEXT_OP_ALL_WORDS,
    note: "a school or university name",
  },
  "education.schools.degree": {
    op: TEXT_OP_ALL_WORDS,
    note: "a degree, e.g. PhD, Master",
  },
};

/** Rough UTC offset span of each continent, used to turn a timezone overlap
 *  window into something the API can actually filter on. */
const CONTINENT_BANDS: Record<string, [number, number]> = {
  Europe: [-1, 4],
  Africa: [-1, 4],
  Asia: [2, 12],
  "North America": [-10, -3],
  "South America": [-6, -2],
  Oceania: [8, 14],
};

export const ALL_CONTINENTS = Object.keys(CONTINENT_BANDS);

export function continentsForWindow(min: number, max: number): string[] {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Object.entries(CONTINENT_BANDS)
    .filter(([, [bandLo, bandHi]]) => bandLo <= hi && bandHi >= lo)
    .map(([name]) => name);
}

export type Condition =
  | { field: string; type: string; value: unknown }
  | { op: "and" | "or"; conditions: Condition[] };

export interface CrustdataQuery {
  filters: Condition;
  fields: string[];
  limit: number;
  sorts: { field: string; order: "asc" | "desc" }[];
  /** Ask the API which condition emptied the result, when nothing matches. */
  explain: boolean;
}

/**
 * Fields to return.
 *
 * Price is per result, not per field, so there is no reason to ask for
 * less than the response can carry.
 *
 * `metadata` brings `updated_at`, which says how stale the rest is: a
 * profile refreshed ten months ago may show a current role the person has
 * already left. `contact` is a single availability flag for a verified
 * business email, worth having before step 5 spends anything on contact
 * enrichment, but it is entitlement-gated and a denial rejects the whole
 * request, so the search retries without it.
 *
 * `skills` and `dev_platform_profiles` are deliberately absent: both are
 * filterable but never returned by search, and naming some filter-only
 * paths in `fields` is a 400. Read those with Person Enrich.
 */
const RETURN_FIELDS = [
  "crustdata_person_id",
  "basic_profile",
  "social_handles",
  "experience",
  "education",
  "metadata",
  "contact",
];

const CURRENT_TITLE = "experience.employment_details.current.title";

/**
 * Turn an indexed location value into a geocoder input.
 *
 * These are two different contracts. Autocomplete returns the index's own
 * value, which can carry a middle region segment ("Paris, Ile-de-France,
 * France"). The `location` key inside geo_distance is a geocoder input, and
 * every documented example is city level: "London", "San Francisco, CA".
 *
 * Keeping the first and last segments gives the documented city-plus-country
 * shape and drops a middle part the geocoder has no documented handling for.
 * A geocoder miss would not raise an error, it would silently centre the
 * radius somewhere wrong, which is the worst kind of failure here.
 */
export function geocoderLocation(value: string): string {
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 2) return parts.join(", ");
  return `${parts[0]}, ${parts[parts.length - 1]}`;
}

/** One condition, or an `or` group, or nothing. */
function anyOf(conditions: Condition[]): Condition | null {
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "or", conditions };
}

/** One condition, or an `and` group, or nothing. */
function allOf(conditions: Condition[]): Condition | null {
  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { op: "and", conditions };
}

/** Words the index would see, lower-cased. Punctuation and hyphens split. */
function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

function isStrictSuperset(a: Set<string>, b: Set<string>): boolean {
  if (a.size <= b.size) return false;
  for (const token of b) if (!a.has(token)) return false;
  return true;
}

function isSubsetOf(a: Set<string>, b: Set<string>): boolean {
  if (a.size > b.size) return false;
  for (const token of a) if (!b.has(token)) return false;
  return true;
}

/**
 * Drop titles that cannot match anyone a shorter title does not already match.
 *
 * Under all-words matching a longer title is a narrower leaf, never a wider
 * one: "Full Stack Software Engineer" matches a subset of "Full Stack
 * Engineer", so OR-ing it in changes nothing. Titles with the SAME word set
 * are both kept, because "Full-Stack" and "Full Stack" only tokenize
 * identically if the index splits on hyphens, and an extra leaf is cheap
 * insurance against it not doing so.
 *
 * This is why the tool always matches titles by words and never offers an
 * exact-phrase mode: under phrase matching a longer title is a different
 * phrase rather than a narrower one, so none of this pruning would hold, and
 * a phrase search loses people silently. Over-matching is visible and
 * filterable; under-matching is not.
 */
function pruneSubsumed(titles: string[]): string[] {
  const entries = titles
    .map((label) => ({ label, tokens: tokenSet(label) }))
    .sort((a, b) => a.tokens.size - b.tokens.size);

  const kept: { label: string; tokens: Set<string> }[] = [];
  for (const entry of entries) {
    if (kept.some((k) => isStrictSuperset(entry.tokens, k.tokens))) continue;
    kept.push(entry);
  }
  return kept.map((k) => k.label);
}

/**
 * The titles that actually end up in the query, after deduplication and
 * after dropping the ones already covered by a shorter title. Exported so
 * the UI can mark a selected title that changes nothing.
 */
export function effectiveTitles(brief: RoleBrief): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const raw of [
    brief.title,
    ...brief.titleVariants.filter((v) => v.selected).map((v) => v.label),
  ]) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }

  return pruneSubsumed(unique);
}

/**
 * Titles become an `or` group of leaves, one title per leaf.
 *
 * Each leaf is an all-words match, so "Full-Stack Engineer" also finds
 * "Senior Full Stack Engineer" and "Engineer, Full Stack". The alternatives
 * are separate leaves because the API has no or-within-a-value.
 */
function titleConditions(brief: RoleBrief): Condition | null {
  return anyOf(
    effectiveTitles(brief).map((value) => ({
      field: CURRENT_TITLE,
      type: TEXT_OP_ALL_WORDS,
      value,
    }))
  );
}

const SKILLS_FIELD = "skills.professional_network_skills";
const GITHUB_LANGUAGES = "dev_platform_profiles.all_languages";
const GITHUB_TOPICS = "dev_platform_profiles.all_topics";
const ANY_TITLE = "experience.employment_details.title";

/** GitHub topics are lower case and hyphenated: "machine-learning". */
function topicSlug(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Whether a label is plausibly a single technology name.
 *
 * GitHub languages and topics are single tokens or hyphenated words. A label
 * carrying a slash or other punctuation is a phrase lifted from a job ad
 * ("AI/ML systems"), and the two GitHub leaves built from it would match
 * nobody while cluttering the query.
 */
function looksLikeTechnologyName(label: string): boolean {
  return label.length <= 30 && /^[a-z0-9+#.\-\s]+$/i.test(label);
}

/**
 * Leaves for one technology.
 *
 * Three fields, because the same skill shows up in three places and a leaf
 * that does not apply matches nobody and costs nothing inside an OR:
 *
 *   skills  - matched with `in` over every indexed spelling, since casing
 *             and punctuation variants are distinct values and Crustdata's
 *             guidance is to expand them into one `in` rather than guess
 *   languages - the GitHub language rollup. A skill on a profile is a claim;
 *             the same language across someone's repositories is evidence,
 *             and it reaches people who never listed it
 *   topics  - repository topic tags, which catch the tools and domains that
 *             are not languages
 *
 * Deliberately not searched: headline, summary and role descriptions. Under
 * all-words matching a short skill name would be a disaster there, since
 * "Go", "R" and "C" are ordinary words. Those fields are for the scoring
 * model to read, not for filtering.
 */
function skillLeaves(skill: SkillMatch): Condition[] {
  const leaves: Condition[] = [];
  const label = skill.label.trim();

  if (skill.indexed.length > 0) {
    leaves.push({ field: SKILLS_FIELD, type: "in", value: skill.indexed });
  }
  if (label && looksLikeTechnologyName(label)) {
    leaves.push({ field: GITHUB_LANGUAGES, type: "=", value: label });
    leaves.push({ field: GITHUB_TOPICS, type: "=", value: topicSlug(label) });
  }

  return leaves;
}

/**
 * Backgrounds the title search already guarantees, removed.
 *
 * A background matches any role the person has held; the title gate
 * matches their current title. So when a background's words are a subset
 * of a searched title's words, everyone who passed the title gate
 * satisfies the background too.
 *
 * That matters more than it sounds. The must-have gate is an `or`, and a
 * condition that is always true inside an `or` makes every other
 * must-have irrelevant. A real case: searching current title for
 * "Technical Lead" and then asking for a "Technical Lead" background
 * matched 1,567 of a 2,030 pool, which quietly cancelled the TypeScript,
 * Rust and distributed-systems must-haves sitting beside it.
 *
 * Nobody is lost by dropping these: anyone the alternative would have
 * matched is already in the pool through the title.
 */
export function effectiveBackgrounds(
  brief: RoleBrief,
  backgrounds: string[]
): string[] {
  const titleTokens = effectiveTitles(brief).map(tokenSet);
  return backgrounds.filter((background) => {
    const bt = tokenSet(background);
    if (bt.size === 0) return false;
    return !titleTokens.some((tt) => isSubsetOf(bt, tt));
  });
}

/**
 * A background is evidenced by job history, so it matches every role the
 * person has held rather than only the current one. "Prior data engineering
 * experience" is about a job they used to have.
 */
function backgroundLeaf(title: string): Condition {
  return { field: ANY_TITLE, type: TEXT_OP_ALL_WORDS, value: title.trim() };
}

/**
 * Turn one criterion into a condition.
 *
 * Everything the criterion carries is OR-ed: several technologies, several
 * backgrounds, or a field condition. That is what makes a requirement with
 * alternatives one criterion rather than several.
 *
 * "|" in a field match means alternatives too, and is expanded here rather
 * than passed through: a piped value sent to the API would be read as words
 * that must all match.
 */
function criterionCondition(criterion: Criterion, brief: RoleBrief): Condition | null {
  const leaves: Condition[] = [];

  for (const skill of criterion.skills ?? []) {
    leaves.push(...skillLeaves(skill));
  }

  for (const background of effectiveBackgrounds(brief, criterion.backgrounds ?? [])) {
    leaves.push(backgroundLeaf(background));
  }

  if (criterion.field && criterion.match) {
    const spec = FIELD_CATALOG[criterion.field];
    if (spec) {
      if (spec.numeric) {
        const value = Number(criterion.match);
        if (!Number.isNaN(value)) {
          leaves.push({ field: criterion.field, type: spec.op, value });
        }
      } else {
        for (const value of criterion.match.split("|").map((v) => v.trim())) {
          if (value) leaves.push({ field: criterion.field, type: spec.op, value });
        }
      }
    }
  }

  return anyOf(leaves);
}

/**
 * Words used to test whether a role description exists at all.
 *
 * There is no clean presence test for this field. `is_null` and
 * `is_not_null` are documented as element-based and treat a stored empty
 * string as a value, and `!= ""` is a negated term match that also
 * matches an absent field. Both return every profile in a pool, which is
 * demonstrably wrong: on a live 164-profile pool the enrichment showed 17
 * of 20 with a description, not 20 of 20.
 *
 * A positive word match does work, and was validated against four people
 * whose enrichment had already been read: it returned the two with
 * descriptions and neither of the two without, on both the current-role
 * and any-role paths. One word is not enough though, since a terse
 * description can miss it, so this is OR-ed. Even so the result is a
 * lower bound, never exact: ten words reached 143 of 164 where "and"
 * alone reached 139.
 *
 * An exact-phrase match on a single space looked like the clean
 * one-condition answer and is not: `[.] " "` returns zero on every scope,
 * because the analyser tokenises and a lone space is not a term.
 */
export const DESCRIPTION_PROBE_WORDS = [
  "and", "the", "of", "to", "in", "for", "with", "a", "on", "as",
];

/** Where a description has to be. Measured on one 164-profile pool:
 *  current 55, past 142, either 143. Descriptions live on past roles,
 *  because people write a job up after they leave it. */
const DESCRIPTION_FIELD = {
  current: "experience.employment_details.current.description",
  past: "experience.employment_details.past.description",
} as const;

/** Any description on a role in the given scope. */
function hasDescription(scope: keyof typeof DESCRIPTION_FIELD): Condition | null {
  return anyOf(
    DESCRIPTION_PROBE_WORDS.map((word) => ({
      field: DESCRIPTION_FIELD[scope],
      type: TEXT_OP_ALL_WORDS,
      value: word,
    }))
  );
}

/** At least one public repository, not merely an account. The stricter
 *  test costs nothing and drops the eight people in one live pool who had
 *  an empty GitHub account, which is no use to anyone reading a card. */
const GITHUB_HAS_REPOS = {
  field: "dev_platform_profiles.public_repo_count",
  type: "=>",
  value: 1,
};

/**
 * Conditions for the evidence the operator has asked to require.
 *
 * Adding these costs nothing and saves money: price is per result
 * returned, so a narrower query is a cheaper one. What it costs instead
 * is reach, and irreversibly, because a profile the query never returns
 * leaves no card and no trace beyond the count.
 */
function evidenceConditions(brief: RoleBrief): Condition[] {
  const out: Condition[] = [];
  const want = brief.evidence;
  if (!want) return out;

  if (want.github) out.push(GITHUB_HAS_REPOS);

  // Two separate conditions, so ticking both means a description on the
  // current role AND on a past one. That is a real requirement but a rare
  // one; the common intent is the broader past-role box on its own.
  if (want.currentDescription) {
    const c = hasDescription("current");
    if (c) out.push(c);
  }
  if (want.pastDescription) {
    const c = hasDescription("past");
    if (c) out.push(c);
  }

  return out;
}

/**
 * Build the Crustdata request from a brief.
 *
 *   AND [ or(titles), location, experience range, gate(must-haves) ]
 *
 * The gate combines the filterable must-haves with either `or` or `and`,
 * depending on the brief. `or` is the default: one hit is enough to surface
 * someone, and which of the others they missed is counted at scoring time
 * rather than silently removing them. `and` gives a much smaller, exact
 * pool and drops anyone who simply never listed one of the requirements.
 */
export function buildCrustdataQuery(brief: RoleBrief, limit = 25): CrustdataQuery {
  const and: Condition[] = [];

  const titles = titleConditions(brief);
  if (titles) and.push(titles);

  if (brief.locationMode === "onsite" && brief.city.trim()) {
    // A radius absorbs every way people write the area ("Greater London",
    // "London Area"), which a text filter would not. The city string carries
    // its country so the server-side geocoder cannot pick the wrong one.
    and.push({
      field: "professional_network.location.raw",
      type: "geo_distance",
      value: {
        location: geocoderLocation(brief.city),
        distance: brief.radius,
        unit: brief.radiusUnit,
      },
    });
  } else if (brief.locationMode === "remote" && brief.regions.length > 0) {
    const regions = anyOf(
      brief.regions.map((r) => ({
        field: "basic_profile.location.continent",
        type: "=",
        value: r,
      }))
    );
    if (regions) and.push(regions);
  }

  /**
   * Experience is deliberately NOT filtered.
   *
   * `years_of_experience_raw` is undocumented, is never returned by search
   * so it cannot be audited, and four plausible reconstructions of it each
   * placed under 62% of a pool inside the window that pool had been
   * filtered on. A live test was worse than that sounds: a 5-to-10-year
   * bound cut a pool from 164 to 63 and removed all five of the top-ranked
   * candidates, including one whose engineering experience sat inside the
   * band but whose earlier career pushed the vendor's number over it.
   *
   * Seniority now travels in `brief.experienceBand` and is scored against
   * years derived from the returned employment history, where a
   * miscalculation costs points instead of silently deleting people.
   */

  // Employment type is intentionally not a filter yet. Crustdata does expose
  // experience.employment_details.current.employment_type, but its accepted
  // values are not documented and it is not autocomplete-enabled, so guessing
  // one would silently return nobody. It travels in the brief and is used for
  // scoring and the outreach draft until a live call confirms the vocabulary.

  for (const condition of evidenceConditions(brief)) and.push(condition);

  const gates = brief.criteria
    .filter((c) => c.selected && c.kind === "must" && c.check === "filter")
    .map((c) => criterionCondition(c, brief))
    .filter((c): c is Condition => c !== null);

  const gate = brief.gateMode === "all" ? allOf(gates) : anyOf(gates);
  if (gate) and.push(gate);

  return {
    filters: and.length === 1 ? and[0] : { op: "and", conditions: and },
    fields: RETURN_FIELDS,
    limit,
    /**
     * Most trustworthy profiles first.
     *
     * Crustdata has no relevance ranking on a filter search, so without a
     * sort the first page is whichever rows the index happens to hand back.
     * `assessment.authenticity.tier` runs 0 (most trusted) to 9 and is the
     * only sortable field that says anything about whether a profile is
     * real. Sorting is also what makes cursor pagination stable.
     */
    sorts: [{ field: "assessment.authenticity.tier", order: "asc" }],
    explain: true,
  };
}

/**
 * The must-haves that are contributing a leaf to the gate. Exported so the
 * count endpoint can measure each one on its own: a criterion that reaches
 * nobody is invisible inside an `or`, and `explain` will not open a nested
 * group to tell you which one it was.
 */
export function gatingCriteria(brief: RoleBrief): Criterion[] {
  return brief.criteria.filter(
    (c) => c.selected && c.kind === "must" && c.check === "filter"
  );
}

/** Criteria that cannot be filtered and therefore have to be read off the
 *  profile by the scoring model in step 3. */
export function judgedCriteria(brief: RoleBrief) {
  return brief.criteria.filter((c) => c.selected && c.check === "judge");
}
