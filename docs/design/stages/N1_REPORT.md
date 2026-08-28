# N1_REPORT — Que abra

> Implementador. Contrato: `docs/design/stages/N1_SPEC.md`.
> Rama `stage-n-acabado` @ `2cc1b4a`. **Sin commits.**

---

## Ronda 1

### La línea base

Tomada por el founder en su iPhone contra producción (`221575b`) **antes** de
tocar código, y ya escrita en el spec §4.1. La repito aquí porque es el «antes»
contra el que se mide todo lo demás:

| Tramo | FRÍO (Safari recién abierto) | CALIENTE |
|---|---|---|
| `contexto` | **881 ms** (22,6 %) | 378 ms |
| `hilo` | **1626 ms (41,7 %)** | 474 ms |
| `briefing` | **916 ms** (23,5 %) | 818 ms |
| `resto` | 473 ms | 293 ms |
| **total** | **3896 ms** | **1963 ms** |
| TTFB | 248 ms | 121 ms |

Cola del `resto` en frío: `cliente 1 · preferencias 223 · cotizaciones 1 ·
historia 84 · movimiento 83 · recibo 74`.

**El después que a esta máquina le consta**, y el que le falta, están en B17.

---

### Lo que quedó construido

| Archivo | Qué pasó |
|---|---|
| `src/proxy.ts` **(nuevo)** | La renovación de sesión en el borde. Frontera de seguridad — diff completo abajo |
| `src/app/app/thread-actions.ts` **(nuevo)** | `loadThreadAction()`: el cargador del hilo bajo demanda |
| `src/lib/supabase-server.ts` | El comentario dice la verdad. Cero cambios de lógica de auth |
| `src/app/app/components/shell/shell-payload.ts` | Sale el hilo · el movimiento deja de ser fatal · el orbe se entrega y el resto se promete |
| `src/app/app/components/shell/SantuarioShell.tsx` | Tres `<Suspense>` con `use()` · el hilo se pide al abrir la hoja |
| `src/app/app/components/ChatView.tsx` | Acepta un hilo que llega después, con su estado `cargando` y su `sin-dato` |
| `src/lib/metro/metro-contract.ts` | `hilo` fuera · tramos e hitos separados · tres tandas |
| `src/app/app/components/metro/MetroOverlay.tsx` | Muestra las tres tandas |
| `src/app/globals.css` | Los dos huecos con la forma exacta de la píldora y de la cinta (+10 líneas) |
| `vercel.json` | `regions: ["cle1"]` |
| `src/app/dev/shell-preview/page.tsx` | Arnés `?lento=` y `?hilo=`, escenario «movimiento ilegible» |
| `src/app/dev/capture-test/page.tsx` | N1-1…N1-6 · N0-3 y N0-6 re-anclados |

**`src/app/app/page.tsx` NO se tocó.** El pin **M9-1** nunca tuvo que moverse:
las promesas viajan DENTRO de `payload`, así que
`const payload = await buildShellPayload(session.user.id);` y
`return <SantuarioShell payload={payload} />;` siguen literales, con un solo
`return` y un solo `redirect(`.

---

### B1 · La línea base existe, tomada antes del primer cambio ✅

Es la tabla de arriba. La tomó el founder en su teléfono con sesión real, sobre
`221575b`, y quedó escrita en `N1_SPEC.md §4.1` **antes** de que esta rama
tocara una línea. Es la orden O3 del audit de N0, pagada.

Los cuatro tramos de cabecera suman el total exacto en las dos corridas, así que
el instrumento cierra consigo mismo.

---

### B2 · El hilo no viaja en la respuesta inicial ✅ — medido, no afirmado

**Medí el «antes» con bytes reales antes de tocar `shell-payload.ts`.** Inyecté
en la maqueta 576 turnos con la forma REAL de `ThreadTurn` y la longitud media
de producción (87 kB de texto ÷ 576 mensajes = 151 caracteres), y pedí la página
por HTTP:

```
con 576 turnos: 535 446 B
sin hilo:        60 755 B
delta:          474 691 B   (463,6 kB)
```

Los ids de los turnos aparecían **1152 veces** en el HTML: 576 × 2, porque el
hilo se serializaba **dos veces** — una en el payload RSC y otra en el HTML que
`ChatView` renderiza en el servidor. Por eso el peso en el cable (463,6 kB) sale
**mayor** que los 348 kB que el plan midió en la base.

**Después**, corrida limpia (`.next` borrado, servidor nuevo):

```
respuesta inicial:            61 364 B
turnos de chat en el HTML:         0
tramo `hilo` en Server-Timing:   ya no existe
```

Los 609 B de diferencia contra los 60 755 son el marcado de los estados nuevos.
**463,6 kB salieron de cada carga**, y salieron *por construcción*: el builder ya
no sabe leer el hilo (no importa `readThreadView`), el payload no tiene dónde
traerlo, y el metro no tiene un tramo `hilo` que medir. Eso lo ata `N1-1`.

---

### B3 · Abrir la conversación trae el hilo; mientras viene, `KipuLoading`; si falla, `KipuNoData` ✅

En el navegador, sobre `/dev/shell-preview`, abriendo la hoja con el gesto real
del dock:

```
sin sesión (el caso de esta máquina):
  hojaAbierta: "true"
  estadosEnLaHoja: ["sin-dato"]
  tituloEstado: "No pude leer tu conversación ahora."
  turnos: 0

con hilo sembrado (?hilo=demo):
  turnos: ["preview-turn-user","preview-turn-kipu"]
  textos: ["Gasté 4.50 en un café", "Listo, lo anoté.Quedó registradoCafé · P…"]
  recibo: true
```

Las dos mitades del contrato, vistas: **nunca una conversación vacía**. Sin
sesión la acción responde `readFailed` y la hoja lo dice; con hilo, los turnos
llegan con su procedencia y su **recibo** («Quedó registrado · Café · …»), que es
la promesa de M3 releída del ledger.

Y antes de que la acción conteste, el hueco es `cargando/hoja` — lo confirma el
HTML servido de la carga inicial: `data-state-kind="cargando"` × 1, que es
exactamente la hoja esperando.

**No verificado aquí:** que los turnos sean **los mismos** que traía el payload
antes. Requiere una cuenta con historial real; el camino es el mismo
`readThreadView` con el mismo `since`, y eso sí está atado por `N1-2`.

---

### B4 · `chat_cleared_at` sigue ocultando sin borrar ✅

