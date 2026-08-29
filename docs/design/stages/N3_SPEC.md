# N3_SPEC — El orbe

> **Contrato completo y autocontenido.** El chat implementador entra leyendo
> este archivo. Contexto del bloque:
> `docs/design/N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md`.
> Protocolo: `docs/design/README.md`.
> Lo escribió el auditor que dio VERDE a N2, después de ejecutar el código.
>
> **Esta etapa se insertó el 2026-08-29**, después de que el founder probara N2
> en producción y puntuara los orbes **3/10**. Las etapas de conversación y las
> siguientes corren un número (N3→N4, N4→N5, … N7→N8).

---

## 1. La promesa de esta etapa

**El orbe deja de parecer un proyecto de colegio.**

En palabras del founder, que son el criterio de aceptación real:

> *«Quiero que el nuevo diseño y los orbes me vuelen la cabeza. Que el render
> sea increíble, el agua super realista, los gestos impecables… lo más slick,
> tech y fluido posible. Quiero que se sienta como una app de Apple.»*

Y su referencia es concreta —OPAL, con sus gemas—, de la que importa **una cosa
por encima del acabado**: al pasar de una gema a otra **las seguís viendo**. El
movimiento es continuo. No hay sustitución, hay desplazamiento.

**Autorización explícita del founder:** rehacer desde cero lo que haga falta,
orbe y carrusel incluidos. No hay que preservar ninguna implementación.

---

## 2. Lo que N3 NO puede hacer — leer esto antes que el §1

Esta es **la etapa del bloque con más riesgo de cambiar verdad por belleza.**
Las reglas de abajo no se negocian, y ninguna mejora visual las levanta.

- **Ningún número cambia de valor.** Las cinco cifras siguen siendo las del
  motor. Si al terminar una cifra vale distinto, es un defecto, por lindo que
  haya quedado.
- **Un orbe no puede afirmar lo que el motor no afirma.** La doctrina de N2 está
  en código (`shell-orb-contract.ts`) y sigue mandando:
  *si el motor no puede afirmar un nivel, se cambia la materia — no se apaga el
  orbe*. Un agua espectacular con un nivel inventado es peor que la bola hueca
  que veníamos a matar.
- **`vacío` y `sin dato` no pueden parecerse**, y sólo el que leyó puede pintar
  un cero. Es la doctrina monetaria del proyecto (N0), y N2 la dejó ejecutable.
- **Nada de `src/lib/financial/**`, `src/lib/ai/**`, `supabase/**`, ni
  migraciones.** Esta etapa es presentación y gesto.
- **El metro sigue vivo.** Los tramos, los hitos y las reglas de N0 (sin medir
  ⇒ `—`) siguen igual. Si el orbe se vuelve el elemento LCP, mejor: se verá.
- **No romper lo que N1 ganó.** El hito `orbe` no puede empeorar. Un orbe
  precioso que tarda dos segundos más es un retroceso.

---

## 3. El estado real de hoy — verificado, no supuesto

Esto es lo que hay, y explica cada queja del founder:

| Hecho | Dónde | Qué causa |
|---|---|---|
| `powerPreference: "low-power"` | `orb-shader.ts:341` | El orbe **le pide a la GPU el camino de bajo consumo**. En un iPhone es dejar rendimiento sobre la mesa a propósito |
| `antialias: false` | idem | Bordes duros. Parte del «no se ve premium» |
| `getContext("webgl")` | idem | **WebGL 1.** Sin las herramientas de WebGL2 para agua y partículas |
| Un canvas **fijo y centrado** | `.kipu-shell-live-layer`: `position:absolute; inset:0` | **El orbe no viaja con el gesto.** Está clavado mientras el carrusel scrollea por debajo |
| Carrusel = scroll nativo | `.kipu-shell-track`: `overflow-x:auto; scroll-snap-type: x mandatory`, slides `flex: 0 0 100%` | Cada slide ocupa el ancho entero ⇒ **las vecinas nunca se ven** |
| Dos orbes, uno de CSS y uno de WebGL | `StaticOrb.tsx` / `LiveOrb.tsx` | El relevo, y toda la familia de artefactos que N2 persiguió |
| Giroscopio | — | **Nadie lo toca. Territorio nuevo** |

**El diagnóstico estructural:** un canvas quieto en el centro no puede sentirse
continuo, no puede mostrar vecinas, y está obligado a **cambiarse de color a sí
mismo** en cada capa — de ahí salieron el relevo de N2 y el lag que el founder
fotografió. No es un problema de acabado: es la forma.

---

## 4. La forma nueva

**Los cinco orbes viven en UN solo lienzo, y el lienzo es el carrusel.**

