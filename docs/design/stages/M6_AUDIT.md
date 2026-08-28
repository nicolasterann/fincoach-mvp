# M6_AUDIT — Ronda 1 · VEREDICTO: **VERDE**

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `fa1c3b0`
- **Entrada:** `M6_REPORT.md` Ronda 1 (W1–W16).
- **Método:** los dos runners headless + lint + build + **la corrida real del
  E2E de persona desechable** + una mutación propia + DOM en Chromium.

**M6 se acepta en una sola ronda.** Y cierra el hallazgo más viejo del
expediente: **ya no queda ninguna superficie construida sin puerta**.

---

## W10 · Las puertas, contadas por mí

Enumeré los `href` alcanzables dentro de la hoja de perspectiva:

| Ruta | ¿Alcanzable? |
|---|---|
| `/app/saldo` · `/app/mes` · `/app/spending` | **sí** |
| `/app/debt` · `/app/wealth` · `/app/cuentas` | **sí** |
| `/app/goals` · `/app/activity` · `/app/chat` | **sí** |

**Faltantes: cero.** `/app/spending`, `/app/debt` y `/app/wealth` llevaban
meses construidos contra el motor **sin un solo enlace entrante** — era el
primer hallazgo de la auditoría de pre-implementación y hoy queda cerrado.

## Los estados honestos, probados uno por uno

- **W5 · Reserva sin objetivo declarado:** muestra **«1.200$ · Tu respaldo va
  en 1.200$. Dime cuánto quieres tener y te muestro cuánto te falta.»** — la
  cifra sin porcentaje y con su invitación. El 50% que aparece cuando sí hay
  objetivo **desaparece** de la pantalla. Cero denominadores inventados.
- **W6 · El cordón no interpola:** con días faltantes dibuja **4 nudos y
  exactamente 2 segmentos** (188→206 y 260→278). El salto del hueco **no
  tiene línea**. Los días sin registro son ausencia, no una recta imaginaria.
- **W7 · Cero puntajes y cero vocabulario retirado:** `pulso`,
  `flexibilidad`, `precisión`, `realidad`, los estados nombrados y «colchón»
  dan **false** en toda la superficie.
- **W8 · El sueño con nombre:** «Brasil» encabeza los progresos.
- **W3 · La forma codifica:** anillos para Hoy (arcos), barras para progresos
  y para Tu mes.
- **W11 · Una sola lectura pesada:** abrir la hoja **no** agrega un
  `buildCoachingBriefing`. El segundo sitio que existe es
  `readShellSaldoLevel`, el recálculo de nivel **post-escritura** de M4 — otra
  petición, no esta carga.

## Gates, E2E y dientes

- `lint` **0 errores** · `build` **exit 0** · captura **842/842** por **los dos
  runners headless** (838 + 4 nuevas).
- **E2E de persona desechable: 10/10 verdes, residuo cero**, con las dos
  pruebas nuevas corridas contra la base real: **M6-E8** (persona sin objetivo
  de Reserva ⇒ cifra e invitación, **nunca** porcentaje) y **M6-E9**
  (snapshots con día faltante ⇒ hueco conservado, **jamás** interpolado).
- **Mutación propia:** anulé el guard del objetivo de Reserva ⇒ **841/842**
  nombrando **M6-1**, y la salida del fallo muestra exactamente el pecado
  («`Objetivo de Reserva: null$`»). Revertido ⇒ **842/842**, árbol limpio.
- Alcance: cero dependencias, cero migraciones.

## Una decisión de Codex que mejora el spec

Yo exigí que **cada porcentaje declare su denominador**; Codex además lo
**muestra al usuario**: «Denominador · Recarga de hoy: 24$», «Objetivo del
mes: 300$», «Ingreso mensual: 2.400$», «Deuda registrada el 22 ago: 910$».
Eso convierte la honestidad en algo que el usuario puede ver, no sólo en algo
que el código promete.

**Contrapeso para la pasada del founder:** son seis líneas de «Denominador ·
…» en una superficie de bienestar, y la crítica del founder al mock v2 fue
justamente «mucho texto». Es honesto y está bien construido; queda a su
criterio si la etiqueta se muestra siempre, se acorta, o aparece sólo al
tocar el indicador. **No es un defecto: es una decisión de densidad.**

## Estado

**M6 ACEPTADO.** `stage-m-front` acumula M1–M6. Faltan **M7** (re-vestir las
superficies de detalle), **M8** (PWA y pulido) y **M9** (borrar el shell viejo
y cerrar el bloque) antes de la pasada única del founder.
