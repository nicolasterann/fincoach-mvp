# N3_REPORT — El orbe

> Append-only por rondas. Contrato: `docs/design/stages/N3_SPEC.md`.

---

# Ronda 1 — 2026-08-29

**Rama:** `stage-n-acabado`, llevada a la altura de `main` (`10055e0`) antes de
empezar. Llegó tres commits atrás, incluido el `fix(N2)` del orbe rancio; sin
eso la línea base del gate era 872 y no 873.

**Sin commitear**, como se pidió.

---

## 0. La decisión que ordena todo lo demás

El §4 pide que los cinco orbes vivan en un solo lienzo y que el lienzo sea el
carrusel. Y el §4.1 avisa de la consecuencia: *«el gesto deja de ser scroll
nativo, o deja de ser el que posiciona»*, con la factura de reponer a mano la
inercia, el snap, la accesibilidad y `scrollLeft` como fuente de verdad.

**Esa factura no se pagó, porque no hizo falta.** Lo que se mudó al lienzo es
**el dibujo**, no el gesto:

- La vía sigue siendo un scroller del navegador, con sus slides al 100 % y su
  `scroll-snap`. Inercia, snap, accesibilidad y `scrollLeft` como verdad siguen
  siendo del navegador — no se reemplazaron, así que no hubo que reponerlos.
- El lienzo pasó a ocupar **todo el ancho de la vía** y dibuja los cinco orbes
  con su centro derivado de `scrollLeft / clientWidth`. Las vecinas asoman a los
  costados porque el lienzo llega hasta ahí, no porque el carrusel cambió.
- Los slides quedan como cajas de maquetado invisibles que siguen sosteniendo la
  cifra y la píldora **en DOM**, como pide el §4.1.

Es la razón de que la paridad de M2/B12 no haya que rehacerla: nunca se fue. Y
se apretó un tornillo más — la capa activa y el centro del lienzo salen ahora de
**la misma posición y la misma función pura** (`orbActiveIndex`), así que no
existen dos fuentes que puedan separarse.

---

## 1. Criterio por criterio

### E1 · Ningún número cambió de valor — **verificado**
No se tocó `src/lib/financial/**`, ni `shell-payload.ts` en lo que produce
cifras. Las aserciones de dinero de N2 (N2-2, N2-3, N2-4, N2-6) siguen
**ejecutándose** verdes dentro de las 879, y N3-1 vuelve a exigir las frases
enteras: `"120% de tu meta"`, `"Ciclo cubierto 100%"`, `"queda 100% del aporte
del mes"`. La paridad posición/slide/chip/capa/acento/nudo/cifra la sujeta N3-3
ejecutando `orbActiveIndex` en los bordes (1.49→1, 1.5→2, fuera de rango
acotado, `NaN`→0, lista vacía→0).

### E2 · La doctrina de N2 sigue ejecutable y verde — **verificado, y encontró un defecto**
`orbFill`, `orbMustRedraw` y los tres denominadores siguen sujetos y sin
relajar. Y aquí apareció **el defecto más grave de la ronda**, que no vi
leyendo sino **midiendo píxeles** en `/dev/sistema`:

> **Patrimonio estaba dibujando una línea de agua.** Al rehacer el shader se me
> cayó el guard que N2 tenía: el salto vertical de Patrimonio medía **151,8**,
> igual que el de las capas líquidas (140–147). O sea que el orbe afirmaba un
> nivel que el motor no puede afirmar — exactamente lo que el §2 prohíbe.

Corregido en el shader (`float crystal = step(2.5, uMat) …`, que anula espesor,
cobertura y superficie). Re-medido: el salto de Patrimonio bajó a **53,7** (su
propio núcleo, no una superficie) y las otras cuatro quedaron intactas.

`vacío` ≠ `sin dato` en la forma nueva, **verificado en navegador**: el lienzo
saltea `sin-dato` y el DOM conserva su silueta interrumpida. Con
`data-live-visible="true"` y recálculo forzado, las opacidades por capa fueron

```
saldo nivel → 0 · reserva nivel → 0 · metas SIN-DATO → 1 · patrimonio nucleo → 0 · deuda nivel → 0
```

