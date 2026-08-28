# N1_AUDIT — Que abra

> Auditoría **en frío**. Este chat no vio la conversación del implementador.
> Entró con `stages/N1_SPEC.md`, `stages/N1_REPORT.md` y el código.
> Rama `stage-n-acabado` @ `2cc1b4a` + cambios sin commitear.
>
> **Conflicto de interés declarado:** este chat escribió `N1_SPEC.md` y auditó
> N0. No vio cómo se implementó N1, que es lo que el protocolo exige, pero sí
> tiene apego a su propio encuadre. Lo compenso de la única forma que sirve:
> todo lo de abajo está verificado **ejecutando**, y las tres acusaciones son
> **mutaciones reproducibles**, no lecturas.

---

## Veredicto

# ⛔ ROJO  ·  *(ronda 1 — resuelto en la ronda 2, ver el final del archivo)*

**Y hay que leerlo bien: es un ROJO de VERIFICACIÓN, no de construcción.**

Todo lo que N1 construyó, funciona — y lo comprobé yo, no lo leí. El hilo salió
de verdad (61.364 B, cero lecturas), el orbe se pinta en el primer volcado a los
70 ms, el movimiento ilegible degrada honestamente, las cinco cifras no se
movieron, el archivo de sesión está bien escrito y bien acotado, y la región
está bien mapeada. El reporte es honesto y su análisis de B17 es correcto y
valiente.

El ROJO es por otra cosa: **tres promesas de esta etapa no están sujetas por
ninguna aserción**, y dos de ellas las desactivé a mano con el gate en
**866/866**. Una de esas dos es *la promesa titular de N1*, y su mutación
produce en pantalla exactamente el defecto que N1 vino a matar.

Tres órdenes, todas baratas. El código no se toca; se arreglan los pines.

---

## 1. Lo que corrí yo mismo — y está verde

```
$ node scripts/qa/run-capture-gate.mjs      866/866 capture checks   (exit 0)
$ npm run lint      ✖ 8 problems (0 errors, 8 warnings)  ← preexistentes, en scripts/qa/
$ npm run build     BUILD EXIT=0 · ƒ Proxy (Middleware)
```

`ƒ Proxy (Middleware)` en la salida del build es la prueba dura de que Next 16
tomó `src/proxy.ts` **por la convención**. La trampa del nombre no se pagó.

| # | Criterio | Cómo lo verifiqué yo |
|---|---|---|
| **B1** | Línea base | Está en `N1_SPEC.md §4.1`, tomada por el founder antes del primer cambio. Los cuatro tramos suman el total exacto en las dos corridas |
| **B2** | El hilo no viaja | **Medido:** respuesta inicial **61.364 B** (coincide al byte con el reporte) · `readThreadView` aparece **0 veces** en `shell-payload.ts` · no existe campo `thread:` · `hilo` no está en `SHELL_TIMING_TRAMOS` |
| **B5** | Nada decorativo es fatal | **En el DOM,** `?state=movimiento-ilegible`: las cinco cifras intactas, cinta como `sin-dato`/`interrumpida` con `—` y «No pude leer tu último movimiento», `cintaVacia: false`, `pill: true` |
| **B7** | El orbe primero | **Medido por mí en el stream HTTP:** `70 ms orbe+cifra (82.40$)` · `70 ms hueco pill` · `70 ms hueco cinta` · `965 ms PILL`. El orbe está en el primer volcado |
| **B9** | El archivo de sesión | Leí `src/proxy.ts` entero: sólo renueva, sin `redirect(`, sin service-role, falla abierto. **Ejecuté el `matcher`** contra 18 rutas (ver §3) |
| **B11** | La región | **Verificado en los docs de Vercel**, no de memoria: `cle1 → us-east-2 → Cleveland`, y el default es `iad1 → us-east-1`. Vercel dice literalmente que las funciones deben correr en la región de la base |
| **B13** | Gates | 860 → 866, seis nuevas. **Las 26 líneas borradas son exactamente las tripas de los dos pines re-anclados**, ninguna otra |
| **B16** | Ningún número cambió | **Los cinco taps, medidos a 375×812:** paridad total y `82.40$ · 1,200$ · 260$ · 3,480$ · 760$` |

