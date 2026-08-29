# N2_REPORT — Un solo orbe

> Implementador. Contrato: `docs/design/stages/N2_SPEC.md`.
> Rama `stage-n-acabado` @ `ef6f56d`. **Sin commits.**

---

## Ronda 1

### Qué dijo el LCP — **la respuesta es «todavía no», y hay que decirlo primero**

El §4 es lo primero que hice y es lo primero que hay que leer, porque condiciona
cómo se lee todo lo demás.

**El instrumento está puesto y funciona.** El metro ya no dice sólo *cuánto*
tardó el LCP: dice *qué elemento* fue.

```
elemento LCP   canvas.kipu-live-orb__canvas
```

**Pero la lectura real no la tengo, y no la puedo tener aquí.** Lo medí antes de
sacar conclusiones:

```
document.visibilityState : "hidden"
performance.getEntriesByType('largest-contentful-paint').length : 0
cuadros de requestAnimationFrame en 1500 ms : 0
```

El panel del navegador de este entorno vive oculto: **el LCP nunca dispara** y
`requestAnimationFrame` **no corre ni una vez**. Es la trampa §7.5.1 del propio
spec, confirmada por medición y no supuesta.

Así que la línea del metro muestra `—`, que es lo correcto según la regla de N0
(*sin medir ⇒ `—`, jamás un nombre inventado*), y **las dos hipótesis del §4
siguen vivas**. Lo que sí verifiqué es que la extracción funciona sobre elementos
reales de la página, incluido el caso que rompe la implementación ingenua:

```
canvas   → canvas.kipu-live-orb__canvas
cifra    → span.kipu-shell-amount
marco    → main.kipu-santuario
cordón   → svg.kipu-shell-cord      ← SVG: `className` es un SVGAnimatedString,
                                       por eso se lee `getAttribute("class")`
```

**El ritual para el founder, que es de un minuto:** abrir `/app?metro=1`, **tocar
una vez la pantalla** (el LCP no se cierra hasta el primer toque o hasta que la
página se oculta — verificado en `N1_SPEC §7.6`), y fotografiar. Si la línea dice
`canvas.kipu-live-orb__canvas`, entonces lo que hizo N2 con la sustitución **es
además el arreglo de rendimiento más grande del bloque**. Si dice
`span.kipu-shell-amount` o `main.kipu-santuario`, N2 fue acabado y el problema de
los ~2,2 s de cliente es bajar e hidratar JS — otra etapa.

**Las dos respuestas son válidas. Lo que no valía era trabajar sin el
instrumento, y el instrumento ya está.**

---

### C1 · El metro dice qué elemento fue el LCP ✅ *(instrumento)* · ⚠️ *(lectura)*

Ejecutado por el gate (`N2-1`), no leído:

```
describeLcpElement(null)                                   → "—"
describeLcpElement(undefined)                              → "—"
describeLcpElement({tagName:null,…})                       → "—"
describeLcpElement({tagName:"CANVAS", classNames:[]})      → "canvas"
describeLcpElement({tagName:"CANVAS",
   classNames:["absolute","kipu-live-orb__canvas"]})       → "canvas.kipu-live-orb__canvas"
describeLcpElement({tagName:"SPAN",
   classNames:["kipu-shell-amount"]})                      → "span.kipu-shell-amount"
describeLcpElement({tagName:"DIV", id:"hero", …})          → "div#hero"
```

Se prefiere una clase `kipu-` sobre la primera de la lista **a propósito**:
`canvas.kipu-live-orb__canvas` responde la pregunta del §4; `canvas.absolute` no
responde nada. Y el elemento se lee del array `entries` de la métrica, no de una
adivinanza — el gate lo pincha (`metric.name === "LCP"`, `getAttribute("class")`).

La lectura real queda en el teléfono del founder. Ver arriba.

---

### C2 · El orbe nunca se sustituye a la vista ✅ *(estructural + medido)* · ⚠️ *(el relevo, no)*

**Murió la regla.** Antes:

```ts
const showLiveCanvas = liveSettled && !dialogOpen && liveTier > 0 && liveState !== "fog";
```

Cada término apagaba el orbe bueno y enseñaba el barato. Ahora:

```ts
const showLiveCanvas = liveReady;
```

Una sola condición, y es de **existencia**, no de gesto: se enseña el orbe vivo
cuando el orbe vivo **ya pintó**. Tres cosas quedaron atadas por `N2-5`:

- `showLiveCanvas` es exactamente `liveReady` y **no menciona** `liveSettled`,
  `dialogOpen` ni `liveTier`;
- `liveReady` es un **latch**: una sola llamada a `setLiveReady`, con `true`, y
  ninguna con `false`;
- el relevo espera al **primer cuadro** (`onReadyRef.current?.()` dentro del
  bucle de dibujo), no a que haya tier. Entre «hay tier» y «hay imagen» había un
  **canvas en blanco** apareciendo sobre el orbe de CSS — creo que es la tercera
  forma que el founder fotografió («orbe sólido sin luz»).

**Y lo medí con el estado real del componente**, para cuantificar qué se quitó.
Sobre `/dev/shell-preview`, dos taps y abrir la hoja:

```
inicial            : pausado=true  dialogo=false  liveVisible=false  tier=3
tap Reserva        : pausado=true  dialogo=false  liveVisible=false  tier=3
tap Reserva (fin)  : pausado=false dialogo=false  liveVisible=false  tier=3
tap Deuda          : pausado=false dialogo=false  liveVisible=false  tier=3
hoja abriéndose    : pausado=false dialogo=false  liveVisible=false  tier=3
hoja abierta       : pausado=true  dialogo=true   liveVisible=false  tier=3
hoja cerrándose    : pausado=true  dialogo=true   liveVisible=false  tier=3

cambios que habría hecho la REGLA VIEJA : 2
valores distintos de la REGLA NUEVA     : ["false"]
tiers vistos                            : ["3"]
```

