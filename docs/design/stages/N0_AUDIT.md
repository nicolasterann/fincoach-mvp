# N0_AUDIT — La regla y el metro

> Auditoría **en frío**. Este chat no vio la conversación del implementador.
> Entró con `stages/N0_SPEC.md`, `stages/N0_REPORT.md` y el código.
> Rama `stage-n-acabado`, cortada de `main` @ `5068176`. Sin commits.
> Protocolo: `docs/design/README.md` §«Ciclo de una etapa Nn».

---

## Veredicto

# ✅ VERDE

Los doce criterios A1–A12 se cumplen y **los verifiqué corriéndolos yo**, no
leyendo el reporte. El reporte del implementador resultó **factualmente exacto
en todo lo que comprobé**: no encontré una sola cifra inflada ni una casilla
declarada verde sin evidencia. Las cinco cosas que dice no haber verificado,
efectivamente no se pueden verificar en este entorno — y una de ellas la cerré
a medias yo (ver §4).

Encontré **un defecto real**, y es de durabilidad, no de veracidad: la regla del
§4.1 —la que existe para atar a N1–N7— se puede esquivar escribiendo debajo de
un comentario. Lo demuestro por mutación en §5. No invalida ningún criterio (A2
está redactado con alcance de región y ese alcance se cumple), pero sí debilita
lo que N0 promete ser. Sale como **orden O1**, a pagar antes de que N1 escriba
su primera línea de CSS.

---

## 1. Lo que corrí yo mismo

Los tres gates, en este árbol, sin tocar nada:

```
$ node scripts/qa/run-capture-gate.mjs
860/860 capture checks                                        (exit 0)

$ npm run lint
✖ 8 problems (0 errors, 8 warnings)                           (exit 0)
   → los 8 son PREEXISTENTES y viven en
     scripts/qa/m0-loop-122-e2e.mjs (6) y m0-loop-123-e2e.mjs (2),
     todos no-unused-vars. Cero en archivos de N0. Confirmado leyendo la
     salida completa, no el resumen.

$ npm run build
BUILD EXIT=0
   → 1 warning, preexistente (traza NFT de Turbopack por los readFileSync de
     /dev/capture-test). Ningún error de Suspense por `useSearchParams`.
```

**Y verifiqué la línea base por ejecución**, que es la mitad que el reporte
podía estar afirmando de memoria. Restauré `capture-test/page.tsx` a su versión
de `HEAD` (sin las seis aserciones N0) dejando el resto del árbol intacto:

```
=== BASELINE (capture-test @ HEAD) ===
854/854 capture checks
```

854 → 860 = **exactamente seis nuevas**. Y `git diff --numstat` sobre ese
archivo da `308  0` — **308 líneas añadidas, cero borradas**: ninguna aserción
anterior fue removida ni pudo ser relajada. **A10 verificado.**

---

## 2. Criterio por criterio, con mi propia evidencia

### A1 · Los tokens ✅

No leí la hoja: medí `getComputedStyle(document.documentElement)` sobre
`/dev/shell-preview` y sobre un subárbol `[data-theme="light"]` real.

Mi primera pasada marcó **siete tokens como discrepantes**. Re-medí antes de
acusar y los siete eran mi normalizador, no el código: el navegador serializa
`180ms` como `.18s` y `rgba(0,0,0,0.5)` como `#00000080`. Comparados
numéricamente:

```
durCheck   90ms/90 · .18s/180 · .32s/320 · .62s/620        → 4/4 ok
curveCheck (.22,.61,.24,1) (.5,0,.2,1) (.2,.9,.3,1.06)     → 3/3 ok
alphaCheck #00000080 → α=0.5019 (want .5) · #000000eb → α=0.9216 (want .92)
allOk: true
empty: []      lightEmpty: []
lightDiff: ["--kipu-el-1", "--kipu-el-2"]     ← sólo las dos sombras
```

Los 26 tokens resuelven en ambos temas, ninguno queda vacío, y el tema claro
re-declara **únicamente** la elevación. Coincide con lo reportado.