`loadThreadAction` lee el punto de corte y lo pasa como `since`, igual que hacía
el payload. Y añade una regla que antes no hacía falta: **si el punto de corte no
se puede leer, NO se lee el hilo** — leerlo entero mostraría mensajes que el
usuario mandó ocultar. Se dice `readFailed` en su lugar.

`N1-2` lo ata por forma, incluido el ORDEN (`if (prefsError)` antes de
`readThreadView({`), que es lo que impide que alguien mueva el guard debajo.

---

### B5 · Ninguna lectura decorativa es fatal ✅ — forzando el fallo

Escenario nuevo y permanente de la maqueta, `?state=movimiento-ilegible`, que
resuelve la tanda con `lastMovementReadFailed: true`:

```
bytes:                              64 252   (la pantalla se dibujó ENTERA)
cifras del carrusel:  82.40$ · 1,200$ · 260$ · 3,480$ · 760$   (intactas)
cinta como sin-dato:                  true
cinta vacía (prohibida):              false
texto honesto:  "No pude leer tu último movimiento"
cero inventado en la cinta:           false
píldora presente:                     true
```

Y en el DOM, re-medido tras hidratar:

```
estado: "sin-dato" · silueta: "interrumpida" · caja: 345×54
título: "No pude leer tu último movimiento" · cifra: "—"
hayCintaVacia: false · hayCintaReal: false
```

Antes de N1 ese mismo fallo daba la tarjeta «Algo se trabó por un momento» en
lugar de la pantalla.

*(Nota de método: mi primera lectura del DOM, a los 1500 ms, dijo `"cargando"` —
había leído antes de que hidratara la frontera. Re-medir lo corrigió. Trampa
§7.7.4, pagada otra vez.)*

---

### B6 · Lectura por lectura: cuál es fatal y cuál decorativa

Una lectura es **fatal** cuando, si falta, **una cifra mentiría**. Todo lo demás
degrada.

| Lectura | Clase | Por qué, y qué pasa si falla |
|---|---|---|
| `contexto` · `buildUserFinancialContext` | **FATAL** | Toda cifra deriva de él, y además decide el `redirect` a onboarding. Sin él no hay orbe que dibujar: propaga a `/app/error.tsx` |
| `briefing` · `buildCoachingBriefing` | **FATAL con degradado honesto** | Las **cinco** cifras del carrusel salen de aquí. `KipuSaldoUnavailableError` ⇒ **niebla** («No puedo leer tu saldo ahora» + Reintentar). Cualquier OTRA excepción sigue propagando **a propósito**: una excepción desconocida es «se rompió», no «no pude leer», y tragarla escondería defectos reales |
| `cliente` · `createSupabaseServerClient` | decorativa **en efecto** | Sólo falla sin configuración. Todo lo que lo usa (preferencias, movimiento) lo espera dentro de un `try`: su fallo apaga la píldora y la cinta, jamás el orbe |
| `cotizaciones` · `loadCurrentFxRatesForDisplay` | **decorativa** | No lanza por contrato (`readFxRates` atrapa dentro). N1 le añade `.catch(() => [])`: sin tasas, `display` cae a la moneda base — **la verdad de la fila**, no un número inventado |
| `preferencias` · prefs + `readOpenOccurrences` | **decorativa** | Alimenta la píldora (`pendingRead.ok` ya venía tipado) y el objetivo de Reserva de la perspectiva. Al fallar, el objetivo se lee **desconocido** (`readOk: false`), nunca cero |
| `historia` · `loadSnapshotSeriesRead` | **decorativa** | Tipada desde M6: `ok: false` mantiene una caída distinta de «usuario con menos de dos días» |
| `movimiento` · último movimiento | **decorativa** | **El arreglo de N1.** Aquí vivía `if (movementError) throw movementError` |
| `recibo` · `findThreadTurnForTransaction` | **decorativa** | Ya degradaba a `null` por dentro; N1 le pone además un `.catch(() => null)` |
| ~~`hilo`~~ | — | **Ya no ocurre aquí.** Se lee al abrir la conversación |

La regla que no se relajó: **degradar nunca inventa un número.** Ningún camino
de degradado escribe un cero; todos escriben «no pude leer» o `—`.

---

### B7 · El orbe y su cifra se pintan antes que la píldora y la perspectiva ✅ — medido

Medido leyendo el **stream HTTP** con marcas de tiempo, que es donde el orden de
aparición se ve de verdad. El arnés `?lento=N` de la maqueta retrasa las tandas
a propósito (es un ARNÉS, no una medición: la maqueta no mide nada y sus
cabeceras valen `null`).

```
$ curl -sN "…/dev/shell-preview?lento=900&sheet=perspectiva" | marcas

    23 ms  orbe+cifra          ← 82.40$ en el PRIMER volcado
    23 ms  hueco pill
    23 ms  hueco cinta
    23 ms  hueco perspectiva
   915 ms  PILL
  1812 ms  CINTA
  1822 ms  PERSPECTIVA
```

Estable en tres corridas (23/26/30 ms para el orbe) y sobre servidor recién
arrancado con `.next` borrado. Con `?lento=0` **todo** cae en el mismo volcado a
los 25 ms, que es el comportamiento correcto cuando nada es lento.

**Qué prueba exactamente:** el orbe y su cifra están en el primer volcado
**siempre**, y ninguna de las tres tandas puede retrasarlo — están detrás de
fronteras `<Suspense>` que se revelan solas. Es la forma fuerte de la promesa:
no es que el orbe *gane una carrera*, es que **no corre ninguna**.

**Un detalle que medí y no esperaba, y que declaro:** la CINTA se revela junto
con el último volcado, no con su propio dato. Lo comprobé variando el retraso
—`lento=300` ⇒ cinta a 614 ms; `lento=1500` ⇒ cinta a 3019 ms; siempre
`slowMs × 2`, que es cuando resuelve la perspectiva— y descarté que fuera por
las promesas que recibe el metro (las quité y el número no cambió). Es coalescencia
de volcados de React, no un `await` mío. **Magnitud en producción: decenas de
ms**, porque allí `perspectiva` resuelve ~84 ms después del orbe (`historia`),
no 900. Queda anotado para N2 por si alguna vez importa.

---

### B8 · Los huecos son los estados de N0, con la forma del sitio ✅

Nada de barras grises improvisadas: `KipuLoading shape="linea"` para la píldora
y para la cinta, `KipuLoading shape="hoja"` para la perspectiva y para el hilo.

