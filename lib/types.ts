/**
 * Shared shapes for the intake step.
 *
 * A Criterion is the unit the whole tool turns on. Two distinctions matter:
 *
 *  kind  = must | nice
 *          "must" criteria gate the search (a candidate needs at least ONE of
 *          them to be returned at all) and every miss is reported in the score.
 *          "nice" criteria never filter anything, they only add score.
 *
 *  check = filter | judge
 *          "filter" means the criterion can be expressed as a Crustdata search
 *          condition, so it costs nothing to apply and is exact.
 *          "judge" means it can only be assessed by reading the profile, so it
 *          is handed to the scoring model later with an evidence requirement.
 */

export type CriterionKind = "must" | "nice";
export type CriterionCheck = "filter" | "judge";

/** Where the criterion came from. Shown in the UI so the operator can tell
 *  a claim made by the job ad apart from one the model invented. */
export type CriterionSource = "jd" | "inferred" | "manual";

/**
 * The kinds of thing that count as a hard skill.
 *
 * This is never stored or shown. It exists only as a gate during
 * suggestion: the model must be able to put a proposed skill into one of
 * these five boxes, and "communication" fits none of them. Crustdata has no
 * equivalent split, so a kind would tell the query nothing anyway.
 */
export type SkillKind = "language" | "framework" | "tool" | "platform" | "domain";

export interface SkillMatch {
  /** The technology as written, e.g. "TypeScript". */
  label: string;
  /**
   * Every spelling of this skill held in the index, so the filter can match
   * all of them at once. Falls back to the label as written when the index
   * could not be reached.
   */
  indexed: string[];
  /**
   * confirmed - the index holds this skill, and `indexed` lists its spellings
   * absent    - the index was asked and has nothing, so a filter on it would
   *             match nobody
   * unchecked - no Crustdata key, so the label is used as written
   */
  status: "confirmed" | "absent" | "unchecked";
}

/**
 * One requirement.
 *
 * A criterion can hold alternatives, because job ads routinely state one
 * requirement with several acceptable answers: "prior AI/ML engineering,
 * data engineering, applied AI, or product engineering experience". Any one
 * alternative satisfies it. Splitting that into four criteria would gate the
 * search identically but tell a product engineer they miss three
 * requirements the ad says they meet, which is a false negative in the score
 * rather than in the search.
 *
 * The three filterable shapes are alternatives to each other, not exclusive:
 * whatever is present is OR-ed together.
 */
export interface Criterion {
  id: string;
  /** How the requirement reads to a recruiter. */
  label: string;
  kind: CriterionKind;
  check: CriterionCheck;
  /** Named technologies. Any one satisfies the criterion. */
  skills?: SkillMatch[];
  /**
   * Job titles evidencing a background. Any one satisfies. Matched against
   * every role someone has held, not just the current one, because these
   * describe what a person has done rather than what they do now.
   */
  backgrounds?: string[];
  /** A condition on a catalog field, for requirements that are neither. */
  field?: string;
  match?: string;
  /** 1 = minor, 2 = normal, 3 = heavily weighted. */
  weight: number;
  why?: string;
  source: CriterionSource;
  selected: boolean;
}

/**
 * How close a title is to the one being hired for.
 *
 *  synonym  - the same job under different wording. Searched automatically.
 *  adjacent - overlaps the role but is not the same job. Shown switched off,
 *             and only enters the query if the operator turns it on.
 *  manual   - typed in by the operator, so selected by definition.
 */
export type VariantTier = "synonym" | "adjacent" | "manual";

export interface TitleVariant {
  label: string;
  selected: boolean;
  tier: VariantTier;
  /** For adjacent titles: a few words on how it differs from the role. */
  note?: string;
}

export type LocationMode = "onsite" | "remote";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";

/**
 * How the filterable must-haves combine in the query.
 *
 *  any - at least one of them. Nobody strong is lost for missing a single
 *        requirement, and every miss is reported on their card instead.
 *  all - every one of them. A far smaller and more exact pool, at the cost
 *        of silently dropping people who simply never listed something.
 */
export type GateMode = "any" | "all";

/**
 * How the pre-enrichment ranking is weighted.
 *
 * Lives on the brief rather than in the scorer because the right weighting
 * is a property of the role, not of the tool. Freelance work is a negative
 * signal for a salaried engineering hire and completely normal in design;
 * a missing degree means less for a designer with a portfolio. These are
 * judgement calls the operator makes per role.
 *
 * 0 turns a signal off entirely.
 */
