import { NextResponse } from "next/server";
import { AUTOCOMPLETE_FIELD, crustdataAutocomplete } from "@/lib/crustdata-autocomplete";
import { localTitleMatches } from "@/lib/titles";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let query = "";
  try {
    const body = (await req.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
  } catch {
    query = "";
  }

  const values = await crustdataAutocomplete(AUTOCOMPLETE_FIELD.title, query, {
    limit: 10,
  });

  // null means the lookup could not run at all. An empty array means the
  // index genuinely has nothing, which is worth showing as-is rather than
  // papering over with a local list that would look authoritative.
  if (values === null) {
    return NextResponse.json({ source: "local", values: localTitleMatches(query) });
  }

  return NextResponse.json({ source: "crustdata", values });
}
