@AGENTS.md

# Kipu — Claude Code operating guide (AI-native)

This file is the standing brief for every Claude Code session in this repo.
It supersedes general training assumptions AND any older doc that conflicts
with it. Read it first.

> **2027, not 2010.** Kipu is an AI-native financial coach, not a route-based
> chatbot with AI sprinkled on top. If something in this repo makes Kipu feel
> like validation logic, a parser, or a finance tracker, that is a bug to fix,
> not a pattern to extend.

Linked references (updated for this direction):
- docs/AI_NATIVE_ARCHITECTURE.md — **the north star.** Agent core, tools,
  memory & learning, safety model, staged migration. Read this second.
- docs/PRODUCT_SPEC.md — product personality, scope, modules
- docs/TECHNICAL_SPEC.md — stack, financial engine, money model
- docs/ROADMAP_MVP.md — historical phased path (superseded; live status lives
  in docs/BUILD_PROGRESS.md. Today: Bloques A–D+F shipped, next Bloque E)
- docs/TEST_SCRIPTS.md — manual QA (behavior-level, not phrase-level)

## What Kipu is

Kipu is a personal financial AI coach for Latin American users. Opening Kipu
should feel like opening a personal ChatGPT that **already knows the user's
entire financial life** — balances, accounts, cards, debts, fixed expenses,
income, goals, habits, spending patterns, impulses, preferences, history,
corrections, and their emotional relationship with money — and can **act** on
it safely.

The difference from ChatGPT: Kipu does not only answer. It **remembers,
measures, learns, updates, acts, corrects, plans, and adapts** using the
user's real, live, structured financial state. If Kipu cannot beat a generic
Claude/ChatGPT project with a budgeting artifact, there is no reason to build
it. Kipu wins because of **live structured financial memory + safe action**.

The user must be able to say almost anything — "borra los últimos 10
movimientos", "no era con Visa, era Pichincha", "cambia mi sueldo, ahora gano
1400", "Juan me devolvió lo de la cena", "ese gasto era mitad mío y mitad de
Ana", "cuando digo Pichincha me refiero a mi cuenta", "esta semana fue un
desastre, ayúdame a cuadrar", "no registré nada en 5 días, retómame sin
hacerme sentir mal" — and Kipu understands the intent, asks for what's
missing, executes safely when it can, learns, and replies like a coach. It
must NOT break because we didn't pre-code that exact phrase.

## Product surface today (do not resurrect retired concepts)

- **Daily hero = Saldo Kipu** (Bloque D, deployed): an ACCUMULATING balance
  for gustos — a tank refilled `fillDaily = libre-del-mes/30` (structural),
  capped at 10 days of gustos, drained by real gustos;
  `saldo = min(tanque, calendario-sin-Reserva)`. Visual: vertical quipu of
  knots. Runway mode when no active income. Day boundaries in the USER'S
  timezone. Agent, chat, ambient and fallback must cite the SAME saldo as the
  dashboard.
- **Layers** (aviso de cruce ALWAYS, never block): Saldo → Reserva → Metas →
  Ahorro → Patrimonio (liquid investment only) → Deuda. The Reserva is the
  protected layer; the word "colchón" is banned in UI copy.
- **Retired from the product face:** Margen Kipu as a visible brand, Pulso
  Kipu (0–100 score), Flexibilidad, Precisión, Realidad, named states
  (Holgado/Justo/Estirando), weekly framing in the hero. `/app/margen`,
  `/app/readiness`, `/app/precision`, `/app/reality` are redirects;
  `margenWeekly`/`margenDaily` survive only as engine internals.
- **Home:** Principal (Saldo Kipu quipu hero / Hoy / Lo que viene) +
  Secundario (Reserva / Meta principal / Próximo pago / Tu mes / Actividad).
  Detail pages: `/app/saldo` (Tus capas + flow receipt + honest history from
  snapshot `saldo_kipu`) and `/app/cuentas` "Dónde está tu plata" (Bloque F:
  per-account cashflow on the same calendar, per-account operating floors,
  ideal distribution, physical layers, dead pockets, Tesorería TransferAlert
  recommend-only; silent when mono-account).
