# Manual QA Test Scripts — Kipu

Reusable scripts for validating Kipu end-to-end. Each script is
phrased so a human (or an AI agent assisting one) can run it without
re-thinking setup. Inputs are exact strings to send.

Preconditions assumed for every script (unless noted):
- Local dev server running (`npm run dev`).
- A logged-in test user with an empty profile (or reset state).
- `.env.local` correctly configured (see `.env.example`).

Where to verify:
- Web app: `http://localhost:3000/app`
- Onboarding: `http://localhost:3000/onboarding`
- Dev context: `http://localhost:3000/dev/user-financial-context-test`
- Supabase: Table editor in the project dashboard.

Convention: ✅ = expected, ❌ = bug. Note known limitations inline.

---

## Script 1 — Onboarding full happy path

**Preconditions.** Fresh user with `onboarding_completed=false`.
`ONBOARDING_ENGINE_MODE=ai` or `ai_with_mock_fallback`.

**Inputs (in order).**
```
Dale
Nico, Ecu
dolares
Cuenta de ahorro Pichincha, tengo 200 y también tengo una cuenta en el produbanco con 30
Eso es todo
Tengo una tarjeta visa pichincha en la que debo 300 y una tarjeta del banco Pacífico en la que debo 100. Además le debo 20 a mi mamá
Son solo el pago mínimo
El total de la pichincha es 500 y el total de la del Pacífico es 600
Eso es todo
Gano 500 de sueldo y tengo un emprendimiento que gana aproximadamente 100 al mes
Eso es todo
Pago 13,40 de mi plan celular de Movistar, también 30 en mi gimnasio y pago 20 de ChatGPT y de Claude
20 cada uno
Pago Netflix 23.45 al mes
Nada más
Quisiera ahorrar para comprar un carro
10000
Con esa estamos bien
juguetón
```

**Expected.**
- ✅ Profile saved: full_name=Nico, country=Ecuador, base_currency=USD.
- ✅ Accounts: Pichincha 200, Produbanco 30.
- ✅ Debts:
  - Visa Pichincha total 500, mín. 300.
  - Banco Pacífico total 600, mín. 100.
  - Mamá (or Deuda con mamá) total 20.
- ✅ Income: Sueldo 500, Emprendimiento 100 (or with min/max range).
- ✅ Fixed expenses: Movistar 13.40, Gimnasio 30, ChatGPT 20, Claude
  20, Netflix 23.45.
- ✅ Goal: Comprar un carro, target 10000.
- ✅ Coach tone: playful.
- ✅ Lands on `/app` with `onboarding_completed=true`.

**Where to verify.** Supabase `profiles`, `accounts`, `debt_accounts`,
`income_sources`, `fixed_expenses`, `goals`, `coach_preferences`.
Decimals must be present (13.40, 23.45). No goal with target=0. No
duplicate Visa Pichincha rows.

**Known limitations.** If the AI creates a duplicate goal item, the
save filter drops the empty one; verify one row only.

---

## Script 2 — Onboarding edge cases

### 2a. Decimal handling
**Input.** `Pago 13,40 de Movistar`
**Expected.** Fixed expense Movistar = 13.40. Review panel shows
`13.40$`, not `13$` or `1340$`.

### 2b. Shared subscription amount — total
**Input.** `Pago 20 de ChatGPT y de Claude`
**Then.** `20 total`
**Expected.** Either one combined item ("ChatGPT y Claude" = 20) or
two items totaling 20. No false-positive of 20+20.

### 2c. Shared subscription amount — each
**Input.** `Pago 20 de ChatGPT y de Claude`
**Then.** `20 cada uno`
**Expected.** ChatGPT 20 AND Claude 20 as separate rows.

### 2d. Debt total vs minimum (the canonical replay)
**Inputs.**
```
Tengo una visa pichincha en la que debo 300
Son solo el pago mínimo
El total de la pichincha es 500
Eso es todo
```
**Expected.** Single Visa Pichincha row with total 500, mín. 300.
**❌ Bug to watch for.** Two rows (duplicate draftId), OR mín. 300
silently overwritten by total update.

### 2e. Informal debt
**Input.** `Le debo 20 a mi mamá`
**Expected.** One debt row, name "Mamá" or "Deuda con mamá",
type other_debt, totalBalance 20, amountInterpretation total_balance.
No clarifying min/total question.

