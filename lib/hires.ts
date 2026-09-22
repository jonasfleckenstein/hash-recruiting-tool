import { readEnrichment } from "./enrich";
import { listPeople } from "./people";
import { listSearches, readSearch } from "./search";

/**
 * A hire is a search.
 *
 * One hire, one search, by decision: the criteria that shaped the query
 * cannot be edited afterwards, because changing them would mean the
 * results no longer match the brief that produced them. Wanting different
 * criteria means starting a new hire, and the old one stays as a record
 * of what was asked and who it found.
 *
 * So this module adds no storage. It reads the searches already on disk
 * and presents them as hires, with enough status attached for a homepage
 * to show where each one got to.
 */

export type HireStage = "searched" | "enriched";

export interface HireSummary {
  id: string;
  title: string;
  /** "City, Country" for on-site roles, or the remote regions. */
  where: string;
  createdAt: string;
  /** Profiles the search returned and kept. */
  poolSize: number;
  /** Size of the whole matching pool, when the API reported one. */
  poolTotal: number | null;
  /** People enriched under this hire, by internal id. */
  enriched: number;
  /** Of those, how many carried GitHub evidence. */
  withGithub: number;
  /** Credits this hire has spent, across both cohorts. */
  creditsUsed: number;
  /** People this hire got for free because another hire had them. */
  reused: number;
  stage: HireStage;
}

function describeWhere(brief: {
  locationMode?: string;
  city?: string;
  regions?: string[];
}): string {
  if (brief.locationMode === "remote") {
    const regions = brief.regions ?? [];
    return regions.length > 0 ? `Remote, ${regions.join(", ")}` : "Remote";
  }
  return brief.city || "Location not set";
}

/**
 * Every hire, newest first.
 *
 * Reads each search file in full, which is how listSearches already
 * works. Fine at this scale (a handful of searches on one machine) and
 * the obvious thing to revisit if a hire list ever gets slow: the fix
 * would be a small index written at search time rather than deriving
 * this on every page load.
 */
export async function listHires(): Promise<HireSummary[]> {
  const searches = await listSearches();
  const people = await listPeople();

  const hires = await Promise.all(
    searches.map(async (entry) => {
      const search = await readSearch(entry.id);
      if (!search) return null;

      // Enrichment status comes from the person store, so a hire that
      // reused someone else's enrichment still counts them.
      const enrichment = await readEnrichment(entry.id);
      const enrichedHere = people.filter((p) => p.seenInHires.includes(entry.id));

      return {
        id: search.id,
        title: search.brief.title || "Untitled role",
        where: describeWhere(search.brief),
        createdAt: search.fetchedAt,
        poolSize: search.fetched,
        poolTotal: search.total,
        enriched: enrichedHere.length,
        withGithub: enrichedHere.filter((p) => p.hasGithub).length,
        creditsUsed:
          Math.round(
            (search.creditsUsed + (enrichment?.creditsUsed ?? 0)) * 100
          ) / 100,
        reused: enrichment?.reused?.length ?? 0,
        stage: (enrichedHere.length > 0 ? "enriched" : "searched") as HireStage,
      };
    })
  );

  return hires
    .filter((h): h is HireSummary => h !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Counts for the homepage, so the value of the person store is visible
 *  before anyone opens a hire. */
export async function storeSummary(): Promise<{
  people: number;
  fresh: number;
  withGithub: number;
}> {
  const people = await listPeople();
  return {
    people: people.length,
    fresh: people.filter((p) => p.fresh).length,
    withGithub: people.filter((p) => p.hasGithub).length,
  };
}
