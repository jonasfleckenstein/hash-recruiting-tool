import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CACHE_ENABLED, MissingApiKeyError, SONNET, askForJson } from "./anthropic";
import { FIELD_CATALOG } from "./crustdata";
import { SKILL_KINDS, classifySkillLabel, isSkillKind, verifySkill } from "./skills";
import type {
  Criterion,
  CriterionKind,
  CriterionSource,
  EmploymentType,
  RoleSetupHints,
  SkillMatch,
  SuggestResult,
  TitleVariant,
} from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "suggestions");

const MAX_SYNONYMS = 8;
const MAX_ADJACENT = 6;
const MAX_CRITERIA_PER_KIND = 6;
const MAX_ALTERNATIVES = 8;

/**
 * Bump this whenever the prompt or the shape of SuggestResult changes.
 * Cached entries written by an older version then simply miss and get
 * regenerated, instead of feeding a stale shape back into the UI.
 */
const CACHE_VERSION = "v8";

function cacheKey(title: string, jd: string): string {
  const normalized = `${CACHE_VERSION}|${title.trim().toLowerCase()}|${jd.trim()}`;
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

async function readCache(key: string): Promise<SuggestResult | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    return { ...(JSON.parse(raw) as SuggestResult), cached: true };
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: SuggestResult): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify(value, null, 2),
      "utf8"
    );
  } catch {
    // A failed cache write is not worth failing the request over.
  }
}

function fieldCatalogForPrompt(): string {
  return Object.entries(FIELD_CATALOG)
    .map(([field, spec]) => `      ${field} -> ${spec.note}`)
    .join("\n");
}

function skillKindsForPrompt(): string {
  return Object.entries(SKILL_KINDS)
    .map(([kind, note]) => `  ${kind} - ${note}`)
    .join("\n");
}