### A2 · Cero duraciones literales ✅ (con el defecto de §5)

Medido **en el DOM**, con `.next` borrado y servidor limpio (la trampa #6 del
propio reporte):

```
chip        0.18s, 0.18s, 0.18s   cubic-bezier(0.22, 0.61, 0.24, 1)
dock        0.18s, 0.18s, 0.09s   idem
pill        0.18s                 idem
orbe        0.18s   (anim 23s)    idem
santuario   0.62s, 0.62s          idem
atmósfera   0.62s   (anim 27s)    idem
```

Toda respuesta cae en 90/180/320/620 con **una sola curva**; lo ambiental
conserva 23 s y 27 s. Dentro de las cuatro regiones marcadas: **0 literales**.

Revisé además las **21 líneas borradas** de `globals.css`: son exactamente las
declaraciones con duración literal más las dos definiciones de
`--kipu-shell-shadow` (ahora derivadas de `--kipu-el-2`). No se borró nada
estructural.

Y comprobé el riesgo de corrección que esas 21 líneas escondían: el
`step-end` de `visibility` en `.kipu-dialog-backdrop` **sigue puesto**
(`transition: opacity var(--kipu-t-move) var(--kipu-e-out), visibility
var(--kipu-t-move) step-end`). Cambiarlo por una curva habría sido una
regresión silenciosa. No ocurrió. Además el reporte tiene razón en que esto
corrigió un desfase real: la visibilidad se apagaba a 280 ms mientras la hoja
viajaba hasta 340 ms; ahora ambas son 320 ms.

### A3 · `tabular-nums` en toda cifra ✅

Recorrido del DOM, no de la hoja: todo elemento del santuario con un nodo de
texto que contenga un dígito, y su estilo computado.

```
rootFVN: "tabular-nums"   conDigitos: 13   sinTabular: 0   badList: []
82.40$ · 1,200$ · 260$ · 3,480$ · 760$ · −4.50$ · 14:20 · 72%×5 · «Gasté 12 en al…»
```

Trece de trece. La herencia desde la raíz funciona, incluidas las cifras que no
son dinero (72 %, 14:20) — que es lo correcto.

### A4 · Cinco estados, cuatro formas, un módulo ✅

En el DOM de `/dev/sistema?seccion=estados`:

```
states: 20   kinds: [cargando, vacio, sin-dato, sin-senal, error]
             shapes: [orbe, tarjeta, linea, hoja]
```

20 = 5 × 4. Y `index.ts` es de verdad la única puerta: re-exporta los cinco
componentes **y** el contrato puro entero.

Visualmente confirmé lo que el §5 pide de `cargando`: el esqueleto del orbe es
**un círculo del tamaño del orbe**, no una barra redondeada.

### A5 · `vacío` ≠ `sin dato` ✅ — verificado a simple vista

Miré las dos capturas yo mismo en `/dev/sistema?seccion=duelo`. Son
inconfundibles:

| | Vacío | Sin dato |
|---|---|---|
| Silueta | círculo **relleno**, borde continuo | círculo **punteado**, sin relleno |
| Cifra | **`0`** en tinta viva | **`—`** en tinta apagada |
| Marca | gota con menisco, en acento | círculo tachado, gris |
| Salida | invitación en acento | botón **Reintentar** |

El eje que más importa se sostiene: **el vacío enseña un cero medido; el
sin-dato jamás enseña un número.** Es la doctrina monetaria del proyecto hecha
visual, y se lee sin explicación.

### A6 · `formatMetric` ✅ — muerto por mutación propia

Ver **AUD-M2** en §5. No lo leí: lo rompí y el gate lo mató.

### A7 · El overlay `?metro=1` ✅

En el navegador, dos cargas limpias:

