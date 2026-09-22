import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), ".data", "decisions.json");

/**
 * What was decided about a person, across every hire.
 *
 * One global file rather than one per hire, and keyed by the Crustdata
 * id rather than the internal one. Two reasons, and both are about
 * when a decision gets made.
 *
 * Rejection happens on the search results page, before anyone has been
 * enriched, so there is no internal id yet: those are minted when a
 * profile is bought. The Crustdata id is the only identifier available
 * at every stage from search through outreach.
 *
 * And a decision outlives the hire that produced it. Someone turned
 * down for a frontend role in September should still be marked when
 * they surface in a full-stack search in November, and someone already
 * written to should never be written to twice. Per-hire files would
 * make that a scan; one keyed file makes it a lookup.
 */

/**
 * Where a person stands in one hire.
 *
 *  held      good, but not for this role or not now. The state that
 *            earns its place: without it the second-best candidate
 *            either stays on the list forever or gets rejected.
 *  rejected  no.
 *  contacted written to.
 *
 * Shortlisted is not here. That is the tick on the matching page,
 * which is a list rather than a judgement, and a person can be on it
 * and held at the same time while someone decides.
 */
export type DecisionState = "held" | "rejected" | "contacted";

export interface Decision {
  hireId: string;
  /** Named so an old decision still reads sensibly: "rejected for
   *  Senior Frontend Engineer" says more than a search id. */
  roleTitle: string;
  state: DecisionState;
  at: string;
  /** Present once the person has been enriched. Not required. */
  internalId?: string;
}

/** Crustdata id as a string, to the decisions made about that person. */
export type DecisionsByPerson = Record<string, Decision[]>;

export async function readDecisions(): Promise<DecisionsByPerson> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function write(all: DecisionsByPerson): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
  } catch {
    // A lost decision costs a second look, not the work behind it.
  }
}

/**
 * Record or clear a decision for one person in one hire.
 *
 * Passing null clears it, which is how a rejection is undone. A
 * decision in another hire is never touched: those belong to that
 * hire and to whoever made them.
 */
export async function setDecision(
  crustdataPersonId: number,
  hireId: string,
  decision: { state: DecisionState; roleTitle: string; internalId?: string } | null
): Promise<Decision[]> {
  const all = await readDecisions();
  const key = String(crustdataPersonId);
  const others = (all[key] ?? []).filter((d) => d.hireId !== hireId);

  const next = decision
    ? [...others, { ...decision, hireId, at: new Date().toISOString() }]
    : others;

  if (next.length > 0) all[key] = next;
  else delete all[key];

  await write(all);
  return next;
}

/** Just this hire's decisions, as a lookup the UI can grey rows with. */
export function forHire(
  all: DecisionsByPerson,
  hireId: string
): Record<string, DecisionState> {
  const out: Record<string, DecisionState> = {};
  for (const [key, list] of Object.entries(all)) {
    const here = list.find((d) => d.hireId === hireId);
    if (here) out[key] = here.state;
  }
  return out;
}

/**
 * Decisions from other hires.
 *
 * The reason the store is global. Someone already written to for
 * another role should be visible as such the moment they appear in a
 * new search, long before anyone spends a credit on them.
 */
export function elsewhere(
  all: DecisionsByPerson,
  hireId: string
): Record<string, Decision[]> {
  const out: Record<string, Decision[]> = {};
  for (const [key, list] of Object.entries(all)) {
    const other = list.filter((d) => d.hireId !== hireId);
    if (other.length > 0) out[key] = other;
  }
  return out;
}
