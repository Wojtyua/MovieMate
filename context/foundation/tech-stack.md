---
starter_id: 10x-astro-starter
package_manager: npm
project_name: moviemate
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

MovieMate is a small, after-hours web-app MVP with a 3-week target, login, persisted viewer/session data, and short AI-generated recommendation justifications. The recommended JavaScript/TypeScript starter for this product type is 10x Astro Starter, which gives the project an opinionated Astro + React + TypeScript base with Supabase for auth/database and Cloudflare Pages as the default deployment target. That keeps the first build focused on the movie-night decision flow instead of assembling auth, persistence, routing, and deployment from scratch. Payments, realtime collaboration, and background jobs are out of scope for the MVP, while AI is captured as a feature flag for the recommendation explanations.
