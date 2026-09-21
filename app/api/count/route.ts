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

  const base = brief;
  const gates = gatingCriteria(base);

  try {
    /**
     * Two numbers per criterion, because they answer different questions
     * and each has caught a different bug.
     *
     *   reach - the criterion on its own against the title, location and
     *           experience filters. Catches a criterion that matches nobody
     *           ("AI/ML systems", 0) or nearly everybody (a background that
     *           repeats the searched title, 1,567 of 2,030).
     *
     *   adds  - how many people it brings that no other must-have already
     *           covers, measured as the whole query minus the whole query
     *           without it. Catches a criterion with a healthy reach that
     *           overlaps another entirely, which is invisible inside an
     *           `or` and costs a slot in the shortlist for nothing.
     *
     * 2N+1 counts at 0.03 each, so four criteria is 0.27 credits.
     */
    const [whole, ...rest] = await Promise.all([
      count(base, apiKey),
      ...gates.map((c) => count({ ...base, criteria: [c] }, apiKey)),
      ...gates.map((c) =>
        count({ ...base, criteria: gates.filter((g) => g.id !== c.id) }, apiKey)
      ),
    ]);

    if (whole.error) {
      return NextResponse.json(
        { error: whole.error, creditsUsed: whole.credits },
        { status: 502 }
      );
    }

    const alone = rest.slice(0, gates.length);
    const without = rest.slice(gates.length);

    const breakdown = gates.map((c, i) => ({
      id: c.id,
      label: c.label,
      reach: alone[i]?.total ?? null,
      // The pool with this criterion removed. Under `any` the difference is
      // what the criterion adds; under `all` it is what the criterion
      // costs. The sign flips with the mode, so the raw number travels and
      // the UI does the labelling.
      withoutTotal: without[i]?.total ?? null,
    }));

    const creditsUsed = [whole, ...rest].reduce((sum, r) => sum + r.credits, 0);

    return NextResponse.json({
      total: whole.total,
      relation: whole.relation,
      remarks: whole.remarks,
      breakdown,
      creditsUsed: Number(creditsUsed.toFixed(2)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The count request failed." },
      { status: 502 }
    );
  }
}