export interface ScoringWeights {
  title: number;
  experience: number;
  tenureNow: number;
  tenureHistory: number;
  education: number;
  /**
   * Company stage: a rule about the size of the companies someone has
   * worked at, and how strictly to apply it.
   *
   *  off      - ignored entirely
   *  penalise - failing the rule costs points but keeps the card
   *  filter   - failing the rule removes the profile
   *
   * Off by default. It is a preference about working environment rather
   * than a measure of ability, and `filter` deletes people invisibly,
   * which is the failure mode the years bound already demonstrated.
   */
  companyStageRule: string | null;
  companyStageMode: "off" | "penalise" | "filter";
  penaliseGap: boolean;
  penaliseFreelance: boolean;
  penaliseStale: boolean;
}

/**
 * Evidence the profile must carry for the search to return it.
 *
 * These are not requirements about the person, they are requirements about
 * how much of the person is visible. Search on this plan returns neither
 * role descriptions nor the GitHub link, so nothing downstream can tell
 * who has them: the only way to know is to require it in the query and
 * pay for fewer results.
 *
 * Both default off. Requiring GitHub cut one live pool from 164 to 73, and
 * the 91 it removed are mostly people whose work sits in private repos,
 * which is most commercial engineering.
 */
export interface EvidenceRequirements {
  /** A GitHub account with at least one public repository. 45% of one live pool. */
  github: boolean;
  /**
   * A description on the CURRENT role. Only 34% of a live pool, because
   * people write a job up after they leave it and often leave the current
   * row blank. Narrow, but it is the only evidence of what someone is
   * doing now, which is what a judged criterion about present-day
   * responsibility needs.
   */
  currentDescription: boolean;
  /**
   * A description on any past role. 87% of a live pool. Broad, and that is
   * the point: it removes the people who have written nothing anywhere,
   * which is the case that wastes an enrichment credit.
   */
  pastDescription: boolean;
}

export interface RoleBrief {
  title: string;
  titleVariants: TitleVariant[];
  locationMode: LocationMode;
  /** "City, Country", so the geocoder cannot pick a same-named city. */
  city: string;
  radius: number;
  radiusUnit: "km" | "mi";
  /** UTC offset window the candidate needs to overlap with, for remote roles. */
  tzMin: number;
  tzMax: number;
  /** Continents searched for remote roles. Derived from the timezone window
   *  unless the operator overrides them. */
  regions: string[];
  employmentType: EmploymentType;
  /**
   * Deprecated as a filter.
   *
   * These used to become `years_of_experience_raw` conditions in the query.
   * They no longer do. That field is undocumented, is never returned by
   * search, and no reconstruction of it put more than 62% of a pool inside
   * the window that pool had been filtered on. Worse, a bound on it
   * silently removed every one of a shortlist's top five, including a
   * career changer whose engineering experience was well inside the band.
   *
   * Experience is now `experienceBand`, scored rather than filtered, so a
   * mismatch costs points instead of deleting someone invisibly. Kept here
   * only so saved briefs still parse.
   */
  minYears: number | null;
  maxYears: number | null;
  /** Target seniority band, scored not filtered. Null lets the pool set it. */
  experienceBand: string | null;
  /**
   * Words marking a role as belonging to this discipline, used to count
   * relevant experience and to gate out the wrong field. Written by the
   * intake model so the tool is not hardcoded to engineering.
   */
  disciplineTerms: string[];
  evidence: EvidenceRequirements;
  weights: ScoringWeights;
  gateMode: GateMode;
  criteria: Criterion[];
}

/**
 * Things the job ad states about the role itself. Null means the ad did not
 * say, never a guess: these fill form fields, and a wrong guess is worse
 * than an empty box.
 */
export interface RoleSetupHints {
  city: string | null;
  remote: boolean | null;
  employmentType: EmploymentType | null;
  minYears: number | null;
  maxYears: number | null;
}

export interface SuggestResult {
  normalizedTitle: string;
  titleVariants: TitleVariant[];
  criteria: Criterion[];
  setup: RoleSetupHints;
  /** Discipline vocabulary for the scorer. See RoleBrief.disciplineTerms. */
  disciplineTerms: string[];
  /** true when the payload came from the on-disk cache rather than the API. */
  cached: boolean;
}
