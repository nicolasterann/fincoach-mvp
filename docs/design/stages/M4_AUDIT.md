# M4_AUDIT — Ronda 1 · VEREDICTO: **VERDE**

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `ed58f19`
- **Entrada:** `M4_REPORT.md` Ronda 1 (U1–U17, con los límites de entorno
  declarados).
- **Método:** los dos runners headless + lint + build + **la corrida real del
  E2E de persona desechable contra el Postgres de producción** + una mutación
  propia + DOM en Chromium a 375×812.

**M4 se acepta en una sola ronda.** Y lo más importante del stage no es el
dock ni la hoja: es que **la deuda de verificación del bloque quedó saldada
con datos**, no con lectura de código.

---

## El entregable que importaba: corrido por mí, no leído

```
persona desechable: 15dc6134-ef50-436e-9b59-f3f7cb7c4b23
  ok   · M4-E0 · lectura productiva del hilo es completa
  ok   · M4-E1 · write real aparece con recibo reconstruido desde el ledger
  ok   · M4-E2 · digest y cierre web con chat_id NULL aparecen y conservan autor
  ok   · M4-E3 · Telegram queda intercalado en orden cronológico real
  ok   · M4-E4 · identidad durable compartida dedupea a web; texto solo no dedupea
  ok   · M4-E5 · referencia inexistente produce recibo incompleto sin relleno
  ok   · M4-E6 · chat_cleared_at oculta el hilo sin borrar una sola fila

7 verdes, 0 rojos antes de limpieza
limpieza: residuo cero verificado en DB y auth
7 verdes, 0 rojos finales
```

Con esto quedan **probadas por datos** las cinco casillas que M3 y M2 dejaron
abiertas: el recibo sale del ledger de verdad, **C4 está cerrado con hechos**
(las filas `web` con `chat_id NULL` aparecen), el dedupe distingue identidad
de texto, un recibo que no se puede completar **se declara incompleto sin
rellenar**, y «Nueva conversación» **oculta sin borrar una sola fila**.

Antes de ejecutarlo leí el script: persona desechable, borrado en `finally`,
residuo verificado **por tabla con conteos exactos** más la cuenta de auth, y
el caso de recibo incompleto resuelto con **una identidad inexistente** — sin
borrar ninguna fila financiera, como exige `CLAUDE.md`. Cumple también la
lección de M3: su resolver **stubbea `server-only`** en vez de arrastrar el
marcador a un runner headless.

## Gates y dientes

- `lint` **0 errores** · `build` **exit 0** · captura **834/834** por **los dos
  runners headless** (830 + las 4 aserciones nuevas de M4; ninguna anterior
  removida ni relajada).
- **Mutación propia:** quité de `verifiedOrbWriteSignal` la exigencia de
  recibo durable ⇒ **833/834** nombrando **M4-2** («el orbe sólo recibe nivel
  servidor + recibo durable»). Revertido ⇒ **834/834** y árbol limpio.

## Verificado en pantalla (375×812)

| | Resultado |
|---|---|
| **Pill** | Caja **fija de 46 px** con línea real («Diners · 50,60$ · 27 de agosto») |
| **Abrir la hoja** | Tocar el dock la abre (`pointer-events: auto`) y **el dock se desmonta**: no hay dos composers compitiendo — el dock ES el chat colapsado, como pedía R1 |
| **Continuidad del borrador** | Escribí «borrador de prueba» en el dock; al expandirse, **el texto está en el composer de la hoja**. Es el detalle que hace que capturar y conversar sean lo mismo |
| **Cerrar por backdrop** | Cierra de verdad: eventos apagados y **el dock vuelve** |
| **Capa preservada** | Abrí la hoja desde **Deuda** y seguí en Deuda |
| **Hoja cerrada, teclado** | El composer oculto **no puede tomar foco** (`focus()` deja el foco en `body`) en los dos estados de cierre, y queda fuera de pantalla |
| **Un solo contexto WebGL** | 1 canvas; con la hoja abierta el orbe deja de renderizar |
| **Alcance** | Cero dependencias, cero migraciones, cero `supabase/**` |

## Una imprecisión de vocabulario (no es orden)

El reporte dice que la hoja cerrada queda **`inert`**. En el DOM no hay
atributo ni propiedad `inert`: el aislamiento se logra con CSS
(`visibility`, `pointer-events`, traslación fuera de pantalla), y además el
estado difiere entre «nunca abierta» (`visibility: hidden`) y «cerrada tras
abrirse» (`visibility: visible`). **La propiedad exigida se cumple** — lo
verifiqué en ambos estados: no toma foco, no recibe eventos, no está en
pantalla. Pero conviene que el reporte diga el mecanismo real, para que un
stage futuro no confíe en un `inert` que no existe.

## Lo que sigue sin verificar (y ya es poco)

Declarado por Codex y confirmado por mí: la captura autenticada **desde la
UI** de punta a punta, el swipe ascendente con dedo real, los fps, y la
secuencia autenticada completa de `router.refresh()`. Nota importante: el
**camino de escritura sí quedó probado** por el E2E a nivel de datos; lo que
falta es el último tramo de navegador con sesión. Sigue siendo material para
la pasada del founder, ya no para el circuito automático.

## Estado

**M4 ACEPTADO.** `stage-m-front` acumula M1+M2+M3+M4. El spec de M5 (voz y
aura reactiva) llega cuando el founder lo pida.
