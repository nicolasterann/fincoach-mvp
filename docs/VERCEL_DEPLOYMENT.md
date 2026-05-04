# FinCoach MVP - Deployment en Vercel

Este documento define Vercel como proveedor recomendado para desplegar el MVP.

## 1. Por qué Vercel

Vercel es una buena opción para este MVP porque:

- El proyecto está construido con Next.js.
- El webhook de Telegram ya está implementado como route handler en `/api/telegram/webhook`.
- Permite configurar variables de entorno fácilmente.
- Permite obtener una URL pública rápida para registrar el webhook de Telegram.
- Es suficiente para validar el MVP antes de pensar en infraestructura más compleja.

## 2. Variables necesarias en Vercel

Configurar estas variables en el panel de Vercel:

### Supabase

NEXT_PUBLIC_SUPABASE_URL  
NEXT_PUBLIC_SUPABASE_ANON_KEY  
SUPABASE_SERVICE_ROLE_KEY  

### OpenAI

OPENAI_API_KEY  
OPENAI_TRANSACTION_PARSER_MODEL  
TRANSACTION_PARSER_MODE  

Por ahora usar:

TRANSACTION_PARSER_MODE=basic

### Telegram

TELEGRAM_BOT_TOKEN  
TELEGRAM_WEBHOOK_SECRET  
TELEGRAM_WEBHOOK_BASE_URL  

TEEBHOOK_BASE_URL debe ser la URL pública del proyecto desplegado.

Ejemplo:

https://fincoach-mvp.vercel.app

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
- Enviar mensaje real al bot.onfirmar que aparece en transactions.
- Confirmar que cambia el saldo correcto.
- Confirmar que el bot responde en Telegram.

## 6. Nota importante

La página `/dev/telegram-link-test` es temporal. Sirve para pruebas controladas, pero no debe ser el flujo final de vinculación en producción.
