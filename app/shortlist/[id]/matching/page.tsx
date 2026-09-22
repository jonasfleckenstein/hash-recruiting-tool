import Link from "next/link";
import { cardsForShortlist } from "@/lib/cards";
import { judgeCohort } from "@/lib/judge";
import { readMatchSet } from "@/lib/matching";
import { readPerson } from "@/lib/people";
import { readShortlist } from "@/lib/shortlists";
import CriteriaEditor from "@/components/CriteriaEditor";
import HireNav from "@/components/HireNav";
import MatchResults from "@/components/MatchResults";

export const dynamic = "force-dynamic";

/**
 * Matching: do these people meet the brief?
 *
 * Its own page because the answer is not one number. Each requirement
 * is a separate question with its own evidence and its own kind of
 * uncertainty, and a shortlist page trying to show all of that at once
 * would bury the candidates it exists to display.
 *
 * Verdicts are read from cache on load, never bought. Judging is a
 * button, because it costs money.
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

  const [matchSet, active] = await Promise.all([
    readMatchSet(id),
    readShortlist(id, requested),
  ]);
  const cards = await cardsForShortlist(id, active?.id);
  const people = (
    await Promise.all((active?.internalIds ?? []).map((pid) => readPerson(pid)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  const { judgements, pending } = await judgeCohort(
    id,
    people,
    matchSet.criteria,
    matchSet.context,
    true
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <HireNav
        step="matching"
        back={{
          href: `/shortlist/${id}/candidates${active ? `?list=${active.id}` : ""}`,
          label: "Shortlist",
        }}
      />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Matching
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          {cards.length} candidates against {matchSet.criteria.length}{" "}
          {matchSet.criteria.length === 1 ? "requirement" : "requirements"}
          {active ? ` · shortlist ${active.id}` : ""}.
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center text-sm text-neutral-500">
          Nothing to match yet. Enrich people in{" "}
          <Link href={`/shortlist/${id}`} className="underline underline-offset-2">
            the search results
          </Link>{" "}
          first.
        </p>
      ) : (
        <div className="space-y-4">
          <CriteriaEditor searchId={id} initial={matchSet} />

          {matchSet.criteria.length > 0 && (
            <MatchResults
              searchId={id}
              list={active?.id}
              criteria={matchSet.criteria}
              judgements={judgements}
              cards={cards}
              pending={pending}
            />
          )}
        </div>
      )}
    </main>
  );
}
