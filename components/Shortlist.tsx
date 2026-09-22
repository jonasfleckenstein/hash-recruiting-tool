"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EXPERIENCE_BANDS, DEFAULT_WEIGHTS, STAGE_RULES } from "@/lib/scoring";
import type { ScoreRun, ScoredProfile } from "@/lib/scoring";
import type { ScoringWeights } from "@/lib/types";

interface ScoreResponse {
  id: string;
  title: string;
  fetchedAt: string;
  total: number | null;
  fetched: number;
  gateMode: string;
  experienceBand: string | null;
  run: ScoreRun;
}

const SIGNALS: { key: keyof ScoringWeights; label: string; note: string }[] = [
  { key: "title", label: "Title match", note: "exact phrase beats all-words beats synonym" },
  { key: "experience", label: "Experience", note: "years in this discipline, against the band" },
  { key: "tenureNow", label: "Time in current role", note: "18 to 36 months is the movable window" },
  { key: "tenureHistory", label: "Tenure history", note: "median stint, same employer merged" },
  { key: "education", label: "Education", note: "degree, something listed, or nothing" },
];

const STAGE_MODES = [
  { id: "off", label: "Off" },
  { id: "penalise", label: "Penalise" },
  { id: "filter", label: "Filter" },
] as const;

/** One person as the store knows them, keyed by Crustdata id. */
interface Known {
  internalId: string;
  fresh: boolean;
  hasGithub: boolean;
  ageDays: number | null;
  seenInHires: string[];
}

const PENALTIES: { key: keyof ScoringWeights; label: string }[] = [
  { key: "penaliseGap", label: "Career gap over a year" },
  { key: "penaliseFreelance", label: "Freelance or contract" },
  { key: "penaliseStale", label: "Profile over a year old" },
];

