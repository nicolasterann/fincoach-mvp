# Kipu MVP Roadmap

> **CURRENT PHASE (updated 2026-07-02, HEAD `b97bd33`).** Stages 1–27 are shipped
> and production-live at www.soykipu.com. The AI-native agent is LIVE
> (`KIPU_AGENT_MODE=on`); the legacy deterministic pipeline is fallback-only.
> **The product is READY for founder/family beta.** The phased plan below is the
> ORIGINAL ~Stage-11 MVP map, kept for historical context — treat every
> "Current status: Not started" as a historical snapshot, most are now obsolete.
> The authoritative live history is `docs/BUILD_PROGRESS.md` (newest first) and
> `docs/AI_NATIVE_ARCHITECTURE.md` §5; per-module status is in the root `README.md`.
>
> Where the original plan actually landed: low-friction capture → Stage 12;
> ambient Telegram loop → Stage 13; card/debt protection → Stage 14; cashflow &
> scenarios → Stage 15; spending/merchant intel → Stage 16; goal engine → Stage 17;
> personalization → Stage 18; household → Stage 19; personality/FX/trends → Stage 20;
> multi-currency onboarding → Stages 22–24; universal chat control + scheduled
> changes → Stage 26; living dashboard + metric drilldowns → Stage 27; universal
> chat control (soft-close accounts/cards + persistent feedback) → Stage 29. All
> database migrations (001–037) are applied in production.

The original roadmap below took Kipu from AI-onboarding-hardened toward a
closed-beta-ready MVP; the product has since reached that beta-ready state.

Each phase has:
- **Objective** — what we're trying to accomplish.
- **Current status** — done / in progress / not started.
- **Key tasks** — concrete deliverables.
- **Risks** — known traps.
- **Definition of done** — when we can stop.
- **Suggested build mode** — small (≤1 file, ≤30 lines), medium (1–3
  files, bounded module), or large (multiple files + new module
  surface). Larger modules require an explicit plan and human review.

Cross-cutting rule: every phase must keep the deterministic fallback
path working when AI is disabled. No phase may regress lint or build.

Strategic differentiation versus OpenAI's personal-finance announcement:
Kipu is **habit-first, Telegram-first, LatAm-first, emotionally
intelligent, debt-aware, weekly-reconciling, and low-friction**. We do
not compete on "generic financial chat"; we compete on day-to-day
practical guidance for people who do not want to think hard about
"finanzas".

---

## Strategic sequence (June 2026 — post first-principles review)

The first-principles review confirmed Kipu's existential risk is **data
freshness and user behavior**, not dashboard/UI. Kipu cannot depend on
disciplined manual tracking forever. The chosen sequence deliberately
fixes the seed before turning on proactivity, because nudges and Margen
Kipu built on a wrong seed create false confidence:

1. **AI-first onboarding (Stage 11 — shipped; later evolved into the
   structured wizard of Stages 22–24; see BUILD_PROGRESS).** The
   conversational AI engine is a supported onboarding path; the
   deterministic mock is only a resilience fallback. Onboarding captures
   the minimum trustworthy
   seed for the first Margen Kipu (income + date, big fixed expenses,
   cards with minimum/due day, account balances) and treats everything
   else as estimable hypotheses Kipu learns later. The review step shows
   the user's **first Margen Kipu** computed by the real engine.
   **Format decision (11.2, post field QA): HYBRID.** Chat is the spine
   (narrative, estimates, emotional context — where conversation wins),
   with **inline structured editors for structured clusters** (first:
   the card/debt matrix, where freeform chat proved weakest in the
   field). Three hard reliability guarantees: the engine receives the
   recent conversation (no per-turn amnesia), a deterministic
   **clarification-loop breaker** forces a calm move-on after two
   no-progress turns, and `/dev/onboarding-loop-test` asserts the exact
   field-QA scenario on every build. Paste-a-summary and
   statement-upload onboarding modes belong to the low-friction capture
   stage, not here.
2. **Low-friction data capture.** Voice notes, photos/receipts and
   documents over Telegram; later bank SMS/notification parsing. The
   data supply chain must not depend on typing discipline.
3. **Ambient Telegram Loop & Data Freshness.** Proactive daily/weekly
   pulse, staleness-aware honesty in the margin, reply-to-log,
   guilt-free recovery — the retention loop. Built on the already-built
   briefing engine, engagement state and nudge cooldowns.
4. **Card/Debt Protection.** Interest projection, minimum-payment trap
   math, payoff plan, pre-purchase card checks — the founding use case.

North-star metric for this arc: **consecutive days with fresh data per
user** (not DAU, not sessions).

---

## Phase 0 — Close onboarding and app context

