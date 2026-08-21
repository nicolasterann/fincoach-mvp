# M_DESIGN_002 — Decisiones resueltas D1–D7 (+ hallazgo del motor)

- **Fecha:** 2026-08-18
- **Track:** M-diseño (paralelo a M0; research-only, cero código)
- **Estado:** RESUELTO — insumo directo del mock (M-D6). Sustituye la sección 12
  de M_DESIGN_001.
- **Entrada:** respuestas del founder a D1–D7 + verificación en el motor real
  (`src/lib/financial/margen-kipu.ts`, `src/app/api/telegram/webhook/route.ts`).

---

## 0. Hallazgo mayor: el motor ya modela «los aportes» del founder

El founder describió una capa así: *«si ya no tengo saldo ni reservas empiezo a
gastar lo que estaba destinado para aportar a mi inversión de eToro o a mi
ahorro. Aún no lo he aportado, pero estaba destinado para eso.»*

Eso **ya existe**, calculado, en `margen-kipu.ts:514-523`:

```ts
// Metas/Ahorro use this cycle's still-reserved contributions (pausable)
const reservedMetasCycle  = roundMoney(reservedGoal);
const reservedAhorroCycle = roundMoney(reservedSavings + reservedInvestment);
saldoLayers = [ Reserva, Metas, Ahorro, Patrimonio, Deuda ]   // orden FIJO
```

- `reservedGoal` = aportes a metas de este ciclo **aún reservados**.
- `reservedSavings + reservedInvestment` = planes de ahorro + aportes a
  inversión de este ciclo **aún reservados**.
- El comentario del propio motor los llama *pausables*: son exactamente «plata
  destinada, todavía no ida», que es lo que un gasto consume al cruzar.

**Consecuencia de diseño:** la unificación que propuso el founder (aporte a
inversión = aporte a una meta llamada «Inversión») no requiere inventar nada:
es **sumar dos capas que el motor ya calcula por separado** y presentarlas como
una sola. Es una decisión de presentación, no de motor.

---

## D3 · RESUELTA — Carrusel de 5 orbes, con «Metas» unificado

Orden = el orden de drenaje del motor, con Metas+Ahorro fusionados:

| # | Orbe | Qué es (dato del motor) | Materia |
|---|---|---|---|
| 1 | **Saldo** | `saldo = min(tanque, calendario sin Reserva)` | agua viva (oleaje) |
| 2 | **Reserva** | capa protegida | agua en calma |
| 3 | **Metas** | `reservedGoal + reservedSavings + reservedInvestment` — lo que apartaste este mes para tu futuro | agua llenando un molde |
| 4 | **Patrimonio** | `investmentsTotalBase` — lo ya invertido | cristal |
| 5 | **Deuda** | total conocido / ciclo vigente | vacío que se llena al saldar |

**Vocabulario:** todo destino es una **meta**. «Aportar a eToro» = aportar a la
meta *Inversión*; «aportar a mi ahorro» = aportar a la meta *Ahorro*. El
usuario nunca ve las tres palabras técnicas del motor (goal / savings_plan /
investment) — ve metas con nombre propio. El desglose por nombre vive en el
detalle del orbe (verificar en M-D3 que las tres fuentes exponen nombre y
destino; si alguna no lo hace, es trabajo menor de backend post-M0, no un
bloqueador del diseño).

### Corrección del founder (2026-08-18): un solo líquido, una sola regla

Mi primera propuesta partía el orbe de Metas en tres materiales (aportado /
reservado / hueco) para distinguir «cumplí» de «me lo comí». **El founder lo
rechazó por sobrediseño y tiene razón**, así que la regla queda así de simple:

> El orbe está lleno de la plata que vas a aportar. Si te la gastas, el nivel
> baja, porque ya no vas a poder aportarla.

Esto además hace el sistema MÁS coherente, no menos: los tres primeros orbes
—Saldo, Reserva, Metas— son **plata que todavía tienes**, en distintos grados
de compromiso, y los tres bajan cuando la usas. Una sola regla en lugar de
tres materiales.

Consecuencia para la regla madre R3 de M_DESIGN_001, que queda reformulada:

- **Orbes 1–3 (Saldo, Reserva, Metas):** el líquido es plata disponible; baja
  al usarla. Lleno = tienes con qué.
- **Orbe 4 (Patrimonio):** no se llena, CRECE (sin denominador inventado).
- **Orbe 5 (Deuda):** se llena hacia la salida (pagar = llenar).