export default function Shortlist({ searchId }: { searchId: string }) {
  const [weights, setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  const [band, setBand] = useState<string | null>(null);
  const [cut, setCut] = useState(20);
  const [data, setData] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Who the person store already has, by Crustdata id.
   *
   * Fetched once and refreshed after each enrichment. Drives both the
   * badge on a row and the split on the button, so the operator can see
   * what a selection will actually cost before committing to it.
   */
  const [known, setKnown] = useState<Record<string, Known>>({});
  /** Rows ticked for enrichment. Ids are Crustdata ids as strings. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadedBand, setLoadedBand] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState("");
  const [enrichError, setEnrichError] = useState("");
  /** Result of the last enrichment on this page, for the summary line. */
  const [lastRun, setLastRun] = useState<{
    n: number;
    credits: number;
    at: string;
  } | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: searchId, cut, weights, experienceBand: band }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scoring failed.");
      setData(json as ScoreResponse);
      if (!loadedBand) {
        setBand((json as ScoreResponse).experienceBand);
        setLoadedBand(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring failed.");
    }
    setBusy(false);
  }, [searchId, cut, weights, band, loadedBand]);

  // Scoring reads from disk and costs nothing, so it reruns on every change.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId, cut, weights, band]);

  const loadKnown = useCallback(async () => {
    try {
      const res = await fetch("/api/people");
      const json = await res.json();
      const next: Record<string, Known> = {};
      for (const p of json.people ?? []) {
        next[String(p.crustdataPersonId)] = {
          internalId: p.internalId,
          fresh: p.fresh,
          hasGithub: p.hasGithub,
          ageDays: p.ageDays,
          seenInHires: p.seenInHires ?? [],
        };
      }
      setKnown(next);
    } catch {
      // The store is an optimisation. Failing to read it means the page
      // offers to enrich everyone, which is correct, just not cheapest.
    }
  }, []);

  useEffect(() => {
    void loadKnown();
  }, [loadKnown]);

  /**
   * Enrich an explicit set of people.
   *
   * Named rather than ranked, because the person worth a credit is often
   * not in the top twenty: a strong candidate the current weights rank
   * fortieth should be reachable without re-tuning the weights to drag
   * them up.
   */
  const enrichPicked = async () => {
    if (picked.size === 0) return;
    setEnriching(true);
    setEnrichError("");
    setEnrichNote("");
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: searchId,
          crustdataPersonIds: [...picked].map(Number),
          weights,
          experienceBand: band,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Enrichment failed.");
      const e = json.enrichment;
      setLastRun({
        n: (e.records?.length ?? 0) + (e.reused?.length ?? 0),
        credits: e.creditsUsed ?? 0,
        at: e.enrichedAt ?? "",
      });
      if (json.spend) {
        setEnrichNote(
          `${json.spend.bought} bought, ${json.spend.reused} already known and reused, ${json.spend.creditsUsed} credits spent.`
        );
      }
      setPicked(new Set());
      await loadKnown();
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Enrichment failed.");
    }
    setEnriching(false);
  };

  const rows = data?.run.rows ?? [];
  const selected = rows.slice(0, data?.run.cut ?? cut);
  const rest = rows.slice(data?.run.cut ?? cut);

  /** What the current selection would actually cost. */
  const pickedIds = [...picked];
  const reusable = pickedIds.filter((id) => known[id]?.fresh).length;
  const payable = pickedIds.length - reusable;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickAllShortlisted = () =>
    setPicked(new Set(selected.map((r) => String(r.id))));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Pinned and independently scrollable. With a hundred rows in
            the list, controls that scroll away are controls you stop
            using; and a sidebar that is merely sticky becomes unreachable
            below the fold once it is taller than the viewport. */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {/* Shortlist size first: it is the control with an actual cost
              attached, since the cut decides how many people enrichment
              is offered for. The rest only reorder a list that is free
              to reorder. */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-semibold text-neutral-900">
                Shortlist size
              </label>
              <span className="font-mono text-[11px] text-neutral-500">{cut}</span>
            </div>
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={cut}
              onChange={(e) => setCut(Number(e.target.value))}
              className="mt-2 w-full accent-neutral-900"
            />
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2
              className="text-sm font-semibold text-neutral-900"
              title="Scored, never filtered. Someone outside the band loses points rather than disappearing. Filtering on Crustdata's experience field cut one pool from 164 to 63 and removed all five of its top-ranked candidates, including a career changer whose engineering years were inside the band."
            >
              Seniority
            </h2>
            <select
              value={band ?? ""}
              onChange={(e) => setBand(e.target.value || null)}
              className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
            >
              {/* Naming the inferred band in the option itself removes the
                  need for a line underneath explaining what happened. */}
              <option value="">
                {data?.run.bandFromPool && data.run.bandLabel
                  ? `Match this pool's level (${data.run.bandLabel})`
                  : "Match this pool's level"}
              </option>
              {EXPERIENCE_BANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} · {b.note}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Weights</h2>
              <button
                type="button"
                onClick={() => setWeights(DEFAULT_WEIGHTS)}
                className="text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
              >
                reset
              </button>
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">
              Rescoring is free, so move these and watch the list.
            </p>

            <div className="mt-3 space-y-3">
              {SIGNALS.map((s) => (
                <div key={s.key}>
                  <div className="flex items-baseline justify-between">
                    <label className="text-xs font-medium text-neutral-800">
                      {s.label}
                    </label>
                    <span className="font-mono text-[11px] text-neutral-500">
                      {(weights[s.key] as number).toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.5}
                    value={weights[s.key] as number}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, [s.key]: Number(e.target.value) }))
                    }
                    className="mt-1 w-full accent-neutral-900"
                  />
                  <p className="text-[10px] text-neutral-400">
                    {(weights[s.key] as number) === 0 ? "off" : s.note}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-neutral-100 pt-3">
              <p className="text-[11px] font-medium text-neutral-700">Company stage</p>
              <div className="mt-1.5 flex rounded-lg border border-neutral-300 p-0.5">
                {STAGE_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setWeights((w) => ({
                        ...w,
                        companyStageMode: m.id,
                        companyStageRule: w.companyStageRule ?? STAGE_RULES[0].id,
                      }))
                    }
                    className={`flex-1 rounded-md px-2 py-1 text-[11px] ${
                      weights.companyStageMode === m.id
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {weights.companyStageMode !== "off" && (
                <>
                  <select
                    value={weights.companyStageRule ?? STAGE_RULES[0].id}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, companyStageRule: e.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-neutral-900"
                  >
                    {STAGE_RULES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label} · {r.observed}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-neutral-400">
                    {STAGE_RULES.find(
                      (r) => r.id === (weights.companyStageRule ?? STAGE_RULES[0].id)
                    )?.detail}
                    .{" "}
                    {weights.companyStageMode === "filter"
                      ? "Filter removes them from the page entirely. \u201cUnder 200\u201d fails someone with seven years at a 210-person company."
                      : "Failing costs points and keeps the card."}
                  </p>
                </>
              )}
              {weights.companyStageMode === "off" && (
                <p className="mt-1 text-[10px] text-neutral-400">
                  A preference about working environment, not a measure of
                  ability. Off unless you want it.
                </p>
              )}
            </div>

            <div className="mt-4 space-y-1.5 border-t border-neutral-100 pt-3">
              <p className="text-[11px] font-medium text-neutral-700">Penalties</p>
              {PENALTIES.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-xs text-neutral-700">
                  <input
                    type="checkbox"
                    checked={weights[p.key] as boolean}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, [p.key]: e.target.checked }))
                    }
                  />
                  {p.label}
                </label>
              ))}
              <p className="text-[10px] text-neutral-400">
                Freelance is a negative for a salaried engineering hire and
                normal in design. Turn it off when it does not apply.
              </p>
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          {error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{error}</p>
          )}

          {data && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">
                  {data.title}
                </h2>
                <span className="text-[11px] text-neutral-500">
                  search {data.id} · gate {data.gateMode} · {busy ? "scoring" : "up to date"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-600">
                <span>
                  pool <strong className="text-neutral-900">{data.run.pool}</strong>
                </span>
                <span>
                  after gates{" "}
                  <strong className="text-neutral-900">{data.run.survivors}</strong>
                </span>
                <span>
                  shortlisted{" "}
                  <strong className="text-neutral-900">{data.run.cut}</strong>
                </span>
                <span>median score {data.run.median.toFixed(1)}</span>
                <span>band {data.run.bandLabel}</span>
              </div>

              {data.run.dropped.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {data.run.dropped.map((d) => (
                    <li key={d.reason} className="text-[11px] text-neutral-500">
                      dropped {d.count}: {d.reason}
                    </li>
                  ))}
                </ul>
              )}

              {data.run.nearCut > 3 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {data.run.nearCut} profiles sit within 3 points of the cut, so
                  the boundary is close to arbitrary. Widening the shortlist
                  costs about 2 credits a head at enrichment.
                </p>
              )}

              <p className="mt-2 text-[11px] text-neutral-400">
                Scores are positions within this pool of {data.run.survivors},
                not absolute marks. Search returns no skills and no GitHub, so
                nothing here reflects anyone&apos;s stack.
              </p>
            </div>
          )}

          {data && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-neutral-900">Enrich</h3>
              <p className="mt-1 text-[11px] text-neutral-500">
                Buys skills, GitHub, profile summaries and role descriptions,
                none of which search returns. Roughly 1 credit a head, 2 with
                GitHub, so about fifty times the cost of finding them. Saved to
                disk, so scoring against the brief is then free to rerun.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void enrichPicked()}
                  disabled={enriching || picked.size === 0}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {enriching
                    ? "Enriching"
                    : picked.size === 0
                      ? "Select people to enrich"
                      : reusable > 0
                        ? `Enrich ${payable} (${reusable} already known, free)`
                        : `Enrich ${payable} (about ${Math.round(payable * 1.7)} credits)`}
                </button>
                <button
                  type="button"
                  onClick={pickAllShortlisted}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
                >
                  Select the top {data.run.cut}
                </button>
                {picked.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicked(new Set())}
                    className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                  >
                    Clear
                  </button>
                )}
              </div>

              <p className="mt-1.5 text-[10px] text-neutral-400">
                Tick anyone, in or out of the shortlist. A strong candidate
                the current weights rank fortieth is worth a credit, and
                dragging them into the top twenty by re-tuning the weights
                would only distort the ranking for everyone else. People
                already enriched by any hire within the last month are free
                and marked in green.
              </p>

              {lastRun && (
                <p className="mt-2 text-[11px] text-neutral-600">
                  Last run: {lastRun.n} profiles, {lastRun.credits} credits,{" "}
                  {lastRun.at.slice(0, 16).replace("T", " ")}
                </p>
              )}
              {enrichNote && (
                <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-[11px] text-neutral-600">
                  {enrichNote}
                </p>
              )}
              {enrichError && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {enrichError}
                </p>
              )}
            </div>
          )}

          <ul className="space-y-2">
            {selected.map((r) => (
              <Row
                key={r.id}
                row={r}
                known={known[String(r.id)]}
                picked={picked.has(String(r.id))}
                onToggle={() => toggle(String(r.id))}
              />
            ))}
          </ul>

          {rest.length > 0 && (
            <details className="rounded-xl border border-neutral-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
                Below the line ({rest.length})
              </summary>
              <p className="mt-1 text-[11px] text-neutral-500">
                Still selectable. The cut is a budget, not a judgement.
              </p>
              <ul className="mt-3 space-y-2">
                {rest.slice(0, 60).map((r) => (
                  <Row
                    key={r.id}
                    row={r}
                    dim
                    known={known[String(r.id)]}
                    picked={picked.has(String(r.id))}
                    onToggle={() => toggle(String(r.id))}
                  />
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

function bar(v: number) {
  return `${Math.round(v * 100)}%`;
}

function Row({
  row,
  dim,
  known,
  picked,
  onToggle,
}: {
  row: ScoredProfile;
  dim?: boolean;
  known?: Known;
  picked: boolean;
  onToggle: () => void;
}) {
  const parts: [string, number][] = [
    ["title", row.parts.title],
    ["exp", row.parts.experience],
    ["in role", row.parts.tenureNow],
    ["tenure", row.parts.tenureHistory],
    ["edu", row.parts.education],
  ];
  /** Green means already paid for and still current, so ticking this
   *  person costs nothing. Amber means known but aged out. */
  const tone = known?.fresh
    ? "border-emerald-300 bg-emerald-50/40"
    : known
      ? "border-amber-200 bg-amber-50/30"
      : "border-neutral-200 bg-white";

  return (
    <li className={`rounded-xl border p-4 ${tone} ${dim ? "opacity-75" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="flex cursor-pointer items-baseline gap-2">
          <input
            type="checkbox"
            checked={picked}
            onChange={onToggle}
            className="mt-0.5 accent-neutral-900"
          />
          <p className="text-sm font-semibold text-neutral-900">
            <span className="mr-2 font-mono text-[11px] text-neutral-400">
              {row.rank}
            </span>
            {row.name}
          </p>
        </label>
        <div className="flex items-center gap-1.5">
          {known && (
            <span
              title={
                known.fresh
                  ? `Enriched ${known.ageDays ?? 0} days ago, across ${known.seenInHires.length} hire(s). Free to include.`
                  : `Enriched ${known.ageDays} days ago, past the one-month window, so it will refresh and cost a credit.`
              }
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                known.fresh
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              {known.fresh ? "Enriched" : "Enriched, stale"}
            </span>
          )}
          {known?.hasGithub && (
            <span
              title="Public GitHub evidence has been collected for this person."
              className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800"
            >
              GitHub
            </span>
          )}
          <span className="ml-1 font-mono text-xs text-neutral-900">
            {row.score.toFixed(1)}
          </span>
          {row.linkedinUrl && (
            <a
              href={row.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
            >
              profile
            </a>
          )}
        </div>
      </div>

      <p className="mt-0.5 text-sm text-neutral-700">
        {row.currentTitle}
        {row.currentCompany ? ` at ${row.currentCompany}` : ""}
      </p>
      <p className="text-[11px] text-neutral-500">
        {[
          row.years !== null ? `${row.years}y in discipline` : "years unknown",
          row.monthsInRole !== null ? `${row.monthsInRole}mo in role` : null,
          row.medianStintMonths !== null
            ? `${Math.round(row.medianStintMonths)}mo median stint`
            : null,
          row.educationLabel,
          row.location,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {parts.map(([label, v]) => (
            <span
              key={label}
              title={`${label}: ${bar(v)} of this pool`}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                v >= 0.75
                  ? "bg-emerald-50 text-emerald-700"
                  : v <= 0.25
                    ? "bg-amber-50 text-amber-800"
                    : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {label} {bar(v)}
            </span>
          ))}
          {row.stagePass === true && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
              small-company
            </span>
          )}
          {row.penalties.map((p) => (
            <span key={p} className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-800">
              {p}
            </span>
          ))}
        </div>

        {/* The internal id belongs on the card but not in the way: it is
            how this person is referred to everywhere after enrichment,
            and occasionally worth quoting, but it is never the reason to
            look at them. */}
        {known && (
          <span
            title={`Internal id, stable across hires. Seen in ${known.seenInHires.length} hire(s).`}
            className="shrink-0 font-mono text-[10px] text-neutral-400"
          >
            {known.internalId}
          </span>
        )}
      </div>
    </li>
  );
}
