# Kipu MVP - Deployment en Vercel

Este documento define Vercel como proveedor recomendado para desplegar el MVP.

## 1. Por qué Vercel

Vercel es una buena opción para este MVP porque:

- El proyecto está construido con Next.js.
- El webhook de Telegram ya está implementado como route handler en `/api/telegram/webhook`.
- Permite configurar variables de entorno fácilmente.
- Permite obtener una URL pública rápida para registrar el webhook de Telegram.
- Es suficiente para validar el MVP antes de pensar en infraestructura más compleja.

## 2. Variables necesarias en Vercel

Configurar estas variables en el panel de Vercel. La forma de verdad es
`.env.example`; abajo está la superficie de producción agrupada.

### Supabase

NEXT_PUBLIC_SUPABASE_URL  
NEXT_PUBLIC_SUPABASE_ANON_KEY  
SUPABASE_SERVICE_ROLE_KEY  

### OpenAI

OPENAI_API_KEY  
OPENAI_TRANSACTION_PARSER_MODEL  
OPENAI_COACH_MODEL  
OPENAI_ONBOARDING_MODEL  
OPENAI_VISION_MODEL  
OPENAI_TRANSCRIPTION_MODEL  

### Modos de Kipu

KIPU_AGENT_MODE            (producción: `on` — el agente es el cerebro primario)  
TRANSACTION_PARSER_MODE    (producción: `ai_with_basic_fallback`)  
COACH_RESPONSE_MODE  
ONBOARDING_ENGINE_MODE  

### URLs

NEXT_PUBLIC_SITE_URL       (origen público, sin slash final; ej. https://www.soykipu.com)  
KIPU_APP_BASE_URL          (URL base absoluta de la app para enlaces salientes)  

### Telegram

TELEGRAM_BOT_TOKEN  
TELEGRAM_WEBHOOK_SECRET  
TELEGRAM_WEBHOOK_BASE_URL  
TELEGRAM_BOT_USERNAME      (handle público sin @; default `fincoach_latam_bot`)  
TELEGRAM_LINK_SECRET       (firma el token del deep-link self-serve; Stage 21.x)  

`TELEGRAM_WEBHOOK_BASE_URL` debe ser la URL pública del proyecto desplegado.

Ejemplo:

https://www.soykipu.com

### Cron

CRON_SECRET                (protege los cron jobs — sin él, los endpoints responden 401)  

### Email entrante (opcional)

INBOUND_EMAIL_SECRET       (vacío = canal apagado; la ruta responde 503)  
INBOUND_EMAIL_DOMAIN  

### Acceso interno

KIPU_INTERNAL_EMAILS       (emails que pueden abrir /dev/* en producción; vacío = cerrado para todos)  

## 3. Orden de deployment

1. Subir el proyecto a GitHub.
2. Crear proyecto en Vercel importando el repositorio.
3. Configurar variables de entorno.
4. Deploy.
5. Confirmar que `/login`, `/onboarding` y `/app` funcionan.
6. Confirmar que `/api/telegram/webhook` responde.
7. Configurar `TELEGRAM_WEBHOOK_BASE_URL` con la URL final.
8. Registrar webhook real en Telegram.
9. Probar mensaje real desde Telegram.

## 4. Comando para registrar webhook real

Después del deployment:

curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "'"$TELEGRAM_WEBHOOK_BASE_URL"'/api/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'"
  }'

## 5. Validaciones después del deployment

Probar:

- Login.
- Crear o revisar cuenta.
- Revisar dashboard.
- Vincular telegram_chat_id desde página dev.
- Enviar mensaje real al bot. Confirmar que aparece en transactions.
- Confirmar que cambia el saldo correcto.
- Confirmar que el bot responde en Telegram.

## 6. Cron jobs

`vercel.json` define **cinco cron jobs** (cuatro diarios y uno semanal):

- `/api/cron/recurring-materialize` — `0 0 * * *` (nocturno: calendario universal
  de materialización, Bloque C).
- `/api/cron/card-interest` — `0 11 * * *` (interés diario de tarjeta).
- `/api/cron/scheduled-changes` — `0 12 * * *` (cambios programados que vencen ese día).
- `/api/cron/fx-refresh` — `0 13 * * 1` (semanal, lunes: tasa FX de mercado).
- `/api/cron/ambient-loop` — `0 14 * * *` (check-ins proactivos, una vez al día).

Todos exigen `CRON_SECRET` (bearer). Sin el secreto correcto responden **401**,
así que hay que setear `CRON_SECRET` en Vercel para que los crons corran.

## 7. Nota importante

La página `/dev/telegram-link-test` es temporal. Sirve para pruebas controladas, pero no debe ser el flujo final de vinculación en producción.