Queda una diferencia real que el diseño debe contar **con lenguaje y
movimiento, no con un tercer material**: aportar y gastarse el aporte bajan el
mismo nivel por razones opuestas. Se resuelve en M-D3 con dos salidas
distintas del líquido — al aportar, el líquido **se transfiere al orbe vecino**
(Patrimonio) y la frase lo celebra; al gastarlo, el líquido **se drena** y la
frase lo nombra sin regaño. La geometría del carrusel ya sirve para eso.

### Excepción declarada: Patrimonio no se llena, CRECE

El patrimonio no tiene techo natural y **está prohibido inventarle un
denominador** (doctrina P3: ningún porcentaje sin base honesta). El orbe de
Patrimonio muestra masa de cristal que crece con el tiempo + la cifra. Si el
usuario declara un objetivo de patrimonio, ahí sí puede llenarse contra él.

---

## D7 · RESUELTA — La app abre en tu capa actual (con regla anti-falsa-alarma)

Aprobada la idea del founder, con una precisión que evita un error grave:
**Saldo en cero NO significa «estás viviendo de tus reservas».** El tanque se
rellena todos los días (`fillDaily`); gastarte el saldo de hoy es normal y no
toca ninguna otra capa. Abrir en Reserva por eso sería una falsa alarma diaria.

Regla de apertura (determinista, con histéresis):

1. **Por defecto abre en Saldo.** Es la casa.
2. **Saldo en 0 sin cruce** ⇒ sigue abriendo en Saldo, en estado «vacío hasta
   mañana», mostrando el amanecer prometido («mañana vuelven 12$»). Honesto y
   sin alarma.
3. **Hubo un cruce real** (un gasto salió efectivamente de Reserva o de Metas)
   en el ciclo vigente ⇒ abre en ESA capa, con rótulo explícito («Estás
   viviendo de tu Reserva»), y el Saldo queda a un swipe.
4. **Vuelve a Saldo** cuando el hecho se revierte (reserva repuesta / saldo
   positivo sostenido). Se entra por un hecho y se sale por un hecho — nunca
   rebota por el cero de una tarde.
5. **Patrimonio y Deuda nunca abren automáticamente.** Patrimonio no es gasto
   corriente; Deuda como saludo diario sería castigo, y la promesa del producto
   es cero culpa. Si todo está agotado, abre en Saldo agotado/runway con la
   verdad dicha en la pill y el siguiente paso ofrecido.
6. **Lectura no publicable** ⇒ abre en Saldo en niebla honesta. Nunca se elige
   capa a partir de un número que no pudimos leer.

---

## D1 · Plataforma — PWA instalada primero (decisión por defecto, reversible)

En simple: la app se «instala» en la pantalla de inicio del teléfono desde el
navegador, se ve a pantalla completa y sin barra del browser, pero no pasa por
las tiendas. Es el camino que ya permite lo que Kipu es hoy (una web) y lo que
la visión pide (gestos, pantalla completa). No bloquea nada: si más adelante
queremos App Store / Play Store, se envuelve con Capacitor sin rehacer la app.
Consecuencia de diseño inmediata: **cada gesto tiene su doble visible** (asa
arriba, dock abajo), porque en navegador algunos gestos compiten con los del
sistema.

## D2 · Identidad — se decide viéndola

El mock incluirá los elementos del cordón (nudos como indicadores del carrusel,
historia del saldo como cordón anudado) **construidos como capa separable**,
para poder quitarlos en una sola pasada si al founder no le convencen.

## D4 · Cero scores compuestos — CONFIRMADO

Sin Pulso, sin puntajes 0–100, sin estados nombrados. Cada módulo del nivel
perspectiva responde una pregunta humana concreta o no existe.

## D5 · Dock — texto + voz + foto (documentos fuera por ahora)

**Buena noticia verificada:** el backend ya recibe foto, nota de voz y
documento (captura universal Stage 12, `telegram/webhook` → pipeline de
evidencia; e inbound-email con adjuntos). Lo que falta es la **puerta web**:
micrófono y cámara en el dock. O sea, no es capacidad nueva del cerebro, es UI
sobre un pipeline que ya existe y ya está probado por Telegram.

Dock v1 = texto · voz · cámara. Documentos: fuera del dock por ahora (siguen
llegando por Telegram/email).

## D6 · Onboarding — FUERA del scope

El wizard actual queda intacto. No se re-viste en este bloque.

---

## Rutas menores resueltas (cierra el inventario de M_DESIGN_001 §8)

