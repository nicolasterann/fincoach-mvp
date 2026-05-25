@AGENTS.md

# Kipu — Claude Code operating guide

This file is the standing brief for every Claude Code session in this repo.
It supersedes general assumptions from training data when they conflict with
what is written here. Read it first, then read the linked specs for depth.

Linked references:
- docs/PRODUCT_SPEC.md — product personality, scope, modules
- docs/TECHNICAL_SPEC.md — stack, financial engine, money model
- docs/ROADMAP_MVP.md — phased path from current state to MVP
- docs/AI_BUILD_RULES.md — autonomy, model choice, safety
- docs/TEST_SCRIPTS.md — manual QA scripts
- docs/BUILD_PROGRESS.md — historical step-by-step build log
- docs/DEPLOYMENT_READINESS.md — env vars and Vercel/Telegram cutover
- docs/VERCEL_DEPLOYMENT.md — Vercel specifics
- docs/TELEGRAM_SETUP.md — Telegram webhook setup

## What Kipu is

Kipu is a conversational money assistant for Latin American users. The MVP
helps users register daily movements, track accounts/debts/income/fixed
expenses/goals, and receive coach-like responses — primarily through
Telegram chat, with a Next.js web app for onboarding, dashboard, and
admin/dev tooling.

The product is habit-first, not dashboard-first. The dashboard exists to
support the chat habit, not the other way around.

Behavioral pillars:
- remembers user context across turns and sessions,
- tracks real financial movements (expense, income, transfer,
  debt_payment, goal_contribution, refund, reversal, adjustment),
- treats credit cards as debt, never as available money,
- learns variable spending patterns,
- motivates with a close, playful, non-judgmental tone,
- helps users recover after inactivity,
- guides toward one main financial goal at a time.

## What Kipu is not

- Not a generic expense tracker.
- Not a generic chatbot.
- Not a banking app.
- Not a budget spreadsheet.
- Not a generic GPT wrapper. The financial engine — not the LLM — is the
  source of truth for every number.

## Brand rules

- Consumer-facing copy always says **Kipu**. Never "FinCoach", "Soy Kipu",
  or "Kipu X" in user-facing surfaces (web onboarding, app dashboard,
  Telegram messages, AI prompts, marketing).
- **Kipu X** is reserved for business / legal / investor / corporate
  contexts (contracts, pitch decks, internal company docs). It must not
  appear in user-facing output.
- Tone: close, playful, motivational, non-judgmental, sometimes teasing,
  clear, financially responsible. See docs/PRODUCT_SPEC.md "Product
  personality" for example phrasing.
- Prefer plain Spanish words: "dinero / lo que entra / lo que sale / lo
  que queda / lo que debes / tu mes / tu semana". Avoid overusing
  "finanzas" or "plata".

## Current architecture overview

- **Next.js (App Router)** for web app and API routes.
- **Supabase** for Postgres, Auth, and Row Level Security.
- **OpenAI** for AI features (onboarding engine, transaction parser,
  coach response). Every AI feature is gated by an env-var feature flag
  with a deterministic non-AI fallback.
- **Telegram Bot API** as the first chat channel. WhatsApp is a future
  channel — keep channel-specific code separate from the financial
  engine.
- **Vercel** is the production host.
- **GitHub** is the deploy repo.

Channel-agnostic flow:

```
Channel (web chat / Telegram) →
  Message normalization →
  Intent parser (basic OR AI) →
  Financial engine (validation + DB writes) →
  Coach response (fallback OR AI) →
  Channel reply
```

The AI never writes to the database. The AI returns structured intents;
code validates and executes.

## Key folders and files