**Los dos re-anclajes, revisados uno por uno:**

- **`N0-3` — legítimo y más fuerte.** Cambia orden-en-el-fuente por contención.
  Verifiqué la estructura: `return (` en la línea 553 y `<main` en la 554, con
  `</main>` en la 955 — **el `<main>` es la raíz única del return**, así que no
  puede haber hermanos. Sumado a `createPortal` prohibido y a una sola raíz
  `kipu-santuario`, la contención queda probada. Y la comprobé en el DOM tras la
  reestructuración: `conDigitos: 12 · sinTabular: 0 · superficiesFueraDelMain: 0`.
  Es la orden **O2 del audit de N0**, pagada.
- **`N0-6` — legítimo, con un agujero** (ver §2.1). Separar tramos de hitos es
  correcto: el builder pasó de una línea de meta a tres.

---

## 2. Las tres acusaciones — todas reproducibles

### 2.1 · La promesa titular de N1 no está sujeta — `AUD-N1-C`

Desactivé la rama que dibuja el movimiento ilegible como `sin-dato`:

```diff
- if (!movement && resolved.lastMovementReadFailed) {
+ if (false) {
```

```
### AUD-N1-C :: GATE EXIT 0
866/866 capture checks
```

**Pasa.** Y no es cosmético: con la mutación puesta, medí la pantalla real.

```
cintaVacia:       true      ← LA CINTA VACÍA PROHIBIDA
diceNoPudeLeer:   false
estadosSinDato:   0
```

Es decir: **el gate en verde mientras la pantalla comete el defecto exacto que
N1 existe para matar** — un movimiento que no se pudo leer dibujado como «no hay
nada». La doctrina monetaria del proyecto, incumplida en pantalla, sin que nada
se queje.

La mitad del payload sí está bien sujeta (`throw movementError` muerto, la
bandera producida). Lo que no está sujeto es que **el santuario haga algo con la
bandera**.

**Causa raíz:** la cláusula que debía sujetarlo es

```ts
n0ShellSource.indexOf("resolved.lastMovementReadFailed") <
  n0ShellSource.indexOf("kipu-shell-cinta--empty")
```

y cuando la aguja **no existe**, `indexOf` devuelve `-1`, que es menor que
cualquier posición. **La ausencia satisface su propia prueba de orden.**

```
CON guard   indexOf(guard)=  0   indexOf(otro)= 26   → pasa: true
SIN guard   indexOf(guard)= -1   indexOf(otro)=  0   → pasa: true   ← el defecto
```

### 2.2 · El guard de privacidad se puede borrar entero — `AUD-N1-B`

Quité la línea completa de `thread-actions.ts`:

```diff
- if (prefsError) return { turns: [], complete: false, readFailed: true };
```

```
### AUD-N1-B :: GATE EXIT 0
866/866 capture checks
```

Ese guard es el que impide que, al no poder leer `chat_cleared_at`, se lea el
hilo entero y se muestren **mensajes que el usuario mandó ocultar**. Es la
promesa de M4 —«oculta sin borrar»— mudada de sitio. Se puede borrar en silencio.

Misma causa raíz que 2.1: `n1ThreadAction.indexOf("if (prefsError)") <
n1ThreadAction.indexOf("readThreadView({")`, con `-1` pasando.

El reporte dice en B4 que el orden «es lo que impide que alguien mueva el guard
debajo». Eso es **literalmente cierto** para el caso de *mover*. No cubre
*borrar*, que es el caso fácil.

### 2.3 · El metro puede dejar de cubrir el camino de render — `AUD-N1-A2`

Colé una operación async de 250 ms **sin instrumentar** dentro del `Promise.all`
del camino de render:

