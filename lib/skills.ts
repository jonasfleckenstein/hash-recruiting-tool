import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CACHE_ENABLED, HAIKU, askForJson } from "./anthropic";
import { AUTOCOMPLETE_FIELD, crustdataAutocomplete } from "./crustdata-autocomplete";
import type { SkillKind, SkillMatch } from "./types";

/**
 * What counts as a skill here.
 *
 * A skill is a named technology or technical specialism: something that
 * appears on a CV as a noun and that two people would agree on. "C++" is a
 * skill. "Communication" is a trait, and treating it as one produces a filter
 * that matches everyone and discriminates nobody.
 *
 * Two layers keep traits out, because either alone is porous:
 *
 *  1. The suggestion prompt is told the rule and the kinds below.
 *  2. Everything is checked against the list here before it can become a
 *     filter. The index is no help for this: "Communication" is one of the
 *     most common values in it, so validating against Crustdata proves a
 *     skill exists, not that it is worth filtering on.
 */
export const SKILL_KINDS: Record<SkillKind, string> = {
  language: "a programming language (Rust, TypeScript, C++)",
  framework: "a library or framework (React, Django, PyTorch)",
  tool: "a tool or system operated directly (Kubernetes, Terraform, PostgreSQL)",
  platform: "a vendor platform or cloud (AWS, Salesforce, Snowflake)",
  domain: "a technical specialism with no vendor (distributed systems, compilers)",
};

/** True when the model's proposed kind is one of the five. */
export function isSkillKind(value: unknown): value is SkillKind {
  return typeof value === "string" && value in SKILL_KINDS;
}

/** Traits, not skills. These describe a person, not a technology. */
const TRAIT_PATTERNS = [
  /communicat/i,
  /leadership/i,
  /team\s?(work|player)/i,
  /collaborat/i,
  /problem[\s-]?solving/i,
  /critical thinking/i,
  /interpersonal/i,
  /time management/i,
  /work ethic/i,
  /attention to detail/i,
  /adaptab|flexib/i,
  /self[\s-]?start/i,
  /proactive|motivated|driven/i,
  /creativity/i,
  /ownership/i,
  /mentoring|coaching/i,
  /stakeholder/i,
];

/**
 * Real technologies, but too broad to narrow a search. Filtering on
 * "Programming" for an engineering role removes nobody.
 */
const TOO_BROAD_PATTERNS = [
  /^programming$/i,
  /^coding$/i,
  /^software (development|engineering|design)$/i,
  /^web development$/i,
  /^computer science$/i,
  /^information technology$/i,
  /^microsoft office$/i,
  /^agile( methodologies)?$/i,
  /^scrum$/i,
  /^project management$/i,
  /^technology$/i,
  /^engineering$/i,
];

export interface SkillRejection {
  ok: false;
  reason: "trait" | "too_broad";
}

export function classifySkillLabel(label: string): { ok: true } | SkillRejection {
  const value = label.trim();
  if (TRAIT_PATTERNS.some((p) => p.test(value))) return { ok: false, reason: "trait" };
  if (TOO_BROAD_PATTERNS.some((p) => p.test(value))) {
    return { ok: false, reason: "too_broad" };
  }
  return { ok: true };
}

/** Case and punctuation insensitive comparison, for the exact-match floor. */
function normalizeSkill(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "skills");
const CACHE_VERSION = "v1";

/**
 * How many indexed values to consider. Autocomplete matches loosely, so a
 * short query returns a long tail; 40 is deep enough to reach the qualified
 * forms ("Python (Programming Language)") without pulling in noise that the
 * selection step then has to reject.
 */
const CANDIDATE_LIMIT = 40;