En **dos taps y una hoja**, la regla vieja habría cambiado de orbe **dos veces**.
La nueva no cambia de valor porque no lee esas entradas.

**Lo que NO pude verificar, y es la mitad visual:** el relevo mismo. En este
entorno `requestAnimationFrame` no corre (0 cuadros en 1500 ms), así que el orbe
vivo nunca pinta, `liveReady` nunca se enciende y `liveVisible` se queda en
`false` por una razón que no es la de producción. **Que el relevo único no se
note es del founder.**

---

### C3 · Abrir y cerrar la hoja no sustituye el orbe ✅ *(estructural)* · ⚠️ *(visual)*

Es el mismo cambio: `dialogOpen` salió de la decisión. La traza de arriba lo
muestra — `dialogo` pasa a `true` y `liveVisible` no se inmuta.

**Y apareció un defecto que mi propio cambio creaba, que arreglé:** el bucle
sigue pausándose cuando el chat se abre (pausar la animación es legítimo, lo dice
el §5.1), pero hasta N1 pausar coincidía con *esconder* el canvas. Ahora el
canvas se queda puesto mientras está pausado, y el contexto WebGL se creaba **sin
`preserveDrawingBuffer`**: el navegador puede limpiar el lienzo después de
componer, y un lienzo pausado se queda **en blanco**. Sería otra sustitución con
otro nombre. Una línea en `orb-shader.ts`, pinchada por `N2-5`.

---

### C4 · La calidad se decide una vez ✅

**La escalera se fue.** Hasta N1, `evaluateQuality` subía el tier sola a los 30 s
y lo bajaba tras dos ventanas lentas; `dropToTier` desmontaba el renderer. Cada
movimiento era otra sustitución. Ahora:

- el tier lo elige `initialTier()` **una vez**, en el efecto de arranque, **antes
  del primer cuadro**;
- `evaluateQuality` y `dropToTier` **ya no existen** (pinchado por `N2-5` sobre
  el código sin comentarios);
- la ventana de calidad se sigue **midiendo** —el panel `?perf=1` la muestra—
  pero ya no manda sobre nada;
- la única salida de tier que queda es `webglcontextlost`, que **no es una
  decisión de calidad**: es que el lienzo se murió y no hay nada que dibujar;
- y el canal por el que el tier llegaba al santuario (`onTierChange` → `liveTier`)
  **se borró entero**, así que ya no hay por dónde volver a atarlo a la decisión.

Medido en el DOM, con dos caminos forzados:

```
?tier=1 → tier al 1s: "1" · tier al 4s: "1" · estable: true
?tier=2 → tier: "2"
?tier=3 → tier: "3"   (traza de C2, siete muestras: siempre 3)
```

**Un matiz honesto:** el HTML del servidor sale con `data-quality-tier="0"`
porque `initialTier()` necesita `navigator`/`matchMedia` y no puede correr en el
servidor. Ese 0 **no es observable**: el canvas no se enseña hasta `liveReady`, y
`liveReady` sólo se enciende cuando ya se dibujó con el tier elegido. «Lo antes
posible» aquí significa «antes del primer cuadro», no «antes de hidratar».

---

### C5 · Reserva, Metas y Deuda tienen nivel, sin una sola lectura nueva ✅

Los tres denominadores del §5.3, cada uno desde donde el spec verificó que ya
estaba:

| Capa | Denominador | De dónde | Tramo |
|---|---|---|---|
| Reserva | meta de respaldo | `prefs.emergency_reserve_target` | `preferencias` |
| Metas | aporte del mes | `briefing.margenKipu.capacity.monthlyProtected` | `briefing` |
| Deuda | ciclo cubierto | `ctx.debtAccounts[].statementTotalDue` / `.statementCovered` | `contexto` |
| Patrimonio | — | — | — |

**Ninguna consulta nueva**, contado sobre el archivo antes y después:

```
             .from(  readOpenOccurrences  loadSnapshotSeriesRead  findThreadTurn  contexto  briefing  fx
HEAD           2            1                     1                    1            2         2       1
AHORA          2            1                     1                    1            2         2       1
```

Y el contrato del orbe no toca la base: `0` apariciones de
`supabase|createSupabase|.from(|fetch(` en `shell-orb-contract.ts`.

En pantalla, `/dev/shell-preview` (tier 0, DOM real):

```
saldo      : nivel  64%    "Disponible hoy"                             82.40$
reserva    : nivel  50%    "Tu respaldo · 50% de tu meta"               1,200$
metas      : nivel  62%    "Por aportar este mes · queda 62% del aporte del mes"  260$
patrimonio : nucleo        "Patrimonio total"                           3,480$
deuda      : nivel  38%    "Ciclo cubierto 38% · te faltan 760$"        760$
```

**Sobre la trampa §7.2:** confirmo que `briefing.debtHealth.cards` no sirve —
`CardHealth` expone `fullPaymentDue` y `balance`, no `statementCovered`. El
camino es `ctx.debtAccounts`, filtrando `type === "credit_card"`, y la cobertura
la decide `cardStatementSettled` del motor, no una resta mía.

---

### C6 · Cada nivel se puede decir en una frase, con su denominador ✅

