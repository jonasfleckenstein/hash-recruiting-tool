/**
 * Getting the work out.
 *
 * Three plain links rather than a button with a menu: each one is a
 * GET that reads what is already on disk, so there is nothing to
 * confirm, nothing to wait for and nothing to spend.
 *
 * Two CSVs because they answer different questions. One row per person
 * is the shape a spreadsheet wants and can be handed to somebody who
 * has never seen this tool. One row per verdict carries the quote each
 * one rests on, which is long text that would wreck the first file but
 * is the only way to audit a decision rather than take it on trust.
 */
export default function ExportLinks({
  searchId,
  list,
}: {
  searchId: string;
  list?: string;
}) {
  const href = (as: string) =>
    `/api/export?searchId=${searchId}${list ? `&list=${list}` : ""}&as=${as}`;

  const link =
    "rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100";

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-neutral-900">Export</span>
        <a href={href("candidates")} download className={link}>
          Candidates (CSV)
        </a>
        <a href={href("evidence")} download className={link}>
          Evidence (CSV)
        </a>
        <a href={href("json")} download className={link}>
          Everything (JSON)
        </a>
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        Candidates is one row per person with a column per requirement.
        Evidence is one row per verdict with the quote behind it. Both
        read what is already on disk, so neither costs anything.
      </p>
    </section>
  );
}
