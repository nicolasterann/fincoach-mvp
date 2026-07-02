# Stage reports — index

Kipu shipped in numbered stages. Per-stage retrospectives were written as
standalone files **through Stage 21**; from **Stage 22 onward** they were
consolidated into the newest-first running log `docs/BUILD_PROGRESS.md` (and the
in-session final reports) rather than separate files. This index makes the trail
self-explaining so nothing looks skipped.

## Standalone report files (Stages 16–21)

| Stage | File | Topic |
|---|---|---|
| 16 | `docs/STAGE16_REPORT.md` | Budget intelligence, category learning, behavioral spending |
| 17 | `docs/STAGE17_REPORT.md` | Goals, mini-goals, wealth builder, priorities |
| 18 | `docs/STAGE18_REPORT.md` | Personalization, memory & life context |
| 19 | `docs/STAGE19_REPORT.md` | Household / shared finance |
| 20 | `docs/STAGE20_REPORT.md` | Personality test + FX/multicurrency + snapshots (PASS 1) |
| 20 P2 | `docs/STAGE20_PASS2_REPORT.md` | Visual dashboard + household beta polish |
| 21 | `docs/STAGE21_REPORT.md` | Pre-beta hardening + public surface |

(Stages 1–15 predate the per-stage-report convention; their history is in
`docs/BUILD_PROGRESS.md`.)

## Stages 22–27 — in `docs/BUILD_PROGRESS.md` + commit history

No standalone `STAGE22..27_REPORT.md` files exist by design. Their retrospectives
are the newest-first heads of `docs/BUILD_PROGRESS.md` and the final in-session
reports; the commits are:

| Stage | Commit | Topic |
|---|---|---|
| 22–23 | `ad77956`, `533053e` | Structured onboarding wizard + CSV import; 10-persona stress test |
| 24 | `b9f7008` | Display-currency toggle + biweekly anchor + base_amount write-fix |
| 25 | `ce85ccc` | Beta-readiness mega review — money truth, one-number coherence, auth recovery, household fixes |
| 26 | `0c9ee91` | Universal chat control + scheduled-changes engine + 13 tools |
| 27 | `b97bd33` | UI/UX elevation — living dashboard, metric drilldowns, consumer-grade polish |

For per-module status see the root `README.md`; for the at-a-glance phase board
see the "Current phase & module status" section of `docs/BUILD_PROGRESS.md`.
