# Kipu

**Kipu is an AI-native personal financial coach for Latin American users.** Opening
Kipu should feel like opening a personal ChatGPT that *already knows the user's whole
financial life* — balances, accounts, cards, debts, fixed expenses, income, goals,
habits, spending patterns, corrections, and their emotional relationship with money —
and can **act** on it safely.

The difference from a generic chatbot: Kipu **remembers, measures, learns, updates,
acts, corrects, plans, and adapts** using the user's real, live, structured financial
state. Intelligence is flexible (an LLM agent interprets messy natural language and
plans); execution is safe (every database write goes through a typed, deterministic
tool that validates against the real financial state — balances and money movements
are computed by code, never hallucinated).

> **Naming.** The user-facing product is always **Kipu**. The repo / package name
> `fincoach-mvp` is the old internal name — kept only in `package.json`; never surface
> "FinCoach" in product copy or docs.

---

## Current phase

**Post–Stage 27 · Ready for founder/family beta.** (updated 2026-07-02, HEAD `b97bd33`)

- Stages 1–27 are shipped and production-live at **[www.soykipu.com](https://www.soykipu.com)**.
- The **AI-native agent is the primary brain in production** (`KIPU_AGENT_MODE=on`); the
  legacy deterministic pipeline runs only as the fallback if the agent fails.
- The agent tool surface covers capture, corrections, debt, goals/wealth, cashflow,
  spending analytics, personalization, household/shared finance, FX, personality,
  income, scheduled changes, and data export — and S29 extends it to full chat control
  (rename/edit/close accounts & cards, edit/cancel scheduled payments, cancel/delete
  goals, base-currency change, report a bug, explain-my-data) — 109 typed tools total.
- All database migrations (001–036) are applied in production, including
  `033_stage26_scheduled_changes.sql` (verified 2026-07-02, scheduled changes) and
  `034` (soft-close `accounts.status` / `debt_accounts.status` + `user_feedback` table,
  applied 2026-07-02) — both fully live.

The authoritative, newest-first history of every stage is
[`docs/BUILD_PROGRESS.md`](docs/BUILD_PROGRESS.md). Per-module status is the table below.

---

## Getting started

Requirements: Node 20+, a Supabase project, an OpenAI API key.

```bash
npm install
cp .env.example .env.local   # then fill in Supabase + OpenAI keys
npm run dev                  # http://localhost:3000
```

Scripts (the full set — there are no others):

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` | Production build (must be green before deploy) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (must be clean before deploy) |

**QA gates** are dev routes, not npm scripts — visit them in a running dev server:
`/dev/capture-test` (expect 166/166), `/dev/onboarding-wizard-test` (81/81),
`/dev/onboarding-loop-test` (21/21). Dev routes are gated to internal emails
(`KIPU_INTERNAL_EMAILS`).

### Environment posture (local vs production)

`.env.example` ships **safe local-dev defaults**. Production runs the AI-native posture:

| Variable | `.env.example` default (safe/local) | Production |
|---|---|---|
| `KIPU_AGENT_MODE` | `off` | **`on`** (agent is primary) |
| `TRANSACTION_PARSER_MODE` | `basic` | **`ai_with_basic_fallback`** |
| `NEXT_PUBLIC_SITE_URL` / `KIPU_APP_BASE_URL` | localhost | `https://www.soykipu.com` |
| `CRON_SECRET` | — | set (protects `/api/cron/*`) |

---

## Stack

- **Next.js 16.2.4** — App Router, RSC-first. ⚠️ This is not the Next.js most training
  data knows; read `node_modules/next/dist/docs/` before writing framework code (see
  `AGENTS.md`).
- **React 19.2.4**
- **Tailwind CSS v4** — CSS-first (`@theme` in `src/app/globals.css`); there is no
  `tailwind.config` file.
- **Supabase** — `@supabase/ssr` + `supabase-js`; Postgres with RLS on every
  user-owned table; additive, human-applied migrations in `supabase/sql/`.
- **OpenAI** `^6.35` — all model calls go through server actions / route handlers,
  never the browser.
- **TypeScript strict.** Pure functions in `lib/`; effects in actions / route handlers
  / agent executors.
- **Deploy:** Vercel → `www.soykipu.com`. **Channels:** internal web app, Telegram,
  inbound email; two daily Vercel crons (ambient loop, scheduled changes).

---

## Architecture in one paragraph

A user message on any channel reaches the **Kipu agent** (`src/lib/ai/agent/`), which
reads the live financial context + memory, interprets intent, and calls one or more
**typed tools**. Each tool validates and executes deterministically (or asks for
confirmation / more info); the LLM never writes to the DB directly and never issues raw
SQL. The **financial engine** (`src/lib/financial/`, ~68 pure modules) is the source of
truth for every number. Structured **memory** (learned facts, aliases, preferences,
corrections) is surfaced to the agent each turn and updated after it learns. The full
rationale is [`docs/AI_NATIVE_ARCHITECTURE.md`](docs/AI_NATIVE_ARCHITECTURE.md) — the
north star.

---

## Module status

`live` = code + backing migration applied in prod · `fallback-only` = legacy path,
runs only when the agent fails.

| Module | What it does | Stage | Backing migration | Status |
|---|---|---|---|---|
| **AI agent core** | 109 typed tools, live financial context, memory/learning, front door in prod | 12→29 | — | live (`on`) |
| **Onboarding** | Structured wizard (AI-guided, not chat-freeform) + CSV import + multi-currency + Margen preview | 8–11, 22–24 | 010 | live |
| **Universal capture** | Multimodal evidence (photo/PDF/voice/text) → deterministic match/dedup to ledger | 12 | 017–020 | live |
| **Ledger & money model** | `original_*`/`base_*` amounts, reversals append-only, transfers, refunds | 1–5 | 003 | live |
| **Margen Kipu** | The "one number" — safe-to-spend this week, with attribution | 6, 16 | 015 | live |
| **Cashflow & scenarios** | Day-by-day projection, runway, safe-spend, what-if simulator | 15 | (reads) | live |
| **Debt protection** | Health, payoff plan, pressure, statement-date awareness, interest math | 14 | 023 | live |
| **Spending / merchant intel** | Categories, baselines, budgets, anomalies, subscriptions, merchant memory | 15–16 | 024 | live |
| **Goals & wealth** | Goal engine, mini-goals, allocation, feasibility, net worth, investments | 17 | 025 | live |
| **Personalization** | Signals → profile → decisions → tone/framing that adapts to the user | 18 | 026 | live |
| **Personality test** | Life-philosophy test → drives personalization | 20C | 028 | live |
| **Household / shared** | Split math, settlement (who owes whom), recurring shared bills, privacy | 19, 20-P2 | 027, 031 | live |
| **FX / multi-currency** | Honest rates (never invented), user manual > cached, Frankfurter provider | 20A, 24 | 029, 032 | live |
| **Trends / snapshots** | Daily financial snapshots + trend compare → dashboard sparklines | 20G | 030 | live |
| **Ambient loop** | Proactive, anti-spam Telegram check-ins via daily cron | 13 | 022 | live |
| **Universal chat control** | Chat creates/edits/pauses/closes income, fixed expenses, accounts & cards (soft-close), scheduled payments, goals; changes base currency (when safe); report-a-bug; explain-my-data | 26, 29 | 034 | live |
| **Scheduled changes** | Future planned mutations ("en 3 meses sube mi sueldo"), applied by daily cron | 26 | 033 | live |
| **Living dashboard + drilldowns** | Whoop-style dashboard, 11 metric detail pages, LivingThread visuals | 8–10, 27 | (reads) | live |
| **Channels** | Web chat, Telegram webhook (dedupe), inbound email | 3, 12 | 004–007 | live |
| **Legacy pipeline** | Deterministic parser + router + gates | 1–11 | — | fallback-only |

---

## Documentation map

Read in this order:

1. **[`CLAUDE.md`](CLAUDE.md)** / **[`AGENTS.md`](AGENTS.md)** — the operating guide for
   anyone (human or agent) working in this repo. Read first.
2. **[`docs/AI_NATIVE_ARCHITECTURE.md`](docs/AI_NATIVE_ARCHITECTURE.md)** — the north star:
   agent core, tools, memory & learning, safety model, staged migration.
3. **[`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)** — product personality, scope, modules.
4. **[`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md)** — stack, financial engine, money model.
5. **[`docs/ROADMAP_MVP.md`](docs/ROADMAP_MVP.md)** — the original MVP roadmap (historical;
   see its header for current phase).
6. **[`docs/BUILD_PROGRESS.md`](docs/BUILD_PROGRESS.md)** — newest-first per-stage history
   (the authoritative status log).
7. **[`docs/STAGE_REPORTS_INDEX.md`](docs/STAGE_REPORTS_INDEX.md)** — where each per-stage
   retrospective lives (files for 16–21; 22–27 folded into BUILD_PROGRESS).
8. **Beta:** [`docs/FOUNDER_BETA_GUIDE.md`](docs/FOUNDER_BETA_GUIDE.md) (current) ·
   [`docs/DEPLOYMENT_READINESS.md`](docs/DEPLOYMENT_READINESS.md) (env + migration checklist).
9. **Setup:** [`docs/AUTH_SETUP.md`](docs/AUTH_SETUP.md) ·
   [`docs/TELEGRAM_SETUP.md`](docs/TELEGRAM_SETUP.md) ·
   [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md).
10. **QA:** [`docs/TEST_SCRIPTS.md`](docs/TEST_SCRIPTS.md) — behavior-level manual QA.

---

## Safety boundaries (for anyone contributing)

- **No DB write outside a typed executor.** The LLM never issues raw SQL.
- **Migrations are additive and human-applied.** Print the DDL; a human runs it. RLS
  stays enabled on every user-owned table; never weaken it.
- **No hard deletes of financial rows** — reversals are append-only and auditable.
- **Money correctness and privacy are non-negotiable.** Never fabricate an FX rate;
  when unknown, ask or exclude.
- New capability goes into an **agent tool**, never a new regex route.
