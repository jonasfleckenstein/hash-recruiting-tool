"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RawProfile } from "@/lib/candidates";
import type { EnrichedRecord, StoredEnrichment } from "@/lib/enrich";

interface SearchSummary {
  id: string;
  fetchedAt: string;
  title: string;
  fetched: number;
}

interface Dataset {
  id: string;
  fetchedAt: string;
  title: string;
  total: number | null;
  fetched: number;
  creditsUsed: number;
  profiles: RawProfile[];
}

/** Which sections came back, per person, so gaps are visible at a glance. */
const SECTIONS = [
  "basic_profile",
  "professional_network",
  "social_handles",
  "experience",
  "education",
  "skills",
  "dev_platform_profiles",
  "assessment",
  "certifications",
  "honors",
];

function personOf(record: EnrichedRecord): Record<string, unknown> | null {
  return record.matches?.[0]?.person_data ?? null;
}

export default function DataExplorer() {
  const [searches, setSearches] = useState<SearchSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [enrichment, setEnrichment] = useState<StoredEnrichment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/datasets");
      const data = await res.json();
      setSearches(data.searches ?? []);
    })();
  }, []);

  const open = async (id: string) => {
    setSelected(id);
    setError("");
    setDataset(null);
    setEnrichment(null);
    const res = await fetch(`/api/datasets?id=${id}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not open that dataset.");
      return;
    }
    setDataset(data.search);
    setEnrichment(data.enrichment);
  };

  const enrich = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selected, count: 20 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The enrichment failed.");
      setEnrichment(data.enrichment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The enrichment failed.");
    }
    setBusy(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-900">Saved searches</h2>
        {searches.length === 0 && (
          <p className="text-xs text-neutral-500">
            Nothing yet. Run a search on the main page first.
          </p>
        )}
        <ul className="space-y-1">
          {searches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void open(s.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                  selected === s.id
                    ? "border-neutral-900 bg-white"
                    : "border-neutral-200 bg-white hover:border-neutral-400"
                }`}
              >
                <span className="block font-medium text-neutral-900">{s.title}</span>
                <span className="block text-neutral-500">
                  {s.fetched} profiles · {s.fetchedAt.slice(0, 16).replace("T", " ")}
                </span>
                <span className="block font-mono text-[10px] text-neutral-400">
                  {s.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="space-y-4">
        {error && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {error}
          </p>
        )}

        {!dataset && !error && (
          <p className="text-sm text-neutral-500">
            Pick a search to see the raw data and enrich it.
          </p>
        )}

        {dataset && (
          <>
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">
                  {dataset.title}
                </h2>
                <Link
                  href={`/shortlist/${dataset.id}`}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] hover:bg-neutral-100"
                >
                  Rank this pool
                </Link>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                {dataset.fetched} profiles
                {dataset.total !== null && ` of ${dataset.total.toLocaleString()} matching`}
                {" · "}
                {dataset.creditsUsed} credits to fetch
              </p>

              {enrichment ? (
                <p className="mt-3 text-xs text-neutral-600">
                  Enriched {enrichment.enrichedAt.slice(0, 16).replace("T", " ")} for{" "}
                  {enrichment.creditsUsed} credits, {enrichment.records.length}{" "}
                  profiles
                  {enrichment.reused.length > 0
                    ? `, plus ${enrichment.reused.length} reused from earlier hires`
                    : ""}
                  . Sections requested: {enrichment.fieldsUsed.join(", ")}.
                </p>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void enrich()}
                    disabled={busy}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    {busy ? "Enriching" : "Enrich the top 20 (about 34 credits)"}
                  </button>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    Never the whole pool. Enrichment is 1 to 2 credits a head
                    against 0.03 to find someone, so all {dataset.fetched} would
                    cost about {Math.round(dataset.fetched * 1.7)} credits. Use{" "}
                    <Link
                      href={`/shortlist/${dataset.id}`}
                      className="underline underline-offset-2"
                    >
                      the ranked page
                    </Link>{" "}
                    to pick exactly who is worth it. Anyone already enriched by
                    another hire in the last month is free. Social posts are
                    never requested: that add-on is 5 credits a head.
                  </p>
                </div>
              )}
            </div>

            {enrichment && (
              <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-neutral-900">
                  What came back
                </h3>
                <ul className="mt-2 space-y-1">
                  {enrichment.records.map((r, i) => {
                    const person = personOf(r);
                    const present = SECTIONS.filter((s) => person?.[s] !== undefined);
                    return (
                      <li key={i} className="text-xs">
                        <span className="text-neutral-700">
                          {(person?.basic_profile as { name?: string })?.name ??
                            r.matched_on ??
                            "unknown"}
                        </span>
                        {r.match_status !== "matched" && (
                          <span className="ml-2 text-amber-700">
                            {r.match_status}
                          </span>
                        )}
                        <span className="ml-2 text-neutral-400">
                          {present.join(", ") || "nothing"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              {(enrichment?.records ?? []).map((r, i) => {
                const person = personOf(r);
                if (!person) return null;
                const name =
                  (person.basic_profile as { name?: string })?.name ?? r.matched_on;
                return (
                  <details
                    key={i}
                    className="rounded-xl border border-neutral-200 bg-white p-4"
                  >
                    <summary className="cursor-pointer text-sm font-medium text-neutral-900">
                      {name}
                    </summary>
                    <pre className="mt-3 max-h-[500px] overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-100">
                      {JSON.stringify(person, null, 2)}
                    </pre>
                  </details>
                );
              })}

              {!enrichment &&
                dataset.profiles.map((p, i) => (
                  <details
                    key={i}
                    className="rounded-xl border border-neutral-200 bg-white p-4"
                  >
                    <summary className="cursor-pointer text-sm font-medium text-neutral-900">
                      {p.basic_profile?.name ?? "Unnamed profile"}
                    </summary>
                    <pre className="mt-3 max-h-[500px] overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-100">
                      {JSON.stringify(p, null, 2)}
                    </pre>
                  </details>
                ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
