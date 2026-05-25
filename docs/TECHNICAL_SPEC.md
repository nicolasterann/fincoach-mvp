# Kipu MVP - Technical Spec

## Naming

- **Kipu** — consumer-facing product and assistant name.
- **Kipu X** — business, legal, investor, and corporate context only.
- **FinCoach** — legacy internal repo name; do not use as active
  user-facing brand.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui later
- Vercel later
- Supabase Postgres
- Supabase Auth
- Supabase Row Level Security
- Supabase pgvector later
- OpenAI API later
- Telegram Bot API (first MVP messaging channel)
- WhatsApp (future channel)
- GitHub later
- Cursor as coding assistant

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

Flow:
Channel -> Message Normalizer -> Intent Parser -> Financial Engine -> Coach Response Generator -> Channel

## Critical AI rule

AI must never directly modify the database.

AI returns structured JSON intents.
The financial engine validates and executes changes.

Example:
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
- Flexible spending
- Financial accuracy
- Budget reality
- Goal feasibility
- Debt pressure
- Recurring expense matching
- Anti double counting
- Split expenses
- Refunds
- Reversals
- Multi-currency base amounts

## Database principles

All user-owned tables must include user_id.

Row Level Security must be enabled before real users are invited.

Never expose Supabase service role keys in frontend code.

Use server-side privileged operations only when strictly necessary.

## Money model

Every financial movement should support:

- original_amount
- original_currency
- exchange_rate_to_base
- base_amount
- base_currency

For USD-only users, exchange_rate_to_base = 1.

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

- Run npm run lint
- Run npm run dev when UI changes
- Check git status
- Commit stable milestones

## Cursor usage

Cursor can generate code, but architecture decisions must follow this technical spec.

For Supabase Auth, RLS, and Next.js App Router integration, use official Supabase documentation as strict context.