```diff
  const [{ pendingRead }, movementRead] = await Promise.all([
    prefsPromise,
    movementPromise,
+   new Promise((resolve) => setTimeout(resolve, 250)),
  ]);
```

```
### AUD-N1-A2 :: GATE EXIT 0
866/866 capture checks
```

`N0-6` vigila **awaits**. Una promesa que nace sin la palabra `await` es
invisible. El reporte dice que el barrido «pasa a cubrir todo el camino de
render»; cubre todo el camino *que llega por `await`*.

Importa más ahora que en N0: N1 convirtió el builder en una arquitectura de
promesas paralelas, así que nacer-sin-await es **la forma natural de agregar una
lectura**. Si N2 agrega una así, el metro deja de medir el camino de render en
silencio y las mediciones del founder subestiman el tiempo real.

*(Mi primera sonda de esto usó `loadSnapshotSeriesRead` y murió por `M6-4`, que
cuenta esa llamada. Repetí con algo que ningún otro pin cuenta para aislar el
hallazgo. Re-medir antes de acusar, otra vez.)*

### El patrón es de la casa, no de N1 — pero N1 lo repitió donde más duele

Barrí las 164 apariciones de `indexOf` del gate: hay **≈14 sitios** que comparan
posiciones, y **la mayoría ya se protege** con `includes(...)`, `> 0`, `>= 0` o
un conteo previo — IR98, IR94, IR100, IR81 y el propio **M9-1** lo hacen bien.
La convención correcta ya existe en el archivo.

Los dos sitios nuevos de N1 la omitieron, y hay ≈12 preexistentes que también
(IR47, IR49, IR134, IR144, IR328, PM…). **Esos doce no son deuda de N1** y no se
los cargo; quedan como hallazgo separado para que el founder los agende.

Es, además, la quinta repetición de una lección ya escrita en la doctrina del
proyecto: *preguntá siempre qué haría el test si lo probado NO existiera.*

---

## 3. Verificaciones extra que hice

**El `matcher` del proxy, ejecutado** contra 18 rutas reales en vez de leído:

```
CORRE    /app · /app/saldo · /login · /onboarding · /dev/shell-preview · /
excluye  /api/cron/ambient-loop · /api/telegram/webhook · /api/anything
excluye  /_next/static/... · /_next/image · /sw.js · /offline.html
excluye  /manifest.webmanifest · /favicon.ico · /icon.svg · /logo.png · /robots.txt
```

Exactamente lo declarado: corre donde hay sesión de navegador, no toca los crons
ni el webhook de Telegram ni un solo estático.

**El duplicado que investigué y NO era un defecto.** En el escenario del
movimiento ilegible aparecen dos nodos `sin-dato`. Medí antes de acusar: el
segundo está dentro de un `<div hidden style="display:none">` colgado del
`<body>` — el área de parqueo de React durante el streaming. Rect 0×0,
`offsetParent === null`. No se ve y no es un duplicado real.

---

## 4. Órdenes

### O1 — Que una comparación de posición no pueda pasar por ausencia

En `N1-2` y `N1-3`, toda comparación `indexOf(a) < indexOf(b)` debe exigir
**primero la presencia** de las dos agujas. La convención ya está en el archivo
(`includes(...) && indexOf(...) <`); es aplicarla.

**Prueba de que quedó hecho:** `AUD-N1-B` y `AUD-N1-C` (§2.1 y §2.2, con el
diff exacto arriba) deben **fallar por nombre**. Pegar la salida.

### O2 — Sujetar la degradación honesta por CONDUCTA, no por orden de texto

O1 tapa el agujero; O2 sujeta la promesa como corresponde. Que la decisión
«¿qué dibuja la cinta?» viva como **función pura** que el gate **ejecuta**,
igual que hizo N0 con `state-contract.ts` — que es el patrón bueno que este
bloque ya tiene:

