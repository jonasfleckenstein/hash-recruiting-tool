import jpeg from "jpeg-js";

/**
 * Detecting LinkedIn's #OpenToWork frame in a profile photo.
 *
 * Crustdata carries no open-to-work field, and GitHub's hireable
 * checkbox is a different and weaker thing: nobody is ever prompted to
 * untick it, so it rots. LinkedIn prompts people to remove the frame
 * when they stop looking, which makes it the better signal. The only
 * way to read it is from the picture, because the frame is burned into
 * the image rather than applied at render time.
 *
 * No OCR and no model. The frame is a solid arc of one colour, so
 * sampling pixels along a circle and classifying them by hue is enough.
 *
 * Measured against LinkedIn's own frame asset:
 *
 *   - it is an ARC, not a ring: roughly 4 o'clock round the bottom to
 *     10 o'clock, fading at both ends. The top is untouched.
 *   - white "#OPENTOWORK" text sits on the green, so the arc is a
 *     mixture and cannot be expected to match solidly.
 *   - the green is desaturated olive, about #4A7638: hue 103, saturation
 *     0.36, lightness 0.34. Not a vivid green, so the saturation floor
 *     has to be low, which in turn makes the shape checks carry the
 *     weight.
 *
 * This is inference from pixels. It belongs on a card as "the photo
 * carries the frame", never as "this person is looking".
 */

/** Where the arc is, in image coordinates with y running downward:
 *  0 is 3 o'clock, 90 is 6 o'clock, 180 is 9 o'clock. */
const ARC_FROM = 40;
const ARC_TO = 200;

/** The top of the circle, which the frame never reaches. A photo that
 *  is green here is a green photo, not a framed one. */
const TOP_FROM = 250;
const TOP_TO = 290;

/** Fractions of the radius to sample. The band is thin, so three passes
 *  tolerate a frame drawn slightly wider or narrower. */
const RADII = [0.88, 0.92, 0.96];

/**
 * How much of the arc must read as frame green.
 *
 * Well under 1 because the lettering breaks it up. A real frame
 * measured 0.81 and every unframed photo in a live pool of 35 measured
 * essentially zero, so the separation is wide and this threshold is
 * deliberately generous: better to tolerate a poorly cropped or
 * low-quality frame than to miss one.
 */
const MIN_ARC_GREEN = 0.4;
/** How much green the top may contain before this looks like scenery. */
const MAX_TOP_GREEN = 0.15;
/**
 * Degrees of hue spread tolerated among matching pixels.
 *
 * The strongest of the three checks. A real frame measured 2.1 degrees:
 * it is printed, so it is one colour. Anything natural that happens to
 * be green, foliage or a wall or clothing, varies by twenty or more.
 * Ten leaves five times the observed margin while still ruling that
 * out.
 */
const MAX_HUE_SPREAD = 10;

export interface PhotoCheck {
  url: string | null;
  checkedAt: string;
  status: "ok" | "no_photo" | "fetch_failed" | "decode_failed";
  /** The finding. False whenever status is not "ok". */
  openToWorkFrame: boolean;
  /** Everything the decision was made on, so a wrong call can be
   *  understood rather than just disbelieved. */
  arcGreen: number;
  topGreen: number;
  hueSpread: number | null;
  note?: string;
}

function empty(url: string | null, status: PhotoCheck["status"], note?: string): PhotoCheck {
  return {
    url,
    checkedAt: new Date().toISOString(),
    status,
    openToWorkFrame: false,
    arcGreen: 0,
    topGreen: 0,
    hueSpread: null,
    note,
  };
}

/** Hue in degrees, saturation and lightness in 0..1. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** The frame's own green, allowing for JPEG artefacts and the gradient
 *  at the arc's ends. */
function isFrameGreen(h: number, s: number, l: number): boolean {
  return h >= 80 && h <= 140 && s >= 0.15 && s <= 0.8 && l >= 0.1 && l <= 0.55;
}