### 2f. Goal without amount
**Inputs.**
```
Quisiera ahorrar para comprar un carro
Con esa estamos bien
```
**Expected.** Kipu stays in goals, asks for target amount. Does NOT
advance to coach_preferences yet.
**Then.** `10000` → `Con esa estamos bien`
**Expected.** Advances to coach_preferences.

### 2g. Organize-month goal
**Input.** `Quiero ordenar mi mes`
**Then.** `Sí`
**Expected.** Goal saved with archetype `organize_month`, no
targetAmount required. Advances on priority confirmation.

### 2h. Coach tone mapping
**Inputs to try, one at a time.**
- `directo` → tone_preference must save as `coach_like`.
- `relajado` / `claro` → `clear`.
- `juguetón` / `cercano` → `playful`.

**Where to verify.** `coach_preferences.tone` and
`profiles.tone_preference` rows in Supabase.

### 2i. Zero-balance card
**Input.** `Tengo una Visa Pichincha con 600 de deuda. También tengo
Mastercard Pacífico pero no debo nada ahí.`
**Expected.** Visa Pichincha → debt row. Mastercard Pacífico → NOT
created as active debt (or created with totalBalance 0 only if user
explicitly asks to track it). No inflated total debt.

---

## Script 3 — Persisted context validation

**Preconditions.** Script 1 completed for the test user.

**Steps.**
1. Open `/dev/user-financial-context-test`.
2. Inspect the rendered JSON / panels.

**Expected.**
- ✅ Profile block matches Supabase `profiles`.
- ✅ Accounts list matches Supabase `accounts` (names, balances,
  currencies).
- ✅ Debts list matches Supabase `debt_accounts` (totals and
  minimum_payment present).
- ✅ Goals list matches Supabase `goals` (target_amount > 0 for money
  goals, 0 only for organize_month).
- ✅ Income sources, fixed expenses, coach preferences match.
- ✅ Derived signals (flexible spending, debt pressure, goal
  feasibility) render without throwing.

**Where to verify.** Compare side-by-side with Supabase Table Editor.

**Known limitations.** Goal feasibility currently saves as
`challenging` (placeholder) until Phase 5 lands.

---

## Script 4 — App dashboard sanity check

**Preconditions.** Logged in, Script 1 completed.

**Steps.**
1. Open `/app`.
2. Inspect dashboard.

**Expected.**
- ✅ Name shown matches profile.
- ✅ Accounts list visible with correct balances.
- ✅ Debts list visible with correct balances.
- ✅ Main goal visible with target amount.
- ✅ Recent movements list renders (may be empty for a fresh user).
- ✅ Chat input present.

**❌ Bugs to watch for.**
- Empty dashboard for a freshly onboarded user.
- Wrong base currency in the totals.
- Cents truncated for amounts that have them.

---

## Script 5 — Telegram expense

**Preconditions.**
- `TELEGRAM_BOT_TOKEN` set.
- Linked user in `telegram_user_links` (`/dev/telegram-link-test`).
- Local tunnel set up or production deploy used.
- `TRANSACTION_PARSER_MODE=basic` for the deterministic baseline.

**Input (send to the bot).** `gasté 8 en café con la cuenta de
pichincha`

**Expected.**
- ✅ Webhook returns 200.
- ✅ One row inserted in `transactions` with type `expense`,
  amount 8, source = Pichincha account.
- ✅ Pichincha balance decreases by 8.
- ✅ Telegram reply is a coach response acknowledging the expense.

**Where to verify.** Supabase `transactions`, `accounts.current
_balance_base`. Telegram thread.

**Known limitations.** With `TRANSACTION_PARSER_MODE=basic`, ambiguous
phrases fall back to clarification; do not rely on AI-only nuance.

---

## Script 6 — Telegram income

**Input.** `me llegó el sueldo, 500 a Pichincha`
**Expected.**
- ✅ Transaction row type `income`, amount 500, destination = Pichincha.
- ✅ Pichincha balance increases by 500.
- ✅ Coach reply acknowledges and references the goal if relevant.

---

## Script 7 — Telegram goal contribution

