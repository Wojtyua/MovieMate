import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/profiles", "/sessions"];

export const onRequest = defineMiddleware(async (context, next) => {
  const code = context.url.searchParams.get("code");
  if (code && context.url.pathname === "/") {
    const callbackUrl = new URL("/auth/callback", context.url);
    callbackUrl.search = context.url.search;
    return context.redirect(callbackUrl.toString());
  }

  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