La frase la trae el motor en `levelNote` y aparece **en pantalla**, pegada a lo
que la cifra significa:

- Reserva → `Tu respaldo · 50% de tu meta`
- Metas → `Por aportar este mes · queda 62% del aporte del mes`
- Deuda → `Ciclo cubierto 38% · te faltan 760$` *(la forma que M2 diseñó y que
  hasta hoy nunca tuvo datos)*

También corregí el **nombre accesible**, que decía `nivel al 62 por ciento` — un
porcentaje sin denominador, que es exactamente el defecto que la doctrina de M6
prohíbe. Ahora habla con la misma frase.

`N2-2` exige que las tres frases traigan un `%` **y** al menos siete caracteres
de texto que no sean el número: un porcentaje suelto no pasa.

---

### C7 · Patrimonio no lleva nivel y tiene su señal de vida ✅ — visto

`orbMatter("patrimonio") === "cristal"`, y es **la única** capa de cristal
(`N2-3`). `orbAcceptsLevel("patrimonio") === false`: no acepta un nivel venga de
donde venga, porque el patrimonio total no tiene techo honesto.

Su señal de vida es un **núcleo facetado suspendido** que respira lentamente
(`--kipu-t-breath-core: 19s`, ambiental, con nombre — regla de N0). Lo vi:
Patrimonio dejó de ser una bola de vidrio hueca con una cifra debajo.

Y espeja el **material 3 del shader**, que ya dibujaba ese núcleo desde M2: al
relevarse el orbe vivo, la materia no cambia.

---

### C8 · El vacío con gota, y la frontera que no se relaja ✅ — las dos capturas

**Un orbe en cero** (`?state=dia-1`): el vidrio entero, una lámina mínima en el
fondo con su línea de menisco, y una **gota luminosa** encima que sube y baja
despacio. Dice «vacío a propósito».

**Un orbe que no se pudo leer** (misma pantalla, capa Metas): un **contorno
punteado**, sin relleno, sin halo. Medido en el DOM:

```
cero      : relleno="gota"     pieza=kipu-shell-orb__drop
sin leer  : relleno="sin-dato" pieza=(ninguna)  borde=dashed  fondo=none
```

No se parecen en nada, y no pueden: `N2-4` exige que **para las cinco capas**
`orbFill(amount: 0)` sea distinto de `orbFill(amount: null)`.

*(La primera versión de la gota salió mal y la corregí mirando: los porcentajes
del `::after` se medían contra una tira de 5 % de alto, así que la gota era una
raya de medio píxel. Ahora la capa ocupa el vidrio entero y los porcentajes se
miden contra el orbe.)*

---

### C9 · La lógica es pura y el gate la EJECUTA ✅

`src/app/app/components/shell/shell-orb-contract.ts`, sin `server-only`
(verificado por `N2-2`, que además lo ejecuta). Siguiendo el patrón de
`state-contract.ts` (N0) y `cintaState` (N1).

```
orbMatter("patrimonio")                          → "cristal"
reserveLevel({amount:1200, target:2400})         → {level:0.5,  note:"50% de tu meta"}
reserveLevel({amount:2880, target:2400})         → {level:1,    note:"120% de tu meta"}
reserveLevel({amount:1200, target:null})         → {level:null, note:null}
goalsLevel({pending:260, planned:420})           → {level:0.619,note:"queda 62% del aporte del mes"}
goalsLevel({pending:260, planned:0})             → {level:null, note:null}
debtCycleLevel([USD 1000, restan 620])           → {level:0.38, note:"Ciclo cubierto 38%"}
debtCycleLevel([USD 1000, corte cubierto])       → {level:1,    note:"Ciclo cubierto 100%"}
debtCycleLevel([USD …, ARS …])                   → {level:null, note:null}
debtCycleLevel([])                               → {level:null, note:null}
orbFill(saldo, 82.4, 0.64)                       → "nivel"
orbFill(saldo, 0, 0)                             → "gota"
orbFill(reserva, 1200, null)                     → "nucleo"
orbFill(metas, null, null)                       → "sin-dato"
```

Pasarse de la meta **se dice** (120 %) pero el agua no desborda: el nivel se
acota a 1 y el porcentaje se muestra entero. Quien llegó al 120 % de su respaldo
merece verlo.

---

### C10 · Ningún número cambió de valor ✅

Los cinco taps, a 375×812, sobre servidor recién arrancado con `.next` borrado:

```
pos=0 · slide=saldo      · tab=Saldo      · capa=saldo      · acento=#4fead2 · nudo=0 · cifra=82.40$
pos=1 · slide=reserva    · tab=Reserva    · capa=reserva    · acento=#87abff · nudo=1 · cifra=1,200$
pos=2 · slide=metas      · tab=Metas      · capa=metas      · acento=#c0a2ff · nudo=2 · cifra=260$
pos=3 · slide=patrimonio · tab=Patrimonio · capa=patrimonio · acento=#bfe6f8 · nudo=3 · cifra=3,480$
pos=4 · slide=deuda      · tab=Deuda      · capa=deuda      · acento=#ffbd8e · nudo=4 · cifra=760$
```

Paridad total y las mismas cinco cifras de M2, N0 y N1.

*(Mi primera corrida dio las cinco filas en «saldo»: había muestreado **antes**
de que React re-renderizara. Re-medir lo corrigió. Es la quinta vez en el bloque
que mi propia sonda inventa un defecto — §7.5.4.)*

---

### C11 · La decisión del §5.5, declarada — **elegí (1), y la partí en dos** ✅ *(estructural)* · ⚠️ *(el número, no)*