| Ruta | Destino |
|---|---|
| `/app/kipu-fit` | Vive en **«Tu Kipu»** (perfil/ajustes): es la superficie de «¿Kipu está adaptado a ti?» y su test es conversacional. No es una métrica financiera ⇒ no va en perspectiva. |
| `/app/activity` | Historial dentro del **nivel diálogo** (la conversación ES el historial); la cinta de último registro es su entrada rápida. |
| `/app/cashflow` | Absorbido por los módulos **«Tu mes»** y **«Lo que viene»**; no sobrevive como destino propio. |

---

## Estado del track tras estas decisiones

Todo lo que bloqueaba el mock está resuelto. Siguiente entregable: **M-D6 mock
visual** (artifact aislado, fuera de `src/`) mostrando los 3 niveles, los 5
orbes con sus materias, el patrón líquido/fantasma/hueco del orbe Metas y los
estados clave del Saldo (disponible, amanecer, capturando, escrito, cruce,
niebla).

Pendientes que NO bloquean el mock y se cierran después de verlo: tokens
formales de color/tipografía/motion (M-D2), spec completa de estados del orbe
(M-D3), mapa IA y flujos (M-D4), spec de perspectiva y copy (M-D5).

---

## Iteración v2 del mock (2026-08-18) — veredicto del founder sobre v1

El founder rechazó el primer mock con dos observaciones precisas:

1. **«El orbe se ve genérico e infantil, como animación de niños; parece
   proyecto de clase, no una app real.»**
2. **«Las métricas de wellness quedaron terrible: mucho texto, todo azul,
   blanco y negro; aburrido, difícil de entender y demasiado serio. Debe ser
   mucho más Whoop, con colores de indicadores.»**

Ambas eran correctas y señalaban límites técnicos reales, no gusto:

### El orbe: de SVG a WebGL volumétrico

v1 dibujaba dos senoides en SVG rellenando un círculo — la receta exacta del
tutorial de «water fill», y por eso leía como ejercicio escolar. v2 lo sustituye
por un **shader**: para cada píxel se traza el rayo contra la esfera, se
refracta al entrar al vidrio y se marcha por el interior acumulando líquido con
densidad suave. De ahí salen, gratis, los rasgos que dan realismo:

- **Absorción por espesor**: el color se satura con la profundidad recorrida.
- **Gradiente vertical real**: claro en la lámina, denso en el fondo.
- **Cáusticas** filtradas bajo la superficie y **brillo de lámina** siguiendo la
  ola (el menisco).
- **Corrientes internas** (ruido con deriva) para que el volumen respire en vez
  de ser un bloque plano.
- **Motas suspendidas** que ascienden: la señal de «esto está vivo».
- **Fresnel iridiscente** en el borde — el registro visual que hoy se lee como
  «aquí vive una IA», sin copiar a nadie.

Lecciones de implementación que valen para el front real:
- El muestreo binario (`dentro/fuera`) produce una línea de agua **dentada**;
  la superficie necesita densidad suave (`smoothstep`) para leer limpia.
- Un modelo de color solo por absorción **apaga** el líquido; hace falta un
  piso de emisión y un gradiente vertical o el orbe sale gris.

### La materia por capa, ahora sí distinta

Saldo = agua viva · Reserva = agua en calma · Metas = flujo intermedio ·
**Patrimonio = cristal facetado** (malla triangular con aristas y destellos que
saltan de cara — no líquido, porque no lo es) · Deuda = ámbar denso y cálido.
Dos intentos fallidos quedan documentados: una rejilla cuadrada leía como bola
de discoteca y celdas Voronoi redondas leían como espuma. La faceta debe ser
**angular y sutil** (±13% de brillo) para leer como gema y no como textura.

### Las métricas: lenguaje de anillos

Se reemplazan las tarjetas de párrafo por el vocabulario Whoop, **sin score
compuesto** (D4 sigue firme):

- **Hoy**: un anillo grande —*Ritmo de hoy*, 74%— con dos anillos medianos al
  lado, Comida y Transporte. El color ES el estado: verde bien, ámbar ojo,
  coral cruzando.
- **Tu mes**: una sola barra apilada de cuatro colores + leyenda con cifras.
  Cero prosa.
- **Tus últimos 18 días**: el cordón, ahora con **cada nudo del color de su
  día**. El hueco honesto sigue ahí.
- **Tus progresos**: tres anillos —Reserva, Aportes, Sin deuda.
- **Lo que viene**: filas con punto de color, día y monto.

Semántica de color separada del acento de capa: `--good #35E39A`,
`--watch #FFC96B`, `--over #FF7C6B`. Cada indicador es un cociente honesto de
algo que el usuario decidió, nunca un puntaje inventado.

