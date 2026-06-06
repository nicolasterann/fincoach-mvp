# Kipu MVP - Product Spec

## Naming

- **Kipu** — consumer-facing product, assistant, and app name.
- **Kipu X** — business, legal, investor, and corporate context only.
  Must not appear in user-facing copy (onboarding, dashboard, Telegram,
  AI prompts, marketing).
- **FinCoach** — previous internal working name for this repo; do not use
  as the active user-facing brand.

## Product definition

Kipu is a conversational money assistant and AI-powered financial wellness
platform focused on helping users achieve one main financial goal through a
personal financial coach that understands their real life, remembers their
context, tracks their money, learns their spending patterns, and adjusts
their plan over time.

The product is not a cold expense tracker, not a banking app, not a
dashboard-first product, and not a generic chatbot or GPT wrapper. It is a
financial coach in the user's pocket.

Core positioning:

"Un coach financiero de bolsillo que aprende cómo manejas realmente tu dinero y te acompaña todos los días para cumplir tus metas sin dejar de vivir."

## Margen Kipu (the central differentiator)

**Margen Kipu** is the one number that separates Kipu from a tracker. A tracker
shows you data ("tienes 500$ en el banco") and leaves the thinking to you.
Kipu absorbs the complexity and hands you a single, trustworthy answer:

> "Tu Margen Kipu es lo que puedes gastar tranquilo después de separar pagos,
> gastos necesarios, deudas, ahorro/inversión y tu meta."

Those 500$ in the bank may still owe rent, the gym, the card, transport, food,
and this month's savings before the next paycheck arrives. The real question is
never "how much money exists today?" — it's "how much can I spend freely without
breaking my real-life cash flow, missing obligations, touching savings, or
hurting my goal?" Margen Kipu answers exactly that.

The promise is **peace of mind**: "No tengo que pensar en todas mis cuentas,
fechas, tarjetas, ahorros e inversiones. Kipu ya lo está cuidando. Si Kipu dice
que puedo gastar esto, puedo estar tranquilo."

Principle: **Kipu calculates like a CFO, communicates like a calm coach.**
Internally it reasons across liquid cash, the next income date and frequency,
upcoming fixed expenses, scheduled payments, card balances and due dates, debt
obligations, essential variable spending, savings and investment commitments,
protected/goal money, and cash-flow risk until the next income. Externally it
speaks in simple weekly/day terms ("Te quedan 120$ de Margen Kipu esta semana",
"hoy yo no pasaría de 30$", "sí, sin apretarte", "mejor aguanta") and does NOT
dump the breakdown unless the user asks or asks why the number is below their
bank balance. Savings and investments are protected BEFORE the margin is
computed, so the user can enjoy discretionary spending without sacrificing them.

Receivables, reimbursements, investments, long-term/protected savings and goal
money are NEVER part of Margen Kipu — they may be mentioned separately, but the
spendable number always matches what the user can really use.

## MVP philosophy

The app is designed for real people, not perfect users.

Core principles:
- We do not seek perfection; we seek continuity.
- Spending is not the enemy. Not understanding how spending affects your goal is the problem.
- The app should reduce guilt, not create it.
- The user should be a to return after inactivity without feeling financial shame.
- The app should be useful, emotional, practical, and fun.

## Target user

Young adults in LatAm, approximately 18-35 years old, who want to save, pay debt, stop living paycheck to paycheck, or achieve a concrete financial goal, but do not have a clear money management structure.

Initial use case:
- Save for a concrete goal without stopping their real life.

Example goals:
- Trip to Brazil
- Trip to Punta Cana
- Concert tickets
- Emergency fund
- Paying off a credit card
- Moving out
- Shared plan with friends or family

## Product personality

Tone:
- Close
- Playful
- Motivational
- Non-judgmental
- Sometimes teasing
- Clear
- Financially responsible

Example messages:
- "Hoy no registramos nada… ¿día austero o te estás haciendo el loco conmigo?"
- "Ese café no nos va a arruinar, pero escondérmelo sí."
- "No te voy a decir que no salgas. Solo hagamos que esa salida no nos mate Brasil."
- "Paguemos los $80 completos y nos evitamos interecesarios."
- "Ok, viviste. Ahora acomodemos el plan."

## MVP modules