```
src/
  app/
    page.tsx                       — marketing landing
    login/                         — Supabase auth UI
    onboarding/
      onboarding-interview.tsx     — AI-driven conversational onboarding (host)
      ai-actions.ts                — server action wrapping the engine
      save-actions.ts              — final persist into Supabase
    app/                           — protected dashboard + chat input
    api/telegram/webhook/route.ts  — Telegram inbound handler
    dev/                           — local QA pages (NOT for production users)
      ai-parser-test
      chat-handler-test
      coach-response-test
      parser-test
      preferences-test
      supabase-test
      telegram-link-test
      transaction-test
      user-financial-context-test
  lib/
    ai/
      onboarding/                  — onboarding AI engine (router, prompt, patch)
      transaction-parser-router.ts — basic ↔ AI parser switch
      openai-transaction-parser.ts
      basic-transaction-parser-adapter.ts
      coach-response-router.ts     — fallback ↔ AI coach switch
      openai-coach-response.ts
      fallback-coach-response.ts
      chat-transaction-handler.ts  — channel-agnostic intake handler
      apply-chat-transaction-intent.ts
    financial/
      apply-transaction.ts         — the financial engine entry point
      user-financial-context-builder.ts
      dashboard.ts, debt-pressure.ts, goals.ts, flexible-spending.ts,
      budget-reality.ts, money.ts, supabase-mappers.ts, …
    onboarding/                    — pure helpers, draft types, step metadata
    supabase-server.ts, supabase-admin.ts, supabase-client.ts
  types/financial.ts               — canonical financial types
supabase/                          — SQL migrations (gated, see safety)
docs/                              — specs, roadmap, rules, QA scripts
```

## How data flows

### Onboarding
1. User signs in (Supabase Auth) and lands on `/onboarding`.
2. `onboarding-interview.tsx` runs a conversational interview.
3. Each turn calls `processOnboardingTurnAction` → router →
   `processOnboardingTurnWithOpenAI` (or mock fallback).
4. AI returns `{ assistantMessage, patch, advanceToStep, ... }`.
5. Host sanitizes the patch (strips nullish keys, blocks future-step
   `markStepsExplicitlyEmpty`), applies it via
   `applyOnboardingDraftPatch`, then validates the step transition with
   `resolveAiNextStep`.
6. When the user reaches Review and confirms, `saveOnboardingDraftAction`
   writes profile, accounts, debt_accounts, income_sources,
   fixed_expenses, goals, and coach_preferences. The broader context
   model also includes `user_context_notes`, but that table is not part
   of the core validated onboarding save path yet.
7. Redirect to `/app`.

### Context builder
- `buildUserFinancialContext(userId)` in
  `src/lib/financial/user-financial-context-builder.ts` is the single
  read path that produces the full user context (profile, accounts,
  debts, income, fixed expenses, goals, coach preferences, notes, plus
  derived dashboard signals like flexible spending, debt pressure, goal
  feasibility).
- `/dev/user-financial-context-test` renders this context for debugging.

### App dashboard
- `/app` currently loads the persisted user state needed for the
  dashboard/chat surface — accounts, debts, goals, and recent
  movements — via `loadUserFinancialData`, not
  `buildUserFinancialContext`. It does not yet consume the full user
  financial context builder in the same way as
  `/dev/user-financial-context-test` (e.g. income sources, fixed
  expenses, coach preferences, and derived dashboard signals are not
  wired into the live dashboard yet). Aligning `/app` with the full
  context builder is part of the next first-use/dashboard phase.

### Telegram inbound
1. Telegram POSTs to `/api/telegram/webhook`.
2. Route validates `TELEGRAM_WEBHOOK_SECRET`, deduplicates by
   `update_id` in `telegram_processed_updates`, and resolves the
   linked user via `telegram_user_links`.
3. Calls `handleChatTransactionMessage` (channel-agnostic) → parser
   router → financial engine → coach response router.
4. Reply is sent back via `sendTelegramMessage`.

### AI parser
- `transaction-parser-router.ts` reads `TRANSACTION_PARSER_MODE`
  (`basic` | `ai` | `ai_with_basic_fallback`) and dispatches.
- `ai_with_basic_fallback` only accepts AI results when confidence is
  high enough; otherwise it falls back to the basic adapter.
- `OPENAI_TRANSACTION_PARSER_MODEL` selects the model.

### AI coach
- `coach-response-router.ts` reads `COACH_RESPONSE_MODE` (`fallback`
  | `ai`).
- Falls back deterministically (`buildFallbackCoachResponse`) when AI is
  disabled or its confidence is below threshold.
- `OPENAI_COACH_MODEL` selects the model.

## Safety boundaries

Claude Code **must not** touch the following without explicit per-task
permission from the user:

- **SQL / migrations** in `supabase/`. No schema changes, no manual
  edits to applied migrations, no new migrations without approval.
