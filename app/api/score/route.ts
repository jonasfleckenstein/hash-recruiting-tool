import { NextResponse } from "next/server";
import { readSearch } from "@/lib/search";
import { scoreSearch } from "@/lib/scoring";
import type { RoleBrief, ScoringWeights } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Rank a saved search.
 *
 * Reads profiles from disk and costs nothing, which is the point: the
 * weights can be dragged around and the list rebuilt as often as you like
 * without re-buying the pool. The brief stored alongside the search is
 * used unless the caller overrides the parts that affect scoring.
 */
export async function POST(req: Request) {
  let body: {
    id?: string;
    cut?: number;
    weights?: Partial<ScoringWeights>;
    experienceBand?: string | null;
    disciplineTerms?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "No search id given." }, { status: 400 });
  }

  const search = await readSearch(body.id);
  if (!search) {
    return NextResponse.json(
      { error: `No saved search with id ${body.id}.` },
      { status: 404 }
    );
  }

  /**
   * Searches saved before experience became a scored band carry `minYears`
   * instead. Reading it as the nearest band keeps those pools rankable
   * rather than silently falling back to a pool-derived guess.
   */
  const legacyBand = (() => {
    const m = search.brief.minYears;
    if (m === null || m === undefined) return null;
    return m < 2 ? "0-2" : m < 5 ? "2-5" : m < 10 ? "5-10" : "10+";
  })();

  // Overrides let the shortlist page re-score without touching the stored
  // brief, so the saved search stays a record of what was actually bought.
  const brief: RoleBrief = {
    ...search.brief,
    experienceBand: search.brief.experienceBand ?? legacyBand,
    ...(body.experienceBand !== undefined
      ? { experienceBand: body.experienceBand }
      : {}),
    ...(body.disciplineTerms ? { disciplineTerms: body.disciplineTerms } : {}),
    weights: {
      ...(search.brief.weights ?? {}),
      ...(body.weights ?? {}),
    } as ScoringWeights,
  };

  const cut = Math.min(50, Math.max(5, Math.round(body.cut ?? 20)));
  const run = scoreSearch(search.profiles, brief, cut);

  return NextResponse.json({
    id: search.id,
    title: search.brief.title,
    fetchedAt: search.fetchedAt,
    total: search.total,
    fetched: search.fetched,
    gateMode: search.brief.gateMode,
    experienceBand: brief.experienceBand ?? null,
    run,
  });
}
