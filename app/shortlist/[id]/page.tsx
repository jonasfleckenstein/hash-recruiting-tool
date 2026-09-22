import Link from "next/link";
import LockedBrief from "@/components/LockedBrief";
import Shortlist from "@/components/Shortlist";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            ← All hires
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
            Shortlist
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Ranked on the search data alone, before spending anything on
            enrichment. Every signal is a position within this pool, so the
            scores describe the field as much as the person.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/data"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
          >
            Saved data
          </Link>
        </div>
      </header>

      {/* What the search was. Rendered on the server from the saved brief,
          so it cannot drift from the conditions that produced the pool. */}
      <div className="mb-6">
        <LockedBrief searchId={id} />
      </div>

      <Shortlist searchId={id} />
    </main>
  );
}
