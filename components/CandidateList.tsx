"use client";

import type { Candidate } from "@/lib/candidates";
import type { Coverage } from "@/lib/coverage";

export interface SearchOutcome {
  id: string;
  total: number | null;
  fetched: number;
  creditsUsed: number;
  hasMore: boolean;
  remarks: { message?: string; hint?: string }[];
  fieldsUsed: string[];
  coverage: Coverage;
  candidates: Candidate[];
}

export default function CandidateList({ result }: { result: SearchOutcome }) {
  if (result.candidates.length === 0) {
    return (
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-900">No candidates</h2>
        {result.remarks.map((r, i) => (
          <p key={i} className="mt-2 text-xs text-neutral-600">
            {r.message}
            {r.hint ? ` ${r.hint}` : ""}
          </p>
        ))}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">
          {result.fetched} candidates
          {result.total !== null && result.total > result.fetched && (
            <span className="font-normal text-neutral-500">
              {" "}
              of {result.total.toLocaleString()} matching
            </span>
          )}
        </h2>
        <span className="text-[11px] text-neutral-500">
          {result.creditsUsed} credits · saved as {result.id}
        </span>
      </div>

      <p className="text-xs text-neutral-500">
        Ordered by profile trustworthiness, not by fit. Nothing here is scored
        yet. Raw response saved to{" "}
        <code className="text-[11px]">.data/searches/{result.id}.json</code>.
      </p>

      {result.coverage && (
        <details className="rounded-xl border border-neutral-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
            What actually came back
          </summary>
          <p className="mt-2 text-xs text-neutral-500">
            Requesting a field is not the same as receiving it. Role
            descriptions especially are nullable, and they are most of the
            evidence a scorer has beyond a job title.
          </p>
          <ul className="mt-3 space-y-1">
            {result.coverage.rows.map((row) => {
              const share =
                result.coverage.total > 0
                  ? row.present / result.coverage.total
                  : 0;
              return (
                <li key={row.label} className="flex items-baseline gap-2 text-xs">
                  <span className="w-44 shrink-0 text-neutral-700">
                    {row.label}
                  </span>
                  <span
                    className={
                      share === 0
                        ? "w-14 shrink-0 font-semibold text-amber-700"
                        : "w-14 shrink-0 text-neutral-700"
                    }
                  >
                    {row.present} / {result.coverage.total}
                  </span>
                  {row.note && (
                    <span className="text-[11px] text-neutral-400">{row.note}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {result.coverage.medianAgeMonths !== null && (
            <p className="mt-3 text-[11px] text-neutral-500">
              Median profile age {result.coverage.medianAgeMonths} months. A
              role shown as current may already be over.
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-400">
            Fields requested: {result.fieldsUsed.join(", ")}
          </p>
        </details>
      )}

      <ul className="space-y-3">
        {result.candidates.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-neutral-900">{c.name}</p>
              <div className="flex gap-2 text-[11px]">
                {c.linkedinUrl && (
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                  >
                    profile
                  </a>
                )}
                {c.githubUrl && (
                  <a
                    href={c.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                  >
                    github
                  </a>
                )}
              </div>
            </div>

            <p className="mt-0.5 text-sm text-neutral-700">
              {c.currentTitle}
              {c.currentCompany ? ` at ${c.currentCompany}` : ""}
            </p>
            {c.location && (
              <p className="text-xs text-neutral-500">{c.location}</p>
            )}
            {c.headline && (
              <p className="mt-1 text-xs text-neutral-600">{c.headline}</p>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.matchedTitles.map((t) => (
                <span
                  key={t}
                  className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
                >
                  title: {t}
                </span>
              ))}
              {c.matchedBackgrounds.map((b) => (
                <span
                  key={b}
                  className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700"
                >
                  background: {b}
                </span>
              ))}
              {c.subDepartment && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                  {c.subDepartment}
                </span>
              )}
              {c.hasBusinessEmail && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                  business email on file
                </span>
              )}
              {c.updatedAt && (
                <span
                  className="cursor-help rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500"
                  title="When Crustdata last refreshed this profile. Anything shown as current may be out of date."
                >
                  refreshed {c.updatedAt.slice(0, 10)}
                </span>
              )}
            </div>

            {(c.past.length > 0 || c.education.length > 0) && (
              <div className="mt-2 space-y-0.5 text-[11px] text-neutral-500">
                {c.past.length > 0 && (
                  <p>
                    Previously:{" "}
                    {c.past
                      .map((p) => [p.title, p.company].filter(Boolean).join(" at "))
                      .join(" · ")}
                  </p>
                )}
                {c.education.length > 0 && (
                  <p>
                    {c.education
                      .map((e) => [e.school, e.degree].filter(Boolean).join(", "))
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}

            {c.unverifiable.length > 0 && (
              <p className="mt-2 text-[10px] text-neutral-400">
                Matched on {c.unverifiable.join(", ")} according to the search,
                but search does not return skills, so that cannot be shown
                here without enriching the profile.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
