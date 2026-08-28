# N0_REPORT — La regla y el metro

> Implementador. Contrato: `docs/design/stages/N0_SPEC.md`.
> Rama `stage-n-acabado`, cortada de `main` @ `5068176`. **Sin commits.**

---

## Ronda 1

### Lo que quedó construido

| Archivo | Qué pasó |
|---|---|
| `src/app/globals.css` | Bloque de tokens N0 en `:root` (§4 completo) · región del santuario convertida a tokens · `tabular-nums` en la raíz del santuario · CSS de los cinco estados, del metro y de `/dev/sistema` |
| `src/app/app/components/state/state-contract.ts` **(nuevo)** | Lógica **pura** de los cinco estados y de `formatMetric`. Sin `server-only` |
| `src/app/app/components/state/KipuState.tsx` **(nuevo)** | Los cinco componentes en sus cuatro formas |
| `src/app/app/components/state/index.ts` **(nuevo)** | El **único** módulo por el que se importan |
| `src/lib/metro/metro-contract.ts` **(nuevo)** | Lógica pura del metro: tramos, gramática `Server-Timing`, umbrales, «sin medir» |
| `src/app/app/components/metro/MetroOverlay.tsx` **(nuevo)** | El overlay `?metro=1` (ver Desviación D2) |
| `src/app/app/components/shell/shell-payload.ts` | **Sólo** instrumentación por tramo + el campo `serverTiming` |
| `src/app/app/components/shell/SantuarioShell.tsx` | Una línea: monta el overlay (ver Desviación D2) |
| `src/app/dev/sistema/page.tsx` **(nuevo)** | La superficie de aprobación |
| `src/app/dev/shell-preview/page.tsx` | Una línea: `serverTiming: null` en la maqueta (ver Desviación D3) |
| `src/app/dev/capture-test/page.tsx` | Aserciones N0-1…N0-6 |

`src/app/app/page.tsx` **no se tocó**: el pin M9-1 («un solo `return`, un solo
`redirect(`, y `return <SantuarioShell payload={payload} />;` literal») sigue
intacto y verde.

---

### A1 · Los tokens existen en `:root` con esos nombres, y el tema claro no los rompe

**Cómo:** (a) la aserción `N0-1` compara **nombre y valor exactos** de los 26
tokens del §4 contra el bloque `:root` real de la hoja, y exige que
`[data-theme="light"]` re-declare **sólo** la elevación; (b) en el navegador,
`getComputedStyle` sobre `<html>` (oscuro) y sobre un subárbol
`[data-theme="light"]` real de `/dev/sistema`.

```
860/860 capture checks        ← N0-1 verde
```

```json
{"temaClaroPresente": true,
 "vacios": [],
 "diferentes": ["--kipu-el-1", "--kipu-el-2"],
 "--kipu-t-instant": {"oscuro":"90ms","claro":"90ms"},
 "--kipu-t-quick":   {"oscuro":".18s","claro":".18s"},
 "--kipu-t-move":    {"oscuro":".32s","claro":".32s"},
 "--kipu-t-settle":  {"oscuro":".62s","claro":".62s"},
 "--kipu-e-out":     {"oscuro":"cubic-bezier(.22, .61, .24, 1)","claro":"idem"},
 "--kipu-e-in-out":  {"oscuro":"cubic-bezier(.5, 0, .2, 1)","claro":"idem"},
 "--kipu-e-settle":  {"oscuro":"cubic-bezier(.2, .9, .3, 1.06)","claro":"idem"},
 "--kipu-fs-body/label/micro": "15px / 13px / 11px en ambos",
 "--kipu-sp-1/-6": "4px / 36px en ambos",
 "--kipu-r-1/-full": "10px / 999px en ambos",
 "--kipu-el-0": {"oscuro":"none","claro":"none"},
 "--kipu-el-1": {"oscuro":"0 2px 10px -4px #00000080","claro":"0 2px 10px -4px #102a3c29"},
 "--kipu-el-2": {"oscuro":"0 18px 42px -20px #000000eb","claro":"0 16px 34px -18px #102a3c57"}}
```

