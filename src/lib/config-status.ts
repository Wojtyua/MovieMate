import { SUPABASE_URL, SUPABASE_KEY, TMDB_READ_ACCESS_TOKEN, OPENROUTER_API_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    name: "TMDB",
    configured: Boolean(TMDB_READ_ACCESS_TOKEN),
    message: "TMDB nie jest skonfigurowany — dane o filmach są niedostępne.",
    docsUrl: "https://developer.themoviedb.org/docs/getting-started",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    name: "AI (OpenRouter)",
    configured: Boolean(OPENROUTER_API_KEY),
    message:
      "OpenRouter nie jest skonfigurowany — analiza notatki AI jest wyłączona; rekomendacje korzystają tylko z gatunków.",
    docsUrl: "https://openrouter.ai/docs/quickstart",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
