# E2E Testing Rules (Playwright)

The two quality levers for this project's E2E layer. `/10x-e2e` reads this file
before generating any test; the seed (`seed.spec.ts`) is the worked exemplar.
Source: `.claude/skills/10x-e2e/references/e2e-quality-rules.md`, tuned to 10xMovie.

## The rules block

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. This app has
  **no `data-testid`** anywhere and uses semantic HTML (labels, headings,
  `<article>`, `aria-pressed`), so role/label locators are always available.
- Never use CSS selectors, XPath, or DOM structure to locate elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- Assert the **business outcome** (three picks render), not status codes or URLs.
- Use unique test data and rely on the fresh-user-per-run setup for isolation;
  add cleanup (`afterEach`) only when a test creates a uniquely-named entity.
- Authenticate via `storageState` (see `auth.setup.ts`) — never log in through the
  UI inside an individual test.

## Project-specific notes

- **Auth**: the `setup` project signs up a unique user (`e2e-${Date.now()}@…`) and
  saves `playwright/.auth/user.json`; the `chromium` project injects it. Tests start
  already logged in and can hit protected routes (`/sessions`) directly.
- **Genre buttons are ambiguous**: each genre name is a button in _both_ the
  Preferred and Avoid pickers (and again under the optional second viewer). Scope to
  the Preferred picker — it renders first, so `getByRole('button', { name: 'Action',
exact: true }).first()`. Do not reach for `nth-child`/CSS.
- **Determinism**: leave the **Note** field empty and select a common preferred
  genre. A note triggers the OpenRouter/AI path (non-deterministic); an empty
  preferred set gives no discover hint. Both make "three picks" flaky.
- **Real vs mocked**: auth, routing, Supabase, and SSR-on-workerd stay real. TMDB is
  called server-side (browser `page.route()` can't intercept it) and is used live by
  decision — degradation/mocking of the external edge is Risk #2 (integration + MSW),
  not the browser layer.

## Governing rules

- **Don't generate E2E from scratch.** Start from `context/foundation/test-plan.md`:
  pick the highest browser-level risks. A risk needs E2E when it crosses several
  boundaries (auth, routing, API, DB) or exists only in the rendered UI.
- **Name the test after the risk.** The assertion must fail if the risk
  materializes — control question: _would this fail if the test-plan risk came true?_
  If not, it's decorative.
- E2E is the slowest, most flake-prone layer — one hardened test per risk, not
  coverage for its own sake.
