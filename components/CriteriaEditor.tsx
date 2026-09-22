"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchCriterion, MatchSet } from "@/lib/matching";

/**
 * Editing what the shortlist is judged against.
 *
 * A requirement is a sentence and a section. Nothing else. An earlier
 * version had a weight selector and a separate list of acceptable
 * answers; both were machinery around something the sentence already
 * says, and the section already says whether it is a must.
 *
 * Saves on a debounce rather than behind a button. These are short
 * strings that get fiddled with repeatedly, and a save button turns
 * every small correction into a decision.
 */

function newLocalId(): string {
  return Math.random().toString(16).slice(2, 10);
}

export default function CriteriaEditor({
  searchId,
  initial,
}: {
  searchId: string;
  initial: MatchSet;
}) {
  const [criteria, setCriteria] = useState<MatchCriterion[]>(initial.criteria);
  const [context, setContext] = useState(initial.context);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/matching", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ searchId, criteria, context }),
        });
        setState(res.ok ? "saved" : "error");
      } catch {
        setState("error");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [searchId, criteria, context]);

  const update = (id: string, label: string) =>
    setCriteria((cs) => cs.map((c) => (c.id === id ? { ...c, label } : c)));

  const remove = (id: string) =>
    setCriteria((cs) => cs.filter((c) => c.id !== id));

  const add = (kind: "must" | "nice") =>
    setCriteria((cs) => [
      ...cs,
      { id: newLocalId(), label: "", kind, origin: "manual" },
    ]);

  const Rows = ({ kind }: { kind: "must" | "nice" }) => (
    <ul>
      {criteria
        .filter((c) => c.kind === kind)
        .map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-1 border-t border-neutral-100 first:border-t-0"
          >
            <input
              value={c.label}
              onChange={(e) => update(c.id, e.target.value)}
              placeholder="What the person needs to have done"
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-2 text-sm text-neutral-900 outline-none hover:border-neutral-200 focus:border-neutral-900 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => remove(c.id)}
              title="Remove this requirement"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-100 hover:text-neutral-900"
            >
              ✕
            </button>
          </li>
        ))}
    </ul>
  );

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Judged against</h2>
        <span className="text-[11px] text-neutral-400">
          {state === "saving"
            ? "Saving"
            : state === "saved"
              ? "Saved"
              : state === "error"
                ? "Could not save"
                : ""}
        </span>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Must-haves
        </p>
        <Rows kind="must" />
        <button
          type="button"
          onClick={() => add("must")}
          className="mt-1 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
        >
          + Add must-have
        </button>
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Nice to have
        </p>
        <p className="text-[11px] text-neutral-500">
          Never gates anyone. Separates people who already qualify.
        </p>
        <Rows kind="nice" />
        <button
          type="button"
          onClick={() => add("nice")}
          className="mt-1 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
        >
          + Add nice to have
        </button>
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <label
          htmlFor="context"
          className="text-[11px] font-medium uppercase tracking-wide text-neutral-500"
        >
          Anything else the model should know
        </label>
        <textarea
          id="context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          placeholder="A ten-person team. This person owns the frontend alone and reports to the CTO."
          className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <p className="mt-1 text-[11px] text-neutral-500">
          Background about the role and team, not a requirement. A
          requirement written here would bias every verdict invisibly
          instead of appearing above with its own answer.
        </p>
      </div>

      <p className="mt-4 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">
        Changing a requirement&apos;s wording discards the verdicts
        already made against it, since they are stored under that
        wording. Everything else is kept.
      </p>
    </section>
  );
}