**Elegí que el nivel llegue CON el orbe.** El motivo: la alternativa es que el
líquido suba después de pintar, y «cambios después de pintar» es exactamente de
lo que el founder viene quejándose. Un nivel que aparece tarde sería la Causa C
otra vez, con otra ropa.

**Pero no metí el tramo entero al camino crítico.** `preferencias` traía dos
lecturas en un mismo `Promise.all`: la fila de preferencias (de donde sale el
denominador de Reserva) y `readOpenOccurrences` (que sólo alimenta la píldora).
Meter las dos habría hecho que el orbe esperara por una lectura que no necesita.
**Partí el tramo:**

```
SHELL_TIMING_GROUPS
  orbe        : contexto · cliente · briefing · cotizaciones · preferencias   ← + preferencias
  pill        : pendientes · movimiento · recibo                              ← pendientes, nuevo
  perspectiva : historia
```

Son las **mismas dos consultas** de antes; lo único que cambió es que ya no se
esperan juntas.

**El costo esperado es ≈ 0 y el argumento es estructural, no estadístico:**
`preferencias` arranca **antes** del `await contexto`, así que para cuando
`briefing` resuelve ya lleva corriendo todo ese tiempo en paralelo. Lo único que
podría costar algo sería que esa lectura tardara **más que `contexto` +
`briefing` juntos**. En las cuatro corridas de N1 terminó en 1054–1069 ms contra
un hito `orbe` de 1526–1744 ms — entre 3 y 4 veces más rápida.

**Lo que no tengo es el número del después**, porque `/app` necesita sesión y
este entorno no tiene credenciales. **El reporte debe pegarlo el founder**: una
foto de `/app?metro=1` y comparar el hito `orbe` con 1526–1744 ms (frío) /
620–672 ms (caliente). Si subió, la decisión se revierte moviendo `preferencias`
de vuelta al grupo `pill` — es una línea en `SHELL_TIMING_GROUPS` más el
`await`.

---

### C12 · El orbe no perdió velocidad ⚠️ **NO VERIFICADO — es la medición del founder**

Misma razón que C11: sin sesión no hay hito `orbe`. Lo que puedo declarar es el
balance de lo que N2 agregó al camino crítico:

- **+** un `await prefsPromise` que ya corría en paralelo desde el primer
  instante (ver C11);
- **−** trabajo de cliente: la escalera de calidad dejó de re-renderizar el
  santuario cada vez que cambiaba el tier, y `liveTier` dejó de ser estado del
  santuario;
- **=** cero lecturas nuevas a la base (C5), cero dependencias (C15).

**Si el LCP resulta ser el canvas** (§4), N2 además debería mejorar el LCP: hoy
el elemento más grande se repinta al relevarse; con el relevo único eso ocurre
una sola vez.

---

### C13 · Gates ✅

```
$ npx tsc --noEmit                       (sin salida)
$ npm run lint                           ✖ 8 problems (0 errors, 8 warnings)
                                            ← preexistentes, en scripts/qa/. Cero en N2.
$ node scripts/qa/run-capture-gate.mjs   871/871 capture checks
$ npm run build                          BUILD EXIT=0 · ✓ Compiled successfully · ƒ Proxy (Middleware)
```

**866 → 871: cinco nuevas** (`N2-1`…`N2-5`), cero removidas. **Dos re-ancladas**,
las dos declaradas con la promesa que conservan:

- **`N1-4`** exigía `SHELL_TIMING_GROUPS.orbe.length === 4`. Esa cuenta era
  incidental y N2 la rompió a propósito (§5.5). La promesa que importaba —«los
  tramos están repartidos y ninguno se pierde»— se sujeta ahora **derivándola de
  la constante**: los tres grupos **particionan** `SHELL_TIMING_TRAMOS`, sin
  huérfanos ni repetidos. Es más fuerte que una cuenta fija.
- **`N0-6`** lleva una lista declarada de promesas ya medidas; `pendingPromise`
  entró a esa lista con su tramo. La regla no se tocó: un `await` o un elemento
  de `Promise.all` que no sea una promesa medida sigue rompiéndola.

---

### C14 · Mutación propia con dientes ✅ — cuatro, cada una revertida

**A — un orbe en cero deja de dibujar su gota** (en el componente):

```
### N2-MUT-A :: GATE EXIT 1
✗ N2-4 · un orbe en cero dibuja su gota, y jamás se parece a uno que no se pudo leer
   {"cero":"gota","sinLeer":"sin-dato","dibujaGota":true}
870/871 capture checks
```

**B — la CONDUCTA rota**: un cero medido se dibuja como no-leído:

```
### N2-MUT-B :: GATE EXIT 1
✗ N2-4 · …   {"cero":"sin-dato","sinLeer":"sin-dato"}
870/871 capture checks
```

B es la que importa: la frontera «no pude leer» ≠ «no hay nada» se prueba
**ejecutando** la función, así que no hace falta acertarle a una cadena.

**C — vuelve la sustitución por gesto:**

```
### N2-MUT-C :: GATE EXIT 1
✗ N2-5 · el orbe vivo se enseña por EXISTENCIA, no por gesto…
   {"showLiveCanvas":"liveReady && liveSettled && !dialogOpen"}
870/871 capture checks
```

**D — se cae el guard de moneda del ciclo de deuda:**

```
### N2-MUT-D :: GATE EXIT 1
✗ N2-3 · monedas mezcladas no producen un nivel inventado; sin nivel, cambia la materia
   {"mezcladas":{"level":0.9994450610432852,"note":"Ciclo cubierto 100%"}}
870/871 capture checks
```

