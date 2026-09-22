import { NextResponse } from "next/server";
import { readMatchSet, writeMatchSet } from "@/lib/matching";
import type { MatchCriterion } from "@/lib/matching";

export const runtime = "nodejs";

/**
 * The requirements a hire's shortlist is judged against.
 *
 *   GET  /api/matching?searchId=5ddc6575
 *   POST /api/matching   { searchId, criteria?, context? }
 *
 * Editing is free and reversible. What it does cost is verdicts:
 * changing a requirement's text invalidates every judgement made
 * against it, because the cache is keyed on that text.
 */
export async function GET(req: Request) {
  const searchId = new URL(req.url).searchParams.get("searchId") ?? "";
  if (!searchId) {
    return NextResponse.json({ error: "Pass a searchId." }, { status: 400 });
  }
  return NextResponse.json({ matchSet: await readMatchSet(searchId) });
}

export async function POST(req: Request) {
  let body: {
    searchId?: string;
    criteria?: MatchCriterion[];
    context?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!body.searchId) {
    return NextResponse.json({ error: "Pass a searchId." }, { status: 400 });
  }

  // A requirement with no text cannot be judged, so it is dropped
  // rather than stored as an empty row that always returns absent.
  const criteria = body.criteria?.filter((c) => c.label.trim().length > 0);

  return NextResponse.json({
    matchSet: await writeMatchSet(body.searchId, {
      criteria,
      context: body.context,
    }),
  });
}