```
cintaState({ movement: null, readFailed: true })  === "sin-dato"
cintaState({ movement: null, readFailed: false }) === "vacio"
cintaState({ movement: {...},  readFailed: false }) === "real"
```

Con eso, `if (false)` deja de ser una mutación que pasa: la conducta se prueba
ejecutándola y el santuario sólo consume el resultado. Es más barato de sostener
que cualquier comparación de cadenas, y N2–N6 lo heredan.

### O3 — Que el metro no pueda dejar de cubrir el camino de render

`N0-6` debe romperse cuando entra una operación async no instrumentada, llegue
por `await` o no. La forma más simple que se me ocurre: exigir que en el tramo
de render no haya `new Promise(`, y que **todo elemento de un `Promise.all([`
sea un identificador ya declarado como promesa medida**. Elegí la prueba, no la
implementación.

**Prueba de que quedó hecho:** `AUD-N1-A2` (§2.3) debe fallar por nombre.

### O4 — ~~Confirmar la región de la base~~ · **CERRADA por el auditor** ✅

Quedaba como tarea del founder porque mi primer intento no llegó. Terminé
cerrándola yo, y conviene dejar escrito **cómo**, porque el camino obvio miente:

- **El rastreo por IP no sirve.** El host del proyecto resuelve a
  `172.64.149.246` y `104.18.38.10`, que son de **Cloudflare** — Supabase pone
  CDN delante de la API. Buscar esas IPs en los rangos oficiales de AWS habría
  dado «ninguna región», que es una respuesta falsa, no una ausencia.
- **La fuente autoritativa es la Management API de Supabase**, vía el conector.
  Mi primera búsqueda de la herramienta falló porque pedí `list_projects` al
  servidor equivocado: el que está montado sobre el proyecto no la expone; la
  expone el servidor de organización.

```json
{ "name": "fincoach-mvp", "ref": "xgapsonlkymfhxmqzqdn",
  "region": "us-east-2",  "status": "ACTIVE_HEALTHY",
  "database": { "version": "17.6.1.111", "postgres_engine": "17" } }
```

**La base vive en `us-east-2`.** Con `cle1 = us-east-2` (docs de Vercel, §1),
la región fijada por N1 es **correcta**: las funciones quedan en la misma región
que la base. Y confirma que el cambio no es cosmético — el default `iad1` es
`us-east-1` (Virginia), o sea que hasta hoy **cada lectura cruzaba de región**,
y `contexto` y `briefing` hacen muchas.

`B11` queda verificado de punta a punta: mapeo, región real y crons intactos.

---

## 5. Observación (no es orden, y no es de N1)

`src/app/app/layout.tsx:17` decide el guard de sesión de todo `/app` con
`getSession()`. La guía de Supabase es que en servidor la autorización se decida
con `getUser()`, que valida contra el servidor de auth, porque `getSession()`
decodifica la cookie local. **Es preexistente al Bloque N y N1 no lo cambió** —
el proxy usa `getSession()` para lo que sí corresponde, que es preguntar «¿hay
que renovar?», y esa elección la comparto y está bien argumentada en el archivo.

Lo dejo señalado porque es la primera vez que este track mira código de auth. **No
verifiqué si es explotable** con la versión de `@supabase/ssr` de este árbol; no
afirmo que lo sea. Merece una mirada propia, fuera del Bloque N.

---

## 6. Lo que este entorno no pudo verificar

1. **`/app` con sesión real.** Sin credenciales de QA. Por eso el «después» de
   B2 y B17 sigue siendo **proyección**, como el reporte declara con honestidad.
   La medición real es del teléfono del founder.
2. **Una sesión vencida entrando sin error** (B9). Necesita un token caducado.
   Probado todo lo demás del mecanismo.
4. **El fotograma intermedio del streaming.** El orden **sí** está medido, por mí
   y por el implementador, en el stream HTTP con marcas de tiempo — evidencia más
   fuerte que una captura.
5. **LCP, INP y CLS.** Pestaña oculta. Y como quedó escrito en `N1_SPEC §7.6`,
   además necesitan un toque o que la página se oculte.
