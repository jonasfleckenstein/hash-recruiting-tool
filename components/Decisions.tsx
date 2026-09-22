"use client";

import { useCallback, useEffect, useState } from "react";
import type { Decision, DecisionState } from "@/lib/decisions";

/**
 * Rejected, or written to, shared by every page that shows people.
 *
 * One hook rather than four copies, because the state has to agree
 * across the whole hire: rejecting someone in search results must grey
 * them in matching, and writing to someone in outreach must be visible
 * back in search results.
 */
export function useDecisions(hireId: string, roleTitle: string) {
  const [here, setHere] = useState<Record<string, DecisionState>>({});
  const [other, setOther] = useState<Record<string, Decision[]>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/decisions?hireId=${hireId}`);
      const json = await res.json();
      setHere(json.here ?? {});
      setOther(json.elsewhere ?? {});
    } catch {
      // Without decisions the pages still work; nobody is greyed.
    }
  }, [hireId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = useCallback(
    async (
      crustdataPersonId: number,
      state: DecisionState | null,
      internalId?: string
    ) => {
      // Optimistic: the round trip is not worth a delay on a toggle.
      setHere((h) => {
        const next = { ...h };
        if (state) next[String(crustdataPersonId)] = state;
        else delete next[String(crustdataPersonId)];
        return next;
      });
      try {
        const res = await fetch("/api/decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            crustdataPersonId,
            hireId,
            roleTitle,
            state,
            internalId,
          }),
        });
        const json = await res.json();
        setHere(json.here ?? {});
        setOther(json.elsewhere ?? {});
      } catch {
        void load();
      }
    },
    [hireId, roleTitle, load]
  );

  return { here, other, set };
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * What another hire already decided about this person.
 *
 * Shown everywhere, because it is the thing most worth knowing before
 * spending anything: someone already written to for another role
 * should not be written to again by accident, and someone turned down
 * last month deserves a second look rather than a fresh evaluation
 * from scratch.
 */
export function ElsewhereNote({ decisions }: { decisions?: Decision[] }) {
  if (!decisions || decisions.length === 0) return null;
  return (
    <span className="text-[10px] text-neutral-500">
      {decisions
        .map(
          (d) =>
            `${d.state === "contacted" ? "Written to" : "Rejected"} for ${d.roleTitle} on ${when(d.at)}`
        )
        .join(" · ")}
    </span>
  );
}

/**
 * The reject toggle.
 *
 * Reversible on purpose, and labelled with what it did rather than
 * what it will do once set, so the row reads as a state rather than an
 * offer.
 */
export function RejectButton({
  state,
  onSet,
  size = "sm",
}: {
  state?: DecisionState;
  onSet: (state: DecisionState | null) => void;
  size?: "sm" | "md";
}) {
  const rejected = state === "rejected";
  const pad = size === "md" ? "px-2.5 py-1" : "px-2 py-0.5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSet(rejected ? null : "rejected");
      }}
      title={
        rejected
          ? "Rejected for this role. Click to undo."
          : "Reject for this role. Reversible, and remembered in other hires."
      }
      className={`shrink-0 rounded-md text-[10px] font-medium ${pad} ${
        rejected
          ? "bg-red-100 text-red-800"
          : "text-neutral-300 hover:bg-neutral-100 hover:text-neutral-700"
      }`}
    >
      {rejected ? "Rejected" : "Reject"}
    </button>
  );
}

export function ContactedButton({
  state,
  onSet,
}: {
  state?: DecisionState;
  onSet: (state: DecisionState | null) => void;
}) {
  const contacted = state === "contacted";
  return (
    <button
      type="button"
      onClick={() => onSet(contacted ? null : "contacted")}
      title={
        contacted
          ? "Marked as written to. Visible in every hire this person appears in."
          : "Mark as written to, so nobody writes to them twice."
      }
      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
        contacted
          ? "bg-emerald-600 text-white"
          : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {contacted ? "Written to" : "Mark as written to"}
    </button>
  );
}
