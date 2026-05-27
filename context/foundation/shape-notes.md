---
project: "MovieMate"
context_type: greenfield
created: 2026-05-26
updated: 2026-05-26
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "Decision paralysis: the product addresses too many film choices at the moment of choosing what to watch."
    - topic: "core insight"
      decision: "Streaming and film catalogs show too many options; MovieMate reduces the choice to three justified recommendations for one concrete movie-night session."
    - topic: "primary persona scope"
      decision: "One pair / two viewers inside one account."
    - topic: "auth strategy"
      decision: "Login with email/password or OAuth."
    - topic: "role model"
      decision: "Flat access model: one logged-in user manages two viewer profiles inside the account."
    - topic: "MVP scope"
      decision: "Scoped down to login, two viewer profiles, movie-night session, session preferences, external movie catalog candidate fetch, filtering/scoring, three recommendations, selecting one recommendation, and recording only films watched through an app recommendation."
    - topic: "timeline budget"
      decision: "Three weeks of after-hours work."
    - topic: "secondary success"
      decision: "Recommendations have short, understandable AI-generated justifications."
    - topic: "guardrail"
      decision: "The app does not show a long list of films; it shows at most three recommendations."
    - topic: "functional requirements scope"
      decision: "MVP FRs include login, two viewer profiles, movie-night session, preferences, external movie catalog candidate retrieval, filtering/scoring, three recommendation roles, AI justification, selecting one recommendation, and saving only app-recommended watched films. Manual watch-history entry, import, and post-watch rating are out of MVP."
    - topic: "Socrates resolution for login"
      decision: "Login remains must-have because the account anchors viewer profiles and saved sessions, despite the pair likely using one device."
    - topic: "Socrates resolution for viewer profiles"
      decision: "Two viewer profiles remain must-have because the product is about combining two people's preferences, despite the MVP assuming a stable pair."
    - topic: "Socrates resolution for movie-night session"
      decision: "The movie-night session remains must-have because it represents the concrete evening and its constraints, despite limited value without watch history."
    - topic: "Socrates resolution for external movie catalog candidate retrieval"
      decision: "External movie catalog candidate retrieval remains must-have, but candidates should come from a preference-aligned strategy rather than random popularity."
    - topic: "Socrates resolution for filtering"
      decision: "Hard filtering is narrowed to critical constraints such as runtime; excluded genres strongly lower score to avoid losing good films due to imperfect metadata."
    - topic: "watch-history scope"
      decision: "The MVP keeps history in the business rule, but only stores films watched because of a MovieMate recommendation."
    - topic: "non-functional requirements"
      decision: "Typical recommendation generation should return results within 10 seconds."
    - topic: "product type"
      decision: "Website / web app."
    - topic: "target scale"
      decision: "Small: just the user or a handful of people."
    - topic: "scale probe"
      decision: "At 100x the initial scale, the recommendation rule would probably not change."
    - topic: "timeline framing"
      decision: "No hard deadline; after-hours work."
    - topic: "non-goals"
      decision: "MVP excludes manual/imported watch history, invitation links/shared accounts/realtime voting, full film-platform features, and a full ML recommendation system. Where-to-watch information can return later as an informational feature only, without heavy streaming integration."
  frs_drafted: 12
  quality_check_status: accepted
---

## Vision & Problem Statement

MovieMate addresses decision paralysis during a shared movie night: two people want to watch something together, but the available catalogs give them too many options, so choosing a title can take around 40 minutes and sometimes ends with no film being watched.

The product insight is that the useful unit is not another film catalog, but a short decision flow for a specific session: MovieMate narrows externally sourced movie candidates using both viewers' preferences, session constraints, app-generated watch history, and a simple scoring rule, then returns three justified recommendations instead of another long list.

At 100x the initial user scale, the recommendation rule would probably not change.

## User & Persona

Primary persona: a pair / two people who regularly watch films together and often struggle to agree on a concrete title.

Example context: Wojtek and his girlfriend want a film for the evening. One person wants something light, the other wants mystery or tension; they want to avoid horror and very heavy drama, and they have around two hours.

## Access Control

