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

Current roadmap: **`docs/ROADMAP.md` is the live roadmap and the only source of
work order.** Read it there — don't re-derive it from any other doc. Principle:
back-end and features to 100% first, the ENTIRE front last as its own stage.
Bloque J is CLOSED (2026-07-28, final commit `54311f6`): the agent was audited
against the real beta chat and then first-principles across delivery identity,
authority, replay/no-op, grounded money/entity evidence, fallbacks, post-write
freshness, runtime tool contracts, complete reads and every write boundary.
Migrations 066–092 are applied; the final disposable probe is 61/61 and the
capture gate 604/604. The current block is **Bloque K = variable fixed expenses
learn from history**, then Bloque L = shared/refunds (low priority) and Bloque M
= the complete front. Bloques A–D, F, G, H, I, J are CLOSED (G = LatAm
installments/cuotas; H = objetivo mensual comida/transporte; I = no number can
inflate itself — money-read doctrine, migrations 056–065). `docs/ROADMAP_MVP.md`
is a historical archive, not pending work.

Read first: `CLAUDE.md`, then `docs/AI_NATIVE_ARCHITECTURE.md` (north star),
then `docs/ROADMAP.md` (what's next), then `docs/PRODUCT_SPEC.md` /
`docs/TECHNICAL_SPEC.md`.

## How to build (AI-native, not route-native)

- The brain is an **LLM agent** that interprets intent broadly and chooses
  **tools**. Add capabilities as **tools**, never as new regex routes or
  phrase gates.
- Production posture: `KIPU_AGENT_MODE=on` — the agent is the primary brain;
  the legacy pipeline is emergency fallback only (never re-extend its gates).
  The tool surface is ~115 typed tools. Agent, chat, ambient, and fallback
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
  recurring/fixed expense create+update, scheduled future payments, variable
  budgets, goal feasibility, and debt pressure. (The old accuracy/flexibility
  scores are retired from the product face — engine-internal only.) New
  capabilities are exposed as tools.
- **Comida and transporte are NOT learned any more** (Bloque H): they carry a
  monthly OBJETIVO the user DECIDES, and Kipu never adjusts it on its own.
  Spend inside the objetivo does not drain the Saldo (it's already reserved via
  essentialEstimate); only the excess drains it. The objetivo is versioned per
  month — each month is measured against the objetivo in force back then, and
  history is immutable. The rest of the variable budgets keep learning. See
  `CLAUDE.md` (Bloque H) for the full contract.
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
  Applied migrations: 001–092 (088 + its fixes 089–092 applied 2026-07-28) (048 adds `saldo_kipu`; 049–050 = installment_plans/cuotas; 051 = objetivo mensual: `transactions.budget_treatment` + `objective_month_closes` + ledger RPC; 052 = `objective_versions`; 053 = `amount_base` + RPC `kipu_upsert_budget_objective`; 054 = backfill + invariantes NOT NULL, ANCLA histórica atómica y RPC bulk de onboarding; 055 = historia inmutable POR PRIVILEGIO: `authenticated` pierde toda escritura sobre `objective_versions` (solo SELECT), las RPC pasan a SECURITY DEFINER y el servidor DERIVA el mes vigente (`kipu__user_month`) y qué categorías son objetivo — ambas comparten el helper `kipu__objective_write`; 056+058 = Bloque I: lease del ejecutor de cambios programados + intención durable con FIDELIDAD (`pending_prev_kind` value/null/row_missing + `pending_extra`); 057+059 = `kipu_apply_repayment` atómico, IDEMPOTENTE ante replay (dedupe_key obligatorio) y con moneda validada por asignación; 060+061 = household atómico: `kipu_add_shared_expense`, `kipu_settle_household` (CAS por counts Y TOTALES + lock compartido de la fila households), `kipu_update_shared_expense`, índice único parcial de `origin_transaction_id`; 062 = auditoría 3: `kipu_apply_repayment` valida `base_currency` contra el perfil, `kipu_cancel_shared_expense`/`kipu_mark_reimbursement_paid` toman el MISMO lock del settle, `kipu__household_actor` valida al actor en toda RPC household, y el update verifica el CONJUNTO persistido — miembro duplicado, cobertura exacta de splits y suma post-write en la misma transacción; 063 = auditoría 4: `kipu_apply_card_payment` — pago de tarjeta ATÓMICO (ledger + baja de `full_payment_due` en una transacción, CAS sobre el valor leído, replay idempotente por dedupe sin re-reducir) — y `kipu_apply_repayment` rechaza al usuario SIN fila de perfil (`v_pbase is null` ⇒ KIPU_VALIDATION, ya no es permiso para continuar); 064 = pasada 5: `kipu_set_card_statement` (corte con lock: updated / safe_newer_exists / raise — el UPDATE viejo daba éxito con cero filas y podía pisar un corte más nuevo), tabla `card_payment_applications` (la MARCA durable del pago aplicado, misma transacción que el ledger; un ledger genérico con el mismo dedupe SIN marca ⇒ KIPU_CONFLICT, jamás replayed) y `kipu_apply_card_payment` v2 (exige debt_payment, entry.debt = statement.debt, ownership+credit_card con lock, y coherencia del monto pagado); 065 = pasada 6 (integridad del ciclo de tarjeta): `statement_total_due`+`statement_covered` (un parcial jamás cubre el corte), corte idempotente con `safe_same_exists`/`corrected_same_statement` (corregir conserva lo pagado), trigger `transactions_debt_payment_currency_guard` (todo debt_payment exige cuenta/entry/deuda en la MISMA moneda nativa común y base = perfil), `kipu_override_debt_due` + `kipu_update_debt_snapshot` (declarativos con lock+CAS), `kipu_apply_card_payment` v3 (fingerprint + marca con transaction unique, cobertura y `last_payment_date` en la misma txn) y `kipu_reconcile_existing_card_payment` (pago manual previo: solo statement+marca)).
  La 066 (Bloque J-1) = trigger `transactions_cash_movement_currency_guard`: expense/income/goal_contribution exigen toda pata de cuenta en la moneda del movimiento y base = perfil (reversal/adjustment/transfer/refund exentos). La 067 (re-auditoría J-1) suma la pata de la META al mismo trigger: goals.currency debe = moneda del movimiento (el ledger suma el ORIGINAL a current_amount; meta sin moneda declarada también rehúsa).
  La 068 (re-auditoría 2 de J-1) = `kipu_change_account_currency` (lock + CAS + re-conteo de movimientos en la transacción), trigger `accounts_currency_change_guard` (moneda inmutable con historia) y `accounts.is_currency_default` + `kipu_set_currency_default_account` (preferencia moneda→cuenta estructurada, única por moneda).
  La 069 (re-auditoría 3 de J-1) = validadores de moneda con `for key share` (cuentas en orden determinista, tarjeta, meta y perfil) para cerrar la carrera contra un cambio de moneda concurrente, `kipu_change_base_currency` atómica, default solo en cuentas ordinarias activas, balances nuevos acotados sin reinterpret e idempotencia `already_changed`.
  La 070 (re-auditoría 4 de J-1) = validadores con `for no key update` (cierran el UPDATE directo, que el `for key share` no bloqueaba), guards de inmutabilidad de `profiles.base_currency` / `debt_accounts.currency` / `goals.currency`, y `kipu__user_base_data_witness`: la definición única y completa de «hay dinero en la base» (19 tablas) usada por la RPC y por el trigger, más pre-onboarding obligatorio.
  La 071 (re-auditoría 5 de J-1) = los guards miran VALOR: tarjeta y meta con moneda INMUTABLE tras el INSERT (el guard de meta mira OLD), la cuenta exige balances viejo y nuevo en cero salvo por la RPC (marca `kipu.sanctioned_currency_change`), y el witness se deriva del catálogo (`kipu__base_data_tables`) con montos ≠ 0 campo por campo.
  La 072 (re-auditoría 6 de J-1) = el witness deja de adivinar por nombre de columna (una regex no vio `mtd_seed` ni `saldo_kipu`): pasa a EXISTENCIA DE FILA sobre lista explícita de 26 tablas, con `kipu__base_data_coverage_gaps()` para ver la deriva; y la RPC rechaza cambiar la moneda de una cuenta cableada a meta/ingreso/plan/pago-de-deuda/gasto-fijo.
  La 073 (re-auditoría 7 de J-1) = coherencia cuenta↔dependencia por LOS DOS LADOS: el trigger de la cuenta usa el mismo helper que la RPC (+scheduled_payments y spending_alert_rules), y triggers INVERSOS bloquean la cuenta al vincularla (metas, ingresos, pagos programados, gastos fijos, cuenta de pago de deuda, planes de ahorro) — la carrera se cierra en cualquier orden. El onboarding deriva la moneda del instrumento vinculado.
  La 074 (re-auditoría 8 de J-1) = `savings_plans` valida la moneda NATIVA (`original_currency ?? base_currency`), `spending_alert_rules` gana trigger inverso, y los guards pasan a VOLATILE (STABLE usa el snapshot del caller: tras esperar un lock no veía lo commiteado). El endurecimiento posterior sin migración centraliza el onboarding en `planOnboardingCurrencies`: una sola decisión alimenta preflight FX, fila y acciones derivadas; una moneda omitida hereda el instrumento y un vínculo incompatible se rehúsa ANTES de cualquier write. Incluye los planes de ahorro: su origen debe existir como cuenta y su destino como cuenta o activo probado — nunca se reetiqueta el monto ni se pierde un vínculo en silencio. Y la contracara: un rechazo cuyo remedio no está en la pantalla es un cerrojo, no un guard — el draft del wizard solo emite un vínculo cuyo objetivo sigue vivo (borrar el activo borra el vínculo), así el preflight solo rehúsa lo que el usuario puede ver y arreglar.
  La 075 (Bloque J-3) = anotar un corte cierra su pregunta: wrappers atómicos sobre `kipu_set_card_statement`/`kipu_override_debt_due` (cores privados, sin service_role) que resuelven la ocurrencia `card_statement` en la MISMA transacción; varios avisos abiertos sin `occurrence_id` ⇒ `ambiguous` (no cierra ninguno y el corte igual se guarda).
  La 078 (Bloque J-7, APLICADA 2026-07-27) cierra la última exención de la 066: su
  propio comentario decía «transfer y refund (reglas propias — J-7 los audita
  aparte)» y esas reglas nunca se escribieron. El efecto `transfer` del ledger
  resta `v_eao` del origen y suma EL MISMO `v_eao` al destino (un monto para dos
  patas), así que ARS→USD inventaba dólares — el bug de J-1 por la puerta que J-1
  dejó abierta; `refund` acreditaba el original sin mirar la moneda del destino.
  El cuerpo es el VIVO de la 070 (bucle determinista de las dos patas con `for no
  key update`, perfil con lock): lo único que cambia es la lista de tipos
  guardados. Siguen exentos `reversal` (debe poder espejar filas históricas malas
  para CORREGIRLAS) y `adjustment` (reconcile y aporte a inversión escriben en la
  moneda de la cuenta por construcción) — verificado por E8/E9 del E2E.
  Las 079–081 (re-auditoría externa de J-7, APLICADAS 2026-07-27): la 079 hace
  ATÓMICO el cierre mensual (`kipu_publish_objective_month_close`: mensaje web +
  filas + finalización del claim en UNA transacción; Telegram queda best-effort
  después del commit) y la publicación del coach ambient
  (`kipu_publish_ambient_coach_message`: la procedencia durable aterriza ANTES del
  efecto externo), y suma `adjustment` al guard monetario — la 078 lo había dejado
  exento "por construcción", que es proteger una invariante con una convención.
  La 080 reemplaza la saga de la inversión recurrente por
  `kipu_apply_investment_occurrence` (caja + activo + ocurrencia + marcador en una
  transacción, replay por fingerprint, locks sobre ocurrencia/plan/cuenta/activo) y
  persiste `resolved_amount`/`resolved_currency` de las reservas. Ambas revocan las
  escrituras de `authenticated` sobre `objective_month_closes` y
  `recurring_occurrences` (SELECT sí, writes sólo service_role).
  La 081 corrige un defecto de las dos anteriores: **`40001` es
  `serialization_failure` y PostgREST REINTENTA ese SQLSTATE**, así que usarlo para
  un rechazo DETERMINISTA hacía que el cliente recibiera HTTP 504 en vez del
  conflicto — y como el caller lee 504 como fallo de infraestructura, reintentaba
  otra vez. La 081 pasó 10 rechazos deterministas a `22023`, pero su informe
  clasificó erróneamente como CAS tres ramas finales que ocurren DESPUÉS de
  bloquear claim/occurrence; la 082 las reclasifica en la frontera v2.
  Las 082–083 (rollout en dos pasos) están APLICADAS: 082 → deploy `bf7d7d4` →
  083. Agregan wrappers v2 para publicación/cierre/planes y doce writers
  financieros; los rechazos deterministas salen como `22023`, los quince cores
  legacy ya no son ejecutables por `service_role`, y `savings_plans` perdió el
  bypass autenticado. Los crons/resolvers relacionados usan lecturas tipadas y
  completas: error o tope nunca significan ausencia.
  La 084 (Bloque J-8: pago multifuente de tarjeta, drafts de captura, cierre atómico
  de cuenta/tarjeta/cuotas, undo universal) la aplicó el founder A MANO por el editor
  SQL, así que NO figura en `schema_migrations` — la cadena real es 084 (manual) →
  085 → 086. La 085 corrige un defecto que dejaba MUERTO el pago multifuente: su
  puente de fondos prestados etiquetaba `debt_account_id` en un `adjustment`, y el
  validador del ledger (051) lo prohíbe, así que la operación entera abortaba. La 084
  conserva ese defecto a propósito: una migración aplicada no se reescribe. La 086
  rehace el backfill de cuotas preservando también `status='paid_off'` (el esquema
  049 permite ese status con `paid_off_at` nulo, así que mirar sólo la fecha podía
  borrar una liquidación legítima). La 087 está APLICADA (2026-07-28): liga un
  draft de captura resuelto a `kind + dedupe + operation_id`, acepta únicamente
  el replay exacto y rehúsa un segundo consumo secuencial, cruzado o concurrente.
  La 088 (cierre first-principles de J) está APLICADA (2026-07-28): identidad
  durable de delivery/chat, challenges de autoridad decididos por el servidor,
  transferencia FX atómica de dos patas nativas, creates/replays idempotentes y
  writers household/instrumentos/correcciones endurecidos. La 089 corrige dos
  defectos suyos que sólo aparecieron ejecutando: `kipu_create_account_idempotent`
  y `kipu_create_debt_account_idempotent` estaban MUERTAS (text→enum sin cast, así
  que crear cuenta/tarjeta desde el agente fallaba siempre), y en
  `kipu_claim_agent_action_challenge` la adyacencia —que CANCELA— corría antes del
  chequeo de auto-confirmación, así que una redelivery tardía del turno que
  propuso mataba la propuesta que el usuario iba a confirmar. La 090 corrige un
  CERROJO suyo: el guard de meta compartida abortaba cuando `household_id` pasaba
  a NULL, y esa columna es ON DELETE SET NULL, así que un hogar con meta
  compartida quedaba imposible de borrar; ahora la meta se degrada a
  no-compartida en la misma operación. `scripts/qa/j-agent-088-probes.mjs` da
  61/61 con residuo cero. La 091 cierra además un defecto ANTERIOR al bloque que
  salió a la luz aquí: `shared_expenses.created_by` y
  `household_settlements.created_by` eran NOT NULL con ON DELETE SET NULL —dos
  reglas que se contradicen—, así que quien hubiera creado un gasto compartido o
  una liquidación no podía borrar su cuenta nunca; la columna cede y el write no
  (guard de INSERT). La 092 cierra ese contrato del todo: `created_by` es
  INMUTABLE mientras su autor exista (un UPDATE manual a NULL falsificaría la
  firma del cascade; reasignar la autoría reescribiría la historia), y añade
  `kipu__schema_contract_report()` —sólo service_role, sólo lectura— para que la
  sonda exija contra el CATÁLOGO cero columnas NOT NULL dentro de un FK
  ON DELETE SET NULL y los cuatro guards de autoría instalados y activos. Sondas
  **61/61**.
  La 048 es la que añadió `saldo_kipu` a `daily_financial_snapshots`.
  La 093 (Bloque K, **PREPARADA, NO APLICADA**) separa el plan declarado del
  fijo variable, su observación nativa por ciclo y la proyección prudente:
  `fixed_expense_forecasts`, `fixed_expense_observations` y operaciones
  idempotentes; estado abierto `observed`; writer atómico
  `kipu_record_variable_fixed_observation`; convergencia desde cualquier ledger
  ligado; régimen nuevo solo ante cambio permanente; p75 robusto sobre hasta 24
  observaciones de la misma moneda/cadencia/régimen; y orden de locks
  fixed→account común a calendario/legacy. `authenticated` solo lee las tablas
  aprendidas. No afirmar que está aplicada hasta sondearla; una migración nueva
  se numera desde la 094.

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
Margen Kipu as a visible brand, Pulso Kipu (0–100 score), Flexibilidad,
Precisión, Realidad, the named states (Holgado/Justo/Estirando), and weekly
hero framing. `/app/margen`, `/app/readiness`, `/app/precision`, `/app/reality`
are redirects; `margenWeekly`/`margenDaily` survive only as engine internals.
Do not resurrect any of them.

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
(currently 684/684 assertions green), and the behavior-level QA in
`docs/TEST_SCRIPTS.md`; larger stages also get a disposable-persona E2E
battery and a multi-agent red team. Check `git status`. Do not commit unless
told.