const SYSTEM_PROMPT = `You help a recruiter set up a candidate search. You are given a job title, or a job ad, or both. You return everything needed to build the search.

TITLE
Set "normalized_title" to the title of the role being hired for. If a title was given, keep it, correcting only obvious formatting. If only an ad was given, read the title out of the ad.

TITLE VARIANTS
Return two separate lists, and never put the same title in both.

"synonyms" are titles that mean the same job. Someone holding one could hold the input title tomorrow with no change in what they actually do. These are searched automatically without anyone reviewing them, so include only titles you would be comfortable committing to.

Titles are matched by their words: every word of a variant must appear in the candidate's title, in any order. A longer variant is therefore NARROWER, not wider, and adds nothing. If "Full Stack Engineer" is on the list, do not also list "Full Stack Software Engineer" or "Full Stack Web Engineer" — both are already matched. List a variant only when it reaches someone the others cannot:
  - a different word for the same role (Developer, Engineer, Programmer)
  - a spelling that joins or splits the words (Fullstack, Full-Stack), because a joined word is a single token and is unreachable from the split form
  - a genuinely different name for the same job

Keep the seniority of the input title exactly: a seniority change is not a synonym. At most ${MAX_SYNONYMS}.

"adjacent_titles" overlap the role without being the same job: broader titles that cover this role among others, one-sided specialisms, or the same work at a different seniority or scope. These are shown switched off and only searched if the recruiter turns one on, so include the ones genuinely worth a deliberate decision. Give each a "note" of at most eight words saying how it differs. At most ${MAX_ADJACENT}.

ROLE SETUP
Read these from the ad when it states them. Return null for anything it does not state. Never infer or guess: these fill in form fields, and a wrong guess is worse than an empty box.
  "city"            - where the role is based, as "City, Country". Null for a remote role with no base.
  "remote"          - true if the role is remote, false if it is on-site or hybrid, null if unstated.
  "employment_type" - one of full_time, part_time, contract, internship.
  "min_years"       - minimum years of experience as a number, only if the ad gives one.
  "max_years"       - only if the ad gives an upper bound, which is rare. Usually null.

CRITERIA
Return "must" and "nice". A must is a requirement the role cannot do without; a nice is a real differentiator. At most ${MAX_CRITERIA_PER_KIND} of each, and fewer is better than padding.

Each criterion is ONE requirement and carries a "type".

A requirement stated with several acceptable answers is still ONE criterion. Put the alternatives inside it. Any one of them satisfies it. Never split such a requirement into several criteria: the ad asks for one thing, and splitting it would report someone who meets it as missing the requirements they did not happen to match.

  "skills"     - the requirement is one or more named technologies. Put them in
                 "skills", each with a "kind". Use several entries only when the
                 ad offers a genuine choice, such as "React or Vue". A single
                 technology that stands on its own gets its own criterion.

  "background" - the requirement is the kind of work someone has done, not a
                 technology. Put the job titles that evidence it in
                 "backgrounds", at most ${MAX_ALTERNATIVES}.
                 An ad asking for "prior AI/ML engineering, data engineering,
                 applied AI, or product engineering experience" is exactly ONE
                 criterion of this type, with backgrounds ["AI Engineer",
                 "Machine Learning Engineer", "Data Engineer", "Applied AI",
                 "Product Engineer"].
                 Never use the role's own title, or a synonym of it, as a
                 background. The search already requires that title, so such
                 a background matches everyone found and cancels out the
                 other must-haves beside it. For a Technical Lead role,
                 "Technical Lead" is not a background; "Software Architect"
                 is.

  "field"      - the requirement maps to one of these fields:
${fieldCatalogForPrompt()}
                 Set "field" to the exact path and "match" to the value.

  "judge"      - anything else. These are read off the profile later, so phrase
                 them as something an evidence link could prove. A requirement
                 about behaviour, judgement, communication or motivation is
                 always this type.

SKILLS VERSUS BACKGROUND
A skill is a technology someone lists on a profile: TypeScript, PostgreSQL, Kubernetes.
A background is work someone has done, evidenced by the job titles they have held: data engineering, applied AI, product engineering.
Someone who worked as a Data Engineer for five years may never list "Data Engineering" among their skills, because their job title already said it. When a requirement names a discipline or a kind of role rather than a tool, it is a background.

WHAT IS A SKILL
A skill is a named technology or technical specialism that reads as a noun on a CV.

A skill is never a trait. Communication, leadership, teamwork, problem solving, ownership, judgement, agency, bias to action and anything of that sort are not skills. However strongly the ad stresses them, they belong in a "judge" criterion.

A skill is never something too broad to narrow a search: "programming", "software development", "computer science", "Agile".

A skill must be something a person would put on their own profile as a standalone entry. Never lift a phrase out of the ad. An ad asking for "experience building AI/ML systems" means Machine Learning, Deep Learning, PyTorch or TensorFlow: name those. "AI/ML Systems" is not a skill anyone lists, and a filter built from it matches nobody.

Write each skill as the plain name of the technology: "Python", not "Python (Programming Language)" and not "Python experience". "PostgreSQL", not "Postgres database experience". Qualifiers and alternative spellings are resolved against the index afterwards, so adding them here only creates duplicates.

Give each skill a "kind", which is used to check that it really is a skill and is then discarded:
${skillKindsForPrompt()}
If a proposed skill fits none of these five, it is not a skill. Leave it out or make it a "judge" criterion.

EVERY CRITERION
  "label"  - how the requirement reads to a recruiter, in a few words. For a
             requirement with alternatives, name the requirement, not one of
             the alternatives: "Prior AI/ML, data or product engineering
             background", not "Machine Learning".
  "weight" - 1 (minor), 2 (normal) or 3 (this is most of the decision).
  "why"    - one short clause saying what the requirement is evidence of.
  "source" - "jd" only if the ad was provided AND states the requirement.
             Otherwise "inferred". Never label an inferred requirement as "jd".

OUTPUT
Return only a JSON object, no prose and no code fences:
{
  "normalized_title": string,
  "synonyms": [string],
  "adjacent_titles": [{"label": string, "note": string}],
  "setup": {"city": string|null, "remote": boolean|null, "employment_type": string|null, "min_years": number|null, "max_years": number|null},
  "must": [{"label": string, "type": "skills"|"background"|"field"|"judge", "skills": [{"label": string, "kind": string}], "backgrounds": [string], "field": string, "match": string, "weight": 1|2|3, "why": string, "source": "jd"|"inferred"}],
  "nice": [ same shape ]
}
Omit the keys a criterion does not use.`;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A criterion as the model described it, before skills are resolved. */
interface Descriptor {
  label: string;
  skillLabels: string[];
  backgrounds: string[];
  field?: string;
  match?: string;
  weight: number;
  why?: string;
  source: CriterionSource;
}