1. Financial onboarding
2. Main goal
3. Goal definition agent
4. Daily registration through Telegram first, WhatsApp later
5. Internal app chat
6. Payment sources and balances
7. Credit cards treated as debt
8. Learned budget engine
9. Financial coach
10. Hybrid savings plan
11. Weekly flexible plan
12. Whoop-style dashboard
13. Gamification
14. Visual goal/avatar
15. Smart reminders
16. Weekly reconciliation
17. Impossible goal handling
18. Critical debt handling
19. Inactivity recovery system
20. Pause mode
21. Return mode
22. Light mode
23. Future shared goals foundation

## Input types

### Input 1: Base financial information

Captured during onboarding:
- Income
- Real fixed expenses
- Estimated variable recurring expenses
- Debt
- Credit cards
- Payment dates
- Payment methods
- Accounts
- Main goal

### Input 2: Daily financial information

Captured through chat:
- Purchases
- Coffee
- Food
- Uber/taxi
- Clothes
- Outings
- Extra income
- Credit card payments
- Transfers to goal account
- Emergencies
- Unplanned expenses

Examples:
- "Café $3 efectivo."
- "Zapatos $40 Diners."
- "Me pagaron $20 freelance."
- "Mandé $30 a Brasil."
- "Pagué $80 de Visa desde Pichincha."

## Expense types

### Real fixed expenses

Stable commitments:
- Rent
- Netflix
- Internet
- Phone plan
- Gym if fixed
- Insurance
- Subscriptions
- Fixed loan payment

### Estimated variable recurring expenses

Monthly recurring but variable:
- Food
- Supermarket
- Transport
- Gas
- Delivery
- Outings
- Coffee
- Personal shopping

These start as user estimates and are later updated using real spending history.

### Daily variable expenses

Real daily expenses registered through chat.

Core rule:
"The initial budget is a hypothesis. Daily registration reveals reality."

## Payment source system

Every transaction should know where money came from or where the obligation was created.

Possible sources:
- Cash
- Bank account
- Wallet
- Deuna
- Credit card
- Goal acct
- Secondary account

The app must distinguish:
- Expense
- Income
- Transfer
- Debt payment
- Goal contribution
- Refund
- Reversal
- Adjustment

## Credit cards as debt

Credit cards are not available money.

Logic:
- Card purchase = expense today + future debt
- Card payment = transfer from account to debt
- Card payment is not a new expense

Example:
User: "Compré zapatos $40 con Diners."
System:
- Expense clothing +40
- Diners debt +40
- Bank balance unchanged

User: "Pagué $40 de Diners desde Pichincha."
System:
- Pichincha balance -40
- Diners debt -40
- No duplicated expense

## Learned budget engine

The app compares estimated variable expenses against real spending.

Example:
Estimated food: $200
Real registered food: $430

Coach:
"Pensábamos que comida estaba cerca de $200, pero tu realidad va más cerca de $430. No pasa nada. Ahora podemos armar un plan que sí funcione."

The system should:
- Learn spending patterns
- Update estimates over time
- Detect recurring expenses
- Avoid double cou
- Ask for confirmation when a recurring payment appears

## Anti double counting

If user registered gym as $30/month and later says "Pagué $30 del gym", the app should mark the recurring expense as paid, not create a duplicated expense.

If amount changes:
"Tenía registrado el gym en $30, pero hoy pagaste $35. ¿Fue aumento mensual o cargo puntual?"

## Splits and reimbursements

The app must support:
- Gross amount
- Reimbursed amount
- Net amount
- Reimbursement status

Example:
"Pagué $40 en Katari con Diners, pero me devolvieron $20 en efectivo."

System:
- Diners debt +40
- Cash +20
- Net spending impact: $20

## Refunds and reversals

Refunds are not normal income. They are corrections of prior expenses.

Example:
"Me devolvieron $35 de una compra."

The app should try to link it to a prior transaction.

## Multi-currency

Database must support multi-currency from day one.

Each transaction should store:
- Original amount
- Original currency
- Exchange rate to base currency
- Base amount
- Base cncy

Each user has a base currency.

## Goal system

The MVP focuses on one main goal.

Goal fields:
- Name
- Target amount
- Current amount
- Target date
- Goal account
- Weekly required amount
- Monthly required amount
- Feasibility status

Goal statuses:
- Viable
- Challenging
- At risk
- Not currently viable
- Paused due to financial health

## Savings flow

Hybrid savings system:
1. Protected contribution when income arrives
2. Weekly adjustment
3. Extra contributions from additional income

The app must distinguish:
- Planned savings
- Confirmed savings
- Available savings