Ningún token queda vacío en claro. Los **dos** que cambian son las sombras, a
propósito: una losa negra sobre papel blanco no es la misma elevación. El valor
claro no es inventado — es exactamente el que ya tenía `--kipu-shell-shadow` en
el tema claro, que ahora se deriva de `--kipu-el-2` en vez de duplicarlo.

---

### A2 · Cero duraciones literales en la región del santuario

**Cómo:** la hoja lleva marcadores `/* N0 · INICIO REGION X */ … /* FIN */` para
**cuatro** regiones (SANTUARIO, ESTADOS, METRO, SISTEMA). `N0-2` corta por esos
marcadores, saca toda declaración `transition:`/`animation:` y busca cualquier
literal `\d+(\.\d+)?m?s`. Además exige que **toda** animación `infinite` use un
`--kipu-t-breath-*`, y que las cuatro regiones **existan** (borrar un marcador
para pasar deja la región vacía y falla igual).

```
SANTUARIO: 36039 chars · literales 0 []
ESTADOS:    7219 chars · literales 0 []
METRO:      1622 chars · literales 0 []
SISTEMA:    ...        · literales 0 []
```

**Y además medido en el DOM**, que es más fuerte que leer la hoja — así se ve
que los `var()` resuelven de verdad:

```
chip       0.18s, 0.18s, 0.18s   / cubic-bezier(0.22, 0.61, 0.24, 1)
santuario  0.62s, 0.62s          / cubic-bezier(0.22, 0.61, 0.24, 1)
pill       0.18s                 / cubic-bezier(0.22, 0.61, 0.24, 1)
dock       0.18s, 0.18s, 0.09s   / cubic-bezier(0.22, 0.61, 0.24, 1)
orbe       0.18s                 / cubic-bezier(0.22, 0.61, 0.24, 1)
hoja       0.32s                 / cubic-bezier(0.22, 0.61, 0.24, 1)
ambientales (animation-duration): orbe 23s · halo 6s · atmósfera 27s
```

Toda respuesta cae en 90 / 180 / 320 / 620 ms con **una** curva. Lo ambiental
conserva su valor exacto bajo `--kipu-t-breath-float|halo|aura|pulse|skeleton`.

**Las 20 duraciones que se normalizaron** (esto es el «valor atípico corregido»
que el §2 del spec permite; ninguna otra cosa cambió de comportamiento):

| Antes | Ahora | Por qué |
|---|---|---|
| `.kipu-santuario` `0.9s / 0.45s ease` | `settle` (620ms) | el fondo se **acomoda** al cambiar de capa |
| `.kipu-shell-atmosphere` `0.9s` | `settle` | idem |
| `.kipu-shell-handle` `0.25s` | `quick` | cambia de color |
| `.kipu-shell-chip` `0.3s ×3` | `quick` | idem |
| `.kipu-shell-cord__knot` `0.35s ×2` | `quick` | idem |
| `.kipu-shell-live-layer` `0.18s` | `quick` | ya estaba en la escala |
| `.kipu-shell-orb` `0.18s` | `quick` | idem |
| `.kipu-shell-pill` `0.35s` | `quick` | aparece/desaparece |
| `.kipu-shell-pill__text` `0.42s` | `move` | se desplaza 3 px al entrar |
| `.kipu-shell-cinta` `0.5s` | `move` | se desplaza 7 px al entrar |
| `.kipu-shell-dock__circle` `0.2s ×2 + 0.15s` | `quick ×2 + instant` | color = quick; el **transform** responde al dedo |
| `.kipu-shell-sheet` `0.32s` | `move` | ya estaba en la escala |
| `.kipu-dialog-backdrop` `0.28s ×3` | `move` | **queda sincronizado con su hoja**: antes el `visibility` se apagaba a 0,28 s mientras la hoja seguía viajando hasta 0,34 s |
| `.kipu-dialog-sheet` `0.34s` | `move` | idem |

