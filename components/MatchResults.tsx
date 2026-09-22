"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/CandidateCards";
import {
  ElsewhereNote,
  RejectButton,
  useDecisions,
} from "@/components/Decisions";
import type { CandidateCard } from "@/lib/cards";
import type { CandidateJudgement, CriterionVerdict } from "@/lib/judge";
import type { MatchCriterion } from "@/lib/matching";

/**
 * The shortlist, ranked by how well each person meets the brief.
 *
 * Everyone is shown, not only the people with evidence. A candidate
 * who meets nothing is a finding, and hiding them would leave the
 * reader unable to tell a thin pool from a strict set of
 * requirements.
 *
 * People with nothing written about them are ranked separately rather
 * than at the bottom. They have not failed anything; there was nothing
 * to read. Sorting them in among genuine misses would quietly turn a
 * gap in the data into a judgement about the person.
 *
 * Expanding a row shows the verdicts and then the same candidate card
 * the shortlist page renders, from the same component. Two renderings
 * of one person would drift apart, and a reader would have to learn
 * both.
 */

type SortKey =
  | "fit"
  | "musts"
  | "nices"
  | "declared"
  | "activity"
  | "tenure"
  | "experience";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "fit", label: "Best fit" },
  { id: "musts", label: "Must-haves met" },
  { id: "nices", label: "Nice-to-haves met" },
  { id: "declared", label: "Skills declared" },
  { id: "activity", label: "GitHub activity" },
  { id: "tenure", label: "Average tenure" },
  { id: "experience", label: "Years since degree" },
];

function score(v: CriterionVerdict[], criteria: MatchCriterion[]) {
  const kindOf = new Map(criteria.map((c) => [c.id, c.kind]));
  let musts = 0;
  let nices = 0;
  let declared = 0;
  let unreadable = 0;
  for (const x of v) {
    if (x.declaredSkill) declared += 1;
    if (x.verdict === "unreadable") unreadable += 1;
    if (x.verdict !== "met") continue;
    if (kindOf.get(x.criterionId) === "nice") nices += 1;
    else musts += 1;
  }
  return { musts, nices, declared, unreadable };
}

function Mark({ v }: { v: CriterionVerdict | undefined }) {
  if (!v) return <span className="text-neutral-300">·</span>;
  if (v.verdict === "met")
    return (
      <span
        title={`${v.basis === "stated" ? "Stated" : "Inferred"}: ${v.reason}`}
        className="font-medium text-emerald-700"
      >
        ●
      </span>
    );
  if (v.declaredSkill)
    return (
      <span
        title={`Not described anywhere, but listed as a skill: ${v.declaredSkill}`}
        className="text-sky-600"
      >
        ○
      </span>
    );
  if (v.verdict === "unreadable")
    return (
      <span title={v.reason} className="text-neutral-300">
        ?
      </span>
    );
  return (
    <span title={v.reason} className="text-neutral-300">
      ·
    </span>
  );
}

