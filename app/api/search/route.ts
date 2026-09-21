import { NextResponse } from "next/server";
import { toCandidate } from "@/lib/candidates";
import { summariseCoverage } from "@/lib/coverage";
import { DEFAULT_FETCH_LIMIT, runSearch } from "@/lib/search";
import type { RoleBrief } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let brief: RoleBrief | undefined;
  let limit = DEFAULT_FETCH_LIMIT;

  try {
    const body = (await req.json()) as { brief?: RoleBrief; limit?: unknown };
    brief = body.brief;
    const asked = Number(body.limit);
    // 1000 is Crustdata's own per-page maximum. Anything larger needs
    // cursor pagination, which this does not do yet.
    if (Number.isFinite(asked) && asked >= 1 && asked <= 1000) {
      limit = Math.round(asked);
    }
  } catch {
    brief = undefined;
  }

  if (!brief) {
    return NextResponse.json({ error: "No role brief in the request." }, { status: 400 });
  }

  try {
    const search = await runSearch(brief, limit);
    return NextResponse.json({
      id: search.id,
      total: search.total,
      fetched: search.fetched,
      creditsUsed: search.creditsUsed,
      hasMore: Boolean(search.nextCursor),
      remarks: search.remarks,
      // What was asked for, so the UI can tell "nobody has one" apart from
      // "the account was denied this field and the retry dropped it".
      fieldsUsed: search.query.fields,
      coverage: summariseCoverage(search.profiles),
      candidates: search.profiles.map((p) => toCandidate(p, brief as RoleBrief)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The search failed." },
      { status: 502 }
    );
  }
}
