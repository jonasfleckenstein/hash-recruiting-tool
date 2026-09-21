import { NextResponse } from "next/server";
import { readEnrichment } from "@/lib/enrich";
import { listSearches, readSearch } from "@/lib/search";

export const runtime = "nodejs";

/**
 * Without an id: every saved search, newest first.
 * With an id: that search, plus its enrichment when one exists.
 *
 * Everything here is read from disk. No credits are spent.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");

  if (!id) {
    return NextResponse.json({ searches: await listSearches() });
  }

  const search = await readSearch(id);
  if (!search) {
    return NextResponse.json({ error: "No saved search with that id." }, { status: 404 });
  }

  return NextResponse.json({
    search: {
      id: search.id,
      fetchedAt: search.fetchedAt,
      title: search.brief.title,
      total: search.total,
      fetched: search.fetched,
      creditsUsed: search.creditsUsed,
      profiles: search.profiles,
    },
    enrichment: await readEnrichment(id),
  });
}