- **Bloque C (closed):** universal materialization calendar — nightly cron;
  incomes/fijos auto or ask, loans auto-book, cards ask at CORTE and PAGO,
  family/scheduled ask, reserves check-in; resolve by chat; AI-generated
  notifications. Cards are ONE system.
- **Migrations:** 001–048 applied (`supabase/sql/`; 048 = `saldo_kipu` in
  `daily_financial_snapshots`).
- **Next:** Bloque E (secondary surfaces: Tu mes, Actividad, Metas, Deudas,
  Patrimonio, Gasto, FX) + engine refinement (LatAm installments/cuotas,
  gustos classification, essentials refine-loop, variable income). No
  monetization; no bank connections — manual capture by design.

## What Kipu is not

- Not a generic expense tracker. Not a banking app. Not a budget spreadsheet.
- Not a generic GPT wrapper. The financial engine — not the LLM — is the
  source of truth for every number.
- **Not a router where every intent must be pre-coded.** Not a phrase-matcher.
  Not fallback-driven. Not command-based.

## The core architecture: agent plans, tools execute

```
User message (any channel)
  → Kipu Agent (LLM): reads live financial memory + history + learned facts,
      understands intent broadly, decides what to do
  → calls one or more TOOLS (safe, deterministic capabilities)
  → each tool VALIDATES and executes (or asks for confirmation / more info)
  → Agent composes a natural, personalized reply and updates memory
```

Kipu also acts **proactively**: the universal materialization calendar
(Bloque C, nightly cron) and ambient topics (e.g. transfer_needed,
payday_distribution) produce AI-generated notifications; the user resolves
them in the same chat through the same tools. Proactive and reactive paths
cite the same numbers.

Two unbreakable halves:

1. **Intelligence is flexible (the LLM).** It interprets messy natural
   language, remembers context, infers patterns, plans, and chooses tools. It
   is NOT limited to a fixed list of regex routes.
2. **Execution is safe (deterministic tools).** Every database write goes
   through a typed tool that validates against the real financial state.
   Balances, reversals, transfers, and corrections are computed by code, never
   hallucinated. A tool may refuse or ask for confirmation; the LLM never
   writes to the DB directly.

This is how "flexible intelligence" and "reliable money" coexist. Reliability
must NOT mean rigidity.

The tool surface lives in `src/lib/ai/agent/kipu-agent-tools.ts` — ~110+
typed tools today (capture, corrections, transfers, commitments, calendar
resolves, `plan_reserve_withdrawal`, memory, …) wrapping the safe writer
modules, the financial context builder, and the memory store. When adding a
capability, add a **tool**, not a new regex route.

### Memory & learning (what makes Kipu "know you")

Kipu maintains structured memory beyond the ledger:
- **Financial state** — accounts, cards, debts, income, fixed expenses, goals,
  balances (source of truth; `transactions` is the audit log).
- **Learned facts / aliases / preferences** — "Pichincha = the bank account,
  not the Visa", default payment source, "la cena de siempre", who "Juan" and
  "mi mamá" are, recurring patterns, weak spots (overspends on food after
  weekends), emotional cues. Stored in `user_context_notes` /
  `user_financial_preferences` (among other memory stores — merchant memory,
  personalization, personality) and surfaced to the agent every turn.
- **Corrections teach.** When the user corrects Kipu, the agent should persist
  the correction as a learned fact via the `remember_fact` tool so it does not
  repeat the mistake.

The agent reads memory before acting and writes memory after learning. This is
the self-improving loop. Memory is context for intelligence; the financial
engine is still the source of truth for numbers.

## Legacy pipeline (being migrated, kept as deterministic fallback)

The previous deterministic pipeline (`chat-transaction-handler.ts` with its
prefilter, Universal Router, and per-intent gates) still exists and runs when
the agent is disabled or unavailable. It is the **safety net**, not the target.
Do not invest in widening regex gates or adding new narrow routes. New
capability work goes into agent tools. The legacy gates are being collapsed
into tools over the staged migration in docs/AI_NATIVE_ARCHITECTURE.md.