Las curvas explícitas que ya existían (`cubic-bezier(0.22,0.61,0.24,1)`) **eran
literalmente** `--kipu-e-out`: no cambió ninguna. Lo que cambió es que los
`ease` sueltos pasaron a esa misma curva — que es el punto entero de «el
movimiento tiene una sola física».

---

### A3 · Toda cifra de dinero del santuario usa `tabular-nums` — comprobado en el DOM

**Cómo:** `font-variant-numeric` **hereda**, así que se declara UNA vez en la
raíz `.kipu-santuario`. Como la hoja de perspectiva y la de diálogo cuelgan del
mismo `<main>`, toda cifra del árbol la lleva **por construcción** — también las
que N1–N6 agreguen. La comprobación no lee la hoja: recorre el DOM buscando
**cualquier** elemento con un nodo de texto que contenga un dígito y mide su
estilo computado.

```json
{"raizTabular":"tabular-nums","conDigitos":13,"sinTabular":0}
```

Y por clase, con el texto real (corrida previa, mismo resultado):

```
kipu-shell-amount        82.40$   tabular-nums
kipu-shell-amount        1,200$   tabular-nums
kipu-shell-amount        260$     tabular-nums
kipu-shell-amount        3,480$   tabular-nums
kipu-shell-amount        760$     tabular-nums
kipu-shell-cinta__amount −4.50$   tabular-nums
kipu-shell-cinta__time   14:20    tabular-nums
kipu-shell-pill strong   25 (×5)  tabular-nums
todosTabulares: true · 18/18
```

`N0-3` fija además, en el gate, que la declaración vive en la raíz y que las
cuatro superficies con cifra están **dentro** de ese `<main>` — si alguien
sacara una fuera, la herencia dejaría de cubrirla y la aserción cae.

---

### A4 · Los cinco estados como componentes, un solo módulo, `/dev/sistema` con las cuatro formas

**Cómo:** `N0-4` ejecuta el contrato (5 kinds, 4 shapes, sin duplicados),
comprueba que `KipuState.tsx` exporta los cinco, que `index.ts` los re-exporta,
que `state-contract.ts` **no** importa `server-only`, y que `/dev/sistema`
**deriva** la cobertura recorriendo `KIPU_STATE_SHAPES.map(` y
`KIPU_STATE_KINDS.map(` — o sea que no puede olvidarse de una casilla.

En el DOM de `/dev/sistema`:

```json
{"slots":20,"states":24,
 "kinds":["vacio","sin-dato","cargando","sin-senal","error"],
 "shapes":["orbe","tarjeta","linea","hoja"]}
```

20 casillas = 5 × 4. (Los 24 `.kipu-state` son esas 20 más los 4 del duelo
vacío-vs-sin-dato en oscuro y en claro.)

**Un defecto propio, encontrado mirando y corregido:** en la forma `línea` el
título, la cifra y la invitación se pisaban dentro de una celda de 180 px. Dos
cosas estaban mal y ambas se arreglaron: la línea no tenía `nowrap` ni elipsis,
y sobre todo la matriz la metía en cinco columnas — **una línea ocupa el ancho,
como la cinta del santuario**; apretarla mentía sobre su propia forma.

---

### A5 · `vacío` y `sin dato` se distinguen a simple vista

**Cómo:** `N0-5` lo ejecuta como contrato (no como opinión): exige que difieran
en `claim`, `silhouette`, `showsFigure`, `offersRetry` y `offersInvitation`, que
las cinco afirmaciones sean únicas, y que **sólo** `vacío` pueda pintar un cero.

```
ejes en que difieren: ["claim","silhouette","showsFigure","offersRetry",
                       "offersInvitation","title","body"]   → 7 de 7
puedenPintarCero: ["vacio"]
```