6. **Que el hilo traiga los mismos turnos** en una cuenta con historial real.

---

## 7. Qué tiene que pasar para el VERDE

Una ronda corta. **No hay que tocar el producto:** las tres órdenes son del
gate, y una de ellas (O4) es tuya, no del implementador.

El implementador responde O1, O2 y O3 en una `## Ronda 2` del reporte, pegando
la salida de las tres mutaciones **fallando por nombre**. Yo las vuelvo a correr
y, si caen, esto pasa a VERDE. **O4 ya está cerrada** — no queda nada del founder
en el camino crítico.

Vale la pena decirlo claro para que la ronda no se lea como un castigo: **N1 es
el mejor trabajo del bloque hasta ahora.** Sacó 463 kB de cada carga, midió el
antes con bytes reales, encontró y declaró que la promesa de 1,5 s no se alcanza
en frío en vez de maquillarla, y documentó un defecto propio (el *thenable* del
stream) que le va a ahorrar media hora a N2. Lo que falta es que los pines
sujeten lo que el reporte dice que sujetan.

---

# Ronda 2 — veredicto

# ✅ VERDE

Las tres órdenes están pagadas. **Las verifiqué re-corriendo mis propias
mutaciones**, no leyendo el reporte: las tres que en la ronda 1 pasaban con el
gate en verde, ahora **caen por nombre**.

```
### AUD-N1-C  (apagar el despacho de sin-dato)      :: GATE EXIT 1
✗ N1-3 · el último movimiento ilegible degrada y se dice; no tumba la pantalla
   {"sigueTirando":false,"conducta":["sin-dato","vacio","real"],
    "despachaSinDato":false,"ceroProhibido":true}          865/866

### AUD-N1-B  (borrar el guard de chat_cleared_at)  :: GATE EXIT 1
✗ N1-2 · el punto de corte del hilo viaja con él
   {"leeCorte":true,"guardConEfecto":false}                865/866

### AUD-N1-A2 (async sin medir en el render)        :: GATE EXIT 1
✗ N0-6 · un tramo nombrado por cada await del santuario
   {"esperasFabricadas":1,
    "enPromiseAllSinMedir":["new Promise((resolve) => setTimeout(resolve, 250))"]}
                                                            865/866
```

Y verifiqué también las dos que el implementador dice haber cubierto por su
cuenta. **Las dos caen**, y su reporte es exacto:

```
### B2 · VACIAR el guard conservando su apertura   :: ✗ N1-2  {"guardConEfecto":false}
### C2 · romper la CONDUCTA de cintaState          :: ✗ N1-3  {"conducta":["vacio","vacio","real"]}
```

**O1+ merece reconocimiento explícito.** El implementador no se limitó a la
orden: encontró que `includes("if (prefsError)")` prueba que alguien escribió
una apertura, no que el guard **haga** algo, y cerró el vaciado además del
borrado. Eso es la lección buena —*qué haría el test si lo probado no
existiera*— llevada un paso más lejos que como yo la escribí.

**O2 es el arreglo correcto, no un parche.** `cintaState` es una función pura
que el gate **ejecuta**, en el módulo puro que el santuario ya tenía — cero
archivos nuevos. Es el patrón de `state-contract.ts` que N0 dejó, y ahora N2–N6
lo heredan para cualquier decisión de «qué se dibuja».

## Lo demás, verificado por mí

```
866/866 capture checks · lint 0 errores (8 warnings preexistentes) · build EXIT=0
866 assert() ahora vs 860 en HEAD · ninguna aserción desapareció (diff de nombres vacío)
```

**O2 tocó producto, así que re-medí la pantalla** en vez de creerle:

```
· degradado (?state=movimiento-ilegible)
  cifras 82.40$ · 1,200$ · 260$ · 3,480$ · 760$ · sinDato 1 · cintaVacia FALSE
  «No pude leer tu último movimiento» presente · píldora presente
· normal
  cinta real −4.50$ · cintaVacia FALSE · sinDato 0 · mismas cinco cifras
· cinco taps
  paridad posición/slide/tab/capa/nudo/cifra: TOTAL · cifras idénticas
```

El refactor de O2 conservó la conducta exactamente.

## Un hallazgo nuevo que NO abre una tercera ronda — `AUD-N1-D`

Ataqué el eslabón que ninguno de los dos había probado: **la entrada** de la
función pura.

```diff
- lastMovementReadFailed: movementRead.readFailed,
+ lastMovementReadFailed: false,
```

```
### AUD-N1-D :: GATE EXIT 0     866/866 capture checks
```

Con eso el payload afirma siempre «leí bien», `cintaState` recibe
`readFailed: false`, devuelve `"vacio"` y vuelve la cinta vacía prohibida — el
mismo defecto de la ronda 1, un eslabón más arriba. La cadena tiene cuatro
eslabones y ahora hay tres sujetos: la conducta, el consumo y el despacho. El
cuarto —el cable desde el resultado de la lectura hasta el campo del payload—
no lo está.

**Por qué no lo convierto en orden y no pido otra ronda:**

1. **La vara de la ronda 1 fueron tres pruebas concretas, y se cumplieron
   exactamente.** Mover el poste cada ronda hace que una auditoría no se pueda
   aprobar nunca, y eso la vuelve inútil.
2. **El arreglo barato sería malo.** Un
   `includes("lastMovementReadFailed: movementRead.readFailed")` es exactamente
   la clase de pin de cadena que esta ronda acaba de quitar: se satisface con que
   el texto exista aunque algo lo pise después.
3. **El arreglo bueno no es de N1.** Cerrarlo de verdad pide recorrer la cadena
   entera con datos, que es el E2E de persona desechable que el proyecto ya usa
   para los caminos de dinero — fuera del alcance declarado de esta etapa.

Queda **anotado para el spec de N2**, junto al residuo que el propio
implementador declaró en O3 (`const x = algoAsync();` sin `await` y fuera de un
`Promise.all` sigue siendo invisible). Son dos residuos de la misma familia,
los dos dichos en voz alta. Declarar un agujero conocido vale más que taparlo
con un pin que miente.

## Lo que este entorno sigue sin poder verificar

Sin cambios respecto de la ronda 1: `/app` con sesión real, una sesión vencida
entrando sin error, el fotograma intermedio del streaming, LCP/INP/CLS, y que el
hilo traiga los mismos turnos en una cuenta con historial. **El «después» de B2
y B17 sigue siendo una proyección**, y su medición real es del teléfono del
founder — igual que lo fue la línea base.

## Cierre

N1 queda **VERDE** y es el mejor trabajo del bloque: sacó 463 kB de cada carga,
midió el antes con bytes reales, declaró con su número que la promesa de 1,5 s
no se alcanza en frío en vez de maquillarla, y en esta ronda endureció tres
pines sin agregar una sola aserción ni cambiar una conducta.

---

# Medición real en producción — 2026-08-28, `ef6f56d`

Cierra el «No verificado #1» de las dos rondas: **el después ya no es una
proyección.** Dos corridas del founder en su iPhone contra producción, tras una
carga de descarte para no medir el arranque en frío del deploy.

| | Línea base (`221575b`) | **Real (`ef6f56d`)** |
|---|---|---|
| | frío / caliente | frío / recarga |
| `contexto` | 881 / 378 | **181 / 141** |
| `hilo` | 1626 / 474 | **fuera** |
| `briefing` | 916 / 818 | **439 / 531** |
| `cotizaciones` | 1 / 1 | 158 / 79 |
| hito **`orbe`** | — | **620 / 672** |
| hito `píldora` | — | 621 / 673 |
| hito `perspectiva` | — | 660 / 703 |
| total | 3896 / 1963 | — *(reemplazado por los tres hitos)* |
| TTFB | 248 / 121 | **124 / 41** |

