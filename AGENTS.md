<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Kipu Agent Instructions (AI-native)

## Product context

This project is **Kipu**: an AI-native personal financial coach for LatAm
users. "FinCoach" was an old internal name; user-facing is always **Kipu**.
**Kipu X** is business/legal/investor only.

Kipu should feel like a personal ChatGPT that already knows the user's whole
financial life and can act on it safely — it remembers, measures, learns,
acts, corrects, plans, and adapts on live structured financial state. It is
**not** an expense tracker, **not** a dashboard-first app, **not** a generic
GPT wrapper, and **not** a rigid route-based chatbot.

Read first: `CLAUDE.md`, then `docs/AI_NATIVE_ARCHITECTURE.md` (north star),
then `docs/PRODUCT_SPEC.md` / `docs/TECHNICAL_SPEC.md`.

## How to build (AI-native, not route-native)

- The brain is an **LLM agent** that interprets intent broadly and chooses
  **tools**. Add capabilities as **tools**, never as new regex routes or
  phrase gates.
- **Intelligence is flexible; execution is safe.** The LLM plans; typed
  deterministic tools validate and execute every write. The LLM never writes
  to the DB directly and never issues raw SQL.
- Memory is first-class: read learned facts/aliases/preferences before acting;
  persist corrections and inferred patterns after (the `remember_fact` tool).
- Work in small, testable steps. Don't add packages unless necessary. Behavior
  over phrasing — never build a feature as exact-phrase matching.

## Channels

Internal web app + Telegram (first) + WhatsApp (later). Channel-specific code
stays separate from the agent core and the financial engine. The web internal
chat may show conversations from other channels (shared `chat_messages`).

## Financial rules (source of truth = the engine, not the LLM)

- Credit cards are debt, not available money. A card purchase = an expense
  today + a debt increase. A card payment = source account down + debt down,
  NOT a new expense.
- Reversals are append-only and auditable (never hard-delete financial rows).
- The system supports multi-currency fields, split expenses, reimbursements,
  refunds, reversals, transfers (own + person-to-person), receivables/loans,
  recurring/fixed expense create+update, scheduled future payments, learned
  variable budgets, financial accuracy, flexible spending, goal feasibility,
  and debt pressure. New capabilities are exposed as tools.
- Avoid double counting (recurring payment ≠ extra expense). If a recurring
  amount changes, learn whether it's one-time or permanent.

## Database rules

- Every user-owned table has `user_id` and RLS enabled. Service-role grants
  are intentional (channel handlers run without a user session).
- Never expose service-role keys to the browser.
- Additive migrations are allowed when a capability needs them; print exact
  DDL and let the human apply it. Never weaken RLS or drop applied objects.

## UI rules

Mobile-first. Feels like financial wellness (Whoop-for-money), not accounting
software. Tone: close, playful, clear, zero-judgment, financially responsible.

## Testing

After meaningful changes: `npm run lint`, `npm run build`, and the behavior-
level QA in `docs/TEST_SCRIPTS.md`. Check `git status`. Do not commit unless
told.