- **Supabase Row Level Security policies and grants**. RLS must remain
  enabled. Service-role-only grants are intentional.
- **Auth / session logic** in `lib/supabase-server.ts`,
  `lib/supabase-admin.ts`, login flow, middleware.
- **Telegram production behavior**: webhook registration, bot token,
  webhook secret, dedupe table, send-message helper.
- **Environment variables**. `.env.example` is the source of truth for
  shape. Do not edit `.env.local`. Do not commit secrets.
- **Destructive DB actions**. No `delete` or mass `update` against
  Supabase. No truncates. No data backfills without approval.
- **AI model selection** in production. Do not change
  `OPENAI_*_MODEL` defaults, `TRANSACTION_PARSER_MODE`,
  `COACH_RESPONSE_MODE`, or `ONBOARDING_ENGINE_MODE` without approval.
- **Feature flag direction**: do not flip a feature from fallback to AI
  in production without approval.
- **package.json / package-lock.json**. No new dependencies without
  approval. No version bumps. No script changes.
- **Direct calls to OpenAI/Anthropic from the browser**. All model
  calls must go through a server action or route handler.

If a task seems to require any of the above, stop and ask before
acting.

## Required workflow per task

1. **Inspect first.** Read the files the task touches, plus their
   immediate callers and types.
2. **Implement within scope.** Do not refactor unrelated code. Do not
   add helpers that aren't used.
3. **Preserve fallbacks.** Every AI feature must keep its
   non-AI fallback intact.
4. **Run `npm run lint`.** Must be clean.
5. **Run `npm run build`.** Must succeed end-to-end, including
   TypeScript and static page generation.
6. **Manual QA when UI changes.** Use scripts in docs/TEST_SCRIPTS.md.
7. **Report files changed**, intentional non-changes, and any risks.
8. **Do not commit unless explicitly instructed.** If the user says
   "commit", review `git status` and `git diff --stat` first.

## Coding style expectations

- TypeScript strict; no `any` slipped into shared types.
- Prefer pure functions in `lib/`; effects (DB, network) live in
  `actions` files and route handlers.
- Server actions: `"use server"` at top. Read sessions from the
  Supabase server client. Never expose service-role keys to the
  client.
- React Server Components by default; opt into client with `"use
  client"` only where state/handlers are needed.
- File length: split when a single component exceeds ~600 lines or
  mixes too many responsibilities.
- Default to **no comments**. Add a one-line comment only when the
  *why* is non-obvious (e.g. "AI sometimes sends null here, would
  wipe the field").
- Currency math: store both `original_*` and `base_*` (see Money
  model in TECHNICAL_SPEC). Never round away cents in storage.
- Display: show two decimals when amount has cents; integer
  otherwise.

## AI behavior expectations

- AI returns structured intents only. Code applies them.
- AI prompts live in `lib/ai/**/prompt.ts` (or equivalent). Update
  prompts, not parsers, when the AI is making conversational
  mistakes.
- Every AI router must:
  1. read an env-var mode flag,
  2. degrade gracefully to a deterministic fallback,
  3. accept results only when confidence ≥ defined threshold.
- Onboarding patches are sanitized client-side (`sanitizeAiPatch
  ForCurrentStep`) — only `currentStep` may appear in
  `markStepsExplicitlyEmpty`, and nullish keys are stripped to
  prevent shallow-merge wipes.
- Coach tone normalization lives in
  `src/lib/onboarding/normalize-coach-tone.ts`. The save flow uses
  `resolveOnboardingCoachTone(draft)`.

## Testing expectations

- After meaningful changes, run lint + build + relevant manual
  scripts.
- For UI changes, run `npm run dev` and walk the flow in a browser
  before reporting success.
- For Telegram changes, exercise the webhook via curl or local
  ngrok-style tunnel before any production cutover.
- Persisted context after onboarding should be inspected via
  `/dev/user-financial-context-test`.
- See docs/TEST_SCRIPTS.md for reusable scripts and inputs.

## When uncertain

- Prefer the smallest safe change.
- Ask before doing anything that touches the safety boundary list.
- Add a one-line comment only where future readers would otherwise
  trip on a non-obvious decision.
- Surface risks explicitly in the final summary, including a list of
  intentional non-changes.