```
/dev/sistema          → [data-metro] = 0   y /kipu-metro/ NO aparece
                        en document.documentElement.outerHTML
/dev/sistema?metro=1  → present: true · pointer-events: none
     TTFB 47 ms [bueno] | LCP — [sin-medir] | INP — [sin-medir] | CLS — [sin-medir]
     servidor: contexto — · hilo — · briefing — · resto — · total —
     cola: cliente — · preferencias — · cotizaciones — · historia — · movimiento — · recibo —
```

Sin el parámetro el panel no está ni en el HTML servido ni tras hidratar. Con
él, lo medido sale como número con veredicto y **todo lo no medido sale `—`,
nunca `0`**.

### A8 · `Server-Timing` con un tramo por await ✅ (con la desviación D1, verificada)

El pin tiene dientes: lo maté con **AUD-M3** (§5). Nueve tramos + `total`, uno
por cada `await`, con un único `await` suelto (`supabase`, dentro del callback
del tramo `movimiento`).

**Verifiqué la desviación D1 en vez de creerla.** La afirmación del reporte es
que Next 16 no le da a un Server Component ninguna forma de escribir una
cabecera de respuesta. Es cierta:

```
node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md
 :34  `headers` returns a **read-only** Web Headers object.
 :47  Since `headers` is read-only, you cannot `set` or `delete` …

$ node -e "console.log(Object.keys(require('next/server')))"
NextRequest, NextResponse, ImageResponse, userAgentFromString,
userAgent, URLPattern, after, connection
```

No hay API de escritura de cabeceras para RSC. La desviación es **forzada, no
elegida**, y está declarada. Ver **O3**.

### A9 · El santuario no cambió de comportamiento ✅

Los cinco taps, a **375 × 812 con `innerWidth = 375` confirmado** (la trampa
§8.2/§8.5 que el propio reporte pagó).

**Mi primera medición dio un desfase que parecía una regresión** —`slide`
atrasado una posición y la cifra alternando `null`—. Antes de acusar inspeccioné
la estructura real: `querySelectorAll('[data-orb-kind]')` devuelve **las slides
y los orbes intercalados**, más un `.kipu-live-orb` fuera del track. El defecto
era mi sonda. Re-medido contra `track.children`:

```
Saldo      · pos=0 · slide=saldo      · chip=0 · capa=saldo      · acento=#4fead2 · nudo=0 · cifra=82.40$
Reserva    · pos=1 · slide=reserva    · chip=1 · capa=reserva    · acento=#87abff · nudo=1 · cifra=1,200$
Metas      · pos=2 · slide=metas      · chip=2 · capa=metas      · acento=#c0a2ff · nudo=2 · cifra=260$
Patrimonio · pos=3 · slide=patrimonio · chip=3 · capa=patrimonio · acento=#bfe6f8 · nudo=3 · cifra=3,480$
Deuda      · pos=4 · slide=deuda      · chip=4 · capa=deuda      · acento=#ffbd8e · nudo=4 · cifra=760$

paridad: true
```

Paridad total, y **las cinco cifras son las que fijó la auditoría de M2**.

### A10 · Gates ✅ — ver §1.

### A11 · Mutación con dientes ✅ — ver §5. Reproduje el espíritu con tres mías.

### A12 · Alcance ✅

```
$ git status --porcelain | grep -E 'package(-lock)?\.json'        → (vacío)
$ git status --porcelain | grep -E 'supabase/|src/lib/financial/|src/lib/ai/|migrations'
                                                                  → (vacío)
```

Los únicos imports no locales en los archivos nuevos son `react`, `next/*` y
`node:fs`. **Cero dependencias nuevas.** `AGENTS.md`, `CLAUDE.md`,
`docs/ROADMAP.md` y `docs/design/README.md` llegaban sucios de la apertura del
Bloque N, como dice el reporte.

---

## 3. Estado del árbol al terminar

Revertí todo lo que toqué y lo comprobé:

```
$ grep -c "kipu-shell-audit-probe" src/app/globals.css        → 0
$ grep -n "found.ms : null" src/lib/metro/metro-contract.ts   → 78: … : null;
$ grep -n 'metro.timed("historia"' shell-payload.ts           → 255: …
$ node scripts/qa/run-capture-gate.mjs                        → 860/860
```