/** Circular standard deviation, because hue wraps at 360. */
function hueSpread(hues: number[]): number | null {
  if (hues.length === 0) return null;
  let sin = 0;
  let cos = 0;
  for (const h of hues) {
    const rad = (h * Math.PI) / 180;
    sin += Math.sin(rad);
    cos += Math.cos(rad);
  }
  const r = Math.sqrt(sin * sin + cos * cos) / hues.length;
  if (r >= 1) return 0;
  return (Math.sqrt(-2 * Math.log(r)) * 180) / Math.PI;
}

function sampleBand(
  data: Uint8Array,
  width: number,
  height: number,
  from: number,
  to: number
): { green: number; total: number; hues: number[] } {
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) / 2;
  let green = 0;
  let total = 0;
  const hues: number[] = [];

  for (const rf of RADII) {
    const r = R * rf;
    for (let deg = from; deg <= to; deg += 2) {
      const rad = (deg * Math.PI) / 180;
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const [h, s, l] = toHsl(data[i], data[i + 1], data[i + 2]);
      total += 1;
      if (isFrameGreen(h, s, l)) {
        green += 1;
        hues.push(h);
      }
    }
  }
  return { green, total, hues };
}

/**
 * Analyse already-decoded bytes.
 *
 * Split out from fetching so the same detector can be pointed at a
 * local file. Being able to try a known-framed photo matters: nobody in
 * a pool of employed engineers has the frame, so without a sample the
 * thresholds are untested guesses.
 */
export function analyseImage(bytes: Uint8Array, url: string | null): PhotoCheck {
  let image: { width: number; height: number; data: Uint8Array };
  try {
    // useTArray keeps this a typed array rather than a Buffer copy.
    image = jpeg.decode(bytes, { useTArray: true }) as typeof image;
  } catch {
    return empty(url, "decode_failed", "Not a decodable JPEG.");
  }

  const arc = sampleBand(image.data, image.width, image.height, ARC_FROM, ARC_TO);
  const top = sampleBand(image.data, image.width, image.height, TOP_FROM, TOP_TO);

  const arcGreen = arc.total > 0 ? arc.green / arc.total : 0;
  const topGreen = top.total > 0 ? top.green / top.total : 0;
  const spread = hueSpread(arc.hues);

  /**
   * Three conditions, and the second is the one that matters. Plenty of
   * photos are green somewhere; only a frame is green along the bottom
   * arc and not at the top.
   */
  const openToWorkFrame =
    arcGreen >= MIN_ARC_GREEN &&
    topGreen <= MAX_TOP_GREEN &&
    spread !== null &&
    spread <= MAX_HUE_SPREAD;

  return {
    url,
    checkedAt: new Date().toISOString(),
    status: "ok",
    openToWorkFrame,
    arcGreen: Math.round(arcGreen * 100) / 100,
    topGreen: Math.round(topGreen * 100) / 100,
    hueSpread: spread === null ? null : Math.round(spread * 10) / 10,
  };
}

/**
 * Fetch a profile photo and look for the frame.
 *
 * Crustdata rehosts these on its own S3 without signing or expiry, so
 * this never touches LinkedIn and there is no token to go stale.
 */
export async function checkPhoto(url: string | null | undefined): Promise<PhotoCheck> {
  if (!url) return empty(null, "no_photo");

  let bytes: Uint8Array;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return empty(url, "fetch_failed", `HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return empty(url, "fetch_failed", err instanceof Error ? err.message : undefined);
  }

  return analyseImage(bytes, url);
}

/** Check several photos without opening thirty sockets at once. */
export async function checkPhotos(
  urls: (string | null | undefined)[],
  concurrency = 4
): Promise<PhotoCheck[]> {
  const out: PhotoCheck[] = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= urls.length) return;
      out[i] = await checkPhoto(urls[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, worker)
  );
  return out;
}
