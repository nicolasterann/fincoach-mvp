# N1_SPEC — Que abra

> **Contrato completo y autocontenido.** El chat implementador entra leyendo
> este archivo. Contexto del bloque:
> `docs/design/N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md`.
> Protocolo del ciclo: `docs/design/README.md`.
> Lo escribió el auditor que dio VERDE a N0 (`stages/N0_AUDIT.md`), después de
> ejecutar el código — no de leerlo.

---

## 1. La promesa de esta etapa

**Después de N1, el orbe y su cifra aparecen en el teléfono del founder en
menos de ~1,5 s; una lectura secundaria lenta o caída nunca deja la pantalla en
blanco; y una sesión vencida nunca produce un error de entrada.**

Es la etapa con más impacto por línea de código del bloque. Ataca las dos
primeras causas del plan:

- **Causa A** — la pantalla de inicio hace el trabajo de toda la app antes de
  mostrar un píxel, incluidos **348 kB de conversación en cada carga**.
- **Causa B** — la renovación de sesión promete un archivo de borde que
  **nunca se escribió**.

---

## 2. Lo que N1 NO hace

- **No toca cómo se calcula ni cómo se escribe un número.** Ni el motor
  financiero, ni `supabase/`, ni migraciones, ni el agente, ni sus tools. Si
  al terminar una cifra vale distinto, es un defecto de N1.
- No rediseña el orbe (es N2), ni la hoja de chat (N3/N4), ni las pantallas de
  detalle (N5), ni la entrada (N6).
- No añade dependencias.
- **No relaja ninguna aserción existente.** Re-anclar un pin con su promesa
  intacta es legítimo y se declara; debilitarlo no lo es. Ver §7.

---

## 3. Alcance

| Archivo | Qué pasa |
|---|---|
| `src/proxy.ts` **(nuevo)** | La renovación de sesión en el borde. **Frontera de seguridad — D-N1 autorizado** (§5.4) |
| `src/lib/supabase-server.ts` | El comentario que promete un middleware inexistente se corrige. Cero cambios de lógica de auth |
| `src/app/app/components/shell/shell-payload.ts` | Sale el hilo · el movimiento deja de ser fatal · lo lento se promete en vez de esperarse |
| `src/app/app/components/shell/SantuarioShell.tsx` | Fronteras de `<Suspense>` + `use()` para lo que llega tarde |
| `src/app/app/page.tsx` | Sólo si el streaming lo exige. Toca el pin **M9-1**: re-anclar, jamás relajar (§7.2) |
| `src/app/app/components/ChatView.tsx` | Acepta un hilo que llega **después**, y su estado `cargando` |
| Un cargador de hilo bajo demanda **(nuevo)** | **No existe hoy.** Hay que escribirlo (§5.1) |
| `src/lib/metro/metro-contract.ts` | `SHELL_TIMING_SEGMENTS` pierde `hilo` — y se declara (§7.3) |
| `src/app/globals.css` | Sólo si un estado nuevo lo necesita. Con la escala de N0, sin literales |
| `vercel.json` | `regions` junto a la base (§5.5) |
| `src/app/dev/capture-test/page.tsx` | Aserciones nuevas N1-1…N1-n |

---

## 4. Antes de mover nada: la línea base

**Esto es lo primero que hace N1, y no se puede hacer después.**

N0 dejó el metro puesto pero **nadie ha visto todavía la cadena
`Server-Timing` con números reales** — `/app` necesita sesión y ningún entorno
automático tiene credenciales. La mitad de lectura ya está probada por
ejecución (`N0_AUDIT.md` §4: diez tramos inyectados viajan y `resto` se deriva
bien). Falta ver escribir a `buildShellPayload`.

1. El founder abre **`/app?metro=1`** en su teléfono, con sesión real, y
   **fotografía la primera medición**: los diez tramos con números.
2. Esa foto va al reporte como **la línea base**. Es el «antes» contra el que
   se mide «−4 viajes, −348 kB».