Y **con la caja exacta del sitio que van a ocupar**, medida en el DOM:

```
cinta real:            345 × 44
hueco de la cinta:     345 × 44      ← idénticas
píldora real:          300 × 46
espaciador de la capa viva (--pill):  300 × 46
hueco de la píldora (CSS):            300 × 46
```

Los 46 px de la píldora no son estéticos: son los que mide
`.kipu-shell-live-spacer--pill`, el espaciador con el que la capa WebGL se
alinea. Si el hueco divergiera, el orbe vivo se desalinearía del estático al
llegar la tanda. Cero salto de layout **por construcción**, no por suerte.

El CSS nuevo son 10 líneas y vive dentro del espacio de nombres del santuario,
así que **la regla de N0 lo alcanza**: cero duraciones literales (`N0-2` pasa).

---

### B9 · `src/proxy.ts` renueva la sesión ✅ — y corre donde debe

**El nombre es lo primero**, porque es la trampa que el spec marcó: Next 16
deprecó `middleware` y lo renombró `proxy`. El build lo confirma reconociéndolo:

```
$ npm run build
ƒ Proxy (Middleware)          ← Next lo tomó por la convención
✓ Compiled successfully · BUILD EXIT=0
```

**Y corre de verdad.** Sonda temporal (una cabecera `x-kipu-proxy-probe`, puesta,
medida y revertida):

```
/dev/shell-preview     → x-kipu-proxy-probe: 1        (corre)
/app                   → x-kipu-proxy-probe: 1
                         HTTP/1.1 307 · location: /login   (el guard de la página, intacto)
/api/telegram/webhook  → sin cabecera                  (NO corre — correcto)
/offline.html          → sin cabecera                  (NO corre — correcto)
```

Tres cosas quedan probadas de una vez: el archivo se ejecuta, el `matcher`
excluye `/api` (donde viven los crons y el webhook de Telegram) y los estáticos,
y **el guard de login de `/app` sigue siendo de la página** — el proxy no
redirige a nadie.

**Decisiones dentro del archivo, y sus motivos:**

- **`getSession()` y no `getUser()`.** El patrón que se copia por ahí usa
  `getUser()`, que valida contra el servidor de auth en **cada navegación**: un
  viaje de red por carga, justo lo que N1 viene a quitar. `getSession()` lee y
  decodifica la cookie local y **sólo sale a la red si el token venció**. La
  pregunta aquí es «¿hay que renovar?», no «¿quién sos?» — quién sos lo sigue
  decidiendo cada página.
- **Dos escrituras de cookie, y las dos hacen falta.** En la **petición**, para
  que el render de esta misma carga vea ya el token nuevo y no vuelva a intentar
  renovarlo (ese era el viaje de auth extra por carga). En la **respuesta**, para
  que el navegador lo guarde — que es lo que nunca ocurría.
- **Falla abierto.** Sin configuración, pasa de largo; ante cualquier excepción,
  devuelve la respuesta sin renovar. Un renovador de sesión no puede convertirse
  en un error de entrada: ese es el defecto original.
- **No toca** RLS, `supabase-admin`, la clave de servicio ni el guard de login.
  `N1-5` lo ata: si aparece cualquiera de esos, la aserción cae.

**El diff completo, para tu revisión antes de desplegar** (es la condición con la
que autorizaste D-N1):

```ts
// src/proxy.ts  (archivo nuevo, 82 líneas con comentarios)
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    });
    await supabase.auth.getSession();
  } catch {
    return response;
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|sw\\.js|offline\\.html|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
```

**No verificado:** que **una sesión vencida entre sin error**. Necesita una
cuenta real con un token caducado; esta máquina no tiene credenciales. Lo que sí
está probado es el mecanismo entero salvo ese último paso — el archivo corre, se
ejecuta en las rutas correctas, escribe cookies en las dos puntas y falla
abierto. Es lo primero que deberías mirar al desplegar.

---

### B10 · El comentario ya no nombra un archivo inexistente ✅

```diff
         } catch {
-          // This can be called from a Server Component.
-          // Middleware will refresh sessions when needed.
+          // Escribir cookies desde un Server Component está prohibido en Next,
+          // así que este write falla por diseño y el fallo es esperable. La
+          // renovación de sesión ocurre en `src/proxy.ts`, que sí puede
+          // escribirlas — y que EXISTE (antes este comentario prometía un
+          // middleware que nunca se escribió; N1, Causa B).
         }
```

Cero cambios de lógica de auth: el `catch` sigue vacío y hace lo mismo.

---

### B11 · La región junto a la base ✅

```json
{ "$schema": "…", "regions": ["cle1"], "crons": [ … ] }
```

`cle1` es Cleveland, y **Cleveland es `us-east-2`** — donde vive la base. Lo
verifiqué en la documentación de Vercel en vez de confiar en la memoria, y de
paso confirmé que **un plan Hobby puede fijar una región** (lo que no puede es
fijar varias). Por defecto las funciones caen en `iad1` (Virginia): un viaje de
ida y vuelta de más por cada lectura, y `contexto` y `briefing` hacen muchas.

`N1-6` ata las dos cosas: la región y que no se llevó por delante los cinco
crons.