Current agent posture (production, beta): `KIPU_AGENT_MODE=on` — the agent is the
real primary. The agent-era write gates it fully owns (recovery-confirmation,
transfer, commitment) are **skipped** when `agentMode() === "on"`; `runChatPipeline`
runs only as the emergency fallback on agent failure, leaving just the core net
(parser + fixed-expense matcher + advisory/coach/router). Those guarded gates still
serve `KIPU_AGENT_MODE=off` unchanged and remain until fully retired — never
re-extend them. (The full staged-migration history lives in
docs/AI_NATIVE_ARCHITECTURE.md §5 and docs/BUILD_PROGRESS.md.)

`KIPU_AGENT_MODE` (`off` | `shadow` | `on`) selects the front door:
- `off` — legacy pipeline only (the safe default in `.env.example`; NOT the
  production posture).
- `shadow` — agent runs read-only/observed; legacy still answers.
- `on` — agent is the primary brain; legacy is the fallback on failure.
  **This is the production posture (founder/family beta).**

## Safety boundaries (these REMAIN — intelligence flexible, money safe)

Claude Code must not do the following without explicit per-task permission:

- **SQL / migrations** in `supabase/`: additive migrations are allowed when a
  capability needs them; never drop/rewrite applied objects, never weaken RLS.
  RLS stays enabled on every user-owned table. Print exact DDL; the human
  applies it.
- **Row Level Security policies / grants.** Service-role grants are
  intentional (channel handlers run without a user session).
- **Auth / session logic** (`lib/supabase-server.ts`, `lib/supabase-admin.ts`,
  login, middleware).
- **Telegram production behavior** (webhook secret, dedupe, send-message).
- **Secrets.** Never commit secrets. `.env.example` is the shape of truth.
- **Destructive DB actions.** No hard deletes of financial rows — reversals are
  append-only and auditable. No mass updates / truncates / backfills without
  approval.
- **Direct model calls from the browser.** All model calls go through a server
  action or route handler.
- **No DB write outside a typed executor.** Transaction-ledger writes go
  through the single writer module; other domain writes go through their store
  module. The LLM never issues raw SQL or writes directly.

Everything else — routing, the pipeline, response generation, prompts,
classifiers, docs — is fair game to refactor toward the vision.

## Required workflow per task

1. **Inspect first** (code + the two north-star docs).
2. **Build the AI-native way:** add/extend a tool, enrich the agent's context
   or memory, improve the agent prompt — do NOT add a regex route.
3. **Keep execution safe:** every write validated by a typed executor; ambiguity
   → ask or confirm, never guess a money movement.
4. **Run `npm run lint` and `npm run build`** — both must be clean/green.
5. **Test by behavior, not phrasing** (docs/TEST_SCRIPTS.md); keep
   `/dev/capture-test` green (484 assertions), and for stage-level work run a
   disposable-persona E2E battery + red-team pass.
6. **Report** files changed, intentional non-changes, risks, and any DDL to
   apply manually.
7. **Do not commit** unless explicitly told.

## Coding style

- TypeScript strict; no `any` in shared types.
- Pure functions in `lib/`; effects (DB, model, network) in `actions` /
  route handlers / agent executors.
- Server-only secrets. RSC by default; `"use client"` only where needed.
- Money: store `original_*` and `base_*`; display two decimals only when
  cents exist, integer otherwise; sign after the number ("25$"), never
  "USD 25.00" in user copy.
- Default to no comments; add a one-liner only when the *why* is non-obvious.

## Response & voice

- Natural LatAm Spanish. Close, playful, motivating, zero judgment, clear,
  human, financially responsible. Never expose parser/route/fallback/DB/JSON
  language as the normal experience.
- Responses are generated from structured facts + memory, not copied from a
  template. Deterministic strings are fallback/confirmation safety only.
- Consumer-facing copy always says **Kipu** (never "FinCoach"/"Kipu X").
  **Kipu X** is business/legal/investor only.

## When uncertain

- Prefer the **most intelligent safe** action, not the most rigid one.
- Ambiguous money movement → ask one natural question or confirm; never mutate
  on a guess.
- Touching a safety-boundary item → stop and ask.
- Surface risks and intentional non-changes in the final summary.
