"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Fetch GitHub for a shortlist that is missing it.
 *
 * Shown only when somebody on the list has a GitHub handle on their
 * profile and no GitHub record stored against them. That is a
 * distinction worth making: "no handle" is a fact about the person,
 * "handle but no record" means the read never happened, usually
 * because GitHub was unreachable during enrichment. Without this the
 * two look identical on a card, and the second one quietly reads as
 * "this person has no public work".
 *
 * Free, so there is nothing to confirm and no cost to state.
 */
export default function GithubBackfill({
  searchId,
  missing,
}: {
  searchId: string;
  missing: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  if (missing === 0) return null;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/github?searchId=${searchId}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "GitHub could not be reached.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "GitHub could not be reached.");
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-amber-900">
          {missing} {missing === 1 ? "person has" : "people have"} a GitHub
          handle that has not been read yet. Until it is, their card shows
          no public work, which is not the same as having none.
        </p>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? "Reading GitHub…" : "Enrich with GitHub"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-amber-900">
          {error} It costs nothing to try again.
        </p>
      )}
    </div>
  );
}
