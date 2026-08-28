# N2_SPEC — Un solo orbe

> **Contrato completo y autocontenido.** El chat implementador entra leyendo
> este archivo. Contexto del bloque:
> `docs/design/N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md`.
> Protocolo del ciclo: `docs/design/README.md`.
> Lo escribió el auditor que dio VERDE a N1 (`stages/N1_AUDIT.md`), después de
> ejecutar el código y de verificar cada premisa de abajo contra el árbol real.

---

## 1. La promesa de esta etapa

**Después de N2, el orbe es UN SOLO OBJETO desde el primer píxel hasta el último
cuadro —nunca se sustituye a la vista—, cada capa tiene un nivel que significa
algo que se puede decir en una frase, y un orbe vacío se ve deliberado en vez de
roto.**

Ataca las causas **C** y **D** del plan, que son las dos que el founder
fotografió:

- **C** — hay dos orbes (CSS y WebGL) y se cambia de uno a otro delante del
  usuario cada vez que desliza. *"El render es terrible, cambia una y otra vez."*
- **D** — cuatro de los cinco orbes están vacíos por una orden mía de M1.
  *"Los orbes se ven vacíos a pesar de que tengo saldo."*

Y hereda un tercer trabajo que la medición de N1 puso encima de la mesa: **el
cuello de botella de la apertura ya no es el servidor, es el navegador.**

---

## 2. Lo que N2 NO hace

- **No toca cómo se calcula ni cómo se escribe un número.** Los tres
  denominadores del §5.3 **ya existen y ya están calculados** — N2 los *muestra*,
  no los inventa ni los recalcula. Si al terminar una cifra vale distinto, es un
  defecto de N2.
- No toca `supabase/`, ni migraciones, ni el agente.
- **No agrega una sola lectura a la base.** Los tres denominadores están
  verificados como ya presentes en memoria (§5.3). Si N2 cree necesitar una
  lectura nueva, se detiene y lo dice antes de escribirla.
- No rediseña la hoja de chat (N3/N4), ni las pantallas de detalle (N5), ni la
  entrada (N6).
- No añade dependencias.
- **No relaja ninguna aserción existente.** Re-anclar con la promesa intacta es
  legítimo y se declara; debilitar no lo es.

---

## 3. Alcance

| Archivo | Qué pasa |
|---|---|
| `src/app/app/components/metro/MetroOverlay.tsx` | **Primero:** el LCP dice *qué* elemento fue, no sólo cuándo (§4) |
| `src/lib/metro/metro-contract.ts` | El contrato del elemento LCP, puro |
| `src/app/app/components/shell/LiveOrb.tsx` | La calidad se decide **una vez**; nunca baja delante del usuario |
| `src/app/app/components/shell/SantuarioShell.tsx` | Muere la regla de sustitución (`:545`) |
| `src/app/app/components/shell/StaticOrb.tsx` | Materia por capa; el vacío con gota y menisco |
| `src/app/app/components/shell/shell-payload.ts` | Un denominador por capa, desde datos **ya en memoria** |
| `src/app/app/components/shell/shell-orb-contract.ts` **(nuevo)** | La lógica **pura** de nivel y materia por capa, sin `server-only` |
| `src/app/globals.css` | La gota, el menisco y la materia de Patrimonio. Con la escala de N0 |
| `src/app/dev/sistema/page.tsx` | Las cinco capas × sus estados de materia, para aprobar de un vistazo |
| `src/app/dev/shell-preview/page.tsx` | Escenarios de nivel y de vacío |
| `src/app/dev/capture-test/page.tsx` | Aserciones N2-1…N2-n |

---

## 4. Antes de tocar el orbe: saber qué estamos optimizando

**Esto es lo primero que hace N2, y sin esto lo demás es adivinar.**

La medición de N1 dejó esto (`N1_AUDIT`, cuarta corrida):

```
servidor (frío)  1701–1892 ms          LCP  ~4055 ms  [malo]
⇒ trabajo de CLIENTE ≈ 2,1–2,4 s, el 53–58 % del LCP
   (dos muestras, con batería al 8 % y al 40 % cargando: no era bajo consumo)
```

Hay **dos hipótesis** para esos ~2,2 s y hoy no sabemos cuál es:

| Si el elemento LCP es… | entonces el problema es… |
|---|---|
| el **canvas del orbe vivo** | **Causa C**: la sustitución tardía repinta el elemento más grande |
| la **cifra** o el marco | bajar/hidratar el JS — otro problema, y N2 no lo arregla |

La entrada `largest-contentful-paint` trae **`element`**. Que el metro lo muestre:

```
LCP 4014 ms  (canvas.kipu-live-orb)
```

