import type { RawProfile } from "./candidates";
import type { RoleBrief, ScoringWeights } from "./types";

/**
 * Ranking before enrichment.
 *
 * Runs on what `/person/search` returns and nothing else. No model calls,
 * no credits, so it can be rerun against a saved search for free while the
 * weights are still moving.
 *
 * What search does NOT return, measured across three live pools: skills (0
 * of 565 profiles), GitHub links (0), role descriptions (0). So this stage
 * cannot see anyone's stack. Two people with identical careers and
 * completely different technologies score the same, and the query is the
 * only thing enforcing stack. That is the argument for gate mode `all`.
 *
 * Every signal is scored as a POSITION WITHIN THIS POOL rather than on an
 * absolute scale, because what counts as a long tenure or a deep career
 * differs by role and market. The consequence is that a score describes
 * someone's competition, not them: one profile ranked 48th of 164 and 4th
 * of 63 across two pools for the same role. Always read a score next to
 * the pool size.
 */

/** Tech-industry experience bands. Scored, never filtered. */
export const EXPERIENCE_BANDS = [
  { id: "0-2", label: "0 to 2 years", note: "Junior", min: 0, max: 2 },
  { id: "2-5", label: "2 to 5 years", note: "Mid", min: 2, max: 5 },
  { id: "5-10", label: "5 to 10 years", note: "Senior", min: 5, max: 10 },
  { id: "10+", label: "10+ years", note: "Staff and above", min: 10, max: 99 },
] as const;

export type ExperienceBandId = (typeof EXPERIENCE_BANDS)[number]["id"];

export function bandById(id: string | null | undefined) {
  return EXPERIENCE_BANDS.find((b) => b.id === id) ?? null;
}

/**
 * Words marking a role as belonging to the discipline being hired for.
 *
 * Used for two things: deciding which past roles count toward experience,
 * and the wrong-discipline gate. Deliberately broader than the title
 * synonyms, because it has to catch someone's FIRST job in the field,
 * which is "Junior Visual Designer" rather than any variant of the target
 * title.
 *
 * Supplied per role by the intake model. This default is the engineering
 * set, used when a brief predates the field.
 */
export const DEFAULT_DISCIPLINE_TERMS = [
  "engineer", "engineering", "developer", "architect", "programmer", "swe",
  "devops", "sre", "frontend", "front-end", "backend", "back-end",
  "full stack", "fullstack", "full-stack", "software", "cto",
];

/**
 * Company-stage rules, as offered in the UI.
 *
 * Only these four do anything. The obvious rule, "has ever worked at a
 * company under 200", passes 80 to 93% of every pool tested and filters
 * nobody, because a career is long and contains everything. Two changes
 * fix that: a lookback window, and a minimum duration. The duration is
 * what actually matters. Without it you catch anyone who touched a small
 * company for three months; with it you are asking for a real stint, and
 * the pass rate becomes stable across very different pools.
 *
 * Pass rates below are measured on three live pools (164 frontend, 338
 * technical lead, 63 frontend) and are shown in the UI, because a rule
 * whose effect you cannot predict is one nobody will turn on.
 */
export const STAGE_RULES = [
  {
    id: "8y-200",
    label: "Worked somewhere under 200",
    detail: "for at least a year, within the last 8",
    observed: "passes about 63%",
    maxBand: "51-200",
    windowMonths: 96,
    minMonths: 12,
    currentOnly: false,
  },
  {
    id: "8y-50",
    label: "Worked somewhere under 50",
    detail: "for at least a year, within the last 8",
    observed: "passes about 43%",
    maxBand: "11-50",
    windowMonths: 96,
    minMonths: 12,
    currentOnly: false,
  },
  {
    id: "now-200",
    label: "Currently under 200",
    detail: "their employer right now",
    observed: "passes about 41%",
    maxBand: "51-200",
    windowMonths: null,
    minMonths: 0,
    currentOnly: true,
  },
  {
    id: "now-50",
    label: "Currently under 50",
    detail: "their employer right now",
    observed: "passes about 24%",
    maxBand: "11-50",
    windowMonths: null,
    minMonths: 0,
    currentOnly: true,
  },
] as const;

