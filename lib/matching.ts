import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readSearch } from "./search";
import type { Criterion } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data", "matching");

/**
 * The requirements a shortlist is judged against.
 *
 * Kept apart from the brief on purpose. A saved search is a record of
 * what actually ran, and its filter criteria shaped the Crustdata
 * query, so editing those would describe a search that never happened.
 * Judge criteria never touched the query: they were carried forward
 * unanswered because there was not enough of a profile to answer them.
 * Those are the ones worth editing, and they get their own file.
 *
 * Seeded from the brief the first time this is opened, then owned here.
 *
 * Deliberately just text and a kind. An earlier version carried a
 * weight and a separate list of acceptable answers; both were
 * machinery around something a sentence already expresses. "Familiarity
 * with process notations such as BPMN or UML" states its own
 * alternatives, and a model reading it does not need them enumerated
 * in a second field.
 */

export interface MatchCriterion {
  id: string;
  /** How the requirement reads. This is the text the model judges. */
  label: string;
  kind: "must" | "nice";
  /** Whether this came from the job ad or was typed in afterwards. */
  origin: "brief" | "manual";
}

export interface MatchSet {
  searchId: string;
  criteria: MatchCriterion[];
  /**
   * Background about the role and team, passed to the model as context.
   *
   * Never as a requirement. "A ten-person team, this person owns the
   * frontend alone" genuinely helps judge whether someone is used to
   * working without support. A requirement typed in here instead of as
   * a criterion would bias every verdict invisibly rather than
   * appearing as its own row with its own answer.
   */
  context: string;
  updatedAt: string;
}

function fileFor(searchId: string): string {
  return path.join(DATA_DIR, `${searchId}.json`);
}

function newId(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Turn a brief criterion into a judgeable requirement.
 *
 * The brief keeps named skills and backgrounds in their own arrays,
 * because the query builder needed them separately. Here they are
 * folded into the sentence, since that is the form the model reads and
 * a person editing it can see the whole requirement in one line.
 */
function fromBrief(c: Criterion): MatchCriterion {
  const alternatives = [
    ...(c.skills ?? []).map((s) => s.label),
    ...(c.backgrounds ?? []),
  ].filter(Boolean);

  const lower = c.label.toLowerCase();
  const missing = alternatives.filter((a) => !lower.includes(a.toLowerCase()));

  return {
    id: c.id,
    label: missing.length > 0 ? `${c.label} (${missing.join(", ")})` : c.label,
    kind: c.kind,
    origin: "brief",
  };
}

/**
 * The requirements for a hire, seeding from the brief on first read.
 *
 * Everything except must-haves that became query conditions. Those
 * were enforced by the search, so everyone in the pool passed them and
 * offering them as open questions would invite re-checking what the
 * query guaranteed.
 *
 * Nice-to-haves are seeded whatever their `check` value. A nice-to-have
 * may well be expressible as a filter, but it never gated anything:
 * nice criteria only add score. Dropping them as "already guaranteed"
 * silently loses half the brief.
 */
export async function readMatchSet(searchId: string): Promise<MatchSet> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(fileFor(searchId), "utf8")
    ) as Partial<MatchSet>;
    return {
      searchId,
      criteria: (parsed.criteria ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        kind: c.kind,
        origin: c.origin ?? "manual",
      })),
      context: parsed.context ?? "",
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    const search = await readSearch(searchId);
    const seeded = (search?.brief?.criteria ?? [])
      .filter((c) => c.selected)
      .filter((c) => !(c.kind === "must" && c.check === "filter"))
      .map(fromBrief);
    return { searchId, criteria: seeded, context: "", updatedAt: "" };
  }
}

export async function writeMatchSet(
  searchId: string,
  patch: { criteria?: MatchCriterion[]; context?: string }
): Promise<MatchSet> {
  const current = await readMatchSet(searchId);
  const next: MatchSet = {
    searchId,
    criteria: (patch.criteria ?? current.criteria).map((c) => ({
      id: c.id || newId(),
      label: c.label.trim(),
      kind: c.kind === "nice" ? "nice" : "must",
      origin: c.origin ?? "manual",
    })),
    context: (patch.context ?? current.context).trim(),
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fileFor(searchId), JSON.stringify(next, null, 2), "utf8");
  return next;
}
