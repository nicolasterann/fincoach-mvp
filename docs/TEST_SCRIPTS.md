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

## Cross-script regression checklist

After any change to onboarding, parser, save flow, or coach:
- [ ] Script 1 (happy path) green.
- [ ] Script 2d (debt total vs minimum) green.
- [ ] Script 2f (goal without amount) green.
- [ ] Script 2h (tone mapping including directo→coach_like) green.
- [ ] Script 3 (context builder) green.
- [ ] Script 5 (Telegram expense, baseline) green.
- [ ] Script 12 (goals closure phrase coverage) green.

If any of those break, do not commit; report and triage first.