export default function MatchResults({
  searchId,
  list,
  criteria,
  judgements,
  cards,
  pending,
  initialSelection,
  roleTitle,
}: {
  searchId: string;
  list?: string;
  criteria: MatchCriterion[];
  judgements: CandidateJudgement[];
  cards: CandidateCard[];
  pending: number;
  initialSelection: string[];
  roleTitle: string;
}) {
  const [judged, setJudged] = useState(judgements);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortKey>("fit");
  const [open, setOpen] = useState<string | null>(null);
  /** Who to take to outreach. Order is preserved as picked, since that
   *  is usually the order someone means to write in. */
  const [picked, setPicked] = useState<string[]>(initialSelection);
  const firstSave = useRef(true);

  /**
   * The list is a decision, not a view, so it is persisted rather than
   * held in the URL. Ticking someone puts them on the outreach list
   * and they stay there; unticking is the only thing that removes
   * them.
   */
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      void fetch("/api/outreach", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ searchId, selection: picked }),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [searchId, picked]);

  const [onlyGithub, setOnlyGithub] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [minMusts, setMinMusts] = useState(0);
  const [criterionFilter, setCriterionFilter] = useState("");
  const decisions = useDecisions(searchId, roleTitle);
  const [hideRejected, setHideRejected] = useState(false);

  const totalMusts = criteria.filter((c) => c.kind === "must").length;
  const byId = useMemo(
    () => new Map(cards.map((c) => [c.internalId, c])),
    [cards]
  );

  const run = async () => {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ searchId, list }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Judging failed.");
      setJudged(json.judgements);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Judging failed.");
    }
    setRunning(false);
  };

  const scored = useMemo(
    () =>
      judged
        .map((j) => ({
          j,
          card: byId.get(j.internalId),
          ...score(j.verdicts, criteria),
        }))
        .filter(
          (s): s is typeof s & { card: CandidateCard } => s.card !== undefined
        ),
    [judged, criteria, byId]
  );

  const filtered = scored.filter((s) => {
    const rejected =
      decisions.here[String(s.card.crustdataPersonId)] === "rejected";
    if (hideRejected && rejected) return false;
    if (onlyGithub && !s.card.facts.hasGithub) return false;
    if (onlyOpen && !s.card.facts.openToWork) return false;
    if (s.musts < minMusts) return false;
    if (criterionFilter) {
      const v = s.j.verdicts.find((x) => x.criterionId === criterionFilter);
      if (!v || (v.verdict !== "met" && !v.declaredSkill)) return false;
    }
    return true;
  });

  const readable = filtered.filter((s) => s.unreadable < criteria.length);
  const unreadable = filtered.filter((s) => s.unreadable >= criteria.length);

  const sorted = [...readable].sort((a, b) => {
    const n = (v: number | null) => (v === null ? -1 : v);
    switch (sort) {
      case "musts":
        return b.musts - a.musts;
      case "nices":
        return b.nices - a.nices;
      case "declared":
        return b.declared - a.declared;
      case "activity":
        return n(b.card.facts.activeMonths) - n(a.card.facts.activeMonths);
      case "tenure":
        return n(b.card.facts.avgTenureYears) - n(a.card.facts.avgTenureYears);
      case "experience":
        return (
          n(b.card.facts.yearsSinceDegree) - n(a.card.facts.yearsSinceDegree)
        );
      default:
        // Must-haves first, then nice-to-haves, then declared skills as
        // the weakest tiebreak: a ticked box should never outrank
        // something someone described doing.
        return (
          b.musts - a.musts ||
          b.nices - a.nices ||
          b.declared - a.declared ||
          a.card.name.localeCompare(b.card.name)
        );
    }
  });

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /**
   * Rejecting someone also takes them off the outreach list. Leaving
   * them on it would be the one way a rejection could still result in
   * a message being written.
   */
  const decide = (card: CandidateCard, state: "rejected" | null) => {
    void decisions.set(card.crustdataPersonId, state, card.internalId);
    if (state === "rejected") {
      setPicked((p) => p.filter((x) => x !== card.internalId));
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || pending === 0}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {running
              ? "Judging…"
              : pending > 0
                ? `Judge ${pending} remaining`
                : "All judged"}
          </button>

          <label className="flex items-center gap-1.5 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={onlyGithub}
              onChange={(e) => setOnlyGithub(e.target.checked)}
              className="accent-neutral-900"
            />
            Has GitHub
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.target.checked)}
              className="accent-neutral-900"
            />
            Open to work
          </label>

          <label className="flex items-center gap-1.5 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={hideRejected}
              onChange={(e) => setHideRejected(e.target.checked)}
              className="accent-neutral-900"
            />
            Hide rejected
          </label>

          <label className="flex items-center gap-1.5 text-xs text-neutral-700">
            Min must-haves
            <select
              value={minMusts}
              onChange={(e) => setMinMusts(Number(e.target.value))}
              className="rounded-md border border-neutral-200 px-1.5 py-1 text-[11px]"
            >
              {Array.from({ length: totalMusts + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>

          <select
            value={criterionFilter}
            onChange={(e) => setCriterionFilter(e.target.value)}
            title="Show only people who meet or declare one particular requirement"
            className="max-w-[240px] rounded-md border border-neutral-200 px-1.5 py-1 text-[11px]"
          >
            <option value="">Any requirement</option>
            {criteria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label.slice(0, 48)}
              </option>
            ))}
          </select>

          <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-700">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-neutral-200 px-1.5 py-1 text-[11px]"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-2 text-[11px] text-neutral-500">
          <span className="text-emerald-700">●</span> met, with a quote ·{" "}
          <span className="text-sky-600">○</span> listed as a skill, not
          described · <span className="text-neutral-400">·</span> nothing ·{" "}
          <span className="text-neutral-400">?</span> nothing written to read.
          Hover any mark for the reason.
        </p>

        {error && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {error}
          </p>
        )}
      </section>

      {picked.length > 0 && (
        <div className="sticky top-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-900 bg-neutral-900 px-4 py-2.5 text-white shadow-sm">
          <span className="text-xs font-medium">
            {picked.length} selected
          </span>
          <button
            type="button"
            onClick={() => setPicked([])}
            className="text-[11px] text-neutral-300 underline underline-offset-2 hover:text-white"
          >
            Clear
          </button>
          <a
            href={`/shortlist/${searchId}/outreach${list ? `?list=${list}` : ""}`}
            className="ml-auto rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-neutral-100"
          >
            Take {picked.length} to outreach →
          </a>
        </div>
      )}

      <ol className="space-y-2">
        {sorted.map((s, i) => {
          const expanded = open === s.j.internalId;
          const key = String(s.card.crustdataPersonId);
          const state = decisions.here[key];
          const rejected = state === "rejected";
          return (
            <li
              key={s.j.internalId}
              className={`overflow-hidden rounded-xl border border-neutral-200 bg-white ${
                rejected ? "opacity-45" : ""
              }`}
            >
              <div className="flex w-full flex-wrap items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={picked.includes(s.card.internalId)}
                  disabled={rejected}
                  onChange={() => toggle(s.card.internalId)}
                  aria-label={`Select ${s.card.name} for outreach`}
                  className="shrink-0 accent-neutral-900"
                />
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : s.j.internalId)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left"
                >
                  <span className="w-6 shrink-0 font-mono text-[11px] text-neutral-400">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900">
                      {s.card.name}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {[s.card.currentTitle, s.card.currentCompany]
                        .filter(Boolean)
                        .join(" at ")}
                    </span>
                  </span>

                  <span className="flex shrink-0 gap-1.5 font-mono text-sm">
                    {criteria.map((c) => (
                      <Mark
                        key={c.id}
                        v={s.j.verdicts.find((x) => x.criterionId === c.id)}
                      />
                    ))}
                  </span>

                  <span className="w-32 shrink-0 text-right text-[11px] leading-tight text-neutral-600">
                    {s.musts}/{totalMusts} found in record
                    {s.nices > 0 && (
                      <span className="block text-neutral-400">
                        +{s.nices} nice to have
                      </span>
                    )}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <ElsewhereNote decisions={decisions.other[key]} />
                  <RejectButton
                    state={state}
                    onSet={(v) => decide(s.card, v as "rejected" | null)}
                  />
                </div>
              </div>

              {expanded && (
                <div className="space-y-3 border-t border-neutral-100 bg-neutral-50 p-4">
                  <section className="rounded-xl border border-neutral-200 bg-white p-4">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      Against the requirements
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {criteria.map((c) => {
                        const v = s.j.verdicts.find(
                          (x) => x.criterionId === c.id
                        );
                        return (
                          <li key={c.id} className="text-xs">
                            <div className="flex items-baseline gap-2">
                              <Mark v={v} />
                              <span className="font-medium text-neutral-800">
                                {c.label}
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                                {c.kind}
                              </span>
                            </div>
                            {v?.span && (
                              <p className="ml-5 mt-0.5 border-l-2 border-emerald-200 pl-2 text-[11px] italic text-neutral-600">
                                {v.span}
                                {v.field && (
                                  <span className="ml-1 not-italic text-neutral-400">
                                    — {v.field}
                                  </span>
                                )}
                              </p>
                            )}
                            {v?.declaredSkill && (
                              <p className="ml-5 mt-0.5 text-[11px] text-sky-700">
                                Declared skill: {v.declaredSkill}
                              </p>
                            )}
                            {v?.reason && !v.span && (
                              <p className="ml-5 mt-0.5 text-[11px] text-neutral-500">
                                {v.reason}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  {/* The same card the shortlist renders, from the same
                      component, so the two pages cannot drift. */}
                  <Card card={s.card} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {unreadable.length > 0 && (
        <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
          <h3 className="text-xs font-semibold text-neutral-900">
            Not enough written to judge ({unreadable.length})
          </h3>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            No summary, no role written up, no bio. They have not failed
            anything, so they are kept out of the ranking rather than
            placed at the bottom of it.
          </p>
          <ul className="mt-2 space-y-1">
            {unreadable.map((s) => (
              <li key={s.j.internalId} className="text-xs text-neutral-700">
                {s.card.name}
                {s.declared > 0 && (
                  <span className="ml-2 text-sky-700">
                    {s.declared} skill{s.declared === 1 ? "" : "s"} declared
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
