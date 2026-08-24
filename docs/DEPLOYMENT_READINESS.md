# Kipu — Deployment Readiness

> **Estado (2026-08-24, cierre M0).** Kipu está desplegado en producción
> (**www.soykipu.com**, Vercel), en beta founder/familia con `KIPU_AGENT_MODE=loop`
> como postura de producción. Este documento es el checklist del operador:
> variables de entorno de producción, el estado de migraciones (001–055 aplicadas),
> y los cinco crons de `vercel.json`. La historia por stage vive en
> `docs/BUILD_PROGRESS.md`; el orden de trabajo vivo, en `docs/ROADMAP.md`.

## Estado de migraciones

**Todas las migraciones `001` … `055` están aplicadas en producción.** La `033_stage26_scheduled_changes.sql`
(tabla `scheduled_changes`, Stage 26) se aplicó el **2026-07-02** — verificada: tabla con
sus 18 columnas, ambos índices (`scheduled_changes_due_idx`, `scheduled_changes_user_idx`)
y RLS deny-by-default (solo `service_role`). La función de *cambios programados* está
totalmente live.

La `034` se aplicó también el **2026-07-02** y habilita el control total por chat:
añade `accounts.status` y `debt_accounts.status` (cierre suave `active` | `closed` — las
cuentas/tarjetas no se borran, se cierran de forma auditable) y la tabla `user_feedback`
(reportes de bug/feedback persistentes, RLS por `user_id`). Las herramientas de chat que
usan estas columnas/tabla las construye el agente de tools; aquí solo consta que `034`
existe y qué habilita.

Verificación del cron (con el bearer correcto):
`curl -H "Authorization: Bearer $CRON_SECRET" https://www.soykipu.com/api/cron/scheduled-changes`
→ responde `{ "ok": true, ... }` (sin `CRON_SECRET` correcto responde 401).

## Variables de entorno de producción

`.env.example` es la forma de verdad y trae **defaults seguros de desarrollo local**;
producción usa la postura AI-native. Grupos:

- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (NUNCA con prefijo `NEXT_PUBLIC`, nunca al navegador).
- **OpenAI:** `OPENAI_API_KEY`, `OPENAI_COACH_MODEL` (default `gpt-5.4`),
  `OPENAI_ONBOARDING_MODEL`, `OPENAI_TRANSACTION_PARSER_MODEL`, `OPENAI_VISION_MODEL`,
  `OPENAI_TRANSCRIPTION_MODEL`.
- **Modos de Kipu (producción):** `KIPU_AGENT_MODE=loop` (rollback explícito: `off`),
  `TRANSACTION_PARSER_MODE=ai_with_basic_fallback`, `ONBOARDING_ENGINE_MODE=ai_with_mock_fallback`,
  `COACH_RESPONSE_MODE` (según posture del coach).
- **URLs:** `NEXT_PUBLIC_SITE_URL=https://www.soykipu.com`,
  `KIPU_APP_BASE_URL=https://www.soykipu.com`.
- **Cron:** `CRON_SECRET` (protege `/api/cron/*`; sin él los crons responden 401).
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_WEBHOOK_BASE_URL`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_LINK_SECRET` (opcional).
- **Email entrante (opcional):** `INBOUND_EMAIL_SECRET`, `INBOUND_EMAIL_DOMAIN`.
- **Acceso interno:** `KIPU_INTERNAL_EMAILS` (allowlist de `/dev/*` en producción;
  fail-closed: vacío → nadie entra a las rutas internas).

Detalle de cada variable y sus fallbacks: `.env.example`. Setup por canal:
`docs/AUTH_SETUP.md`, `docs/TELEGRAM_SETUP.md`, `docs/VERCEL_DEPLOYMENT.md`.

## Migraciones (trail completo)

Aplicar en orden todas las de `supabase/sql/`:

- `001`–`016` — esquema base, ledger, Telegram (dedupe `007`), prefs/aliases,
  onboarding/income (`010`), memoria de chat (`012`), coach-state (`014`),
  Margen (`015`).
- `017`–`020` — captura universal (evidence).
- `022` ambient · `023` deuda · `024` merchant memory · `025` goals/wealth ·
  `026` personalization · `027` household · `028` personality test · `029` FX ·
  `030` snapshots · `031` recurring shared · `032` display-currency + pay-anchor.
- `033` scheduled_changes — aplicada 2026-07-02.
- `034` soft-close + feedback (`accounts.status`, `debt_accounts.status`,
  `user_feedback`) — aplicada 2026-07-02.
- `035` money-truth v2 (`fixed_expenses.is_variable`, `notes` en accounts/
  debt_accounts/goals, `debt_accounts.last_payment_date`) — aplicada 2026-07-02.
- `036` RLS authenticated para `investment_accounts` (activos desde onboarding) —
  aplicada 2026-07-02.
- `037` `investment_accounts.value_original` (FX honesto en activos) — aplicada
  2026-07-03.
- `038` presupuesto vivo (`budget_categories.mtd_seed`/`seed_month`,
  `fixed_expenses.pay_anchor_date`/`last_confirmed_month`) — aplicada 2026-07-03.
