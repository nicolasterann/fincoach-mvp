# Kipu — Paquete de Beta Fundador/Familia

> Listo para que Gabriel/Nico pruebe Kipu con datos reales o semi-reales junto a
> Milena, su mamá y su primo/a — sin un desarrollador al lado. Complementa
> `docs/FOUNDER_BETA_GUIDE.md` (qué es y cómo se usa) con **scripts concretos por
> persona** y una **plantilla de reporte de bugs**.
>
> Para las capacidades más nuevas de la beta (control total por chat, cambios
> programados, páginas de detalle de métricas — Stage 27), ver
> `docs/FOUNDER_BETA_GUIDE.md` §8/§8b; este paquete es anterior a ellas.

---

## 1. Checklist del fundador (Gabriel)

**Antes de empezar**
- [ ] Entra desde el celular (es mobile-first) y desde la web.
- [ ] Crea tu cuenta → caes directo en el onboarding, un asistente estructurado
      paso a paso (ver `docs/FOUNDER_BETA_GUIDE.md`).
- [ ] Usa datos **reales o semi-reales** tuyos (no de terceros sin avisarles).
- [ ] (Opcional) Conecta Telegram desde **Ajustes → Conectar Telegram**.

**Qué probar primero (en orden)**
1. Onboarding: el asistente estructurado te lleva paso a paso (ingreso, una
   cuenta, una meta). Fíjate si se siente claro y fácil de completar.
2. Registra 3-4 gastos en lenguaje natural ("gasté 20 en almuerzo con Pichincha").
3. Pregunta "¿cuánto puedo gastar?" y mira tu Saldo Kipu (el héroe del dashboard).
4. Sube un estado de cuenta (PDF/foto) y revisa el resumen.
5. Abre el dashboard: Saldo Kipu (el tanque acumulable con su quipu de nudos),
   Hoy, "Lo que viene", tarjetas. (El Margen y el Pulso fueron retirados —
   superseded by Saldo Kipu, Bloque D.)
6. Haz el test **Kipu Fit** y nota si el tono cambia.
7. Crea un **hogar** con Milena, registra un gasto compartido, "¿quién le debe a quién?".
8. Agrega un gasto compartido **recurrente** (renta) y luego "ya pagué la renta".
9. Pide una **conversión FX** ("¿cuánto son 100 dólares en reales?").
10. Crea una **mini-meta** ("quiero unos audífonos de 250") y pregunta si puedes comprarlos.

**Qué NO probar todavía**
- Monetización / planes (no existe).
- Cuentas o deudas compartidas de "primer nivel" (se modela vía gastos/recurrentes).
- Invitación por email/SMS (se invita por enlace/código que tú compartes).

**Cómo reiniciar**
- "Quiero reiniciar mis preferencias" en el chat (test/tono/recordatorios).
- Para borrar TODO de un usuario de prueba, hazlo desde el panel de Supabase
  (no expuesto a usuarios). El borrado total in-app no está en esta beta.

**Cómo reportar**
- Usa la plantilla de §5. Manda capturas. Marca si tocó **dinero** o **privacidad**.

**Limitaciones conocidas (no son bugs)**
- Las tendencias necesitan varios días de uso (foto diaria) para llenarse.
- Recordatorios (cron) corren **una vez al día** en el plan actual.
- FX cubre monedas del BCE (USD/EUR/BRL/MXN…); para COP/ARS/PEN/CLP usa tu tasa manual.
- `KIPU_INTERNAL_EMAILS` debe setearse en Vercel para que TÚ accedas a /dev en prod
  (por defecto está cerrado para todos — seguro).

---

## 2. Script para Milena (hogar / dinero compartido)

Objetivo: que el hogar se sienta **claro, seguro y sin reproche**.
1. Abre el enlace de invitación que te mandó Gabriel → **Unirme al grupo**.
2. En el chat: "¿qué pueden ver los demás en el hogar?" → debe asegurarte que
   nadie ve tus cuentas, tu Saldo Kipu ni tus deudas personales.
3. "pagué la cena de 60, divídela conmigo y con Gabriel" → revisa el reparto.
4. "¿quién le debe a quién?" → debe ser claro y neutral.
5. Abre **Compartido** en el dashboard: saldos, próxima acción.
6. "Gabriel ya me pagó su parte" → registra el reembolso (no es ingreso).

A evaluar: ¿se siente seguro? ¿claro? ¿neutral (sin sonar a auditoría de la relación)?

---

## 3. Script para la mamá (no técnica)

Objetivo: que una persona no técnica entienda **qué hacer** sin ayuda.
1. Crea tu cuenta y responde lo que Kipu te pregunte (puedes ir simple).
2. (Opcional) salta el test de personalidad por ahora.
3. Escribe un gasto sencillo: "gasté 10 en el pan".
4. Pregunta: "¿cuánto puedo gastar?".
5. Mira la pantalla principal: ¿entiendes el número grande (tu Saldo Kipu)?
6. Pregunta: "¿qué cambió?".
7. Si te trabas, escribe "no entiendo, ayúdame" — Kipu debe guiarte con calma.

A evaluar: ¿sabe qué hacer en cada paso? ¿algún texto la asusta o confunde?

---

## 4. Script para el primo/a (joven, mini-metas)

Objetivo: que motive sin juzgar.
1. Crea tu cuenta; haz el test **Kipu Fit** (es corto y sin rollo).
2. "tengo 600 en mi cuenta".
3. "quiero unos AirPods de 250" → debe proponerte una mini-meta segura.
4. Registra gastos casuales: "gasté 5 en un café", "12 en uber".
5. "¿ya puedo comprar los AirPods?" → respuesta clara, sin sermón.
6. Mira el progreso de tu mini-meta.

A evaluar: ¿motiva? ¿se siente para alguien joven? ¿juzga o acompaña?

---

## 5. Plantilla de reporte de bug

```
Usuario:            (Gabriel / Milena / mamá / primo)
Dispositivo:        (iPhone / Android / web — modelo si puedes)
Pantalla o ruta:    (ej. /app, chat, /app/household, onboarding)
Qué intentaba:      (en tus palabras)
Qué escribiste:     (el mensaje EXACTO si fue en el chat)
Qué pasó:           (lo que viste)
Qué esperabas:      (lo que creías que iba a pasar)
Captura:            (sí / no — adjunta)
Severidad:          (bloqueante / molesto / detalle)
¿Tocó dinero?:      (sí / no — si un número se vio mal, anótalo)
¿Tocó privacidad?:  (sí / no — si viste algo que no debías ver)
Si el chat sonó raro: pega la frase EXACTA de Kipu.
```

Manda esto al fundador. Cualquier cosa que toque **dinero** o **privacidad** es
prioridad máxima.