### E3 · Un solo objeto — **verificado**
Un solo `<canvas>` en el árbol (`lienzos: 1`), cero espaciadores
(`.kipu-shell-live-spacer` eliminado del CSS y del árbol). El orbe de CSS queda
de primer cuadro y de caja de maquetado: la regla pasó de apagar **sólo el de la
capa activa** a apagar **los cinco**, con la única excepción de `sin-dato`.

### E4 · Continuidad — **verificado como composición; el movimiento, no**
La presencia de cada orbe es una **función pura de su distancia al centro**
(`orbSlots`), así que irse y apagarse son el mismo número y no hay apagón
posible. Medido sobre las presencias reales que se dibujan:

| posición | presencias |
|---|---|
| **0** — en reposo | `1.000, 0.000, 0.000, 0.000, 0.000` |
| **0.5** — a mitad del gesto | `1.000, 1.000, 0.000, 0.000, 0.000` |
| **0.88** — asentándose | `0.113, 1.000, 0.000, 0.000, 0.000` |

A mitad del gesto las dos valen **exactamente 1**: no hay versión barata,
simplificada ni apagada. La meseta llega hasta `ORB_PRESENCE_NEAR`, y N3-2
exige además que la salida sea **continua** — recorre 100 pasos y falla si
alguno salta más de 0.08.

Las tres están fotografiadas en `/dev/sistema?seccion=vidrio`, banda «Las
vecinas», dibujadas con la MISMA función que coloca los orbes en el santuario.
**Lo que no pude ver es el movimiento** (§9.3): abajo, en «No verificado».

### E4b · El tope del vaso — **verificado, midiendo**
Mapeo de dibujo puro: `orbWaterline` mapea `[0,1] → [0.07, 0.84]`, deja **16 %
de aire arriba** y **77 puntos de recorrido** entre piso y techo. Medido sobre
los píxeles reales, la fila donde está la superficie:

| dato | trazo | superficie medida | salto |
|---|---|---|---|
| **100 %** | 84 % | **19,6 %** desde arriba | 91,5 |
| **60 %** | 53 % | **37,8 %** | 155,4 |
| **0 %** | 7 % | **80,1 %** | 76,5 |

Los tres se distinguen a simple vista y el del 100 % **muestra su menisco con
aire arriba**. Y el valor **no se acotó**: N3-1 exige que las frases del motor
sigan diciendo 120 % y 100 %, y sujeta estructuralmente que `shell-payload.ts`
—donde se fabrican la cifra y la frase— **no puede ni nombrar** `orbWaterline`.
La mutación que mete esa llamada en el payload mata N3-1 por su nombre.

### E5 · Las cinco materias, del mismo mundo — **verificado, midiendo**
Una sola física (mismo oleaje, mismo menisco, misma absorción de Beer-Lambert
por canal), **una sola luz** (`LKEY`) y **una sola exposición** (tonemap filmic
al final, igual para las cinco). Lo único que cambia es el pigmento, que entra
como coeficiente de extinción. Medido a nivel 62 %:

| capa | superficie | salto |
|---|---|---|
| saldo | 36,8 % | 140,5 |
| reserva | 36,8 % | 147,2 |
| metas | 36,8 % | 147,4 |
| deuda | 36,8 % | 145,6 |
| **patrimonio** | — | **53,7** (cristal, sin agua) |

Geometría idéntica, luminancia del aire dentro de 4 unidades sobre 255. Las
cinco lado a lado en `/dev/sistema?seccion=vidrio`.

### E6 · El agua se mueve siempre — **verificado, midiendo**
La misma capa, el mismo nivel, tres instantes (t = 0 / 3,7 / 9,1 s), sin dedo,
sin inclinación y sin giroscopio:

```
t0 vs t3.7 → 34,1 % del área distinta · diferencia media 41,7
t0 vs t9.1 → 33,7 % del área distinta · diferencia media 36,9
```

Están en `/dev/sistema`, banda «El agua se mueve SIEMPRE». Que **responda al
gesto con peso** está construido (resorte + rozamiento sobre la velocidad de
scroll) pero **no lo vi moverse**: abajo.

