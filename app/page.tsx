import Link from "next/link";
import { listHires, storeSummary } from "@/lib/hires";

export const dynamic = "force-dynamic";

function relative(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The homepage: start a hire, or pick up one already running.
 *
 * The store counts sit here rather than inside a hire because they are a
 * property of the whole system, not of any one role. Seeing "41 people
 * known" before opening anything is the cheapest way to understand why
 * the second hire for a similar role costs so much less than the first.
 */
export default async function Page() {
  const [hires, store] = await Promise.all([listHires(), storeSummary()]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-14">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Recruiting
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          A role brief in, a shortlist of evidenced candidates out.
        </p>
      </header>

      <div className="mb-10 flex flex-wrap items-center gap-3">
        <Link
          href="/hire/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Start a new hire
        </Link>
      </div>

      {store.people > 0 && (
        <section className="mb-10 rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            People already known
          </h2>
          <p className="mt-2 text-sm text-neutral-700">
            <span className="font-medium text-neutral-900">{store.people}</span>{" "}
            enriched across all hires,{" "}
            <span className="font-medium text-neutral-900">{store.fresh}</span>{" "}
            still current,{" "}
            <span className="font-medium text-neutral-900">
              {store.withGithub}
            </span>{" "}
            with GitHub evidence.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Anyone here who turns up in a new search costs nothing to enrich
            again, as long as their profile is under a month old.
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Hires
        </h2>

        {hires.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center text-sm text-neutral-500">
            No hires yet. Start one above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
            {hires.map((hire) => (
              <li key={hire.id}>
                <Link
                  href={`/shortlist/${hire.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-4 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-900">
                        {hire.title}
                      </span>
                      <span
                        className={
                          hire.stage === "enriched"
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                            : "rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600"
                        }
                      >
                        {hire.stage === "enriched" ? "Enriched" : "Searched"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-500">
                      {hire.where} · {relative(hire.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-baseline gap-5 text-xs text-neutral-600">
                    <span>
                      <span className="font-medium text-neutral-900">
                        {hire.poolSize}
                      </span>{" "}
                      found
                      {hire.poolTotal && hire.poolTotal > hire.poolSize
                        ? ` of ${hire.poolTotal}`
                        : ""}
                    </span>
                    <span>
                      <span className="font-medium text-neutral-900">
                        {hire.enriched}
                      </span>{" "}
                      enriched
                    </span>
                    {hire.withGithub > 0 && (
                      <span>
                        <span className="font-medium text-neutral-900">
                          {hire.withGithub}
                        </span>{" "}
                        with GitHub
                      </span>
                    )}
                    {hire.reused > 0 && (
                      <span className="text-emerald-700">
                        {hire.reused} reused
                      </span>
                    )}
                    <span className="tabular-nums text-neutral-400">
                      {hire.creditsUsed} cr
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
