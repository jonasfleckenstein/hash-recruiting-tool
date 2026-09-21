import { NextResponse } from "next/server";
import { suggestLocations } from "@/lib/city";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let query = "";
  try {
    const body = (await req.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
  } catch {
    query = "";
  }

  if (query.length < 2) return NextResponse.json({ locations: [] });

  return NextResponse.json({ locations: await suggestLocations(query) });
}
