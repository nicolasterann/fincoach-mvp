# M2_AUDIT — Ronda 1 · VEREDICTO: **ROJO**

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `ee5cd76`
- **Entrada:** `M2_REPORT.md` Ronda 1 (B1–B14 con B2 y B4–B11 marcadas
  honestamente como no verificables en su entorno — la enmienda al protocolo
  volvió a funcionar).
- **Método:** los tres gates re-corridos por mí + lectura del diff completo +
  ejecución en Chromium (M4 Pro, WebGL ANGLE/Metal, DPR 2, sin
  reduced-motion) forzando cuadros con capturas, más instrumentación
  independiente (contador propio de `getContext`, intercepción de
  `compileShader`/`linkProgram`, `isContextLost`).

**Resumen en una línea:** **el orbe vivo existe y es bueno** — el shader
compila, renderiza y las materias se distinguen —, pero **el control de
calidad que yo mismo exigí mata el orbe al usarlo, y el panel de telemetría
reporta ceros que contradicen el estado real**. Dos órdenes bloqueantes, las
dos sobre lo mismo: *el instrumento de auditoría miente*.

---

## Lo verificado VERDE (por ejecución, no por lectura)

| | Cómo lo probé |
|---|---|
| **Gates** | Corridos por mí: `lint` **0 errores**, `build` **exit 0** (compilado + TypeScript), captura **826/826**. Cero dependencias nuevas, cero migraciones. B14 ✓ |
| **B1 · un solo contexto** | **1** `<canvas>` en el DOM (no cinco) y un único sitio de `getContext` en el código; los otros cuatro slides siguen con `StaticOrb` |
| **El orbe ARRANCA** | Carga limpia: `data-quality-tier="3"`, contexto **vivo**, buffer **798×798** con **DPR 2** aplicado. El shader compila y dibuja |
| **B2 · materias (parcial)** | Verificado en pantalla: **Saldo = agua viva** (menisco curvo con brillo de lámina, cuerpo volumétrico, motas suspendidas, domo de vidrio sobre la línea) y **Patrimonio = núcleo de cristal facetado suspendido, de tamaño fijo, sin lámina** — D‑M2.2 respetada. No pude capturar Reserva/Metas/Deuda antes de que el entorno dejara de componer cuadros |
| **B3 · niveles** | El nivel llega del payload; `null` sigue sin lámina donde M1 lo dejó null |
| **B11 · pausa (mitad)** | Verificado de forma natural: mi pestaña está oculta y el bucle no dibuja ni un cuadro |
| **B13 · arrastres** | **m1 ✓** el copy de Patrimonio en día‑1 ya coincide con producción · **m3 ✓** fixture negativo: «−420$ · Patrimonio total», sin lámina y **sin rojo de alarma** · **m2 ✓** el control QA (44×44, y=8..52) queda *encima* de la fila de tabs (y=52), sin taparla |
| **B12 · no-regresión de M1** | Los cuatro taps con paridad total posición/slide/tab/acento/cifra (Metas 750/260$ · Deuda 1500/760$ · Reserva 375/1.200$ · Saldo 0/82,40$). M2 tocó bastante el carrusel y **no lo rompió** |
| **Escalera (lógica)** | Leída y correcta: ventanas de 60 cuadros, mediana >20 ms dos veces ⇒ baja, ventana reseteada, histéresis 30 s/13 ms, una sola subida por sesión. **Detalle fino y acertado:** los cuadros en idle se excluyen de la ventana de calidad — si no, la cadencia de 30 fps se leería como «lentitud» y degradaría sola |

---

## Órdenes BLOQUEANTES

### O1 · Cambiar de tier MATA el orbe, y el fallo se disfraza de degradación normal

**Reproducido en pestaña limpia, sin ningún parche mío:**

| | antes | después de tocar `?tier=2` |
|---|---|---|
| elemento canvas | — | **el mismo** |
| contexto perdido | `false` | **`true`** |
| `data-quality-tier` | `3` | **`0`** |

**Causa exacta:** `orb-shader.ts:419` — `dispose()` llama
`WEBGL_lose_context.loseContext()` sobre un canvas que **React reutiliza**.
El efecto depende de `[forcedTier]`, así que al cambiar el tier corre su
cleanup (envenena el canvas) y la re-inicialización siguiente pide un
contexto sobre ese mismo elemento: llega **ya perdido**. Lo confirmé
interceptando la app: `getContext` devolvió `{ok:true, perdido:true}` y el
`compileShader` posterior dio `ok:false` con `infoLog` nulo y `getShaderSource`
vacío — la firma inconfundible de compilar sobre un contexto muerto. **El
shader NO está roto: no lo dejan compilar.** No reescribas GLSL.

