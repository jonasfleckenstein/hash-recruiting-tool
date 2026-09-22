import Link from "next/link";
import { cardsForShortlist } from "@/lib/cards";
import { listShortlists, readShortlist } from "@/lib/shortlists";
import CandidateCards from "@/components/CandidateCards";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A shortlist: the people one enrichment run produced, with evidence.
 *
 * Opens on the newest. Older ones stay reachable, quietly, because a
 * hire that went through three rounds of weighting should keep a record
 * of who was considered each time.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const { id } = await params;
  const { list: requested } = await searchParams;

  const [lists, active] = await Promise.all([
    listShortlists(id),
    readShortlist(id, requested),
  ]);
  const cards = await cardsForShortlist(id, active?.id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link
          href={`/shortlist/${id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          ← Search results
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          All hires
        </Link>
      </div>

      {lists.length > 1 && (
        <nav className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-neutral-400">Shortlists</span>
          {lists.map((l, i) => {
            const current = l.id === active?.id;
            return (
              <Link
                key={l.id}
                href={`/shortlist/${id}/candidates?list=${l.id}`}
                title={`${l.internalIds.length} people · ${when(l.createdAt)} · ${l.creditsUsed} credits`}
                className={
                  current
                    ? "rounded-md bg-neutral-900 px-2 py-0.5 font-medium text-white"
                    : "rounded-md px-2 py-0.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                }
              >
                {l.id}
                {i === 0 && (
                  <span className={current ? "text-neutral-300" : "text-neutral-400"}>
                    {" "}
                    latest
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Shortlist
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          {cards.length} enriched
          {active ? ` · ${when(active.createdAt)}` : ""}
          {active && active.reused > 0
            ? ` · ${active.reused} reused from earlier hires`
            : ""}
          . Every claim carries where it came from and how much that
          origin is worth: something a candidate typed is not the same as
          something a maintainer merged.
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center text-sm text-neutral-500">
          No shortlist yet. Pick people in{" "}
          <Link
            href={`/shortlist/${id}`}
            className="underline underline-offset-2"
          >
            the search results
          </Link>{" "}
          and enrich them.
        </p>
      ) : (
        <CandidateCards cards={cards} />
      )}
    </main>
  );
}
