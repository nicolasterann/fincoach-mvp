# Kipu — Guía de beta para founder y familia (v2, julio 2026)

Esta guía refleja el producto ACTUAL (onboarding estructurado tipo wizard, agente AI,
multi-moneda, hogar compartido). Reemplaza cualquier versión previa que mencione el
onboarding por chat.

## 0. Configuración de entorno (una vez, antes de invitar a nadie)

En Vercel (Production):

| Variable | Valor recomendado | Por qué |
|---|---|---|
| `KIPU_AGENT_MODE` | `on` | El agente AI-native es el cerebro (corrige, crea metas, hogares, entiende lenguaje libre). Con el default `off`, el chat es un parser básico sin correcciones. |
| `TRANSACTION_PARSER_MODE` | `ai_with_basic_fallback` | Activa el Universal Router (recovery/duplicados) como red del fallback. |
| `NEXT_PUBLIC_SITE_URL` | `https://www.soykipu.com` | Emails de confirmación/recuperación al dominio real. |
| `KIPU_APP_BASE_URL` | `https://www.soykipu.com` | Links de invitación de hogar (el código ya usa este default, la env lo hace explícito). |
| `KIPU_INTERNAL_EMAILS` | tu email | Acceso a /dev en producción (déjalo sin setear si no lo necesitas: nadie entra). |

En Supabase → Auth → Email templates: verifica que "Confirm signup" y "Reset password"
usan la forma `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`.

## 1. Cómo debe usar Kipu la casa Gabriel + Mile (la receta "casa como empresa")

El sistema de ustedes (todos los ingresos se unen → gastos → deudas → inversión →
"sueldos personales" como dividendos) se modela así **con UNA cuenta Kipu (la tuya) como
"la Casa"** + un hogar compartido para la coordinación con Mile:

1. **Moneda principal: USD.** Los pesos son la moneda del día a día, pero la utilidad y
   la inversión las piensan en dólares. Kipu convierte con TU tasa (paso final del
   onboarding o Ajustes → Tipo de cambio). Actualiza la tasa cuando el dólar se mueva.
2. **Cuentas**: Galicia (ARS), Pichincha Ecuador (USD), Wells Fargo (USD), Efectivo (ARS).
   Marca Wells Fargo/inversiones como no-líquidas si no son plata para gastar.
3. **Ingresos**: Sueldo BA (2.25M ARS, día 1, → Galicia), Salario Ecuador (492 USD, → Pichincha),
   Sueldo Mile (545.54 USD **quincenal con la fecha del último pago** — Kipu proyecta la
   quincena real, → Wells Fargo).
4. **Gastos fijos en ARS** (arriendo, expensas, internet) pagados desde Galicia; Netflix
   u otros en USD desde Wells Fargo. **Crédito educativo de Mile = deuda** (préstamo, USD,
   pago mensual, desde Pichincha).
5. **Presupuestos variables por categoría**: elige la moneda de esos estimados (ARS si
   así gastan) — Kipu los convierte a USD con tu tasa.
6. **Ahorro/Inversión mensual (USD)**: es lo que la "empresa" aparta ANTES de dividendos.
   Kipu lo protege del Saldo Kipu (vive en su propia capa de Ahorro).
7. **El Saldo Kipu = la plata para gustos de la casa.** El héroe diario es un saldo
   ACUMULABLE: un tanque que se recarga cada día con lo libre del mes y se drena con
   los gustos reales (reemplazó al "Margen Kipu" semanal — superseded by Saldo Kipu,
   Bloque D). Para los "sueldos personales": acuerden el monto mensual de cada uno y
   regístrenlo como gasto fijo ("Sueldo personal Gabriel", "Sueldo personal Mile") —
   así el Saldo que ves ya es la caja de la casa después de los dividendos, y cada
   uno maneja su sueldo aparte.
8. **Hogar "Casa con Milena"**: para dividir puntuales (súper, salidas) cuando pague
   cada uno de su plata personal. La casa-empresa vive en TU Kipu; el hogar es la capa
   de coordinación sin exponer tus cuentas.
9. **Mile con su propia cuenta**: acepta el link de invitación; ve SOLO lo compartido.

## 2. Qué probar primero (checklist founder)

1. Onboarding completo con los datos reales de arriba (montos aproximados sirven).
2. Dashboard: Saldo Kipu razonable (el tanque acumulable con su quipu de nudos);
   toggle USD⇄ARS.
3. Chat: "gasté 20000 pesos en el súper con la Galicia" → debe registrar 20000 ARS
   (míralo en Actividad) y citar el MISMO Saldo Kipu del dashboard.