Y en pantalla (`/dev/sistema?seccion=duelo`, captura pegada abajo). Qué los
separa, en orden de cuánto salta a la vista:

| | Vacío | Sin dato |
|---|---|---|
| Silueta | círculo **entero**, relleno, borde continuo | círculo **discontinuo**, sin relleno |
| Cifra | **`0`** en tinta viva — un cero MEDIDO | **`—`** en tinta apagada |
| Marca | gota con menisco, en el acento de la capa | círculo tachado |
| Frase | «Leí bien: aquí todavía no hay nada. Eso tiene arreglo.» | «No es que esté en cero: es que no lo pude leer. Prefiero no inventarte un número.» |
| Salida | **invitación** en color de acento | botón **Reintentar** |

Es la doctrina monetaria del proyecto hecha visual, y el eje que más importa es
el tercero: **el vacío enseña un cero; el sin-dato jamás enseña un número.**

Capturas (`/dev/sistema`, tema oscuro y tema claro): el duelo lado a lado, la
matriz completa de 5 × 4, y la banda de `línea` ya corregida. Están descritas
arriba; el auditor las reproduce en dos URLs:
`/dev/sistema?seccion=duelo` y `/dev/sistema?seccion=estados`.

---

### A6 · `formatMetric(null) === "—"` y `formatMetric(0)` es un cero medido — ejecutado

**Cómo:** `N0-6` **ejecuta** las funciones puras (no lee su fuente):

```
formatMetric(null)             === "—"   (=== KIPU_UNMEASURED)
formatMetric(undefined)        === "—"
formatMetric(Number.NaN)       === "—"
formatMetric(0)                === "0"   y !== KIPU_UNMEASURED
formatMetric(0,   {unit:"ms"}) === "0 ms"
formatMetric(1234.56,{digits:1}) === "1234.6"
formatSegmentValue(null)       === "—"
formatSegmentValue(0)          === "0 ms"
formatMetroValue("CLS", null)  === "—"
formatMetroValue("CLS", 0)     === "0.000"
metroVerdict("LCP", null)      === "sin-medir"
metroVerdict("LCP", 0)         === "bueno"
metroVerdict("LCP", 3000)      === "regular"
metroVerdict("LCP", 9000)      === "malo"
formatServerTiming([...])      === "contexto;dur=12.3, total;dur=987.6"
parseServerTiming(idem) → segmentMs("contexto") === 12.3
                          segmentMs("no-existe") === null
```

`sin-medir` no es «malo»: es ausencia, y tiene su propio veredicto.

---

### A7 · `?metro=1` muestra el overlay con `—`; sin el parámetro no existe en el DOM

**Cómo:** en el navegador, contando `[data-metro]` con y sin el parámetro.

```
/dev/sistema         → document.querySelectorAll('[data-metro]').length === 0
/dev/sistema?metro=1 → present: true
   TTFB 75 ms [bueno] | LCP — [sin-medir] | INP — [sin-medir] | CLS — [sin-medir]
   servidor: contexto — · hilo — · briefing — · resto — · total —
   resto: cliente — · preferencias — · cotizaciones — · historia — · movimiento — · recibo —
   pointer-events: none
```

Tres cosas que esto prueba de una vez: (1) el panel **no se monta** sin el
parámetro, así que no existe en el HTML ni tras hidratar, y los ganchos de web
vitals ni siquiera se registran para un usuario normal; (2) un valor **medido**
sale como número con su veredicto (TTFB 75 ms, verde); (3) todo lo **no medido**
sale `—`, nunca `0`. Los tramos de servidor salen `—` porque `/dev/sistema` no
construye un payload del santuario y **no se inventa uno**.

`resto` merece una nota: sólo es un número cuando `total` y los tres tramos de
cabecera están medidos. Si falta una pieza, restar produciría una cifra falsa,
así que vale `—`.

