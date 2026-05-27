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
- Reply asks: `Veo que Netflix normalmente está en USD 13.00, pero
  esta vez pusiste USD 20.00. ¿Lo registro como el pago normal o
  como un cargo aparte?`
- The user resolves it in context by replying `fue el cargo normal`
  or `fue otro cargo aparte` — pending clarification state carries
  the rest of the data (see Script 19).

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
- Matcher returns `ambiguous` with a candidate (matches[0]) so the
  handler can persist a pending clarification.
- No transaction inserted.
- Reply: `Veo que Internet normalmente está en USD 20.00. ¿Lo
  registro como el pago normal o como un cargo aparte?`

### 14.5c Ambiguous — duplicate name, different stored amounts
Setup: user has "Gimnasio" USD 15 and "Gimnasio" USD 25 (two plans).
Message: `pagué gimnasio 20`
Expected:
- Matcher returns `ambiguous` with `matches[0]` as the reference
  candidate (USD 15 in this example).
- No transaction inserted.
- Reply: `Veo que Gimnasio normalmente está en USD 15.00, pero esta
  vez pusiste USD 20.00. ¿Lo registro como el pago normal o como un
  cargo aparte?`

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

## Script 15 — Goal-aware Telegram chat responses

Preconditions:
- Telegram linked, basic parser mode (`TRANSACTION_PARSER_MODE=basic`),
  fallback coach (`COACH_RESPONSE_MODE=fallback`).
- Test user has at least one main goal (e.g. "Boda" 1000 USD).
- Database in a known state for each subcase (adjust target_date,
  income, debt balances to land on the desired goalPlan status).

The reply suffix should change based on the user's current
`goalPlan.status` (computed via `buildUserFinancialContext` after the
transaction is applied). When the goal data is incomplete or the case
doesn't call for goal commentary, the reply should still read clean.

### 15.1 Goal contribution — missing deadline
DB state: main goal has `target_amount > 0`, `target_date = null`.
Message: `mandé 20 a boda desde pichincha`
Expected reply ends with:
`Buen avance. Cuando pongamos fecha, Kipu puede decirte cuánto necesitas por semana.`
(Replaces the generic "Vas un poco más cerca.")

### 15.2 Goal contribution — on track
DB state: deadline in future and required monthly contribution ≤ 85%
of estimated monthly capacity.
Message: `mandé 20 a boda desde pichincha`
Expected reply contains: `Vas bien: este aporte mantiene la meta encaminada.`

### 15.3 Goal contribution — tight
DB state: required contribution 86–105% of capacity.
Message: `mandé 20 a boda desde pichincha`
Expected reply contains:
`Bien hecho; esta meta está ajustada, así que cada aporte cuenta.`

### 15.4 Goal contribution — at risk / not realistic
DB state: required contribution 106–175% (at_risk) or >175%
(not_realistic) of capacity.
Message: `mandé 20 a boda desde pichincha`
Expected reply contains:
`Ayuda, pero con la fecha actual todavía necesitamos ajustar el plan.`

### 15.5 Goal contribution — blocked by debt or negative margin
DB state: debt pressure high/critical OR flexible spending ≤ 0.
Message: `mandé 20 a boda desde pichincha`
Expected reply contains:
`Queda registrado, pero por ahora no forcemos más aportes hasta cubrir compromisos.`
**❌ Bug to watch for.** Kipu should NOT push the user to add more to
the goal in this state.

### 15.6 Expense while goal is blocked
DB state: goalPlan blocked_by_debt_or_margin (e.g. flexible ≤ 0).
Message: `café 3 pichincha`
Expected reply contains:
`Boda sigue protegida; esta semana cuidemos el margen.`

### 15.7 Card expense while goal at risk / blocked
DB state: goalPlan status `at_risk`, `not_realistic`, or
`blocked_by_debt_or_margin`.
Message: `almuerzo 8 visa`
Expected reply contains the standard card phrase
(`No bajó tu efectivo hoy; sí subió tu deuda.`) followed by:
`Antes de meter más a Boda, cuidemos esta tarjeta.`

