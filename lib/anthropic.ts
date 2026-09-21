/**
 * Every call to Anthropic goes through this file, so "what does this tool
 * spend money on" has one answer you can read in ten seconds.
 *
 *   HAIKU  - skill resolution and the autocomplete helpers. Narrow, high
 *            volume, cached.
 *   SONNET - the intake call. Once per role, cached, and it carries most of
 *            the judgement in the tool: normalizing the title, splitting
 *            synonyms from adjacent titles, telling skills from backgrounds
 *            from traits, grounding each claim in the ad. About two cents
 *            more per role than Haiku, which makes it the cheapest place in
 *            the tool to spend on capability.
 */
export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-5";

/**
 * Whether model answers are cached to disk.
 *
 * Off while the prompts are still moving. A cached answer is keyed by its
 * inputs, not by the prompt that produced it, so every prompt edit would
 * otherwise need a matching cache version bump and a stale answer would
 * quietly survive the one you forgot.
 *
 * Worth turning back on before a demo: it makes a repeated role instant and
 * free, and it means a dead network cannot break a run.
 */
export const CACHE_ENABLED = false;

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/**
 * Models that still accept `temperature`. Newer ones reject the parameter
 * with a 400 rather than ignoring it, so it cannot simply be sent to
 * everything. Where it is accepted we send 0, because these calls are
 * cached and identical input should give identical output.
 */
const ACCEPTS_TEMPERATURE = new Set<string>([HAIKU]);

/**
 * Models that accept an assistant message prefill. Opening the reply with
 * `{` is the cleanest way to stop a model writing a preamble, but newer
 * models reject a conversation that does not end with a user message.
 * Without it we rely on the system prompt asking for bare JSON, and on
 * extractJson to find the object inside whatever comes back.
 */
const SUPPORTS_PREFILL = new Set<string>([HAIKU]);

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local, add your key, and restart the dev server."
    );
    this.name = "MissingApiKeyError";
  }
}

/**
 * Pull the first complete JSON object out of a reply.
 *
 * Brace counting rather than first-brace-to-last-brace, because that naive
 * span breaks on any prose around the object: a `{` in a preamble starts it
 * too early, and a `}` in a trailing sentence ends it too late. Quotes and
 * escapes are tracked so a brace inside a string does not affect the depth.
 *
 * Returns null when the object never closes, which means the reply was cut
 * off at max_tokens.
 */
function findJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function parseJsonReply(text: string): unknown {
  const candidate = findJsonObject(text);
  if (candidate === null) {
    throw new Error(
      text.trim()
        ? "The reply held no complete JSON object, so it was probably cut off at max_tokens."
        : "The reply was empty."
    );
  }
  return JSON.parse(candidate);
}

/**
 * Ask a model for a JSON object.
 *
 * Where the model allows it the reply is prefilled with an opening brace,
 * which prevents a preamble. Where it does not, the system prompt asks for
 * bare JSON and the object is found inside whatever comes back.
 *
 * A malformed reply is retried once with the parser's own complaint handed
 * back. Models produce invalid JSON rarely but not never, usually an
 * unescaped quote inside a string, and a retry costs a fraction of a cent
 * against a failure the operator would otherwise meet as a raw parse error.
 */
export async function askForJson(options: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  const prefill = SUPPORTS_PREFILL.has(options.model);
  let user = options.user;
  let lastText = "";
  let lastProblem = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        ...(ACCEPTS_TEMPERATURE.has(options.model) ? { temperature: 0 } : {}),
        system: options.system,
        messages: prefill
          ? [
              { role: "user", content: user },
              { role: "assistant", content: "{" },
            ]
          : [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    lastText = prefill ? `{${text}` : text;

    try {
      return parseJsonReply(lastText);
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err);
      user = `${options.user}\n\nYour previous reply could not be parsed as JSON: ${lastProblem}\n\nReturn the same content again as one valid JSON object and nothing else. Escape every quote that appears inside a string value.`;
    }
  }

  // The raw reply goes into the message. Without it, the next failure is
  // another guess at what the model actually wrote.
  throw new Error(
    `The model did not return valid JSON, even after a retry (${lastProblem}). Reply began: ${lastText
      .slice(0, 400)
      .replace(/\s+/g, " ")}`
  );
}
