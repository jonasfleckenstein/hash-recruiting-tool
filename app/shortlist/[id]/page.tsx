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
      <div className="mb-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          ← All hires
        </Link>
      </div>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Search results
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Filter and sort further, before spending anything on enrichment.
          </p>
        </div>
        <Link
          href={`/shortlist/${id}/candidates`}
          className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Shortlist →
        </Link>
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
