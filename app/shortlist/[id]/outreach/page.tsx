import Link from "next/link";
import { cardsForShortlist } from "@/lib/cards";
import { judgeCohort } from "@/lib/judge";
import { readMatchSet } from "@/lib/matching";
import { readDrafts, readSelection, readSender } from "@/lib/outreach";
import { readPerson } from "@/lib/people";
import { readSearch } from "@/lib/search";
import { readShortlist } from "@/lib/shortlists";
import HireNav from "@/components/HireNav";
import OutreachStudio from "@/components/OutreachStudio";

export const dynamic = "force-dynamic";

/**
 * Outreach: write to the people picked in matching.
 *
 * Who to write to comes from the stored selection rather than the URL,
 * because it is a decision someone made and should survive leaving the
 * page. Unticking on the matching page is the only way off this list.
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

  const [active, drafts, selection, matchSet, sender, search] = await Promise.all([
    readShortlist(id, requested),
    readDrafts(id),
    readSelection(id),
    readMatchSet(id),
    readSender(),
    readSearch(id),
  ]);

  const all = await cardsForShortlist(id, active?.id);
  const cards = selection
    .map((pid) => all.find((c) => c.internalId === pid))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  /**
   * The verdicts already made, read from cache and never bought here.
   * Someone deciding what to say should be able to see what the person
   * was judged to meet, without leaving the page to check.
   */
  const people = (
    await Promise.all(cards.map((c) => readPerson(c.internalId)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);
  const { judgements } = await judgeCohort(
    id,
    people,
    matchSet.criteria,
    matchSet.context,
    true
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <HireNav
        step="outreach"
        back={{
          href: `/shortlist/${id}/matching${active ? `?list=${active.id}` : ""}`,
          label: "Matching",
        }}
      />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Outreach
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          {cards.length} {cards.length === 1 ? "person" : "people"}, one at a
          time. Say what you like about them, and the draft is built around
          that rather than around the job.
        </p>
      </header>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center text-sm text-neutral-500">
          Nobody on the outreach list. Tick people in{" "}
          <Link
            href={`/shortlist/${id}/matching${active ? `?list=${active.id}` : ""}`}
            className="underline underline-offset-2"
          >
            matching
          </Link>{" "}
          and they will appear here.
        </p>
      ) : (
        <OutreachStudio
          searchId={id}
          cards={cards}
          initialDrafts={drafts}
          criteria={matchSet.criteria}
          judgements={judgements}
          initialSender={sender}
          roleTitle={search?.brief?.title ?? ""}
        />
      )}
    </main>
  );
}
