import { NextResponse } from "next/server";
import {
  CRUSTDATA_API_VERSION,
  CRUSTDATA_ENDPOINT,
  buildCrustdataQuery,
  gatingCriteria,
} from "@/lib/crustdata";
import type { RoleBrief } from "@/lib/types";

export const runtime = "nodejs";

interface CountResult {
  total: number | null;
  relation: string | null;
  remarks: { message?: string; hint?: string }[];
  credits: number;
  error?: string;
}

/**
 * One count. `limit: 1` is the cheapest person search allows: job and
 * social-post search accept `limit: 0` for a free count, but the
 * person-search schema sets a minimum of 1, so one profile comes back and
 * the charge is 0.03 credits. A search matching nobody is free.
 */
async function count(brief: RoleBrief, apiKey: string): Promise<CountResult> {
  const res = await fetch(CRUSTDATA_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-api-version": CRUSTDATA_API_VERSION,
    },
    body: JSON.stringify(buildCrustdataQuery(brief, 1)),
  });

  const credits = Number(res.headers.get("x-credits-used") ?? 0) || 0;
  const data = (await res.json()) as {
    total_count?: number | null;
    total_count_relation?: string | null;
    remarks?: { message?: string; hint?: string }[];
    error?: { message?: string };
  };

  if (!res.ok) {
    return {
      total: null,
      relation: null,
      remarks: [],
      credits,
      error: data.error?.message ?? `Crustdata returned ${res.status}.`,
    };
  }

  return {
    // Documented as nullable: a very broad query can decline to compute an
    // exact total, so the UI must not assume a number.
    total: data.total_count ?? null,
    relation: data.total_count_relation ?? null,
    remarks: Array.isArray(data.remarks) ? data.remarks : [],
    credits,
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.CRUSTDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CRUSTDATA_API_KEY is not set, so nothing can be counted yet." },
      { status: 400 }
    );
  }

  let brief: RoleBrief | undefined;
  try {
    brief = ((await req.json()) as { brief?: RoleBrief }).brief;
  } catch {
    brief = undefined;
  }
  if (!brief) {
    return NextResponse.json({ error: "No role brief in the request." }, { status: 400 });
  }

  const gates = gatingCriteria(brief);

  try {
    /**
     * The whole query, plus each gating must-have measured on its own
     * against the same title, location and experience filters.
     *
     * This is the only way to see a dud criterion. Inside an `or` a
     * criterion that reaches nobody is invisible, and `explain` will not
     * help either: it probes the top-level `and` one condition at a time and
     * never opens a nested group. So a skill that matches zero people looks
     * identical to one carrying the search, until it is the last must-have
     * standing and the whole thing returns nothing.
     */
    const [whole, ...perGate] = await Promise.all([
      count(brief, apiKey),
      ...gates.map((c) =>
        count({ ...brief, criteria: [c] }, apiKey).then((r) => ({
          id: c.id,
          label: c.label,
          total: r.total,
        }))
      ),
    ]);

    if (whole.error) {
      return NextResponse.json(
        { error: whole.error, creditsUsed: whole.credits },
        { status: 502 }
      );
    }

    const creditsUsed = whole.credits + gates.length * 0.03;

    return NextResponse.json({
      total: whole.total,
      relation: whole.relation,
      remarks: whole.remarks,
      breakdown: perGate,
      creditsUsed: Number(creditsUsed.toFixed(2)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The count request failed." },
      { status: 502 }
    );
  }
}