D vale la pena leerla: **con el guard fuera, una tarjeta en USD y otra en ARS
producen «Ciclo cubierto 100 %»** — dinero inventado, que es lo que el Bloque J
pagó con diez migraciones. El gate lo mata.

Las cuatro revertidas: `871/871`.

---

### C15 · Alcance ✅

```
$ git status --porcelain | grep -E "supabase/|src/lib/financial/|src/lib/ai/|package(-lock)?\.json|migrations"
(sin salida)
```

Cero dependencias nuevas. El contrato del orbe **lee** `cardStatementSettled` de
`src/lib/financial/card-cycle.ts` —importar no es cambiar— y no modifica una
línea de ese árbol.

---

### C16 · El CSS nuevo obedece la escala de N0 ✅

`N0-2` sigue verde con las reglas nuevas dentro. Desde la orden O1 del audit de
N0, esa aserción ata **por selector** en todo el archivo, así que
`.kipu-shell-orb__drop`, `.kipu-shell-orb__core` y
`.kipu-shell-orb[data-orb-fill="sin-dato"]` **están cubiertas**: cero duraciones
literales, y las dos animaciones nuevas son ambientales con su token con nombre
(`--kipu-t-breath-drop: 4.4s`, `--kipu-t-breath-core: 19s`). Las dos entraron
también a la lista de `prefers-reduced-motion`.

---

## Desviaciones

**D1 · `orb-shader.ts` no estaba en el §3.** Una línea:
`preserveDrawingBuffer: true`. La causó mi propio cambio — al dejar el canvas
puesto mientras se pausa, el último cuadro tiene que sobrevivir o el orbe se
queda en blanco, que sería otra sustitución. Ver C3.

**D2 · El denominador de Metas suma las tres partidas protegidas, no sólo
`.goals`.** El §5.3 nombra `monthlyProtected.goals`, pero el **numerador**
(`metasAmount`) suma las capas `metas` **y** `ahorro_inversion`, o sea
meta + ahorro + inversión. Con sólo `.goals` de denominador, el nivel pasaría del
100 % en cuanto hubiera ahorro o inversión. Uso
`goals + savings + investment`, que es el conjunto que le corresponde.

**D3 · El tramo `preferencias` se partió en dos.** Ver C11. El §5.5 planteaba
mover el tramo entero o no moverlo; partirlo consigue lo bueno de (1) sin el
riesgo que (1) traía.

**D4 · `SHELL_TIMING_TRAMOS` gana `pendientes`.** Consecuencia directa de D3.

**D5 · Una cuarta materia que el spec no nombra: `nucleo` para capas
líquidas.** El §5.3 dice que Patrimonio conserva su núcleo, y la doctrina dice
que sin nivel se cambia la materia — pero no decía **a qué**. Decidí que una capa
líquida sin denominador toma el mismo núcleo suspendido, porque es la única
respuesta honesta: no es un nivel (no hay techo), no es una gota (no es cero) y
no puede ser una bola hueca (es el defecto que veníamos a matar). Se ve en
`?state=sin-denominador`: Reserva con 1.200$ y sin meta muestra un núcleo azul,
no un vidrio vacío.

**D6 · `sin-dato` también recibió materia propia** (silueta punteada). El §5.4
sólo pedía que `vacío` y `sin dato` no se parecieran; para lograrlo hacía falta
darle una forma al segundo, porque hasta ahora los dos eran la misma bola hueca.

**D7 · `onTierChange`/`liveTier` se borraron.** Al salir de `showLiveCanvas`, el
tier dejó de tener consumidor en el santuario. Dejarlo habría sido dejar el cable
por el que la sustitución puede volver.

**D8 · `/dev/sistema` y `/dev/shell-preview` ganaron superficie** — la sección
`materias` (5 capas × 4 rellenos) y el escenario `sin-denominador`. Las dos están
en el §3.

---

## No verificado — y en esta etapa es mucho

N2 es la etapa más visual del bloque y este entorno **no compone cuadros**. Lo
digo entero en vez de disimularlo:

1. **La lectura del LCP** (C1). Medido: `visibilityState: "hidden"`, cero
   entradas de `largest-contentful-paint`. **Las dos hipótesis del §4 siguen
   abiertas y sólo el founder puede cerrarlas.**
2. **El relevo del orbe de CSS al orbe vivo** (C2, C3). Medido: **cero cuadros de
   `requestAnimationFrame` en 1500 ms**. El orbe vivo nunca pinta aquí, así que
   `liveReady` nunca se enciende y el relevo —lo único que N2 deja como cambio
   visible— **no lo vio nadie todavía**. Es la pregunta más importante para el
   founder: *¿se nota el relevo?*
3. **El hito `orbe` después de N2** (C11, C12). `/app` necesita sesión; no hay
   credenciales de QA. El «después» es una **proyección estructural**, no una
   medición.
4. **Que la gota y el núcleo se vean bien en un teléfono.** Los vi en este
   navegador a 375×812 y los tres estados se distinguen sin esfuerzo, pero el
   juicio de acabado es del founder en su pantalla.
5. **La materia del orbe VIVO.** Le pasé la materia al shader (una capa sin
   denominador toma el material 3, el núcleo de cristal) pero **no pude verlo**:
   sin cuadros no hay WebGL. El código está pinchado; la imagen no.
