# FinCoach MVP - Product Spec

## Product definition

FinCoach is an AI-powered financial wellness platform focused on helping users achieve one main financial goal through a personal financial coach that understands their real life, remembers their context, tracks their money, learns their spending patterns, and adjusts their plan over time.

The product is not a cold expense tracker, not a banking app, and not just a generic chatbot. It is a financial coach in the user's pocket.

Core positioning:

"Un coach financiero de bolsillo que aprende cómo manejas realmente tu dinero y te acompaña todos los días para cumplir tus metas sin dejar de vivir."

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

Metrics:
- Financial Readiness
- Goal Momentum
- Debt Pressure
- Spending Flexibility
- Financial Accuracy
- Budget Reality

Main number:
"How much can I spend without damaging my goal or missing payments?"

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

Telegram, WhatsApp, and internal app chat are just channel adapters. The financial engine must remain independent.

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

