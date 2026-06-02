import { OPENROUTER_API_KEY, AI_MODEL } from "astro:env/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Cheap small default model; `AI_MODEL` overrides without a code change (S-04 retune). */
const DEFAULT_AI_MODEL = "openai/gpt-4o-mini";

/** OpenRouter's recommended attribution headers (used for usage dashboards/ranking). */
const APP_REFERER = "https://moviemate.pages.dev";
const APP_TITLE = "MovieMate";

export interface AiClient {
  readonly model: string;
  complete(messages: { role: string; content: string }[], maxTokens: number): Promise<Response>;
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
  return {
    model,
    complete(messages, maxTokens) {
      return fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": APP_REFERER,
          "X-Title": APP_TITLE,
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      });
    },
  };
}

/**
 * Single-request liveness check: a minimal completion with a tiny token budget.
 * Resolves `false` when unconfigured or on any error; no retries (stays within
 * the workerd subrequest budget).
 */
export async function pingAi(): Promise<boolean> {
  const client = createAiClient();
  if (!client) {
    return false;
  }
  try {
    const response = await client.complete([{ role: "user", content: "ping" }], 1);
    return response.ok;
  } catch {
    return false;
  }
}