En vez de un orbe fijo con capas pasando por detrás: cinco orbes dibujados en la
misma escena, con su posición derivada del desplazamiento. Deslizar los mueve a
todos. Las vecinas asoman a los costados. **No hay cambio de capa: hay
movimiento.** Y la clase entera de defectos que costó N2 —sustitución, relevo,
lag de una capa— deja de existir porque **ya no hay nada que sustituir**.

### 4.1 Las vecinas — regla del founder (D-N3.2, resuelta)

> **Durante el gesto se ven, exactamente como son. Al soltar, dejan de verse.**

Dos mitades y las dos importan:

- **Mientras te movés, las vecinas se ven SIN CAMBIOS.** No hay versión barata,
  ni simplificada, ni apagada para la que no es la activa. Se ven como se verían
  si fueran la activa. Es lo que hace que el movimiento se lea como
  desplazamiento y no como transición entre dos estados.
- **En reposo, sólo está la activa.** Cuando soltás y la nueva capa se asienta,
  las vecinas ya no están.

**Y la salida de las vecinas es parte del mismo movimiento**, no un apagón
aparte: se van yéndose mientras el gesto termina. Si desaparecen de golpe al
asentarse, es una sustitución con otro nombre — justo la clase que N2 pagó y
que esta forma existe para eliminar.

Consecuencias que el implementador debe resolver y declarar:

- **El gesto deja de ser scroll nativo del navegador**, o deja de ser el que
  posiciona. Lo que hoy da gratis (inercia, snap, accesibilidad, el que
  `scrollLeft` sea la fuente de verdad) hay que reponerlo a mano, y **la paridad
  de M2/B12 —posición, slide, chip, capa, acento, nudo, cifra— tiene que seguir
  cerrando**. Es lo que impide que el carrusel mienta sobre qué capa mirás.
- **La cifra y la píldora siguen siendo DOM**, no textura: son texto que se
  lee, se selecciona y se agranda con los ajustes del sistema. El lienzo dibuja
  materia, no tipografía.
- **El orbe de CSS se queda sólo como el primer cuadro** —lo que se ve antes de
  que el lienzo pinte— o desaparece. Lo que no puede es volver a ser una segunda
  versión del mismo objeto conviviendo con la primera.

---

## 5. El acabado — qué significa «de primer nivel» aquí

Ninguno de estos puntos es decorativo: cada uno es una de las cosas que el
founder nombró.

### 5.1 El contexto deja de pedir el camino barato
`powerPreference: "high-performance"`, antialiasing real (MSAA de WebGL2 o
supersampling), y **WebGL2** si está disponible con WebGL1 como degradado
honesto. Es la traducción literal de *«trabajamos desde lo más alto posible»*.

### 5.2 El agua
Superficie con **profundidad**: refracción a través del vidrio, cáustica en el
fondo, espesor que se nota, y un menisco que se curva contra la pared. Que se
mueva **siempre**, no sólo al tocar. Partículas suspendidas o motas de luz
derivando adentro, lentas.

#### El tope del vaso (D-N3.1, resuelta) — y su regla dura

El founder lo diagnosticó exacto: hoy, lleno y vacío se confunden porque **un
orbe al 100 % no muestra agua: muestra un orbe de color, sin superficie**. Su
solución es la de un vaso real:

> *«Un vaso lleno realmente no está lleno hasta el tope, sino un poco menos.»*

Entonces el **lleno visual deja aire arriba**: el 100 % dibuja el agua con una
franja libre en la parte superior, **de modo que el menisco siempre se vea**. Un
orbe lleno se lee lleno porque **se le ve el límite del agua**, no porque esté
pintado entero.

> **Y la regla que no se relaja: esto es una MAPEO DE DIBUJO, no un cambio de
> dato.** El número sigue diciendo la verdad del motor —«Ciclo cubierto 100 %»
> sigue siendo 100 %—; lo único que cambia es a qué altura del vidrio se dibuja
> ese 100 %. **Nadie acota el valor, se acota el trazo.** Si alguien recorta el
> nivel *antes* de que llegue a la cifra o a la frase, es un defecto de N3.

Corolario: el vacío también tiene que seguir distinguiéndose. La gota y el
menisco de N2 son el piso de esa escala; el aire de arriba es el techo.
Entre los dos tiene que haber **recorrido visible** para los valores del medio.

### 5.3 La luz
Reflejo especular con una fuente coherente, sombra propia, y un halo que sea
**dispersión de esa luz** y no un `box-shadow`. Las capturas del founder muestran
el problema opuesto: *«unos son super intensos en color y otros super opacos, no
hay simetría entre ellos»*. **Las cinco materias tienen que sentirse del mismo
mundo**, con la misma física y la misma exposición — sólo cambia el pigmento.