Fuentes: [Global network and regions](https://vercel.com/docs/regions) ·
[Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region)

---

### B12 · O1 · ya estaba pagado antes de empezar ✅

El addendum §9 del `N0_AUDIT` lo cerró el mismo día: `N0-2` ata por **selector**,
no por rango de líneas, y AUD-M1 cae por nombre. No lo repetí. Lo que sí hice fue
**usarlo**: las 10 líneas de CSS que agrega N1 viven en el espacio de nombres
`.kipu-shell-*` y por lo tanto quedan dentro de la regla — `N0-2` sigue verde con
ellas.

---

### B13 · Gates ✅ · y los dos pines re-anclados

```
$ npm run lint
✖ 8 problems (0 errors, 8 warnings)
   → los 8 son PREEXISTENTES, en scripts/qa/m0-loop-122|123-e2e.mjs. Cero en N1.

$ node scripts/qa/run-capture-gate.mjs
866/866 capture checks

$ npm run build
BUILD EXIT=0 · ✓ Compiled successfully · ƒ Proxy (Middleware)
   → 1 warning, preexistente (traza NFT por los readFileSync de /dev/capture-test)
```

**860 → 866: seis nuevas** (`N1-1`…`N1-6`), cero removidas. **Dos re-ancladas**,
las dos declaradas aquí con la promesa que conservan:

**`N0-3` (tabular-nums).** Comprobaba que las cuatro superficies con cifra
aparecieran **después** de `className="kipu-santuario"` en el TEXTO del archivo.
N1 movió la píldora y la cinta a componentes propios (necesitan abrir una promesa
con `use()`), que se declaran arriba — y el orden en el fuente dejó de decir
nada. **Ya lo había marcado el audit de N0 como orden O2: orden de aparición no
es contención.** Ahora se sujeta por **contención real**: un solo
`<main className="kipu-santuario">` en el módulo, las cuatro superficies viven en
él, y **cero `createPortal`** — la única forma de que un nodo de React salga de
su padre. Es más fuerte que lo que reemplaza, no más débil.

**`N0-6` (un tramo por cada await).** Cayó al sacar el hilo, **que es la señal de
que salió** (§7.3). Re-anclada así:

- se separan **TRAMOS** (un `await` medido) de **HITOS** (ms desde que arrancó el
  builder): `hilo` y `total` desaparecen, entran `orbe`, `pill` y `perspectiva`,
  porque el builder pasó de tener una línea de meta a tener tres;
- cada tramo se mide **exactamente una vez**, cada hito se sella exactamente una
  vez;
- el barrido pasa a cubrir **todo el camino de render** (el builder **y** sus dos
  lectores decorativos, que ahora arrancan en paralelo) y se corta antes de
  `readShellSaldoLevel`, que sirve al camino de escritura;
- y como ahora hay varios `await` legítimos sobre promesas ya medidas, la regla
  se expresa con una **lista declarada** de los únicos awaits que pueden ir sin
  envolver, cada uno con su motivo. **Cualquier await nuevo fuera de esa lista
  rompe la aserción por nombre** — que es exactamente lo que sujetaba antes.

Lo comprobé: cuando escribí `metro\n.timed(...)` partido en dos líneas, el pin
**cayó solo** hasta que hice el barrido tolerante al salto de línea. Tiene
dientes.

---

### B14 · Mutación propia con dientes ✅ — tres, cada una revertida

**M1 — el movimiento vuelve a ser fatal** (`return {…readFailed:true}` ⇒ `throw movementError`):

```
✗ N1-3 · el último movimiento ilegible degrada y se dice; no tumba la pantalla
         ni finge una cinta vacía
   {"sigueTirando":true,"ceroProhibido":true}
865/866 capture checks

$ npx tsc --noEmit   →   tsc exit=0     ← el compilador no la ve; el test sí
```

**M2 — el tramo `hilo` vuelve a la lista de tramos:**

```
✗ N1-1 · el hilo sale de la pantalla de inicio: ni lectura, ni campo, ni tramo
✗ N0-6 · … (el tramo declarado ya no se mide)
864/866 capture checks
```

**M3 — el archivo de sesión con el nombre viejo** (`src/proxy.ts` → `src/middleware.ts`):

```
✗ N1-5 · src/proxy.ts renueva la sesión y sólo eso; el comentario ya no nombra
         un archivo inexistente
   {"existe":false}
865/866 capture checks
```

Revertidas las tres: `866/866 capture checks`.

---

### B15 · Alcance ✅

```
$ git status --porcelain | grep -E "supabase/|src/lib/financial/|src/lib/ai/|package(-lock)?\.json|migrations"
(sin salida)
```

Cero dependencias nuevas (`src/proxy.ts` importa `@supabase/ssr` y `next/server`,
ambos ya en el árbol). Cero `supabase/**`, cero migraciones, cero
`src/lib/financial/**`, cero `src/lib/ai/**`.

---

### B16 · Ningún número cambió de valor ✅

Los cinco taps, a 375×812, sobre servidor recién arrancado con caché limpia:

```
Saldo      · pos=0 · slide=saldo      · tab=Saldo      · capa=saldo      · acento=#4fead2 · nudo=0 · cifra=82.40$
Reserva    · pos=1 · slide=reserva    · tab=Reserva    · capa=reserva    · acento=#87abff · nudo=1 · cifra=1,200$
Metas      · pos=2 · slide=metas      · tab=Metas      · capa=metas      · acento=#c0a2ff · nudo=2 · cifra=260$
Patrimonio · pos=3 · slide=patrimonio · tab=Patrimonio · capa=patrimonio · acento=#bfe6f8 · nudo=3 · cifra=3,480$
Deuda      · pos=4 · slide=deuda      · tab=Deuda      · capa=deuda      · acento=#ffbd8e · nudo=4 · cifra=760$
```

Paridad total, y las cinco cifras son las mismas que fijó M2 y confirmó N0. Y con
el movimiento ilegible forzado, **también** (ver B5).

---

### B17 · El camino crítico del orbe, medido y declarado — **la promesa de ~1,5 s se cumple en caliente y NO se cumple en frío**

**Qué investigué, y qué encontré.**

El hallazgo del spec se confirma y se agrava: **las cinco cifras del carrusel
salen de `briefing`**, no sólo la del Saldo. Lo verifiqué una por una —
`margenKipu.saldo`, `saldo.layers` + `capacity.monthlyProtected`,
`goalsIntel.netWorth`, `debtHealth.totalDebt`. El orbe **es** el briefing.

Las dos puertas que el spec sugería, y por qué ninguna se pudo abrir desde N1:

1. **Mover sólo la escritura de la foto diaria con `after()`.**
   `writeDailySnapshot` está en `coaching-signals.ts:1691` y es **un await entre
   muchos**: `buildCoachingBriefing` lee antes el *money feed*, hace un
   `Promise.all` de doce lecturas, lee `loadPriorSnapshot`, escribe la foto y
   después lee `readPendingOccurrenceCount`. Sacar sólo la escritura exige
   **editar `src/lib/financial/coaching-signals.ts`**, que §2 y B15 prohíben a
   N1. Tampoco pude medir su porción sin instrumentar ese mismo archivo
   prohibido. Queda como candidato real para una etapa que sí pueda tocarlo.
2. **Derivar el saldo con una lectura más angosta.** No existe: la puerta que
   parecía angosta, `readShellSaldoLevel`, vuelve a correr la misma cadena
   `buildUserFinancialContext` + `buildCoachingBriefing`. No es más barata.

**Lo que sí hice, y lo que consigue.** El camino crítico pasó de *todo* a
*`contexto` + `briefing`*: `cliente`, `cotizaciones`, `preferencias` y
`movimiento` arrancan **en paralelo** desde el primer instante, `historia` corre
después del briefing pero **fuera** del camino, y el hilo salió del todo.

Con los números de la línea base, el orbe deja de esperar 3896 ms y pasa a
esperar:

| | Antes | Después (proyectado sobre la línea base) |
|---|---|---|
| **FRÍO** | 3896 + 248 TTFB = **4144 ms** | 881 + 916 = 1797 + 248 = **~2045 ms** |
| **CALIENTE** | 1963 + 121 = **2084 ms** | 378 + 818 = 1196 + 121 = **~1317 ms** |

**En caliente la promesa se cumple (~1,3 s < 1,5 s). En frío NO: ~2,0 s.**
La declaro incumplida con su cifra al lado, sin redondear. El recorte es del
**51 % en frío** y del **37 % en caliente**, y no incluye lo que aporte fijar la
región — que ataca precisamente los viajes de ida y vuelta que viven DENTRO de
`contexto` y `briefing`, los dos tramos que quedaron.

**Lo que no se vale y no hice:** llegar a 1,5 s mostrando una cifra que el motor
todavía no respaldó. El orbe sigue apareciendo **con su cifra verdadera o no
apareciendo**.

**Esto es una proyección, no una medición.** El número real lo da el teléfono del
founder con `/app?metro=1`, y el metro ya está listo para dárselo: las tres
tandas con sus tramos. Así se verá (verificado en el navegador inyectando una
cabecera realista por el cableado real, y revertido después):

```
TTFB 66 ms   LCP —   INP —   CLS —
orbe 1800 ms        contexto 881 ms   cliente 1 ms   briefing 916 ms   cotizaciones 1 ms
píldora 242 ms      preferencias 223 ms   movimiento 83 ms   recibo 74 ms
perspectiva 1885 ms historia 84 ms
```

---

## Desviaciones

**D1 · El metro pasó de una tanda a tres, y con eso `total` desapareció.** El §3
sólo anunciaba que `SHELL_TIMING_SEGMENTS` perdería `hilo`. Perdió también
`total`, porque el builder dejó de tener una sola línea de meta: ahora entrega
el orbe, después la píldora con la cinta, y al final la perspectiva. `total` ya
no era medible en el momento del volcado (las otras dos tandas aún no habían
resuelto) y habría tenido que mostrarse `—` para siempre. En su lugar hay tres
**hitos** — `orbe`, `pill`, `perspectiva` — y cada tanda viaja con su propia
cabecera. Arrastró un cambio en `MetroOverlay.tsx`, que no estaba en el §3.

**D2 · `ChatView` recibe una prop nueva y cambió cómo guarda los mensajes.** El
§3 preveía «acepta un hilo que llega después». La forma en que lo acepta es una
decisión mía: el estado local pasó a guardar **sólo los turnos de esta sesión**
(la burbuja optimista, la respuesta) y lo que se pinta se **deriva** en cada
render como `historial + local`. La alternativa —fusionar el historial dentro del
estado cuando llega— es un `setState` dentro de un efecto, que el lint del
proyecto rechaza como error, y además obliga a sincronizar dos copias de la
misma lista. Derivar no puede perder un mensaje: el hilo puede aterrizar antes o
después de que el dock envíe.

**D3 · `scrollToTurn` ahora reintenta.** La cinta vive fuera de la hoja y puede
pedir el salto a un recibo **antes** de que el hilo llegue. Sin esto, el salto
—promesa de M3/M4— fallaría en silencio la primera vez que se abre la
conversación. El destino se guarda y se salta en cuanto existe, dentro de un
cuadro, igual que el enlace profundo que ya estaba.

**D4 · `/dev/shell-preview` ganó tres perillas y un escenario.** `?lento=N`
retrasa las tandas para poder VER el orden de aparición; `?hilo=demo` siembra una
conversación (sin sesión, la acción responde «no pude leer», que es correcto pero
poco útil para mirar la hoja); y el escenario `movimiento-ilegible` es el que
rinde B5. Las tres son arnés y están comentadas como tal: **la maqueta no mide
nada y sus cabeceras siguen valiendo `null`**.

**D5 · La rotación de la píldora ya no mira el largo de la lista.** Vivía en el
padre y consultaba `payload.pillLines.length`, que ahora llega en una tanda. El
índice avanza siempre cada 9 s y la píldora hace el módulo con lo que tenga; con
una sola línea el módulo devuelve siempre la misma. **En pantalla, idéntico**; el
costo es un temporizador que a veces no cambia nada.

**D6 · O4 · `payload.serverTiming` sigue viajando siempre, y es una decisión.**
Medí lo que cuesta: las tres cabeceras juntas son **211 B** con números reales,
contra los **474 691 B** que N1 retira. Relación **2250 : 1**, y ninguna de esas
cifras es un dato financiero — es medición, y su ausencia se lee `—`. Gatearlo
exigiría que `buildShellPayload` conociera el query, o sea cambiar la línea que
el pin **M9-1** clava en `page.tsx`. No vale 211 B. **Sí gateé lo que sí costaba:**
la suscripción a las dos tandas vive DENTRO del panel, que sólo monta con
`?metro=1` — un usuario normal no la paga. Y queda dicho, como lo dejó el audit
de N0: **`?metro=1` no está limitado a desarrollo**; cualquiera que adivine el
parámetro ve el panel. Es lo que pidió el §6.2 del spec de N0 (el founder lo
necesita en producción), así que lo dejo señalado, no cambiado.

**D7 · Un defecto propio, encontrado ejecutando.** Lo que el servidor entrega a
un componente cliente **no es una promesa nativa**: es un *thenable* del stream
de React, cuyo `.then()` devuelve `undefined`. Encadenarle `.catch` reventaba el
panel del metro entero («Cannot read properties of undefined (reading 'catch')»,
atrapado por el ErrorBoundary — el panel simplemente no aparecía). Se arregla
adoptándolo con `Promise.resolve(...)`. Lo dejo escrito porque **N2 va a pasar
por lo mismo** en cuanto toque estas promesas.

---

## No verificado

1. **`/app` con sesión real.** Esta máquina no tiene credenciales de QA
   (`.env.local` no trae usuario de prueba) y no creé una persona desechable en
   producción para auditar una etapa que no toca datos. Consecuencia concreta:
   **el «después» de B2 y B17 es una proyección sobre la línea base, no una
   medición.** Todo lo estructural sí está probado por ejecución. **Es lo primero
   que hay que hacer al desplegar: `/app?metro=1`, foto, y comparar con §4.1.**
2. **Una sesión vencida entrando sin error** (B9). Necesita un token caducado de
   una cuenta real. Probado todo lo demás del mecanismo: que el archivo corre,
   dónde corre y dónde no, que escribe en las dos puntas y que falla abierto.
3. **El fotograma intermedio del streaming.** El navegador de este entorno no
   entrega la pantalla a medio volcar: `navigate` espera al load y una navegación
   por JS deja el documento viejo en pantalla. El orden **sí** está medido, en el
   stream HTTP con marcas de tiempo (B7), que es evidencia más fuerte que una
   captura. La foto de los huecos rellenándose la tiene que hacer el founder.
4. **Que el hilo traiga los MISMOS turnos que antes** en una cuenta con historial
   real (B3). El camino es el mismo `readThreadView` con el mismo `since`.
5. **Lo que gana la región `cle1`.** Es un cambio de despliegue: sólo se mide en
   producción, comparando `contexto` y `briefing` antes y después.
6. **LCP, INP y CLS.** El panel vive en `document.visibilityState === "hidden"`,
   así que nunca disparan aquí. TTFB sí mide (57–66 ms) y prueba la otra mitad:
   lo medido sale con número, lo no medido sale `—`.

---

## Lo que le dejo a N2

1. **El orbe es el briefing, y eso es ahora el techo.** Después de N1 el camino
   crítico son dos lecturas y nada más: `contexto` (881 ms) y `briefing`
   (916 ms). Todo lo demás ya está fuera. **El siguiente segundo sólo se gana
   dentro de `src/lib/financial/**`**, que N1 tenía prohibido: sacar la escritura
   de la foto diaria del render con `after()`, o encontrar una lectura que
   afirme las cinco cifras sin construir el briefing entero. Si N2 tampoco puede
   tocarlo, conviene decirlo en su spec en vez de heredar la promesa de 1,5 s.
2. **El chrome del santuario podría pintarse en el TTFB.** Los cinco tipos de
   orbe y sus subtítulos son **estáticos**: no necesitan ninguna lectura. Hoy
   esperan al briefing junto con la cifra. Si N2 promete también `orbs`, el
   santuario —pestañas, cordón, dock, orbe dibujado— aparecería a los ~250 ms y
   sólo la cifra llegaría a los ~1,8 s. Es exactamente la primera fila de la
   caminata del plan: *«0 s · toca el ícono → el orbe ya está ahí, dibujado,
   esperando su cifra»*. No lo hice porque el §5.3 pide «primero el orbe **y su
   cifra**» y porque tocaba la paridad que B16 protege.
3. **El thenable del stream no es una promesa.** Ver D7. Cuesta media hora
   encontrarlo y una línea arreglarlo.
4. **La cinta se revela con el último volcado, no con su dato.** Medido y
   caracterizado en B7. En producción son decenas de ms; si N2 hace la
   perspectiva mucho más lenta, se vuelve visible.
5. **Los huecos ya tienen la caja exacta** (300×46 la píldora, 345×44 la cinta) y
   la píldora coincide con `--kipu-shell-live-spacer--pill` a propósito. Si N2
   cambia el tamaño del orbe o de la píldora, **hay que mover los tres a la vez**
   o el orbe vivo se desalineará del estático al llegar la tanda.
6. **`?state=movimiento-ilegible` y `?lento=N` quedan en la maqueta.** El primero
   es el único sitio donde se puede mirar un degradado honesto sin romper nada
   de verdad; el segundo, el único donde se ve el orden de aparición.
7. **Trampa vigente:** Turbopack sirvió `globals.css` rancio otra vez tras un
   `npm run build`. Todas las mediciones de este reporte se tomaron con `.next`
   borrado y servidor recién arrancado. Y **re-medí dos acusaciones** antes de
   escribirlas: la cinta que parecía quedarse en «cargando» (había leído antes de
   hidratar) y el panel del metro que no aparecía (ese sí era un defecto real,
   D7). La trampa §7.7.4 sigue cobrando.

---

## Ronda 2

Respuesta a `N1_AUDIT.md` §4. **O4 está cerrada por el auditor** (la base vive en
`us-east-2`, `cle1` es correcto) y no la toqué.

Las tres órdenes son del **gate**, no del producto. El único código de producto
que cambió es el que O2 pide explícitamente —mover la decisión de la cinta a una
función pura— y **el comportamiento en pantalla es idéntico**: lo re-medí.

Primero, la confirmación de que el auditor tiene razón. Reproduje sus tres
mutaciones contra el árbol tal como lo dejó la ronda 1:

```
### AUD-N1-C  :: GATE EXIT 0     866/866 capture checks
### AUD-N1-B  :: GATE EXIT 0     866/866 capture checks
### AUD-N1-A2 :: GATE EXIT 0     866/866 capture checks
```

Las tres pasaban. Sin discusión.

---

### O1 · Una comparación de posición no puede pasar por ausencia ✅

**La causa raíz, tal cual la diagnosticó el audit:** `indexOf` devuelve `-1`
cuando la aguja no existe, y `-1` es menor que cualquier posición. **La ausencia
satisfacía su propia prueba de orden.** Borrar lo probado pasaba el gate.

La convención correcta ya vivía en el archivo (IR98, IR94, IR100, IR81, M9-1).
La saqué a un helper con nombre para que se vea, y la apliqué a los dos sitios
de N1:

```ts
const n1Antes = (source: string, first: string, second: string): boolean =>
  source.includes(first) &&
  source.includes(second) &&
  source.indexOf(first) < source.indexOf(second);
```

**Y fui un paso más allá, porque encontré el mismo defecto un nivel más abajo.**
Con O1 puesta, probé una mutación que el audit no había probado: **vaciar el
guard conservando su apertura**.

```diff
- if (prefsError) return { turns: [], complete: false, readFailed: true };
+ if (prefsError) { /* vaciado */ }
```

```
### AUD-N1-B2 (vaciar) :: GATE EXIT 0
866/866 capture checks          ← seguía pasando
```

Es el mismo pecado con otra ropa: `includes("if (prefsError)")` prueba que la
**apertura** existe, no que el guard **haga** algo. Así que el pin pasó a exigir
el guard **con su efecto dentro**, tolerante al formato e intolerante a que lo
vacíen:

```ts
const n1CutoffGuardAt = n1ThreadAction.search(
  /if\s*\(\s*prefsError\s*\)\s*\{?\s*return\s*\{[^}]*readFailed:\s*true[^}]*\}/u,
);
```

Ahora el guard de privacidad resiste las tres formas de matarlo:

```
AUD-N1-B  · borrarlo   → ✗ N1-2   {"guardConEfecto":false}   865/866
B2        · vaciarlo   → ✗ N1-2   {"guardConEfecto":false}   865/866
B3        · moverlo    → ✗ N1-2   {"guardConEfecto":true}    865/866
```

Las tres caen por nombre, y el detalle **dice cuál de las tres fue**: si
`guardConEfecto` es `false` lo borraron o lo vaciaron; si es `true`, lo movieron
detrás de la lectura del hilo.

---

### O2 · La degradación honesta se sujeta por CONDUCTA ✅

O1 tapa el agujero; O2 sujeta la promesa como corresponde. Seguí el patrón que
el bloque ya tiene bueno —`state-contract.ts` de N0— y saqué la decisión a una
función pura que **el gate ejecuta**, en el módulo puro que el santuario ya
tenía (`shell-dialog-contract.ts`, sin `server-only`, cero archivos nuevos):

```ts
export type ShellCintaState = "real" | "sin-dato" | "vacio";

export function cintaState<T>(input: {
  movement: T | null | undefined;
  readFailed: boolean;
}): ShellCintaState {
  if (input.movement != null) return "real";
  return input.readFailed ? "sin-dato" : "vacio";
}
```

Y el santuario dejó de decidir: consume.

```diff
- // «No pude leer» ≠ «no hay nada». Una cinta vacía afirmaría que no hubo
- // movimientos; esto dice la verdad y ofrece reintentar.
- if (!movement && resolved.lastMovementReadFailed) {
+ const cinta = cintaState({
+   movement,
+   readFailed: resolved.lastMovementReadFailed,
+ });
+ if (cinta === "sin-dato") {
```

El gate ahora **ejecuta la conducta** en vez de leer el orden de dos cadenas:

```ts
cintaState({ movement: null,             readFailed: true  }) === "sin-dato"
cintaState({ movement: null,             readFailed: false }) === "vacio"
cintaState({ movement: { turnId: null }, readFailed: false }) === "real"
cintaState({ movement: { turnId: null }, readFailed: true  }) === "real"   // un movimiento vivo gana
cintaState({ movement: undefined,        readFailed: true  }) === "sin-dato"
```

…y además exige que el santuario **consuma** ese resultado, con el despacho de
`sin-dato` antes de la cinta vacía (ya con presencia, por O1).

**Sobre el diff literal del §2.1.** La línea que el audit mutaba **ya no
existe**, porque O2 ordenó reemplazarla:

```
### AUD-N1-C (diff literal) :: NO APLICABLE — la aguja no existe
    aguja: "if (!movement && resolved.lastMovementReadFailed) {"
```

Es la misma mutación con el `-` actualizado a lo que O2 puso en su lugar. Es
literalmente lo que el audit anticipó al escribir la orden: *«Con eso, `if
(false)` deja de ser una mutación que pasa»*:

```
### AUD-N1-C :: GATE EXIT 1
✗ N1-3 · el último movimiento ilegible degrada y se dice; no tumba la pantalla
         ni finge una cinta vacía
   {"sigueTirando":false,"conducta":["sin-dato","vacio","real"],
    "despachaSinDato":false,"ceroProhibido":true}
865/866 capture checks
```

Y como la promesa titular merece más de una prueba, la ataqué por los otros tres
flancos posibles. **Los cuatro caen por nombre:**

| Mutación | Qué hace | Resultado |
|---|---|---|
| **C** (`if (false)`) | apaga el despacho de `sin-dato` | ✗ N1-3 · `despachaSinDato:false` |
| **C2** | rompe la conducta: `cintaState` devuelve `"vacio"` para una lectura caída | ✗ N1-3 · `conducta:["vacio","vacio","real"]` |
| **C3** | conserva la rama pero la **vacía**: devuelve la cinta vacía desde dentro | ✗ N1-3 |
| **C4** | deja de consumir la conducta y vuelve a decidir a mano | ✗ N1-3 · `despachaSinDato:false` |

C2 es la que importa: **la conducta se prueba ejecutándola**, así que ya no hace
falta acertarle a una cadena para que el pin muerda. N2–N6 heredan el patrón.

---

### O3 · El metro no puede dejar de cubrir el camino de render ✅

El diagnóstico del audit es exacto y la parte que más me importa es su segunda
frase: **desde que N1 volvió el builder una arquitectura de promesas paralelas,
nacer-sin-`await` es la forma natural de agregar una lectura.** Vigilar `await`
dejó de alcanzar en el momento mismo en que N1 cambió la forma del archivo.

Cerré las dos puertas por las que puede entrar trabajo async sin medir, con la
prueba que el audit eligió:

1. **Cero `new Promise(`** en el tramo de render — una espera fabricada a mano no
   es tramo de nadie.
2. **Todo elemento de un `Promise.all([…])` debe ser una promesa YA medida**
   (`clientPromise`, `ratesPromise`, `prefsPromise`, `movementPromise`), salvo
   que el `Promise.all` entero viva **dentro** de un `metro.timed(`, en cuyo
   caso está medido por definición.

Para (2) hacía falta saber qué está dentro de qué, y una expresión regular no
sabe contar: el gate lleva ahora un emparejador de paréntesis y corchetes que
calcula los tramos de cada `metro.timed(` y parte los argumentos por comas **de
primer nivel** (el `Promise.all` de `readPrefsAndPending` tiene una cadena de
supabase con comas dentro; partir a lo bruto lo habría roto). Y una tercera
cláusula: el número de tramos `metro.timed(` que ve el emparejador tiene que
coincidir con `SHELL_TIMING_TRAMOS.length` — si el analizador se pierde, **falla
cerrado**.

```
### AUD-N1-A2 :: GATE EXIT 1
✗ N0-6 · una medición que no ocurrió se escribe — y jamás 0; un tramo nombrado
         por cada await del santuario
   {"tramos":["preferencias","movimiento","recibo","cliente","cotizaciones",
              "contexto","briefing","historia"],
    "hitos":["orbe","perspectiva","pill","orbe"],
    "awaitsFueraDeLista":[],
    "esperasFabricadas":1,
    "enPromiseAllSinMedir":["new Promise((resolve) => setTimeout(resolve, 250))"],
    "cabecera":"contexto;dur=12.3, orbe;dur=987.6"}
865/866 capture checks
```

La sonda del audit cae **por las dos puertas a la vez** —`esperasFabricadas: 1` y
`enPromiseAllSinMedir`— y el detalle **nombra la operación exacta** que se coló.
Nótese que `awaitsFueraDeLista` sigue vacío: es precisamente el punto ciego que
el audit describió, ahora cubierto por otro lado.

Mantuve el nombre de `N0-6` sin tocar. Ahora comprueba un superconjunto de lo
que decía; renombrarlo habría roto la trazabilidad con N0 y con las dos
mutaciones que el audit de N0 ya le corrió.

---

### Las tres mutaciones del audit, después de la ronda 2

```
### AUD-N1-B :: GATE EXIT 1
✗ N1-2 · el punto de corte del hilo viaja con él: chat_cleared_at gobierna el camino nuevo
   {"leeCorte":true,"guardConEfecto":false}
865/866 capture checks

### AUD-N1-C :: GATE EXIT 1
✗ N1-3 · el último movimiento ilegible degrada y se dice; no tumba la pantalla ni finge una cinta vacía
   {"sigueTirando":false,"conducta":["sin-dato","vacio","real"],"despachaSinDato":false,"ceroProhibido":true}
865/866 capture checks

### AUD-N1-A2 :: GATE EXIT 1
✗ N0-6 · una medición que no ocurrió se escribe — y jamás 0; un tramo nombrado por cada await del santuario
   {"esperasFabricadas":1,"enPromiseAllSinMedir":["new Promise((resolve) => setTimeout(resolve, 250))"]}
865/866 capture checks
```

**Las tres revertidas**, y el árbol vuelve a `866/866`. El arnés de mutación
restaura el archivo en un `finally`, así que ninguna puede quedarse puesta por
un fallo a mitad de camino.

---

### Que el comportamiento no cambió

O2 tocó producto, así que lo re-medí en vez de suponerlo. Servidor recién
arrancado con `.next` borrado:

```
· el degradado honesto (?state=movimiento-ilegible)
  cifras del carrusel:  82.40$ · 1,200$ · 260$ · 3,480$ · 760$   (intactas)
  cinta como sin-dato:  True
  cinta vacía:          False
  texto honesto:        True

· el caso normal (la cinta real sigue apareciendo)
  cinta real:  True  ['−4.50$']
  cinta como sin-dato:  False

· el orden de aparición, sin cambios
     17 ms  orbe+cifra          17 ms  hueco pill / hueco cinta / hueco perspectiva
    915 ms  PILL              1813 ms  CINTA              1825 ms  PERSPECTIVA

· los cinco taps (B16)
  Saldo 82.40$ · Reserva 1,200$ · Metas 260$ · Patrimonio 3,480$ · Deuda 760$
  paridad posición/slide/tab/capa/acento/nudo/cifra: total
```

### Gates

```
$ npx tsc --noEmit          (sin salida)
$ npm run lint              ✖ 8 problems (0 errors, 8 warnings)   ← preexistentes, en scripts/qa/
$ node scripts/qa/run-capture-gate.mjs      866/866 capture checks
$ npm run build             BUILD EXIT=0 · ✓ Compiled successfully · ƒ Proxy (Middleware)
```

**866 sigue siendo 866**: la ronda 2 no agrega aserciones, **endurece las que ya
había**. Ninguna se removió ni se relajó — las tres crecieron.

---

### Lo que cambió en el árbol, respecto de la ronda 1

| Archivo | Qué |
|---|---|
| `src/app/app/components/shell/shell-dialog-contract.ts` | **+ `cintaState`** — la conducta de la cinta, pura y ejecutable (O2) |
| `src/app/app/components/shell/SantuarioShell.tsx` | `ShellCinta` consume `cintaState` en vez de decidir a mano (O2). Único cambio de producto |
| `src/app/dev/capture-test/page.tsx` | `n1Antes` (O1) · el guard del hilo pinchado por su efecto (O1+) · la conducta de la cinta ejecutada (O2) · el emparejador de paréntesis y las dos puertas de async sin medir (O3) |

Cero archivos nuevos. Cero dependencias. Cero `supabase/**`, `src/lib/financial/**`
ni `src/lib/ai/**`. `src/app/app/page.tsx` sigue sin tocarse.

---

### Lo que le dejo al auditor y a N2

1. **La lección, por sexta vez en la doctrina del proyecto, con un caso nuevo:**
   *preguntá qué haría el test si lo probado NO existiera* — y **también qué haría
   si estuviera pero vacío**. El audit encontró la primera mitad (borrar); yo
   encontré la segunda (vaciar), y las dos pasaban. Un pin que mira una apertura
   (`if (prefsError)`) no es un pin: mira que alguien escribió una palabra.
2. **Los ≈12 sitios preexistentes con el mismo patrón** (IR47, IR49, IR134,
   IR144, IR328, PM…) siguen ahí. El audit los separó a propósito de la deuda de
   N1 y comparto el criterio: `n1Antes` queda escrito y con nombre en el archivo
   para que barrerlos sea mecánico cuando el founder lo agende.
3. **El emparejador de paréntesis de O3 cuenta con `depth` sobre el texto**, así
   que un paréntesis suelto dentro de una cadena lo confundiría. Hoy no hay
   ninguno en el tramo de render y la cláusula `n0TimedSpans.length ===
   SHELL_TIMING_TRAMOS.length` hace que un análisis perdido **falle cerrado**.
   Si N2 mete un literal con paréntesis desbalanceados, el gate se va a quejar —
   y eso es lo correcto, pero conviene saber por qué.
4. **Residuo declarado de O3.** Sigue siendo posible colar trabajo async como
   `const x = algoAsync();` sin `await` y sin `Promise.all`, porque esa es
   exactamente la forma de los dos lectores legítimos (`readPrefsAndPending`,
   `readLastMovement`) y no se puede prohibir sin prohibirlos a ellos. Las dos
   puertas que el audit eligió están cerradas; ésta queda abierta y dicha. La
   forma de cerrarla sería una lista declarada de promesas del builder, como la
   que ya existe para los `await` sueltos.
