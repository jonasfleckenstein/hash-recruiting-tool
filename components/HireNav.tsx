import Link from "next/link";

export type HireStep = "search" | "shortlist" | "matching" | "outreach";

const STEPS: { id: HireStep; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "shortlist", label: "Shortlist" },
  { id: "matching", label: "Matching" },
  { id: "outreach", label: "Outreach" },
];

/**
 * Where you are in a hire, with the way back and the way on.
 *
 * The middle is an indicator, not navigation. The three steps are
 * sequential in cost, not just in order: searching is nearly free,
 * enriching spends credits, matching spends model calls. Showing them
 * as a path makes that progression legible without inviting someone to
 * jump into a step whose inputs do not exist yet. Moving happens
 * through the two buttons, which always point somewhere valid.
 *
 * Presentational only, with no data fetching, so a client component
 * can render it and control the forward button from its own state.
 */
export default function HireNav({
  step,
  back,
  forward,
}: {
  step: HireStep;
  back: { href: string; label: string };
  forward?: {
    href: string;
    label: string;
    /** Disabled forward keeps the slot, so the row does not reflow when
     *  a selection changes. */
    disabled?: boolean;
    title?: string;
  };
}) {
  return (
    <div className="mb-6 flex items-center gap-4">
      <Link
        href={back.href}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
      >
        ← {back.label}
      </Link>

      <ol className="flex flex-1 items-center justify-center gap-1 text-xs">
        {STEPS.map((s, i) => {
          const index = STEPS.findIndex((x) => x.id === step);
          const done = i < index;
          const current = s.id === step;
          return (
            <li key={s.id} className="flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden className="px-1 text-neutral-300">
                  ›
                </span>
              )}
              <span
                aria-current={current ? "step" : undefined}
                className={
                  current
                    ? "rounded-md bg-neutral-900 px-2.5 py-1 font-medium text-white"
                    : done
                      ? "px-2.5 py-1 text-neutral-500"
                      : "px-2.5 py-1 text-neutral-300"
                }
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex w-[132px] shrink-0 justify-end">
        {forward ? (
          forward.disabled ? (
            <span
              title={forward.title}
              className="cursor-not-allowed rounded-lg bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-400"
            >
              {forward.label} →
            </span>
          ) : (
            <Link
              href={forward.href}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
            >
              {forward.label} →
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}
