import { NextResponse } from "next/server";
import { elsewhere, forHire, readDecisions, setDecision } from "@/lib/decisions";
import type { DecisionState } from "@/lib/decisions";

export const runtime = "nodejs";

/**
 * Rejected, or written to, across every hire.
 *
 *   GET  /api/decisions?hireId=X
 *   POST /api/decisions { crustdataPersonId, hireId, roleTitle, state|null }
 *
 * A null state clears the decision for that hire, which is how a
 * rejection is undone. Decisions made in other hires are never
 * touched.
 */
export async function GET(req: Request) {
  const hireId = new URL(req.url).searchParams.get("hireId") ?? "";
  const all = await readDecisions();
  return NextResponse.json({
    here: forHire(all, hireId),
    elsewhere: elsewhere(all, hireId),
  });
}

export async function POST(req: Request) {
  let body: {
    crustdataPersonId?: number;
    hireId?: string;
    roleTitle?: string;
    state?: DecisionState | null;
    internalId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { crustdataPersonId, hireId } = body;
  if (typeof crustdataPersonId !== "number" || !hireId) {
    return NextResponse.json(
      { error: "Pass a crustdataPersonId and a hireId." },
      { status: 400 }
    );
  }

  await setDecision(
    crustdataPersonId,
    hireId,
    body.state
      ? {
          state: body.state,
          roleTitle: body.roleTitle ?? "a role",
          internalId: body.internalId,
        }
      : null
  );

  const all = await readDecisions();
  return NextResponse.json({
    here: forHire(all, hireId),
    elsewhere: elsewhere(all, hireId),
  });
}