`git status` idéntico al de antes de la auditoría.

---

## 4. Lo que cerré yo del «No verificado» del reporte

El punto 1 del reporte dice, con razón, que **nadie ha visto todavía la cadena
`Server-Timing` con números reales**, porque `/app` necesita sesión autenticada
y este entorno tampoco tiene credenciales de QA.

Cerré **la mitad que sí se puede cerrar sin tocar datos**: inyecté
temporalmente una cadena realista de diez tramos en el payload de
`/dev/shell-preview` y la hice viajar por el cableado real hasta el overlay.

```
inyectado: "contexto;dur=412.7, cliente;dur=3.1, preferencias;dur=88.4,
            hilo;dur=196.2, briefing;dur=310.5, cotizaciones;dur=22.8,
            historia;dur=41.3, movimiento;dur=29.6, recibo;dur=17.2,
            total;dur=1121.8"

renderizado: servidor  contexto 413 ms · hilo 196 ms · briefing 311 ms
                       resto 202 ms · total 1122 ms
             cola      cliente 3 ms · preferencias 88 ms · cotizaciones 23 ms
                       historia 41 ms · movimiento 30 ms · recibo 17 ms

resto esperado = 1121.8 − (412.7 + 196.2 + 310.5) = 202.4  ✓
```

Los diez tramos llegan, se leen y `resto` se **deriva correctamente**.
Revertido después.

**Qué queda abierto de verdad:** que `buildShellPayload` produzca esa cadena en
una corrida real con sesión. El instrumento de lectura ya está probado; falta el
de escritura. Es la **orden O3**.