`useReportWebVitals` entrega la métrica con su array `entries`; el elemento sale
de ahí. Reglas de N0 que siguen mandando: **sin medir ⇒ `—`, jamás `0`**, y un
elemento que no se puede identificar se dice `—`, no se adivina.

Con esa foto en la mano, N2 sabe si su trabajo de §5.1 es además el arreglo de
rendimiento más grande del bloque, o si sólo es acabado. **Las dos respuestas son
válidas; trabajar sin saberlo, no.**

---

## 5. El trabajo

### 5.1 Un solo orbe — muere la sustitución

Hoy, en `SantuarioShell.tsx:545`:

```ts
const showLiveCanvas = liveSettled && !dialogOpen && liveTier > 0 && liveState !== "fog";
```

Cada término apaga el orbe bueno y enseña el barato: **deslizar** (`liveSettled`),
**abrir el chat** (`dialogOpen`), **la calidad medida** (`liveTier`), **la
niebla**. Con una transición de opacidad de por medio, que es el tercer aspecto
que el founder vio. Sus capturas 11, 12 y 13 son el mismo orbe de Reserva en tres
formas distintas con segundos de diferencia.

- **O el orbe bueno está desde el principio, o el provisional es visualmente
  idéntico en el instante del relevo.** No hay tercera opción.
- **Deslizar no puede apagar el orbe.** Pausar la animación por rendimiento es
  legítimo; cambiar de objeto no.
- La niebla es un estado honesto y se queda — pero es *un estado del mismo
  orbe*, no otro orbe.

Esto lo diseñé yo en M2 y la intención era buena (degradar en teléfonos lentos).
El efecto es el peor posible: **el usuario ve al producto cambiando de opinión
sobre cómo se ve.**

### 5.2 La calidad se decide una vez

`LiveOrb.tsx:214` arranca en `useState<OrbQualityTier>(0)` —el barato— y sube
después; y la escalera puede bajar sola a mitad de sesión. Cada cambio es otra
sustitución visible.

**Una decisión por dispositivo, tomada lo antes posible, y no se vuelve a mover
delante del usuario.** Si el teléfono no da, da el nivel bajo **desde el primer
cuadro** y se queda ahí: un orbe modesto y estable se ve mejor que uno bueno que
parpadea.

### 5.3 Un denominador honesto por capa — **los tres ya están en memoria**

Decisión **D-N2**, ya resuelta por el founder. **Verifiqué las tres fuentes
contra el árbol real** — ninguna necesita una lectura nueva:

| Capa | Denominador | Dónde está **hoy** | Tramo |
|---|---|---|---|
| **Reserva** | meta de respaldo | `prefs.emergency_reserve_target`, ya leído en `shell-payload.ts:425-427` | `preferencias` |
| **Metas** | aporte del mes | `briefing.margenKipu.capacity.monthlyProtected.goals` (tipo en `margen-kipu.ts:135`) | `briefing` |
| **Deuda** | ciclo cubierto | `ctx.debtAccounts[].statementTotalDue` y `.statementCovered` | `contexto` |
| **Patrimonio** | **ninguno** | — | — |

**Sobre Deuda, que es el que parecía difícil:** `statement_total_due` y
`statement_covered` (migración 065) se mapean a `statementTotalDue` /
`statementCovered` en `supabase-mappers.ts:107-108`, viven en el tipo canónico
`DebtAccount` de `src/types/financial.ts`, y `buildUserFinancialContext` los
expone en `ctx.debtAccounts` (`user-financial-context-builder.ts:132`).
**`shell-payload.ts` tiene `ctx` en la mano y hoy no los usa.** Además ya existe
`cardStatementSettled({ statementCovered, fullPaymentDue })` en `card-cycle.ts`:
la pregunta «¿este ciclo está cubierto?» ya está contestada por el motor.

**OJO — `briefing.debtHealth.cards` NO sirve para esto.** `CardHealth`
(`debt-health.ts`) expone `fullPaymentDue` y `balance` pero **no** la cobertura
del corte. Usar `ctx.debtAccounts` es el camino; extender `CardHealth` sería
tocar el motor sin necesidad.

**Patrimonio no lleva nivel y eso es correcto:** el patrimonio total no tiene
techo honesto, así que un nivel sería una mentira. Conserva su **núcleo de
cristal** — y por lo tanto **necesita otra señal de vida**, no un nivel. Que N2
la diseñe y la declare.

Y la regla que sale de aquí y **queda como doctrina del proyecto**:

> **Si el motor no puede afirmar un nivel, se cambia la materia — no se apaga el
> orbe.**

### 5.4 El vacío con gota

`StaticOrb.tsx:23` dice hoy:

```tsx
{level != null && <span className="kipu-shell-orb__water" />}
```