### 15.8 Income while goal blocked
DB state: goalPlan blocked_by_debt_or_margin.
Message: `me pagaron 100 en pichincha`
Expected reply contains:
`Primero cubramos compromisos; después vemos Boda.`
**Should NOT** suggest separating money for the goal in this state.

### 15.9 Income while goal healthy
DB state: goalPlan `on_track` or `tight`.
Message: `me pagaron 100 en pichincha`
Expected reply contains:
`Si esta plata no tiene dueño todavía, podemos separar algo para Boda.`

### 15.10 Debt payment while goal blocked
DB state: goalPlan blocked_by_debt_or_margin.
Message: `pagué 35 de visa pichincha desde pichincha`
Expected reply ends with the existing debt phrase plus:
`Esto también protege Boda, aunque no sea un aporte directo.`

### 15.11 Fixed expense — no extra spending framing
DB state: user has a fixed expense `Internet 20 USD`.
Message: `internet 20 pichincha`
Expected reply: `Listo: Internet (USD 20.00) desde Pichincha. Lo ligué a tu gasto fijo mensual; no es gasto extra.`
No goal commentary appended (fixed expenses intentionally avoid goal
push). Transaction must link to the fixed expense row.

### 15.12 No main goal — no awkward goal mention
DB state: user has no rows in `goals`.
Message: `café 3 pichincha`
Expected reply: standard expense confirmation with no goal-name
sentence appended. Snapshot text may also be absent (no main goal →
no dashboard → no snapshot). The reply must NOT say "tu meta", "Boda",
etc.

### 15.13 Cross-channel parity (web app chat)
Repeat 15.1–15.10 from the in-app chat input at `/app`. Replies should
match Telegram replies for the same DB state (same fallback path).

**Where to verify.** Reply text in Telegram thread or `/app`. The
`coachResponseSource` in the webhook response should be `fallback`
unless `COACH_RESPONSE_MODE=ai` is set (in which case the AI may pick
its own phrasing — fallback still acts as the safety net).

**Known limitations.**
- These cases require shaping the user's data to hit each goalPlan
  status; consider seeding via the dev pages or Supabase Table Editor.
- AI coach mode may rewrite phrasing; the determinism is in the
  fallback path.

---

## Script 16 — Goal-name mismatch guard

Preconditions:
- Telegram linked (or `/app` chat), `TRANSACTION_PARSER_MODE=basic`.
- User has a single main goal "Viaje a Brasil" and at least one
  non-goal account (e.g. Pichincha).

### 16.1 Mismatched explicit goal name → needs_clarification
Message: `mandé 20 a boda desde pichincha`
Expected reply: `Tengo "Viaje a Brasil" como tu meta principal, pero
escribiste "boda". Para no moverlo mal, confirma si va a Viaje a
Brasil.`
**Verify.** No `transactions` row inserted. Pichincha balance
unchanged. Goal `current_amount` unchanged.

### 16.2 Exact goal name match → success
Message: `mandé 20 a viaje a brasil desde pichincha`
Expected reply: standard goal contribution success (e.g. `Sumaste USD
20.00 a tu meta de Viaje a Brasil desde Pichincha. …`).
**Verify.** Transaction inserted, goal `current_amount` +20.

### 16.3 Distinctive token match → success
Message: `mandé 20 a brasil desde pichincha`
Expected reply: standard goal contribution success referencing Viaje
a Brasil.
**Verify.** Same as 16.2.

### 16.4 Generic "mi meta" → uses main goal
Message: `mandé 20 a mi meta desde pichincha`
Expected reply: standard goal contribution success referencing the
main goal.
**Verify.** Same as 16.2.

### 16.5 No explicit target → uses main goal
Message: `aporté 20 desde pichincha`
Expected reply: standard goal contribution success referencing the
main goal.
**Verify.** Same as 16.2.

### 16.6 Mismatched goal name + no source → still needs_clarification
Message: `mandé 20 a boda`
Expected reply: goal-name conflict copy from 16.1 (the mismatch check
fires before the source-account clarification).
**Verify.** No DB write.

### 16.7 Non-goal flows untouched
- Message: `café 3 pichincha` → expense success.
- Message: `me pagaron 100 en pichincha` → income success.
- Message: `pagué 35 de visa pichincha desde pichincha` → debt payment
  success.