Users access MovieMate by logging in with email/password or OAuth.

The MVP uses a flat access model: one logged-in user manages one account containing two viewer profiles. There are no separate roles for owner, member, guest, or invited viewer in the MVP.

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
- Each recommendation is labeled as safe pick, compromise pick, or wild card.
- The user can select one recommendation to finish the decision flow.
- The selected recommendation can be recorded as watched and becomes part of the app-generated watch history.

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

- FR-005: User can request movie candidates from an external movie catalog using a preference-aligned candidate strategy rather than generic popularity. Priority: must-have
  > Socrates: Counter-argument considered: a movie catalog can produce too many random or poorly targeted candidates without a good retrieval strategy. Resolution: kept as must-have with clarified strategy; candidates should be sourced according to session preferences, not generic popularity alone.
- FR-006: User can have movie candidates hard-filtered for critical constraints such as runtime and strongly down-ranked for excluded genres. Priority: must-have
  > Socrates: Counter-argument considered: hard filtering can remove good films because metadata is imperfect. Resolution: revised; use hard filtering for critical constraints such as runtime, and strong scoring penalties for excluded genres.
- FR-007: User can have movie candidates scored by both viewers' preferences, mood, runtime, rating, and popularity. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; testable scoring is needed so AI does not become the whole recommendation mechanism. Resolution: kept as written.

### Recommendations

- FR-008: User can see at most three recommendations for a session. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; the three-item limit is the main response to decision paralysis. Resolution: kept as written.
- FR-009: User can see each recommendation labeled as safe pick, compromise pick, or wild card. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; the labels help the pair understand the type of decision, not only the ranking. Resolution: kept as written.
- FR-010: User can read a short AI-generated justification for each recommendation. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; the justification helps the user trust why a recommendation fits the session. Resolution: kept as written.
- FR-011: User can select one recommendation. Priority: must-have
  > Socrates: Counter-argument considered: no stronger counter-argument selected; selecting one recommendation closes the decision flow. Resolution: kept as written.
- FR-012: User can record a selected recommendation as watched so MovieMate stores only films watched because of an app recommendation. Priority: must-have
  > Socrates: Counter-argument considered: watch history can expand MVP scope if it becomes a general film library. Resolution: kept with a strict boundary; the MVP records only films watched through MovieMate recommendations, with no manual history import or broad history management.

## Business Logic

MovieMate selects films that best fit the current viewing session by combining both viewers' preferences, session constraints, app-generated watch history, and externally sourced film metadata.

The rule consumes the current session's mood, preferred genres, excluded genres, maximum runtime, intensity, and optional text note, plus the two viewer profiles and the history of films watched because of prior MovieMate recommendations.

The output is three recommendation roles: safe pick, compromise pick, and wild card. Each role is chosen from scored movie candidates so the pair receives a small decision set instead of another catalog-like list.

The user encounters the rule after submitting the movie-night preferences: MovieMate retrieves candidates, filters or penalizes them according to the session constraints, scores the remaining options, and explains why each recommendation fits.

## Non-Functional Requirements

- A typical completed movie-night preference submission returns recommendations within 10 seconds.

## Non-Goals

- No manual watch-history entry or imported watch history in the MVP; the app records only films watched because of a MovieMate recommendation.
- No invitation link, shared account, or realtime voting flow in the MVP; one logged-in account contains the two viewer profiles.
- No full film platform in the MVP: no reviews, comments, social features, or complete movie database.
- No full machine-learning recommendation system trained on a large user history in the MVP; recommendations use explicit session preferences, externally sourced film metadata, app-generated watch history, and transparent scoring.
- No streaming-service integration in the MVP. Where-to-watch information may be considered later as a lightweight informational feature, not as a larger streaming integration.

## Quality cross-check

- Access Control: present.
- Business Logic: present.
- Project artifacts: present.
- Timeline-cost acknowledgment: present; MVP is scoped to three weeks.
- Non-Goals: present.
- Preserved behavior: n/a for greenfield.

## Forward: Tech Stack / Data Source Notes

- Preferred movie catalog/data source for downstream technical selection: TMDB.
