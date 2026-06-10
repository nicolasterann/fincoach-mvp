# Kipu — AI-Native Architecture (North Star)

This is the target architecture. It supersedes the older "Universal Router +
per-intent handlers" design wherever they conflict. Read after `CLAUDE.md`.

## 0. The one-sentence thesis

**Kipu = a flexible LLM agent that thinks over the user's live structured
financial memory, and executes only through safe, typed, deterministic tools.**

Intelligence is flexible. Money is safe. Reliability is NOT rigidity.

## 1. Why this, and why it beats a Claude/ChatGPT budgeting artifact

A generic ChatGPT/Claude project with a budgeting artifact is **stateless and
inert**: the user must paste their context every time, it cannot remember
across sessions, it cannot act, it cannot reconcile real balances, it cannot
learn the user's patterns, and it cannot proactively reach out. It is a smart
calculator that forgets you.

Kipu wins on four things a chat artifact structurally cannot have:

1. **Live structured financial memory.** Real accounts, cards, debts, income,
   fixed expenses, goals, and balances — always current, never re-pasted. The
   agent opens already knowing you.
2. **Safe action.** It doesn't just advise; it records, undoes, corrects,
   transfers, schedules, reconciles, and updates real state through validated
   tools. "It can actually do things, not just talk."
3. **Learning loop.** Corrections, aliases ("Pichincha = my account"), people
   ("Juan", "mi mamá", "el gym"), and behavioral patterns (overspends on food
   after weekends) are persisted and fed back, so Kipu gets more personal every
   week. An artifact resets to zero each chat.
4. **Continuity & proactivity.** Streaks, weekly reconciliation, smart
   reminders, guilt-free recovery, pause/return modes — Kipu accompanies you
   between messages. An artifact only exists while you're typing.

If a feature could be matched by a stateless artifact, it is not where Kipu's
value is. Every architectural decision should deepen memory, safe action,
learning, or continuity.

## 2. How Kipu beats the #1 killer of finance apps: abandonment

Trackers die because logging is a chore, guilt accumulates, and a single gap
makes users feel they "failed" and quit. Kipu's design directly attacks each:

- **Friction → near-zero.** Natural language, any phrasing, any channel
  (Telegram first). No forms, no categories to pick. The agent figures it out
  and asks only when truly necessary.
- **Guilt → clarity.** Tone is zero-judgment by construction (enforced in the
  agent prompt + response rules). Overspending is framed as information Kipu is
  tracking for next time, never a scolding. "Logging must always feel safe."