### Tipografía

Se retira `ui-rounded` (SF Pro Rounded): el redondeado aportaba buena parte de
la lectura «infantil». Las cifras pasan a `SF Pro Display` con tracking cerrado
(−0.038em) y numeración tabular; el monoespaciado se queda para recibos y datos,
que es la voz del ledger.

---

## Iteración v3 del mock (2026-08-21) — tres correcciones de composición

Observaciones del founder sobre v2, todas de composición y todas atendidas:

### 1. Patrimonio: de nivel a NÚCLEO suspendido

El problema de fondo no era el acabado sino el concepto: Patrimonio estaba
dibujado como los demás —un nivel con lámina de agua— cuando **no tiene
denominador** (regla R3). Un techo plano sobre una gema no significa nada.

Ahora Patrimonio **no tiene nivel**: tiene un **núcleo de cristal suspendido en
el centro que CRECE** con lo acumulado. Sin lámina, sin porcentaje, sin
denominador inventado — el tamaño ES el dato, y flota con aire alrededor.

Tres intentos fallidos quedan documentados porque son la misma lección:
- rejilla cuadrada ⇒ bola de discoteca
- celdas Voronoi redondas ⇒ espuma
- aristas brillantes sobre color plano ⇒ malla de alambre

**La lección:** una faceta no se pinta, **se ilumina**. Lo que faltaba era darle
a cada cara su propia NORMAL y aplicarle luz plana; ahí deja de ser textura y
pasa a ser talla. La versión vigente deriva el centroide de cada triángulo en
coordenadas esféricas, lo convierte de vuelta en dirección y con esa normal
calcula lambert + especular. Las aristas ya casi no hacen falta.

### 2. Jerarquía del pie: la cinta susurra

La pill y la cinta tenían el mismo peso visual (dos tarjetas de vidrio del
mismo tamaño) y competían. Ahora hay orden explícito, que además respeta lo que
el founder pidió desde el principio («la cinta debe ser discreta»):

| Elemento | Peso | Tratamiento |
|---|---|---|
| Cifra | 1º | 58px, la única cosa grande |
| **Pill** (la voz de Kipu) | 2º | tarjeta de vidrio, 13px, radio 20px |
| **Cinta** (el recibo) | 3º | **sin caja**, una línea, 11,5px |
| Dock | acción | vidrio denso, siempre disponible |

Y la cinta gana estructura interna en vez de ser dos líneas sueltas:
`nudo · ÚLTIMO · Café **4,50$** · hace 12 min · ›` — rótulo, hecho, meta.

### 3. Los tres anillos de HOY, iguales

La composición grande-mediano-pequeño leía asimétrica. Los tres indicadores de
hoy son del **mismo rango** (todos son «cómo voy hoy contra algo que yo
decidí»), así que ahora son **tres anillos idénticos de 94px** repartidos en
fila. Es también la forma canónica del referente: Whoop pone sus tres pilares
al mismo tamaño. Los tres anillos de «Tus progresos» comparten esa rejilla.

---

## Iteración v4 del mock (2026-08-21) — el alma, y dos zonas en vez de una pila

### 1. EL ALMA: un aura que escucha y reacciona

Es la incorporación conceptual más importante desde el orbe mismo. El founder
la pidió así: *«una especie de aura/alma que escucha y reacciona, que se sienta
como que está viva»*, y que al hablarle por micrófono **se vea** cómo responde.

Implementación: el mismo shader dibuja ahora, fuera del vidrio, una **corona**
cuyo alcance varía con el ángulo y con una energía viva. El uniforme `uVoice`
la gobierna y tiene cuatro registros:

| Estado | uVoice | Lectura |
|---|---|---|
| En calma | ~0.05 + respiración lenta | está aquí, tranquila |
| Escuchando | envolvente de la voz en vivo | te oye — se abre y late contigo |
| Pensando | 0.42 sostenido | está resolviendo |
| Respondiendo | 0.85 y decae | te contesta |

**El micrófono es real**: pide `getUserMedia`, mide el RMS del audio con un
`AnalyserNode` y alimenta la corona con tu voz de verdad. Si el navegador
niega el permiso (frecuente dentro de un iframe), cae en una envolvente
simulada con pausas y sílabas para que el gesto igual se entienda. Nunca se
queda quieta fingiendo que escucha.

**Lección de render:** un ruido que varía con el radio produce **humo**; para
una corona limpia el perfil debe variar **sólo con el ángulo**. La diferencia
entre «nube sucia» y «aura viva» fue exactamente esa línea.

