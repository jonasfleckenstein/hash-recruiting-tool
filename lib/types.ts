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
  minYears: number | null;
  maxYears: number | null;
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
  /** true when the payload came from the on-disk cache rather than the API. */
  cached: boolean;
}
