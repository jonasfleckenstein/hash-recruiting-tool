import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CRUSTDATA_API_VERSION,
  CRUSTDATA_ENDPOINT,
  DEFAULT_FETCH_LIMIT,
  buildCrustdataQuery,
} from "./crustdata";
import type { RawProfile } from "./candidates";
import type { CrustdataQuery } from "./crustdata";
import type { RoleBrief } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data", "searches");

export interface StoredSearch {
  id: string;
  fetchedAt: string;
  brief: RoleBrief;
  query: CrustdataQuery;
  /** Size of the whole matching pool, not of what was fetched. */
  total: number | null;
  fetched: number;
  creditsUsed: number;
  /** Cursor for the next page, when the pool is larger than the fetch. */
  nextCursor: string | null;
  /** Raw, so cards can be rebuilt without paying for the data again. */
  profiles: RawProfile[];
  remarks: { message?: string; hint?: string }[];
}

async function save(search: StoredSearch): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      path.join(DATA_DIR, `${search.id}.json`),
      JSON.stringify(search, null, 2),
      "utf8"
    );
  } catch {
    // Persisting is a convenience for later iteration, not part of the
    // result. A disk failure should not lose a search that was paid for.
  }
}

export async function readSearch(id: string): Promise<StoredSearch | null> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as StoredSearch;
  } catch {
    return null;
  }
}

export async function listSearches(): Promise<
  { id: string; fetchedAt: string; title: string; fetched: number }[]
> {
  try {
    const files = await fs.readdir(DATA_DIR);
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const s = await readSearch(f.replace(/\.json$/, ""));
          return s
            ? {
                id: s.id,
                fetchedAt: s.fetchedAt,
                title: s.brief.title,
                fetched: s.fetched,
              }
            : null;
        })
    );
    return entries
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  } catch {
    return [];
  }
}

async function post(query: unknown, apiKey: string) {
  const res = await fetch(CRUSTDATA_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-api-version": CRUSTDATA_API_VERSION,
    },
    body: JSON.stringify(query),
  });

  const credits = Number(res.headers.get("x-credits-used") ?? 0) || 0;
  const body = (await res.json()) as {
    profiles?: RawProfile[];
    next_cursor?: string | null;
    total_count?: number | null;
    remarks?: { message?: string; hint?: string }[];
    error?: {
      message?: string;
      metadata?: { permitted_fields?: string[]; denied_fields?: string[] }[];
    };
  };

  return { ok: res.ok, status: res.status, credits, body };
}

/** The fields this account is allowed, when a 403 names them. */
function permittedFields(body: {
  error?: { metadata?: { permitted_fields?: string[] }[] };
}): string[] | null {
  for (const entry of body.error?.metadata ?? []) {
    if (Array.isArray(entry?.permitted_fields) && entry.permitted_fields.length > 0) {
      return entry.permitted_fields;
    }
  }
  return null;
}

/**
 * Run the search and keep what comes back.
 *
 * The result is written to `.data/searches` before anything else happens
 * with it. Profiles cost money, and the scoring step will be rewritten many
 * times: fetching once and replaying from disk is what keeps that
 * iteration free.
 */
export async function runSearch(
  brief: RoleBrief,
  limit = DEFAULT_FETCH_LIMIT
): Promise<StoredSearch> {
  const apiKey = process.env.CRUSTDATA_API_KEY;
  if (!apiKey) throw new Error("CRUSTDATA_API_KEY is not set.");

  const query = buildCrustdataQuery(brief, limit);

  let result = await post(query, apiKey);
  let creditsUsed = result.credits;
  let used: CrustdataQuery = query;

  /**
   * Two parts of this request are the least certain, and both fail the
   * whole call rather than degrading. Error responses bill nothing, so a
   * retry costs only a round trip.
   *
   * Fields: `contact` is entitlement-gated and a denial rejects the entire
   * request. The 403 names the fields this account is allowed, so the
   * retry asks for exactly those.
   *
   * Sort: sorting on `assessment.authenticity.tier` is documented, but the
   * assessment fields are gated too. An unsorted page is worse than a
   * sorted one and far better than no page.
   */
  if (!result.ok && result.status === 403) {
    const allowed = permittedFields(result.body);
    if (allowed) {
      const narrowed: CrustdataQuery = { ...query, fields: allowed };
      const retry = await post(narrowed, apiKey);
      creditsUsed += retry.credits;
      if (retry.ok) {
        result = retry;
        used = narrowed;
      }
    }
  }

  if (!result.ok && (result.status === 400 || result.status === 403)) {
    const unsorted: CrustdataQuery = { ...used, sorts: [] };
    const retry = await post(unsorted, apiKey);
    creditsUsed += retry.credits;
    if (retry.ok) {
      result = retry;
      used = unsorted;
    }
  }

  if (!result.ok) {
    throw new Error(
      result.body.error?.message ?? `Crustdata returned ${result.status}.`
    );
  }

  const profiles = result.body.profiles ?? [];

  const search: StoredSearch = {
    id: crypto.randomUUID().slice(0, 8),
    fetchedAt: new Date().toISOString(),
    brief,
    query: used,
    total: result.body.total_count ?? null,
    fetched: profiles.length,
    creditsUsed: Number(creditsUsed.toFixed(2)),
    nextCursor: result.body.next_cursor ?? null,
    profiles,
    remarks: Array.isArray(result.body.remarks) ? result.body.remarks : [],
  };

  await save(search);
  return search;
}
