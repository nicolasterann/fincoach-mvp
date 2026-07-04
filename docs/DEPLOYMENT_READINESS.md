# Kipu — Deployment Readiness

> **Estado (2026-07-02, HEAD `b97bd33`).** Kipu está desplegado en producción
> (**www.soykipu.com**, Vercel) y listo para beta founder/familia. Este documento
> es el checklist del operador: variables de entorno de producción, el estado de
> migraciones (001–038 aplicadas), y los crons diarios. La historia por
> stage vive en `docs/BUILD_PROGRESS.md`.

## Estado de migraciones

**Todas las migraciones `001` … `038` están aplicadas en producción.** La `033_stage26_scheduled_changes.sql`
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
- **Modos de Kipu (producción):** `KIPU_AGENT_MODE=on`,
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

## Cron jobs (vercel.json)

Dos crons **diarios** (una vez al día), ambos protegidos por `CRON_SECRET`. La cadencia
diaria es **intencional para la beta founder/familia** (el plan Vercel Hobby permite hasta
2 crons diarios y es suficiente): los cambios programados y los check-ins no necesitan ser
en tiempo real. Un cambio programado se aplica **el día que le toca**, en la corrida diaria
del cron — no de forma inmediata ni cada hora. Está bien así; no es una limitación a
"arreglar" con un plan de pago.

- `/api/cron/ambient-loop` — `0 14 * * *` (check-ins proactivos de Telegram, una vez al día).
- `/api/cron/scheduled-changes` — `0 12 * * *` (aplica los cambios programados que vencen
  ese día; requiere `033`).

`/api/cron/scheduled-payments` también existe y usa el mismo secret.

## Checklist de deploy

1. Configurar todas las variables de producción (arriba).
2. Aplicar cualquier migración nueva de `supabase/sql/` (001–038 ya están en prod).
3. `npm run lint` y `npm run build` verdes.
4. Push a `main` → Vercel construye y publica.
5. Smoke: `/`, `/login`, `/app` (autenticado) responden; los crons responden 401
   sin bearer y 200 con el bearer correcto; 404 en español para rutas inexistentes.
6. Gates internos (dev server): `/dev/capture-test` 212/212,
   `/dev/onboarding-wizard-test` 137/137, `/dev/onboarding-loop-test` 21/21.
7. QA de comportamiento: `docs/TEST_SCRIPTS.md`. Beta: `docs/FOUNDER_BETA_GUIDE.md`.

## Reglas de seguridad al desplegar

- Migraciones aditivas y aplicadas por un humano; nunca debilitar RLS.
- Sin borrados duros de filas financieras (reversos append-only).
- Ninguna clave `service_role` al navegador; todas las llamadas a modelos por
  server action / route handler.