**Input.** `aporté 50 a la meta del carro desde Pichincha`
**Expected.**
- ✅ Transaction row type `goal_contribution`, amount 50.
- ✅ Pichincha balance −50.
- ✅ Goal `current_amount` +50.
- ✅ Coach reply celebrates the progress without overdoing it.

---

## Script 8 — Telegram debt payment

**Input.** `pagué 80 a la visa pichincha desde Pichincha`
**Expected.**
- ✅ Transaction row type `debt_payment`.
- ✅ Pichincha balance −80.
- ✅ Visa Pichincha debt balance −80 (no duplicate expense row).
- ✅ Coach reply acknowledges the payment.

**❌ Bug to watch for.** Double counting (an expense row AND a
debt-decrease). Credit-card payments must move debt down, NOT create
an expense.

---

## Script 9 — Unsupported / clarification case

**Inputs to try.**
- `hola kipu` → coach should respond conversationally but not invent
  a transaction.
- `qué fecha es hoy` → unsupported; respond gracefully.
- `transferí algo` → needs clarification; ask amount + source + dest.

**Expected.**
- ✅ No spurious transaction rows.
- ✅ Reply is helpful and on-brand.

---

## Script 9b — Telegram daily logging robustness

**Preconditions.** Linked Telegram user. Logged in test profile has at
least these resources: Pichincha account, Produbanco account, an
"efectivo" account, Visa Pichincha debt, and one goal (e.g. "Boda" or
"Brasil"). `TRANSACTION_PARSER_MODE=basic` for the deterministic
baseline.

The handler now runs a pre-parse prefilter (see
`src/lib/ai/transaction-prefilter.ts`). It catches a handful of message
shapes that the basic parser would otherwise silently mishandle, and
returns a single tailored clarification before touching the DB.

### 9b.1 — Account-paid expense (happy path)
**Input.** `café 3 pichincha`
**Expected reply.** Starts with `Listo: USD 3.00 en comida desde
Pichincha.` — short, ends with a weekly-flex hint if a main goal is
configured.
**Verify.** `transactions` row type `expense`, source = Pichincha,
amount 3. Pichincha balance decreased by 3.

### 9b.2 — Card-paid expense
**Input.** `almuerzo 8 visa`
**Expected reply.** `Listo: USD 8.00 en comida con Visa Pichincha. No
bajó tu efectivo hoy; sí subió tu deuda.`
**Verify.** Expense row with `debt_account_id` set, source_account_id
null. Visa Pichincha balance increased by 8. No account balance moved.

### 9b.3 — Income
**Input.** `me pagaron 100 en produbanco`
**Expected reply.** `Entró: USD 100.00 a Produbanco. Tu margen subió.`
**Verify.** Income row, Produbanco balance +100.

### 9b.4 — Goal contribution
**Input.** `mandé 20 a boda`
**Expected reply.** `Sumaste USD 20.00 a tu meta de Boda desde
Pichincha. Vas un poco más cerca.` (source account is the user's
primary; goal name is the captured goal name.)
**Verify.** `goal_contribution` row, goal `current_amount` +20, source
account balance −20.

### 9b.5 — Debt payment
**Input.** `pagué 35 de visa pichincha desde pichincha`
**Expected reply.** `Buena movida: pagaste USD 35.00 a Visa Pichincha
desde Pichincha. Bajó tu cuenta y bajó tu deuda. Eso es progreso
real.`
**Verify.** `debt_payment` row. Pichincha −35. Visa Pichincha
debt −35. No expense row created (anti-double-counting).

### 9b.6 — Vague payment (PREFILTER: vague_payment)
**Input.** `pagué 20`
**Expected reply.** `¿Pagaste una deuda/tarjeta o fue un gasto?` …
example phrasings included.
**Verify.** No DB write. No "pagaste 20 a tu tarjeta" hallucination.

### 9b.7 — Transfer (PREFILTER: transfer_unsupported)
**Input.** `transferí 30`
**Expected reply.** `Las transferencias entre tus propias cuentas
todavía no las manejo bien aquí.` … with the alternatives for
debt-payment / goal-contribution phrasing.
**Verify.** No DB write.

