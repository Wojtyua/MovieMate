import { OPENROUTER_API_KEY, AI_MODEL } from "astro:env/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Cheap small default model; `AI_MODEL` overrides without a code change (S-04 retune). */
const DEFAULT_AI_MODEL = "openai/gpt-5.4-mini";

/** OpenRouter's recommended attribution headers (used for usage dashboards/ranking). */
const APP_REFERER = "https://moviemate.pages.dev";
const APP_TITLE = "MovieMate";

/** Default timeout for the extraction call; AI now sits on the `<10s` critical path. */
const DEFAULT_EXTRACT_TIMEOUT_MS = 2500;
const DEFAULT_EXTRACT_MAX_TOKENS = 512;

export interface ExtractOptions {
  timeoutMs?: number;
  maxTokens?: number;
  schemaName?: string;
}

export interface AiClient {
  readonly model: string;
  complete(messages: { role: string; content: string }[], maxTokens: number): Promise<Response>;
  /**
   * Strict-structured-output extraction. Posts `response_format` json_schema
   * (`strict: true`), `temperature: 0`, and an internal AbortController-backed
   * timeout. Returns the parsed object typed as `T`, or `null` on missing key,
   * non-ok status, abort/timeout, or any parse error (mirrors the
   * `return null, never throw` contract on the rest of this client).
   */
  extract<T>(
    messages: { role: string; content: string }[],
    schema: Record<string, unknown>,
    opts?: ExtractOptions,
  ): Promise<T | null>;
}

/**
 * Returns a workerd-safe OpenRouter client (OpenAI-compatible over raw `fetch`),
 * or `null` when the API key is absent — mirroring the graceful-degradation
 * contract in `supabase.ts` (return `null`, never throw on missing config).
 */
export function createAiClient(): AiClient | null {
  if (!OPENROUTER_API_KEY) {
    return null;
  }
  const model = AI_MODEL ?? DEFAULT_AI_MODEL;
  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": APP_REFERER,
    "X-Title": APP_TITLE,
  };
  return {
    model,
    complete(messages, maxTokens) {
      return fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      });
    },
    async extract<T>(
      messages: { role: string; content: string }[],
      schema: Record<string, unknown>,
      opts?: ExtractOptions,
    ): Promise<T | null> {
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS;
      const maxTokens = opts?.maxTokens ?? DEFAULT_EXTRACT_MAX_TOKENS;
      const schemaName = opts?.schemaName ?? "extraction";
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0,
            response_format: {
              type: "json_schema",
              json_schema: { name: schemaName, strict: true, schema },
            },
          }),
        });
        if (!response.ok) {
          return null;
        }
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          return null;
        }
        return JSON.parse(content) as T;
      } catch {
        // Abort/timeout, network failure, or malformed JSON — fail soft.
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Single-request liveness check: a minimal completion with a tiny token budget.
 * Resolves `false` when unconfigured or on any error; no retries (stays within
 * the workerd subrequest budget). The budget is 16 (not 1) because the gpt-5
 * default family enforces `max_output_tokens >= 16` and 400s below it.
 */
export async function pingAi(): Promise<boolean> {
  const client = createAiClient();
  if (!client) {
    return false;
  }
  try {
    const response = await client.complete([{ role: "user", content: "ping" }], 16);
    return response.ok;
  } catch {
    return false;
  }
}
