import { readSearch } from "@/lib/search";
import type { Criterion, RoleBrief } from "@/lib/types";

/**
 * What the search was, and what can no longer be changed about it.
 *
 * Collapsed by default. This is reference material: it matters when you
 * are wondering why someone is or is not in the pool, and the rest of
 * the time it is just pushing the actual work down the page.
 *
 * Only filter criteria appear. The distinction is not editorial, it is
 * structural, and it already exists in the data: `Criterion.check` is
 * "filter" or "judge". A filter criterion became a condition in the
 * Crustdata query, so the pool on screen was selected by it and editing
 * it now would describe a search that never ran.
 *
 * Every field below tolerates being absent. A saved search is a record of
 * what actually ran and is never rewritten when the schema grows, so old
 * briefs are missing fields that later ones have. Back-filling defaults
 * into them would be worse than showing a gap: it would claim those
 * searches had conditions they never had.
 */

function locked(brief: RoleBrief): Criterion[] {
  return (brief.criteria ?? []).filter((c) => c.selected && c.check === "filter");
}

function describeWhere(brief: RoleBrief): string {
  if (brief.locationMode === "remote") {
    const regions = brief.regions ?? [];
    const window =
      typeof brief.tzMin === "number" && typeof brief.tzMax === "number"
        ? `UTC${brief.tzMin >= 0 ? "+" : ""}${brief.tzMin} to UTC${
            brief.tzMax >= 0 ? "+" : ""
          }${brief.tzMax}`
        : null;
    return ["Remote", regions.join(", ") || null, window]
      .filter(Boolean)
      .join(" · ");
  }
  const radius =
    typeof brief.radius === "number"
      ? `within ${brief.radius}${brief.radiusUnit ?? "km"}`
      : null;
  return [brief.city || "Location not set", radius].filter(Boolean).join(" · ");
}

function criterionText(c: Criterion): string {
  const skills = (c.skills ?? []).map((s) => s.label);
  const parts = [...skills, ...(c.backgrounds ?? [])];
  return parts.length > 0 ? `${c.label} (${parts.join(", ")})` : c.label;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700">
      {children}
    </span>
  );
}

export default async function LockedBrief({ searchId }: { searchId: string }) {
  const search = await readSearch(searchId);
  if (!search?.brief) return null;

  const brief = search.brief;
  const fixed = locked(brief);
  const titles = (brief.titleVariants ?? [])
    .filter((v) => v.selected)
    .map((v) => v.label);

  const ev = brief.evidence;
  const evidence = ev
    ? ([
        ev.github ? "public GitHub" : null,
        ev.currentDescription ? "current role written up" : null,
        ev.pastDescription ? "a past role written up" : null,
      ].filter(Boolean) as string[])
    : [];

  return (
    <details className="group rounded-xl border border-neutral-200 bg-neutral-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-neutral-900">
          {brief.title ? `${brief.title} · ` : ""}
          <span className="font-normal text-neutral-500">Search filters</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-neutral-500">
          {search.fetched} of {search.total ?? search.fetched} found
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            className="h-3 w-3 transition-transform group-open:rotate-180"
          >
            <path
              d="M2 4.5 6 8.5 10 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>

      <div className="border-t border-neutral-200 px-5 py-4">
        <p className="text-[11px] text-neutral-500">
          Fixed when the search ran on{" "}
          {new Date(search.fetchedAt).toLocaleDateString("en-GB")}. Changing
          any of it means starting a new hire, because the pool below was
          selected by exactly these conditions.
        </p>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Titles searched
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {titles.length > 0 ? (
                titles.map((t) => <Pill key={t}>{t}</Pill>)
              ) : (
                <span className="text-xs text-neutral-400">
                  Not recorded on this search
                </span>
              )}
            </dd>
          </div>

          <div className="sm:col-span-2">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Must-haves ·{" "}
              {brief.gateMode === "all" ? "all required" : "any one of"}
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {fixed.length > 0 ? (
                fixed.map((c) => <Pill key={c.id}>{criterionText(c)}</Pill>)
              ) : (
                <span className="text-xs text-neutral-400">
                  None, so the pool is title and location only
                </span>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Where
            </dt>
            <dd className="mt-1.5 text-xs text-neutral-700">
              {describeWhere(brief)}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Profile had to show
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {!ev ? (
                <span className="text-xs text-neutral-400">
                  Not recorded, this search predates the setting
                </span>
              ) : evidence.length > 0 ? (
                evidence.map((e) => <Pill key={e}>{e}</Pill>)
              ) : (
                <span className="text-xs text-neutral-400">
                  Nothing required, so nobody was excluded for a thin profile
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}
