import { readSearch } from "@/lib/search";
import type { Criterion, RoleBrief } from "@/lib/types";

/**
 * What the search was, and what can no longer be changed about it.
 *
 * The distinction is not editorial, it is structural, and it already
 * exists in the data: `Criterion.check` is "filter" or "judge". A filter
 * criterion became a condition in the Crustdata query, so the pool on
 * screen was selected by it and editing it now would describe a search
 * that never ran. A judge criterion never touched the query and is
 * assessed afterwards, so it stays live.
 *
 * Deriving the panel from that flag rather than from a hand-maintained
 * list means the two can never drift apart.
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

function editable(brief: RoleBrief): Criterion[] {
  return (brief.criteria ?? []).filter((c) => c.selected && c.check === "judge");
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
  const live = editable(brief);
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
    <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          {brief.title || "Untitled role"}
        </h2>
        <span className="text-[11px] text-neutral-500">
          Searched {new Date(search.fetchedAt).toLocaleDateString("en-GB")} ·{" "}
          {search.fetched} of {search.total ?? search.fetched} found
        </span>
      </div>

      <p className="mt-1 text-[11px] text-neutral-500">
        Fixed when the search ran. Changing any of it means starting a new
        hire, because the pool below was selected by exactly these
        conditions.
      </p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
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

      {live.length > 0 && (
        <div className="mt-4 border-t border-neutral-200 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Judged later, still editable
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {live.map((c) => (
              <span
                key={c.id}
                className="rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-600"
              >
                {criterionText(c)}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-500">
            These never touched the query. They are assessed from the
            profile once there is enough of it to read, which for most of
            them means after enrichment.
          </p>
        </div>
      )}
    </section>
  );
}