### 5.4 El gesto
Arrastrar los orbes con el dedo con inercia real. **Rotar el orbe con el toque**
(pedido explícito). El agua responde al movimiento: se inclina, chapotea, vuelve
a su nivel con peso. Y el paso entre capas es continuo, con las vecinas a la
vista.

### 5.5 El giroscopio — **con su trampa, que es la que hunde esta idea**
El agua inclinándose con el teléfono es lo que más se acerca a *«se siente como
una app de Apple»*. Pero:

> **En iOS 13+ el acelerómetro y el giroscopio están detrás de un permiso
> explícito.** `DeviceOrientationEvent.requestPermission()` **sólo puede pedirse
> desde un gesto del usuario**, sobre HTTPS, y devuelve `granted`/`denied`. No
> hay forma de leerlos sin eso, y **no existe hoy ningún código de este proyecto
> que lo toque**: es territorio nuevo.

**Decisión del founder (D-N3.3, resuelta):** el permiso **se pide al iniciar la
app por primera vez**, una sola vez, y después queda resuelto.

Y la parte que importa más, en sus palabras: *«el realismo del agua no debe
depender de él. O sea el giroscopio solo sería un feature más que no afecta la
experiencia entera.»*

Entonces:

- **El agua se construye para verse igual de viva sin giroscopio.** Es la línea
  base, no el degradado. Si el agua sólo se siente bien cuando el teléfono se
  inclina, la etapa está mal construida.
- El giroscopio **suma** una inclinación que sigue al mundo real. Nada más.
- **`denied` no puede empeorar nada** y no se vuelve a preguntar: quedó
  resuelto, como pidió el founder.
- Pedirlo «al iniciar por primera vez» tiene su trampa: iOS **sólo lo concede
  desde un gesto del usuario**, así que no puede colgarse de un `useEffect` de
  arranque. Tiene que ir enganchado al primer toque real — y el reporte debe
  decir a cuál.

---

## 6. El techo honesto de este medio

Hay que decirlo antes de empezar, porque el founder está comparando contra una
app nativa:

**OPAL es una app nativa de iOS. Kipu corre en Safari.** Un canvas web paga
costos que Metal no paga, y hay cosas que no vamos a igualar. Lo que sí se puede
es acercarse mucho más de lo que estamos — hoy el orbe pide expresamente el
camino de bajo consumo, sin antialiasing y en WebGL1. **El margen entre lo
actual y el techo del medio es enorme, y esta etapa existe para gastarlo entero.**

Dos cosas que hay que medir y no suponer, y que la etapa debe reportar:

- **Térmica y batería.** Un lienzo pesado a 60 fps calienta el teléfono y baja
  el reloj. Si el iPhone del founder se calienta o el orbe cae a 30 fps a los
  minutos, es un defecto de la etapa aunque el primer cuadro sea espectacular.
- **La PWA instalada.** Sin la barra de Safari hay más pantalla y menos
  composición. Vale la pena medir las dos.

---

## 7. Decisiones del founder (D-N3) — **tres resueltas, una con default**

Resueltas el 2026-08-29. Están integradas donde corresponde; acá quedan juntas
para que el implementador no tenga que buscarlas.

| # | Decisión | Resolución |
|---|---|---|
| **D-N3.1** | El nivel de agua | ✅ **Sigue siendo el lenguaje**, con el tope del vaso: el lleno deja aire arriba para que **el menisco siempre se vea**. Mapeo de dibujo, jamás del dato (§5.2) |
| **D-N3.2** | Las vecinas | ✅ **Durante el gesto se ven sin cambios; en reposo, no.** Y se van como parte del mismo movimiento (§4.1) |
| **D-N3.3** | El giroscopio | ✅ **Se pide al primer inicio**, una vez, enganchado a un gesto real. **El agua no depende de él** (§5.5) |
| **D-N3.4** | La batería | ⚠️ **Sin respuesta del founder. Default declarado abajo** |

**Default de D-N3.4, que el founder puede revisar cuando vea el costo:** el orbe
**vive mientras se lo mira** —es el héroe del producto y la directriz es el
techo— y **se calma solo cuando no está a la vista**: pestaña oculta, fuera del
viewport, chat abierto encima o app en segundo plano. Nunca por «tier», que es
la escalera que N2 retiró y no vuelve.

Es un default, no una decisión: **la etapa tiene que medir térmica y batería en
el iPhone del founder (E10) y traerle el número**, para que la decida con datos
en vez de con una intuición mía.

---

## 8. Criterios de aceptación

