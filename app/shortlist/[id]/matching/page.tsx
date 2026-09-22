import Link from "next/link";
import { cardsForShortlist } from "@/lib/cards";
import { readMatchSet } from "@/lib/matching";
import { readShortlist } from "@/lib/shortlists";
import CriteriaEditor from "@/components/CriteriaEditor";
import HireNav from "@/components/HireNav";

export const dynamic = "force-dynamic";

/**
 * Matching: do these people meet the brief?
 *
 * Its own page because the answer is not one number. Each criterion is
 * a separate question with its own evidence and its own kind of
 * uncertainty, and a shortlist page trying to show all of that at once
 * would bury the candidates it exists to display.
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

  const musts = matchSet.criteria.filter((c) => c.kind === "must").length;
  const withDescriptions = cards.filter((c) => c.coverage.hasRoleDescriptions).length;

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
          {musts > 0 ? `, ${musts} of them must-haves` : ""}
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

          {/* The evidence matching will actually read. Stated up front
              because it bounds what any answer can be worth: a
              criterion about present-day responsibility cannot be
              settled for someone whose current role is a blank line. */}
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-neutral-900">
              What there is to read
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Role descriptions
                </dt>
                <dd className="text-sm text-neutral-800">
                  {withDescriptions} of {cards.length} candidates
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-neutral-500">
                  GitHub evidence
                </dt>
                <dd className="text-sm text-neutral-800">
                  {cards.filter((c) => c.coverage.github === "ok").length} of{" "}
                  {cards.length} candidates
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Requirements
                </dt>
                <dd className="text-sm text-neutral-800">
                  {matchSet.criteria.length} to judge
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-neutral-500">
              Anything that cannot be read from this is unanswerable for
              that person, and will be reported as such rather than
              counted against them.
            </p>
          </section>

          <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5">
            <h2 className="text-sm font-semibold text-neutral-900">
              Not built yet
            </h2>
            <p className="mt-1 text-[11px] text-neutral-600">
              Next: split the open criteria into the ones answerable from
              structured fields, which are computed in code and identical
              on every run, and the ones that need prose read, which go to
              a model one candidate and one criterion at a time. Each
              verdict has to carry a verbatim quote from the profile, and
              a criterion with nothing to quote is unanswerable rather
              than unmet.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
