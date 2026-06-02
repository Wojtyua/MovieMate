import { TMDB_READ_ACCESS_TOKEN } from "astro:env/server";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export interface TmdbClient {
  readonly baseUrl: string;
  request(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * Returns a workerd-safe TMDB client, or `null` when the read-access token is
 * absent — mirroring the graceful-degradation contract in `supabase.ts`
 * (return `null`, never throw on missing config).
 */
export function createTmdbClient(): TmdbClient | null {
  if (!TMDB_READ_ACCESS_TOKEN) {
    return null;
  }
  return {
    baseUrl: TMDB_BASE_URL,
    request(path, init) {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${TMDB_READ_ACCESS_TOKEN}`);
      headers.set("Accept", "application/json");
      return fetch(`${TMDB_BASE_URL}${path}`, { ...init, headers });
    },
  };
}

/**
 * Single-request liveness check against TMDB's authentication endpoint.
 * Resolves `false` when unconfigured or on any error; no retries (stays within
 * the workerd subrequest budget).
 */
export async function pingTmdb(): Promise<boolean> {
  const client = createTmdbClient();
  if (!client) {
    return false;
  }
  try {
    const response = await client.request("/authentication");
    return response.ok;
  } catch {
    return false;
  }
}