4. Corrección: "me equivoqué, fueron 25000" → reverso + nuevo, sin doble conteo.
5. Meta: "quiero juntar X para ... en marzo" → aparece en Metas.
6. Hogar: "crea un hogar con Milena" → "genera un link de invitación".
7. Ajustes → Tipo de cambio: actualiza la tasa y mira los totales.
8. Quincena de Mile: en "Lo que viene" debe caer cada 14 días desde el último pago.

**Todavía no pruebes / ten en cuenta**: los estados de cuenta PDF por chat web (la subida
existe pero es beta — mejor por Telegram). El **export de datos SÍ funciona** (Ajustes →
"Descargar mis datos (JSON)"; incluye tus últimos 1000 movimientos). Las cuentas y tarjetas
**no se editan desde pantallas** — se manejan por chat: renombrar, ajustar saldo, cambiar la
moneda (solo si la cuenta está vacía), y **cerrar** de forma auditable (§8).

Un cambio programado (p. ej. "en 3 meses sube mi sueldo") se aplica **el día que le toca**,
en la corrida **diaria** del cron — no al instante. Es a propósito para la beta.

## 3. Cómo resetear

Chat: "quiero reiniciar mis preferencias" (tono/recordatorios/test). Para borrar TODOS
los datos financieros de un usuario de prueba, pídemelo (founder) — hay script interno.
No hay auto-borrado total desde la UI (a propósito).

## 4. Script de prueba — Milena

1. Abre el link de invitación que te pasó Gabriel (inicia sesión primero).
2. Acepta ("Unirme al grupo", pon tu nombre).
3. En Resumen → tarjeta "Compartido": ¿qué ves? Debe ser SOLO lo compartido.
4. Pregunta en el chat: "¿qué puede ver Gabriel de mis finanzas?" — la respuesta debe
   dejarte tranquila.
5. Pide: "pagué 15000 pesos de la verdulería de la casa, divídelo con Gabriel".
6. Pregunta: "¿quién le debe a quién?".
7. Cuando le pases plata a Gabriel: "ya le pasé lo que le debía" → debe quedar saldado.

## 5. Script de prueba — Mamá

1. Onboarding mínimo: 1 cuenta (efectivo), 1 ingreso, meta "Ordenar mi mes".
2. Chat: "gasté 10 en el mercado".
3. Chat: "¿cuánto puedo gastar hoy?".
4. Mira el Resumen: ¿entiendes el número grande sin ayuda?
5. Si algo confunde, apúntalo tal cual lo pensaste.

## 6. Script de prueba — Primo/a

1. Onboarding rápido (cuenta + ingreso + meta "comprar algo").
2. Test de personalidad: en el chat, "hagamos el test de personalidad".
3. "quiero juntar 200 para unas zapatillas en 2 meses".
4. Registra 3 gastos reales del día (café, uber, salida).
5. "¿me alcanza para salir a comer mañana?"
6. Mira Metas: ¿motiva o estresa?

## 7. Cómo reportar un bug

Puedes contarle a Kipu **por chat** ("reportar un problema" / "encontré un bug") y **queda
guardado** (migración `034`, tabla `user_feedback`) para que lo revisemos. También está el
acceso "Ayuda y reportar un problema" en Ajustes, que abre ese mismo chat. Usa la plantilla
de abajo para que el reporte sea accionable:

```
QUIÉN: (Gabriel / Mile / Mamá / ...)
DISPOSITIVO: (iPhone Safari / Android Chrome / compu)
DÓNDE: (pantalla o "en el chat")
QUÉ HICE: (pasos, o el mensaje EXACTO que escribí)
QUÉ PASÓ: (y captura/video si puedes)
QUÉ ESPERABA:
GRAVEDAD: (no puedo seguir / molesto / detalle)
¿TOCÓ PLATA O PRIVACIDAD?: (sí/no — si sí, di qué número quedó mal)
```

## 8. El chat controla TODO (Stage 26 → ampliado en S29)

Después del onboarding, cualquier cosa de tu plata se cambia por chat, en lenguaje
normal. La lista de abajo son ejemplos de Stage 26; **S29 completó el control por chat**
(hoy ~110 herramientas tipadas): además de lo de siempre, ahora también renombrar/editar tarjetas,
**cerrar** cuentas y tarjetas de forma auditable, cambiar la moneda de una cuenta (si está
vacía), editar/cancelar pagos programados, cancelar/eliminar metas, cambiar tu moneda base
(solo si aún no tienes datos), **reportar un bug** (queda guardado), y **"explícame mis
datos"** (Kipu te resume en lenguaje natural todo lo que sabe de ti). Todo lo destructivo
pide confirmación y valida contra tu estado real antes de tocar nada.