None of these should be affected by the goal-name guard.

**Where to verify.** Reply text + `transactions` rows + account /
goal balances.

**Known limitations.**
- Token matching is conservative (≥ 3 chars). Very short goal names
  ("Tv") will not be matched by partial tokens.
- This guard only runs in the basic parser. AI parser results are
  still subject to AI confidence checks.

---

## Script 17 — Mode-agnostic goal guard + fixed-expense overrides

Preconditions:
- Telegram linked (or `/app` chat).
- User has main goal `Viaje a Brasil` and at least one fixed expense
  `Internet` USD 20. Pichincha account exists.
- Repeat the whole script with each combination:
  - `TRANSACTION_PARSER_MODE=basic`
  - `TRANSACTION_PARSER_MODE=ai_with_basic_fallback`
  - `TRANSACTION_PARSER_MODE=ai`

### 17.1 Mode-agnostic mismatched goal name → needs_clarification
Message: `mandé 20 a boda desde pichincha`
Expected reply (every parser mode):
`Tengo "Viaje a Brasil" como tu meta principal, pero escribiste "boda".
Para no moverlo mal, confirma si va a Viaje a Brasil.`
**Verify.** No `transactions` row inserted, Pichincha unchanged, goal
`current_amount` unchanged. The guard runs in `chat-transaction-handler`
after the parser, so AI parser results cannot bypass it.

### 17.2 Mismatch when AI picks a different goal than the user wrote
Setup: user has two goals — `Viaje a Brasil` (main) and `Boda`. The AI
parser picks goal_contribution → `Viaje a Brasil` even though the user
wrote `boda`.
Message: `mandé 20 a boda desde pichincha`
Expected reply:
`Escribiste "Boda", pero iba a registrarlo en "Viaje a Brasil". Para no
moverlo mal, confirma si va a Boda.`
**Verify.** No DB write.

### 17.3 Matching name → success (all modes)
Message: `mandé 20 a viaje a brasil desde pichincha`
Expected: standard goal contribution success. Goal `current_amount`
+20.

### 17.4 Generic reference → uses main goal (all modes)
Message: `mandé 20 a mi meta desde pichincha`
Expected: standard goal contribution success on main goal.

### 17.5 Fixed-expense amount mismatch — initial prompt
Setup: fixed expense `Internet` USD 20 active.
Message: `internet 25 pichincha`
Expected reply:
`Veo que Internet normalmente está en USD 20.00, pero esta vez
pusiste USD 25.00. ¿Lo registro como el pago normal o como un cargo
aparte?`
**Verify.** No DB write. A pending clarification is opened (Script
19) so a natural follow-up like `fue el cargo normal` resolves it.

### 17.6 Fixed-expense follow-up — "como gasto fijo" override
Follow-up message: `internet 25 como gasto fijo desde pichincha`
Expected:
- Matcher recognizes the override → returns `confident_match` despite
  the amount differing from the stored 20.00.
- Transaction inserted with `type = expense`, `recurring_expense_id`
  set to the Internet fixed expense, `original_amount = 25`.
- Pichincha balance −25.
- Reply: `Listo: Internet (USD 25.00) desde Pichincha. Lo ligué a tu
  gasto fijo mensual; no es gasto extra.`

### 17.7 Fixed-expense follow-up — "aparte" override
Follow-up message: `internet 25 aparte desde pichincha`
Expected:
- Matcher detects `aparte` → returns `no_match`.
- Normal parser runs → `expense` intent.
- Transaction inserted as a plain expense from Pichincha (`amount = 25`),
  NOT linked to a fixed expense row.
- Reply: standard expense confirmation (no "ligué a tu gasto fijo"
  phrasing).

### 17.8 Natural follow-ups currently NOT supported
The product target is for Kipu to understand human follow-ups like
`Fue el cargo normal`. The current build does not persist pending
clarification state across Telegram messages, so a bare `Fue el cargo
normal` reply still falls through to the generic parser clarification
("Casi lo tengo, pero me falta un dato…"). Two stable options:
- Type one of the suggested commands in 17.5 verbatim.
- Wait for the pending-clarification table (see "Risks / follow-ups"
  in the implementation notes).