3. Recién entonces se toca código.

Si N1 mueve los tramos primero, la línea base se pierde para siempre y la
promesa de esta etapa deja de ser medible. Es la orden **O3** del audit de N0.

### 4.1 La línea base — YA TOMADA (2026-08-28, iPhone del founder, producción)

Dos corridas reales sobre `221575b`. Los cuatro tramos de cabecera suman el
total **exacto** en las dos, así que el instrumento cierra consigo mismo.

| Tramo | Arranque en FRÍO (Safari recién abierto) | Recarga CALIENTE |
|---|---|---|
| `contexto` | **881 ms** (22,6 %) | 378 ms (19,3 %) |
| `hilo` | **1626 ms (41,7 %)** | 474 ms (24,1 %) |
| `briefing` | **916 ms** (23,5 %) | 818 ms (41,7 %) |
| `resto` | 473 ms (12,1 %) | 293 ms (14,9 %) |
| **total** | **3896 ms** | **1963 ms** |
| TTFB | 248 ms | 121 ms |

Cola del `resto` en frío: `cliente 1 · preferencias 223 · cotizaciones 1 ·
historia 84 · movimiento 83 · recibo 74`.

**Tres lecturas que N1 debe tener presentes:**

1. **`hilo` es el 42 % del arranque en frío.** La premisa del bloque queda
   confirmada con número: sacarlo lleva el total de **3896 → 2270 ms**.
2. **TTFB es sano (121–248 ms, verde).** El problema no es la red hasta el
   borde: es trabajo de servidor. Por eso fijar la región (§5.5) ataca los
   viajes a la base que viven DENTRO de los tramos, no el TTFB.
3. **El `resto` es chico** (473 ms en frío repartidos en seis lecturas). No hay
   premio grande ahí; el premio está en `hilo`, `contexto` y `briefing`.

---

## 5. El trabajo

### 5.1 El hilo sale de la pantalla de inicio

Hoy `buildShellPayload` llama a `readThreadView` (`shell-payload.ts:195`) y el
hilo entero viaja al cliente por `SantuarioShell.tsx:740`
(`initialMessages={payload.thread.turns}`, más `threadComplete` y
`threadReadFailed`). La pantalla que muestra **un número** te descarga toda tu
conversación por si acaso.

- El hilo se lee **cuando se abre la conversación**, no antes.
- **El cargador bajo demanda no existe: hay que escribirlo.** Hoy sólo hay dos
  llamadores de `readThreadView` (`shell-payload.ts` y `/app/chat/page.tsx`) y
  ninguna acción de servidor que lo entregue al cliente. Se añade una — server
  action o route handler, la que encaje con el resto del proyecto — que
  devuelva el mismo `ThreadView` tipado que ya consume `ChatView`.
- Mientras el hilo viene, la hoja muestra **`KipuLoading`**, no una hoja vacía.
  Si no se pudo leer, muestra **`KipuNoData`** — nunca una conversación vacía,
  que afirmaría «no tienes mensajes». Los cinco estados **ya existen** (§7.4).
- `prefs.chat_cleared_at` sigue gobernando el corte del hilo: sale de donde
  salga, `chat_cleared_at` oculta sin borrar. Esa promesa es de M4 y sigue viva.

### 5.2 Ningún dato decorativo puede tumbar la pantalla

`shell-payload.ts:338` dice hoy:

```ts
if (movementError) throw movementError;
```

Un fallo leyendo **el último movimiento** —un dato decorativo— revienta la
pantalla entera. Es la doctrina monetaria del proyecto incumplida en la
superficie más visible: «no pude leer» se convierte en «se rompió todo».

- El movimiento ilegible **no se muestra**, y se dice: `KipuNoData` en forma
  `linea`, jamás una cinta vacía. `stateMayRenderZero("sin-dato") === false`
  existe exactamente para esto.
