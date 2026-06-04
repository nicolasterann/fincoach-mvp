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

No stage weakens money safety: every write stays behind a typed executor with
validation; reversals stay append-only; RLS stays on.

## 6. Non-negotiables (carry over)

- Financial engine is the source of truth for numbers. The LLM never
  hallucinates a balance and never writes the DB directly.
- Cards are debt. Reversals are append-only. Ambiguous money moves → ask.
- RLS enabled; service-role only server-side; secrets never in the browser.
- Tone: zero judgment; logging always feels safe; responses generated from
  facts + memory, not templates.