---

### A8 · `Server-Timing` con un tramo por cada `await` de `buildShellPayload`

**Cómo:** `N0-6` corta el cuerpo real de `buildShellPayload` y comprueba que
cada tramo declarado en `SHELL_TIMING_SEGMENTS` se mide **exactamente una vez**
y que **no queda ningún `await` suelto**:

```json
{"tramos":["contexto","cliente","preferencias","hilo","briefing",
           "cotizaciones","historia","movimiento","recibo"],
 "awaitsSinTramo":["supabase"]}
```

Nueve tramos + `total` = los diez de `SHELL_TIMING_SEGMENTS`. El único `await`
sin envolver es el `await supabase…` que vive **dentro** del callback del tramo
`movimiento`. Si mañana alguien agrega un `await` sin tramo, esa cuenta deja de
ser 1 y la aserción cae — es el pin de «un tramo por cada await».

El instrumento no toca el curso: `timed` devuelve lo que devuelve el tramo y
registra en un `finally`, así que **un tramo que falla también se mide** y
cualquier `throw` (incluido el `redirect` de onboarding) pasa igual. Las marcas
viven en un array **local de la invocación**: no hay estado de módulo, así que
ninguna medición puede cruzarse entre peticiones ni entre usuarios.

**Dónde llega:** ver Desviación **D1**. La cabecera se arma con la gramática
estándar (`nombre;dur=12.3, …`) y viaja en la respuesta de `/app` dentro del
payload, **no como cabecera HTTP**, porque Next 16 no le da a un Server
Component ninguna manera de escribir una cabecera de respuesta.

---

### A9 · El santuario no cambió de comportamiento (M2 B12)

**Cómo:** los cinco taps del carrusel en `/dev/shell-preview`, a 375 × 812,
sobre un servidor recién arrancado con caché limpia.

```
Saldo      · pos=0 · slide=saldo      · tab=Saldo      · capa=saldo      · acento=#4fead2 · nudo=0 · cifra=82.40$
Reserva    · pos=1 · slide=reserva    · tab=Reserva    · capa=reserva    · acento=#87abff · nudo=1 · cifra=1,200$
Metas      · pos=2 · slide=metas      · tab=Metas      · capa=metas      · acento=#c0a2ff · nudo=2 · cifra=260$
Patrimonio · pos=3 · slide=patrimonio · tab=Patrimonio · capa=patrimonio · acento=#bfe6f8 · nudo=3 · cifra=3,480$
Deuda      · pos=4 · slide=deuda      · tab=Deuda      · capa=deuda      · acento=#ffbd8e · nudo=4 · cifra=760$
```

Paridad total posición / slide / tab / capa / acento / nudo / cifra, y las cinco
cifras son **las mismas** que fijó la auditoría de M2 (`82.40$ · 1,200$ · 260$ ·
3,480$ · 760$`).

**Aviso metodológico:** la primera corrida de esta comprobación dio cinco filas
idénticas en «Saldo» y parecía una regresión. No lo era: `innerWidth` era **0**
porque el panel del navegador estaba oculto, así que el carrusel no tenía a
dónde desplazarse. Al fijar un viewport y re-medir, salió verde. Es la trampa
§8.5 del spec, pagada otra vez.

---

### A10 · lint 0 errores · build exit 0 · captura 854 + 6, ninguna anterior removida ni relajada

```
$ node scripts/qa/run-capture-gate.mjs      (baseline, antes de tocar nada)
854/854 capture checks

$ npm run lint
✖ 8 problems (0 errors, 8 warnings)
   ← los 8 warnings son PREEXISTENTES y viven en scripts/qa/m0-loop-122|123-e2e.mjs
     (no-unused-vars). Cero en archivos de N0.

$ node scripts/qa/run-capture-gate.mjs      (final)
860/860 capture checks

$ npm run build
BUILD EXIT=0 · ✓ Compiled successfully
```

