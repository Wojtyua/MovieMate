import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const authError = context.url.searchParams.get("error");
  const authErrorDescription = context.url.searchParams.get("error_description");

  if (authError) {
    const message = authErrorDescription ?? authError;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  const code = context.url.searchParams.get("code");
  const supabase = createClient(context.request.headers, context.cookies);

  if (!code || !supabase) {
    return context.redirect("/auth/signin");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/sessions");
};
