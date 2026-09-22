import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SONNET, askForJson } from "./anthropic";
import type { MatchCriterion } from "./matching";
import type { Person } from "./people";

const DATA_DIR = path.join(process.cwd(), ".data", "matching");

/**
 * Bump when the prompt changes.
 *
 * It is part of every cache key, so an edit here invalidates stored
 * verdicts rather than leaving answers from an older prompt sitting
 * alongside newer ones in the same grid.
 *
 * v2: binary verdicts, and declared skills answered separately.
 */
const PROMPT_VERSION = "v2";

/** People judged at once. One call per candidate, all their
 *  requirements together: the profile text is the expensive part, and
 *  sending it once per requirement would be six times the tokens for
 *  the same answers. */
const CONCURRENCY = 6;

/**
 * Two outcomes, not three.
 *
 * An earlier version had met, partial and absent. Every disagreement
 * between two runs of the same grid involved "partial", and the
 * literature says why: moving from ternary to binary grading raises
 * agreement by around twenty points, because partial credit adds
 * ambiguity without adding discrimination.
 *
 * "unreadable" is never chosen by the model. It is decided in code
 * when there is nothing written about someone, so a gap in the data
 * can never be mistaken for a gap in the person.
 */
export type Verdict = "met" | "not_met" | "unreadable";

export type VerdictBasis = "stated" | "inferred";

export interface CriterionVerdict {
  criterionId: string;
  /** Whether anything the person WROTE shows this. */
  verdict: Verdict;
  basis: VerdictBasis | null;
  /** The passage the verdict rests on, verified as a literal substring
   *  of the prose. Null unless met. */
  span: string | null;
  /** Which labelled block the span came from, so a card can link back. */
  field: string | null;
  reason: string;
  /**
   * The skill they LISTED that matches this requirement, if any.
   *
   * A separate answer to a separate question, never merged with the
   * verdict. Someone can have written nothing about accessibility and
   * still have "Web Accessibility (WCAG)" in their skills; those are
   * different facts and a recruiter should be able to tell them apart
   * at a glance.
   *
   * Verified as an exact member of the person's own skills list, so
   * the model can recognise that WCAG and accessibility standards are
   * the same thing but cannot invent a skill they never declared.
   */
  declaredSkill: string | null;
}