### 17.9 Non-goal flows untouched (regression)
- `me pagaron 100 en pichincha` → income success.
- `café 3 pichincha` → expense success.
- `pagué 35 de visa pichincha desde pichincha` → debt payment success.

**Where to verify.** Reply text + `transactions` rows + account / goal
balances. The guard is in `chat-transaction-handler`; the matcher
overrides are in `fixed-expense-matcher`.

**Known limitations.**
- No persistent pending-clarification state. Natural follow-ups like
  "Fue el cargo normal" cannot be tied back to the prior question
  without a new table.
- The `como gasto fijo` override applies the amount the user typed,
  even when it differs from the stored fixed amount. It does NOT
  update the fixed_expense row itself (that's still a web action).
- AI parser still owns the routing decision in `ai` and
  `ai_with_basic_fallback` modes; the goal-name guard is the safety
  net, not a replacement.

---

## Script 18 — AI-mode safety guards (pre-parser goal + payment source)

Preconditions:
- Telegram linked (or `/app` chat).
- Test user has:
  - main goal `Viaje a Brasil`
  - account `Pichincha`
  - debt account `Visa Pichincha`
  - fixed expense `Internet` USD 20
- **Run each case with `TRANSACTION_PARSER_MODE=ai_with_basic_fallback`
  (the production target).** Then repeat the goal/source cases with
  `TRANSACTION_PARSER_MODE=ai` and `TRANSACTION_PARSER_MODE=basic`;
  the deterministic guards in `chat-transaction-handler` must hold in
  every mode.

These guards are deterministic and run independent of the parser:
  • **Pre-parser goal target guard** runs before `parseTransaction`. It
    fires when the message clearly looks like a goal contribution
    (amount + contribution verb + explicit target after `a`/`para`)
    and the target does not match any user goal. Catches AI parser
    outcomes that would otherwise return `unsupported` or pick a
    different intent type.
  • **Post-parser payment source guard** runs after the parser
    returns a ready `expense` / `debt_payment` intent. If the user
    explicitly named a single safe source in the raw text and the
    parser picked a different one, the guard deterministically
    corrects the intent before the DB write (no clarification round-
    trip). It only falls back to clarification when the user's
    phrasing is truly ambiguous (e.g. debt signal + account name with
    no matching debt account).

### 18.1 Goal mismatch — pre-parser block (all modes)
Message: `mandé 20 a boda desde pichincha`
Expected reply (`basic`, `ai_with_basic_fallback`, and `ai`):
`Tengo "Viaje a Brasil" como tu meta principal, pero escribiste
"boda". Para no moverlo mal, confirma si va a Viaje a Brasil.`
**Verify.** No `transactions` insert; Pichincha and goal balances
unchanged. In `ai`/`ai_with_basic_fallback`, the pre-parser guard
returns before any AI call.

### 18.2 Goal match — full name (all modes)
Message: `mandé 20 a viaje a brasil desde pichincha`
Expected: standard goal contribution success on Viaje a Brasil.

### 18.3 Goal match — distinctive token (all modes)
Message: `mandé 20 a brasil desde pichincha`
Expected: standard goal contribution success.

### 18.4 Generic goal reference — uses main goal (all modes)
Message: `mandé 20 a mi meta desde pichincha`
Expected: standard goal contribution success on main goal.

### 18.5 Payment source guard — account vs card conflict (AI mode)
Message: `café 3 pichincha`
Expected: expense from Pichincha account (3). The user named the
Pichincha account explicitly and did not use any debt signal
(`visa`/`tarjeta`/`credito`), so the guard auto-corrects an AI-picked
Visa Pichincha intent to the Pichincha account before the DB write.
The basic parser already lands on Pichincha; the AI parser would
otherwise pick Visa Pichincha via the shared token.
**Verify.** `transactions` row `expense`, `source_account_id` =
Pichincha, `debt_account_id` null, amount 3. Pichincha balance −3.
Visa Pichincha balance unchanged.

### 18.6 Card-paid expense — debt signal honored
Message: `almuerzo 8 visa`
Expected: card expense on Visa Pichincha. No guard fires (the user
used the debt signal "visa").

### 18.7 Card-paid expense — both named with signal
Message: `zapatos 40 visa pichincha`
Expected: card expense on Visa Pichincha. Both the account and the
debt name match, but the debt signal `visa` is present → expected
source = debt → guard does not fire on a debt intent.

### 18.8 Expense with no explicit source
Message: `café 3`
Expected: parser default (user's saved default source via preferences,
or basic-parser fallback). The source guard does not fire (`kind:
"none"`).

### 18.9 Debt payment unchanged
Message: `pagué 35 de visa pichincha desde pichincha`
Expected: debt payment success — Pichincha −35, Visa Pichincha −35.
No expense duplicate. Source guard sees the debt signal + named debt
account → no clarification.

### 18.10 Fixed expense (linked) unchanged
Message: `internet 25 como gasto fijo desde pichincha`
Expected: fixed-expense matcher returns `confident_match` and short-
circuits before the parser; transaction inserted with
`recurring_expense_id`, amount 25, Pichincha −25.

### 18.11 Fixed expense (aparte) unchanged
Message: `internet 25 aparte desde pichincha`
Expected: matcher returns `no_match` (separate confirmation), parser
runs, source guard sees account-only and no conflict → normal expense
from Pichincha for 25, NOT linked to a fixed expense row.

### 18.12 Income unchanged
Message: `me pagaron 100 en pichincha`
Expected: income success on Pichincha. Pre-parser goal guard does not
fire (no contribution verb). Source guard does not fire for income
intents.

**Where to verify.** Reply text + `transactions` rows + account /
goal balances + the `coachResponseSource` and `parserSource` fields
in the webhook JSON (`parserSource` should reflect AI vs basic).

**Known limitations.**
- The payment-source guard auto-corrects expense intents when the
  user's phrasing uniquely identifies one safe source (account-only
  or debt-only). Truly ambiguous cases (e.g. debt signal + account
  name with no matching debt account in the user's data) still fall
  back to a clarification.
- For `debt_payment`, the guard only validates the source-account
  side. The debt-account side (the target of the payment) is
  intentionally out of scope here.
- The guards do NOT add AI prompt changes; the AI is still the
  primary interpreter. The guards are the safety net before any DB
  write.

---

## Script 19 — Conversation memory: pending clarification + recent turns

**Preconditions.**
- User has Telegram linked and a fixed expense `Internet` of `USD 20.00`.
- A second account `Pichincha` exists (default source acceptable).
- `TRANSACTION_PARSER_MODE` and `COACH_RESPONSE_MODE` set as you
  normally test (basic + fallback is enough for the deterministic
  behavior; AI modes should pass identically).
- Pending state lives in `pending_chat_clarifications`; recent turns
  live in `chat_messages`. Both are gated by the migration in
  `supabase/sql/012_conversation_memory.sql`.

Verify after each step:
- Latest row in `pending_chat_clarifications` for this user (`status`,
  `kind`, `payload`).
- `chat_messages` should contain both the user turn and the assistant
  turn for every Telegram message processed.
- `transactions` rows only when the script says a DB write should
  happen.

### 19.1 Pending opens on amount mismatch
Message: `Internet 25 Pichincha`
Expected:
- Reply: `Veo que Internet normalmente está en USD 20.00, pero esta
  vez pusiste USD 25.00. ¿Lo registro como el pago normal o como un
  cargo aparte?`
- A new `pending_chat_clarifications` row with
  `kind=fixed_expense_amount_mismatch`, `status=open`,
  `payload.fixedExpenseName="Internet"`,
  `payload.fixedExpenseAmount=20`, `payload.enteredAmount=25`.
- No `transactions` row inserted.
- `chat_messages`: one `role=user` row + one `role=assistant` row
  (`message_type=clarification`).

### 19.2 Follow-up "fue el cargo normal" → linked payment
Message right after 19.1: `fue el cargo normal`
Expected:
- Reply confirms a fixed-expense payment of Internet for USD 25.00
  from Pichincha (uses the `fixedExpenseName` short-circuit copy,
  e.g. `Listo: Internet (USD 25.00) desde Pichincha. Lo ligué a tu
  gasto fijo mensual; no es gasto extra.`).
- A new `transactions` row of type `expense` with
  `recurring_expense_id = <Internet id>`, `original_amount = 25`,
  `source_account_id = <Pichincha id>`.
- Pichincha balance decreases by 25.
- Pending row from 19.1 transitions to `status=resolved`,
  `resolved_at` set.
- `chat_messages`: another user + assistant pair stored.

### 19.3 Follow-up "fue otro cargo aparte" → unlinked expense
Reset state, then:
1. `Internet 25 Pichincha`
2. `fue otro cargo aparte`
Expected:
- After step 2, an `expense` row is inserted with **no**
  `recurring_expense_id`, `original_amount = 25`, `source_account_id =
  <Pichincha id>`.
- Pichincha decreases by 25.
- Pending row transitions to `status=resolved`.
- Reply is the normal expense coach response (not the fixed-expense
  short-circuit copy).

### 19.4 Unclear follow-up keeps pending open and re-asks
Reset state, then:
1. `Internet 25 Pichincha`
2. `no estoy seguro`
Expected:
- After step 2, the reply is the short re-clarify line:
  `Solo para no moverlo mal: ¿lo registro como pago fijo de Internet
  o como cargo aparte?`
- No new `transactions` row.
- Pending row from step 1 remains `status=open` (still within TTL).
- A subsequent `fue el cargo normal` resolves it as in 19.2.

### 19.5 Expired pending falls through to normal parser
Steps:
1. `Internet 25 Pichincha`
2. Wait > 12 minutes (the default TTL) or manually update
   `expires_at` to a past timestamp in Supabase.
3. `fue el cargo normal`
Expected:
- `getActivePendingClarification` returns null (expired).
- The reply is the normal parser flow's response (likely
  needs-clarification or unsupported, since the message lacks an
  amount). No DB write tied to the original `Internet 25 Pichincha`
  attempt.

