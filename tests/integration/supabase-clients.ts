import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Local Supabase stack defaults (supabase/config.toml: API at 127.0.0.1:54321).
// The anon key is the well-known CLI default shipped by `supabase start`; it is
// not a secret. Override via SUPABASE_URL / SUPABASE_KEY in the environment to
// point the isolation suite at a different local stack.
const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const SUPABASE_URL = process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? DEFAULT_SUPABASE_ANON_KEY;

export interface AuthedClient {
  client: SupabaseClient;
  userId: string;
  email: string;
}

/**
 * Sign up a fresh, unique user against the local Supabase stack and return an
 * authenticated supabase-js client carrying that user's session token.
 *
 * Relies on `auth.enable_confirmations = false` (supabase/config.toml) so
 * `signUp` returns a live session with a real JWT — no email-confirmation step.
 * The returned client carries that session, so PostgREST runs every query as the
 * authenticated user and `auth.uid()` RLS policies apply — the same seam the app
 * relies on via `src/lib/supabase.ts`.
 */
export async function signUpClient(): Promise<AuthedClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `iso-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const password = `iso-pw-${Math.random().toString(36).slice(2, 12)}`;

  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(`signUp failed for ${email}: ${error.message}`);
  }
  if (!data.session || !data.user) {
    throw new Error(
      `signUp for ${email} returned no session — confirm auth.enable_confirmations = false on the local stack`,
    );
  }

  return { client, userId: data.user.id, email };
}