**Objective.** Lock down the onboarding → save → context-builder pipe
so every downstream feature can trust the saved state.

**Current status.** Mostly done. Onboarding interview, AI engine, draft
patch applier, save flow, and context builder are live and persisted in
both local and Vercel. Coach tone normalization and the
"directo → coach_like" mapping shipped. Outstanding manual replay
issues from the latest QA round (goals closure phrases, debt
minimum/total preservation, multi-item ack, decimal display) are fixed
or in flight.

**Key tasks.**
- Confirm Script A (full happy path in docs/TEST_SCRIPTS.md) end-to-end.
- Confirm `/dev/user-financial-context-test` shows correct fields after
  a fresh onboarding for at least one real account, one card with
  total+min, one informal debt, two income sources, several fixed
  expenses (including decimals), and one goal with target amount.
- Confirm coach tone after save with each of: directo, relajado,
  juguetón.
- Document the manual acceptance pass in BUILD_PROGRESS.md.

**Risks.**
- AI patch creating duplicate items if it forgets to reuse draftId.
- Decimal rounding sneaking back into display via new helpers.
- "Save" path silently saving partial goals (mitigated by
  `isReviewableGoal`).

**Definition of done.**
- A clean onboarding → app round-trip with all listed item types lands
  in Supabase with correct values, and the context builder reads them
  back without distortion.
- BUILD_PROGRESS.md updated with the acceptance checkmarks.

**Build mode.** Small.

---

## Phase 1 — First-use app experience after onboarding

**Objective.** After onboarding, the user lands in `/app` and
immediately understands what Kipu knows, what to do next, and how to
talk to it. No empty dashboard. No "what do I do?" moment.

**Current status.** Not started. `/app` shows dashboard primitives but
no onboarding-aware first-use copy.

**Key tasks.**
- "Bienvenida personalizada" panel for first session post-onboarding:
  acknowledges name, base currency, primary account, main goal.
- Inline chat hint with one example input matched to user's actual
  draft (e.g. "registra un gasto: gasté 8 en café").
- Show debt pressure and goal feasibility chips above the chat input.
- Surface "tu siguiente paso" CTA — log first movement, link
  Telegram, or set up a reminder.

**Risks.**
- Hard-coding copy that drifts from the AI tone.
- Over-rendering before context builder finishes.

**Definition of done.**
- New user finishes onboarding, lands in `/app`, sees personalized
  greeting + one actionable CTA, and can log their first movement in
  ≤2 taps.

**Build mode.** Medium.

---

## Phase 2 — Real Kipu dashboard v1

**Objective.** Replace dev-grade dashboard with the real Kipu v1:
clean weekly view, current balances, debt pressure, goal progress, and
recent movements — calm, mobile-first, premium.

**Current status.** Not started. Current `/app` is functional but
visually utilitarian.

**Key tasks.**
- Information architecture: weekly view as primary unit, with monthly
  and "tu meta" as secondary screens.
- Balance cards with cents-aware formatting.
- Debt pressure visualization (no judgment, just clarity).
- Goal progress visualization (avatar/animation deferred to Phase 10).
- Recent movements list with quick actions (revert, edit category).
- Empty states that talk like Kipu, not like a SaaS.

**Risks.**
- Scope creep into gamification (push to Phase 10).
- Mobile breakpoints overlooked.
- Over-fetching context on every render — paginate movements.

**Definition of done.**
- A returning user opens `/app`, sees their week at a glance, can act
  in ≤2 taps, and the page feels like Kipu, not "FinCoach v0".

**Build mode.** Large.

---

## Phase 3 — Robust Telegram daily logging

**Objective.** Make Telegram the user's primary daily-logging surface,
with parser + coach response feeling sharp and reliable.

**Current status.** Live in production with `TRANSACTION_PARSER_MODE`
configurable and `COACH_RESPONSE_MODE=ai`. Core expense/income/goal
contribution/debt payment flows validated.

**Key tasks.**
- Improve parser handling of: decimals (`13,40`), shared amounts
  ("20 entre dos"), currency hints, ambiguous accounts.
- Sharpen coach replies for repeated patterns (5+ coffees this week,
  recurring expense detected, debt minimum approaching).
