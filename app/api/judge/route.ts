import { NextResponse } from "next/server";
import { judgeCohort } from "@/lib/judge";
import { readMatchSet } from "@/lib/matching";
import { readPerson } from "@/lib/people";
import { readShortlist } from "@/lib/shortlists";

export const runtime = "nodejs";
/** Judging fifty people is a minute of model calls, well past the
 *  default serverless ceiling. */
export const maxDuration = 300;

/**
 * Judge a shortlist against the hire's requirements.
 *
 *   GET  /api/judge?searchId=X&list=S2   read what has already been judged
 *   POST /api/judge  { searchId, list? } judge anything not yet cached
 *
 * Verdicts are cached on the requirement's wording, the candidate's
 * text, the context note, the prompt version and the model. So rerunning
 * costs nothing, adding a person costs that person, and editing one
 * requirement costs that requirement across the shortlist. Nothing else
 * is recomputed, and no two verdicts in a grid can come from different
 * prompts.
 */
async function load(searchId: string, list: string | null) {
  const [matchSet, shortlist] = await Promise.all([
    readMatchSet(searchId),
    readShortlist(searchId, list),
  ]);
  const people = (
    await Promise.all((shortlist?.internalIds ?? []).map((id) => readPerson(id)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);
  return { matchSet, shortlist, people };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId") ?? "";
  if (!searchId) {
    return NextResponse.json({ error: "Pass a searchId." }, { status: 400 });
  }

  const { matchSet, people } = await load(searchId, url.searchParams.get("list"));

  /** Cache only, so opening the page never spends anything. */
  const { judgements, pending } = await judgeCohort(
    searchId,
    people,
    matchSet.criteria,
    matchSet.context,
    true
  );

  return NextResponse.json({
    searchId,
    candidates: people.length,
    criteria: matchSet.criteria.length,
    pending,
    judgements,
  });
}

export async function POST(req: Request) {
  let body: { searchId?: string; list?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const searchId = body.searchId ?? "";
  if (!searchId) {
    return NextResponse.json({ error: "Pass a searchId." }, { status: 400 });
  }

  const { matchSet, people } = await load(searchId, body.list ?? null);

  if (matchSet.criteria.length === 0) {
    return NextResponse.json(
      { error: "No requirements to judge against." },
      { status: 400 }
    );
  }
  if (people.length === 0) {
    return NextResponse.json(
      { error: "No candidates on this shortlist." },
      { status: 400 }
    );
  }

  try {
    const { judgements, called } = await judgeCohort(
      searchId,
      people,
      matchSet.criteria,
      matchSet.context
    );
    return NextResponse.json({
      judgements,
      /** New verdicts written this run. Zero means everything was
       *  already cached and nothing was spent. */
      called,
      failed: judgements.filter((j) => j.error).length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Judging failed." },
      { status: 502 }
    );
  }
}
