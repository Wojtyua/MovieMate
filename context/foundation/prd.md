---
project: "MovieMate"
version: 2
status: draft
created: 2026-05-26
updated: 2026-05-29
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

MovieMate addresses decision paralysis during a shared movie night: two people want to watch something together, but the available catalogs give them too many options, so choosing a title can take around 40 minutes and sometimes ends with no film being watched.

The product insight is that the useful unit is not another film catalog, but a short decision flow for a specific session: a single operator weighs two tastes in one session. MovieMate narrows externally sourced movie candidates using both viewer profiles, session constraints, and a simple scoring rule, then returns three justified recommendations instead of another long list. At 100x the initial user scale, the recommendation rule would probably not change.

## User & Persona

Primary persona: one logged-in operator who chooses a film for a movie night shared with a second person, weighing both tastes in a single session rather than guessing for one.

Example context: Wojtek opens MovieMate and represents both his and his girlfriend's taste in one session. One taste wants something light, the other wants mystery or tension; they want to avoid horror and very heavy drama, and they have around two hours. The second person does not log in; the operator captures both tastes as two viewer profiles.

## Success Criteria

### Primary

- A logged-in user can complete the first movie-night flow: create two viewer profiles, start a movie-night session, enter session preferences, receive three scored recommendations from externally sourced movie candidates, select one recommendation, and record that recommended film as watched.

### Secondary

- Each recommendation has a short, understandable AI-generated justification.

### Guardrails

- The product must not show a long list of films in the MVP; the decision output is at most three recommendations.

## User Stories

### US-01: User chooses a movie for a movie night

- **Given** a logged-in user with two viewer profiles
- **When** they start a movie-night session, enter session preferences, and request recommendations
- **Then** MovieMate shows at most three scored recommendations with roles, and the user can select one recommendation and later record it as watched

#### Acceptance Criteria

- The recommendation output contains no more than three films.
- Each recommendation is labeled as safe pick, compromise pick, or wild card, and the wild card differs from the safe pick in genre or tone.
- The user can select one recommendation to finish the decision flow.
- The selected recommendation can be marked as watched, which excludes it from future candidate retrieval for the account.

## Functional Requirements

### Account & Profiles

- FR-001: User can log in and access only their own data. Priority: must-have
  > Socrates: Counter-argument considered: the pair may use one device, so data separation does not create immediate MVP value. Resolution: kept as must-have; the account anchors viewer profiles and saved movie-night sessions.
- FR-002: User can create and edit two viewer profiles. Priority: must-have
  > Socrates: Counter-argument considered: two profiles assume a stable pair, while the MVP could focus on a one-off decision. Resolution: kept as must-have; the core product value is combining preferences from two people.

### Movie-Night Session

- FR-003: User can start a movie-night session. Priority: must-have
  > Socrates: Counter-argument considered: sessions have limited value before watch history exists. Resolution: kept as must-have; the session represents the concrete evening, its mood, and its constraints.
- FR-004: User can save session preferences including mood, preferred genres, excluded genres, runtime limit, intensity, and an extra note. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; session preferences are the core of matching recommendations to the specific evening. Resolution: kept as written.

### Candidate Retrieval & Scoring

- FR-005: User can request movie candidates from TMDB's discover endpoint using hard filters (genres, runtime, rating, release window) derived from session preferences; semantic preference matching happens locally in the scoring step (FR-007), not in the external query. Priority: must-have
  > Socrates: Counter-argument considered: a movie catalog can produce too many random or poorly targeted candidates without a good retrieval strategy. Resolution: kept as must-have with a realistic strategy; TMDB discover supports structured filters (genre, runtime, rating, year) but not mood or free-text matching, so candidate retrieval is filter-based and all preference-alignment is delegated to the local scoring rule rather than expected from the external API.
- FR-006: User can have movie candidates hard-filtered for critical constraints such as runtime and strongly down-ranked for excluded genres. Priority: must-have
  > Socrates: Counter-argument considered: hard filtering can remove good films because metadata is imperfect. Resolution: revised; use hard filtering for critical constraints such as runtime, and strong scoring penalties for excluded genres.
- FR-007: User can have movie candidates scored by both viewers' preferences, mood, runtime, rating, and popularity. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; testable scoring is needed so AI does not become the whole recommendation mechanism. Resolution: kept as written.

### Recommendations

- FR-008: User can see at most three recommendations for a session. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; the three-item limit is the main response to decision paralysis. Resolution: kept as written.
- FR-009: User can see each recommendation labeled as safe pick, compromise pick, or wild card, and the three picks must be meaningfully distinct (the wild card differs from the safe pick in genre or tone) so the set does not collapse into three near-identical films. Priority: must-have
  > Socrates: Counter-argument considered: with two tastes and a narrow candidate pool the three roles can come out nearly identical, making the labels cosmetic. Resolution: added a diversity guardrail; the wild card must differ from the safe pick in genre or tone, otherwise the role split adds no decision value.
- FR-010: User can read a short AI-generated justification for each recommendation. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; the justification helps the user trust why a recommendation fits the session. Resolution: kept as written.
- FR-011: User can select one recommendation. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; selecting one recommendation closes the decision flow. Resolution: kept as written.
- FR-012: User can mark a selected recommendation as watched; watched films are excluded from future candidate retrieval so the account does not get re-recommended a film it already saw. Priority: must-have
  > Socrates: Counter-argument considered: a watch history feeding the scoring rule sounds valuable but, for one pair, holds only a handful of entries and contributes almost nothing as a scoring signal while costing real engineering. Resolution: scoped down; in the MVP "watched" exists only as a deduplication mechanism (exclude seen films from new candidates), not as a scoring input or a browsable history view.

## Non-Functional Requirements

- A typical completed movie-night preference submission returns recommendations within 10 seconds.

## Business Logic

MovieMate selects films that best fit the current viewing session by combining both viewer profiles, session constraints, and externally sourced film metadata.

The rule consumes the current session's mood, preferred genres, excluded genres, maximum runtime, intensity, and optional text note, plus the two viewer profiles. Films already marked as watched are excluded from candidate retrieval; watch history is a deduplication filter, not a scoring signal in the MVP.

The output is three recommendation roles: safe pick, compromise pick, and wild card. Each role is chosen from scored movie candidates so the operator receives a small, varied decision set instead of another catalog-like list; the wild card differs from the safe pick in genre or tone.

The user encounters the rule after submitting the movie-night preferences: MovieMate retrieves candidates from TMDB using hard filters, scores the remaining options against both tastes and the session constraints, penalizes excluded genres, and explains why each recommendation fits.

## Access Control

Users access MovieMate by logging in with email and password. OAuth is deferred to later; for a single pair sharing one device it adds provider setup and redirect handling without meaningful MVP value.

The MVP uses a flat access model: one logged-in user manages one account containing two viewer profiles. There are no separate roles for owner, member, guest, or invited viewer in the MVP.

## Non-Goals

- No OAuth / social login in the MVP; email-and-password only. OAuth may return later.
- No watch history as a scoring signal or browsable list in the MVP; "watched" exists only to exclude already-seen films from future candidates. No manual or imported watch history.
- No second-person login, invitation link, shared account, or realtime voting flow in the MVP; one logged-in operator captures both tastes as two viewer profiles.
- No full film platform in the MVP: no reviews, comments, social features, or complete movie database.
- No full machine-learning recommendation system trained on a large user history in the MVP; recommendations use explicit session preferences, externally sourced film metadata, and transparent scoring.
- No streaming-service integration in the MVP. Where-to-watch information may be considered later as a lightweight informational feature, not as a larger streaming integration.

## Open Questions

No open questions.