interface RawCriterion {
  label?: unknown;
  type?: unknown;
  skills?: unknown;
  backgrounds?: unknown;
  field?: unknown;
  match?: unknown;
  weight?: unknown;
  why?: unknown;
  source?: unknown;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

/**
 * Validate one criterion as described.
 *
 * Anything that fails validation degrades to a judged criterion rather than
 * being dropped: a requirement the model could not express as a filter is
 * still a requirement, and the scoring model can read it off the profile.
 */
function parseCriterion(entry: RawCriterion, jdProvided: boolean): Descriptor | null {
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  if (!label) return null;

  const weightRaw = Number(entry.weight);
  const base: Descriptor = {
    label,
    skillLabels: [],
    backgrounds: [],
    weight: [1, 2, 3].includes(weightRaw) ? weightRaw : 2,
    why: typeof entry.why === "string" ? entry.why.trim() : undefined,
    source: jdProvided && entry.source === "jd" ? "jd" : "inferred",
  };

  if (entry.type === "skills" && Array.isArray(entry.skills)) {
    const seen = new Set<string>();
    for (const raw of entry.skills.slice(0, MAX_ALTERNATIVES)) {
      const s = raw as { label?: unknown; kind?: unknown };
      const skillLabel = typeof s?.label === "string" ? s.label.trim() : "";
      // The kind is a gate, not data: a model that cannot place a proposed
      // skill into one of the five technical boxes has proposed a trait.
      if (!skillLabel || !isSkillKind(s?.kind)) continue;
      if (!classifySkillLabel(skillLabel).ok) continue;
      const key = normalizeKey(skillLabel);
      if (seen.has(key)) continue;
      seen.add(key);
      base.skillLabels.push(skillLabel);
    }
    return base;
  }

  if (entry.type === "background" && Array.isArray(entry.backgrounds)) {
    base.backgrounds = Array.from(
      new Set(
        entry.backgrounds
          .filter((b): b is string => typeof b === "string")
          .map((b) => b.trim())
          .filter(Boolean)
      )
    ).slice(0, MAX_ALTERNATIVES);
    return base;
  }

  if (entry.type === "field") {
    const field = typeof entry.field === "string" ? entry.field.trim() : "";
    const match = typeof entry.match === "string" ? entry.match.trim() : "";
    const spec = FIELD_CATALOG[field];
    const usable =
      Boolean(spec) && match.length > 0 && (!spec?.numeric || !Number.isNaN(Number(match)));
    if (usable) {
      base.field = field;
      base.match = match;
    }
    return base;
  }

  return base;
}

function parseSetup(raw: unknown): RoleSetupHints {
  const s = (raw ?? {}) as Record<string, unknown>;

  const employment = typeof s.employment_type === "string" ? s.employment_type : "";
  const employmentType: EmploymentType | null = (
    ["full_time", "part_time", "contract", "internship"] as const
  ).includes(employment as EmploymentType)
    ? (employment as EmploymentType)
    : null;

  /**
   * Null unless the ad gave an actual number.
   *
   * Number(null) is 0 and Number("") is 0, so converting first and
   * range-checking afterwards turns "the ad did not say" into a filter of
   * "at least 0 years", which is both wrong and useless. A zero bound is
   * rejected for the same reason: it matches everyone.
   */
  const asYears = (value: unknown): number | null => {
    if (typeof value === "string" && value.trim() === "") return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : null;
  };

  return {
    city: typeof s.city === "string" && s.city.trim() ? s.city.trim() : null,
    remote: typeof s.remote === "boolean" ? s.remote : null,
    employmentType,
    minYears: asYears(s.min_years),
    maxYears: asYears(s.max_years),
  };
}

/**
 * Split the two returned lists into TitleVariant objects.
 *
 * Synonyms arrive selected: they are the same job under another spelling, and
 * making the operator tick them off one by one is busywork that only invites
 * a missed variant. Adjacent titles arrive deselected: widening a search past
 * the actual role changes who you end up contacting, so that is a decision
 * the operator makes deliberately, not one the model makes on their behalf.
 */
function normalizeVariants(
  raw: Record<string, unknown>,
  ownTitles: Set<string>
): TitleVariant[] {
  const seen = new Set(ownTitles);
  const out: TitleVariant[] = [];

  const synonyms = Array.isArray(raw.synonyms) ? raw.synonyms : [];
  for (const entry of synonyms) {
    if (typeof entry !== "string") continue;
    const label = entry.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push({ label, selected: true, tier: "synonym" });
    if (out.length >= MAX_SYNONYMS) break;
  }

  const adjacent = Array.isArray(raw.adjacent_titles) ? raw.adjacent_titles : [];
  let adjacentCount = 0;
  for (const entry of adjacent) {
    const record = entry as { label?: unknown; note?: unknown };
    const label = typeof record?.label === "string" ? record.label.trim() : "";
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push({
      label,
      selected: false,
      tier: "adjacent",
      note:
        typeof record.note === "string" && record.note.trim()
          ? record.note.trim()
          : undefined,
    });
    adjacentCount += 1;
    if (adjacentCount >= MAX_ADJACENT) break;
  }

  return out;
}

async function callModel(title: string, jd: string): Promise<unknown> {
  const hasTitle = title.trim().length > 0;
  const ad = jd.trim().slice(0, 20000);

  let userContent: string;
  if (hasTitle && ad) {
    userContent = `Job title: ${title.trim()}\n\nJob ad:\n"""\n${ad}\n"""`;
  } else if (ad) {
    userContent = `Job ad:\n"""\n${ad}\n"""\n\nNo job title was given. Read the role's title from the ad.`;
  } else {
    userContent = `Job title: ${title.trim()}\n\nNo job ad was provided, so every criterion is inferred and every setup field is null.`;
  }

  try {
    return await askForJson({
      // Sonnet, not Haiku. This one call carries most of the judgement in
      // the tool: normalizing the title, splitting synonyms from adjacent
      // titles, telling skills from backgrounds from traits, grounding each
      // claim in the ad. It runs once per role and is cached, so the tier
      // costs about two cents more per role.
      model: SONNET,
      system: SYSTEM_PROMPT,
      user: userContent,
      maxTokens: 4000,
    });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      throw new Error(`${err.message} You can still fill the form in by hand.`);
    }
    throw err;
  }
}