6. **La gota no existe en el shader.** Es un residuo consciente: `orbFill`
   decide `gota` y el orbe de CSS la dibuja; el orbe vivo, en cero, dibuja su
   estado `empty` de M2. Al relevarse, **la gota desaparece**. No toqué el shader
   porque el §3 no lo pide y porque no puedo ver lo que escribiría. **Si al
   founder le molesta, es trabajo de N3 y son ~15 líneas de GLSL.**
7. **fps y consumo con el orbe siempre encendido.** N2 quitó la degradación
   automática: si un teléfono de gama baja sufre, ya no baja solo. Es
   deliberado —un orbe modesto y estable se ve mejor que uno bueno que
   parpadea— pero **hay que mirarlo en un Android de gama media**, que ningún
   circuito de este proyecto puede sustituir.
8. **`prefers-reduced-motion`.** Agregué la gota y el núcleo a la lista que apaga
   animaciones; no pude ejercer el media query.

---

## Lo que le dejo a N3

1. **El LCP primero.** Si la foto dice `canvas.kipu-live-orb__canvas`, el trabajo
   de N2 sobre la sustitución es también rendimiento y conviene medir de nuevo
   antes de tocar nada más. Si dice `span.kipu-shell-amount`, entonces los
   ~2,2 s de cliente son **bajar e hidratar JS** y ésa es una etapa propia — y el
   candidato natural es el bundle del santuario, que arrastra el shader completo.
2. **La gota no cruzó al shader** (punto 6 de arriba). Es el único sitio donde el
   relevo todavía cambia algo a la vista, y sólo en el caso «cero».
3. **La doctrina quedó escrita en código, no sólo en un documento:**
   `shell-orb-contract.ts` la enuncia y `orbFill` la ejecuta. *Si el motor no
   puede afirmar un nivel, se cambia la materia — no se apaga el orbe.* N3–N7 la
   heredan gratis.
4. **`preferencias` está en el camino crítico ahora.** Si alguna etapa agrega
   trabajo a esa lectura, se lo cobra el orbe. La partición del tramo (D3) está
   hecha justamente para que eso sea visible en el metro.
5. **Un comentario volvió a disparar un pin, por tercera vez en el bloque.** El
   conteo de `setLiveReady(` daba 2 porque el comentario que explica el latch lo
   nombra. N1 lo pagó dos veces (`throw movementError`, `supabase-admin`) y dejó
   `n1Code()` para stripear comentarios: **usalo desde el principio en cualquier
   pin que cuente o prohíba una cadena.**
6. **Los residuos de N1 siguen abiertos y no los pagué por compromiso**, como
   pide el §5.6: `AUD-N1-D` (cablear `lastMovementReadFailed: false` pasa el
   gate) y el residuo de O3 (`const x = algoAsync()` sin `await` es invisible
   para `N0-6`). N2 no tocó esas zonas.

---

## Ronda 2

Respuesta a `N2_AUDIT.md` §5. Las dos órdenes están pagadas.

Y antes que nada: **el auditor tiene razón, y el defecto de O1 es peor de lo que
yo lo había mirado.** No es un tecnicismo del gate — es la pantalla del día uno
diciéndole a un usuario nuevo «no pude leer esto» **mientras** lo invita a crear
su primera meta. Es la frase con la que se abrió el Bloque N, dibujada por mí, en
la etapa que existía para matarla. No lo vi porque miré el escenario `dia-1` como
una lista de materias y no como lo que un humano ve al abrir la app.

---

### O1 · El día uno no puede decir «no pude leer» cuando leyó ✅

**La causa raíz, tal como la diagnosticó el audit:** `shell-payload.ts` usaba
`null` para dos cosas opuestas —«no hay ninguna meta» y «no pude leer»— y
`orbFill` no podía distinguirlas. Dibujaba el anillo fantasma en las dos.

**El arreglo: `orbFill` recibe la afirmación, no la infiere.**

```diff
 export function orbFill(input: {
   kind: OrbKind;
   amount: number | null | undefined;
   level: number | null | undefined;
+  /** El veredicto de LECTURA del motor. `false` es «no sé», no «no hay». */
+  readOk: boolean;
 }): OrbFill {
-  if (input.amount == null || !Number.isFinite(input.amount)) return "sin-dato";
+  if (!input.readOk) return "sin-dato";
+  if (input.amount == null || !Number.isFinite(input.amount)) return "gota";
   if (Math.abs(input.amount) <= ZERO) return "gota";
```

**Y el veredicto sale de la misma señal con la que el payload elige el
`emptyInvite`**, como indicaba la orden — sólo que ahora esa decisión vive en el
contrato puro y no en un ternario de la superficie:

```ts
metasRead({ reservedTotal, hasEntity, assetsAvailable })   // ctx.assetsAvailable
patrimonioRead({ netWorth, wealthAvailable })              // goalsIntel.wealthAvailable
briefedRead(amount)   // Saldo, Reserva y Deuda: llegar hasta aquí ES el veredicto
```

Para Patrimonio hay una confirmación del propio motor, que dice literalmente lo
mismo en `coaching-signals.ts:1437`: *«con false, netWorth null es "no pude leer"
y ningún tool afirma ausencia»*. Y con `wealthAvailable` en `true`, un patrimonio
ausente vale cero — que es exactamente lo que el motor escribe en su foto diaria
(`netWorth?.totalNetWorth ?? 0`). No inventé una convención: usé la suya.

**Las tres frases de Metas y las dos de Patrimonio son idénticas**; lo que cambió
es de qué dependen. Antes ramificaban sobre `metasAmount == null`, que significaba
dos cosas a la vez; ahora sobre el veredicto.

#### Prueba sin navegador — el gate ejecuta las dos ramas