Ejemplos que ya funcionan:

- **Ingresos**: "cambia mi sueldo a 1400", "ahora me pagan quincenal, 700 por
  quincena", "pausa ese ingreso", "agrega el sueldo de Mile, 800 al mes".
- **Gastos fijos**: "el arriendo ahora es 450", "pausa Netflix, lo cancelé",
  "reactiva el gym", "elimina ese gasto fijo" (pide confirmación).
- **Cambios futuros y programados**: "en 3 meses mi sueldo sube a 1500",
  "cada 3 meses súbele 3% al arriendo", "pausa Netflix desde julio",
  "¿qué cambios programados tengo?", "cancela ese cambio". Se aplican solos el
  día que toca (cron diario) y Kipu deja constancia.
- **Cuentas y tarjetas**: "renombra mi cuenta Banco a Pichincha", "ajusta el saldo de
  Pichincha a 1.250", "cierra esa tarjeta". Nada se borra en duro: una cuenta/tarjeta se
  **cierra** de forma auditable (queda `closed`, no desaparece del historial) — migración
  `034`.
- **Compartido**: "ese gasto era compartido con Mile", "no era 20, era 30",
  "al final no era compartido", "saca a Juan del hogar" (todo lo destructivo
  pide confirmación, y si alguien debe plata te lo advierte antes).
- **Tus datos**: "dame mis datos" → resumen + descarga JSON completa en
  Ajustes → "Descargar mis datos (JSON)".
- **Auditoría**: "¿qué registraste hoy?" te dice exactamente qué anotó Kipu.

> Nota técnica: los cambios programados usan la tabla `scheduled_changes`
> (migración `033`, aplicada en producción) y se aplican solos **el día que
> vencen**, en la corrida **diaria** del cron (una vez al día — no al instante
> ni cada hora; es a propósito para la beta). El cierre suave de cuentas/tarjetas
> y los reportes de bug persistentes usan la migración `034` (`accounts.status`,
> `debt_accounts.status`, tabla `user_feedback`), también aplicada en producción.

## 8b. El dashboard ahora es explorable (Stage 27)

Toca CUALQUIER métrica y se abre su historia completa:

- **Saldo Kipu** → `/app/saldo`: tus capas (Saldo→Reserva→Metas→Ahorro→
  Patrimonio→Deuda), de dónde sale el número y su curva histórica. (El "Margen"
  y el "Pulso" de Stage 27 fueron retirados — superseded by Saldo Kipu, Bloque D;
  `/app/margen`, `/app/readiness`, `/app/precision` y `/app/reality` ahora son
  redirects.)
- **Cuentas** → `/app/cuentas` ("Dónde está tu plata"): pisos por cuenta,
  movimientos exactos recomendados y dónde vive la Reserva.
- **Lo que viene** → `/app/cashflow`: tu saldo proyectado día a día con
  marcadores de riesgo y supuestos honestos.
- **Gasto** → `/app/spending`: tu semana vs tu normal, categorías (~35 días),
  suscripciones detectadas y anomalías.
- **Patrimonio** → `/app/wealth`: composición, meta, inversiones, historial.
- **Monedas** → `/app/fx`: tus tasas y de dónde salen.
- Deuda, Metas, Hogar y Kipu Fit también tienen su detalle enriquecido.

Los gráficos usan SOLO tus datos reales: si un gráfico aún no aparece, Kipu te
dice exactamente qué le falta para armarlo ("Kipu está aprendiendo"). Los
puntos de historial son días con registro real — sin relleno inventado. Todo
respeta "reducir movimiento" del sistema si lo tienes activado.

## 9. Limitaciones conocidas (para no re-reportarlas)

- El estado de cuenta (PDF/foto) funciona mejor por Telegram que por web.
- Metas y montos compartidos se muestran en la moneda base (USD); el detalle por moneda
  original vive en Actividad.
- El test de personalidad vive en el chat (la tarjeta Kipu Fit te lleva directo).
- La descarga de datos incluye tus últimos 1000 movimientos (el resto sigue en Kipu).
- Los presupuestos por categoría se refinan con el uso; los primeros días son estimados.
- Un cambio programado se guarda en la moneda del objetivo; si pides un monto en
  otra moneda, Kipu te pregunta en vez de convertir por su cuenta (a propósito).
