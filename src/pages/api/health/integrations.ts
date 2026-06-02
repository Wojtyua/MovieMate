import type { APIRoute } from "astro";
import { pingTmdb } from "@/lib/tmdb";
import { pingAi } from "@/lib/ai";

type ProviderStatus = "ok" | "fail";

function statusOf(reachable: boolean): ProviderStatus {
  return reachable ? "ok" : "fail";
}

export const GET: APIRoute = async (context) => {
  // Guard in-route (not via PROTECTED_ROUTES): this is an API, so return a clean
  // 401 JSON rather than a 302 redirect to signin.
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Two single-request pings, run concurrently (2 subrequests total).
  const [tmdbOk, aiOk] = await Promise.all([pingTmdb(), pingAi()]);

  const detail: Record<string, string> = {};
  if (!tmdbOk) {
    detail.tmdb = "TMDB ping failed — check TMDB_READ_ACCESS_TOKEN and reachability.";
  }
  if (!aiOk) {
    detail.ai = "OpenRouter ping failed — check OPENROUTER_API_KEY and reachability.";
  }

  const body: {
    tmdb: ProviderStatus;
    ai: ProviderStatus;
    detail?: Record<string, string>;
  } = {
    tmdb: statusOf(tmdbOk),
    ai: statusOf(aiOk),
  };
  if (Object.keys(detail).length > 0) {
    body.detail = detail;
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