```
orbFill({ kind:"metas",      amount:null, level:null, readOk:true  })  === "gota"
orbFill({ kind:"metas",      amount:null, level:null, readOk:false })  === "sin-dato"
orbFill({ kind:"patrimonio", amount:null, level:null, readOk:true  })  === "gota"
orbFill({ kind:"patrimonio", amount:null, level:null, readOk:false })  === "sin-dato"
orbFill({ kind:"saldo",      amount:82.4, level:0.64, readOk:false })  === "sin-dato"
   ← ni un monto CON nivel puede tapar una lectura caída

metasRead({ reservedTotal:null, hasEntity:false, assetsAvailable:true  })  → { ok:true,  amount:0 }
metasRead({ reservedTotal:null, hasEntity:false, assetsAvailable:false })  → { ok:false, amount:null }
patrimonioRead({ netWorth:null, wealthAvailable:true  })                   → { ok:true,  amount:0 }
patrimonioRead({ netWorth:3480, wealthAvailable:false })                   → { ok:false, amount:null }

y en las CINCO capas:  orbFill(amount:0, readOk:true) ≠ orbFill(amount:0, readOk:false)
```

#### Prueba con navegador — `?state=dia-1`, las cinco coherentes

Servidor recién arrancado con `.next` borrado, 375×812:

```
saldo      · gota · pieza=drop · 0$ · «Vacío hasta mañana — vuelven 24$ al amanecer.»
reserva    · gota · pieza=drop · 0$ · «Tu respaldo se construye solo, mes a mes…»
metas      · gota · pieza=drop · 0$ · «¿Armamos tu primera meta? Cuéntame qué sueñas.»
patrimonio · gota · pieza=drop · 0$ · «Aún no hay un patrimonio para mostrar…»
deuda      · gota · pieza=drop · 0$ · «Sin deudas registradas…»
```

**Cinco orbes con materia coherente con su texto, y ningún círculo punteado en
una capa que se leyó bien.** Las dos capas que faltaban ahora muestran su `0$`
como el resto, que era la otra mitad de la queja del audit.

Capturé Metas, que era la peor: vidrio entero, gota sobre su menisco, **`0$`**,
«Por aportar este mes», y la invitación en la píldora.

**Y la contracara, que importa igual:** agregué el escenario `?state=lectura-caida`
—Metas y Patrimonio con la lectura caída de verdad— y ahí el anillo punteado
sigue estando, con «No puedo confirmar tus metas e inversiones ahora». Las dos
capturas son la misma capa, la misma pestaña, y no se parecen en nada:

```
?state=dia-1          → metas: gota      (leí, no hay nada)
?state=lectura-caida  → metas: sin-dato  (no pude leer)
```

**La materia sigue a la afirmación, no a un `null`.**

---

### O2 · Un denominador de dinero no se puede cablear a mano ✅

La derivación de los tres denominadores pasó al contrato puro y el gate la
ejecuta, con el patrón de `cintaState` un eslabón más arriba:

```
reserveTargetFrom({ prefsError:false, raw:2400   })  === 2400
reserveTargetFrom({ prefsError:false, raw:"2400" })  === 2400
reserveTargetFrom({ prefsError:true,  raw:2400   })  === null   // no leyó
reserveTargetFrom({ prefsError:false, raw:null   })  === null   // no declaró
reserveTargetFrom({ prefsError:false, raw:0      })  === null
reserveTargetFrom({ prefsError:false, raw:"x"    })  === null

goalsPlannedFrom({ goals:300, savings:80, investment:40 })  === 420

debtCycleCardsFrom([ tarjeta USD, tarjeta ARS, préstamo ])
  → 2 tarjetas (el préstamo no tiene corte y no entra)
  → remanente en moneda NATIVA: 620 y 45000 (no el reexpresado a base)
  → debtCycleLevel(...) === null   (dos monedas ⇒ el motor no puede afirmar el ratio)
```

Y en la superficie ya no queda dónde escribir un literal: `N2-6` exige que el
payload **derive** (`reserveTargetFrom({`, `goalsPlannedFrom(monthlyProtected)`,
`debtCycleCardsFrom(ctx.debtAccounts)`) y prohíbe que vuelva a aparecer un
`statementCovered:`, un `statementTotalDue:` o un `Number(prefs` a mano.

**Un hallazgo lateral que salió al escribir el pin:** la meta de respaldo se
derivaba **dos veces** —una para el orbe y otra, copiada, dentro de la
perspectiva— y sólo una pasaba por el contrato. Ahora hay **un solo dueño**, y el
pin lo exige contando las dos llamadas.

#### Las dos mutaciones del audit, cayendo por nombre

```
### AUD-N2-D (denominador de respaldo cableado a 1000) :: GATE EXIT 1
✗ N2-6 · la derivación de los tres denominadores es pura y ejecutable;
         ninguno se puede cablear a mano
871/872 capture checks

### AUD-N2-E (statementCovered: true cableado) :: GATE EXIT 1
✗ N2-6 · la derivación de los tres denominadores es pura y ejecutable;
         ninguno se puede cablear a mano
871/872 capture checks
```

Las dos revertidas: `872/872`.

---

### El agujero que encontré yo mientras cerraba O1

Con `readOk` puesto, mutué el **cable** en vez de la función:

```diff
-      readOk: metas.ok,
+      readOk: false,
```

```
### N2-MUT-F :: GATE EXIT 0
872/872 capture checks          ← pasaba
```