854 → 860: seis nuevas (`N0-1` … `N0-6`), **cero** removidas y cero relajadas.
Las aserciones vecinas que pinchan estos archivos siguen verdes sin tocarse:
`M4` (`buildUserFinancialContext(userId)`, `buildCoachingBriefing({`), `M6-4`
(un solo `buildCoachingBriefing`, un solo `loadSnapshotSeriesRead` en el cuerpo)
y `M9-1` (la forma de `page.tsx`, que no se editó).

El build emite **1 warning**, y es preexistente: la traza NFT de Turbopack por
los `readFileSync` de `src/app/dev/capture-test/page.tsx`. No lo causa ningún
archivo de N0.

---

### A11 · Mutación propia con dientes

Tres mutaciones, cada una revertida y re-verificada. Ninguna rompe el
compilador: las mata un **test con nombre**.

**M1 — la regla de A6 rota a mano** (`formatMetric` devuelve `"0"` en vez de `"—"`):

```
✗ N0-6 · una medición que no ocurrió se escribe — y jamás 0; un tramo nombrado
         por cada await del santuario
859/860 capture checks      ·      exit=1
$ npx tsc --noEmit   →   tsc exit=0      ← el compilador no la ve; el test sí
```

**M2 — el vacío dibujado como sin-dato** (`vacio.silhouette = "interrumpida"`):

```
✗ N0-5 · vacío y sin dato se separan por afirmación, silueta y salida; sólo el
         que leyó puede pintar un cero
   {"ejes":["claim","showsFigure","offersRetry","offersInvitation","title","body"]}
859/860 capture checks
```
(La silueta desaparece de la lista de ejes: por eso cae.)

**M3 — una duración literal de vuelta en el santuario** (`.kipu-shell-chip`):

```
✗ N0-2 · cero duraciones literales en las regiones N0; lo ambiental usa --kipu-t-breath-*
   {"literales":["SANTUARIO: color 0.3s ease, background-color 0.3s ease, border-color 0.3s ease"]}
859/860 capture checks
```

Revertidas las tres:

```
860/860 capture checks
```

---

### A12 · Cero dependencias nuevas, cero `supabase/**`, cero migraciones, cero `financial/**`, cero `ai/**`

```
$ git status --porcelain | grep -E "supabase/|src/lib/financial/|src/lib/ai/|package(-lock)?\.json"
(sin salida)
```

Árbol tocado por N0:

```
 M src/app/app/components/shell/SantuarioShell.tsx     (+2)
 M src/app/app/components/shell/shell-payload.ts       (+140/-…)
 M src/app/dev/capture-test/page.tsx                   (+308)
 M src/app/dev/shell-preview/page.tsx                  (+3)
 M src/app/globals.css                                 (+461/-…)
?? src/app/app/components/metro/MetroOverlay.tsx
?? src/app/app/components/state/{state-contract.ts,KipuState.tsx,index.ts}
?? src/app/dev/sistema/page.tsx
?? src/lib/metro/metro-contract.ts
```

`AGENTS.md`, `CLAUDE.md`, `docs/ROADMAP.md` y `docs/design/README.md` aparecen
modificados **desde antes de esta rama** (llegaban sucios en `main` con la
apertura del Bloque N). No los toqué.

---

## Desviaciones

**D1 · `Server-Timing` viaja en el cuerpo de la respuesta de `/app`, no como
cabecera HTTP.** El spec (§6.1, A8) pide emitir los tramos «como
`Server-Timing`». **Next 16.2.4 no le da a un Server Component ninguna manera de
escribir una cabecera de respuesta**: `headers()` es explícitamente de sólo
lectura (`node_modules/next/dist/docs/.../headers.md:34,47`), `next/server` sólo
exporta `NextRequest / NextResponse / ImageResponse / userAgent / URLPattern /
after / connection`, y `next.config.ts` sólo admite cabeceras estáticas. El
único archivo que podría escribirla es el `proxy`/middleware — que está fuera
del §3, es propiedad de N1, toca la frontera de sesión del proyecto y, sobre
todo, **corre antes del render**, así que estructuralmente no puede conocer los
tiempos. Lo verifiqué también en el navegador:
`performance.getEntriesByType('navigation')[0].serverTiming.length === 0`.