const SELECT_SYSTEM = `You are given one skill and a list of values taken from a skills index, ranked by how many people carry them. Return the values that mean the same skill.

The test: include a value if anyone who lists it necessarily has the skill in question.

Include, for the skill "Python": "Python (Programming Language)", "python", "Python3", "Advanced Python", "Python for Data Science". Each of them cannot be held by someone who does not know Python.

Include a different name for the same thing: "Golang" for "Go", "Postgres" for "PostgreSQL", "K8s" for "Kubernetes".

Exclude anything that merely shares letters or words. For "Java", exclude "JavaScript": they are different languages. For "Go", exclude "Go To Market Strategy" and "Google Ads". For "Rust", exclude "Rust Removal" and "Rust Prevention". For "R", exclude every value where R is part of another word.

Exclude a value that is a related but separate skill someone could hold without the skill in question. For "PostgreSQL", exclude "MySQL". For "React", exclude "React Native" only if it can genuinely be held alone; if in doubt, exclude.

Only ever return values from the list, exactly as written, with their original casing and punctuation. Never invent a value and never correct one, however malformed it looks.

Output only a JSON object, no prose and no code fences:
{"same": [string]}`;

function cacheKey(label: string, candidates: string[]): string {
  return crypto
    .createHash("sha1")
    .update(`${CACHE_VERSION}|${label.trim().toLowerCase()}|${candidates.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

async function readCache(key: string): Promise<string[] | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, values: string[]): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(values), "utf8");
  } catch {
    // A failed cache write is not worth failing the lookup over.
  }
}

/** Ask which of the indexed values denote the same skill. Returns [] on any
 *  failure, which leaves the exact-match floor in place. */
async function selectSameSkill(label: string, candidates: string[]): Promise<string[]> {
  try {
    const raw = (await askForJson({
      model: HAIKU,
      system: SELECT_SYSTEM,
      user: `Skill: ${label.trim()}\n\nValues:\n${candidates.map((v) => `- ${v}`).join("\n")}`,
      maxTokens: 800,
    })) as { same?: unknown };

    if (!Array.isArray(raw.same)) return [];

    // Intersect with the candidate list, so a hallucinated value can never
    // reach a filter.
    const allowed = new Set(candidates);
    return raw.same.filter((v): v is string => typeof v === "string" && allowed.has(v));
  } catch {
    return [];
  }
}

/**
 * Resolve a skill to the set of indexed values a search should match.
 *
 * The index proposes and a model disposes. Autocomplete supplies the
 * candidates, so nothing can be searched that does not exist; the model
 * decides which of them mean the same skill, because that judgement is
 * semantic and string matching gets it wrong in both directions. An earlier
 * version compared normalized strings and silently dropped "Python
 * (Programming Language)", which is LinkedIn's canonical entity for Python
 * and carries a third of the people who have the skill.
 *
 * Exact matches are always kept regardless of what the model says, so a
 * failed or missing Anthropic key degrades to the old behaviour rather than
 * to nothing. Results are cached on disk against the candidate list.
 */
export async function verifySkill(label: string): Promise<SkillMatch> {
  const trimmed = label.trim();
  const candidates = await crustdataAutocomplete(AUTOCOMPLETE_FIELD.skill, trimmed, {
    limit: CANDIDATE_LIMIT,
  });

  if (candidates === null) {
    // No Crustdata key, or the lookup failed. Use the label as written
    // rather than claiming it was checked.
    return { label: trimmed, indexed: [trimmed], status: "unchecked" };
  }
  if (candidates.length === 0) {
    return { label: trimmed, indexed: [], status: "absent" };
  }

  const wanted = normalizeSkill(trimmed);
  const exact = candidates.filter((v) => normalizeSkill(v) === wanted);

  const key = cacheKey(trimmed, candidates);
  let chosen = CACHE_ENABLED ? await readCache(key) : null;
  if (chosen === null) {
    chosen = await selectSameSkill(trimmed, candidates);
    if (CACHE_ENABLED) await writeCache(key, chosen);
  }

  const indexed = Array.from(new Set([...exact, ...chosen]));

  return indexed.length > 0
    ? { label: trimmed, indexed, status: "confirmed" }
    : { label: trimmed, indexed: [], status: "absent" };
}
