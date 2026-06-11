import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const emailRedirectTo = new URL("/auth/callback", context.url.origin).href;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  // When email confirmation is disabled (e.g. local dev), signUp returns a live
  // session and the user is already signed in — land them on home instead of the
  // "check your email" interstitial. When confirmation is required, there is no
  // session yet, so route to the confirm-email page as before.
  if (data.session) {
    return context.redirect("/");
  }

  return context.redirect("/auth/confirm-email");
};
