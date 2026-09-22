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

      {/* LockedBrief stays a server component, passed through as children
          so the client component can own the header. The Shortlist button
          there has to know whether the current selection contains anyone
          unenriched, which is client state. */}
      <Shortlist searchId={id}>
        <LockedBrief searchId={id} />
      </Shortlist>
    </main>
  );
}