Qué hice en cambio: `buildShellPayload` arma la **misma cadena, con la gramática
estándar** (`formatServerTiming`), y la devuelve en `payload.serverTiming`; el
overlay la lee con `parseServerTiming`. El día que exista una capa que sí pueda
poner la cabecera, es una línea: la cadena ya está formada y ya se sabe leer.

**D2 · Dos archivos fuera de la tabla del §3.** El §6.2 pide un overlay pero la
tabla del §3 no le da fila, y `/app` tiene que montarlo. Creé
`src/app/app/components/metro/MetroOverlay.tsx` y agregué **una línea** a
`SantuarioShell.tsx` para montarlo. Elegí el santuario y no `page.tsx` a
propósito: el pin **M9-1** exige que `page.tsx` tenga un solo `return` y que
`return <SantuarioShell payload={payload} />;` aparezca literal — un segundo
elemento ahí habría relajado una aserción anterior, que A10 prohíbe.

**D3 · Una línea en `src/app/dev/shell-preview/page.tsx`.** Al ganar
`ShellPayload` el campo `serverTiming`, la maqueta dejaba de compilar. Le puse
`serverTiming: null` — y es la respuesta honesta: la maqueta **no midió** ningún
tramo, así que con `?metro=1` muestra `—` en todas las casillas del servidor.

**D4 · `metro-contract.ts` importa de `state-contract.ts`.** Es `src/lib/` →
`src/app/`, una dirección poco habitual. La elegí porque el §5 asigna
explícitamente `formatMetric` a `state-contract.ts` y duplicar la regla del `—`
en dos módulos es exactamente el defecto que N0 existe para matar. Ambos son
puros y sin `server-only`, así que no hay riesgo de runtime.

**D5 · `/dev/sistema` tiene un filtro `?seccion=`.** No lo pide el spec. Lo
agregué porque aprobar un acabado en un teléfono es más fácil de a una cosa, y
porque este entorno no fotografía contenido desplazado (ver «No verificado»).
Sin el parámetro la página muestra todo, como pide el §3.

**D6 · Un quinto token ambiental.** `--kipu-t-breath-skeleton: 1.6s` para el
barrido del esqueleto. El §4.1 deja la lista ambiental abierta («se les da un
token propio») y sin él la región ESTADOS habría necesitado una duración
literal.

---

## No verificado

1. **`/app` no se abrió en un navegador.** Requiere una sesión autenticada con
   datos financieros reales, y este entorno no tiene ninguna credencial de QA
   (`.env.local` no trae usuario de prueba). Crear una persona desechable en la
   base de producción para esto habría sido escribir datos por una etapa que,
   por diseño, no toca datos. **Consecuencia concreta:** el overlay se vio con
   los tramos del servidor en `—` (en `/dev/sistema` y `/dev/shell-preview`,
   donde es la respuesta correcta), pero **nadie ha visto todavía la cadena
   `Server-Timing` del santuario con números reales**. Lo que sí está probado
   por ejecución: los nueve tramos + `total` existen y se miden (A8), la
   gramática ida y vuelta (A6), y el cableado hasta el overlay (build + pins).
   **Es lo primero que debería mirar N1**, y le sirve directo como línea base.
2. **LCP, INP y CLS no se pudieron medir aquí.** El panel del navegador vive en
   `document.visibilityState === "hidden"`: `performance.getEntriesByType(
   'largest-contentful-paint').length === 0`, así que esas tres nunca disparan.
   Es la trampa §8.2. Lo que esto **sí** demuestra es la mitad que importa para
   N0: sin medición, la casilla dice `—` y su veredicto es `sin-medir`. TTFB
   (75 ms, verde) demuestra la otra mitad. Las tres restantes sólo se validan en
   el teléfono del founder.
