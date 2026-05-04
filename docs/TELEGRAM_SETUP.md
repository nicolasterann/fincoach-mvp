# FinCoach MVP - Configuración de Telegram

Este documento explica cómo conectar un bot real de Telegram al MVP de FinCoach.

## 1. Crear el bot en Telegram

El bot se crea desde Telegram usando BotFather.

Pasos:

1. Abrir Telegram.
2. Buscar @BotFather.
3. Enviar /newbot.
4. Elegir un nombre, por ejemplo: FinCoach MVP.
5. Elegir un username que termine en bot, por ejemplo: fincoach_mvp_bot.
6. BotFather entregará un token.

Ese token debe guardarse en .env.local como:

TELEGRAM_BOT_TOKEN=tu_token_del_bot

Nunca subir el token real a GitHub.

## 2. Variables necesarias

En .env.local deben existir:

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_BASE_URL=

## 3. Webhook de Telegram

El endpoint del webhook es:

/api/telegram/webhook

En producción, la URL completa será:

https://tu-dominio.com/api/telegram/webhook

## 4. Registrar webhook

Después de desplegarp, se debe registrar el webhook en Telegram con setWebhook.

Ejemplo conceptual:

curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" con la URL del webhook y el secret.

## 5. Pruebas locales

Para pruebas locales usamos curl contra:

http://localhost:3000/api/telegram/webhook

El webhook ya puede:

- Validar el secret.
- Leer el telegram_chat_id.
- Buscar si el chat está vinculado a un usuario.
- Procesar mensajes vinculados.
- Registrar gastos, ingresos y aportes a meta.
- Devolver una respuesta conversacional.

## 6. Vinculación de usuarios

La página temporal de desarrollo es:

/dev/telegram-link-test

Sirve para vincular un telegram_chat_id con el usuario autenticado.

En producción esto deberá convertirse en un flujo seguro de vinculación.

## 7. Comportamiento actual soportado

Gasto desde cuenta:

café 3 pichincha

Gasto con tarjeta:

zapatos 40 visa

Aporte a meta:

aporté 20 a brasil desde pichincha

Ingreso:

me pagaron 50 freelance a pichincha

## 8. Seguridad

- No exponer SUPABICE_ROLE_KEY en el navegador.
- No usar NEXT_PUBLIC en variables secretas.
- No subir .env.local a GitHub.
- Mantener TELEGRAM_BOT_TOKEN solo del lado servidor.
- Validar siempre x-telegram-bot-api-secret-token en el webhook.

## 9. Estado actual

Telegram ya funciona localmente con curl y un chat_id vinculado.

El siguiente paso será conectar un bot real desplegando la app y registrando el webhook.