- Barrer el resto de `buildShellPayload` con el mismo criterio y **declarar en
  el reporte, lectura por lectura, cuál es fatal y cuál es decorativa**. Una
  lectura fatal es la que, si falta, haría mentir a una cifra. Todo lo demás es
  decorativo y degrada.
- La regla que no se relaja: **degradar nunca puede inventar un número.**
  Un tramo que no se pudo leer se dice; no se rellena con cero.

### 5.3 Lo que no es el orbe se transmite en cuanto está listo

Orden de aparición: **primero el orbe y su cifra, después la píldora, después
la perspectiva.** Hoy todo espera a la última pieza.

Dos hechos verificados que condicionan **cómo** se hace esto:

- **`SantuarioShell` es un componente de cliente** (`"use client"`, línea 1).
  No se le puede meter un hijo servidor asíncrono. El camino idiomático en
  Next 16.2.4 / React 19 es que el servidor pase **promesas** como props y el
  cliente las abra con `use()` dentro de una frontera `<Suspense>`.
- **`page.tsx` está clavado por el pin M9-1** (§7.2). Si el streaming exige
  partir el payload, ese pin se re-ancla con su promesa intacta, no se afloja.

El hueco de la píldora mientras llega es `KipuLoading shape="linea"` — **no una
barra gris improvisada** (§7.4).

**Y acá está el hallazgo que la línea base destapó, y que este spec no sabía
cuando se escribió la primera versión:**

> `shell-payload.ts:233` dice `const saldo = briefing.margenKipu.saldo;`
> **La cifra del orbe NO sale de `contexto`: sale de `briefing`.**

O sea que «primero el orbe» no es barato. El camino crítico del orbe es
**`contexto` + `briefing`**, y eso son:

- **en frío: 881 + 916 = 1797 ms**, más 248 de TTFB ⇒ **~2045 ms de suelo**
- en caliente: 378 + 818 = 1196 ms, más 121 ⇒ ~1317 ms

**La promesa de ~1,5 s no se alcanza en frío ni sacando el hilo ni
transmitiendo todo lo demás**, porque lo caro *es el orbe*. Transmitir sigue
valiendo muchísimo —el orbe pasaría de aparecer a los ~4,1 s a aparecer a los
~2,0 s, la mitad— pero el último tramo hasta 1,5 s exige que `briefing` salga
del camino crítico o se abarate.

**N1 tiene que investigarlo y declarar qué encontró.** Dos pistas, ninguna
obligatoria:

- `buildCoachingBriefing` vive en `src/lib/financial/coaching-signals.ts` y
  además de leer **escribe la foto diaria**. Si esa escritura es parte de los
  916 ms, mover *sólo la escritura* fuera del render la saca del camino sin
  cambiar un número. **`after` existe y está exportado por `next/server`** (lo
  verifiqué: `NextRequest, NextResponse, ImageResponse, userAgentFromString,
  userAgent, URLPattern, after, connection`).
- Si la cifra del saldo se puede derivar con una lectura más angosta que el
  briefing completo, esa es la otra puerta.

**Lo que no se vale:** llegar a 1,5 s mostrando una cifra que el motor todavía
no respaldó. Antes que eso, el orbe se dibuja en `KipuLoading` y la promesa se
declara incumplida con su número al lado.

### 5.4 El archivo de sesión que nunca se escribió — **frontera de seguridad**

`src/lib/supabase-server.ts:26` se traga el fallo de guardado con este
comentario:

```ts
} catch {
  // This can be called from a Server Component.
  // Middleware will refresh sessions when needed.
}
```

**Ese archivo no existe.** Lo verifiqué: no hay `middleware.ts`, `proxy.ts`,
`src/middleware.ts` ni `src/proxy.ts` en el repo. Cuando el token vence, cada
visita intenta renovar, no puede guardar, y el usuario ve exactamente lo que
describió el founder: entrar cuesta, tira errores, a veces vuelve al login.

**Trampa de versión, verificada — no la pagues de nuevo:** este proyecto corre
**Next 16.2.4**, donde **la convención `middleware` está DEPRECADA y se llama
`proxy`**:

```
node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
  «The `middleware` file convention is deprecated and has been renamed to `proxy`.»
  · el archivo va en la raíz del proyecto o dentro de `src`, al mismo nivel que `app`
  · exporta una sola función: default o nombrada `proxy`
  · `export const config = { matcher: … }` es opcional
```

Como este proyecto usa `src/app`, **el archivo es `src/proxy.ts`**. Lee el doc
local antes de escribirlo; `AGENTS.md` abre con esa regla por algo.

Condiciones que no se negocian:

- **Autorización:** D-N1 está **✅ autorizado por el founder** (plan §6). La
  autorización es para escribir la renovación, no para nada más.
- **El diff se le muestra al founder antes de desplegar.** Es la condición con
  la que autorizó.
- El archivo **sólo** renueva la sesión y reescribe las cookies. No decide
  autorización de negocio, no toca RLS, no toca `supabase-admin`, no toca
  claves de servicio, no cambia el guard de login de `page.tsx`.
- `matcher` acotado: nada de correr sobre estáticos, íconos, `/api/cron/*` ni
  el webhook de Telegram.
- Corregir el comentario de `supabase-server.ts` para que diga la verdad. Un
  comentario que nombra un archivo inexistente es cómo nació este defecto.

### 5.5 La región junto a la base

`vercel.json` hoy sólo declara `crons`; **no tiene `regions`**. Fijar la región
de las funciones junto a la base (`us-east-2`). Un viaje de ida y vuelta menos
por cada lectura, sin tocar una línea de lógica.

### 5.6 Las dos órdenes que N0 dejó abiertas

- **O1 (antes de la primera línea de CSS de N1).** `N0-2` ata la escala de
  movimiento por **rango de líneas entre comentarios**, no por espacio de
  nombres. Está demostrado por mutación (`N0_AUDIT.md` §5, AUD-M1): una regla
  `.kipu-shell-*` con `transition: opacity 0.7s ease` escrita debajo del último
  marcador **pasa 860/860**. Atarla al selector, esté donde esté en el archivo,
  excluyendo el bloque `prefers-reduced-motion`. Cerrar de paso la rendija
  inversa: un `--kipu-t-breath-*` sólo es legal con `infinite`.
  **Prueba de que quedó hecho:** repetir AUD-M1 y que `N0-2` caiga por nombre.
- **O4.** `payload.serverTiming` viaja a todos los clientes en cada carga,
  haya o no `?metro=1`. Son ~150 bytes y ningún dato financiero, pero N1 es
  justo la etapa que audita lo que viaja en la respuesta inicial: que sea una
  **decisión declarada**, no un descuido.

(**O2** —`N0-3` prueba orden de aparición en el fuente, no contención en el
DOM— es de N3/N4, cuando la hoja se toque. No es de N1.)

---

## 6. Criterios de aceptación

Verificables **por ejecución**. El reporte pega la salida real de cada uno.

