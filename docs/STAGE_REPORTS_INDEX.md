# Stage reports — index

Kipu shipped in numbered stages **1–38**, and then in lettered **Bloques (A–H)**.
Those are **one continuous sequence, not two tracks** — same project, same running
log, same ship gates; only the label changed once the work stopped being "the next
number" and started being "the next block of the product". (Same framing in
`README.md` and `docs/AI_NATIVE_ARCHITECTURE.md` §5.)

Per-stage retrospectives were written as standalone files **through Stage 21**; from
**Stage 22 onward** — including every Bloque — they were consolidated into the
newest-first running log `docs/BUILD_PROGRESS.md` (and the in-session final reports)
rather than separate files. This index makes the trail self-explaining so nothing
looks skipped.

> **The standalone files (16–21) are frozen history.** Each one opens with a
> historical marker: they were written pre-rollout, so their "no commit / no deploy /
> awaiting approval" language describes the day they were written, not today. Every
> one of them shipped. Read the marker before the body.

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

## Stages 29–38 — same place (`docs/BUILD_PROGRESS.md` + commits)

**There is no Stage 28.** The numbering jumps 27 → 29; nothing was lost or
abandoned. Same convention as above: no standalone report files by design.

| Stage | Commit | Topic |
|---|---|---|
| 29 | `7f14d20` | Pre-beta gap-close — Margen confidence, chat 100% control, honest first-contact |
| 30 | `ca71afb` | Margen v2 (calendar-aware) + real-life data model, from founder onboarding feedback |
| 31 | `437ef98` | Onboarding nítido — every datum connected, notes that act, integral validation |
| 32 | `dcfcc0a` | Presupuesto vivo — variable spend becomes real (per-category seed, monthly confirmation) |
| 33 | `eed75f9` | Goal simulator — date ⇄ contribution, bidirectional against the real margin |
| 34 | `7be670c` | Onboarding cerrado — goals on one page + 91-agent audit |
| 35 | `f671198` | "Moneda al inicio" — FX declared once, never re-asked |
| 36 (+36.1) | `ac18cef`, `0a1132f` | "Tu mes" (Sankey) + a single hero — closes the two-number concept |
| 37 | `9c35fff` | "Tu mes" module + `/app/mes` + scheduled plan changes (migration 039) |
| — | `183db49`…`a71ee3a` | Onboarding feedback pass O1–O12 (dual theme, persistent Sankey, two chapters) — a batch that ran between 37 and 38, not a numbered stage |
| 38 | `7241867` | Reserves become scheduled, account-linked savings plans on the calendar |

## Bloques A–H — same place (`docs/BUILD_PROGRESS.md` + commits)

Where the sequence stopped counting and started lettering. All closed and
production-live; detail is newest-first at the top of `docs/BUILD_PROGRESS.md`.

| Bloque | Commit(s) | Topic |
|---|---|---|
| A–B | `8e6bdb5`, `ac7eb06` | Validación día a día — card-cycle Margen, statement payment, budget reversal, card interest, dedup, live ARS FX, "Mis datos" |
| C | `0b8ed19`, `8f84b40` | Universal materialization calendar + AI-generated notifications (migrations 044–046) |
| D | `3fa93c8` | **Saldo Kipu** — the accumulating-tank hero replaces Margen as the daily number (migration 048) |
| E | — | **Never existed as a block.** See the note below. |
| F | `2dfa27e` | "Dónde está tu plata" (`/app/cuentas`) — per-account cashflow + Tesorería |
| G | `a8fff14` | LatAm cuotas/installments — the monthly cuota lowers the ritmo (migrations 049–050) |
| H | `a28ab31` | Objetivo mensual comida/transporte + fail-closed of the Saldo money feed (migrations 051–055) |

**On the missing E:** older docs described a "Bloque E — build the secondary
surfaces (Tu mes, Actividad, Metas, Deudas, Patrimonio, Gasto, FX)". It was never
built as a block because it didn't need to be: all seven surfaces already exist,
built against the engine. What they lack is reachable navigation, and that work
lives in **Bloque M** ([`docs/ROADMAP.md`](./ROADMAP.md)).

## What comes after H

**[`docs/ROADMAP.md`](./ROADMAP.md) is the living roadmap and the only authoritative
source for the order of work** (today: Bloque J → K → L → M; I closed 2026-07-19). It supersedes any
"Next:" left in an older document — including the retired sequence "engine refinement
→ chat-agent review → visual deep-dive → Bloque E".
`docs/ROADMAP_MVP.md` is the ORIGINAL 13-phase plan and is archaeology only; it is
not pending work.

For per-module status see the root `README.md`; for the at-a-glance phase board
see the "Current phase & module status" section of `docs/BUILD_PROGRESS.md`.
Test-gate counts live in `docs/BUILD_PROGRESS.md` — deliberately not repeated here.