export type StageRuleId = (typeof STAGE_RULES)[number]["id"];

/** Crustdata's headcount bands, smallest first. The cut points are fixed
 *  by the vendor: 10, 50, 200, 500, 1000, 5000, 10000. */
const HEADCOUNT_BANDS = [
  "myself only", "2-10", "11-50", "51-200", "201-500",
  "501-1000", "1001-5000", "5001-10000", "10001+",
];

const JUNIOR =
  /\bintern\b|internship|working student|werkstudent|praktikant|trainee|apprentice|placement|student ambassador/i;
const FREELANCE = /freelance|freelancer|contractor|self[- ]employed|consultant/i;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  title: 2,
  experience: 2.5,
  tenureNow: 2.5,
  tenureHistory: 1.5,
  education: 1,
  /**
   * Company stage is a rule, not a weight.
   *
   * It started as a graded 0-to-1 scale, which measured well but asked the
   * operator to reason about why 51-200 scores 0.75 and 201-500 scores
   * 0.45. A rule states the same preference in words they can defend to a
   * hiring manager. Off by default, because it is a preference about
   * working environment rather than a measure of ability.
   */
  companyStageRule: null,
  companyStageMode: "off",
  penaliseGap: true,
  penaliseFreelance: true,
  penaliseStale: true,
};

/**
 * The window in a current role where someone is most likely to move.
 * Standard recruiter curve, and the one absolute rather than pool-relative
 * judgement in this file.
 */
const MOVABLE_FROM = 18;
const MOVABLE_TO = 36;