### 19.6 Goal mismatch follow-up (advisory only)
Steps:
1. `mandé 20 a boda desde pichincha` (user has no `boda` goal).
2. `sí, a Brasil` (user's main goal is `Brasil`).
Expected for this module:
- Step 1: clarification reply, no DB write. A pending row of kind
  `goal_name_mismatch` is **not** opened yet (only fixed-expense
  pending is wired in this module — see "Risks/follow-ups").
- Step 2: still treated as a fresh message; no automatic resolution.
- Both turns are persisted in `chat_messages`.

### 19.7 Advisory chat memory ("¿y si lo pago con Visa?")
Steps:
1. `¿Crees que debería comprar este reloj de 120?`
2. `¿y si lo pago con Visa?`
Expected:
- Both step 1 and step 2 are treated by the prefilter/parser as
  unsupported or needs_clarification (advisory questions are out of
  the current parser's scope). No `transactions` rows.
- `chat_messages` contains all four turns (user + assistant for each
  step). Use this table to power advisory AI follow-ups in a future
  module.

### 19.9 Duplicate fixed-expense rows still open pending
**Preconditions.** The user has TWO `Internet` rows in
`fixed_expenses` with the same amount (e.g. both `USD 20.00`). This
mirrors the bug reported in production where pending was not opening.

Steps:
1. `Internet 25 Pichincha`
2. `fue el cargo normal`

Expected:
- After step 1, the matcher returns `status="ambiguous"` with a
  candidate `matchedExpense` (the first duplicate). The handler opens
  a pending row regardless of the `ambiguous` status because a
  candidate is present.
- The clarification message remains:
  `Veo que Internet normalmente está en USD 20.00, pero esta vez
  pusiste USD 25.00. ¿Lo registro como el pago normal o como un
  cargo aparte?`
- After step 2, the pending is resolved and the assistant reply is:
  `Listo, lo registro como pago de Internet por USD 25.00 desde
  Pichincha. No lo trato como gasto extra.`
- One `transactions` row with
  `recurring_expense_id = <first duplicate row id>`,
  `original_amount = 25`, `source_account_id = <Pichincha id>`.
- A `fue otro cargo aparte` follow-up (after re-running step 1) gives:
  `Listo, lo registro como gasto aparte de Internet por USD 25.00
  desde Pichincha.`

**Where to verify.** `pending_chat_clarifications` after step 1 (one
`status=open` row), `pending_chat_clarifications` after step 2
(transitioned to `status=resolved`), `transactions` table, and
Pichincha account balance.

**Known limitation.** When the user has fixed expenses with the same
name but different stored amounts (e.g. two `Internet` rows, one
`USD 20`, one `USD 30`), the matcher still picks `matches[0]` for
the pending payload — same MVP behaviour as the `como gasto fijo`
override branch.

### 19.10 Distinct-name ambiguous does NOT open pending
**Preconditions.** User has two fixed expenses with distinct names
that both partially match (e.g. `Internet` and `Internet Pro`).

Message: `Internet 25 Pichincha`
Expected:
- Matcher returns `status="ambiguous"` WITHOUT a `matchedExpense`
  (the matcher cannot safely pick a candidate when names differ).
- No pending row is created. The user must re-send with explicit
  disambiguation.
- Reply: `Esto puede ser un gasto fijo. ¿Te refieres a Internet o a
  Internet Pro?`

### 19.8 Regression: short, single-message movements unchanged
Sanity-check the existing happy paths still work with the new memory
layer in place. None of these should open a pending row:
- `café 3 pichincha` → expense from Pichincha.
- `almuerzo 8 visa` → card expense on Visa.
- `pagué 35 de visa pichincha desde pichincha` → debt payment.
- `internet 25 como gasto fijo desde pichincha` → confident-match
  fixed expense (matcher short-circuits before the pending logic).
- `internet 20 desde pichincha` (amount matches stored fixed
  expense) → confident-match fixed expense, no pending row.

**Where to verify.** `pending_chat_clarifications.status` column,
`chat_messages` rows, plus the same `transactions` / account balance
checks as the underlying scripts (Script 5, 14, 17, 18).

**Known limitations.**
- This module wires only `fixed_expense_amount_mismatch` end-to-end.
  Other pending kinds (`goal_name_mismatch`, `payment_source_mismatch`,
  `vague_payment`) have schema support and helpers, but no resolver —
  `tryResolvePendingClarification` returns null for them, so the
  normal pipeline still runs (no regression).
- TTL is 12 minutes. Expired rows are not GC'd by a cron; new
  clarifications cancel any prior open row for the same
  user/channel/chat to avoid stale state.
- Web-app chat does not yet pass `channel`/`chatId` into
  `handleChatTransactionMessage`, so it is not memory-aware. Telegram
  is the integration surface for now.
- Advisory follow-ups (e.g. "¿y si lo pago con Visa?") have storage
  but no AI consumer in this module. A follow-up module should pass
  `getRecentChatMessages(...)` into the coach response router.

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
- [ ] Script 15.1–15.5 (goal contribution variants by goalPlan status)
      green.
- [ ] Script 15.6–15.10 (expense/card/income/debt copy reacts to goal
      block / risk) green.
- [ ] Script 15.12 (no main goal → no awkward goal mention) green.
- [ ] Script 16.1 (mismatched goal name → needs_clarification, no DB
      write) green.
- [ ] Script 16.2–16.5 (matching / generic / no-target → success)
      green.
- [ ] Script 17.1 (mode-agnostic goal mismatch — basic, ai,
      ai_with_basic_fallback) green.
- [ ] Script 17.5 (fixed-expense mismatch prompt copy) green.
- [ ] Script 17.6 (fixed-expense override "como gasto fijo") green.
- [ ] Script 17.7 (fixed-expense override "aparte") green.
- [ ] Script 18.1 (pre-parser goal mismatch in ai mode) green.
- [ ] Script 18.5 (payment source guard, café 3 pichincha) green.
- [ ] Script 18.6–18.9 (card / no-source / debt payment unchanged)
      green.
- [ ] Script 19.1 (pending opens on amount mismatch) green.
- [ ] Script 19.2 (pending resolves as linked payment) green.
- [ ] Script 19.3 (pending resolves as separate charge) green.
- [ ] Script 19.4 (unclear follow-up re-asks, keeps pending open) green.
- [ ] Script 19.8 (regression: single-message movements unchanged) green.
- [ ] Script 19.9 (duplicate fixed-expense rows still open pending) green.
- [ ] Script 19.10 (distinct-name ambiguous does NOT open pending) green.

If any of those break, do not commit; report and triage first.