- **Gaps → recovery, not debt.** Light mode, pause mode, streak freeze, return
  mode, and a soft reset ("retómame sin hacerme sentir mal", "empezar desde
  cero desde hoy") let a 5-day gap heal in one message instead of ending the
  relationship.
- **Every log returns value.** Confirmation + classification + goal impact +
  flexible-money-left + personality — never a bare "registrado".
- **Proactivity keeps the loop warm.** Weekly reconciliation, smart reminders,
  and check-ins bring the user back before they drift.
- **Memory makes it worth coming back.** Because Kipu remembers and improves,
  the cost of switching to a generic chatbot grows every week.

### New ideas we are adopting (beyond the original MVP) to fight abandonment

- **Confidence-aware honesty.** Kipu tells you how sure it is about a number
  ("tu gasto de comida lo tengo estimado, todavía aprendiéndolo") — trust
  through humility, not false precision.
- **One-tap / one-word reconciliation.** Weekly "¿esto cuadra?" answerable with
  "sí" — reconciliation as a 5-second ritual, not a chore.
- **Behavioral nudges from learned patterns.** "Los findes sueles pasarte en
  comida; ¿te separo un colchón?" — value only a memory-rich system can give.
- **Emotional check-ins.** Detect guilt/stress/avoidance and respond as a
  coach, not a ledger. Money is emotional; Kipu treats it that way.
- **Recovery momentum, not streak shame.** Returning after a gap is celebrated
  ("qué bueno que volviste"), and a "return mode" reconstructs without
  itemizing every expense.
- **Split & shared-expense intelligence** ("mitad mío, mitad de Ana") as a
  first-class learned pattern feeding the receivable ledger.
- **Alias & people memory** so "la cena de siempre", "el gym", "mi mamá"
  resolve correctly and improve over time.

## 3. The architecture

```
Channel (Telegram / web / WhatsApp later)
   → normalize message + identify user
   → KIPU AGENT  (LLM, tool-calling loop)
        reads:  live financial context  +  recent conversation
                +  learned facts / aliases / preferences (memory)
        thinks: intent, plan, which tools, what's missing
        calls:  TOOLS (0..n)  ──────────────┐
   ┌──────────────────────────────────────┘
   │  each TOOL = a typed, deterministic capability:
   │    validates against real state → executes OR asks OR refuses
   │    (ledger writes go through the single writer;
   │     domain writes through their store; never raw SQL from the LLM)
   └──→ tool results fed back to the agent
   → AGENT composes a natural, personalized reply
   → AGENT may persist learned facts (remember_fact)
   → reply sent on the channel; turn stored in chat_messages
```

### Tools (the safe capability surface)

Implemented in `src/lib/ai/agent/`. Initial set (grows over time):

- `get_financial_context` — read balances, weekly margin, debt pressure, goal,
  fixed expenses, upcoming payments, receivables, learned facts.
- `log_movement` — expense / income / debt_payment / goal_contribution, with
  source resolution; card = debt, never available money.
- `transfer_between_accounts` — internal transfer (not spending/income).
- `record_person_payment` — outgoing person transfer (expense/loan) or incoming
  (income/refund/repayment), with receivable side-effects.
- `undo_movement` / `remove_duplicate` / `correct_movement` — append-only,
  idempotent reversal + reverse-and-replace.
- `create_fixed_expense` / `update_fixed_expense` / `schedule_payment` — future
  & recurring commitments.
- `remember_fact` — persist a learned alias / preference / pattern / correction
  to memory.
- `answer` — coach/advisory reply with no state change (read-only default).

Every tool returns a structured result (`done` / `needs_confirmation` /
`needs_info` / `refused`) so the agent can ask a smart follow-up instead of
guessing. A money-mutating tool **never executes on ambiguity** — it asks.

### Memory & learning model

- **State** lives in the existing tables (accounts, debts, goals, income,
  fixed_expenses, transactions, scheduled_payments, receivables).
- **Learned memory** lives in `user_context_notes` (free-form typed notes:
  alias, preference, pattern, person, correction) + `user_financial_preferences`
  (default source, etc.). The agent loads a compact memory digest each turn and
  writes new facts via `remember_fact`.
- **Self-improvement:** corrections and repeated behaviors become notes; future
  turns read them; interpretations adapt. No model fine-tuning needed — the
  memory IS the personalization.

## 4. What's wrong with the pre-reset architecture (being replaced)

- **Route-native, not AI-native.** A prefilter + Universal Router + a stack of
  per-intent gates (recovery gate, transfer gate, commitment gate, coach-followup
  gate, fixed-expense matcher…). Each new behavior needed a new gate. Anything
  outside a pre-coded shape collapsed to a fallback. That is the chatbot feel
  the reset rejects.
- **AI as cosmetic.** The LLM mostly rewrote final strings; interpretation was
  regex/classifier-driven. The intelligence wasn't operational.
- **Brittle.** Phrase-shaped detectors (`looksLikeTransferish`,
  `looksLikeCommitmentish`, affirmation regexes) break on unanticipated
  phrasing and fight each other for the same message.
- **Stateless-ish.** Memory was recent-chat + a few notes, not a first-class
  learning loop. No alias/people/pattern learning.
- **No real agency.** Capabilities existed but were reachable only through the
  exact route that triggered them.

The capabilities themselves (the writers, reversal engine, transfer/commitment
logic, financial context builder) are GOOD — they become the **tools**. We are
replacing the **front door** (rigid routing) with an **agent**, not throwing
away safe execution.

## 5. Staged migration (safe, reversible, build-green at each step)

`KIPU_AGENT_MODE` = `off` | `shadow` | `on` gates the front door.

- **Stage 1 (this change): agent core scaffold.** `src/lib/ai/agent/` with the
  tool registry, executors wrapping existing safe capabilities, the tool-calling
  loop, and a memory read. Wired into `handleChatTransactionMessage` so that
  when `KIPU_AGENT_MODE=on` the agent answers, and on any failure/disabled it
  falls back to the existing pipeline. Default `off` → zero production change
  until validated.
- **Stage 2 (DONE): full tool coverage + memory.** Every legacy Phase 11
  capability is now an agent tool: log_movement (with fixed-expense linkage via
  `fixedExpenseId`), transfer_between_accounts, list_recent_movements,
  undo_movement (by id/hint), undo_recent_movements (batch), remove_duplicate,
  correct_movement (by id), record_person_payment (out=expense/loan,
  in=income/refund/loan_repayment, with receivable side-effects),
  create_fixed_expense, update_fixed_expense, schedule_payment, remember_fact.
  Memory is a grouped digest (aliases/preferences, people, behavior patterns,
  constraints, goal/risk context) plus the saved default payment source,
  surfaced each turn so the agent resolves aliases/people/source and learns
  from corrections and repeated behavior (auto `remember_fact`). Ambiguity is
  resolved by list→select-by-id, never by re-asking.
- **Stage 3 (IN PROGRESS): retire the legacy gates from the agent path.** The
  agent is now the real primary interface. In \`KIPU_AGENT_MODE=on\` the agent
  answers; \`runChatPipeline\` (the route-based pipeline) runs ONLY as the
  emergency fallback on agent failure. The agent-era write gates that the agent
  fully owns — the recovery-confirmation gate, the transfer gate and the
  commitment gate — are now skipped whenever the agent is the primary
  (\`agentMode() !== "on"\` guards them), so they no longer run in normal
  production even on fallback. What remains as the safety net is the original
  core: pending-resolution → prefilter → fixed-expense matcher → advisory/coach/
  router → parser, which keeps basic logging + coaching working if the agent is
  ever down. The guarded gates still serve \`KIPU_AGENT_MODE=off\` unchanged.
  Full deletion of the guarded gates follows once production confidence is high
  (kept now purely to avoid removing a tested net while the agent is young).
- **Stage 4 (STARTED): proactive coaching layer.** A deterministic engine
  (\`src/lib/financial/coaching-signals.ts\`, \`buildCoachingBriefing\`) reads the
  whole state each turn — weekly margin (remaining-days-through-Sunday aware),
  upcoming scheduled payments, money owed to the user (receivables), card due
  dates, fixed expenses, goal risk, and days-since-last-activity — and produces
  prioritized **signals**, a single **next-best-action**, and **Whoop-style
  wellness metrics** (Financial Readiness, Goal Momentum, Debt Pressure,
  Spending Flexibility, Financial Accuracy, Budget Reality, 0–100). The agent
  gets a compact briefing in its system prompt (so it coaches proactively —
  "ojo que el viernes vence tu Visa") and a \`get_proactive_briefing\` tool for
  "¿cómo voy? / ayúdame a cuadrar la semana". Reconciliation, guilt-free
  recovery after inactivity, and pause/light-mode (as memory preferences) are
  prompt-driven over the briefing. Still in-conversation only; the cron route
  exists but push notifications are the next infra step. Confidence-aware
  budgets and the Whoop dashboard UI are the remaining Stage 4 work.
- **Stage 5 (STARTED): financial realism + intelligent coaching continuity.**
  (a) **Liquidity realism** — accounts carry a `liquidity` flag
  (`liquid` | `non_liquid`, migration `014`); "available this week" counts ONLY
  liquid, non-goal money (`sumLiquidSpendable`), so Kipu's numbers match the
  user's bank/cash. Receivables, investments/long-term savings, and protected
  goal money are surfaced SEPARATELY ("además te deben 50$, pero no los cuento
  como disponible"), never mixed into spendable margin — across weekly/daily
  margin, purchase advice (`evaluate_purchase`), the briefing, metrics, and
  reconciliation. A `set_account_liquidity` tool lets Kipu learn each account's
  liquidity. (b) **Nudge continuity** — `coach_nudge_log` records when each
  signal was last surfaced; `buildCoachingBriefing` picks ONE *lead* signal not
  mentioned recently (3h cooldown → rotation), marks the rest "ya mencionado, no
  repetir salvo decisión", and the prompt makes Kipu escalate only on relevant
  decisions and rephrase if it must repeat — no stateless repeated warnings.
  (c) **Engagement state** — `user_engagement` (mode normal/light/paused +
  last_reconciled); `set_engagement_mode` / `mark_week_reconciled` tools; the
  briefing suppresses nudges when paused and frames recovery on return. All
  read-mostly coach state; financial truth and the single ledger writer are
  untouched.
- **Stage 6 (STARTED): Margen Kipu — the cash-flow-aware safe spending margin.**
  Liquidity (Stage 5) wasn't enough: 500$ in the bank may still owe rent, the
  card, the gym, essentials and savings before the next paycheck. **Margen Kipu**
  (`calculateMargenKipu`, `margen-kipu.ts`) is the user's REAL safe-to-spend
  margin: from liquid cash it RESERVES everything due before the next income —
  fixed expenses, scheduled payments, card/debt payments, essential variable
  spending, monthly savings & investment commitments, and the goal contribution —
  prorated to the cash-flow horizon (today → next paycheck), then spreads the
  free remainder across that horizon and reports only the simple weekly/daily
  slice. It replaces the liquidity-only weekly figure as THE margin: the agent
  overrides the snapshot with it, so the briefing, `evaluate_purchase`, metrics
  and reconciliation all use it. *Kipu calculates like a CFO, communicates like a
  calm coach* — the user gets one trustworthy number ("Te quedan 120$ de Margen
  Kipu esta semana"), and the full breakdown only when they ask or ask why it's
  below their bank balance. Savings/investment are protected BEFORE free spending
  (migration `015`: `monthly_savings_commitment`, `monthly_investment_commitment`,
  `essential_monthly_estimate` on `user_financial_preferences`; `set_savings_plan`
  tool; onboarding captures them + account liquidity). QA fixes folded in: exact
  reconciling liquid totals (`buildLiquidBreakdown`) so the agent never miscounts
  a sum and compares "banco" vs "efectivo" like-for-like; and
  `reconcile_account_balance` records a balance mismatch as an `adjustment`
  (never income, so income analysis stays honest).
- **Stage 7 (STARTED): onboarding + dashboard alignment.** Margen Kipu only
  works if onboarding captures the right inputs and the dashboard shows the same
  number as chat. (a) **Dashboard = chat.** The `/app` dashboard now renders from
  the SAME `buildCoachingBriefing` engine as the agent (read-only:
  `surfaceNudges:false` so a passive view never consumes the chat's nudge
  cooldown). Margen Kipu is the **hero** metric (weekly + daily rhythm + calm
  one-line explanation), the six Whoop-style wellness scores
  (Readiness/Meta/Deuda/Flexibilidad/Precisión/Realidad), the next-best-action,
  upcoming commitments, and pause/light state all come straight from the
  briefing — the legacy `flexibleSpending` weekly-plan hero and the duplicate
  local readiness/accuracy math are gone, so chat and dashboard can't disagree.
  (b) **Onboarding reliability.** `saveOnboardingDraftAction` now inserts accounts
  and debts one at a time to map each draft to its real id, so fixed-expense
  **payment sources**, the **goal account**, the **income destination**, and
  **default-payment accounts** finally persist (they were hardcoded `null` — real
  data loss that blinded Margen Kipu). The **primary account** becomes the default
  payment source. The **review screen is editable**: the conversational input
  stays on the review step, so "cambia mi nombre", "mi sueldo es 1400" flow
  through the same draft-patch engine and update the summary live before the user
  confirms. The onboarding prompt captures the cross-links (payment source, goal
  account, income destination, primary account, current goal savings) and treats
  variable categories as learnable hypotheses. No schema change this stage.

- **Stage 8 (STARTED): customer-facing product UI — IA, navigation, chat as its
  own space.** The MVP single-scroll dashboard became a real app shell. A
  persistent navigation (`AppNav`: left sidebar on desktop, bottom tab bar on
  mobile, in `app/layout.tsx`) with four sections — **Resumen** (`/app`),
  **Actividad** (`/app/activity`), **Kipu** chat (`/app/chat`), **Metas**
  (`/app/goals`) — plus a **Margen Kipu drill-down** (`/app/margen`) reached from
  the hero. *Simple at the top, deep on demand.* The dashboard is now a calm
  overview: Margen Kipu hero (tappable to its waterfall breakdown), one coach
  insight (`nextBestAction`), upcoming commitments, six meaningful metric cards
  (each a useful sentence, some tappable to detail), and a 3-item activity
  preview — the embedded chat box, "cómo hablarle a Kipu" guide, KipuUnderstood
  card and raw movements list are gone. **Chat is its own full-height page**
  (`ChatView`, bubble UI, suggestions, `useFormStatus` send) instead of a form
  inside the dashboard; `sendWebChatMessageAction` takes a `redirectTo` so it
  returns to `/app/chat`; `getChatHistory` loads the conversation. The **activity
  feed** reads like a wellness timeline via `describeMovement` (human labels —
  "Café (revertido)", "Ajuste de saldo" — and Kipu money). A house money
  formatter, **`formatKipuMoney`** ("120$", "3.50$", not "$120.00"/"USD 3.00"),
  is used across the whole UI. The **manual register** moved out of the product
  to a dev-only route (`/dev/manual-entry`), and the dead MVP components
  (FlexibleSpending / KipuUnderstood / RecentMovements cards) + ~12 dead helpers
  were deleted. No schema change. Dark-first premium theme kept; full light-mode
  theming is noted for later. Chat still uses a server-action round-trip (no
  streaming yet).
- **Stage 9 (STARTED): final customer-facing experience — Whoop-for-money
  quality.** The bar moved from "good structure" to "product people open every
  day". (a) **Iconic Margen Kipu**: the hero is now the `MargenRing` (SVG arc =
  share of this week's air still available, glow color = engine status), with
  the weekly number inside — tappable to a richer `/app/margen` that adds the
  ring, a real **7-day spending rhythm chart** (`RhythmBars`, green/amber vs the
  daily pace) and the existing waterfall. (b) **Metric system**: each of the six
  wellness metrics has its own visual identity (accent color, icon, score bar —
  Athlytic-style `DashboardMetricCard`) and ALL are tappable: Readiness/
  Flexibilidad → `/app/margen`, Meta → `/app/goals`, Deuda → new `/app/debt`
  (real per-card balances, due/cutoff days, minimums, pressure summary),
  Precisión/Realidad → `/app/activity`. (c) **Real insights**:
  `buildDashboardInsight` derives ONE specific, decision-ready line from live
  state (negative margin, card due ≤3 days framed as "already reserved", today's
  pace vs daily rhythm, goal-without-date, tight week) with a CTA into the right
  detail page — no generic filler. (d) **Desktop intentional**: the dashboard is
  a two-column grid (hero/insight/upcoming left, metric system + activity
  preview right, max-w-5xl); reading pages stay column-width. (e) **Chat is a
  real DM**: client-side conversation with optimistic user bubbles, typing
  indicator, no reload (`sendChatMessageAndGetReply` returns the reply through
  the same pipeline), `100dvh` height, safe-area composer, `enterKeyHint`,
  bottom tab bar hidden on chat, "Nueva conversación" (migration `016`:
  `chat_cleared_at` on `user_financial_preferences` — view-level hide, nothing
  deleted) so old fallback-era replies stop misrepresenting the agent. (f)
  **Direct actions beat chat detours**: goals got an in-page date setter
  (`updateGoalDateAction`) and a quick-contribution form (reusing the existing
  contribution writer with `redirectTo`); chat remains the conversational path,
  not a toll booth. (g) **Habit loop, premium not childish**: a real logging
  streak chip (derived from transactions, `computeStreakDays`) on the greeting.
  (h) **Native feel**: PWA manifest + standalone mode, `viewportFit: cover`,
  safe-area insets, dark `themeColor`, `lang=es`, app icon. Activity gained
  filter chips (Todo/Salidas/Entradas) and per-day outflow totals. Proactive
  Telegram briefings remain a separate (outbound-channel) module — the in-app
  dashboard promise is complete without them.
- **Stage 10 (STARTED): dashboard closure — the signature identity and the last
  mile.** (a) **Pulso Kipu**, the product-defining living visual: a breathing,
  glowing organism (`PulsoOrb` — layered radial glow, rotating halo, particle
  field; CSS-only motion, `prefers-reduced-motion` respected) whose score is the
  HONEST readiness composite. It sits as the signature card atop "Tu estado" and
  owns `/app/readiness`, where the orb + five driver bars (margen/flexibilidad,
  deuda, meta, precisión, realidad — each linking to its own layer) explain WHY
  the week feels how it feels. (b) **Every metric now has a true destination**:
  new `/app/precision` (a real data-trust checklist: logging freshness, last
  reconciliation, expenses missing a source account — live count —, income/fixed
  coverage, savings plan; plus the ONE action that would most improve trust) and
  new `/app/reality` (estimado vs. realidad per category over 30 days from real
  transactions, "aprendiendo" states when history is thin, and the categories
  Kipu observes beyond the plan). Readiness no longer collapses into margen;
  Precisión/Realidad no longer dump into Activity. (c) **Margen detail got the
  composition bar**: every peso of liquid money colored by what it protects
  (fijos/programados/deuda/esenciales/ahorro/inversión/meta/libre) + legend +
  the waterfall, making it the most trust-building page. The MargenRing gained
  life (breathing aura, orbiting shimmer, tick instrument field). (d) **Debt
  detail deepened**: income-pressure meter (% of monthly income eaten by this
  cycle's payments), per-card "vence en N días" chips with calm already-reserved
  framing. (e) **Final polish**: `globals.css` finally carries the design system
  (Geist font — body was still Arial! —, signature keyframes, calm dark
  scrollbars `.kipu-scroll`, premium form controls `.kipu-input`/`.kipu-select`
  that kill native spinners/selects); chat messages are bottom-anchored like a
  real DM (no dead vertical space) with the dark thin scrollbar; activity
  dedupes "(Préstamo)" repetitions, uses 2-line titles, dims neutral moves, and
  labels day totals "Salió X$"; UpcomingCommitments uses Kipu money + Spanish
  short dates; goals forms use the premium controls. No schema change.
- **Stage 11 (STARTED): AI-first onboarding — the seed of financial truth.**
  Strategic sequence locked (see ROADMAP_MVP "Strategic sequence"): onboarding
  → low-friction capture → ambient Telegram loop → card/debt protection. The
  seed must be right before proactivity turns on. Changes: (a) **AI-first by
  default** — `processOnboardingTurn` now defaults to `ai_with_mock_fallback`
  when `ONBOARDING_ENGINE_MODE` is unset (the mock conducted the conversation
  by default before; now it is strictly the resilience fallback). (b) **"Test
  de la mamá" prompt rules**: one short question per turn, ~12–15 user turns
  total, "no sé" is a valid answer (Kipu proposes a round estimate, low
  confidence), round numbers welcome, seed priority explicit (income+date,
  big fixed, cards with minimum/due day, balances — everything else estimable
  and learned later), emotional context captured as notes, zero jargon. (c)
  **Draft survives refresh**: the in-progress conversation persists to
  localStorage per user (DB untouched until confirm) and restores on mount;
  "Empezar de nuevo" resets the local draft safely. (d) **First Margen Kipu
  moment**: the review step runs the REAL engine over the draft
  (`buildDraftMargenPreview`) and shows the user's first weekly margin with
  the why ("de tus X líquidos aparté Y…") and hypothesis framing — the
  product promise lands before the first save. (e) **Duplicate-data
  protection**: completed users with data are redirected from /onboarding to
  /app, and `saveOnboardingDraftAction` refuses a second completion (the old
  "duplicate income sources after reset" bug class). Intentional re-onboarding
  is a future explicit-reset feature.

No stage weakens money safety: every write stays behind a typed executor with
validation; reversals stay append-only; RLS stays on.

## 6. Non-negotiables (carry over)

- Financial engine is the source of truth for numbers. The LLM never
  hallucinates a balance and never writes the DB directly.
- Cards are debt. Reversals are append-only. Ambiguous money moves → ask.
- RLS enabled; service-role only server-side; secrets never in the browser.
- Tone: zero judgment; logging always feels safe; responses generated from
  facts + memory, not templates.