Money for the goal should live in a real separate place:
- Secondary bank account
- Savings pocket
- Cash envelope
- Family account
- Other

## Financial coach

The coach must answer:
- Daily registration
- Purchase decisions
- Credit card decisions
- Unknown expenses
- Goal adjustments
- Debt questions
- Financial planning questions

The AI interprets and communicates. Code calculates and validates.

## Financial hierarchy

Priority 1: survival
- Rent
- Food
- Basic transport
- Health
- Utilities

Priority 2: avoid serious losses
- Credit card interest
- Late fees
- Overdrafts
- Expensive debt

Priority 3: stabilization
- Emergency fund
- Debt reduction
- Cash flow order

Priority 4: aspirational goals
- Travel
- Concerts
- Purchases
- Events

Priority 5: investment

## Whoop-style dashboard

The dashboard is the **visual home of Margen Kipu**. It answers, at a glance:
how am I doing, how much can I spend calmly this week, am I on track for my goal,
is debt pressuring me, is anything coming soon, how reliable are these numbers,
what should I do next. It translates the math — it never dumps 20 numbers.

**Hero = Margen Kipu** (the one trusted number): the weekly safe-to-spend amount,
the daily rhythm, and a one-line calm explanation. Color follows the engine's
status (con aire / cuida el ritmo / sobre lo seguro). A muted caption teaches the
concept once.

Below the hero, Whoop-style wellness metrics (0–100, translated to calm words,
not raw scores):
- Financial Readiness
- Goal Momentum
- Debt Pressure
- Spending Flexibility
- Financial Accuracy
- Budget Reality (learned essentials)

Plus the next-best-action, upcoming commitments ("lo que viene — ya lo tengo en
cuenta en tu Margen Kipu"), and pause/light state when relevant.

**Dashboard and chat must agree.** Both read from the same briefing engine
(`buildCoachingBriefing` → Margen Kipu + the wellness metrics). If chat says the
Margen Kipu is 95$, the dashboard shows 95$ — never a legacy weekly-plan number
that contradicts it.

Main number:
"How much can I spend without damaging my goal or missing payments?" — that IS
Margen Kipu.

> **Future UI direction:** chat will become its own focused section, separate
> from the dashboard (feed vs DMs). The dashboard stays the calm overview; the
> conversation gets its own space. Noted for a later stage, not built yet.

## Gamification

Features:
- Streaks
- Gems
- Badges
- Streak freeze
- Visual celebrations
- Internal rewards

Streaks should reward useful actions:
- Registering expenses
- Completing check-ins
- Paying card on time
- Saving
- Confirming balances
- Returning after pause

## Visual goal/avatar

Goal visual evolves according to goal type.

Travel:
- Suitcase
- Passport
- Plane
- Beach
- Map

Debt:
- Debt monster shrinking
- Chains breaking
- Card losing weight

Emergency fund:
- Umbrella growing
- Safe filling

The avatar should not die when the user disappears. It should wait or enter pause mode.

## Recovery system

Core rule:
Returning should never feel like catching up on emotional debt.

If inactive:
- Day 1: playful reminder
- Day 3: soft recovery
- Day 5: offer pause mode
- Day 7+: offer return mode

Return options:
1. Resume from today
2. Reconcile current balances
3. Register a summary
4. Rebuild plan

## Technical stack approved

Core:
- Next.js
- React
- TypeScript
- Tailwind
- shadcn/ui
- Vercel
- Supabase Postgres
- Supabase Auth
- Supabase RLS
- Supabase pgvector
- OpenAI API
- Cursor
- GitHub

MVP conversational channel:
- Telegram Bot API

Future channel:
- WhatsApp/Twilio or WhatsApp Cloud API

Automation support:
- Make only as support, not as financial brain

## Architecture principle

The system is multichannel from day one.

**Telegram** is the first MVP messaging channel. **WhatsApp** is a planned
future channel. Telegram, WhatsApp, and internal app chat are channel
adapters only. The financial engine must remain independent.

Flow:
Channel -> Message Normalizer -> Intent Parser -> Financial Engine -> Coach Response Generator -> Channel

## Critical rule

The AI must never directly modify the database.

The AI outputs structured intent JSON.
The financial engine validates and executes.

Example:
{
  "intent": "credit_card_payment",
  "amount": 80,
  "debt_account": "Visa Pichincha",
  "source_account": "Pichincha",
  "confidence": 0.94
}

## Execution model

We build in microsteps. Do not move to a new step until the previous one is confirmed working.