export async function getSuggestions(
  title: string,
  jd: string,
  force = false
): Promise<SuggestResult> {
  const key = cacheKey(title, jd);

  if (CACHE_ENABLED && !force) {
    const hit = await readCache(key);
    if (hit) return hit;
  }

  const raw = (await callModel(title, jd)) as Record<string, unknown>;
  const jdProvided = jd.trim().length > 0;

  const normalizedTitle =
    typeof raw.normalized_title === "string" && raw.normalized_title.trim()
      ? raw.normalized_title.trim()
      : title.trim();

  const ownTitles = new Set(
    [title.trim(), normalizedTitle].filter(Boolean).map((t) => t.toLowerCase())
  );

  const descriptors: { kind: CriterionKind; d: Descriptor }[] = [];
  for (const [listKey, kind] of [
    ["must", "must"],
    ["nice", "nice"],
  ] as const) {
    const list = Array.isArray(raw[listKey]) ? (raw[listKey] as RawCriterion[]) : [];
    for (const entry of list.slice(0, MAX_CRITERIA_PER_KIND)) {
      const d = parseCriterion(entry, jdProvided);
      if (d) descriptors.push({ kind, d });
    }
  }

  // Every distinct technology across every criterion is resolved once, in
  // parallel. Each lookup is free and cached, so a dozen costs one round
  // trip.
  const skillLabels = Array.from(
    new Set(descriptors.flatMap(({ d }) => d.skillLabels).map((l) => l))
  );
  const resolved = new Map<string, SkillMatch>();
  await Promise.all(
    skillLabels.map(async (label) => {
      resolved.set(normalizeKey(label), await verifySkill(label));
    })
  );

  const criteria: Criterion[] = descriptors.map(({ kind, d }) => {
    const skills = d.skillLabels
      .map((l) => resolved.get(normalizeKey(l)))
      .filter((s): s is SkillMatch => Boolean(s))
      // A technology the index has never heard of would contribute a leaf
      // that matches nobody, so it is dropped from the filter.
      .filter((s) => s.status !== "absent");

    const filterable =
      skills.length > 0 || d.backgrounds.length > 0 || Boolean(d.field && d.match);

    return {
      id: nextId(kind),
      label: d.label,
      kind,
      check: filterable ? "filter" : "judge",
      skills: skills.length > 0 ? skills : undefined,
      backgrounds: d.backgrounds.length > 0 ? d.backgrounds : undefined,
      field: d.field,
      match: d.match,
      weight: d.weight,
      why: d.why,
      source: d.source,
      selected: true,
    };
  });

  const result: SuggestResult = {
    normalizedTitle,
    titleVariants: normalizeVariants(raw, ownTitles),
    criteria,
    setup: parseSetup(raw.setup),
    cached: false,
  };

  if (CACHE_ENABLED) await writeCache(key, result);
  return result;
}