**Por qué bloquea:** deja B7 y B8 —la escalera y sus controles, que son *todo*
lo que M2 aporta como garantía de rendimiento— imposibles de auditar: al
segundo tier que mires, ya estás viendo el estático. Y el fallo se presenta
como «tier 0», indistinguible de una degradación legítima.

**Responsabilidad mía:** `M2_SPEC §3.1` pedía textualmente llamar
`WEBGL_lose_context` en la limpieza. **Ya está corregido en el spec.** La
regla nueva: `loseContext()` sólo es admisible sobre un canvas que se va con
el componente; jamás sobre uno que la próxima inicialización va a reutilizar.
Suelta la referencia (el navegador recolecta el contexto) o fuerza un
elemento `<canvas>` nuevo en cada init (por ejemplo con `key`). Y el arreglo
tiene que ser **estructural**: que un re-init no *pueda* heredar un canvas
muerto.

### O2 · El panel de rendimiento reporta ceros que contradicen la realidad

En la **misma** carga en que el DOM decía tier 3, contexto vivo, buffer
798×798 y DPR 2, el panel mostraba:

> `tier 0 · pausado · fps 0.0 · frame p50 0.0 ms · p95 0.0 ms · DPR 1.0 · 0 px · contextos vivos 0`

Porque la telemetría **sólo se publica desde dentro del bucle**, y si el bucle
todavía no corrió un cuadro (pestaña oculta, orbe fuera de viewport, o
simplemente el primer instante) el panel enseña su estado inicial **como si
fuera una medición**. Eso es exactamente el pecado que este proyecto no
tolera: «no medí» presentándose como «medí y da cero». Además fue lo que me
hizo perseguir un fantasma durante media auditoría.

**Qué hacer:** que el panel distinga **«sin datos todavía»** de un valor
medido (guion, «—», lo que quieras, pero nunca un 0 que parece dato), y que
`tier`, `contextos vivos`, `DPR` y `píxeles` se lean del **estado real**
(existe renderer, existe contexto, tamaño del buffer), no de una foto que
sólo se refresca dentro del `draw`. Si el bucle está pausado, dilo con esas
palabras y con el motivo (`oculto` / `fuera de viewport` / `tier 0`).

---

## No bloqueante

- **n1 · Canvas 1×1 en una carga.** En una de las cargas con `?tier=3` el
  buffer quedó en `1×1` (el `resize` corrió antes de que el elemento tuviera
  layout). Con O1 arreglado, revisa que el primer `resize` ocurra ya con
  medidas reales (o re-mida en el primer cuadro).

---

## Lo que NO pude verificar, y por qué (dilo también en tu reporte)

Mi entorno no compone cuadros de forma sostenida: la pestaña está
permanentemente `document.hidden`, `requestAnimationFrame` **no corre**
(medido: 0 callbacks en 800 ms) y las capturas sólo fuerzan cuadros sueltos.
Por eso quedan **sin verificar por nadie todavía**:

- **fps reales y la escalera en movimiento** (B7): sólo pude auditar su lógica.
- **La ceremonia del amanecer** (B4), **capturando/escrito/cruce** (B6, B5) y
  las transiciones: son animaciones en el tiempo.
- **reduced-motion** (B9) y **ausencia de WebGL** (B10) end-to-end.
- **Presupuesto en gama media**: nadie de este circuito puede sustituir un
  Android real.

**Recomendación al founder** (no es orden a Codex): tras el arreglo de O1/O2,
cinco minutos en tu propio navegador —que sí es visible— recorriendo
`?tier=0..3`, los ocho estados y el amanecer, y una pasada en tu teléfono
real. Es la única forma de cerrar esa mitad con evidencia.

---

## Qué NO cambia

La arquitectura de M2 está bien: un solo contexto, canvas persistente con
crossfade sobre el estático, uniforms idénticos al mock a través de tres
programas, la lógica de la escalera y la API imperativa para M4/M5. Las dos
órdenes son de **lifecycle** y de **honestidad del instrumento**, no de
diseño ni de shader.

## Estado

**M2 NO aceptado.** Corrige O1 y O2 (y n1 si es barato), entrega Ronda 2 con
la evidencia que tu entorno permita, y vuelvo a ejecutar. Cuando O1 esté
cerrado, el propio harness pasa a ser auditable y podré cubrir buena parte de
lo que hoy quedó en el aire.

---

# M2_AUDIT — Ronda 2 · VEREDICTO: **VERDE CONDICIONADO**

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `b084433`
- **Entrada:** `M2_REPORT.md` Ronda 2 (O1, O2 y n1 respondidas).
- **Método:** los tres gates re-corridos por mí + ejecución en Chromium con
  instrumentación independiente (`isContextLost`, identidad del elemento
  canvas, conteo de contextos, comparación de cifras entre tiers).

