"use client";

import { useState } from "react";
import { Card } from "@/components/CandidateCards";
import {
  ContactedButton,
  ElsewhereNote,
  RejectButton,
  useDecisions,
} from "@/components/Decisions";
import type { CandidateCard } from "@/lib/cards";
import type { CandidateJudgement } from "@/lib/judge";
import type { MatchCriterion } from "@/lib/matching";
import type { OutreachDraft, Sender } from "@/lib/outreach";

/**
 * Writing to one person at a time.
 *
 * Deliberately not a list. A draft that goes to a human being deserves
 * the writer's whole attention, and a page of twenty of them invites
 * skimming and sending. One person, their card beside the draft, and
 * an arrow to move on.
 *
 * The note is the steer. A model given only a profile writes something
 * accurate and flat; given "she rewrote their whole design system and
 * wrote up why" it writes something a person would answer. So the note
 * sits above the button rather than below it.
 */
export default function OutreachStudio({
  searchId,
  cards,
  initialDrafts,
  criteria,
  judgements,
  initialSender,
  roleTitle,
}: {
  searchId: string;
  cards: CandidateCard[];
  initialDrafts: Record<string, OutreachDraft>;
  criteria: MatchCriterion[];
  judgements: CandidateJudgement[];
  initialSender: Sender;
  roleTitle: string;
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [sender, setSender] = useState(initialSender);
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialDrafts).map(([id, d]) => [id, d.note])
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const decisions = useDecisions(searchId, roleTitle);

  const card = cards[index];
  if (!card) return null;

  const draft = drafts[card.internalId];
  const note = notes[card.internalId] ?? "";
  const verdicts =
    judgements.find((j) => j.internalId === card.internalId)?.verdicts ?? [];
  const decisionKey = String(card.crustdataPersonId);
  const state = decisions.here[decisionKey];

  const go = (delta: number) => {
    setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta)));
    setError("");
    setCopied(false);
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          searchId,
          internalId: card.internalId,
          note,
          sender,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not write a draft.");
      setDrafts((d) => ({ ...d, [card.internalId]: json.draft }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write a draft.");
    }
    setBusy(false);
  };

  const copy = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
    setCopied(true);
  };

  return (
    <div className="space-y-4">
      {/* Who is signing. Typed once, kept for every message after. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">
          From
        </span>
        <input
          value={sender.name}
          onChange={(e) => setSender((s) => ({ ...s, name: e.target.value }))}
          placeholder="Your name"
          className="w-40 rounded-md border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-neutral-900"
        />
        <input
          value={sender.role}
          onChange={(e) => setSender((s) => ({ ...s, role: e.target.value }))}
          placeholder="Your position"
          className="w-56 rounded-md border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-neutral-900"
        />
        <span className="text-[11px] text-neutral-400">
          Used in the greeting and the sign-off.
        </span>
      </div>

      {/* Who, and where you are in the list. */}
      <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-2.5">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Previous person"
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-30"
        >
          ←
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-medium text-neutral-900">
            {card.name}
          </p>
          <p className="text-[11px] text-neutral-500">
            {index + 1} of {cards.length}
            {draft ? " · drafted" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === cards.length - 1}
          aria-label="Next person"
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-30"
        >
          →
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* The profile, exactly as the shortlist renders it, with what
            matching concluded underneath. Someone deciding what to say
            should not have to leave the page to remember why this
            person is on the list. */}
        <div className="space-y-3 lg:sticky lg:top-6">
          <Card card={card} />

          {criteria.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Against the requirements
              </h3>
              <ul className="mt-2 space-y-1.5">
                {criteria.map((c) => {
                  const v = verdicts.find((x) => x.criterionId === c.id);
                  const met = v?.verdict === "met";
                  return (
                    <li key={c.id} className="text-xs">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={
                            met
                              ? "text-emerald-700"
                              : v?.declaredSkill
                                ? "text-sky-600"
                                : "text-neutral-300"
                          }
                        >
                          {met ? "●" : v?.declaredSkill ? "○" : "·"}
                        </span>
                        <span
                          className={
                            met ? "text-neutral-800" : "text-neutral-500"
                          }
                        >
                          {c.label}
                        </span>
                      </div>
                      {v?.span && (
                        <p className="ml-5 border-l-2 border-emerald-200 pl-2 text-[11px] italic text-neutral-600">
                          {v.span}
                        </p>
                      )}
                      {!met && v?.declaredSkill && (
                        <p className="ml-5 text-[11px] text-sky-700">
                          Declared: {v.declaredSkill}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[10px] text-neutral-400">
                Quoted passages are the ones the draft is allowed to draw
                on, so the message and this list cannot disagree.
              </p>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <label
              htmlFor="note"
              className="text-sm font-semibold text-neutral-900"
            >
              Why is this person a good fit for the role?
            </label>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              One line is enough. This becomes the one sentence in the
              message that is actually about them, so be specific.
            </p>
            <textarea
              id="note"
              value={note}
              onChange={(e) =>
                setNotes((n) => ({ ...n, [card.internalId]: e.target.value }))
              }
              rows={3}
              placeholder="Why is that person a good fit for the role"
              className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {busy
                  ? "Writing…"
                  : draft
                    ? "Write it again"
                    : "Generate personalized outreach draft"}
              </button>
              {draft && (
                <span className="text-[11px] text-neutral-400">
                  Written {new Date(draft.generatedAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>

            {error && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                {error}
              </p>
            )}
          </section>

          {draft && (
            <section className="rounded-xl border border-neutral-200 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">
                  Draft
                </h2>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <p className="mt-3 text-[11px] uppercase tracking-wide text-neutral-400">
                Subject
              </p>
              <p className="text-sm font-medium text-neutral-900">
                {draft.subject}
              </p>

              <p className="mt-3 text-[11px] uppercase tracking-wide text-neutral-400">
                Message
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-800">
                {draft.body}
              </p>

              <p className="mt-4 border-t border-neutral-100 pt-2 text-[11px] text-neutral-400">
                Read it before you send it. Everything in here came from
                what they wrote about themselves, but a draft is a draft.
              </p>
            </section>
          )}

          {/* The two ways this ends. Both are remembered across every
              hire, so nobody is written to twice and nobody turned down
              is quietly reconsidered from scratch. */}
          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-neutral-900">
              Where did this land?
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ContactedButton
                state={state}
                onSet={(s) =>
                  void decisions.set(
                    card.crustdataPersonId,
                    s,
                    card.internalId
                  )
                }
              />
              <RejectButton
                state={state}
                size="md"
                onSet={(s) =>
                  void decisions.set(
                    card.crustdataPersonId,
                    s,
                    card.internalId
                  )
                }
              />
              <ElsewhereNote decisions={decisions.other[decisionKey]} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-500">
              Either mark shows everywhere this person appears, including
              in other hires and back in the search results.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