### 9b.8 — Multi-transaction (PREFILTER: multi_transaction)
**Input.** `me gasté 12 en uber y 8 en almuerzo`
**Expected reply.** `Te entendí dos movimientos en un mismo mensaje.
Para no descuadrar tus saldos, mándamelos por separado.` … with
example split.
**Verify.** No DB write. After sending the two follow-up messages
separately (`uber 12 efectivo`, `almuerzo 8 pichincha`), both should
land correctly.

### 9b.9 — Refund (PREFILTER: refund_unsupported)
**Input.** `me devolvieron 10`
**Expected reply.** `Aún no registro devoluciones con seguridad desde
aquí.` … with alternatives for income vs. web adjustment.
**Verify.** No DB write.

### 9b.10 — Cancel subscription (PREFILTER: cancel_subscription_unsupported)
**Input.** `cancelé netflix`
**Expected reply.** `Cancelar una suscripción no mueve tus saldos
hoy.` … points the user to the web to update fixed expenses.
**Verify.** No DB write.

### 9b.11 — Vague purchase (PREFILTER: vague_purchase)
**Input.** `compré algo de 20`
**Expected reply.** `¿Con qué pagaste?` … with examples.
**Verify.** No DB write.

### 9b.12 — Invited / no money (PREFILTER: invited_no_money)
**Input.** `me invitaron el almuerzo`
**Expected reply.** `Si te invitaron y no gastaste, no hay que
registrar nada.` … offers to log the saved amount if the user wants.
**Verify.** No DB write.

### 9b.13 — Decimal preservation
**Input.** `cafe 3,40 pichincha`
**Expected reply.** Amount shown as `USD 3.40` (not 3 and not 340).
**Verify.** `transactions.original_amount = 3.40`. Pichincha balance
moved by 3.40.

### 9b.14 — Thousand-separator must NOT trigger multi-transaction
**Input.** `tengo 1.200 en pichincha`
**Expected behavior.** Parser receives the message (no prefilter
match). May land as expense / clarification depending on parser logic
— the key check is that the prefilter does NOT flag it as multi-
transaction.

**Where to verify.** Reply text + `transactions` (or absence of new
rows for prefilter-blocked cases) + balances unchanged for unsupported
shapes.

**Known limitations.**
- Goal contribution source-account inference depends on the user's
  primary account; if not configured, the parser may ask for
  clarification instead.
- Weekly flexible-spending number appended to success replies uses
  placeholder monthly-income/savings-capacity values in the current
  dashboard build (see TODO in `apply-chat-transaction-intent.ts`).

---

## Script 10 — AI parser mode validation

**Preconditions.** Set `TRANSACTION_PARSER_MODE=ai_with_basic_fallback`
locally.

**Steps.**
1. Restart dev server (env var pickup).
2. Send a borderline expense from the in-app chat or Telegram:
   `me gasté unos 25 en cosas del super`
3. Inspect server logs for parser source and confidence.

**Expected.**
- ✅ AI parser returns intent with confidence ≥ 0.75 → AI result is
  applied.
- ✅ Below threshold → basic parser fallback runs.
- ✅ Transaction row records `source` reflecting which parser ran.

**❌ Bugs to watch for.** AI parser inventing a category or source
that doesn't exist in the user's accounts.

---

## Script 11 — AI coach response validation

**Preconditions.** `COACH_RESPONSE_MODE=ai`, `OPENAI_COACH_MODEL` set.

**Steps.**
1. Trigger any successful transaction (Script 5–8).
2. Inspect the response text + webhook JSON debug metadata.

**Expected.**
- ✅ Coach reply is Spanish, on-brand, references the actual numbers.
- ✅ Confidence ≥ 0.75; otherwise fallback was used.
- ✅ No mention of "FinCoach", "Soy Kipu", or "Kipu X".

---

## Script 12 — Onboarding goals closure phrase coverage

**Preconditions.** A goal with `targetAmount` already captured.

**Inputs to try, one at a time (reset session each time).**
- `con esa estamos bien`
- `con esa está bien`
- `con esa me quedo`
- `con esa quiero empezar`
- `con esa basta`
- `con esa es suficiente`
- `esa está bien`
- `esa meta está bien`
- `eso es todo`
- `sí`

**Expected.** Every one of the above advances from goals →
coach_preferences without a loop. Kipu does NOT ask "¿hay algo más
que te gustaría lograr…?" after these.

