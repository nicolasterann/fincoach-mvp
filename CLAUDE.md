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
- docs/ROADMAP.md — **the live roadmap.** The only source of work order
  (Bloque M). Anything else that states a "next" is stale.
- docs/ROADMAP_MVP.md — the original 13-phase plan, kept as HISTORICAL ARCHIVE
  only. It is archaeology, not pending work. Live status lives in
  docs/BUILD_PROGRESS.md. Today: Bloques A–D, F, G, H, I, J, K, Pre-M and M0
  are closed; only the refund fail-safe of L was built by decision; Bloque M is
  active and unblocked (see docs/ROADMAP.md).
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

- **Daily hero = Saldo Kipu:** an accumulating balance for gustos, rendered as
  a vertical quipu. It is refilled from monthly free cash, capped at ten days,
  drained by real gustos, and bounded by the calendar. Every channel must quote
  the same engine value as the dashboard.
- **Layers:** Saldo → Reserva → Metas → Ahorro → Patrimonio → Deuda. Crossing a
  layer warns but never blocks. Reserva is the protected layer; “colchón” is
  retired product copy.
- **Retired face:** Margen Kipu, Pulso Kipu, Flexibilidad, Precisión, Realidad,
  named states and weekly hero framing. Their old routes redirect; internal
  engine fields may remain.
- **Current work order:** `docs/ROADMAP.md` is authoritative. Bloque M, the
  complete front, is the only active block and is UNBLOCKED. No monetization and
  no bank connections; manual capture remains deliberate.

**M0 CLOSED on 2026-08-24.** The native tool-calling loop is Kipu's single AI
brain in production: it reads the live structured financial state and memory,
chooses typed tools, stages exact actions in the durable operation manifest,
and verifies writes before replying. The unreachable envelope planner and its
v29–v44 repair/publication stack were deleted. `AgentMode` is `off | loop`;
`on` and `shadow` are compatibility aliases for `loop`, and emergency
rollback is `off` to the frozen legacy pipeline.

M0 closed against the real 35-lane sample at 35/35 and the full permanent gate
stack. More than nine independently discovered defect classes remain as
regression coverage. Detailed v10–v44, M0.11A and tool-loop history lives in
`docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` and the historical `docs/M0_*`
reports, not in this standing brief. Migrations 001–124 are applied; 125 is
next.

## What Kipu is not

- Not a generic expense tracker. Not a banking app. Not a budget spreadsheet.
- Not a generic GPT wrapper. The financial engine — not the LLM — is the
  source of truth for every number.
- **Not a router where every intent must be pre-coded.** Not a phrase-matcher.
  Not fallback-driven. Not command-based.

## The core architecture: the native loop calls tools

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

The tool surface lives in `src/lib/ai/agent/kipu-agent-tools.ts` — ~124
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

## Legacy pipeline (frozen emergency rollback)

The deterministic pipeline in `chat-transaction-handler.ts` remains unchanged
behind `KIPU_AGENT_MODE=off`. It is the emergency rollback, not an automatic
fallback from the native loop and not a place for new capabilities. New work
belongs in typed tools and the loop.

`KIPU_AGENT_MODE` selects only `off | loop`: `off` runs the frozen legacy
pipeline; `loop` runs the production native agent. Historical `on` and `shadow`
values are accepted only as compatibility aliases for `loop` and emit a
one-time warning.

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
   `/dev/capture-test` green (823 assertions after M0 closure), and for stage-level work run a
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