### E7 · El gesto — **construido, NO verificado**
Arrastre con inercia: es el scroll nativo, intacto. Rotación: el giro sale de la
misma velocidad de desplazamiento (`spinV += dPos * 1.35`, con rozamiento), así
que los orbes **ruedan al viajar** como un cuerpo y no como una lámina. `N2-7`
sigue **verde y sin tocar**, y además se re-ancló más fuerte: el lienzo ya no se
pausa al deslizar —el gesto ES el dibujo—, así que la clase «el orbe muestra la
capa que dejaste» dejó de ser alcanzable por gesto; el guard se conserva entero
para la pausa bajo una hoja. **Nada de esto lo vi en movimiento.**

### E8 · El giroscopio — **construido, NO verificado en iOS**
`useDeviceTilt.ts`, territorio nuevo. La trampa está resuelta como pide el §5.5:

- **El gesto exacto al que va enganchado, que el reporte debe decir:** el
  **primer `pointerdown` sobre `<main class="kipu-santuario">`** — el primer
  toque en cualquier parte del santuario. No cuelga de ningún efecto de
  arranque, y N3-6 lo sujeta por los dos lados (que exista el enganche, y que
  no exista un `useEffect` que pida el permiso).
- Una sola vez: se guarda el resultado y `readStored() != null` corta el pedido.
- `denied` no empeora nada: sin permiso la inclinación devuelta es **cero**, no
  una inclinación inventada, y no se vuelve a preguntar.
- Un **fallo de transporte no se guarda como denegado** — eso cerraría la puerta
  para siempre por un error que no decidió nadie.
- **El agua no depende de él:** `WAVE_AMP` es una constante propia, las
  corrientes y el menisco no miran la inclinación, y lo que llega al lienzo es
  `gesto + giroscopio`. Con el permiso denegado queda el gesto, que ya es
  movimiento. N3-6 mata la mutación que hace depender el oleaje del giroscopio.

**Lo que NO pude hacer: probarlo en un iOS.** No hay iPhone en este entorno y
`requestPermission` no existe fuera de Safari móvil.

### E9 · El hito `orbe` no empeoró — **NO verificado**
No puedo reproducir la línea base del founder (frío 1526–1744 ms · caliente
620–672 ms): se midió en su teléfono contra producción. Lo que sí puedo decir es
qué cambió en la dirección correcta, y son tres cosas medibles por él:

1. **El primer cuadro se pinta sincrónicamente** en el efecto, ya no en el
   próximo `requestAnimationFrame`. El relevo del orbe de CSS espera a que HAYA
   imagen, así que adelantar el cuadro adelanta el relevo.
2. **Ya no espera al `IntersectionObserver`.** Antes un viewport todavía
   desconocido pausaba el bucle, y el observador entrega dentro del ciclo de
   render: hasta que el navegador no componía, el orbe no arrancaba.
3. **El agua se resuelve en vez de marcharse.** Se fue el raymarch de 34 pasos
   por píxel; el corte del rayo con el plano del agua es analítico, con una
   iteración de Newton para la ola. Sale más nítido y cuesta una fracción.

Contra eso juega que el lienzo ahora es de ancho completo (853 500 px de búfer a
DPR 2 en 375×569) en vez de un cuadrado centrado. **En reposo se emite UNA sola
llamada de dibujo** —las presencias de las vecinas son cero y no se dibujan—,
así que el costo en reposo es el de un orbe, como hasta N2. Durante el gesto son
dos. Nunca cinco. **Es una expectativa razonada, no una medición.**

### E10 · fps y térmica en el iPhone del founder — **NO verificado, pero instrumentado**
No tengo su teléfono. Lo que dejé es el instrumento para que el número sea suyo
y no mío: el panel `?perf=1` ahora reporta **fps al abrir, a los 30 s y a los
3 min** como tres marcas separadas, más la versión de WebGL conseguida, si hay
antialiasing, cuántos orbes se dibujaron en el último cuadro, DPR, píxeles de
búfer y el motivo exacto de pausa.

### E11 · Gates — **verificado**
```
lint   → 0 errores (8 warnings preexistentes en scripts/qa/m0-loop-*.mjs, no tocados)
build  → ✓ Compiled successfully · exit 0
captura → 879/879   (873 base + 6 nuevas, ninguna removida)
```
**Cuatro pines se RE-APUNTARON, y hay que mirarlo con lupa** — está en
«Desviaciones».

### E12 · Mutación con dientes, y el cable además de la conducta — **verificado**
`scripts/qa/n3-mutation-audit.mjs`, **15 de 15 muertas por su nombre**, cada una
dejando exactamente un rojo, y restauración a 879/879:

| # | mutación | mata |
|---|---|---|
| 1 | el lleno vuelve a tocar el borde | N3-1 |
| 2 | el trazo se aplana contra el tope | N3-1 |
| 3 | **CABLE** · el payload acota el DATO con el mapeo de dibujo | N3-1 |
| 4 | las vecinas se apagan de golpe | N3-2 |
| 5 | la vecina se muestra degradada durante el gesto | N3-2 |
| 6 | **CABLE** · la capa activa se deriva a mano otra vez | N3-3 |
| 7 | se va el snap nativo | N3-3 |
| 8 | el lienzo dibuja agua donde no se pudo leer | N3-4 |
| 9 | el cristal recupera su línea de agua | N3-4 |
| 10 | **CABLE** · el DOM deja de apagarse (dos orbes del mismo objeto) | N3-4 |
| 11 | vuelve `low-power` | N3-5 |
| 12 | se deja de intentar WebGL2 | N3-5 |
| 13 | **CABLE** · el permiso deja de colgar del gesto | N3-6 |
| 14 | un fallo de transporte se guarda como denegado | N3-6 |
| 15 | el oleaje pasa a depender del giroscopio | N3-6 |

### E13 · Dependencias — **verificado**
**Cero.** `git diff main -- package.json` = 0 líneas. Todo el render es WebGL a
mano.

### E14 · Fronteras — **verificado**
Cero `supabase/**`, cero migraciones, cero `src/lib/financial/**`, cero
`src/lib/ai/**`. Los archivos tocados están al final.

---

## 2. Lo que hay que mirar en el teléfono, en orden

1. **`/dev/sistema?seccion=vidrio`, primero.** Es donde vive la evidencia y no
   necesita datos. De arriba abajo: las cinco materias, el tope del vaso, las
   vecinas, el agua moviéndose sola, el agua inclinada.
   → *¿Las cinco se sienten del mismo mundo? ¿El del 100 % se lee lleno sin
   estar pintado entero?*
2. **El santuario, quieto.** Sin tocar nada, treinta segundos mirándolo.
   → *¿El agua está viva sin que hagas nada? ¿Te da ganas de mirarla?*
3. **Deslizá entre capas, despacio y luego rápido.**
   → *¿Ves la vecina mientras te movés? ¿Se va yéndose o desaparece de golpe?
   ¿En algún momento el orbe muestra una capa que no es la que dice el chip?*
4. **El primer toque de la app recién instalada.** Ahí sale el permiso del
   giroscopio, una sola vez.
   → *Decile que **NO** la primera vez. ¿El agua se siente igual de viva?* Esa
   es la pregunta que más importa: el giroscopio suma, no sostiene.
   Después, borrando datos del sitio, volvé a entrar y decile que sí.
5. **`?perf=1`, tres lecturas: al abrir, a los 30 s y a los 3 min.**
   → *¿Cuánto marca cada una? ¿El teléfono se calienta?* Ese número decide
   D-N3.4 con datos en vez de con mi intuición.
6. **La PWA instalada, repitiendo 2, 3 y 5.** Sin la barra de Safari hay más
   pantalla y menos composición.
7. **El tema claro.** Se ve bien, pero el aire sobre el agua queda más lavado
   que en oscuro y la línea del agua se lee con menos filo.

---

## 3. Desviaciones, con el motivo

1. **Cuatro pines del gate se re-apuntaron (M4-3, M5-2, M6-4, N2-5).** Ninguno
   se removió ni se relajó; los cuatro sujetaban **cables que N3 reescribe con
   razón**, y quedaron **más fuertes**:
   - Los tres del `active={liveSettled && !dialogOpen && !perspectiveOpen}`
     pasan a `active={!dialogOpen && !perspectiveOpen}`. La invariante que
     protegían —*una hoja encima calma el orbe*— sigue pinchada entera; lo que
     se cayó es `liveSettled`, porque **en la forma nueva el gesto ES el
     dibujo** y pausarlo sería volver a la sustitución. Y agregan lo que antes
     no decían: un pin negativo que **prohíbe** que el gesto vuelva a entrar en
     esa decisión.
   - M5-2 pasa de `voice: animatedVoice` a `voice: isActive ? animatedVoice : 0`.
     Con cinco orbes en el lienzo, un aura repartida entre las cinco afirmaría
     que Kipu te escucha desde una capa que no abriste.