- Add quick-action keyboard buttons (deferred-confirm "¿lo pago hoy?
  sí / no").
- Handle non-text messages gracefully (photos, voice notes → "por
  ahora solo entiendo texto").
- Handle unlinked users with a clear linking flow.

**Risks.**
- Telegram update duplication despite `telegram_processed_updates`
  (e.g. retries with new update_id but same content).
- Latency of AI parser causing timeout in webhook handler.
- Prompt drift between onboarding tone and daily-chat tone.

**Definition of done.**
- 20 real Telegram messages from a single user across one week land
  correctly: balances and debts move, coach replies feel native,
  no duplicates.

**Build mode.** Medium.

---

## Phase 4 — Recurring expenses and anti-double-counting

**Objective.** Detect recurring expenses (Netflix, Movistar, gym),
match them against fixed_expenses captured during onboarding, and
prevent double counting when the user volunteers what is already a
recurring charge.

**Current status.** Not started. Fixed expenses are stored, but not
linked to incoming transactions.

**Key tasks.**
- Matcher: given an inbound transaction, find the most likely fixed
  expense by name + amount + frequency.
- Confirm with user once ("¿este es tu Netflix mensual?") and learn.
- Track "this month already paid" per fixed_expense.
- Surface upcoming fixed expenses in the weekly view (Phase 2 hook).
- Reversal flow if matched incorrectly.

**Risks.**
- Over-matching unrelated charges; under-matching real ones.
- User confusion when an existing fixed expense is "consumed" silently.

**Definition of done.**
- A user logs "pagué Netflix 24" and Kipu recognizes it, marks the
  fixed expense as paid for the month, and does not let the same
  charge be counted twice.

**Build mode.** Medium.

---

## Phase 5 — Real goal planning engine

**Objective.** Compute weekly_required_amount and
monthly_required_amount for each goal, compare against income and
fixed expenses, and produce a feasibility signal (`safe`, `tight`,
`challenging`, `impossible`).

**Current status.** Goals are saved; feasibility is hard-coded to
`challenging` in save flow. The financial engine has the primitives.

**Key tasks.**
- Pure function `computeGoalPlan(goal, context)` returning weekly +
  monthly required + feasibility + suggested plan path.
- Wire into the save flow so new goals land with realistic
  feasibility.
- Recompute on each transaction that affects the goal account or the
  expense baseline.
- Surface "tu meta está en …" in the dashboard and after relevant
  Telegram movements.

**Risks.**
- Premature judgment ("impossible") causing user fatigue.
- Math drifting from money-utility conventions (always operate on
  base amounts).

**Definition of done.**
- A goal with target 1000 and 4 months horizon shows a plausible
  weekly requirement, updates after a 50 contribution, and downgrades
  feasibility when fixed expenses spike.

**Build mode.** Medium.

---

## Phase 6 — Open-ended financial coach

**Objective.** Move beyond per-transaction coach replies. Let the user
ask Kipu open questions ("¿cómo voy?", "¿alcanzo Brasil en mayo?",
"¿qué me está matando este mes?") and get grounded answers built from
the financial context.

**Current status.** Not started. Current coach only reacts to applied
transactions.

**Key tasks.**
- New intent: `coach_question`. Parser router recognizes
  open-ended questions and routes to a "coach Q&A" handler.
- Handler builds compact context (current week, top categories,
  pending fixed expenses, debt pressure, goal feasibility) and asks
  the AI to answer using only that context.
- Strict no-hallucination contract (AI returns "no tengo ese dato"
  when context is missing).
- Telegram and web chat both use the same handler.

**Risks.**
- Hallucinated balances. Mitigate by passing only numbers, never
  asking the AI to "calculate".
- Cost: long contexts on every question. Trim aggressively.

**Definition of done.**
- 10 representative open-ended questions answered correctly with
  grounded numbers; none invent data.

**Build mode.** Large.

---

## Phase 7 — Daily check-ins and reminders

**Objective.** Lightweight daily nudge: "¿algo que registrar hoy?"
with smart timing and quiet-mode opt-out.

**Current status.** `dailyCheckinEnabled` exists in coach preferences.
No scheduler.

**Key tasks.**
- Cron via Vercel (every hour) that selects users due for a daily
  check-in based on their preference + timezone.
- Sender chooses Telegram if linked, falls back to in-app banner.
- Smart skip: if user already logged ≥1 movement today, switch to a
  light affirmation instead of a question.
- Per-user quiet hours and "pausa" toggle.

**Risks.**
- Notification fatigue.
- Time zones (LatAm spans several).
- Vercel cron limits.

**Definition of done.**
- A user with `dailyCheckinEnabled=true` and Telegram linked receives
  exactly one daily nudge in their preferred window, adapted to
  whether they've already logged.

**Build mode.** Medium.

---

## Phase 8 — Weekly review and reconciliation

**Objective.** Sunday-night summary of the user's week: what came in,
what went out, what's pending, where the goal stands, what to expect
next week. Plus a one-tap "reconcile" path to fix forgotten items.

**Current status.** Not started.

**Key tasks.**
- Weekly aggregator (pure function) producing the review payload.
- Renderable in app and in a Telegram card.
- "Cierre semanal" interaction that lets the user fix omissions,
  add forgotten fixed expenses, and confirm balances.
- Persisted weekly summary for trend lines later.

**Risks.**
- Re-reconciling old weeks risks rewriting history; treat each weekly
  summary as immutable once confirmed.

**Definition of done.**
- A user gets a coherent weekly review on Sunday with accurate
  numbers and can reconcile in ≤3 taps.

**Build mode.** Medium.

---

## Phase 9 — Recovery flows for inactive users

**Objective.** Bring back users who went quiet 7+ days without making
them feel judged. Lower the friction to restart.

**Current status.** Not started.

**Key tasks.**
- Inactivity detector (no movements in N days).
- Tiered nudge sequence (3 / 7 / 14 days) with escalating warmth, not
  guilt.
- "Pausa" mode (suspend all daily/weekly nudges).
- "Volver" path: short reorientation summary, optional partial
  reconciliation of skipped weeks.

**Risks.**
- Tone slipping into guilt or pressure. Prompt and copy must keep
  Kipu's voice.
- Sending nudges to users who unlinked Telegram.

**Definition of done.**
- A user inactive for 10 days receives the 7-day nudge in the right
  tone, can opt into pausa, and can resume without rewriting
  history.

**Build mode.** Medium.

---

## Phase 10 — Gamification and motivation layer

**Objective.** Lightweight motivation that respects the
non-judgmental tone: streaks, milestones, goal avatar, weekly
celebration.

**Current status.** Not started.

**Key tasks.**
- Streak counter (consecutive days with at least one logged
  movement OR an explicit "día austero").
- Goal avatar (visual progress of the main goal).
- Weekly milestones ("primera semana sin gastos hormiga", "primer
  aporte a Brasil").
- Notification rules: celebrate, don't punish.

**Risks.**
- Gamification fatigue.
- Streak loss feeling punitive. Build "perdón" / "racha de
  recuperación" mechanics.

**Definition of done.**
- Active user sees motivating signals weekly without ever feeling
  judged for missing a day.

**Build mode.** Medium.

---

## Phase 11 — WhatsApp preparation

**Objective.** Land WhatsApp as a second channel without rewriting the
financial engine. Validate that the channel-agnostic split holds.

**Current status.** Architecture supports it (`chat-transaction-
handler` is channel-agnostic). No WhatsApp adapter yet.

**Key tasks.**
- Adapter: WhatsApp message in → normalized message → existing
  handler.
- WhatsApp Business API onboarding + number provisioning.
- Linking flow analog to Telegram link.
- Cost + rate-limit awareness in the adapter.

**Risks.**
- WhatsApp policy / template message constraints.
- Cost per message.
- Phone number verification UX.

**Definition of done.**
- A linked WhatsApp number can log an expense and receive a coach
  reply with the same accuracy as Telegram.

**Build mode.** Large.

---

## Phase 12 — Closed beta QA

**Objective.** Ship to a small group (10–30 real LatAm users), watch
behavior, fix what breaks first.

**Current status.** Not started.

**Key tasks.**
- Privacy review (RLS, secrets, logging hygiene).
- Onboarding-to-first-movement funnel instrumentation.
- Daily monitoring of: parser errors, AI confidence drops, webhook
  failures, save errors.
- Direct interview cadence with first 10 users.
- Triage backlog focused on retention pain points.

**Risks.**
- A single embarrassing parser failure damages trust early.
- Costs: AI usage scales with chat volume; set per-user soft caps.

**Definition of done.**
- ≥10 users active for ≥2 weeks. Retention story for the second
  week is positive. No critical bugs in onboarding, save, parser, or
  coach paths.

**Build mode.** Medium (mostly QA + small fixes).

---

## Phase ordering and parallelization

Strict prerequisites:
- Phase 0 must complete before Phase 1.
- Phase 1 must precede Phase 2 (we don't redesign the dashboard
  before the first-use UX exists).
- Phase 3 can run in parallel with 1–2 since it touches Telegram
  + parser, not the dashboard.
- Phases 4–5 should land before Phase 6 (coach Q&A) so the AI has
  reliable data to ground answers in.
- Phases 7–9 share the scheduler infrastructure and should be
  bundled.
- Phase 10 is intentionally late so we do not gamify before the
  habit is real.
- Phase 11 is gated by Phase 3 being stable.
- Phase 12 closes the MVP.

## Recurring gates (every phase)

- `npm run lint` clean.
- `npm run build` succeeds.
- Manual QA per docs/TEST_SCRIPTS.md.
- Update BUILD_PROGRESS.md.
- Human approval before flipping any production env-var feature flag.
