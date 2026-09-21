import { NextResponse } from "next/server";
import { AUTOCOMPLETE_FIELD, crustdataAutocomplete } from "@/lib/crustdata-autocomplete";
import { classifySkillLabel, verifySkill } from "@/lib/skills";

export const runtime = "nodejs";

/**
 * Two modes:
 *
 *   { query } -> { values }   type-ahead over skills in the index
 *   { skill } -> { match } | { rejected }
 *
 * The second mode applies the same trait check the suggestion pipeline uses,
 * so a skill typed by hand cannot get in through the side door. No kind is
 * asked for: the query treats every skill the same way.
 */
export async function POST(req: Request) {
  let body: { query?: unknown; skill?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ values: [] });
  }

  const skill = typeof body.skill === "string" ? body.skill.trim() : "";
  if (skill) {
    const verdict = classifySkillLabel(skill);
    if (!verdict.ok) {
      return NextResponse.json({
        rejected: verdict.reason,
        message:
          verdict.reason === "trait"
            ? "That is a trait, not a skill. Add it as a judged criterion instead."
            : "That is too broad to narrow a search. Name a specific technology.",
      });
    }

    return NextResponse.json({ match: await verifySkill(skill) });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2) return NextResponse.json({ values: [] });

  const values = await crustdataAutocomplete(AUTOCOMPLETE_FIELD.skill, query, {
    limit: 10,
  });

  return NextResponse.json({ values: values ?? [] });
}