2. **Antialiasing: no es MSAA.** El §5.1 pide «MSAA de WebGL2 o supersampling».
   Se pide `antialias: true` y se consigue, pero **el MSAA no hace nada para
   este orbe**: sólo suaviza bordes de *geometría*, y aquí la geometría es un
   cuadrilátero — el borde de la esfera lo calcula el fragmento. El
   antialiasing que sirve es **analítico**, con `fwidth`: borde de un píxel
   exacto a cualquier DPR, que es mejor que MSAA para este caso. Derivadas son
   core en WebGL2 y extensión pedida en WebGL1, con ancho fijo si no está.
3. **La refracción se ablandó a propósito** (índice 0,90 en vez del 0,78 del
   vidrio). Con el índice realista, los rayos del borde se doblan tanto que casi
   todos terminan en el agua y **el orbe se ve lleno mire donde mire**: la
   refracción se comía el NIVEL, que es lo único que este objeto tiene que
   decir. Es una decisión de producto sobre una de realismo, y la declaro.
4. **El agua se resuelve, no se marcha.** El raymarch de N2 se fue. Motivo en
   E9. Efecto secundario bueno: la superficie es nítida en vez de temblona.
5. **WebGL2 con un solo shader.** El degradado a WebGL1 usa **el mismo** GLSL ES
   1.00, así que la rama de degradado es la que se ejecuta todos los días y no
   una segunda versión que nadie probó.
6. **Se fue el estado `liveSettled`** del santuario: ya no lo lee nadie.
7. **`initializing` dejó de ser motivo de pausa** (E9, punto 2). Sigue en el
   tipo y en el panel.
8. **D-N3.4 quedó como el spec la dejó**: el orbe vive mientras se lo mira y se
   calma con hoja encima, pestaña oculta o fuera del viewport. Nunca por tier.

---

## 4. No verificado — la sección larga, como el spec anticipó

**Este entorno no compone cuadros, y lo medí en vez de suponerlo:** 0 frames de
`requestAnimationFrame` en 2,3 s, `visibilityState: "hidden"`. Lo que sí hay es
WebGL2 real (ANGLE Metal, Apple M4 Pro) a DPR 2, y los efectos de React corren.
Sobre eso construí lo único honesto que se podía: **el primer cuadro se pinta
sincrónicamente**, así que pude auditar **imágenes fijas del shader de
producción** — no una copia, no una maqueta. Todo lo que dice «medido» arriba
salió de los píxeles reales.

**Nada de esto lo vi, y no lo afirmo:**

- **Que el movimiento se sienta bien.** Ni el arrastre, ni la inercia, ni el
  snap, ni la salida de las vecinas *en movimiento*, ni el chapoteo del agua al
  frenar, ni el giro al rodar. Tengo las posiciones y las presencias medidas en
  fijo; **la fluidez no**.
- **fps, jank y térmica.** Cero mediciones. E10 entero.
- **El hito `orbe`.** No puedo reproducir la línea base del founder.
- **El giroscopio en iOS.** Ni el diálogo de permiso, ni `granted`, ni `denied`,
  ni el agua siguiendo al teléfono. La lógica está sujeta por el gate; el
  comportamiento de Safari no.
- **La PWA instalada.**
- **El amanecer, la captura, el recibo y el cruce de capa en movimiento.** Su
  lógica sigue verde en el gate; sus animaciones no se vieron.
- **Que «vuele la cabeza».** Es el criterio de aceptación y no lo puedo evaluar.
  Lo que sí puedo decir, mirando las capturas: **está muy por encima de N2** —el
  agua tiene fondo, la superficie es una elipse en perspectiva y las cinco capas
  por fin se sienten del mismo mundo— **y todavía no es un render de app nativa
  de Apple.** Le falta, concretamente: reflejo de entorno en el vidrio (hoy hay
  un especular y un borde, no un ambiente), cáustica de verdad enfocada en vez
  de ruido modulado, y el tema claro se lava sobre la línea del agua.

