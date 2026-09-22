import { NextResponse } from "next/server";
import {
  generateDraft,
  readDrafts,
  readSelection,
  readSender,
  saveDraft,
  writeSelection,
  writeSender,
} from "@/lib/outreach";
import { readPerson } from "@/lib/people";
import { readSearch } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Outreach drafts, one person at a time.
 *
 *   GET  /api/outreach?searchId=X            drafts and the outreach list
 *   PUT  /api/outreach { searchId, selection }  set the outreach list
 *   POST /api/outreach { searchId, internalId, note }
 *
 * Generating is always explicit. A draft is the one thing here that
 * gets sent to a human being, so it should never appear because a page
 * loaded.
 */
export async function GET(req: Request) {
  const searchId = new URL(req.url).searchParams.get("searchId") ?? "";
  if (!searchId) {
    return NextResponse.json({ error: "Pass a searchId." }, { status: 400 });
  }
  const [drafts, selection, sender] = await Promise.all([
    readDrafts(searchId),
    readSelection(searchId),
    readSender(),
  ]);
  return NextResponse.json({ drafts, selection, sender });
}

/** Set the outreach list, the sender, or both. The list is sent whole
 *  each time, so unticking removes. */
export async function PUT(req: Request) {
  let body: {
    searchId?: string;
    selection?: string[];
    sender?: { name: string; role: string };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const out: Record<string, unknown> = {};
  if (body.sender) out.sender = await writeSender(body.sender);
  if (body.selection) {
    if (!body.searchId) {
      return NextResponse.json(
        { error: "Pass a searchId with a selection." },
        { status: 400 }
      );
    }
    out.selection = await writeSelection(body.searchId, body.selection);
  }
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  let body: {
    searchId?: string;
    internalId?: string;
    note?: string;
    sender?: { name: string; role: string };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { searchId, internalId } = body;
  if (!searchId || !internalId) {
    return NextResponse.json(
      { error: "Pass a searchId and an internalId." },
      { status: 400 }
    );
  }

  const [person, search] = await Promise.all([
    readPerson(internalId),
    readSearch(searchId),
  ]);
  if (!person) {
    return NextResponse.json({ error: "No such person." }, { status: 404 });
  }

  try {
    // Remember who is writing, so it only has to be typed once.
    const sender = body.sender
      ? await writeSender(body.sender)
      : await readSender();

    const draft = await generateDraft({
      searchId,
      person,
      roleTitle: search?.brief?.title ?? "an engineering role",
      note: body.note ?? "",
      sender,
    });
    await saveDraft(searchId, draft);
    return NextResponse.json({ draft });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not write a draft." },
      { status: 502 }
    );
  }
}
