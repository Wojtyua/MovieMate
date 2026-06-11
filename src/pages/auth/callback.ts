import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const authError = context.url.searchParams.get("error");
  const authErrorDescription = context.url.searchParams.get("error_description");

  if (authError) {
    const message = authErrorDescription ?? authError;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin");
  }

  // Token-hash flow (email confirmation / recovery): works in any browser
  // because it carries no client-stored PKCE verifier. Requires the Supabase
  // email template to point at /auth/callback?token_hash=...&type=...
  const tokenHash = context.url.searchParams.get("token_hash");
  const type = context.url.searchParams.get("type");

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
    }
    return context.redirect("/");
  }

  // PKCE code flow (OAuth providers): verifier cookie lives in the same browser.
  const code = context.url.searchParams.get("code");
  if (!code) {
    return context.redirect("/auth/signin");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/");
};