**Tres defectos que encontré MIRANDO, y que ninguna lectura de código habría
dado:** el eje Y invertido (el agua llenaba el techo), el signo del cabeceo de
cámara (se miraba la superficie desde abajo y el vaso parecía más lleno) y el
tope de contextos WebGL del navegador (17 probetas en `/dev/sistema` mataban la
primera). El cuarto —Patrimonio con línea de agua— lo encontró **medir**, no
mirar. Los cuatro están arreglados.

---

## 5. Lo que le dejo a N4

- **La pasada del founder es bloqueante**, igual que en M9: el acabado de esta
  etapa no se puede cerrar desde acá.
- **D-N3.4 sigue siendo un default sin decidir.** Necesita el número de E10.
- **El techo del vidrio.** Si la pasada dice «bien, pero no me voló la cabeza»,
  lo que queda es reflejo de entorno y cáustica enfocada — ambos caben en el
  mismo shader sin tocar la forma.
- **El tema claro merece una pasada propia.**
- **`OrbSpecimen` es reusable**: cualquier etapa que quiera aprobar algo visual
  puede pintar un cuadro determinista del renderer real en `/dev/sistema` en vez
  de pedir fe. Comparte **un solo contexto** para toda la página.

---

## 6. Archivos

**Modificados**
- `src/app/app/components/shell/shell-orb-contract.ts` — `orbWaterline`,
  `orbSlots`, `orbActiveIndex`, `orbFieldPlacements`. Todo puro y ejecutable.
- `src/app/app/components/shell/orb-shader.ts` — renderer multi-orbe, WebGL2,
  agua analítica, absorción por profundidad, menisco, cáustica, motas 3D,
  sombra propia, una luz y una exposición.
- `src/app/app/components/shell/LiveOrb.tsx` — el campo de cinco orbes.
- `src/app/app/components/shell/SantuarioShell.tsx` — cableado y primer gesto.
- `src/app/globals.css` — lienzo de ancho completo, un solo objeto.
- `src/app/dev/sistema/page.tsx` — sección «El vidrio vivo — N3».
- `src/app/dev/capture-test/page.tsx` — N3-1…N3-6, y los cuatro pines re-apuntados.

**Nuevos**
- `src/app/app/components/shell/useDeviceTilt.ts`
- `src/app/app/components/shell/OrbSpecimen.tsx`
- `scripts/qa/n3-mutation-audit.mjs`

**Sin tocar, a propósito:** `supabase/**`, migraciones, `src/lib/financial/**`,
`src/lib/ai/**`, `package.json`.

---

# Ronda 2 — 2026-08-29 · Reflejo de entorno y cáustica enfocada

Pedido del founder después de leer la ronda 1: ir por las dos cosas que yo mismo
había declarado como el techo pendiente del vidrio. Sigue **sin commitear**.

**Gates después del cambio:** `captura 879/879` · `lint 0 errores` ·
`build exit 0` · `mutación 15/15 muertas por nombre`, restauración a 879/879.
Ninguna aserción nueva: esto es acabado del mismo shader, no capacidad nueva.

## 1. El reflejo de entorno — el vidrio refleja un CUARTO, no un punto

Hasta la ronda 1 el orbe tenía un especular puntual y un borde de fresnel, que
es lo que se ve en una **bola de plástico brillante**. Ahora hay un estudio
procedural (`envSample`): suelo, cielo, un panel de luz principal con núcleo
duro y caja suave, y un relleno frío del lado opuesto.

Tres decisiones que importan:

- **El entorno es NEUTRO y COMPARTIDO por las cinco capas.** No lleva `uAcc`. Es
  deliberado y refuerza E5: las cinco se reflejan en el mismo cuarto, que es la
  otra mitad de por qué se sienten del mismo mundo. Lo que las distingue sigue
  siendo el pigmento, nunca la luz.
- **Fresnel de Schlick sobre el entorno**, no un especular sumado: de frente el
  vidrio es casi transparente y al ras devuelve casi todo. Es exactamente lo que
  separa «vidrio» de «plástico brillante» a la vista.
- **Por el vidrio VACÍO se ve el cuarto refractado.** El rayo entra, cruza la
  esfera, sale y muestrea el mismo entorno. Antes era un degradado inventado
  (`backLit`); ahora las dos mitades —lo que refleja por fuera y lo que se ve
  por dentro— salen de la misma función, así que no pueden contradecirse.

## 2. La cáustica enfocada — es CONVERGENCIA, no ruido

