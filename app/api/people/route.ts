import { NextResponse } from "next/server";
import {
  importLegacyEnrichments,
  listPeople,
  planEnrichment,
  readPerson,
  readPersonByCrustdataId,
} from "@/lib/people";

export const runtime = "nodejs";

/**
 * The person store: who has already been paid for.
 *
 *   GET /api/people                  everyone, with age and freshness
 *   GET /api/people?id=P-00001       one person, in full
 *   GET /api/people?crustdataId=452  the same, by vendor id
 *   GET /api/people?plan=1,2,3       what each id would cost to enrich
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const crustdataId = url.searchParams.get("crustdataId");
  const plan = url.searchParams.get("plan");

  if (id) {
    const person = await readPerson(id);
    return person
      ? NextResponse.json({ person })
      : NextResponse.json({ error: "No person with that internal id." }, { status: 404 });
  }

  if (crustdataId) {
    const person = await readPersonByCrustdataId(Number(crustdataId));
    return person
      ? NextResponse.json({ person })
      : NextResponse.json({ error: "Not in the store." }, { status: 404 });
  }

  if (plan) {
    const ids = plan
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
    const plans = await planEnrichment(ids);
    return NextResponse.json({
      plans: plans.map((p) =>
        p.action === "new"
          ? p
          : {
              action: p.action,
              ageDays: p.ageDays,
              internalId: p.person.internalId,
              crustdataPersonId: p.person.crustdataPersonId,
              name: p.person.name,
            }
      ),
      /** What the operator is about to avoid paying for. */
      wouldReuse: plans.filter((p) => p.action === "reuse").length,
      wouldSpend: plans.filter((p) => p.action !== "reuse").length,
    });
  }

  const people = await listPeople();
  return NextResponse.json({
    total: people.length,
    fresh: people.filter((p) => p.fresh).length,
    withGithub: people.filter((p) => p.hasGithub).length,
    people,
  });
}

/**
 * One-time import of enrichments paid for before the store existed.
 *
 * Idempotent, and a POST rather than a GET because it writes. Original
 * enrichment dates are preserved, so anything already older than the
 * freshness window will correctly refresh on next use rather than being
 * passed off as current.
 *
 *   POST /api/people?migrate=1
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("migrate") !== "1") {
    return NextResponse.json(
      { error: "Pass ?migrate=1 to import legacy enrichments." },
      { status: 400 }
    );
  }
  const result = await importLegacyEnrichments();
  return NextResponse.json(result);
}
