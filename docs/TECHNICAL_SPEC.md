# Kipu MVP - Technical Spec

## Naming

- **Kipu** — consumer-facing product and assistant name.
- **Kipu X** — business, legal, investor, and corporate context only.
- **FinCoach** — legacy internal repo name; do not use as active
  user-facing brand.

## Stack

- Next.js 16.2.4 (App Router, RSC-first)
- React 19.2.4
- TypeScript (strict)
- Tailwind CSS v4 (CSS-first config, no `tailwind.config` file)
- @supabase/ssr + @supabase/supabase-js
- Supabase Postgres
- Supabase Auth
- Supabase Row Level Security
- Supabase pgvector
- openai ^6.35 (LIVE)
- Telegram Bot API (first messaging channel, live)
- WhatsApp (future channel)
- Vercel (deployed at www.soykipu.com)
- GitHub (repo host)
- Claude Code (primary coding assistant)

## Build approach

We build in microsteps.

Do not implement large unrelated features in one step.
Each step must be tested before moving forward.

## Core architecture

The app must be multichannel from day one.

Channels:
- Internal web app
- Telegram bot (first MVP messaging channel)
- WhatsApp (future channel)

Channel adapters must be separate from the financial engine.

> NOTA: este pipeline lineal es el FALLBACK determinista. La ruta primaria es
> el loop de tool-calling del agente LLM — ver docs/AI_NATIVE_ARCHITECTURE.md.
> `KIPU_AGENT_MODE` (`off` | `shadow` | `on`) selecciona la ruta; producción corre
> `on` (beta founder/familia): el agente es el primario y el legacy corre solo
> como fallback de emergencia (los gates que el agente ya posee se saltan).

Flow:
Channel -> Message Normalizer -> Intent Parser -> Financial Engine -> Coach Response Generator -> Channel

## Universal calendar (Bloque C)

A nightly cron materializes every future obligation on ONE calendar:
incomes/fixed auto-book or ask, loans auto-book, cards ask at CORTE and at
PAGO, family/scheduled ask, reserve check-ins; pending items resolve via chat;
notifications are AI-generated. Days 29–31 clamp to the REAL last day of the
month. Agent, chat, ambient and dashboard all quote the SAME saldo.

## Product surfaces the engine feeds

Home Principal (Saldo Kipu quipu hero / Hoy / Lo que viene) + Secundario
(Reserva / Meta principal / Próximo pago / Tu mes / Actividad); `/app/saldo`
(Tus capas + flow receipt + honest historical curve from snapshot
`saldo_kipu`); `/app/cuentas` "Dónde está tu plata" (per-account model,
TransferAlert "Tesorería" recommend-only; silent for mono-account users).
"Colchón" is a banned word in UI — the layer is "Reserva".

## Critical AI rule

AI must never directly modify the database.

Primary path: the agent calls typed tools (~110, in
`src/lib/ai/agent/kipu-agent-tools.ts` — e.g. `plan_reserve_withdrawal`);
each tool validates against real financial state and executes, refuses, or
asks for confirmation. The LLM never writes to the DB or issues SQL.

Legacy fallback path only: the parser returns structured JSON intents that
the financial engine validates and executes.

Example (fallback intent):
{
  "intent": "expense",
  "amount": 3,
  "currency": "USD",
  "description": "Coffee",
  "category": "food",
  "source_account": "Cash",
  "confidence": 0.92
}

## Financial engine responsibilities

The code, not the AI, calculates:

- Account balances
- Debt balances
- Credit card purchases as debt
- Credit card payments as debt payments
- Goal progress
- Saldo Kipu (daily hero): accumulating tank — fillDaily = libre-del-mes/30
  (structural), cap 10 days of gustos, drained by real gustos;
  saldo = min(tank, calendar-without-Reserva); runway mode when no active
  income; day boundaries in the USER's timezone
- Layer stack with crossing notice, never blocking:
  Saldo → Reserva → Metas → Ahorro → Patrimonio (liquid investment only) → Deuda
- Per-account cashflow on the same calendar: operating floor per account
  (own obligations + 5-day burn buffer), ideal distribution, exact transfer
  moves, dead pockets, learned attribution
- Goal feasibility
- Debt pressure
- Recurring expense matching
- Anti double counting
- Split expenses
- Refunds
- Reversals
- Multi-currency base amounts

Flexible spending, accuracy, reality and margen* survive only as
ENGINE-INTERNAL fields — retired from the product face; `/app/margen`,
`/app/readiness`, `/app/precision`, `/app/reality` are redirects to
`/app/saldo`.

## Database principles

All user-owned tables must include user_id.

Row Level Security must be enabled before real users are invited.

Never expose Supabase service role keys in frontend code.

Use server-side privileged operations only when strictly necessary.

Migrations live in `supabase/sql/`: 001–050 applied (048 adds `saldo_kipu`
to `daily_financial_snapshots`; 044–046 = universal calendar). Additive only;
never rewrite applied objects; never weaken RLS.

## Money model

Every financial movement should support:

- original_amount
- original_currency
- exchange_rate_to_base
- base_amount
- base_currency

For USD-only users, exchange_rate_to_base = 1.

Display: sign after the number ("92.35$", never "USD 92.35"); two decimals
only when cents exist, integer otherwise; human dates ("25 de julio");
neutral LatAm Spanish.

## Transaction types

Supported transaction types:

- expense
- income
- transfer
- debt_payment
- goal_contribution
- refund
- reversal
- adjustment

## Payment sources

Accounts are places where money exists:
- bank
- cash
- wallet
- goal_account

Debt accounts are obligations:
- credit_card
- loan
- family_debt
- other_debt

Credit cards are debt, not available money.

## Testing principle

After every meaningful change:

- Run npm run lint and npm run build (both must be green)
- /dev/capture-test gate: 484 assertions green
- Behavior-level QA (docs/TEST_SCRIPTS.md) + disposable-persona E2E batteries
  and multi-agent red team per stage
- Run npm run dev when UI changes
- Check git status
- Do not commit unless explicitly told

## Coding assistant

Claude Code is the primary coding assistant; CLAUDE.md and AGENTS.md are the
operating rules. Architecture decisions must follow this technical spec.

For Supabase Auth, RLS, and Next.js App Router integration, use official Supabase documentation as strict context.
