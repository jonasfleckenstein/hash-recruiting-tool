import { NextResponse } from "next/server";
import { getSuggestions } from "@/lib/suggest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { title?: unknown; jd?: unknown; force?: unknown };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const jd = typeof body.jd === "string" ? body.jd : "";
  const force = body.force === true;

  if (title.length < 2 && jd.trim().length === 0) {
    return NextResponse.json(
      { error: "Give either a role title or the job ad." },
      { status: 400 }
    );
  }

  try {
    const result = await getSuggestions(title, jd, force);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Suggestion request failed." },
      { status: 502 }
    );
  }
}