### 2. Dos zonas, no una pila (siguiendo la referencia del founder)

Antes había tarjeta, texto y dock apilados compitiendo. Ahora la pantalla tiene
**dos grupos con función distinta**:

- **Zona de lectura** (viaja con el carrusel): cifra → subtítulo → **pill**.
  La pill pertenece al número, no al pie, así que se desliza con él.
- **Zona de acción** (fija abajo): **recibo** → dock.

Y el **recibo adopta la estructura de la referencia**: tres columnas —hora en
monoespaciada, comercio, monto a la derecha— en vez de dos líneas sueltas.
`14:20 · Café · Produbanco · −4,50$`.

### 3. La pill es una caja FIJA

Antes se encogía y crecía con cada frase, y eso hacía saltar la composición.
Ahora tiene ancho y alto fijos (máx. 300px, mín. 52px) y **sólo cambia el
texto**, con fundido. La caja es mobiliario; el texto es contenido.

### 4. HOY y TUS PROGRESOS ya no son la misma tarjeta

Eran dos tarjetas idénticas de anillos para cosas distintas. La forma ahora
**codifica la diferencia**, que es real:

- **HOY = anillos.** Un ciclo que se reinicia: hoy, este mes. El anillo es la
  forma canónica de «estado actual dentro de un ciclo».
- **TUS PROGRESOS = barras.** Un recorrido hacia un destino que no se reinicia.
  La barra es la forma canónica de «camino andado».

Mismo lenguaje de color, distinta gramática. Es información, no decoración.

---

## Iteración v5 (2026-08-21) — el alma tenía tres defectos, no una preferencia

El founder describió el aura como *«cortada en la mitad, sólida en lugar de
difuminada, con píxeles en el fondo… se siente electrónica y agresiva en vez de
calma, humana, un ser vivo que respira»*. Tres de las cuatro observaciones eran
**bugs con causa exacta**, no cuestión de gusto:

### 1. El corte a la mitad: `atan()` tiene una costura

El perfil del aura se muestreaba con `atan(uv.y, uv.x)` como coordenada del
ruido. Esa función **salta de +π a −π** al cruzar el eje X negativo, así que el
ruido se partía justo en la izquierda a media altura — exactamente donde el
founder vio el corte.

**La regla, que vale para cualquier efecto radial:** un patrón que debe cerrarse
alrededor de un círculo **jamás se muestrea sobre el ángulo**; se muestrea sobre
el **vector dirección** (`uv/r`), que es continuo en toda la vuelta.

### 2. Los píxeles: una capa de grano que leía como trama

Había un `.grain` de puntos cada 3px. A doble densidad de pantalla eso deja de
ser textura y se convierte en **rejilla electrónica**, justo lo contrario del
registro wellness. Retirada por completo, y la viñeta bajó de 0,55 a 0,38.

### 3. La solidez: caída corta = anillo, no aura

El halo tenía una sola caída. Ahora son **dos capas superpuestas** —una cercana
con cuerpo y una lejana muy abierta (3,1× el alcance)— que es lo que produce
difusión real en vez de un borde. El pico de opacidad bajó de 0,90 a 0,39 y el
color ya nunca va hacia el blanco: se queda en el tono de la capa
(`mix(uAcc, uLiq, 0.45)`).

### 4. La respuesta: un ser vivo, no una alarma

- **Respiración** de 0,31 Hz siempre presente, aunque nadie hable.
- **Deriva**: el orbe flota por la pantalla en un ciclo de 23 s (±1,5% de
  desplazamiento, ±0,7% de escala). Está vivo aunque no pase nada.
- **Ataque y caída lentos**: de 0,30/0,10 a **0,085/0,040**. El aura ya no
  salta con cada sílaba; se hincha y se relaja como una respiración.
- Escuchar llega a 0,75 en vez de 1,0; responder a 0,46 en vez de 0,85.
- El botón del micro pasa de fondo sólido brillante a un tinte suave con pulso
  de 2,8 s.

### 5. Menos texto (tercera pasada)

Se retira **la leyenda** del santuario — era la tercera línea y la única que
envolvía a dos renglones. Quedan tres elementos y ninguno más:

> **cifra grande** · **subtítulo de dos o tres palabras** · **una frase de una
> línea**

Los subtítulos se acortaron («Lo que ya está invertido» → «Ya invertido») y las
frases de la pill se reescribieron para caber en una línea con separador `·` en
vez de dos oraciones. La caja de la pill pasó a alto fijo de 46px.
