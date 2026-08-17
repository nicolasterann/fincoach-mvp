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

## Saldo Kipu (the central differentiator)

**Saldo Kipu** is the one number that separates Kipu from a tracker: an
ACCUMULATING balance for gustos. A tracker shows you data ("tienes 500$ en el
banco") and leaves the thinking to you. Kipu absorbs the complexity and hands
you a single, trustworthy answer.

It works like a tank: it refills daily with fillDaily = libre-del-mes/30
(structural), caps at 10 days of gustos, drains with real gustos, and the
number shown is saldo = min(tanque, calendario-sin-Reserva). Visual: a
vertical quipu of knots. Day boundaries are computed in the USER'S TIMEZONE.
With no active income, it switches to runway mode.

The **Reserva** (never "colchón" in UI) is a separate protected layer.
Layers: Saldo → Reserva → Metas → Ahorro → Patrimonio (liquid investment
only) → Deuda. Crossing a layer ALWAYS warns, never blocks.

The promise is **peace of mind**, unchanged: "No tengo que pensar en todas mis
cuentas, fechas, tarjetas, ahorros e inversiones. Kipu ya lo está cuidando. Si
Kipu dice que puedo gastar esto, puedo estar tranquilo."

Principle: **Kipu calculates like a CFO, communicates like a calm coach.**
Internally it reasons across income dates, fixed expenses, cards, debts,
savings and goal money — all through the universal calendar — and externally
it hands the user one calm number. Receivables, reimbursements, investments
and goal money are NEVER part of the Saldo Kipu.

The earlier hero, **Margen Kipu**, is superseded by Saldo Kipu (Bloque D):
"Margen" survives only as internal engine fields (margenWeekly/margenDaily);
it is never a visible brand and the hero has no weekly framing.

## MVP philosophy

The app is designed for real people, not perfect users.

Core principles:
- We do not seek perfection; we seek continuity.
- Spending is not the enemy. Not understanding how spending affects your goal is the problem.
- The app should reduce guilt, not create it.
- The user should be able to return after inactivity without feeling financial shame.
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
- "Paguemos los 80$ completos y nos evitamos intereses innecesarios."
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
12. Home Whoop-for-money (Saldo Kipu quipu hero)
13. Contextual celebrations (no gamification contract in MVP)
14. Visual goal/avatar
15. Smart reminders
16. Weekly reconciliation
17. Impossible goal handling
18. Critical debt handling
19. Guilt-free return after inactivity (no timed recovery engine)
20. Pause mode
21. Return mode
22. Light mode
23. Future shared goals foundation
24. Saldo Kipu — accumulating tank + quipu (Bloque D)
25. Capas & Reserva (crossing always warns, never blocks)
26. Universal materialization calendar + AI-generated notifications (Bloque C)
27. Dónde está tu plata / Tesorería — per-account cashflow (Bloque F)
28. Cuotas / installments LatAm (Bloque G)
29. Objetivo mensual de comida y transporte (Bloque H)

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

### Universal capture (Stage 12 — the easiest capture in the world)

Daily information is no longer typing-only. Kipu accepts financial evidence in
every practical format and they all feed ONE financial truth:

- Short natural messages, including SEVERAL movements in one ("gasté 8 en
  McDonald's, 12 en Uber y le transferí 20 a mi hermano").
- Voice notes (Telegram or web) — spoken Spanish becomes a normal message.
- Photos: receipts, bank-notification screenshots, transfer captures, a
  photographed statement, handwritten amounts. No cropping or renaming.
- PDFs: card/bank statements — treated as **reconciliation evidence**, not a
  blind import: Kipu tells the user what it already knew, what's new, and
  updates the card's real obligations (mínimo, pago del mes, saldo, corte,
  fecha de pago). It asks only about what materially affects the truth.
- Forwarded SMS/email text (paste or share), and a personal inbound email
  address (foundation ready; enabled after provider/DNS setup).

The same real-world transaction seen through several sources NEVER duplicates:
evidence strengthens, confirms or corrects the one canonical event. When Kipu
is not sure, it asks ONE short, natural question. Corrections ("era 9.50, no
8", "fue con la Mastercard") modify the existing movement.

Entry points: Telegram (send/forward anything), web chat attach + paste +
drag-drop, mobile camera from the attach button, PWA share target ("share to
Kipu" from any app) and home-screen shortcuts. User-facing language stays
simple — never an accounting interface.

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

**Exception — comida and transporte (Bloque H):** these two are no longer
learned. They carry a monthly OBJECTIVE the user DECIDES, and Kipu never
overwrites it with observed behavior. See "Objetivo mensual" below.

### Variable fixed bills (Bloque K)

Utilities and services such as luz, gas or internet are recurring obligations
whose invoice changes by cycle. Their configured amount is a **declared plan**,
not the latest bill. Kipu stores each real invoice as a native-currency
observation, learns a conservative planning amount from comparable cycles, and
starts a fresh learning regime only when the user explicitly says the plan
changed going forward.

Knowing the invoice amount is not proof it was paid. “La luz vino en 42.000”
learns the observation and moves no cash; “ya la pagué” records the payment,
observation and calendar state atomically. A missing FX rate may block the
payment valuation/Saldo, but never turns 42.000 ARS into USD or prevents
recording the native invoice fact.

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
- Goal account
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

This engine applies to the categories Kipu LEARNS — salidas, compras
personales, suscripciones. It does NOT apply to comida and transporte: those
are decided by the user as a monthly objective (Bloque H) and are never
auto-replaced by observed behavior. Note that supermercado, delivery and café
all fall under comida, and gasolina under transporte — so they are objective
spending, not learned.

Example:
Estimated salidas: 200$
Real registered salidas: 430$

Coach:
"Pensábamos que salidas estaba cerca de 200$, pero tu realidad va más cerca de 430$. No pasa nada. Ahora podemos armar un plan que sí funcione."

The system should:
- Learn spending patterns
- Update estimates over time
- Detect recurring expenses
- Avoid double counting
- Ask for confirmation when a recurring payment appears

## Anti double counting

If user registered gym as $30/month and later says "Pagué $30 del gym", the app should mark the recurring expense as paid, not create a duplicated expense.

If amount changes:
"Tenía registrado el gym en $30, pero hoy pagaste $35. ¿Fue aumento mensual o cargo puntual?"

## Universal materialization calendar (Bloque C)

A nightly cron materializes EVERYTHING expected onto one calendar: income and
fixed expenses (auto or ask by confidence), loans (auto-book), credit cards
(ask at CUTOFF and at PAYMENT — cards are ONE system), family/scheduled
payments (ask), reserves (check-in). Every pending item resolves through chat;
notifications are AI-generated. The calendar clamps days 29–31 to the REAL
last day of the month.

## Objetivo mensual — comida y transporte (Bloque H)

Comida and transporte are the two categories a user cannot simply "learn their
way out of": they are unavoidable, high-frequency, and emotionally loaded. So
Kipu does not estimate them — the user **DECIDES** a monthly objective, and
Kipu measures against that decision instead of quietly rewriting it.

How it feels:

- Every food/transport expense counts against its monthly objective.
- **Inside the objective, spending does NOT drain the Saldo Kipu.** That money
  was already reserved when the ritmo was computed — draining it again would
  charge the user twice for the same dollar.
- **When the objective is crossed, ONLY the excess drains the tank**, day by
  day. Not the whole month retroactively; the drain starts exactly where the
  reserve stops.
- Before the crossing, Kipu gives a pace signal ("a este ritmo lo cruzas el
  N") in home, Gasto, the digest and ambient — a heads-up, never a block.

**Extraordinary spending** (an anniversary, a festejo, a trip dinner) is not
part of the objective: confirmed as extraordinary, it comes straight out of
the Saldo, consumes no objective, and stays out of the month-close comparison.
Kipu may DETECT a possible extraordinary, but it never decides one alone — it
asks, unless the user gave a permanent instruction.

The objective is a DECISION, not a score. The monthly close (days 1–3, user's
timezone) reports what the month taught, and the leftover goes to Reservas by
default; the user keeps, changes, or waits. Kipu never auto-replaces the number
with the user's observed behavior.

Each month is measured against the objective that was in effect THEN: changing
the objective today never rewrites what a past month already lived. A user with
no objective set keeps the legacy learned-budget behavior exactly.

The engine owns the math; the AI only detects candidates and asks.

## Cuotas / installments (Bloque G)

LatAm buying is installment-first, so a cuota is a first-class movement, not a
note. The full debt is born on the card TODAY, and the monthly cuota lowers the
daily recharge as a temporary fixed outflow while the plan runs — so the Saldo
tells the truth about a purchase the user already committed to. The card
statement estimate separates what is due this cycle from what is deferred.

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
- Base currency

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

In product, the protected layer is called **Reserva** (the word "colchón" is
banned from UI). Reserve check-ins materialize through the universal calendar,
and the Reserva defines the calendario-sin-Reserva bound of the Saldo Kipu.

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

## Home (Whoop-for-money)

The home answers at a glance: cuánto tengo para gustos, qué pasa hoy, qué
viene. Two levels:

- **Principal**: Saldo Kipu hero — the vertical quipu of knots — plus "Hoy"
  and "Lo que viene".
- **Secundario**: Reserva / Meta principal / Próximo pago / Tu mes /
  Actividad.

Retired from the product face: Pulso Kipu (0–100 score), Flexibilidad,
Precisión, Realidad, named states (Holgado/Justo/Estirando) and any weekly
hero framing.

**Dashboard and chat must agree.** Agent, chat, ambient topics and the
emergency fallback all cite the SAME saldo the dashboard shows.

Main number: "How much can I spend on gustos without breaking anything?" —
that IS the Saldo Kipu.

## Information architecture & navigation

The app is a real product shell, not one long page. Persistent navigation —
left sidebar on desktop, bottom tab bar on mobile — across four sections, with
detail layers reachable on demand (simple at the top, deep if you want it):

- **Resumen** (home): two levels. Principal: Saldo Kipu hero (quipu) / Hoy /
  Lo que viene. Secundario: Reserva / Meta principal / Próximo pago / Tu mes /
  Actividad. A "Hablar con Kipu" CTA opens chat.
- **Actividad**: the financial activity feed — a wellness timeline grouped by
  day with human labels and Kipu money, never a ledger export.
- **Kipu** (chat): its OWN full conversation space (feed vs DMs), not a box
  inside the dashboard.
- **Metas**: goals as plans — progress, the nudge to add a deadline, a CTA to
  contribute.
- **Detail layers** (drill-down, not tabs): `/app/saldo` — Tus capas + recibo
  de flujo + honest historical curve (saldo_kipu from the daily snapshot,
  migration 048); `/app/cuentas` "Dónde está tu plata" (Bloque F) —
  per-account cashflow on the same universal calendar, per-account operating
  floor (own obligations + 5-day burn buffer), ideal distribution (amounts +
  %), exact moves with "ya lo hice" → chat, physical layers (where Saldo and
  Reserva live), dead pockets (wallet) "por mover", day-to-day attribution
  LEARNED from the ledger with confidence, and TransferAlert (Tesorería,
  recommend-only) derived from the same model; ambient topics transfer_needed
  and payday_distribution; mono-account users see the module stay silent.
  `/app/margen`, `/app/readiness`, `/app/precision` and `/app/reality` are
  redirects.

Principle: the main screen never overwhelms; detail is always one tap away.
Manual/admin entry lives outside the product (dev-only) — the primary input is
natural language through Kipu. Dark-first premium aesthetic (Whoop/Athlytic
feel); broad light-mode theming is a later refinement.

### Stage 9 product quality (historical — superseded by Bloques D/F)

The Margen ring, the six-metric system and the `/app/margen` layers were
replaced by the Saldo Kipu quipu hero and `/app/saldo` + `/app/cuentas`.
Still current: chat as a real DM, direct goal actions, habit loop, native PWA
feel.

- **Margen Kipu ring** (retired): the hero WAS an iconic arc (share of the
  week's air still available) with the weekly number inside — Kipu's "Recovery
  ring". Replaced by the Saldo Kipu quipu; the hero has no weekly framing.
- **Metric system** (retired): six wellness metrics, each with its own accent
  color, icon, and score bar, each tapping into a real detail page. Retired
  from the product face along with Pulso Kipu.
- **Detail layers with real data**: `/app/margen` WAS the ring + 7-day
  spending rhythm + waterfall; today it is a redirect to `/app/saldo`.
  Still current: `/app/debt` (per-card balances, due/cutoff days, pressure
  framing "already reserved in your margin") and activity filters with per-day
  totals. Early users see calm learning states, never fake data.
- **Insights**: one specific, decision-ready coach line derived from live state
  (pace vs daily rhythm, cards due framed as handled, goal-without-date) with a
  CTA to the right layer — never template filler or repeated warnings.
- **Chat = real DM**: optimistic bubbles, typing indicator, no reload, hidden
  tab bar, safe-area composer, "Nueva conversación" for a clean start (old
  fallback-era history is hidden from view, never shown as current Kipu).
- **Direct actions**: set the goal date and contribute to the goal directly in
  the goals page; chat is one path, not the only one.
- **Continuity loop**: useful confirmations and a warm return after a gap;
  no visible streak mechanic is part of the MVP contract.
- **Native feel**: PWA installable (standalone), safe-area aware, dark chrome.

## Onboarding (AI-first seed — Stage 11)

Onboarding is where Kipu earns or loses "la mamá". It is a warm conversation,
never a financial form, and its only job is to plant the **minimum trustworthy
seed** for the first Saldo Kipu:

- **Must be captured (precision matters):** income and WHAT DAY it arrives,
  the big fixed expenses, each card (balance, minimum, payment day), and
  approximate account balances.
- **Estimable (hypotheses Kipu refines):** essential variable spending,
  savings/investment commitments, category budgets. "No sé" is a valid
  answer — Kipu proposes a round number and marks it low-confidence.
  Investment commitments capture their funding source and destination
  asset (C19).
- **Learned later (never asked upfront):** patterns, aliases, fine amounts.

Experience rules: one short question per turn; ~12–15 user turns total; round
numbers welcome; zero jargon; emotional context acknowledged, never ignored;
micro-confirmations instead of long recaps. The conversation survives a
refresh (local draft) and can be restarted safely; nothing is saved until the
user confirms the review.

**The first Saldo Kipu moment:** the review screen computes the user's first
Saldo Kipu (and its Reserva layer) with the real engine, shows why it is
lower than the bank balance, and frames it as a first photo to refine
together. That is the product promise landing before the first save — and
the bridge into the dashboard, where the same saldo (the quipu) is waiting.

### Pulso Kipu (retired)

Pulso Kipu (the 0–100 wellness score, Stage 10) was retired from the product
face along with Flexibilidad, Precisión, Realidad and the named states.
`/app/readiness`, `/app/precision` and `/app/reality` are redirects. Kipu's
signature visual identity today is the Saldo Kipu quipu.

## Roadmap

The living roadmap — the single source of what gets built and in what order —
is **[docs/ROADMAP.md](./ROADMAP.md)**. It is not duplicated here.

The ordering principle: the back end and the features go to 100% first; the
front end comes at the END as its own stage. Nothing visual before that.

Standing product constraints: no monetization yet; no bank connections
(manual capture is by design).

(`docs/ROADMAP_MVP.md` is the ORIGINAL 13-phase plan and is archaeology only —
it is not pending work.)

## Gamification (fuera del MVP)

Gemas, insignias, rachas, *streak freeze* y recompensas internas **no forman
parte del producto MVP ni del Bloque M**. Kipu puede celebrar una acción útil
con copy/animación contextual, pero no convierte la vida financiera en un juego
ni condiciona la continuidad a mantener una racha. Una futura validación de
producto puede reabrir esta decisión; hoy no es trabajo pendiente.

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

## Return after a gap (principio, no motor de gamificación)

Core rule:
Returning should never feel like catching up on emotional debt.

El MVP **no promete** una secuencia automática Day 1/3/5/7. Los recordatorios
existentes respetan preferencias, pausa, quiet hours, cooldown y tope diario;
cuando el usuario vuelve, el agente ofrece una recuperación sin culpa.

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
- Claude Code (primary coding assistant)
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

Flow (production, KIPU_AGENT_MODE=on):
Channel -> Kipu Agent (LLM + live financial memory) -> typed tools (122, incl. plan_reserve_withdrawal) -> Financial Engine -> natural coach reply -> Channel

With `KIPU_AGENT_MODE=on`, the deterministic legacy pipeline never reinterprets
an agent delivery. A failure cannot silently switch the user from an intelligent
financial assistant to a route-based bot.

The model is the sole semantic authority: it understands the objective,
references, selected entities, real ambiguities, relation to prior work,
observable final state and natural reply. Its live plan is intentionally small:
capability + public arguments inside semantic execution units. The server
compiles and verifies mechanics—accounting effects, lifecycle ids, value origin,
manifests, CAS, locks, receipts, arithmetic, dependencies and postconditions.
No exact phrase, transcript regex or list of Spanish tokens may decide what the
user meant or whether a natural answer is acceptable.

Every successful turn must either answer, act or ask one concrete question the
user can actually resolve. Empty replies, internal jargon, loops and generic
“something failed” continuity copy are release failures even if they safely
move no money. A circuit breaker may prevent silence in production, but it is
telemetry for a degraded turn and never counts as normal product behavior.

One semantic execution unit is one promise the user authorizes. If it contains
N steps, PostgreSQL must settle the exact N or none; a shared account or wording
never invents this atomicity. Acceptance tests compare the natural reply and
resulting financial state, not the internal planner JSON. The complete tool
surface always remains visible to the model; Kipu never narrows intelligence
with a lexical intent router.

## Critical rule

The AI never modifies the database directly. The agent calls typed tools;
each tool validates against the real financial state and executes (or asks
for confirmation / more info). Balances, reversals and transfers are computed
by code, never hallucinated.

Structured intent JSON (example below) is the LEGACY-FALLBACK contract only:

Example (fallback intent):
{
  "intent": "credit_card_payment",
  "amount": 80,
  "debt_account": "Visa Pichincha",
  "source_account": "Pichincha",
  "confidence": 0.94
}

## Execution model

We build in microsteps. Do not move to a new step until the previous one is confirmed working.