| # | Criterio |
|---|---|
| **B1** | **La línea base existe**: foto de `/app?metro=1` con los diez tramos en números, tomada **antes** del primer cambio, pegada en el reporte |
| **B2** | El hilo **no** viaja en la respuesta inicial de `/app`. Se prueba midiendo, no afirmando: el tramo `hilo` desaparece del `Server-Timing` y el peso de la respuesta baja. Se pega el antes y el después |
| **B3** | Abrir la conversación trae el hilo, con los mismos turnos, la misma procedencia y los mismos recibos que antes. Mientras viene: `KipuLoading`. Si falla: `KipuNoData`, jamás una conversación vacía |
| **B4** | `chat_cleared_at` sigue ocultando sin borrar por el camino nuevo |
| **B5** | **Ninguna lectura decorativa es fatal.** Se demuestra forzando el fallo del último movimiento: la pantalla se dibuja entera, el orbe y su cifra intactos, y el movimiento sale como `sin-dato` — no como cinta vacía y no como cero |
| **B6** | El reporte lista **lectura por lectura** de `buildShellPayload` cuál es fatal y cuál decorativa, con el motivo |
| **B7** | El orbe y su cifra se pintan antes que la píldora y la perspectiva. Medido con el metro, no descrito |
| **B8** | Los huecos de lo que todavía no llegó son los estados de N0 (`KipuLoading shape="linea"` para la píldora), no barras improvisadas |
| **B9** | `src/proxy.ts` renueva la sesión, guarda la cookie, y una sesión vencida entra sin error. **El diff se le muestra al founder antes de desplegar.** `matcher` acotado; cero cambios en RLS, `supabase-admin` o el guard de login |
| **B10** | El comentario de `supabase-server.ts` ya no nombra un archivo inexistente |
| **B11** | `vercel.json` fija `regions` junto a la base |
| **B12** | **O1 pagado:** `N0-2` ata por selector. AUD-M1 (`.kipu-shell-audit-probe` con `0.7s` al final del archivo) **hace caer `N0-2` por nombre**. Se pega la salida y se revierte |
| **B13** | `lint` 0 errores · `build` exit 0 · captura **860 + nuevas**, ninguna anterior removida ni relajada. Si un pin se re-ancló (M9-1, N0-6), **se dice cuál, por qué, y qué promesa conserva** |
| **B14** | **Mutación propia con dientes:** romper a mano que el movimiento ilegible degrade (volver a `throw`) hace fallar una aserción **con nombre**, no el build. Se pega la salida y se revierte |
| **B15** | Cero dependencias nuevas, cero `supabase/**`, cero migraciones, cero cambios en `src/lib/financial/**` ni en `src/lib/ai/**` |
| **B17** | **El camino crítico del orbe está medido y declarado.** El reporte dice cuánto tardan `contexto` y `briefing` después de N1, si `briefing` salió o no del camino, y —si no salió— cuál es el número real de apertura en frío. Una promesa incumplida se declara con su cifra; no se redondea |
| **B16** | **Ningún número cambió de valor.** Las cinco cifras del carrusel siguen siendo `82.40$ · 1,200$ · 260$ · 3,480$ · 760$` y la paridad posición/slide/tab/capa/acento/nudo/cifra se mantiene |

---

## 7. Trampas de este entorno y de este código

Verificadas contra el código real al escribir este spec. No son advertencias
genéricas: cada una es un hecho comprobado.

### 7.1 `proxy.ts`, no `middleware.ts`
Next 16.2.4. Ver §5.4. Escribir `middleware.ts` produce un archivo que **no
corre** y un defecto idéntico al que N1 viene a arreglar.

### 7.2 `page.tsx` está clavado por M9-1
La aserción `M9-1` exige hoy, literalmente:

```
m9PageSource.includes("return <SantuarioShell payload={payload} />;")
m9PageSource.includes("const payload = await buildShellPayload(session.user.id);")
(m9PageSource.match(/\breturn\b/gu)).length === 1
(m9PageSource.match(/\bredirect\(/gu)).length === 1
redirect(  ANTES de  buildShellPayload(
```

Sujeta una promesa real —«/app **es** el santuario, alcanzable, un solo
camino»— por forma, porque un `redirect` puesto encima dejaría la línea del
santuario intacta y muerta. **Si partir el payload obliga a cambiar esa forma,
la promesa se vuelve a sujetar de otra manera y se explica cuál.** Nunca se
borra el pin ni se afloja la cuenta.

### 7.3 Sacar el hilo hace caer `N0-6` — y así debe ser
`SHELL_TIMING_SEGMENTS` incluye `hilo`, y `N0-6` exige un tramo por cada
`await` y exactamente nueve tramos. Lo verifiqué por mutación
(`N0_AUDIT.md` §5, AUD-M3): des-instrumentar un tramo mata la aserción por
nombre. **Ese fallo es la señal de que el hilo salió de verdad.** Se quita el
nombre de la lista **y se declara en el reporte**; no se deja pasar en silencio
ni se descubre por casualidad.