**Las dos órdenes bloqueantes están cerradas y probadas moviendo la app.**
M2 queda aceptado por el lado de la auditoría, con una reserva explícita
(§Condición) sobre lo que este entorno no puede medir.

## O1 · CERRADA — el tier ya no mata el orbe

Recorrido `tier=3 → tier=2 → tier=1` en pestaña limpia:

| paso | contexto perdido | tier en el DOM | contextos vivos | canvas nuevo |
|---|---|---|---|---|
| carga `tier=3` | `false` | 3 | 1 | — |
| cambio a `tier=2` | `false` | 2 | 1 | **sí** |
| cambio a `tier=1` | `false` | 1 | 1 | **sí** |

Las dos defensas están puestas y son estructurales: `dispose()` ya no llama
`loseContext` (**cero apariciones de `loseContext`/`lose_context` en todo el
shell**) y el tier forzado forma la `key` de `LiveOrb`, así que un cambio de
tier monta un **elemento canvas nuevo** y no puede heredar uno muerto.

**B1 completo, incluida la fuga:** normal ⇒ 1 contexto / 1 canvas; en niebla
(el componente se desmonta) ⇒ **0 contextos / 0 canvas**, y el panel dice
`estado fog`; al volver ⇒ **1**, nunca 2. El contexto se libera de verdad.

## O2 · CERRADA — el panel dice la verdad

Con la pestaña oculta y **cero cuadros dibujados**, el panel reporta ahora:

```
tier 3 · pausado: oculto | fps — | frame p50 — ms · p95 — ms
DPR 2.0 · 636,804 px | contextos vivos 1 | estado available
```

Es exactamente lo pedido: el tier, el contexto y el buffer salen del estado
real (798×798 = 636.804 px con DPR 2), lo no medido se muestra como `—` y
jamás como 0, y la pausa dice **su motivo**. Vi tres motivos distintos en
vivo (`oculto`, `inicializando`, `tier 0`), lo que hace el instrumento
diagnosticable en vez de mudo.

## n1 · CERRADA

El buffer nace sin medir y converge a 798×798 real; no reaparece el 1×1.

## Lo demás que verifiqué en esta ronda

- **Gates (por mí):** `lint` **0 errores**, `build` **exit 0**, captura
  **826/826**.
- **B7 · la calidad no toca el dinero:** las cinco cifras son **idénticas**
  en tier 3 y en tier 1 (`82.40$ · 1,200$ · 260$ · 3,480$ · 760$`).
- **B2 · materias y tiers se distinguen en pantalla:** tier 3 Saldo = agua
  viva con menisco curvo, brillo de lámina, cuerpo volumétrico y motas
  suspendidas bajo un domo de vidrio; Patrimonio = núcleo de cristal
  facetado suspendido, tamaño fijo, sin lámina; **tier 1** = líquido plano
  con onda simple, visiblemente más barato y sin raymarch. La escalera
  cambia el acabado sin tocar la verdad.
- **B12 · no-regresión:** el carrusel conserva la paridad de M1.
- **B13 · arrastres m1/m2/m3:** cerrados.

## Condición para el merge (no es una orden a Codex)

Una parte de M2 **no la ha verificado nadie todavía**, y no por descuido: en
este entorno la pestaña vive en `document.hidden`, `requestAnimationFrame` no
corre y las capturas sólo fuerzan cuadros sueltos. Queda sin comprobar:

1. **fps reales y la degradación automática en movimiento** (sólo audité su
   lógica: ventanas de 60, mediana >20 ms dos veces, histéresis, y el acierto
   de excluir los cuadros en idle de la ventana de calidad).
2. **La ceremonia del amanecer** y las transiciones **capturando / escrito /
   cruce**.
3. **reduced-motion** y **ausencia de WebGL** de punta a punta.
4. **El presupuesto en un Android de gama media** — nadie de este circuito
   puede sustituir un teléfono real.

**Recomiendo al founder** una pasada de cinco minutos en su propio navegador
(que sí compone) y una en su teléfono, con esta lista corta:
`?tier=0..3` (que el orbe sobreviva y se note la diferencia) · `?state=`
amanecer (sube una vez y no se repite al recargar), capturando (el nivel
**no** se mueve), escrito (baja al nivel entregado), cruce · el modo sin
animación del sistema · y mirar el panel con `?perf=1` para ver fps reales.
**Con eso M2 queda cerrado del todo; sin eso, se mergea asumiendo ese riesgo
declarado.**

## Nota menor (para M3, no bloquea)

Con `?perf=1` el panel se superpone al recibo y al dock en 375 px. Es una
superficie de desarrollo y sólo aparece con el flag, pero conviene moverlo
cuando M3 toque esa zona.

## Estado

**M2 ACEPTADO** por la auditoría. `stage-m-front` puede mergearse cuando el
founder complete (o asuma) la §Condición. El spec de M3 llega cuando lo pida.