export interface CandidateJudgement {
  internalId: string;
  name: string;
  verdicts: CriterionVerdict[];
  judgedAt: string;
  model: string;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* What a verdict may rest on                                                  */
/* -------------------------------------------------------------------------- */

export interface CandidateEvidence {
  /** Labelled prose. The only thing a "met" may quote. */
  text: string;
  /** Self-declared skills, unordered, no context. */
  skills: string[];
}

/**
 * Everything written about a person, plus their declared skills, kept
 * strictly apart.
 *
 * The separation is the point. A skill is one word somebody ticked; a
 * role description is an account of what they did. Mixing them lets a
 * single token in a list produce a verdict indistinguishable from one
 * backed by a paragraph.
 *
 * Numbers are absent from both. Anything countable is computed in
 * code, so the model is never asked to do arithmetic it is bad at.
 */
export function candidateEvidence(person: Person): CandidateEvidence {
  const d = person.crustdata.data as Record<string, any>;
  const bp = d.basic_profile ?? {};
  const emp = d.experience?.employment_details ?? {};
  const gh = person.github?.data ?? null;
  const blocks: string[] = [];

  if (bp.headline) blocks.push(`[headline]\n${bp.headline}`);
  if (bp.summary) blocks.push(`[summary]\n${bp.summary}`);

  for (const r of [...(emp.current ?? []), ...(emp.past ?? [])]) {
    if (!r?.description?.trim()) continue;
    const years = [r.start_date?.slice(0, 4), r.end_date?.slice(0, 4) ?? "now"]
      .filter(Boolean)
      .join(" to ");
    blocks.push(
      `[role: ${r.title ?? "role"} at ${r.name ?? "unknown"}${years ? `, ${years}` : ""}]\n${r.description.trim()}`
    );
  }

  for (const s of d.education?.schools ?? []) {
    if (!s?.activities_and_societies?.trim()) continue;
    blocks.push(
      `[education: ${s.school ?? "school"}]\n${s.activities_and_societies.trim()}`
    );
  }

  const bio = gh?.bio ?? d.dev_platform_profiles?.[0]?.bio ?? null;
  if (bio) blocks.push(`[github bio]\n${bio}`);

  /**
   * Merged pull requests and owned repositories, as prose. For a
   * technical role this is often the only description of what someone
   * actually built. Empty for every other kind of role, which is
   * correct rather than a gap.
   */
  const prs = (gh?.notablePrs ?? []).slice(0, 6);
  if (prs.length > 0) {
    blocks.push(
      `[github: merged pull requests]\n${prs
        .map((p) => `- ${p.title} (${p.repo})`)
        .join("\n")}`
    );
  }
  const repos = (gh?.topRepos ?? []).filter((r) => r.description).slice(0, 5);
  if (repos.length > 0) {
    blocks.push(
      `[github: their own projects]\n${repos
        .map((r) => `- ${r.nameWithOwner}: ${r.description}`)
        .join("\n")}`
    );
  }

  return {
    text: blocks.join("\n\n"),
    skills: (d.skills?.professional_network_skills ?? []).filter(
      (s: unknown): s is string => typeof s === "string" && s.trim().length > 0
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* The prompt                                                                  */
/* -------------------------------------------------------------------------- */

const SYSTEM = `For each requirement you answer two separate questions about one person. You do not rank, score, or compare people, and you never see how much a requirement matters.

QUESTION 1 - EVIDENCE
Does the TEXT show this person doing or having what the requirement asks?
  met      Yes, and you can quote the passage that shows it.
  not_met  No passage in the TEXT supports it.

QUESTION 2 - DECLARED SKILL
Does the DECLARED SKILLS list contain this requirement, under any name? Match meaning, not spelling: a requirement about accessibility standards is matched by "Web Accessibility (WCAG)", "WCAG", or "a11y". Return the skill exactly as written in the list, or null if nothing matches.

RULES
1. The two questions are independent. A skill in the list is a word the person ticked, not an account of anything they did. It can never make question 1 "met", and you must never quote from DECLARED SKILLS.
2. Every "met" carries a span: the passage from the TEXT your verdict rests on, copied character for character. No span, no "met".
3. Inference is expected and welcome. Set basis to "inferred" when you reasoned from what the text describes, "stated" when it says so directly.
4. Never infer from a job title alone, from an employer's name, or from what someone in that role usually does. Only from what is written.
5. Evidence from any role counts, whatever its date.
6. Where a requirement names several acceptable answers, any one of them satisfies it.
7. Do not calculate. Never derive years, counts, or durations.

EXAMPLE
Requirement: "Has led engineers"
TEXT contains: "Grew the frontend team from two to six and ran their weekly reviews."
DECLARED SKILLS contains: "Team Leadership"
Answer: verdict "met", basis "inferred", span that sentence, reason "Grew a team and ran its reviews, which is leading engineers.", declaredSkill "Team Leadership".

OUTPUT
Return only JSON, no prose. One entry per requirement, using the ids given:
{"verdicts":[{"id":"...","verdict":"met","basis":"inferred","span":"...","field":"...","reason":"...","declaredSkill":"..."}]}
basis, span and field are null when verdict is "not_met". declaredSkill is null when nothing in the list matches. reason is one sentence under 25 words.`;

function userPrompt(
  criteria: MatchCriterion[],
  evidence: CandidateEvidence,
  context: string
): string {
  return [
    "REQUIREMENTS",
    criteria.map((c) => `${c.id}: ${c.label}`).join("\n"),
    context ? `\nABOUT THE ROLE (background, not a requirement)\n${context}` : "",
    "\nTEXT",
    evidence.text || "(nothing written)",
    "\nDECLARED SKILLS",
    evidence.skills.length > 0 ? evidence.skills.join(", ") : "(none listed)",
  ]
    .filter(Boolean)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Judging                                                                     */
/* -------------------------------------------------------------------------- */

function keyFor(
  criterion: MatchCriterion,
  evidence: CandidateEvidence,
  context: string,
  model: string
): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        criterion.label,
        evidence.text,
        evidence.skills.join("|"),
        context,
        PROMPT_VERSION,
        model,
      ].join("\u0000")
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Check the model's work before storing it.
 *
 * Each answer is verified against its own source, and that is what
 * keeps the two questions apart. The span is checked against the prose
 * alone, so a verdict cannot be satisfied by quoting the skills list.
 * The declared skill is checked against the skills array, so the model
 * can recognise a synonym but cannot invent a skill nobody listed.
 *
 * The instruction is a request; these checks are the enforcement.
 */
function validate(
  raw: any,
  criterion: MatchCriterion,
  evidence: CandidateEvidence,
  hasProse: boolean
): CriterionVerdict {
  // A declared skill only counts if it is literally one of theirs.
  const claimed = typeof raw?.declaredSkill === "string" ? raw.declaredSkill.trim() : "";
  const declaredSkill =
    evidence.skills.find((s) => s.toLowerCase() === claimed.toLowerCase()) ?? null;

  const reason = typeof raw?.reason === "string" ? raw.reason.trim() : "";

  const notMet = (why: string): CriterionVerdict => ({
    criterionId: criterion.id,
    verdict: hasProse ? "not_met" : "unreadable",
    basis: null,
    span: null,
    field: null,
    reason: hasProse
      ? why
      : "No summary, no role written up, no bio. A job title is not evidence.",
    declaredSkill,
  });

  if (raw?.verdict !== "met") {
    return notMet(reason || "Nothing written addresses this.");
  }

  const span = typeof raw?.span === "string" ? raw.span.trim() : "";
  if (!span || !evidence.text.includes(span)) {
    return notMet(
      "Downgraded: the quoted evidence was not found in the written text."
    );
  }

  return {
    criterionId: criterion.id,
    verdict: "met",
    basis: raw?.basis === "stated" ? "stated" : "inferred",
    span,
    field: typeof raw?.field === "string" ? raw.field : null,
    reason: reason || "No reason given.",
    declaredSkill,
  };
}

/** Judge one person against every requirement, in one call. */
export async function judgeCandidate(
  person: Person,
  criteria: MatchCriterion[],
  context: string,
  cache: Record<string, CriterionVerdict>,
  /** Read the cache but never call the model. Lets a page show what
   *  has already been paid for without spending anything to do it. */
  cachedOnly = false
): Promise<CandidateJudgement> {
  const evidence = candidateEvidence(person);
  const hasProse = evidence.text.replace(/\[headline\][^\n]*\n?/g, "").trim().length > 0;
  const base = {
    internalId: person.internalId,
    name: person.name,
    judgedAt: new Date().toISOString(),
    model: SONNET,
  };

  /**
   * Nothing to read and nothing declared is the one case worth
   * skipping. Someone with no prose but a skills list still gets the
   * second question answered, because that is a real, if weak, fact
   * about them.
   */
  if (!hasProse && evidence.skills.length === 0) {
    return {
      ...base,
      verdicts: criteria.map((c) => ({
        criterionId: c.id,
        verdict: "unreadable" as Verdict,
        basis: null,
        span: null,
        field: null,
        reason: "Nothing written and no skills listed.",
        declaredSkill: null,
      })),
    };
  }

  const pending = criteria.filter(
    (c) => !cache[keyFor(c, evidence, context, SONNET)]
  );
  const verdicts: CriterionVerdict[] = criteria
    .map((c) => cache[keyFor(c, evidence, context, SONNET)])
    .filter(Boolean);

  if (pending.length === 0 || cachedOnly) return { ...base, verdicts };

  try {
    const reply = (await askForJson({
      model: SONNET,
      system: SYSTEM,
      user: userPrompt(pending, evidence, context),
      // Generous: a truncated reply is a lost candidate, and output
      // tokens are the cheap half of this call.
      maxTokens: 600 + pending.length * 220,
    })) as { verdicts?: any[] };

    const byId = new Map(
      (reply.verdicts ?? []).map((v: any) => [String(v?.id), v])
    );

    for (const c of pending) {
      const checked = validate(byId.get(c.id), c, evidence, hasProse);
      cache[keyFor(c, evidence, context, SONNET)] = checked;
      verdicts.push(checked);
    }
  } catch (err) {
    return {
      ...base,
      verdicts,
      error: err instanceof Error ? err.message : "Judging failed.",
    };
  }

  const order = new Map(criteria.map((c, i) => [c.id, i]));
  verdicts.sort(
    (a, b) => (order.get(a.criterionId) ?? 0) - (order.get(b.criterionId) ?? 0)
  );
  return { ...base, verdicts };
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

function cacheFile(searchId: string): string {
  return path.join(DATA_DIR, `${searchId}.verdicts.json`);
}

export async function readVerdictCache(
  searchId: string
): Promise<Record<string, CriterionVerdict>> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(searchId), "utf8"));
  } catch {
    return {};
  }
}

export async function writeVerdictCache(
  searchId: string,
  cache: Record<string, CriterionVerdict>
): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(cacheFile(searchId), JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // Losing the cache costs money on the next run, not correctness.
  }
}

/**
 * Judge a cohort.
 *
 * Bounded concurrency rather than all at once: the binding limit is
 * input tokens per minute, not requests, and a pool lets each result be
 * kept as it lands so an interrupted run resumes instead of restarting.
 */
export async function judgeCohort(
  searchId: string,
  people: Person[],
  criteria: MatchCriterion[],
  context: string,
  cachedOnly = false
): Promise<{ judgements: CandidateJudgement[]; called: number; pending: number }> {
  const cache = await readVerdictCache(searchId);
  const before = Object.keys(cache).length;
  const judgements: CandidateJudgement[] = new Array(people.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= people.length) return;
      judgements[i] = await judgeCandidate(
        people[i],
        criteria,
        context,
        cache,
        cachedOnly
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, people.length) }, worker)
  );

  if (!cachedOnly) await writeVerdictCache(searchId, cache);

  return {
    judgements,
    called: Object.keys(cache).length - before,
    /** Verdicts still to buy. Zero means a run would cost nothing. */
    pending: judgements.reduce(
      (n, j) => n + (criteria.length - j.verdicts.length),
      0
    ),
  };
}
