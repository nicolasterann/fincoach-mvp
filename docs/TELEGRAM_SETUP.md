# Kipu MVP - Configuración de Telegram

Este documento explica cómo conectar un bot real de Telegram al MVP de Kipu.

## 1. Crear el bot en Telegram

El bot se crea desde Telegram usando BotFather.

Pasos:

1. Abrir Telegram.
2. Buscar @BotFather.
3. Enviar /newbot.
4. Elegir un nombre, por ejemplo: Kipu.
5. Elegir un username que termine en bot. El default de producción es
   `fincoach_latam_bot` (ver TELEGRAM_BOT_USERNAME en `.env.example`); cualquier
   otro username válido también sirve — es solo un ejemplo.
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

Después de desplegar, se debe registrar el webhook en Telegram con setWebhook.

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

El flujo seguro de vinculación self-serve **ya está en producción** (Stage 21.x):
desde **Ajustes → Conectar Telegram** la app genera un deep-link firmado
(`https://t.me/<TELEGRAM_BOT_USERNAME>?start=<token>`), donde el token va firmado
con `TELEGRAM_LINK_SECRET` (si no se setea, cae a `SUPABASE_SERVICE_ROLE_KEY`,
solo del lado servidor). Al abrir el enlace, el bot vincula el `telegram_chat_id`
con el usuario autenticado. Este es el mecanismo actual.

La página `/dev/telegram-link-test` quedó como ruta interna de prueba únicamente
(gated por `KIPU_INTERNAL_EMAILS` en producción); ya no es el flujo de vinculación.

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

- No exponer SUPABASE_SERVICE_ROLE_KEY en el navegador.
- No usar NEXT_PUBLIC en variables secretas.
- No subir .env.local a GitHub.
- Mantener TELEGRAM_BOT_TOKEN solo del lado servidor.
- Validar siempre x-telegram-bot-api-secret-token en el webhook.

## 9. Estado actual

Telegram ya funciona localmente con curl y un chat_id vinculado.

El siguiente paso será conectar un bot real desplegando la app y registrando el webhook.
