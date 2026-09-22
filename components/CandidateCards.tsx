"use client";

import { useState } from "react";
import {
  ElsewhereNote,
  RejectButton,
  useDecisions,
} from "@/components/Decisions";
import type { Basis, CandidateCard, CardSection, Claim } from "@/lib/cards";

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

const BASIS_LABEL: Record<Basis, string> = {
  attested: "attested",
  "self-reported": "self-reported",
  derived: "derived",
};

/**
 * Provenance for a whole section.
 *
 * Carried here rather than on each row. Every section draws on one
 * source, so a chip beside every claim repeated the same two words and
 * crowded out the content without adding any honesty.
 */
function SectionHead({ section }: { section: CardSection }) {
  return (
    <h3 className="flex flex-wrap items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
      {section.title}
      <span
        title={BASIS_TITLE[section.basis]}
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${BASIS_STYLE[section.basis]}`}
      >
        {BASIS_LABEL[section.basis]}
      </span>
    </h3>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-neutral-100 py-2 first:border-t-0">
      <span className="w-44 shrink-0 text-[11px] uppercase tracking-wide text-neutral-500">
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
    </li>
  );
}

/**
 * One candidate, in full.
 *
 * Exported so the matching page can expand a ranked row into exactly
 * the same card the shortlist shows. Two renderings of one person
 * would drift, and the reader would have to learn both.
 */
export function Card({ card }: { card: CandidateCard }) {
  const [open, setOpen] = useState(false);
  const described = card.roles.filter((r) => r.description?.trim());

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {card.photo?.url && (
            /* Shown while the frame detection is being trusted or not.
               eslint-disable-next-line @next/next/no-img-element */
            <img
              src={card.photo.url}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-full object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-900">
                {card.name}
              </h2>
              {card.photo?.openToWorkFrame && (
                <span
                  title={`The profile photo carries LinkedIn's #OpenToWork frame. Read from the image: ${Math.round(
                    card.photo.arcGreen * 100
                  )}% of the lower arc matches the frame green, ${Math.round(
                    card.photo.topGreen * 100
                  )}% of the top does, hue spread ${card.photo.hueSpread}°. Inference from pixels, and the photo is only as current as the profile.`}
                  className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white"
                >
                  LinkedIn: Open to work
                </span>
              )}
              {card.recentlyOpenToWork ? (
                <span
                  title={`GitHub says available for hire, and the professional profile read ${
                    card.openToWorkWindowDays ?? "?"
                  } days ago did not. So the box was ticked within that window, which makes it a dated signal rather than a checkbox someone set years ago and forgot. Still self-reported, and it affects no ranking.`}
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-300"
                >
                  GitHub: Open to work (new)
                </span>
              ) : (
                card.openToWork && (
                  <span
                    title="Ticked GitHub's Available for hire box. Nobody is ever prompted to untick it, so it is often years old. Self-reported, and it affects no ranking."
                    className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800"
                  >
                    GitHub: Open to work
                  </span>
                )
              )}
            </div>
            <p className="mt-0.5 text-sm text-neutral-700">
              {[card.currentTitle, card.currentCompany].filter(Boolean).join(" at ") ||
                card.headline ||
                "Current role not stated"}
            </p>
            {card.location && (
              <p className="text-[11px] text-neutral-500">{card.location}</p>
            )}
          </div>
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

      {card.sections.map((section) => (
        <section key={section.title} className="mt-4">
          <SectionHead section={section} />
          {section.quote && (
            <p className="mt-1.5 border-l-2 border-neutral-200 pl-3 text-sm italic text-neutral-600">
              {section.quote.length > 320
                ? `${section.quote.slice(0, 320).trimEnd()}…`
                : section.quote}
            </p>
          )}
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

export default function CandidateCards({
  cards,
  searchId,
  roleTitle,
}: {
  cards: CandidateCard[];
  searchId: string;
  roleTitle: string;
}) {
  const attested = cards.filter((c) => c.coverage.github === "ok").length;
  const decisions = useDecisions(searchId, roleTitle);

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-neutral-50 px-4 py-3 text-[11px] text-neutral-600">
        {attested} of {cards.length} have public GitHub evidence. For the
        rest, everything below is what the candidate wrote about
        themselves, which is worth reading and is not proof of anything.
      </p>
      {cards.map((card) => {
        const key = String(card.crustdataPersonId);
        const rejected = decisions.here[key] === "rejected";
        return (
          <div
            key={card.internalId}
            className={rejected ? "opacity-45" : undefined}
          >
            <Card card={card} />
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              <ElsewhereNote decisions={decisions.other[key]} />
              <RejectButton
                state={decisions.here[key]}
                size="md"
                onSet={(s) =>
                  void decisions.set(
                    card.crustdataPersonId,
                    s,
                    card.internalId
                  )
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
