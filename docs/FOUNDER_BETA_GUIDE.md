# Kipu — Guía de Beta para Fundador y Familia

> Para tus primeros testers reales (tú, tu familia, amigos cercanos). Sin
> desarrollador al lado. Kipu es tu coach financiero: hablas con él como con un
> ChatGPT que **ya conoce toda tu vida financiera** y puede **actuar** con
> seguridad. Esta guía es de Stage 20 PASS 2 (Dashboard visual + Hogar + Pulido
> de beta). **No es monetización.**

## 1. Empezar (5 minutos)

1. Entra a la app (web o instálala como app desde el navegador) e inicia sesión.
2. Completa el **onboarding** conversacional: Kipu te pregunta lo básico (ingreso,
   cuentas, una meta). Puedes responder en lenguaje natural.
3. (Opcional) Conecta **Telegram** desde **Ajustes → Conectar Telegram** para
   registrar gastos por texto, voz, foto o PDF desde donde estés.
4. (Opcional) Haz el **test Kipu Fit** (Ajustes → Kipu Fit) para que se adapte a ti.

## 2. El tablero (Resumen)

Arriba siempre verás **una respuesta clara primero**, detalle después:

- **Margen Kipu** — cuánto puedes gastar tranquilo esta semana (ya descontados
  pagos, deudas, ahorro y meta).
- **Pulso Kipu** — tu estado financiero de la semana, con lo que lo mueve.
- **¿Qué cambió?** — tendencias honestas (aparecen cuando hay historial; los
  primeros días dirá "estoy juntando tu historial" — eso es correcto, no inventa).
- Tarjetas opcionales según tu perfil: **Lo que viene** (calendario), **Tu gasto**,
  **Compartido** (hogar), **Patrimonio**, **Monedas**, **Kipu Fit**.
- El **engranaje (⚙️ Ajustes)** arriba a la derecha es tu centro de control.

Si eres un usuario "simple", verás menos tarjetas; si quieres más detalle, abre
**"Ver más"**. **Las obligaciones (un pago vencido, margen negativo, riesgo de
flujo) NUNCA se ocultan**, sin importar tu perfil.

## 3. Qué probar (escenarios)

**Captura y verdad financiera**
- "gasté 20 en almuerzo" / manda una foto de un recibo / sube un PDF de tu estado
  de cuenta. Revisa que aparezca en Actividad y que el Margen se ajuste.
- "no era con Visa, era Pichincha" → debe corregir sin drama.

**Dashboard visual**
- Mira el Margen, el Pulso y las tarjetas. En unos días, vuelve y revisa
  **¿Qué cambió?** (debería mostrar tendencias reales, nunca inventadas).
- Usuario simple vs. detallado: el tablero debe sentirse calmado, no un Excel.

**Hogar / dinero compartido** (lo nuevo de este pass)
- "crea un hogar con mi pareja" → luego **Ajustes → Hogar**.
- Invitar: "mándame el link para invitar a [nombre]" → comparte el enlace; la otra
  persona lo abre y acepta (no entra hasta aceptar).
- "pagué el súper 100, divídelo conmigo y con Ana" → revisa "¿quién le debe a
  quién?" en Hogar.
- Recurrente: "la renta son 800 al mes, la dividimos" → aparece en "Gastos
  compartidos que vienen"; "ya pagué la renta de este mes" para registrar el ciclo.
- "¿qué pueden ver los demás?" → debe asegurarte que **nadie ve tus cuentas, tu
  Margen ni tus deudas personales**.
- Viaje: "cerramos el viaje / ya quedamos a mano" → cuadra y archiva.

**Monedas (FX)**
- "¿cuánto son 100 dólares en reales?" (par soportado → tasa real de referencia).
- "¿cuánto son 100 dólares en pesos colombianos?" → te pedirá/usará TU tasa
  (Kipu nunca inventa una). Guarda una con "mi tasa de dólar a peso es X".

**Personalización**
- Haz el test Kipu Fit y nota si el tono/detalle cambian. Cámbialo cuando quieras;
  tu cambio explícito siempre gana.

## 4. Comportamiento esperado

- Una respuesta clara primero; el detalle es opcional y expandible.
- El dinero es **determinista** (lo calcula el motor, no se inventa); la IA traduce.
- Una tarjeta/columna **vacía dice que está vacía** ("sin historial aún", "sin tasa")
  en vez de mostrar un gráfico falso.
- En el hogar: tono neutral, sin culpa; un reembolso **no** es ingreso; un gasto
  compartido se cuenta **una sola vez**.
- Recordatorios (Telegram): como máximo lo acordado por día, respetando tu horario
  tranquilo; las obligaciones (pagos/deuda) nunca se silencian.

## 5. Limitaciones conocidas (beta)

- **Gráficos de tendencia** necesitan varios días de uso para llenarse (una foto
  diaria). Es esperado que al inicio digan "sin historial aún".
- **Cuentas/deudas compartidas de primer nivel** y **entrega de invitación por
  email/SMS** no están en esta beta: se invita por **enlace/código** que tú
  compartes.
- **Soporte familiar** se modela como un gasto compartido recurrente que absorbe
  el pagador (no como una cuenta aparte).
- La **visibilidad** del hogar es mínimo/estándar/completo (no por-campo).
- El proveedor FX cubre las monedas del BCE (USD, EUR, BRL, MXN, …); para monedas
  LatAm no cubiertas (COP, ARS, PEN, CLP…) usa **tu** tasa manual.
- El **cron** de recordatorios corre **diario** (no por hora) en el plan actual.

## 6. Cómo reportar un problema

Cuando algo se sienta raro, anota:
1. Qué hiciste (el mensaje exacto que escribiste).
2. Qué esperabas.
3. Qué pasó (captura de pantalla si puedes).
4. Canal (web o Telegram) y hora aproximada.

Mándaselo al fundador. Si un número se ve mal, dilo en el chat ("creo que mi
Margen está mal porque…") — Kipu intenta explicar de dónde sale cada número.

## 7. Reiniciar / limpiar (para volver a probar)

- "Quiero empezar de cero" en el chat → Kipu reinicia tus preferencias (confirma
  antes de algo destructivo).
- Para borrar datos compartidos de un hogar de prueba, sal del hogar o pide
  archivar el grupo.
- Los datos de prueba del fundador/familia se pueden limpiar desde el panel de
  administración de la base de datos (no expuesto a usuarios).

## 8. Privacidad (lo importante)

- Kipu **nunca** comparte tus cuentas, tu Margen, tus deudas ni tus gastos
  personales con otros miembros de un hogar. Lo compartido es **solo** lo que tú
  registras como compartido.
- Las herramientas internas de desarrollo (`/dev/*`) **no son accesibles** para
  testers de beta en producción.
