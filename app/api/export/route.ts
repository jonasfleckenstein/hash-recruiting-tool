import { candidatesCsv, evidenceCsv, fullJson } from "@/lib/export";

export const runtime = "nodejs";

/**
 * Take the work out of the tool.
 *
 *   GET /api/export?searchId=X&list=S2&as=candidates   one row per person
 *   GET /api/export?searchId=X&list=S2&as=evidence     one row per verdict
 *   GET /api/export?searchId=X&list=S2&as=json         everything
 *
 * Reads only what is already on disk, so it costs nothing and can be
 * run as often as anyone likes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId") ?? "";
  const list = url.searchParams.get("list") ?? undefined;
  const as = url.searchParams.get("as") ?? "candidates";

  if (!searchId) {
    return new Response(JSON.stringify({ error: "Pass a searchId." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${searchId}${list ? `-${list}` : ""}-${stamp}`;

  try {
    const [body, type, filename] =
      as === "evidence"
        ? [await evidenceCsv(searchId, list), "text/csv", `${base}-evidence.csv`]
        : as === "json"
          ? [await fullJson(searchId, list), "application/json", `${base}.json`]
          : [
              await candidatesCsv(searchId, list),
              "text/csv",
              `${base}-candidates.csv`,
            ];

    return new Response(body, {
      headers: {
        "content-type": `${type}; charset=utf-8`,
        // attachment, so a click downloads rather than rendering a wall
        // of CSV in the browser.
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "The export failed.",
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
