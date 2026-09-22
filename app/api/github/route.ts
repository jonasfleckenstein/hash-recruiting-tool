import { NextResponse } from "next/server";
import { readEnrichment } from "@/lib/enrich";
import type { EnrichmentCohort } from "@/lib/enrich";
import { fetchCohort, summariseGithub, targetsFromEnrichment } from "@/lib/github";
import type { GithubTarget } from "@/lib/github";
import { attachGithub, findInternalId } from "@/lib/people";

export const runtime = "nodejs";

/**
 * Read GitHub evidence for an already-enriched cohort.
 *
 * Deliberately a separate step from /api/enrich. Enrichment costs credits
 * and is irreversible; this is free and can be rerun freely, so coupling
 * them would make a cheap call inherit an expensive one's caution. It also
 * means the GitHub layer can be rebuilt against enrichment files that were
 * paid for days ago.
 *
 * Profiles without a handle are counted and otherwise left alone. There
 * was a resolver here that tried to find handles by name and confirm them
 * against a declared LinkedIn URL; it was removed after returning zero
 * matches across twenty attempts. Only two of twenty-one accounts that DO
 * have handles declare a LinkedIn URL at all, so the verification path it
 * depended on has a ceiling of roughly one person in ten. Absent a
 * handle, "unknown" is the honest answer and the cheap one.
 *
 *   GET /api/github?searchId=5ddc6575
 *   GET /api/github?searchId=5ddc6575&cohort=control
 *   GET /api/github?logins=thelartians,atilafassina   (ad hoc)
 *   &force=1   bypass the on-disk cache
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId") ?? "";
  const cohort: EnrichmentCohort =
    url.searchParams.get("cohort") === "control" ? "control" : "shortlist";
  const logins = url.searchParams.get("logins");
  const force = url.searchParams.get("force") === "1";

  let withHandle: GithubTarget[] = [];
  let withoutHandle: GithubTarget[] = [];

  if (logins) {
    withHandle = logins
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((login) => ({
        crustdataPersonId: null,
        name: login,
        login,
        employers: [],
        websites: [],
      }));
  } else {
    if (!searchId) {
      return NextResponse.json(
        { error: "Pass searchId, or logins for an ad hoc read." },
        { status: 400 }
      );
    }
    const enrichment = await readEnrichment(searchId, cohort);
    if (!enrichment) {
      return NextResponse.json(
        { error: "No enrichment on disk for that searchId and cohort." },
        { status: 404 }
      );
    }
    ({ withHandle, withoutHandle } = targetsFromEnrichment(enrichment));
  }

  try {
    const { rate, evidence } = await fetchCohort(withHandle, force);

    /**
     * Persist evidence against the person, not just the search.
     *
     * GitHub is free, so there is no saving to be had here. The reason
     * is that everything after enrichment addresses people by internal
     * id, and evidence that only exists in a response body cannot be
     * read by a card, a score or an export.
     */
    let stored = 0;
    for (const row of evidence) {
      if (row.status !== "ok" || typeof row.crustdataPersonId !== "number") continue;
      const internalId = await findInternalId(row.crustdataPersonId);
      if (!internalId) continue;
      if (await attachGithub(internalId, row)) stored += 1;
    }

    return NextResponse.json({
      searchId: searchId || null,
      cohort: logins ? null : cohort,
      /**
       * Roughly half of any commercial engineering pool has no public
       * GitHub. That is a property of the pool, not a failure, and the
       * count belongs in the response so the scorer can mark those people
       * unknown rather than weak.
       */
      pool: {
        withHandle: withHandle.length,
        withoutHandle: withoutHandle.length,
        namesWithoutHandle: withoutHandle.map((t) => t.name),
      },
      stored,
      rate,
      coverage: summariseGithub(evidence),
      evidence,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The GitHub read failed." },
      { status: 502 }
    );
  }
}
