# Kipu — Deployment Readiness

> **Estado (2026-07-02, HEAD `b97bd33`).** Kipu está desplegado en producción
> (**www.soykipu.com**, Vercel) y listo para beta founder/familia. Este documento
> es el checklist del operador: variables de entorno de producción, el estado de
> migraciones (con la única pendiente marcada), y los crons. La historia por
> stage vive en `docs/BUILD_PROGRESS.md`.

## ⚠️ Migración pendiente (la única)

Migraciones `001` … `032` están **aplicadas** en producción. La única sin aplicar es:

- **`supabase/sql/033_stage26_scheduled_changes.sql`** — tabla `scheduled_changes`
  (Stage 26). Mientras no se aplique, la función de *cambios programados* degrada
  de forma honesta (PGRST205 → "no pude dejarlo programado") y **todo lo demás
  funciona normal**. Aplicarla con el MCP de Supabase (`apply_migration`) o pegando
  el DDL en el SQL editor. Es aditiva y RLS deny-by-default (solo `service_role`).

Tras aplicarla, verificar el cron con:
`curl -H "Authorization: Bearer $CRON_SECRET" https://www.soykipu.com/api/cron/scheduled-changes`
→ debe responder `{ "ok": true, ... }` (sin `CRON_SECRET` correcto responde 401).

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
- **`033` scheduled_changes — PENDIENTE (ver arriba).**

## Cron jobs (vercel.json)

Dos crons diarios (límite de Vercel Hobby = 2), ambos protegidos por `CRON_SECRET`:

- `/api/cron/ambient-loop` — `0 14 * * *` (check-ins proactivos de Telegram).
- `/api/cron/scheduled-changes` — `0 12 * * *` (aplica cambios programados; requiere `033`).

`/api/cron/scheduled-payments` también existe y usa el mismo secret.

## Checklist de deploy

1. Configurar todas las variables de producción (arriba).
2. Aplicar migraciones pendientes (**033**).
3. `npm run lint` y `npm run build` verdes.
4. Push a `main` → Vercel construye y publica.
5. Smoke: `/`, `/login`, `/app` (autenticado) responden; los crons responden 401
   sin bearer y 200 con el bearer correcto; 404 en español para rutas inexistentes.
6. Gates internos (dev server): `/dev/capture-test` 166/166,
   `/dev/onboarding-wizard-test` 81/81, `/dev/onboarding-loop-test` 21/21.
7. QA de comportamiento: `docs/TEST_SCRIPTS.md`. Beta: `docs/FOUNDER_BETA_GUIDE.md`.

## Reglas de seguridad al desplegar

- Migraciones aditivas y aplicadas por un humano; nunca debilitar RLS.
- Sin borrados duros de filas financieras (reversos append-only).
- Ninguna clave `service_role` al navegador; todas las llamadas a modelos por
  server action / route handler.
