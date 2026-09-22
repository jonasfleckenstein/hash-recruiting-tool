import fs from "node:fs/promises";
import path from "node:path";
import { readEnrichment } from "./enrich";

const DATA_DIR = path.join(process.cwd(), ".data", "shortlists");

/**
 * Shortlists are versioned, not overwritten.
 *
 * One hire produces one search, but a search can produce several
 * shortlists: you enrich twenty, read the evidence, decide the weights
 * were wrong, and enrich a different fifteen. Keeping only the latest
 * would erase the fact that the first twenty were ever considered, and
 * that record is worth more later than it costs now. Someone asking "did
 * we look at her for the frontend role?" needs it, and so does anyone
 * trying to tell whether the ranking is improving.
 *
 * A shortlist holds internal ids, not profiles. The people themselves
 * live once in the person store; this is a pointer into it, so a list
 * stays correct when someone's enrichment is later refreshed.
 */

export interface Shortlist {
  /** Sequential within a hire: S1, S2. Short enough to say out loud. */
  id: string;
  createdAt: string;
  internalIds: string[];
  /** What this particular run cost, as opposed to the hire in total. */
  creditsUsed: number;
  bought: number;
  reused: number;
}

interface HireShortlists {
  searchId: string;
  lists: Shortlist[];
}

function fileFor(searchId: string): string {
  return path.join(DATA_DIR, `${searchId}.json`);
}

async function read(searchId: string): Promise<HireShortlists> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(fileFor(searchId), "utf8")
    ) as Partial<HireShortlists>;
    return { searchId, lists: parsed.lists ?? [] };
  } catch {
    return { searchId, lists: [] };
  }
}

async function write(data: HireShortlists): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(fileFor(data.searchId), JSON.stringify(data, null, 2), "utf8");
  } catch {
    // The person store already holds the people. Losing the grouping is
    // a inconvenience, not a loss of anything paid for.
  }
}

/**
 * Every shortlist for a hire, newest first.
 *
 * Falls back to synthesising one from the enrichment file when a hire
 * was enriched before shortlists existed, so old work still appears
 * rather than looking like it never happened.
 */
export async function listShortlists(searchId: string): Promise<Shortlist[]> {
  const stored = await read(searchId);
  if (stored.lists.length > 0) {
    return [...stored.lists].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const enrichment = await readEnrichment(searchId);
  if (!enrichment || (enrichment.internalIds ?? []).length === 0) return [];

  return [
    {
      id: "S1",
      createdAt: enrichment.enrichedAt,
      internalIds: enrichment.internalIds,
      creditsUsed: enrichment.creditsUsed ?? 0,
      bought: enrichment.records?.length ?? 0,
      reused: enrichment.reused?.length ?? 0,
    },
  ];
}

export async function latestShortlist(searchId: string): Promise<Shortlist | null> {
  return (await listShortlists(searchId))[0] ?? null;
}

export async function readShortlist(
  searchId: string,
  listId?: string | null
): Promise<Shortlist | null> {
  const lists = await listShortlists(searchId);
  if (!listId) return lists[0] ?? null;
  return lists.find((l) => l.id === listId) ?? lists[0] ?? null;
}

/** Record a new shortlist. Returns it, so the caller can navigate to it. */
export async function addShortlist(
  searchId: string,
  entry: Omit<Shortlist, "id" | "createdAt"> & { createdAt?: string }
): Promise<Shortlist> {
  const stored = await read(searchId);

  /**
   * Seed from the pre-shortlist enrichment file the first time, so the
   * work that came before is numbered S1 rather than being silently
   * replaced by this run.
   */
  if (stored.lists.length === 0) {
    const legacy = await listShortlists(searchId);
    stored.lists = legacy;
  }

  const next: Shortlist = {
    id: `S${stored.lists.length + 1}`,
    createdAt: entry.createdAt ?? new Date().toISOString(),
    internalIds: entry.internalIds,
    creditsUsed: entry.creditsUsed,
    bought: entry.bought,
    reused: entry.reused,
  };

  stored.lists.push(next);
  await write(stored);
  return next;
}