**El instrumento vuelve a cerrar consigo mismo**, que es lo primero que hay que
comprobar antes de creerle a un número: `contexto + briefing` da **exactamente**
el hito `orbe` en las dos corridas (181+439=620 · 141+531=672).

## La cifra del orbe

```
FRÍO      4144 ms  →   744 ms     (−82 %)
RECARGA   2084 ms  →   713 ms     (−66 %)
PANTALLA COMPLETA (hasta la perspectiva), frío:  4144 → 784 ms
```

**La promesa de ~1,5 s se cumple, y en frío.** El reporte la había declarado
incumplida en frío con una proyección de ~2045 ms; la realidad da **744 ms**,
**1301 ms mejor que lo proyectado**.

Declarar el incumplimiento en vez de maquillarlo fue lo correcto, y el que se
equivocó fui yo tanto como el implementador: **la proyección excluía el cambio
de región porque nadie sabía cuánto valía.** Valía casi todo lo que faltaba.

## Por qué bajó tanto lo que la proyección daba por fijo

- **`contexto` 881 → 181 ms (−79 %).** `buildUserFinancialContext` hace muchas
  consultas; con las funciones en Virginia y la base en Ohio, cada una pagaba un
  salto entre regiones. Del orden de 15–25 ms × unas treinta consultas da
  450–750 ms, que es casi exactamente lo que desapareció. La explicación cuadra
  en magnitud, no sólo en dirección.
- **`briefing` 916 → 439 ms (−52 %).** Lo mismo, en menor proporción: parte de
  su costo no son viajes a la base.
- **`hilo` 1626 → fuera.** Estructural: el builder ya no sabe leerlo.

**El caveat honesto:** las dos corridas no están perfectamente controladas. La de
hoy tuvo la función caliente (pedí una carga de descarte a propósito); no sabemos
si la línea base la tuvo. Pero un arranque en frío de la función infla el
**TTFB**, no un tramo interno — y el TTFB sólo bajó de 248 a 124. La caída de
`contexto` no se explica por eso.

## Lo que el streaming consiguió, y lo que no hizo falta

En producción **la píldora llega 1 ms después del orbe y la perspectiva 40 ms
después**. Las cinco lecturas que salieron del camino crítico
—`preferencias · movimiento · recibo · historia · cotizaciones`, 554 ms sumados—
caben enteras dentro de la ventana del orbe (620 ms), así que hoy no se ve una
sola pantalla a medio llenar.

Eso no vuelve inútil el trabajo: significa que **el orbe ya no puede ser
retrasado por ninguna de ellas**. Cuando una se ponga lenta o se caiga —que es
el caso que N1 vino a arreglar— la cifra sigue apareciendo a los 620 ms. La
promesa era esa, y la forma fuerte se cumple: el orbe no corre ninguna carrera.

## Un detalle nuevo para N2

**`cotizaciones` pasó de 1 ms a 158 ms.** No es un defecto y hoy no cuesta nada
—corre en paralelo y cabe dentro de la ventana del orbe—, pero es real: antes
corría *después* del briefing y encontraba el trabajo ya hecho; ahora arranca al
principio y paga la lectura de verdad.

Importa como **piso futuro**: si N2 lograra bajar `contexto + briefing` por
debajo de ~158 ms, `cotizaciones` pasaría a ser el tramo que manda. Está dentro
del grupo `orbe` (`SHELL_TIMING_GROUPS`), así que se vería solo en el metro.

## Lo que sigue sin medirse

**LCP, INP y CLS siguen en `—`.** La segunda foto fue una recarga, no un toque,
y esas tres necesitan una interacción o que la página se oculte (§7.6). Todo lo
de arriba es **tiempo de servidor**, que es donde estaba el problema y donde se
arregló — pero el tiempo *percibido* incluye pintar, y ése todavía no tiene
número. Un toque en la pantalla y una foto lo cierran.