function monthsSince(iso?: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const now = new Date();
  const d = new Date(then);
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

function roles(p: RawProfile) {
  const e = p.experience?.employment_details;
  return { current: e?.current ?? [], past: e?.past ?? [] };
}

function tokens(s?: string | null): string[] {
  return (s ?? "").toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
}

function hasAllWords(needle: string, haystack: string): boolean {
  const h = new Set(tokens(haystack));
  const n = tokens(needle);
  return n.length > 0 && n.every((w) => h.has(w));
}

function isDiscipline(text: string | undefined | null, terms: string[]): boolean {
  const t = (text ?? "").toLowerCase();
  return terms.some((term) => term && t.includes(term.toLowerCase()));
}

/** Length of one role in months, from its own dates. */
function roleMonths(j: { start_date?: string | null; end_date?: string | null }): number | null {
  const start = monthsSince(j.start_date);
  if (start === null) return null;
  const end = j.end_date ? monthsSince(j.end_date) : 0;
  return Math.max(0, start - (end ?? 0));
}

/**
 * Consecutive roles at one employer are ONE stint.
 *
 * LinkedIn splits internal promotions into separate entries, so without
 * this the median stint in a live pool came out at 13.5 months and 69% of
 * people read as job-hoppers. `years_at_company_raw` is worse: it is an
 * integer floor, so every 18-month role reports as 1.
 */
function stints(
  past: { name?: string | null; start_date?: string | null; end_date?: string | null }[]
): number[] {
  const byCompany = new Map<string, number>();
  for (const j of past) {
    const co = (j.name ?? "").trim().toLowerCase();
    const m = roleMonths(j);
    if (!co || m === null) continue;
    byCompany.set(co, (byCompany.get(co) ?? 0) + m);
  }
  return [...byCompany.values()].filter((v) => v > 0);
}

/**
 * Years in the discipline, from the first role whose TITLE belongs to it,
 * ignoring short junior stints at the front.
 *
 * Counting from the first job of any kind is wrong: across three live
 * pools, 33 to 51% of people have a non-discipline first job, median 2.9
 * years of it, and the commonest are Intern, Sales Assistant, Waiter and
 * Student Ambassador. Crustdata's `years_of_experience_raw` is not used:
 * it is undocumented, never returned by search, and no reconstruction of
 * it put more than 62% of a pool inside the window that pool was filtered
 * on.
 */
function disciplineYears(p: RawProfile, terms: string[]): number | null {
  const { current, past } = roles(p);
  const inField = [...current, ...past]
    .filter((j) => j.start_date && isDiscipline(j.title, terms))
    .filter((j) => !JUNIOR.test(j.title ?? "") || (roleMonths(j) ?? 0) >= 12);
  if (inField.length === 0) return null;
  const earliest = inField.reduce((a, b) => ((a.start_date ?? "") < (b.start_date ?? "") ? a : b));
  const m = monthsSince(earliest.start_date);
  return m === null ? null : Math.round((m / 12) * 10) / 10;
}

/**
 * Does this profile satisfy the chosen company-stage rule?
 *
 * Roles are clipped to the lookback window, so a job that started ten
 * years ago and ran until last year contributes the seven years inside
 * it. Null when no role carries a headcount band at all, which is treated
 * as a pass everywhere: missing data is not evidence against someone.
 */
function stagePasses(p: RawProfile, ruleId: string | null): boolean | null {
  const rule = STAGE_RULES.find((r) => r.id === ruleId);
  if (!rule) return null;
  const limit = HEADCOUNT_BANDS.indexOf(rule.maxBand);
  const { current, past } = roles(p);
  const candidates = rule.currentOnly ? current : [...current, ...past];

  let sawAnyBand = false;
  for (const j of candidates) {
    const band = HEADCOUNT_BANDS.indexOf(j.company_headcount_range ?? "");
    if (band === -1) continue;
    sawAnyBand = true;
    if (band > limit) continue;
    if (rule.minMonths === 0 && rule.windowMonths === null) return true;
    const startedAgo = monthsSince(j.start_date);
    if (startedAgo === null) continue;
    const endedAgo = j.end_date ? (monthsSince(j.end_date) ?? 0) : 0;
    const inWindow =
      (rule.windowMonths === null ? startedAgo : Math.min(startedAgo, rule.windowMonths)) -
      Math.max(endedAgo, 0);
    if (inWindow > rule.minMonths) return true;
  }
  return sawAnyBand ? false : null;
}

export interface ScoreParts {
  title: number;
  experience: number;
  tenureNow: number;
  tenureHistory: number;
  education: number;
}

export interface ScoredProfile {
  id: string;
  name: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  headline: string;
  linkedinUrl: string | null;
  years: number | null;
  monthsInRole: number | null;
  medianStintMonths: number | null;
  /** Whether the chosen company-stage rule is met. Null when no rule is set. */
  stagePass: boolean | null;
  educationLabel: string;
  profileAgeMonths: number | null;
  /** Per-signal position in the pool, 0 to 1. */
  parts: ScoreParts;
  penalties: string[];
  score: number;
  rank: number;
}

export interface ScoreRun {
  pool: number;
  survivors: number;
  dropped: { reason: string; count: number }[];
  bandLabel: string;
  bandFromPool: boolean;
  rows: ScoredProfile[];
  cut: number;
  /** How many sit within 3 points of the cut, so a flat boundary is visible. */
  nearCut: number;
  median: number;
  weights: ScoringWeights;
  disciplineTerms: string[];
}

/**
 * Position of each value among its non-null peers, 0 to 1, ties sharing a
 * rank. A missing value sits at 0.5: not knowing something is not evidence
 * against someone.
 */
function percentileRank(values: (number | null)[]): number[] {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null)
    .sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0.5);
  const span = Math.max(1, present.length - 1);
  let i = 0;
  while (i < present.length) {
    let j = i;
    while (j + 1 < present.length && present[j + 1].v === present[i].v) j += 1;
    const r = (i + j) / 2 / span;
    for (let k = i; k <= j; k += 1) out[present[k].i] = r;
    i = j + 1;
  }
  return out;
}

/** Signed distance outside a band, zero inside it. Above counts half,
 *  because too much experience is a milder mismatch than too little. */