---

## Script 13 — Future: Weekly review (placeholder)

**Status.** Phase 8. Not implemented.

**Future inputs.** Sunday-night trigger or manual
`/dev/weekly-review-test`.

**Future expected.** A coherent Spanish summary of the week with
income, expenses, fixed-expense hits, goal progress, debt change, and
a one-tap reconcile path.

---

## Script 14 — Future: Recovery flow (placeholder)

**Status.** Phase 9. Not implemented.

**Future inputs.** Simulate inactivity (no transactions for 7 days)
and trigger the recovery cron.

**Future expected.** Telegram message in Kipu's voice ("oye, ¿día
austero o nos tomamos pausa?") with `pausa` / `seguir` options. No
guilt language.

---

## Script 13 — Goal planning engine scenarios

Preconditions: `/app` loaded, user has completed onboarding.
These cover `buildGoalPlan` logic via the live dashboard goal card.

### 13.1 No goal
DB state: user has no goal rows.
Expected: `/app` redirects to `/onboarding` (existing guard).

### 13.2 Goal without target amount (target_amount = 0)
DB state: goal row with `target_amount = 0`.
Expected: goal card shows status "Falta monto". Message includes "necesita un monto objetivo". No weekly/monthly contribution rows shown.

### 13.3 Goal without target date (target_date = null or empty)
DB state: goal row with `target_amount > 0`, `target_date = null`.
Expected: status "Falta fecha". Message includes "Falta una fecha". No contribution rows shown.

### 13.4 Goal achieved (current_amount >= target_amount)
DB state: goal row with `current_amount >= target_amount`.
Expected: status "Meta cumplida". Message includes "cumplida". Progress = 100%.
No suppressed-contribution warning shown.

### 13.5 Goal on track
DB state: goal has target_date in future, income high enough that required contribution / monthly_capacity <= 0.85.
Expected: status "Vas bien". Message includes "vas bien" or "necesitas cerca de". Weekly and monthly contribution rows shown.

### 13.6 Goal tight
DB state: goal has target_date in future, required contribution is 90–105% of monthly capacity.
Expected: status "Ajustada". Message includes "justo" or "ajustado". Contribution rows shown.

### 13.7 Goal at risk
DB state: required monthly contribution is 110–175% of monthly capacity.
Expected: status "En riesgo". Message includes "en riesgo". Contribution rows shown (not suppressed).

### 13.8 Goal not realistic
DB state: required monthly contribution > 175% of monthly capacity.
Expected: status "No realista por ahora". Message never says "imposible" or "cancelada".
Contribution rows shown so user can see the gap.

### 13.9 Goal blocked by negative margin or high/critical debt pressure
DB state: user has high/critical debt pressure OR flexible_spending <= 0.
Expected: status "Primero estabilicemos". Message includes "protegida" or "cubramos compromisos".
Weekly/monthly contribution rows NOT shown.

### 13.10 Goal contribution via Telegram updates progress
Steps:
1. Note `current_amount` in DB.
2. Send Telegram message: "mandé 20 a [goal name]".
3. Reload `/app`.
Expected: `current_amount` increased by 20. Progress bar updates. Goal plan recalculates.
`/dev/user-financial-context-test` shows updated `goalPlan` object.

---

## Script 14 — Anti-double-counting: fixed expense matching via Telegram

Preconditions: user has at least one active fixed expense (e.g. "Netflix 13 USD"). Telegram linked and functional.

### 14.1 Confident match — exact amount
Message: `pagué netflix 13`
Expected:
- Matcher returns `confident_match`.
- Transaction inserted as `expense`, `type = expense`, `recurring_expense_id` set to the Netflix fixed_expense id.
- Reply: `Listo: Netflix (USD 13.00) desde [account]. Lo ligué a tu gasto fijo mensual; no es gasto extra.`
- No double-count warning. No coach AI call.

### 14.2 Confident match — rounding tolerance (8 vs 7.99)
Message: `pagué netflix 8`  (fixed expense = 7.99 USD)
Expected: same as 14.1. amountsMatch passes (absDiff = 0.01 ≤ 0.50).

