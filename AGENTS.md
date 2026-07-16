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

No bank connections — manual capture is by design. No monetization yet.
Current roadmap: engine refinement (gustos classification SHIPPED as Bloque H
= "objetivo mensual" comida/transporte; essentials refine-loop, variable income,
shared/refunds verification pending — LatAm installments/cuotas SHIPPED as Bloque G) → deep chat-agent review with real
beta failures → visual deep-dive → Bloque E (secondary surfaces: Tu mes,
Actividad, Metas, Deudas, Patrimonio, Gasto, FX).

Read first: `CLAUDE.md`, then `docs/AI_NATIVE_ARCHITECTURE.md` (north star),
then `docs/PRODUCT_SPEC.md` / `docs/TECHNICAL_SPEC.md`.

## How to build (AI-native, not route-native)

- The brain is an **LLM agent** that interprets intent broadly and chooses
  **tools**. Add capabilities as **tools**, never as new regex routes or
  phrase gates.
- Production posture: `KIPU_AGENT_MODE=on` — the agent is the primary brain;
  the legacy pipeline is emergency fallback only (never re-extend its gates).
  The tool surface is ~110 typed tools. Agent, chat, ambient, and fallback
  must quote the SAME saldo the dashboard shows.
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
  variable budgets, goal feasibility, and debt pressure. (The old
  accuracy/flexibility scores are retired from the product face —
  engine-internal only.) New capabilities are exposed as tools.
- A universal materialization calendar (nightly cron, Bloque C) books what
  falls due: income/fixed auto or ask, loans auto-book, cards ask at BOTH
  cutoff and payment date, family/scheduled ask, reserve check-ins; users
  resolve by chat, notifications are AI-generated. Days 29–31 clamp to the
  month's real last day. Cards are ONE system (no ambient card dupes).
- Avoid double counting (recurring payment ≠ extra expense). If a recurring
  amount changes, learn whether it's one-time or permanent.

## Database rules

- Every user-owned table has `user_id` and RLS enabled. Service-role grants
  are intentional (channel handlers run without a user session).
- Never expose service-role keys to the browser.
- Additive migrations are allowed when a capability needs them; print exact
  DDL and let the human apply it. Never weaken RLS or drop applied objects.
  Applied migrations: 001–055 (048 adds `saldo_kipu`; 049–050 = installment_plans/cuotas; 051 = objetivo mensual: `transactions.budget_treatment` + `objective_month_closes` + ledger RPC; 052 = `objective_versions`; 053 = `amount_base` + RPC `kipu_upsert_budget_objective`; 054 = backfill + invariantes NOT NULL, ANCLA histórica atómica y RPC bulk de onboarding; 055 = historia inmutable POR PRIVILEGIO: `authenticated` pierde toda escritura sobre `objective_versions` (solo SELECT), las RPC pasan a SECURITY DEFINER y el servidor DERIVA el mes vigente (`kipu__user_month`) y qué categorías son objetivo — ambas comparten el helper `kipu__objective_write`)
  `daily_financial_snapshots`); number new ones from there.

## UI rules

Mobile-first. Feels like financial wellness (Whoop-for-money), not accounting
software. Tone: close, playful, clear, zero-judgment, financially responsible.

The daily hero is **Saldo Kipu** (Bloque D): an accumulating spend-for-fun
balance — a tank refilled by monthly-free/30, capped at 10 days of gustos,
drained by real gustos; shown = min(tank, calendar-without-Reserva) —
rendered as a vertical quipu of knots. Money sits in layers Saldo → Reserva →
Metas → Ahorro → Patrimonio → Deuda; crossing a layer always warns, never
blocks. The protected layer is **Reserva** — the word "colchón" is banned in
UI. Day boundaries use the user's timezone. Retired from the product face:
Margen as a visible brand, Pulso score, weekly hero framing.

Detail surfaces: `/app/saldo` (Tus capas + flow receipt + honest historical
curve from snapshot `saldo_kipu`) and `/app/cuentas` "Dónde está tu plata"
(per-account cashflow on the same calendar, per-account operating floors —
own obligations + 5-day burn buffer — ideal distribution, exact transfer
moves resolved via chat, physical layers, dead pockets; Tesorería/
TransferAlert is recommend-only; silent for single-account users). The chat
tool `plan_reserve_withdrawal` gathers $X into an account respecting floors,
warning on layer crossings.

## Testing

After meaningful changes: `npm run lint`, `npm run build`, `/dev/capture-test`
(all 309 assertions green), and the behavior-level QA in
`docs/TEST_SCRIPTS.md`; larger stages also get a disposable-persona E2E
battery and a multi-agent red team. Check `git status`. Do not commit unless
told.