function outsideBand(v: number, min: number, max: number): number {
  if (v < min) return min - v;
  if (v > max) return (v - max) * 0.5;
  return 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

export function scoreSearch(
  profiles: RawProfile[],
  brief: RoleBrief,
  cut = 20
): ScoreRun {
  const terms =
    brief.disciplineTerms && brief.disciplineTerms.length > 0
      ? brief.disciplineTerms
      : DEFAULT_DISCIPLINE_TERMS;
  const w: ScoringWeights = { ...DEFAULT_WEIGHTS, ...(brief.weights ?? {}) };

  // ---- gates -------------------------------------------------------------
  const stageRule = w.companyStageMode === "off" ? null : w.companyStageRule;
  const stageRuleLabel =
    STAGE_RULES.find((r) => r.id === stageRule)?.label.toLowerCase() ?? "";

  const dropped = new Map<string, number>();
  const survivors: RawProfile[] = [];
  for (const p of profiles) {
    const c = roles(p).current[0];
    const title = c?.title ?? "";
    const fc = c?.function_category ?? "";
    const age = monthsSince(p.metadata?.updated_at);
    let reason: string | null = null;
    if (JUNIOR.test(title)) reason = "Not started yet (intern, student, trainee)";
    else if (fc && !isDiscipline(fc, terms) && !isDiscipline(title, terms))
      reason = "Current role is not in this discipline";
    else if (age !== null && age >= 24) reason = "Profile not refreshed in 24 months";
    else if (w.companyStageMode === "filter" && stagePasses(p, stageRule) === false)
      reason = `Company stage: has not ${stageRuleLabel}`;
    if (reason) dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
    else survivors.push(p);
  }

  // ---- raw values --------------------------------------------------------
  const raw = survivors.map((p) => {
    const { current, past } = roles(p);
    const c = current[0] ?? {};
    const title = c.title ?? "";

    const titleLevel = hasAllWords(brief.title, title)
      ? title.toLowerCase().includes(brief.title.toLowerCase())
        ? 4
        : 3
      : brief.titleVariants.some((v) => v.selected && hasAllWords(v.label, title))
        ? 2
        : 1;

    const st = stints(past).sort((a, b) => a - b);
    const medianStint = st.length >= 2 ? st[Math.floor(st.length / 2)] : null;

    const schools = p.education?.schools ?? [];
    const degrees = schools.map((s) => s.degree ?? "").join(" ").toLowerCase();
    const eduLevel =
      schools.length === 0
        ? 0
        : /bachelor|master|bsc|msc|meng|beng|phd|doctor|diplom|degree/.test(degrees)
          ? 2
          : 1;

    const seq = [...current, ...past]
      .filter((j) => j.start_date)
      .sort((a, b) => ((a.start_date ?? "") < (b.start_date ?? "") ? -1 : 1));
    let gap = 0;
    for (let i = 0; i + 1 < seq.length; i += 1) {
      const endedAgo = monthsSince(seq[i].end_date);
      const nextAgo = monthsSince(seq[i + 1].start_date);
      if (endedAgo !== null && nextAgo !== null && nextAgo < 60)
        gap = Math.max(gap, endedAgo - nextAgo);
    }

    return {
      profile: p,
      title,
      company: c.name ?? "",
      titleLevel,
      years: disciplineYears(p, terms),
      monthsInRole: roleMonths(c),
      medianStint,
      stagePass: stagePasses(p, stageRule),
      eduLevel,
      educationLabel:
        schools.length === 0
          ? "none listed"
          : schools[0].degree || schools[0].school || "listed",
      gap,
      freelance: FREELANCE.test(title),
      ageMonths: monthsSince(p.metadata?.updated_at),
    };
  });

  // ---- experience band ---------------------------------------------------
  const chosen = bandById(brief.experienceBand);
  const yearsPresent = raw
    .map((r) => r.years)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const band = chosen
    ? { min: chosen.min, max: chosen.max }
    : { min: quantile(yearsPresent, 0.25), max: quantile(yearsPresent, 0.85) };
  const bandLabel = chosen
    ? `${chosen.label} (${chosen.note})`
    : `${band.min.toFixed(0)} to ${band.max.toFixed(0)} years, taken from this pool`;

  // ---- percentile columns ------------------------------------------------
  // The two sweet-spot signals become distance-from-ideal first. Ranking
  // them directly would put the most experienced person top, when the role
  // wants the middle.
  const cols = {
    title: percentileRank(raw.map((r) => r.titleLevel)),
    experience: percentileRank(
      raw.map((r) => (r.years === null ? null : -outsideBand(r.years, band.min, band.max)))
    ),
    tenureNow: percentileRank(
      raw.map((r) =>
        r.monthsInRole === null
          ? null
          : -outsideBand(r.monthsInRole, MOVABLE_FROM, MOVABLE_TO)
      )
    ),
    tenureHistory: percentileRank(raw.map((r) => r.medianStint)),
    education: percentileRank(raw.map((r) => r.eduLevel)),
  };

  const totalWeight =
    w.title + w.experience + w.tenureNow + w.tenureHistory + w.education || 1;

  const rows: ScoredProfile[] = raw.map((r, i) => {
    const parts: ScoreParts = {
      title: cols.title[i],
      experience: cols.experience[i],
      tenureNow: cols.tenureNow[i],
      tenureHistory: cols.tenureHistory[i],
      education: cols.education[i],
    };
    const weighted =
      (parts.title * w.title +
        parts.experience * w.experience +
        parts.tenureNow * w.tenureNow +
        parts.tenureHistory * w.tenureHistory +
        parts.education * w.education) /
      totalWeight;

    const penalties: string[] = [];
    let penalty = 0;
    /**
     * Penalise mode is the default over filter for the same reason the
     * years bound stopped being a filter: a rejected profile leaves no
     * card and no chance to judge, and this rule has real false
     * negatives. Seven years at a 210-person company fails "under 200" by
     * ten headcount.
     */
    if (w.companyStageMode === "penalise" && r.stagePass === false) {
      penalties.push(`not ${stageRuleLabel}`);
      penalty += 0.15;
    }
    if (w.penaliseGap && r.gap > 12) {
      penalties.push(`${Math.round(r.gap / 12)}y career gap`);
      penalty += 0.1;
    }
    if (w.penaliseFreelance && r.freelance) {
      penalties.push("freelance or contract");
      penalty += 0.1;
    }
    if (w.penaliseStale && (r.ageMonths ?? 0) >= 12) {
      penalties.push("profile over a year old");
      penalty += 0.08;
    }

    const bp = r.profile.basic_profile;
    return {
      id: String(r.profile.crustdata_person_id ?? `row-${i}`),
      name: bp?.name ?? "Unknown",
      currentTitle: r.title,
      currentCompany: r.company,
      location: bp?.location?.raw ?? "",
      headline: bp?.headline ?? "",
      linkedinUrl:
        r.profile.social_handles?.professional_network_identifier?.profile_url ?? null,
      years: r.years,
      monthsInRole: r.monthsInRole,
      medianStintMonths: r.medianStint,
      stagePass: r.stagePass,
      educationLabel: r.educationLabel,
      profileAgeMonths: r.ageMonths,
      parts,
      penalties,
      score: Math.round(Math.max(0, weighted - penalty) * 1000) / 10,
      rank: 0,
    };
  });

  // Ties break on movability then title, so a rerun gives the same list.
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.parts.tenureNow - a.parts.tenureNow ||
      b.parts.title - a.parts.title
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const effectiveCut = Math.min(cut, rows.length);
  const cutScore = rows[effectiveCut - 1]?.score ?? 0;

  return {
    pool: profiles.length,
    survivors: survivors.length,
    dropped: [...dropped.entries()].map(([reason, count]) => ({ reason, count })),
    bandLabel,
    bandFromPool: !chosen,
    rows,
    cut: effectiveCut,
    nearCut: rows.filter((r) => Math.abs(r.score - cutScore) <= 3).length,
    median: scores.length ? quantile(scores, 0.5) : 0,
    weights: w,
    disciplineTerms: terms,
  };
}