También fui un paso más allá del punto 3 del reporte (`prefers-reduced-motion`
no ejercido). No pude ejercer el media query, pero sí verifiqué que la regla
**se sirve**, que es donde el propio reporte aprendió a mirar (lección #6).
Extraje el bloque de la **hoja servida** por `fetch`, no del archivo:

```
ocurrencias de prefers-reduced-motion: 2
  #1  len 84    (no-preference, de Tailwind)
  #2  len 1010  reduce → contiene .kipu-state__bone ✓ .kipu-shell-orb ✓ .kipu-santuario ✓
```

(Mi primer intento dijo `false` porque miré sólo 2 200 caracteres desde la
**primera** ocurrencia, que es la de Tailwind. Re-medir lo corrigió.)

---

## 5. Mis mutaciones

Tres propias, distintas de las tres del reporte. Cada una aplicada, medida y
revertida por un arnés que restaura el archivo pase lo que pase.

**AUD-M2 — «no medí» disfrazado de cero, en la mitad del metro.**
`segmentMs` devuelve `0` en vez de `null` para un tramo ausente:

```
### AUD-M2 :: GATE EXIT 1
✗ N0-6 · una medición que no ocurrió se escribe — y jamás 0; un tramo nombrado
         por cada await del santuario
859/860 capture checks
```

**AUD-M3 — un `await` del santuario sin tramo.** Des-instrumenté `historia`:

```
### AUD-M3 :: GATE EXIT 1
✗ N0-6 · …
   {"tramos":[contexto,cliente,preferencias,hilo,briefing,cotizaciones,movimiento,recibo],
    "awaitsSinTramo":["loadSnapshotSeriesRead(userId,","supabase"]}
859/860 capture checks
```

Las dos matan **una aserción con nombre**, no el compilador. El pin de A8 tiene
dientes de verdad: si N1 saca el hilo de la pantalla de inicio, `N0-6` cae y
obliga a declararlo.

### AUD-M1 — la que encontró el defecto

Pegué una regla de santuario con **dos duraciones literales de respuesta** una
línea debajo del último marcador, fuera de las cuatro regiones:

```css
/* N0 · FIN REGION SISTEMA */

.kipu-shell-audit-probe {
  transition: opacity 0.7s ease, transform 0.43s linear;
}
```

```
### AUD-M1 :: GATE EXIT 0
860/860 capture checks
```

**Pasa.** La regla de oro del §4.1 —«ninguna transición o animación de respuesta
puede declarar una duración literal»— está implementada como **rango de líneas
entre comentarios**, no como **espacio de nombres de selector**. Escribir debajo
del comentario la esquiva.

No es hipotético: el archivo **ya tiene** selectores `.kipu-shell-*` y
`.kipu-dialog-*` fuera de las regiones (el bloque `prefers-reduced-motion`,
líneas ~1929–1938). Hoy son inofensivos porque sólo declaran `none`, pero
demuestran que la forma que el defecto necesita ya existe en el archivo.

Hay una segunda rendija, más chica, en la misma regla: `N0-2` exige un
`--kipu-t-breath-*` a toda animación `infinite`, pero **no prohíbe lo inverso**
— una animación de respuesta (sin `infinite`) que use un token ambiental de 2,8 s
pasaría el gate y quedaría fuera de la escala. Hoy no ocurre; lo comprobé:

```
breath tokens sobre animaciones NO-infinite dentro de las regiones: (ninguna)
```

**Por qué esto no es ROJO:** A2 está redactado con alcance explícito («dentro de
la región del santuario»), y ese alcance se cumple — lo medí. El gate además
**falla cerrado** en todo lo demás que probé: región vacía ⇒ falla; marcador
borrado ⇒ falla; bloque de tokens ausente ⇒ falla; cuerpo de `buildShellPayload`
irreconocible ⇒ falla. El instrumento **no miente sobre lo que mide**; mide un
dominio más chico del que la promesa del §1 necesita. Eso es una orden, no un
rechazo.

---

## 6. Órdenes

### O1 — Atar la regla al selector, no a la línea *(antes de la primera línea de CSS de N1)*

`N0-2` debe barrer **toda** `globals.css` buscando reglas cuyo selector caiga en
el espacio de nombres del santuario y del sistema
(`.kipu-santuario`, `.kipu-shell-*`, `.kipu-dialog-*`, `.kipu-orb-*`,
`.kipu-state-*`, `.kipu-metro*`), esté donde esté en el archivo, y exigirles la
escala. Las regiones marcadas pueden quedarse como documentación; dejan de ser
la definición. Excluir explícitamente el bloque `prefers-reduced-motion`, que
declara `none` a propósito.

En la misma pasada, cerrar la rendija inversa: **un token `--kipu-t-breath-*`
sólo es legal en una declaración con `infinite`.**

La prueba de que quedó hecho es que **AUD-M1 falla**: pegar
`.kipu-shell-audit-probe { transition: opacity 0.7s ease; }` al final del
archivo debe romper `N0-2` por nombre.

### O2 — `N0-3` prueba orden de aparición, no contención

La aserción comprueba que `kipu-shell-amount`, `kipu-shell-cinta__amount`,
`kipu-shell-pill` y `kipu-dialog-receipt-jump` aparecen **después** de
`className="kipu-santuario"` en el **texto fuente**. Eso no es contención en el
DOM. Una hoja futura montada por portal a `document.body` quedaría fuera del
`<main>`, perdería la herencia de `tabular-nums`, y `N0-3` seguiría verde.

Hoy el DOM está bien —lo medí, 13/13—. Endurecerlo cuando N3/N4 toquen la hoja:
lo natural es que el propio `/dev/sistema` (o `/dev/shell-preview`) afirme la
contención en el DOM y que el gate exija esa afirmación.

### O3 — Tomar la línea base real del metro **antes** de mover nada, y cerrar D1

Dos cosas, en este orden:

1. Abrir `/app?metro=1` con sesión real en el teléfono del founder y
   **fotografiar la primera medición**. Los diez tramos con números. Esa foto
   es el «antes» contra el que se mide «−4 viajes, −348 kB». Tomarla **antes**
   de tocar el hilo, no después. La mitad de lectura ya está probada (§4); lo
   que falta es ver escribir a `buildShellPayload`.
2. Decidir la cabecera HTTP. Verifiqué que hoy es imposible desde un Server
   Component, y que el archivo de sesión de N1 corre **antes** del render, así
   que tampoco sirve. O se acepta el cuerpo del payload como portador
   permanente y **se corrige la redacción del A8 del spec** para que no siga
   leyéndose como que viaja una cabecera, o se decide aparte. Lo que no puede
   quedar es la ambigüedad.

### O4 — `payload.serverTiming` viaja a todos los clientes, siempre

`SantuarioShell` recibe la cadena y se la pasa a `MetroOverlay` en cada carga,
haya o no `?metro=1`. Son ~150 bytes: ruido frente a los 348 kB que N1 va a
quitar, y ningún dato financiero. Pero N1 es precisamente la etapa que audita lo
que viaja en la respuesta inicial, así que **que sea una decisión y no un
descuido**. Nota lateral: `?metro=1` no está limitado a desarrollo — cualquier
usuario que adivine el parámetro ve el panel. Es exactamente lo que pidió el
§6.2 (el founder lo necesita en producción), así que lo dejo dicho, no ordenado.

### O5 — Las veinte duraciones normalizadas son cambio visible; que las mire el founder

El §2 prohíbe cambiar el comportamiento visible «salvo un valor atípico
corregido», y el reporte declara las veinte con honestidad. Pero algunas no son
sutiles y este bloque entero trata de cómo se siente:

| | Antes | Ahora | Δ |
|---|---|---|---|
| `.kipu-shell-pill` (aparece/desaparece) | 350 ms | 180 ms | **−49 %** |
| `.kipu-shell-cord__knot` | 350 ms | 180 ms | −49 % |
| `.kipu-shell-cinta` (entra) | 500 ms | 320 ms | −36 % |
| `.kipu-santuario` (fondo) | 900 ms | 620 ms | −31 % |
| `.kipu-santuario` (color) | 450 ms | 620 ms | **+38 %** |
| `.kipu-shell-dock__circle` (transform) | 150 ms | 90 ms | −40 % |

Es el efecto buscado de A2 y no lo objeto. Pero **la aprobación de esto es del
founder en su teléfono**, no de un gate: es justamente el tipo de juicio que el
Bloque M aprendió a no delegar en un entorno que no compone cuadros.

---

## 7. Lo que este entorno no pudo verificar

Declarado, no disimulado. Coincide con el reporte salvo donde avancé (§4).

1. **`/app` con sesión real.** Sin credenciales de QA. No creé una persona
   desechable: N0 por diseño no toca datos, y escribir en producción para
   auditar una etapa que no escribe habría sido peor que la duda. → **O3**.
2. **LCP, INP y CLS.** El panel vive en `document.visibilityState === "hidden"`
   (lo confirmé: `vis: "hidden"`), así que esas tres nunca disparan. Lo que sí
   queda probado es la mitad que le importa a N0: sin medición, `—` y veredicto
   `sin-medir`. TTFB sí midió (47 ms, verde) y prueba la otra mitad.
3. **`prefers-reduced-motion` ejercido.** Verifiqué que la regla **se sirve** y
   cubre `.kipu-state__bone` (§4), pero no emulé el media query.
4. **fps, amanecer, gestos, densidad y la PWA instalada.** Hardware. Como cerró
   el Bloque M: quien no puede componer cuadros no puede verificar lo visual.

**Nota de método, por segunda y tercera vez en este bloque:** dos de mis propias
mediciones iniciales acusaron defectos inexistentes —el desfase del carrusel
(sonda mal indexada) y el `prefers-reduced-motion` ausente (ventana de búsqueda
corta)—. Re-medir las tumbó a las dos. La trampa §8.5 del spec sigue siendo la
más cara del entorno, y ahora tiene dos casos más.

---

## 8. Correcciones al reporte

**Ninguna factual.** Comprobé sus números uno por uno (854, 860, 26 tokens, 13
cifras tabulares, 20 estados, 9 tramos, las cinco cifras del carrusel, los 8
warnings de lint, el exit 0 del build, la cita de la doc de Next) y todos son
exactos. Las tres mutaciones que reporta se reproducen.

Un matiz, no un error: el A1 del reporte pega valores como `.18s` y `#00000080`
como si fueran los del spec. Lo son —numéricamente— pero conviene saber que es
la serialización del navegador; el §2 de este audit deja la comparación
numérica hecha para que nadie la repita a mano.

---

## 9. Addendum — O1 pagada y probada (2026-08-28, mismo día)

El founder decidió pagar **O1 antes del commit**, para que N0 entre completo en
vez de arrastrar la deuda a N1. Hecho y verificado por mutación.

**Qué cambió:** `N0-2` deja de atar la escala de movimiento por **rango de
líneas entre comentarios** y pasa a atarla por **selector**. Recorre
`globals.css` **entera** llevando el selector envolvente, y a toda regla del
espacio de nombres del santuario y del sistema
—`.kipu-santuario · .kipu-shell-* · .kipu-dialog-* · .kipu-orb-* · .kipu-live-orb
· .kipu-perspective-* · .kipu-state · .kipu-metro · .kipu-sistema*`— le exige la
escala, viva donde viva en el archivo.

Tres decisiones dentro del cambio:

- **La única exención es `prefers-reduced-motion`**, que declara `none` a
  propósito. Verifiqué antes de escribirlo que las 19 líneas del namespace que
  viven fuera de las regiones están **todas** en ese bloque.
- **Los `@keyframes` quedan fuera solos**: su selector interno es un porcentaje,
  no una clase. No hizo falta una regla especial.
- **Falla cerrado**: si el recorrido se rompe y no ve una sola regla,
  `n0MotionRules.length > 0` tumba la aserción. Un instrumento que no pudo mirar
  no autoriza.
- Los marcadores de región **se siguen exigiendo** como documentación: borrarlos
  falla igual. Dejaron de ser la definición, no dejaron de importar.

**Que no rompió nada:**

```
$ node scripts/qa/run-capture-gate.mjs
860/860 capture checks
```

**Que ahora tiene dientes** — las dos mitades, cada una revertida:

```
### AUD-M1 (re-corrida tras O1) :: GATE EXIT 1
✗ N0-2 · cero duraciones literales en TODO el namespace del santuario;
         lo ambiental usa --kipu-t-breath-* y sólo ahí
   {"reglasVistas":22,
    "literales":[".kipu-shell-audit-probe: opacity 0.7s ease, transform 0.43s linear"]}
859/860 capture checks
```

La misma mutación que **pasaba 860/860** hace una hora ahora cae por nombre, y
además **dice qué selector y qué literal** la rompió.

```
### AUD-M4 · token ambiental (2,8 s) en una animación de RESPUESTA :: GATE EXIT 1
✗ N0-2 · …
   {"ambientalMalNombrado":[".kipu-shell-dock__circle--recording:
      kipu-voice-button-pulse var(--kipu-t-breath-pulse) ease-in-out both"]}
859/860 capture checks
```

La puerta inversa también está cerrada: un `--kipu-t-breath-*` **sólo** es legal
en una declaración con `infinite`. Ya no se puede evadir la escala de cuatro
duraciones con un 2,8 s de nombre bonito.

**Lo que O1 deliberadamente NO amplió:** `transition-duration` y
`animation-duration` como propiedades sueltas, y `animation-delay`. El barrido
mira `transition:` y `animation:`, igual que antes — O1 era cerrar la escapatoria
que demostré, no ensanchar la regla por mi cuenta. Hoy ninguna regla del
namespace usa esas formas; si alguna etapa las introduce, es una línea más en el
mismo recorrido.

**Consecuencia para el spec de N1:** el criterio **B12** ya está cumplido antes
de empezar. Se deja escrito en `N1_SPEC.md` §5.6 como historia, no como trabajo
pendiente.