La de la ronda 1 era `fbm` con un umbral: manchas que se mueven, que es lo que
sale cuando alguien *dibuja* una cáustica en vez de calcularla. La cáustica real
es **densidad de rayos**: donde la superficie curva junta la luz, el mismo haz
cae sobre menos fondo y brilla.

Eso es el **jacobiano del mapeo superficie→fondo**, y como el oleaje son senos,
sus segundas derivadas salen **exactas**. La cáustica de verdad terminó costando
cuatro senos más que la falsa.

Tres correcciones encadenadas, cada una encontrada mirando el resultado anterior:

1. **Primer intento: dos bandas gordas cruzando el orbe.** El oleaje tenía una
   sola longitud de onda por orbe. Se agregó el **rizo fino** — pesa poco en la
   altura y muchísimo en la cáustica, porque la curvatura va con el *cuadrado*
   de la frecuencia. Es literalmente por qué la red fina del fondo de una pileta
   la dibujan los rizos y no el oleaje.
2. **Segundo intento: rayas paralelas.** Las olas eran senos en `x` y en `z`
   puros ⇒ campo separable ⇒ su cáustica es una reja de rayas. Ahora son
   **cuatro trenes direccionales no perpendiculares** y el jacobiano usa la
   **Hessiana completa, con término cruzado**. Con el cruzado la red se cierra
   en celdas; sin él quedaban rayas.
3. **Tercer intento: rayones atravesando el agua entera.** La estaba pintando en
   un punto cualquiera del rayo, o sea flotando en el volumen. Una cáustica se
   apoya en **el fondo del vaso**: ahora aterriza en el punto de salida del rayo
   contra la pared interior de abajo, con paralaje **según la dirección de la
   LUZ** (no la del ojo), así que se corre con la profundidad en vez de parecer
   una calcomanía.

## 3. El tema claro, que el entorno destapó

El reflejo hizo evidente lo que la ronda 1 había declarado como debilidad: con
un estudio oscuro fijo, sobre fondo claro **el vidrio vacío se leía como una
cúpula gris pegoteada**. Un vidrio refleja el cuarto donde está, así que el
cuarto ahora sigue al tema (`uDay`).

La primera corrección se pasó al otro extremo —el vidrio se quemaba a blanco y
el orbe perdía su silueta—, y ahí está la lección: **en claro el vidrio tiene
que DEJAR PASAR la página, no pintarla.** Quedó con menos energía de entorno,
menos cobertura sobre el aire y menos halo bajo `uDay`. **Sigue siendo el más
flojo de los dos temas** y va a la lista del teléfono.

## 4. Nada de lo ya medido se movió

Re-medido sobre los píxeles después de todo el cambio:

| | ronda 1 | ronda 2 |
|---|---|---|
| tope del vaso (100/60/0) | 19,6 · 37,8 · 80,1 | **19,6 · 37,5 · 80,1** |
| las cuatro líquidas a 62 % | 36,8 (todas) | **36,5 (todas)** |
| Patrimonio (salto) | 52,9 · sin agua | **52,9 · sin agua** |
| el agua se mueve sola | 34,1 % / 33,7 % del área | **38,7 % / 33,7 %** |

Los corrimientos de 0,3 son el campo de olas nuevo. La doctrina no se movió:
Patrimonio sigue sin línea de agua, las cinco siguen compartiendo geometría,
luz y exposición, y el valor sigue sin acotarse.

## 5. Lo que sigue sin verificarse

**Lo mismo que en la ronda 1, sin cambios**: la fluidez, los fps, la térmica, el
giroscopio en iOS, el hito `orbe` y la PWA. El entorno y la cáustica se auditaron
**en cuadros fijos**, que es lo único que este entorno permite. Dos advertencias
honestas para la pasada del teléfono:

- **La cáustica es lo más caro que se agregó** (cuatro senos y una Hessiana por
  píxel de agua, sólo en tier ≥ 2). Si algo va a mover la aguja de fps o de
  temperatura, es esto. Está aislada detrás de `KIPU_TIER > 1.5`, así que
  apagarla es un cambio de una línea si el número no cierra.
- **La intensidad la elegí yo mirando un monitor, no un iPhone.** El brillo de
  la cáustica y del reflejo puede leerse distinto en OLED al sol.