### 14.3 Confident match — account resolution
Message: `pagué netflix 13 desde pichincha`
Expected: `resolvedAccount` = account named "Pichincha". Reply includes `desde Pichincha`.

### 14.4 Amount mismatch — ask before recording
Message: `pagué netflix 20`  (fixed expense = 13 USD)
Expected:
- Matcher returns `amount_mismatch`.
- No transaction inserted.
- Reply asks: `¿Fue aumento mensual o un cargo extra puntual?`
- User must resend before anything is recorded.

### 14.5a Ambiguous — distinct names both match
Setup: user has "Netflix" (13 USD) and "Netflix 4K" (20 USD).
Message: `pagué netflix 15`
Expected:
- Matcher returns `ambiguous`.
- No transaction inserted.
- Reply: `Esto puede ser un gasto fijo. ¿Te refieres a Netflix o a Netflix 4K?`

### 14.5b Ambiguous — duplicate rows, same name and amount
Setup: user has two "Internet" rows, both USD 20 (accidental duplicate during onboarding).
Message: `internet 20 pichincha`
Expected:
- Matcher returns `ambiguous`.
- No transaction inserted.
- Reply: `Esto parece el Internet de USD 20.00 que ya tengo como gasto fijo. ¿Lo registro como ese pago o fue otro cargo aparte?`

### 14.5c Ambiguous — duplicate name, different stored amounts
Setup: user has "Gimnasio" USD 15 and "Gimnasio" USD 25 (two plans).
Message: `pagué gimnasio 15`
Expected:
- Matcher returns `ambiguous`.
- No transaction inserted.
- Reply: `Tengo Gimnasio como gasto fijo, pero el monto no me cuadra. ¿Fue el pago normal o un cargo aparte?`

### 14.6 No match — falls through to normal parser
Message: `almuerzo 12 pichincha`  (no fixed expense with that name)
Expected:
- Matcher returns `no_match`.
- Normal parser runs. Transaction registered as expense. Normal coach reply.

### 14.7 No match — message has no amount
Message: `pagué netflix`
Expected:
- Matcher returns `no_match` (extractFirstAmount = null).
- Falls through to parser, which asks for clarification.

### 14.8 Distinctive token match
Fixed expense: `Plan celular Movistar` (25 USD).
Message: `pagué movistar 25`
Expected:
- Distinctive token "movistar" matches. `confident_match`.
- Transaction inserted with `recurring_expense_id`.
- Reply: `Listo: Plan celular Movistar (USD 25.00)…`

### 14.9 No duplicate when match is no_match and debt payment phrasing
Message: `pagué tarjeta 100 pichincha`
Expected:
- Matcher returns `no_match` (no fixed expense named "tarjeta").
- Parser runs normally → `debt_payment` intent. Correct DB write. No fixed expense link.

### 14.10 Amount stored is actual amount sent, not stored fixed amount
Fixed expense: `Spotify` stored at 9.99 USD. User sends matching 9.99 USD.
Expected: transaction `original_amount = 9.99`, not some rounded value.
`recurring_expense_id` links to Spotify fixed expense row.

---

## Cross-script regression checklist

After any change to onboarding, parser, save flow, or coach:
- [ ] Script 1 (happy path) green.
- [ ] Script 2d (debt total vs minimum) green.
- [ ] Script 2f (goal without amount) green.
- [ ] Script 2h (tone mapping including directo→coach_like) green.
- [ ] Script 3 (context builder) green.
- [ ] Script 5 (Telegram expense, baseline) green.
- [ ] Script 9b.1–9b.5 (Telegram supported happy paths) green.
- [ ] Script 9b.6–9b.12 (Telegram prefilter clarifications, no DB
      writes) green.
- [ ] Script 9b.13 (decimal preservation in chat) green.
- [ ] Script 12 (goals closure phrase coverage) green.
- [ ] Script 13.5–13.9 (goal planning statuses) green.
- [ ] Script 13.10 (goal contribution updates progress) green.
- [ ] Script 14.1–14.3 (confident match, reply copy, account resolution) green.
- [ ] Script 14.4 (amount mismatch — no DB write) green.
- [ ] Script 14.6 (no_match falls through to parser) green.
- [ ] Script 14.9 (debt payment not intercepted by matcher) green.

If any of those break, do not commit; report and triage first.
