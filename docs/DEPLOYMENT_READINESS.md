# FinCoach MVP - Deployment Readiness

Este documento resume lo necesario para desplegar FinCoach MVP y probar Telegram real.

## Variables requeridas en producción

Supabase:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

Importante: SUPABASE_SERVICE_ROLE_KEY nunca debe exponerse al navegador y nunca debe usar prefijo NEXT_PUBLIC.

OpenAI:

- OPENAI_API_KEY
- OPENAI_TRANSACTION_PARSER_MODEL
- TRANSACTION_PARSER_MODE

Por ahora TRANSACTION_PARSER_MODE debe mantenerse en basic.

Telegram:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- TELEGRAM_WEBHOOK_BASE_URL

TELEGRAM_BOT_TOKEN viene de BotFather.
TELEGRAM_WEBHOOK_SECRET debe ser privado.
TELEGRAM_WEBHOOK_BASE_URL debe ser la URL pública de la app desplegada.

## Tablas requeridas en Supabase

Deben existir:

- accounts
- debt_accounts
- goals
- transactions
- telegram_user_links

También deben estar aplicados:

- 005_telegram_service_role_grants.sql
- 006_finaal_service_role_grants.sql

## Flujos ya validados localmente

- Crear cuentas.
- Crear tarjetas/deudas.
- Crear meta principal.
- Registrar gasto desde cuenta.
- Registrar gasto con tarjeta.
- Registrar ingreso.
- Registrar aporte a meta.
- Registrar gasto desde chat interno.
- Registrar ingreso desde chat interno.
- Registrar aporte a meta desde chat interno.
- Vincular telegram_chat_id desde página dev.
- Probar webhook Telegram con curl.
- Registrar gasto real desde webhook Telegram simulado.

## Orden recomendado para deployment

1. Elegir proveedor de deployment.
2. Configurar variables de entorno.
3. Desplegar app.
4. Confirmar que login y /app funcionan.
5. Confirmar que /api/telegram/webhook responde.
6. Crear bot real en BotFather.
7. Guardar TELEGRAM_BOT_TOKEN.
8. Registrar webhook real con Telegram.
9. Vincular el chat id real a un usuario.
10. Probar mensaje real desde Telegram.

## Estado recomendado antes de activar Telegram real

- Mantener TRANSACTION_PARSER_MODE=basic.
- Mantener OpenAI prser desactivado.
- Probar primero con un usuario propio.
- Revisar transactions en Supabase.
- Revisar que los saldos cambien correctamente.

## Riesgos pendientes antes de producción real

- Crear flujo seguro de vinculación Telegram.
- Evitar duplicados si Telegram reenvía el mismo update.
- Manejar mensajes no textuales.
- Manejar usuarios no vinculados con instrucciones claras.
- Mejorar logs del webhook.
- Agregar tests para parser y handler.
- Mejorar manejo de errores para producción.

## Próximo paso

Desplegar la app y registrar el webhook real de Telegram.