Es exactamente la familia que el audit nombró (`AUD-N1-D`): **la función pura
sujeta, el argumento no** — sólo que ahora sobre el cable que O1 acababa de
crear. Habría dejado la puerta abierta a que una capa se declarara ilegible con
un booleano.

Lo cerré con el mismo criterio de O2: **ninguna capa declara su lectura con un
literal.** Las cinco salen de una lectura del contrato (`briefedRead`,
`metasRead`, `patrimonioRead`) y el gate exige que cada `readOk:` del bloque
`orbs` sea un `<nombre>.ok` **cuyo nombre venga de una de esas tres llamadas**.

```
### N2-MUT-F (readOk: false)          :: GATE EXIT 1
✗ N2-4 · …  {"lecturasDeclaradas":["briefed.ok","briefed.ok","false","patrimonio.ok","briefed.ok"]}
871/872

### N2-MUT-F2 (lectura fabricada a mano) :: GATE EXIT 1
✗ N2-4 · …  {"lecturasDeclaradas":[…,"inventado.ok",…]}
871/872
```

`fogPayload` queda **fuera** de esa regla a propósito: ahí `readOk: false` es la
verdad, porque la niebla **es** una lectura caída.

Y dos mutaciones más sobre la conducta de O1, las dos por nombre:

```
### N2-MUT-E (una lectura buena vuelve a dibujar sin-dato) :: GATE EXIT 1
✗ N2-4 ·  {"leyoYNoHay":"sin-dato","noPudoLeer":"sin-dato"}   ← las dos ramas colapsadas
871/872

### N2-MUT-G (la afirmación de Metas cableada a true)     :: GATE EXIT 1
✗ N2-4 ·  {"metasSinLectura":{"ok":true,"amount":0}}          ← afirma lo que no leyó
871/872
```

---

### Que no se rompió nada

```
$ npx tsc --noEmit                       (sin salida)
$ npm run lint                           ✖ 8 problems (0 errors, 8 warnings)  ← preexistentes
$ node scripts/qa/run-capture-gate.mjs   872/872 capture checks
$ npm run build                          BUILD EXIT=0 · ✓ Compiled successfully · ƒ Proxy (Middleware)
$ git status --porcelain | grep -E "supabase/|src/lib/financial/|src/lib/ai/|…"
                                         NINGUNA ruta prohibida
```

**871 → 872: una nueva** (`N2-6`), cero removidas, cero relajadas. `N2-4` creció
—ejecuta las dos ramas de la afirmación y pincha el cable— sin perder nada de lo
que ya probaba.

**C10 re-verificado** después de tocar el payload, los cinco taps con caché
limpia:

```
pos=0 · slide=saldo      · tab=Saldo      · capa=saldo      · acento=#4fead2 · nudo=0 · materia=nivel  · cifra=82.40$
pos=1 · slide=reserva    · tab=Reserva    · capa=reserva    · acento=#87abff · nudo=1 · materia=nivel  · cifra=1,200$
pos=2 · slide=metas      · tab=Metas      · capa=metas      · acento=#c0a2ff · nudo=2 · materia=nivel  · cifra=260$
pos=3 · slide=patrimonio · tab=Patrimonio · capa=patrimonio · acento=#bfe6f8 · nudo=3 · materia=nucleo · cifra=3,480$
pos=4 · slide=deuda      · tab=Deuda      · capa=deuda      · acento=#ffbd8e · nudo=4 · materia=nivel  · cifra=760$
```

Las cinco cifras, intactas.

---

### Lo que cambió en el árbol, respecto de la ronda 1

| Archivo | Qué |
|---|---|
| `shell-orb-contract.ts` | `orbFill` recibe `readOk` · `metasRead`, `patrimonioRead`, `briefedRead` (O1) · `reserveTargetFrom`, `goalsPlannedFrom`, `debtCycleCardsFrom` (O2) |
| `shell-payload.ts` | `ShellOrb.readOk` · las cinco lecturas salen del contrato · las derivaciones también · un solo dueño de la meta de respaldo |
| `StaticOrb.tsx` | recibe `readOk` |
| `SantuarioShell.tsx` | se lo pasa |
| `dev/shell-preview` | el día uno refleja lo que produce el payload · escenario `lectura-caida` |
| `dev/sistema` | la matriz distingue las **dos** ausencias: «leí y no hay nada» y «no pude leer» |
| `dev/capture-test` | `N2-4` crece · `N2-6` nueva |

---

### Lo que sigue sin verificar — sin cambios

La lista de ocho puntos de la ronda 1 **sigue igual de vigente**, y el audit la
dio por buena. El relevo del orbe, la materia del orbe vivo, el hito `orbe` y la
lectura del LCP siguen siendo del founder, por la misma razón medida: `0` cuadros
de `requestAnimationFrame`, `visibilityState: "hidden"`.

Lo único que esta ronda agrega a esa lista es una nota: **el día uno ahora se
puede mirar**, y es la pantalla que más conviene que mires primero
(`?state=dia-1`), porque es la que un desconocido va a ver en la prueba de
pasillo de N7.

---

### Nota de método

Dos veces en esta ronda mi propia sonda me mintió, y las dos veces re-medir lo
arregló: el pin de O2 falló porque prohibía `emergency_reserve_target)` y eso
matchea el `.select(` legítimo (el arreglo fue mejor: prohibir `Number(prefs`,
que además destapó la derivación duplicada), y el corte del bloque `orbs` salía
vacío porque `indexOf("[")` encontraba el `[` de `ShellOrb[]` y no el del array.
Van seis en el bloque. **La sonda es código, y el código nuevo se prueba.**
