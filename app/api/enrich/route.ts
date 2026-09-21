import { NextResponse } from "next/server";
import { enrichProfiles } from "@/lib/enrich";
import { readSearch } from "@/lib/search";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let id = "";
  try {
    id = ((await req.json()) as { id?: string }).id ?? "";
  } catch {
    id = "";
  }

  const search = id ? await readSearch(id) : null;
  if (!search) {
    return NextResponse.json({ error: "No saved search with that id." }, { status: 404 });
  }

  const urls = Array.from(
    new Set(
      search.profiles
        .map((p) => p.social_handles?.professional_network_identifier?.profile_url)
        .filter((u): u is string => typeof u === "string" && u.length > 0)
    )
  );

  if (urls.length === 0) {
    return NextResponse.json(
      { error: "None of these profiles carry a profile URL to enrich against." },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ enrichment: await enrichProfiles(id, urls) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The enrichment failed." },
      { status: 502 }
    );
  }
}