- `039` plan programado de "Tu mes" (Stage 37) — aplicada.
- `040` `savings_plans` (reservas de ahorro/inversión con frecuencia/día/destino,
  Stage 38) — aplicada.
- `041` interés diario de tarjeta · `042` FX auto-refresh · `043` ingreso
  ocasional (día a día) — aplicadas.
- `044`–`046` calendario UNIVERSAL de materialización (Bloque C):
  `recurring_occurrences` + timezone del usuario (`044`), kinds
  deuda/ahorro/scheduled (`045`), corte de tarjeta con captura de statement
  (`046`) — aplicadas 2026-07-10/11.
- `047` cuenta fuente de la reserva de inversión (Bloque C19) — aplicada.
- `048` `saldo_kipu` en `daily_financial_snapshots` (Bloque D, curva histórica
  del Saldo Kipu) — aplicada 2026-07-12.
- `049`–`050` cuotas/installments LatAm (Bloque G): `installment_plans` (`049`),
  día de aniversario del plan (`050`) — aplicadas.
- `051` objetivo mensual (Bloque H): `transactions.budget_treatment`,
  `objective_month_closes` y la RPC del ledger — aplicada. **La necesita el cron
  `recurring-materialize`**, que además del calendario corre el cierre mensual del
  objetivo.
- `052` `objective_versions` (el objetivo se versiona por mes: cada mes se mide
  contra el objetivo que regía entonces) — aplicada.
- `053` `objective_versions.amount_base` congelado + RPC
  `kipu_upsert_budget_objective` (puntero + versión en UNA transacción) —
  aplicada.
- `054` backfill + invariantes: `amount_base`/`base_currency` NOT NULL, ancla
  histórica atómica y RPC bulk de onboarding (`kipu_upsert_onboarding_budgets`) —
  aplicada.
- `055` **seguridad — inmutabilidad por privilegio**: `authenticated` pierde toda
  escritura sobre `objective_versions` (solo SELECT), las RPC pasan a
  `SECURITY DEFINER` y el servidor DERIVA el mes vigente (`kipu__user_month`) y
  qué categorías son objetivo — nada de eso se acepta del cliente. Sin la `055`,
  el historial del objetivo es reescribible desde el cliente: **no la saltes** —
  aplicada.

## Cron jobs (vercel.json)

**Cinco crons** (cuatro diarios + uno semanal), todos protegidos por `CRON_SECRET`.
La cadencia diaria es **intencional para la beta founder/familia**: nada necesita ser
en tiempo real. Un cambio programado o una ocurrencia del calendario se aplica **el
día que le toca**, en la corrida diaria del cron — no de forma inmediata ni cada hora.

- `/api/cron/recurring-materialize` — `0 0 * * *` (nocturno). Hace DOS cosas:
  (a) el calendario universal de materialización, Bloque C — ingresos/fijos,
  préstamos, corte y pago de tarjeta, familia, scheduled payments, reservas de
  ahorro/inversión (requiere `044`–`046`); y (b) el **cierre mensual del objetivo**
  del Bloque H (`runObjectiveMonthCloses`: días 1–3 en la zona del usuario,
  idempotente por (usuario, mes), reporte sin mover plata; requiere `051`).
  Sin la `051` el cierre del objetivo no corre.
- `/api/cron/card-interest` — `0 11 * * *` (acreción diaria de interés de tarjeta;
  requiere `041`).
- `/api/cron/scheduled-changes` — `0 12 * * *` (aplica los cambios programados que vencen
  ese día; requiere `033`).
- `/api/cron/fx-refresh` — `0 13 * * *` (diario: refresca la tasa FX de
  mercado; requiere `042`).
- `/api/cron/ambient-loop` — `0 14 * * *` (check-ins proactivos de Telegram, una vez al día).

`/api/cron/scheduled-payments` también existe y usa el mismo secret.

## Checklist de deploy

1. Configurar todas las variables de producción (arriba).
2. Aplicar cualquier migración nueva de `supabase/sql/` (001–055 ya están en prod).
3. `npm run lint` y `npm run build` verdes.
4. Push a `main` → Vercel construye y publica.
5. Smoke: `/`, `/login`, `/app` (autenticado) responden; los crons responden 401
   sin bearer y 200 con el bearer correcto; 404 en español para rutas inexistentes.
6. Gates internos (dev server): `/dev/capture-test` 310/310,
   `/dev/onboarding-wizard-test` 157 (con **C19 fallando: es un fallo conocido y
   preexistente**, no un regreso de este deploy), `/dev/onboarding-loop-test` 21/21.
   Los conteos crecen por bloque; si no cuadran, la cuenta viva está en
   `docs/BUILD_PROGRESS.md`, no aquí.
7. QA de comportamiento: `docs/TEST_SCRIPTS.md`. Beta: `docs/FOUNDER_BETA_GUIDE.md`.
   Smoke con usuario disposable contra un entorno real: `scripts/qa/` (nunca contra
   los datos del founder).

## Reglas de seguridad al desplegar

- Migraciones aditivas y aplicadas por un humano; nunca debilitar RLS.
- Sin borrados duros de filas financieras (reversos append-only).
- Ninguna clave `service_role` al navegador; todas las llamadas a modelos por
  server action / route handler.
