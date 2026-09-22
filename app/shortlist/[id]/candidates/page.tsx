import Link from "next/link";
import { cardsForHire } from "@/lib/cards";
import CandidateCards from "@/components/CandidateCards";

export const dynamic = "force-dynamic";

/**
 * The shortlist: enriched candidates, with their evidence.
 *
 * Server-rendered from the person store rather than fetched in the
 * browser: the data is already on disk, none of it needs a round trip,
 * and cards that arrive whole are easier to read than cards that
 * assemble themselves.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cards = await cardsForHire(id);

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

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Shortlist
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          {cards.length} enriched. Every claim carries where it came from
          and how much that origin is worth: something a candidate typed is
          not the same as something a maintainer merged.
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center text-sm text-neutral-500">
          Nobody enriched yet. Pick people in{" "}
          <Link
            href={`/shortlist/${id}`}
            className="underline underline-offset-2"
          >
            the search results
          </Link>{" "}
          first.
        </p>
      ) : (
        <CandidateCards cards={cards} />
      )}
    </main>
  );
}