**Sin nivel no hay agua: es una bola de vidrio.** Eso es lo que el founder
fotografía, y es mi error de M1: preferí el vacío a la mentira, y **el vacío
también comunica algo falso** — un usuario nuevo con respaldo ve una bola hueca y
concluye que no tiene nada, o que la app está rota.

- **Un orbe en cero muestra una gota y su menisco en el fondo.** Es la idea del
  founder, adoptada: dice «esto está vacío a propósito».
- **`vacío` y `sin dato` siguen sin poder parecerse.** N0 ya construyó los dos
  estados y los verificó; el orbe en cero es `KipuEmpty`, y el orbe que no se
  pudo leer es `KipuNoData` — **jamás la misma silueta**. `stateMayRenderZero`
  sigue siendo la frontera.

### 5.5 La tensión que N2 tiene que resolver y declarar

**El denominador de Reserva vive en el tramo `preferencias`, que hoy está en el
grupo `pill`, no en el grupo `orbe`** (`SHELL_TIMING_GROUPS` en
`metro-contract.ts`). O sea que llega **después** del orbe.

Eso deja dos caminos y ninguno es gratis:

1. **Mover `preferencias` al grupo `orbe`.** El nivel llega con el orbe y nada
   cambia después de pintar. Cuesta meter un tramo en el camino crítico que N1
   sacó — aunque en las cuatro corridas medidas `preferencias` corre en paralelo
   y termina casi a la vez que `contexto` (1054–1069 ms en frío contra
   1050–1059), así que el costo real podría ser cercano a cero. **Hay que
   medirlo, no suponerlo.**
2. **Que el líquido suba cuando llega su tanda.** El orbe es el mismo objeto y su
   materia se asienta — no es una sustitución. Pero es un cambio después de
   pintar, y el founder viene quejándose exactamente de cambios después de
   pintar.

**N2 elige, lo declara con su motivo, y lo mide.** Lo que no se vale es que el
nivel aparezca tarde sin que nadie lo haya decidido. Si elige (1), el reporte
pega el antes y el después del hito `orbe`.

### 5.6 Los dos residuos que N1 dejó declarados

Ninguno es urgente; los dos están dichos en voz alta y N2 los hereda.

- **`AUD-N1-D`** (`N1_AUDIT` §ronda 2): cablear
  `lastMovementReadFailed: false` en el payload pasa el gate. El cable desde el
  resultado de la lectura hasta el campo no está sujeto. El arreglo bueno no es
  un pin de cadena: es recorrer la cadena con datos.
- **Residuo de O3** (`N1_REPORT` ronda 2): `const x = algoAsync();` sin `await`
  y fuera de un `Promise.all` sigue siendo invisible para `N0-6`, porque ésa es
  la forma de los dos lectores legítimos.

**Si N2 toca esas zonas, las cierra. Si no, las deja dichas.** No se pagan por
compromiso.

---

## 6. Criterios de aceptación

Verificables **por ejecución**. El reporte pega la salida real de cada uno.

| # | Criterio |
|---|---|
| **C1** | **El metro dice qué elemento fue el LCP.** Foto del founder con el elemento nombrado, y la conclusión: ¿es el canvas del orbe o no? Sin medir ⇒ `—`, jamás un nombre inventado |
| **C2** | **El orbe nunca se sustituye a la vista.** Deslizar los cinco taps no cambia de objeto: se prueba en el DOM y con captura. `showLiveCanvas` deja de poder apagar el orbe bueno por gesto |
| **C3** | Abrir y cerrar la hoja de chat no sustituye el orbe |
| **C4** | **La calidad se decide una vez.** Un tier elegido no cambia en toda la sesión; si el dispositivo no da, arranca bajo **desde el primer cuadro**. Se demuestra forzando los dos caminos |
| **C5** | **Reserva, Metas y Deuda tienen nivel**, cada uno con su denominador del §5.3, y **ninguna lectura nueva a la base**: se prueba que el conteo de consultas no subió |
| **C6** | **Cada nivel se puede decir en una frase** y la frase está en pantalla o a un tap. Un porcentaje sin denominador declarado es un defecto (doctrina de M6) |
| **C7** | **Patrimonio no lleva nivel** y tiene su propia señal de vida, declarada y visible |
| **C8** | **Un orbe en cero muestra gota y menisco**, y no se parece a uno que no se pudo leer. Las dos capturas, lado a lado |
| **C9** | **La lógica de nivel y materia es pura y el gate la EJECUTA** (`shell-orb-contract.ts`, sin `server-only`), siguiendo el patrón de `state-contract.ts` y `cintaState` |
| **C10** | **Ningún número cambió de valor.** Las cinco cifras siguen siendo `82.40$ · 1,200$ · 260$ · 3,480$ · 760$` y la paridad de los cinco taps se mantiene |
| **C11** | **La decisión del §5.5, declarada y medida.** Si `preferencias` entró al grupo `orbe`, el reporte pega el hito `orbe` antes y después |
| **C12** | **El orbe no perdió velocidad.** El hito `orbe` no empeora respecto de la línea base de N1 (frío 1526–1744 ms · caliente 620–672 ms) |
| **C13** | `lint` 0 errores · `build` exit 0 · captura **866 + nuevas**, ninguna removida ni relajada. Si se re-ancló un pin, se dice cuál y qué promesa conserva |
| **C14** | **Mutación propia con dientes:** romper a mano que un orbe en cero dibuje su gota hace fallar una aserción **con nombre**, no el build. Se pega la salida y se revierte |
| **C15** | Cero dependencias nuevas, cero `supabase/**`, cero migraciones, cero cambios en `src/lib/financial/**` ni en `src/lib/ai/**` |
| **C16** | **El CSS nuevo obedece la escala de N0.** `N0-2` sigue verde: cero duraciones literales en el espacio de nombres del santuario |

