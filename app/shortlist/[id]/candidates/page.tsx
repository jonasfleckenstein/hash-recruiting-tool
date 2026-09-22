import Link from "next/link";
import { cardsForShortlist } from "@/lib/cards";
import { readPerson } from "@/lib/people";
import { readSearch } from "@/lib/search";
import { listShortlists, readShortlist } from "@/lib/shortlists";
import CandidateCards from "@/components/CandidateCards";
import GithubBackfill from "@/components/GithubBackfill";
import HireNav from "@/components/HireNav";

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
  const search = await readSearch(id);

  /**
   * People whose profile carries a GitHub handle but who have no
   * GitHub record stored.
   *
   * The read is free and runs automatically after enrichment, so this
   * is only ever non-zero when it failed or when the person was
   * enriched before that step existed. Worth surfacing rather than
   * leaving their cards to imply they have no public work.
   */
  const people = (
    await Promise.all((active?.internalIds ?? []).map((pid) => readPerson(pid)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);
  const missingGithub = people.filter((p) => {
    const d = p.crustdata.data as Record<string, any>;
    return Boolean(d.dev_platform_profiles?.[0]?.profile_url) && !p.github;
  }).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <HireNav
        step="shortlist"
        back={{ href: `/shortlist/${id}`, label: "Search results" }}
        forward={{
          href: `/shortlist/${id}/matching${active ? `?list=${active.id}` : ""}`,
          label: "Matching",
          disabled: cards.length === 0,
          title: "Nothing enriched yet, so there is nothing to match.",
        }}
      />

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
        <>
          <div className="mb-4">
            <GithubBackfill searchId={id} missing={missingGithub} />
          </div>

          <CandidateCards
            cards={cards}
            searchId={id}
            roleTitle={search?.brief?.title ?? ""}
          />

          {/* The page is for reading the evidence. Judging it against
              the brief is the next step and a separate one, so the way
              on sits at the end rather than competing with the cards. */}
          <div className="mt-8 flex justify-center border-t border-neutral-200 pt-6">
            <Link
              href={`/shortlist/${id}/matching${active ? `?list=${active.id}` : ""}`}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Take this shortlist to matching →
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