| # | Criterio |
|---|---|
| **E1** | **Ningún número cambió de valor.** Las cinco cifras y la paridad posición/slide/chip/capa/acento/nudo/cifra siguen cerrando |
| **E2** | **La doctrina de N2 sigue ejecutable y verde.** `orbFill`, `orbMustRedraw` y los tres denominadores siguen sujetos; `vacío` ≠ `sin dato` en la forma nueva, con las dos capturas |
| **E3** | **Un solo objeto.** No existen dos representaciones vivas del mismo orbe. El de CSS es primer cuadro o no existe |
| **E4** | **Continuidad:** durante el gesto las vecinas se ven **sin versión degradada**, y en reposo no se ven. Su salida es parte del mismo movimiento, no un apagón. Video del founder |
| **E4b** | **El tope del vaso:** un orbe al 100 % **muestra su menisco** con aire arriba, y se distingue a simple vista de uno al 60 % y de uno vacío. Las tres capturas. Y el gate prueba que **el valor no se acotó**: la cifra y la frase siguen diciendo lo que dice el motor |
| **E5** | **Las cinco materias son del mismo mundo:** misma física, misma exposición, distinto pigmento. Las cinco lado a lado en `/dev/sistema` |
| **E6** | **El agua se mueve siempre** y responde al gesto con peso |
| **E7** | **El gesto:** arrastre con inercia, rotación por toque, y el orbe nunca se queda mostrando una capa que no es la activa (`N2-7` sigue verde o se re-ancla más fuerte) |
| **E8** | **El giroscopio:** permiso pedido **al primer inicio**, desde un gesto real (el reporte dice cuál), una sola vez, y `denied` no empeora nada ni vuelve a preguntar. **Y se demuestra que el agua se ve igual de viva con el permiso denegado** — es la línea base, no el degradado |
| **E9** | **El hito `orbe` no empeoró** contra la línea base de N1/N2 (frío 1526–1744 ms · caliente 620–672 ms) |
| **E10** | **fps y térmica medidos en el iPhone del founder**, no supuestos: fps al abrir, a los 30 s y a los 3 min |
| **E11** | `lint` 0 errores · `build` exit 0 · captura **873 + nuevas**, ninguna removida ni relajada |
| **E12** | **Mutación propia con dientes**, y **el cable además de la conducta** — la lección que costó tres niveles en este bloque |
| **E13** | Cero dependencias nuevas **salvo que se justifique una de render**, y en ese caso se declara y se pesa en el bundle |
| **E14** | Cero `supabase/**`, migraciones, `src/lib/financial/**` ni `src/lib/ai/**` |

---

## 9. Trampas verificadas

1. **El giroscopio pide permiso en iOS y sólo desde un gesto** (§5.5). Construir
   asumiendo que se lee solo es perder la etapa.
2. **El scroll nativo da mucho gratis.** Si se reemplaza, hay que reponer
   inercia, snap y accesibilidad — y la paridad de M2/B12 tiene que seguir
   cerrando.
3. **Quien no puede renderizar no puede verificar lo visual.** Este entorno
   **no compone cuadros**: cero `requestAnimationFrame`, `visibilityState:
   "hidden"`. En esta etapa eso es casi todo. **Declaralo y pasáselo al
   founder**; afirmar que algo se ve bien sin verlo es el peor defecto posible
   acá.
4. **`preserveDrawingBuffer` tiene costo** y hoy está puesto por una razón que
   quizá desaparezca con la forma nueva (`orb-shader.ts:341`). Si se saca, hay
   que resolver de nuevo qué se ve mientras el lienzo no dibuja.
5. **Un `<canvas>` no es candidato a LCP.** Medido en producción: el elemento
   LCP es `span.kipu-shell-pill__text`. No esperes que el orbe mueva esa métrica.
6. **Turbopack sirve CSS rancio** tras un build: `rm -rf .next` antes de acusar.
7. **Re-medí antes de reportar.** En este bloque se cayeron **ocho** acusaciones
   —mías y del implementador— al volver a medir. Si tu primera medición
   encuentra algo grande, sospechá de tu sonda.
8. **Una comparación de posición pasa por ausencia** (`indexOf` da `-1`), y un
   pin que mira una apertura no prueba que el guard haga algo.

---

## 10. Formato del reporte

`docs/design/stages/N3_REPORT.md`, append-only por rondas. Por cada criterio
E1–E14: **cómo lo verificaste** y **la salida real**. Al final:

- **Lo que hay que mirar en el teléfono**, en orden, con qué preguntar.
- **Desviaciones**, con el motivo.
- **No verificado** — en esta etapa va a ser la sección más larga, y está bien.
- **Lo que le dejo a N4.**

Y una recomendación de método para esta etapa en particular: **mostrá temprano y
seguido.** Es la primera del bloque donde el criterio de aceptación es «me voló
la cabeza», y eso no se audita con un gate. Un video de diez segundos vale más
que tres párrafos de reporte.