---

## 7. Trampas de este código y de este entorno

Verificadas contra el árbol al escribir este spec. No son advertencias genéricas.

### 7.1 Los números de línea de este spec son de HOY
`SantuarioShell.tsx:545`, `LiveOrb.tsx:214`, `StaticOrb.tsx:23`,
`shell-payload.ts:425`. N1 movió todo lo que N0 había movido. **Buscá por
contenido, no por línea.**

### 7.2 `CardHealth` no trae la cobertura del corte
Es la trampa que casi me lleva a escribir una instrucción falsa. `debtHealth.cards`
parece el sitio natural y **no lo es**: expone `fullPaymentDue` y `balance`, no
`statementCovered`. El camino verificado es `ctx.debtAccounts` (§5.3).

### 7.3 El *thenable* del stream no es una promesa
Lo pagó N1 (`N1_REPORT`, D7). Lo que el servidor entrega a un componente cliente
es un *thenable* de React: su `.then()` devuelve `undefined`, así que
encadenarle `.catch` revienta el componente entero y el ErrorBoundary lo esconde.
Se adopta con `Promise.resolve(...)`. **N2 va a tocar estas promesas.**

### 7.4 Meter un tramo en el grupo `orbe` deshace trabajo de N1
`SHELL_TIMING_GROUPS.orbe` es el camino crítico de la cifra. Cualquier cosa que
entre ahí, el founder la paga en cada apertura. Ver §5.5.

### 7.5 Las trampas de medición que ya costaron caro
1. **Una pestaña oculta pausa `requestAnimationFrame`** — y N2 es la etapa de los
   cuadros. Medir fps en una pestaña oculta da cero sin avisar.
2. **`innerWidth = 0`** con el panel oculto finge una regresión del carrusel.
   Fijá un viewport real.
3. **Turbopack sirve `globals.css` rancio** tras un `npm run build`:
   `rm -rf .next` antes de acusar al código, y verificá contra la **hoja
   servida**.
4. **Re-medí antes de reportar un fallo.** Entre el Bloque M, N0 y N1 se cayeron
   ocho acusaciones al volver a medir. Si tu primera medición encuentra un
   defecto grande, sospechá primero de tu sonda.
5. **`server-only` mata los runners headless del gate.** La lógica que el gate
   ejecute vive en un `*-contract.ts` sin ese import.
6. **Quien no puede renderizar no puede verificar lo visual.** Y N2 es la etapa
   más visual del bloque: **declará** lo que tu entorno no compone y dejáselo al
   founder. Afirmarlo sin verlo, no.
7. **Una comparación de posición pasa por ausencia.** `indexOf` devuelve `-1`, que
   es menor que todo. Exigí presencia antes de comparar — y acordate de la
   segunda mitad que encontró N1: un pin que mira una *apertura* no prueba que el
   guard **haga** algo.

---

## 8. Formato del reporte

`docs/design/stages/N2_REPORT.md`, append-only por rondas (`## Ronda N`). Por
cada criterio C1–C16: **cómo lo verificaste** y **la salida real**. Al final,
cuatro secciones obligatorias:

- **Qué dijo el LCP** (C1): el elemento, y qué hipótesis del §4 mató.
- **Desviaciones**: todo lo distinto al spec, con el motivo. Si tocaste un
  archivo fuera del §3, hubo una. Si re-anclaste un pin, va aquí con la promesa
  que conserva.
- **No verificado**: qué no pudo comprobar tu entorno, y por qué. En esta etapa
  va a ser mucho, y está bien: dilo.
- **Lo que le dejo a N3**: lo que descubriste midiendo.

Cuando esté listo, el founder abre un **chat auditor nuevo** que no verá esta
conversación.
