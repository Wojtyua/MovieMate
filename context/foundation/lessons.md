# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Reconcile the roadmap Backlog Handoff table after archiving

- **Context**: After any `/10x-archive` run, when `context/foundation/roadmap.md` has a Backlog Handoff table referencing the archived change-id.
- **Problem**: `/10x-archive` updates only the At-a-glance Status, the item-body Status, and the Done section — it leaves the Backlog Handoff table row stale (still "in progress", outdated notes), so the roadmap shows contradictory states for the same item after archiving.
- **Rule**: After archiving a change, also reconcile the roadmap's Backlog Handoff table row for that change-id: set the "Ready for /10x-plan" column to `done` and update Notes to point at the archived path.
- **Applies to**: archive, implement

## Reproduce and confirm a bug's root cause before planning a fix

- **Context**: Każdy post-deploy bug report (lub input „bug + proponowany fix" do /10x-frame), gdzie razem z symptomem podana jest hipoteza root-cause — zwłaszcza zgłoszenia reliability/security/concurrency na granicy SSR/auth/request.
- **Problem**: Planowanie fixa pod niepotwierdzoną hipotezę marnuje pracę na nieistniejący lub źle zlokalizowany błąd. W concurrent-user-isolation hipoteza „shared auth state" była błędna, a symptom się nie odtworzył — bez weryfikacji zbudowano by „hardening" fix na próżno.
- **Rule**: Zanim zaplanujesz fix zgłoszonego błędu, odtwórz symptom i potwierdź root cause wobec aktualnego kodu + live diagnostics (/10x-research). Hipotezę ze zgłoszenia traktuj jako trop do weryfikacji, nigdy jako fakt; jeśli nie da się odtworzyć — zamknij jako no-defect zamiast budować spekulacyjny fix.
- **Applies to**: frame, research, plan, plan-review

## Reconcile test-plan.md §3 Phased Rollout after archiving a rollout-phase change

- **Context**: After any `/10x-archive` run that closes a change implementing a `context/foundation/test-plan.md` §3 rollout phase (the change folder matches a phase's "Change folder" column).
- **Problem**: `/10x-archive` only reconciles the roadmap — it never touches `test-plan.md`. So the §3 Phased Rollout table is left stale: Status still reads `implementing`/`change opened` and the Change folder column still points at `context/changes/<id>/` even though the folder moved to `context/archive/`. §4 Stack can also lie (e.g. "Vitest none yet") after a phase installed the tool.
- **Rule**: After archiving a change tied to a test-plan rollout phase, reconcile `test-plan.md` §3: set that phase's Status to `complete` and repoint its Change folder column to the archived path. Also sync §4 Stack if the phase installed/standardized a tool. Mirror of the roadmap Backlog-Handoff reconciliation lesson.
- **Applies to**: archive, implement