3. **`prefers-reduced-motion` no se emuló.** Agregué `.kipu-state__bone` a la
   lista que apaga animaciones (`globals.css:1905`) pero no pude ejercer el
   media query desde aquí.
4. **Nada se probó en un teléfono real.** fps, amanecer, gestos y densidad
   siguen siendo territorio de hardware, como cerró el Bloque M.
5. **La captura de pantalla sólo compone el primer viewport.** Todo lo que
   requiere desplazarse sale negro. Lo resolví con viewports altos y con el
   filtro `?seccion=` (D5), no con parches en la pestaña.

---

## Lo que le dejo a N1

1. **El metro ya está puesto, y su primer número es de N1.** `payload.serverTiming`
   trae `contexto · cliente · preferencias · hilo · briefing · cotizaciones ·
   historia · movimiento · recibo · total`. La primera medición real en el
   teléfono del founder es la línea base contra la que se mide «−4 viajes,
   −348 kB»: **tomarla ANTES de mover nada.**
2. **`hilo` es un tramo con nombre propio a propósito.** Cuando N1 saque el hilo
   de la pantalla de inicio, ese tramo debe desaparecer del encabezado; si sigue
   apareciendo, el hilo se sigue leyendo. El gate lo nota solo: si se borra el
   `await`, `SHELL_TIMING_SEGMENTS` deja de cuadrar y `N0-6` cae — hay que
   quitar el nombre de la lista **y** decirlo, no dejarlo pasar.
3. **La cabecera HTTP sigue pendiente y N1 es quien puede darla.** N1 va a
   escribir el archivo de sesión en el borde (D-N1, autorizado). Ese archivo es
   el único sitio del proyecto que puede poner cabeceras de respuesta — pero
   corre **antes** del render, así que no le sirve para esto. Si se quiere la
   cabecera de verdad, hay que decidirlo aparte; la cadena ya está armada.
4. **`shell-payload.ts:338`, el `throw movementError`, sigue vivo.** Lo medí de
   cerca al instrumentar y confirmo el diagnóstico del plan: un fallo leyendo el
   **último movimiento** —un dato decorativo— tumba la pantalla entera. El tramo
   `movimiento` ya lo mide; N1 sólo tiene que dejar de hacerlo fatal.
5. **Los cinco estados ya existen: N1 no debe improvisar ninguno.** Cuando el
   orbe se transmita antes que la píldora, el hueco de la píldora es
   `KipuLoading shape="linea"`, no una barra gris. Y cuando el último movimiento
   no se pueda leer, es `KipuNoData`, no una cinta vacía —
   `stateMayRenderZero("sin-dato") === false` está para eso.
6. **Trampa nueva de este entorno, que me costó media hora.** Turbopack sirvió
   `globals.css` **rancio** después de un `npm run build`: la regla estaba en el
   archivo y no en la hoja servida, y el DOM parecía darme la razón. Reiniciar
   el servidor no bastó; hubo que borrar `.next`. **Verificá CSS contra la hoja
   servida (`curl` del `<link>`), no contra el archivo**, y ante cualquier
   sorpresa de estilo, `rm -rf .next` antes de acusar al código.
7. **Deuda de escala que N0 dejó a propósito.** `LiveOrb.tsx` anima en JS con
   `1_200` y `1_100` ms literales (líneas 562, 566, 611): están fuera de
   `globals.css`, así que A2 no los alcanza. Son de N2 — y `--kipu-t-settle`
   (620 ms) es el candidato natural cuando se toquen. Igual, `.kipu-detail__*`
   sigue con literales: se convierte en la etapa que toque cada pantalla
   (N3–N6), como manda el §2.
