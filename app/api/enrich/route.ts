import { NextResponse } from "next/server";
import { enrichProfiles, readEnrichment } from "@/lib/enrich";
import type { EnrichedSelection } from "@/lib/enrich";
import { readSearch } from "@/lib/search";
import { scoreSearch } from "@/lib/scoring";
import type { RoleBrief, ScoringWeights } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Enrich a slice of a saved search, chosen by rank.
 *
 * Never the whole pool. Enrichment is 1 to 2 credits a head against 0.03
 * for the search itself, so a 164-profile pool would cost roughly 280
 * credits to enrich blind. The ranking exists precisely so that spend
 * lands on twenty people rather than all of them.
 *
 * The scoring is recomputed here from the same brief and overrides the
 * page used, so the ranks recorded against the enrichment are the ranks
 * the operator was actually looking at when they pressed the button.
 */
export async function POST(req: Request) {
  let body: {
    id?: string;
    /** How many from the top of the ranking, when no explicit set is given. */
    count?: number;
    /**
     * An explicit set of people to enrich, by Crustdata id.
     *
     * Takes precedence over `count`. The rank-based selection is a
     * convenience for the common case; this exists because the operator
     * often wants someone the current weights rank 40th, and making them
     * re-tune the weights to reach that person would be absurd.
     */
    crustdataPersonIds?: number[];
    weights?: Partial<ScoringWeights>;
    experienceBand?: string | null;
    /** Enrich again even if this search already has an enrichment file. */
    force?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const id = body.id ?? "";
  const count = Math.min(50, Math.max(1, Math.round(body.count ?? 20)));

  const search = id ? await readSearch(id) : null;
  if (!search) {
    return NextResponse.json({ error: "No saved search with that id." }, { status: 404 });
  }

  const brief: RoleBrief = {
    ...search.brief,
    ...(body.experienceBand !== undefined
      ? { experienceBand: body.experienceBand }
      : {}),
    weights: {
      ...(search.brief.weights ?? {}),
      ...(body.weights ?? {}),
    } as ScoringWeights,
  };

  const run = scoreSearch(search.profiles, brief, count);
  const urlByName = new Map<string, string>();
  for (const p of search.profiles) {
    const name = p.basic_profile?.name;
    const url = p.social_handles?.professional_network_identifier?.profile_url;
    if (name && url) urlByName.set(name, url);
  }

  const chosen = new Set(
    (body.crustdataPersonIds ?? []).map((v) => String(v))
  );
  const pool =
    chosen.size > 0
      ? run.rows.filter((r) => chosen.has(String(r.id)))
      : run.rows.slice(0, count);

  const selection: EnrichedSelection[] = pool
    .map((r) => ({
      url: r.linkedinUrl ?? urlByName.get(r.name) ?? "",
      name: r.name,
      rank: r.rank,
      score: r.score,
      /**
       * ScoreRow.id is the Crustdata person id as a string, so the
       * vendor key travels with the selection and the person store can
       * be consulted before anything is bought. Joining on the name
       * here would work until the first person whose name arrives
       * mis-encoded or duplicated.
       */
      crustdataPersonId: Number.isFinite(Number(r.id)) ? Number(r.id) : null,
    }))
    .filter((s) => s.url.length > 0);

  if (selection.length === 0) {
    return NextResponse.json(
      { error: "None of the selected profiles carry a profile URL to enrich against." },
      { status: 400 }
    );
  }

  /**
   * Re-running a rank-based enrichment is a straight double charge, and
   * the file on disk already holds the answer. An explicit selection is
   * different: the operator has named people, and the person store will
   * reuse anyone already known, so there is nothing to protect them from.
   */
  const existing = await readEnrichment(id);
  if (existing && chosen.size === 0 && !body.force) {
    return NextResponse.json({
      enrichment: existing,
      note: `Already enriched on ${existing.enrichedAt.slice(0, 16).replace("T", " ")}. Read from disk, nothing spent.`,
    });
  }

  try {
    const enrichment = await enrichProfiles(id, selection);
    return NextResponse.json({
      enrichment,
      /** Surfaced so the saving from the person store is visible rather
       *  than silently folded into a lower credit count. */
      spend: {
        bought: enrichment.records.length,
        reused: enrichment.reused.length,
        creditsUsed: enrichment.creditsUsed,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The enrichment failed." },
      { status: 502 }
    );
  }
}
