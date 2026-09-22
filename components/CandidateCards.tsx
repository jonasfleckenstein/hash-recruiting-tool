"use client";

import { useState } from "react";
import type { Basis, CandidateCard, Claim, Source } from "@/lib/cards";

/**
 * A card per candidate, with every claim traceable.
 *
 * The visual grammar is deliberately narrow. Source and basis are the
 * only two things carried on every claim, and they are the two things a
 * reader needs in order to decide how much to believe: who said it, and
 * whether anyone other than the candidate had to agree.
 */

const BASIS_STYLE: Record<Basis, string> = {
  attested: "bg-emerald-100 text-emerald-800",
  "self-reported": "bg-neutral-100 text-neutral-600",
  derived: "bg-sky-100 text-sky-800",
};

const BASIS_TITLE: Record<Basis, string> = {
  attested:
    "Somebody other than the candidate caused this to exist: a maintainer merged it, a server timestamped it. Hard to fake.",
  "self-reported":
    "The candidate wrote this. Often true, useful for context, but not evidence on its own.",
  derived: "Computed from the data above, so only as good as its input.",
};

function BasisTag({ basis, source }: { basis: Basis; source: Source }) {
  return (
    <span
      title={BASIS_TITLE[basis]}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${BASIS_STYLE[basis]}`}
    >
      {basis === "self-reported" ? "self-reported" : basis} · {source}
    </span>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-neutral-100 py-2 first:border-t-0">
      <span className="w-40 shrink-0 text-[11px] uppercase tracking-wide text-neutral-500">
        {claim.label}
      </span>
      <span className="min-w-0 flex-1 text-sm text-neutral-800">
        {claim.url ? (
          <a
            href={claim.url}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900"
          >
            {claim.value}
          </a>
        ) : (
          claim.value
        )}
        {claim.caveat && (
          <span className="mt-0.5 block text-[11px] text-neutral-500">
            {claim.caveat}
          </span>
        )}
      </span>
      <BasisTag basis={claim.basis} source={claim.source} />
    </li>
  );
}

function Card({ card }: { card: CandidateCard }) {
  const [open, setOpen] = useState(false);
  const described = card.roles.filter((r) => r.description?.trim());

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-neutral-900">
            {card.name}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-700">
            {[card.currentTitle, card.currentCompany].filter(Boolean).join(" at ") ||
              card.headline ||
              "Current role not stated"}
          </p>
          {card.location && (
            <p className="text-[11px] text-neutral-500">{card.location}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {card.links.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-100"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>

      {card.summary && (
        <p className="mt-3 border-l-2 border-neutral-200 pl-3 text-sm italic text-neutral-600">
          {card.summary.length > 320
            ? `${card.summary.slice(0, 320).trimEnd()}…`
            : card.summary}
        </p>
      )}

      {card.sections.map((section) => (
        <section key={section.title} className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {section.title}
          </h3>
          {section.claims.length > 0 ? (
            <ul className="mt-1">
              {section.claims.map((c, i) => (
                <ClaimRow key={`${c.label}-${i}`} claim={c} />
              ))}
            </ul>
          ) : (
            <p className="mt-1 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
              {section.emptyNote}
            </p>
          )}
        </section>
      ))}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
      >
        {open ? "Hide history" : "Full history, skills and education"}
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-neutral-100 pt-3">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Roles
            </h3>
            <ul className="mt-1 space-y-2">
              {card.roles.map((r, i) => (
                <li key={i} className="text-sm">
                  <p className="text-neutral-800">
                    {r.title} at{" "}
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900"
                      >
                        {r.company}
                      </a>
                    ) : (
                      r.company
                    )}
                    {r.current && (
                      <span className="ml-2 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-white">
                        current
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {[
                      r.start
                        ? `${new Date(r.start).getFullYear()}${
                            r.end ? ` to ${new Date(r.end).getFullYear()}` : " to now"
                          }`
                        : null,
                      r.headcount ? `${r.headcount} people` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.description && (
                    <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-neutral-600">
                      {r.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {described.length === 0 && (
              <p className="mt-1 text-[11px] text-neutral-500">
                No role written up, so there is nothing here beyond titles
                and dates.
              </p>
            )}
          </section>

          {card.skills.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Skills
                <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
                  self-reported, unordered
                </span>
              </h3>
              <div className="mt-1 flex flex-wrap gap-1">
                {card.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {card.education.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Education
              </h3>
              <ul className="mt-1 space-y-0.5">
                {card.education.map((e, i) => (
                  <li key={i} className="text-[12px] text-neutral-700">
                    {[e.degree, e.field].filter(Boolean).join(", ")}
                    {e.degree || e.field ? " · " : ""}
                    {e.school}
                    {e.years && (
                      <span className="text-neutral-400"> · {e.years}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-2 text-[10px] text-neutral-400">
        <span>
          Profile {card.coverage.crustdataAgeDays ?? "?"} days old ·{" "}
          {card.coverage.githubNote}
        </span>
        <span className="font-mono">{card.internalId}</span>
      </footer>
    </article>
  );
}

export default function CandidateCards({ cards }: { cards: CandidateCard[] }) {
  const attested = cards.filter((c) => c.coverage.github === "ok").length;

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-neutral-50 px-4 py-3 text-[11px] text-neutral-600">
        {attested} of {cards.length} have public GitHub evidence. For the
        rest, everything below is what the candidate wrote about
        themselves, which is worth reading and is not proof of anything.
      </p>
      {cards.map((card) => (
        <Card key={card.internalId} card={card} />
      ))}
    </div>
  );
}