### 7.4 Los cinco estados ya existen: no improvises ninguno
`KipuLoading · KipuEmpty · KipuNoData · KipuOffline · KipuError`, en cuatro
formas (`orbe · tarjeta · linea · hoja`), todos desde
`@/app/app/components/state`. Están verificados en el DOM (20 casillas = 5 × 4)
y son visualmente inconfundibles entre sí. Un hueco gris nuevo es un defecto de
N1, no una decisión.

### 7.5 `Server-Timing` viaja en el cuerpo, no en una cabecera
Desviación D1 de N0, y **está verificada como forzada**: `headers()` es de sólo
lectura en Next 16 (doc local `functions/headers.md:34,47`) y `next/server` no
exporta ninguna API de escritura de cabeceras. `src/proxy.ts` tampoco sirve
para esto: **corre antes del render**, así que no puede conocer los tiempos.
Si se quiere la cabecera de verdad, es una decisión aparte; la cadena ya está
armada y ya se sabe leer.

### 7.6 LCP, INP y CLS no se pueden fotografiar sin tocar la pantalla
Verificado en la librería que trae Next
(`node_modules/next/dist/compiled/web-vitals/web-vitals.js`): **LCP** se
finaliza y se reporta en `keydown`/`click` o cuando la página pasa a `hidden`;
**CLS** e **INP** se reportan al pasar a `hidden`. **TTFB** se reporta en
`load` — por eso es el único que sale lleno en una captura recién abierta.

No es un defecto del metro: es cómo se miden esas métricas. Pero significa que
el ritual de medición tiene un paso más: **abrir, tocar una vez la pantalla, y
recién ahí leer LCP.** Para CLS e INP hay que mandar la app al fondo y volver.
Si N1 quiere que se puedan fotografiar de una, tiene que decidirlo — y la
regla de N0 sigue mandando: **un valor provisional jamás se muestra como
final.** Antes `—` que un número que va a cambiar.

### 7.7 Las trampas de medición que ya costaron caro
1. **Una pestaña oculta pausa `requestAnimationFrame`** y nunca dispara LCP.
   Medir ahí da cero sin avisar.
2. **`innerWidth = 0` con el panel oculto** hace que el carrusel no tenga a
   dónde desplazarse y **finge una regresión**. Fija un viewport real.
3. **Turbopack sirve `globals.css` rancio** después de un `npm run build`.
   Ante cualquier sorpresa de estilo: `rm -rf .next` **antes** de acusar al
   código, y verifica contra la **hoja servida**, no contra el archivo.
4. **Re-mide antes de reportar un fallo.** En el Bloque M se cayeron cuatro
   acusaciones al volver a medir; en la auditoría de N0, dos más. Si tu primera
   medición encuentra un defecto grande, sospecha primero de tu sonda.
5. **`server-only` mata los runners headless del gate.** Toda lógica que el
   gate deba ejecutar vive en un `*-contract.ts` sin ese import.
6. **Quien no puede renderizar no puede verificar lo visual.** Decláralo y
   marca esas casillas como no verificadas. Declararlo es aceptable; afirmarlo
   sin verlo, no.

---

## 8. Formato del reporte

`docs/design/stages/N1_REPORT.md`, append-only por rondas (`## Ronda N`). Por
cada criterio B1–B16: **cómo lo verificaste** y **la salida real**. Al final,
cuatro secciones obligatorias:

- **La línea base**: la foto de B1 y su lectura. Con el después al lado.
- **Desviaciones**: todo lo que hiciste distinto al spec, con el motivo. Si
  tocaste un archivo fuera del §3, hubo una. Si re-anclaste un pin, va aquí con
  la promesa que conserva.
- **No verificado**: qué no pudo comprobar tu entorno, y por qué.
- **Lo que le dejo a N2**: lo que descubriste midiendo y la etapa siguiente
  debe saber.

Cuando esté listo, el founder abre un **chat auditor nuevo** que no verá esta
conversación.
