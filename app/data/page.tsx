import Link from "next/link";
import DataExplorer from "@/components/DataExplorer";

export default function DataPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <Link
          href="/"
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
        >
          Back to the role
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
          Saved data
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          Every search is kept on disk. Open one to read the raw profiles, or
          enrich it to add the sections search never returns: skills, summary,
          GitHub and connection counts.
        </p>
      </header>
      <DataExplorer />
    </main>
  );
}
