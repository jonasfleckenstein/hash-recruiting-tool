import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { readEnrichment } from "@/lib/enrich";
import { attachPhoto, readPerson } from "@/lib/people";
import { analyseImage, checkPhoto, checkPhotos } from "@/lib/photo";

export const runtime = "nodejs";

/**
 * Read profile photos for a hire and look for LinkedIn's #OpenToWork
 * frame.
 *
 * A separate step for the same reason the GitHub read is: it costs
 * nothing, so it should be rerunnable without the caution that
 * enrichment deserves. Results are cached on the person, so a photo is
 * fetched once regardless of how many hires surface them.
 *
 *   GET /api/photos?searchId=5ddc6575
 *   &force=1   re-read photos already checked
 *
 * Two calibration modes, which store nothing:
 *
 *   GET /api/photos?file=/Users/me/Downloads/framed.jpg
 *   GET /api/photos?url=https://example.com/framed.jpg
 *
 * These exist because nobody in a pool of employed engineers has the
 * frame, so the thresholds cannot be checked against live data. Point
 * the detector at a photo you know is framed and read the numbers back.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId") ?? "";
  const force = url.searchParams.get("force") === "1";
  const file = url.searchParams.get("file");
  const single = url.searchParams.get("url");

  if (file) {
    try {
      const bytes = new Uint8Array(await fs.readFile(file));
      return NextResponse.json({ file, check: analyseImage(bytes, null) });
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "Could not read that file.",
          hint: "Absolute path, and JPEG only. A PNG or WebP will not decode.",
        },
        { status: 400 }
      );
    }
  }

  if (single) {
    return NextResponse.json({ check: await checkPhoto(single) });
  }

  if (!searchId) {
    return NextResponse.json({ error: "Pass a searchId." }, { status: 400 });
  }

  const enrichment = await readEnrichment(searchId);
  if (!enrichment) {
    return NextResponse.json(
      { error: "No enrichment on disk for that searchId." },
      { status: 404 }
    );
  }

  const people = (
    await Promise.all((enrichment.internalIds ?? []).map((id) => readPerson(id)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  const pending = people.filter((p) => force || !p.photo);
  const urls = pending.map((p) => {
    const d = p.crustdata.data as Record<string, any>;
    return (
      d.basic_profile?.profile_picture_permalink ??
      d.professional_network?.profile_picture_permalink ??
      null
    );
  });

  const checks = await checkPhotos(urls);
  for (let i = 0; i < pending.length; i += 1) {
    await attachPhoto(pending[i].internalId, checks[i]);
  }

  const all = [
    ...checks,
    ...people.filter((p) => !pending.includes(p)).map((p) => p.photo!.data),
  ];

  return NextResponse.json({
    searchId,
    people: people.length,
    checked: checks.length,
    cached: people.length - pending.length,
    withPhoto: all.filter((c) => c.status === "ok").length,
    openToWorkFrame: all.filter((c) => c.openToWorkFrame).length,
    /** Every reading, so a wrong call can be inspected rather than
     *  merely doubted. */
    results: people.map((p, i) => {
      const c = pending.includes(p) ? checks[pending.indexOf(p)] : p.photo?.data;
      return {
        internalId: p.internalId,
        name: p.name,
        status: c?.status ?? "no_photo",
        frame: c?.openToWorkFrame ?? false,
        arcGreen: c?.arcGreen ?? 0,
        topGreen: c?.topGreen ?? 0,
        hueSpread: c?.hueSpread ?? null,
        url: c?.url ?? null,
      };
    }),
  });
}
