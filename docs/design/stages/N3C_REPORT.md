# N3C_REPORT — El orbe de ElevenLabs, con nuestro líquido

> Append-only por rondas. Contrato: `stages/N3C_SPEC.md`.
> Rama `stage-n-acabado`. Partida: 883/883. Cierre de la ronda 1: **889/889**.

---

## Ronda 1

### La decisión de integración, y por qué

**Se portó su shader a nuestro renderer** — la opción recomendada del §4. Cero
dependencias nuevas (el proyecto sigue con **seis**: `@supabase/ssr`,
`@supabase/supabase-js`, `next`, `openai`, `react`, `react-dom`).

Lo que decidió: leerles el código confirmó el §3.1 del spec. Su orbe es
`<circleGeometry>` + `<shaderMaterial>` — un disco plano pintado por un shader
de fragmento, **exactamente nuestra arquitectura**. `three` no aporta el look;
lo aporta el shader, y el shader es MIT. Instalar `three` + `@react-three/fiber`
+ `@react-three/drei` habría traído el techo de `react: ">=19 <19.3"` y un
reescrito igual del contenedor (su componente es **un `<Canvas>` por orbe** y el
nuestro son **cinco en un lienzo**), a cambio de nada que el porte no dé.

### Qué se hizo

| | |
|---|---|
| **El campo** | Siete óvalos en coordenadas polares que derivan despacio, el ángulo distorsionado por una tela de ruido, y una rampa de cuatro paradas (oscuro → `--kipu-deep-*` → `--kipu-liquid-*` → blanco). Es su técnica, con nuestras dos parejas de color por capa |
| **El líquido** | El campo **es** el cuerpo del agua: `body` sale de la rampa, no del pigmento con absorción. Vive anclado al **centro del líquido**, así que baja y sube con el nivel en vez de ser un fondo recortado por una línea |
| **El aire** | Por encima del menisco queda vidrio. El campo entra ahí sólo como tinte del entorno, al 5,5–13 % — medido, ver G7 |
| **Murió el cuarto** | Se fueron `panelMask` (la ventana), los travesaños del marco y el horizonte duro. Queda una luz con dirección y su chispa: nada reconocible en el reflejo |
| **La tela** | `orb-noise-texture.ts` la **genera**: Perlin periódico de tres octavas, 256×256, semilla fija. Cero peticiones |
| **La voz** | Un tren de ondas concéntrico **en la altura y en la normal** del agua, más un menisco que se vuelve irregular. Alimentado por el envolvente de M5 |
| **El reloj del campo** | `orbFieldSpeed` / `advanceOrbField` / `orbFieldDrive` en `orb-water-sim.ts`, puros y ejecutables: el campo **acelera cuando hablás**, como el suyo |

### Archivos

```
 M scripts/qa/n3-mutation-audit.mjs
 M src/app/app/components/shell/LiveOrb.tsx
 M src/app/app/components/shell/OrbSpecimen.tsx
 M src/app/app/components/shell/orb-shader.ts
 M src/app/app/components/shell/orb-water-sim.ts
 M src/app/dev/capture-test/page.tsx
 M src/app/dev/vidrio/page.tsx
?? docs/design/evidence/N3C-G6-comparacion.png
?? docs/design/evidence/N3C-G8-voz.png
?? src/app/app/components/shell/orb-noise-texture.ts
?? src/app/app/components/shell/orb-reference-shader.ts
```

---

## Criterios

### G1 · Ningún número cambió

Por **alcance**, no por una aserción nueva: `shell-payload.ts` —donde se
fabrican la cifra y la frase— tiene **0 líneas de diff**, y no se tocó un solo
archivo de `src/lib/financial/**`. Un número no puede haber cambiado porque no
se tocó nada que produzca uno. Las aserciones de paridad y las de las cinco
cifras que ya existían siguen verdes, sin editar, dentro de las 889.

### G2 · La doctrina sigue ejecutable

Las aserciones N3-1, N3-4, N3B-2 y N3B-4 corren sin cambios: `orbWaterline`
sigue viviendo en el contrato puro y el payload sigue teniendo **prohibido**
nombrarla, `orbFill` sigue distinguiendo `gota` de `sin-dato`, `orbMustRedraw`
sigue en su sitio, y sin techo declarado sigue sin haber nivel. La única
mutación relacionada que cambió es un **re-anclaje declarado** (ver G12).

### G3 · Un solo lienzo, cero contextos por orbe

Medido en `/dev/vidrio` con la página entera (las siete hojas):

```
canvasEnLaPagina: 35    canvas2D: 35    canvasWebGL: 0
dibujados: 35           vaciosOApagados: 0
```

El instrumento: un canvas sólo admite un tipo de contexto, así que si
`getContext("2d")` devuelve algo, ese canvas **no** tiene contexto WebGL. Los 35
son copias 2D del único contexto compartido. Y ninguno salió vacío, que es la
señal de haber tocado el techo del navegador.

El porte fiel del shader de ellos se dibuja **en ese mismo contexto**, con el
mismo reloj: no abre uno propio.

### G4 · Cero peticiones a dominios ajenos

Mirando la red, no leyendo el código. Sobre `/dev/vidrio` completo:

```
peticionesAjenas: []
```

Todas las peticiones son `localhost:3000`. (En una corrida anterior aparece un
`POST http://localhost:4599` — es **mi** sumidero para sacar las imágenes de
evidencia de este entorno, lanzado desde la consola, no algo que la página
pida. El servidor quedó apagado.)

La textura de ruido no se descarga de ningún lado: la fabrica
`orbNoiseTexture()` en **3,8–3,9 ms** (256×256, cinco corridas, medido en node),
una sola vez por renderer.

### G5 · El aviso MIT

Está en los **tres** archivos que portan o adaptan su código, y lo sujeta la
aserción **N3C-2**:

- `orb-reference-shader.ts` — el porte fiel de su fragment shader
- `orb-shader.ts` — la adaptación del campo (`fieldGray`, `fieldRamp`, `fieldFlow`)
- `orb-noise-texture.ts` — el porte de `splitmix32` y de sus `offsets`

Cada uno lleva el texto completo de la licencia y el enlace a `elevenlabs/ui`.
La mutación N3C-2 borra la línea de copyright y el gate cae con su nombre.

### G6 · La comparación lado a lado

`/dev/vidrio?hoja=comparacion`. Imagen: `docs/design/evidence/N3C-G6-comparacion.png`.

Mismo lienzo, mismo contexto, mismo reloj, mismo diámetro en píxeles y las
mismas dos parejas de color. Tres viñetas arriba (el suyo con su paleta, el suyo
con la nuestra, el nuestro) y una banda por capa abajo con vacío / 60 % / 100 %.

**Se mostró a mitad de camino, como pedía el §8.** El veredicto del founder fue
*«no lo veo muy parecido al de ellos»*, con la orden de completarlo y commitear
para juzgarlo en su teléfono. Después de ese veredicto se hizo **una pasada de
contraste** sobre lo que más lo alejaba: el vidrio le estaba subiendo el piso al
campo por cinco caminos a la vez (el reflejo del vidrio, el aire de atrás, la
cáustica, las motas y el reflejo de la superficie), y subir el piso es
exactamente perder los negros que hacen su look. El líquido pasó a **tapar** el
aire que tiene detrás (98,5 %) y el reflejo se apaga donde hay agua.

### G7 · Líquido con nivel y aire, medido

Perfil por altura de la columna central del orbe (la columna central y no el
borde: el borde es donde todo detector se equivoca, trampa 6 del spec). La
señal es «cuánto verde-azul hay», que separa el líquido del vidrio neutro:

| altura | 60 % | 100 % | vacío |
|---|---|---|---|
| 0,90 | 0,190 | 0,198 | 0,190 |
| 0,85 | 0,149 | **0,188** | 0,149 |
| 0,80 | 0,133 | **0,364** ← superficie | 0,132 |
| 0,70 | 0,160 | 0,516 | 0,110 |
| 0,60 | 0,217 | 0,437 | 0,110 |
| 0,55 | **0,568** ← superficie | 0,518 | 0,122 |
| 0,05 | 0,470 | 0,405 | 0,353 |

**Superficie visible medida: vacío ≈ 0,05 · 60 % ≈ 0,575 · 100 % ≈ 0,825.**

Los tres se distinguen a simple vista y **el lleno deja aire**: por encima de
0,85 las filas caen a 0,19, el mismo valor que el orbe vacío. Concuerda con
`orbWaterApex`, que es cota inferior por construcción (0,56 y 0,77) y con lo
medido en N3B sobre el renderer real (0,581 y 0,835).

El vacío se lee vacío: sin salto, con la gota apoyada en el fondo.

### G8 · La onda de la voz, sobre el agua

`/dev/vidrio?hoja=voz`. Imagen: `docs/design/evidence/N3C-G8-voz.png`.

La onda entra en `waterHeight` **y** en `waterNormal`. Las dos mitades, porque
es la trampa que N3B ya pagó con el 'sheen': un relieve que no cambia la normal
no cambia cómo entra la luz, así que no refleja distinto — es un dibujo, no una
onda. La aserción N3C-3 exige las dos.

Ondulación de la superficie, medida como energía de alta frecuencia de la banda
de la superficie a lo largo de x (×1000):

| callado | voz 35 % | voz 75 % | voz 100 % |
|---|---|---|---|
| 2,03 | 2,00 | **6,40** | **7,70** |

**Corrección que salió de medir, no de mirar.** La primera versión llevaba
`VOICE_AMP = 2,35`: 0,061 radios de desplazamiento, **3,8 px** en un orbe de
124 — por debajo del ruido de cualquier instrumento y, lo que importa, por
debajo de lo que se ve. El instrumento no la encontraba porque **no estaba**.
Subió a 0,10 radios (la mitad de lo que mueve su anillo) y la frecuencia bajó de
13 a 9 para que el tren entre entero en la elipse de la superficie.

A voz 0,35 el instrumento sigue sin separarla del ruido (2,00 vs 2,03); se
declara. A 0,75 y a 1 la diferencia es de 3× a 4×.

El volumen es el de M5: `voiceTarget(state, level)` sobre el envolvente que
alimenta `rmsFromTimeDomain` del `AnalyserNode`. No hay reloj inventado.

### G9 · El agua conserva su masa

`advanceOrbWater`, `orbWaveEnergy`, `SLOSH_*` y `BOB_*` están **intactos** — cero
líneas de diff en la simulación existente. `orb-water-sim.ts` sólo **suma** el
reloj del campo. Las cuatro mutaciones de N3B-1 (amortiguación a 0, a 1,4, la
ola corriendo con el reloj, el giroscopio crudo) siguen muriendo con su nombre.

### G10 · El peso, medido

| | antes | después | Δ |
|---|---|---|---|
| `.next/static/chunks` | 1392 KB | 1416 KB | **+24 KB** |
| …comprimido | 382 061 B | 393 696 B | **+11,4 KB** |
| **`/app` (el santuario)** | 203,3 KB · 9 chunks | 214,4 KB · 10 chunks | **+11,1 KB** |
| **…comprimido** | **65,7 KB** | **69,7 KB** | **+4,0 KB gz** |
| dependencias | 6 | 6 | **0** |

La medición del «antes» se hizo con `git stash -u` y un build limpio, no de
memoria.

Y el reparto se verificó **contra el build de producción**, no leyendo el
código: buscando `sharpRing` (una función que sólo existe en el porte fiel) en
los chunks que cada página declara en su manifiesto:

```
/app          → 10 chunks · SIN el porte fiel
/dev/vidrio   →  6 chunks · LLEVA el porte fiel
/dev/sistema  →  7 chunks · LLEVA el porte fiel
```

Por eso el shader de la comparación se **inyecta** en `createOrbRenderer` en vez
de importarse: el santuario no carga un shader que nadie va a usar ahí.

### G11 · El hito `orbe`

**No cambió, por construcción.** `SHELL_TIMING_GROUPS.orbe` mide cinco lecturas
del servidor (`contexto`, `cliente`, `briefing`, `cotizaciones`, `preferencias`)
y esta etapa **no tocó ninguna**: cero archivos de servidor, `shell-payload.ts`
con 0 líneas de diff, ninguna lectura nueva.

Lo que sí es costo de cliente y sí se midió es la fabricación de la tela: **3,8
ms**, una vez, al crear el renderer.

**No medido con una sesión real** — hace falta una sesión autenticada y este
entorno no la tiene. Misma limitación declarada en N3B (F12).

### G12 · lint · build · captura

```
npm run lint    → 0 errores (8 warnings preexistentes en scripts/qa ajenos)
npm run build   → exit 0
capture gate    → 889/889
```

**883 → 889.** Seis aserciones nuevas (N3C-1 a N3C-6). **Ninguna removida,
ninguna relajada.**

**Un re-anclaje, declarado:** N3B-2 contaba `orbMaterialCode({` en la probeta y
exigía **2**; ahora exige **3**. La probeta ganó un tercer dibujante
(`OrbCompareSpecimen`), y también pide la materia a la misma función pura. El
pin sube con él: la regla no se relaja, se extiende al dibujante nuevo — y la
mutación N3B-2 nueva prueba que el tercero está sujeto.

En el camino, **lint encontró un defecto real** que yo había escrito: la ref de
las viñetas de la comparación se asignaba durante el render. Corregido con un
efecto.

### G13 · Mutación con dientes, y el cable además de la conducta

`node scripts/qa/n3-mutation-audit.mjs` → **43/43 mueren con su nombre**, línea
base 889/889 y restauración 889/889. Trece son nuevas de esta etapa:

| mutación | qué repone |
|---|---|
| N3C-1 | la tela se aplana (óvalos todos iguales) |
| N3C-1 | **CABLE** · el shader lee un gris en vez de la función pura |
| N3C-1 | la tela deja de repetirse → costura recorriendo el orbe |
| N3C-2 | se borra el copyright MIT — no cambia un píxel |
| N3C-3 | la onda vive en la altura pero **no en la normal** (el 'sheen' de N3B) |
| N3C-3 | la onda deja de ser de la voz: ondula estando callada |
| N3C-4 | el reloj del campo corre siempre igual |
| N3C-4 | **CABLE** · el reloj se acumula y no llega al lienzo |
| N3C-5 | vuelve el horizonte duro |
| N3C-5 | el campo se va del líquido |
| N3C-6 | el porte fiel deja de inyectarse → la mesa de luz compara contra sí misma |
| N3C-6 | el programa de referencia deja de depender de la inyección |
| N3B-2 | **RE-ANCLADO** · el tercer dibujante se inventa la materia |

### G14 · Zonas prohibidas

Cero `supabase/**`, cero migraciones, cero `src/lib/financial/**`, cero
`src/lib/ai/**`. Verificado sobre `git status`.

---

## Tres defectos que encontré midiendo, no mirando

1. **El instrumento mentía.** El porte fiel daba el **mismo histograma en claro
   y en oscuro** — imposible si `uInverted` llega. La causa: las probetas pintan
   un cuadro y se quedan quietas (es lo que las hace medibles), así que un
   cambio de tema no las tocaba y la página quedaba con orbes del tema anterior.
   Ahora observan `data-theme`. Es la lección de M2, otra vez: el instrumento de
   auditoría puede ser el que miente.
2. **En claro el vidrio saturaba.** El lienzo va premultiplicado con mezcla
   aditiva, así que sobre una página blanca el aire del orbe **sumaba luz hasta
   saturar**: un orbe vacío se leía como una bola blanca y uno lleno perdía el
   nivel. En claro el vidrio ahora tapa la página en vez de sumarse a ella.
3. **La onda de la voz no existía.** 3,8 px sobre un orbe de 124 — el
   instrumento no la encontraba porque no estaba. Ver G8.

Y una trampa que me costó tres pines: **el comentario que explica lo que se
quitó contiene lo que se quitó.** Los pines de N3C-1, N3C-5 y N3C-6 fallaban
contra mi propia explicación (la URL del CDN, el marcador de óvalos, el nombre
del archivo de referencia). Todos miran ahora el **código** y no el archivo.

---

## Lo que sólo existe en hardware

1. **El movimiento.** Este entorno **no compone un solo cuadro**: medido,
   `requestAnimationFrame` devuelve **0 cuadros en 1200 ms** porque el panel está
   oculto. Todo lo de arriba es el primer cuadro, determinista. Cómo se mueve el
   campo, y si «se ve como el de ellos» cuando fluye, sólo lo dice el teléfono.
2. **La voz de verdad.** Medí la onda con volúmenes fijos; hablarle es otra cosa.
3. **fps y térmica**, y el giroscopio.
4. **El hito `orbe`** con una sesión real (G11).

## Desviaciones y no verificado

| # | Qué | Estado |
|---|---|---|
| 1 | **G11 no medido con sesión real** | Argumento por construcción arriba: cero lecturas de servidor tocadas |
| 2 | **A voz 0,35 el instrumento no separa la onda del ruido** | Declarado en G8. A 0,75 y 1 la diferencia es de 3× a 4× |
| 3 | **El santuario no se pudo verificar cuadro a cuadro** | Sin rAF y sin sesión. Se verificó `/dev/shell-preview`: un lienzo, un contexto, cero errores de consola |
| 4 | **Observación, no cambio:** `measure()` de `LiveOrb` redimensiona el buffer y no fuerza un dibujo | Conducta preexistente de N2/N3, no introducida acá. Con el bucle pausado, un cambio de tamaño dejaría el lienzo en blanco hasta el cuadro siguiente. Fuera del alcance de una etapa de presentación; queda anotado |

## Lo que le dejo a quien siga

- **El veredicto del founder sobre el material**, en hardware. Es lo único que
  cierra la etapa.
- `/dev/vidrio` tiene siete hojas: `comparacion`, `vaso`, `campo`, `voz`,
  `chapoteo`, `materias`, `profundidad`. La hoja `cuarto` **murió con el cuarto**
  y pasó a ser `campo` — el mismo instrumento de antes/después, del cambio de
  esta etapa.
- `orb-reference-shader.ts` está **congelado a propósito**: es el porte fiel, y
  se toca sólo si cambia el archivo de ellos. Si alguien lo «mejora», G6 pasa a
  comparar nuestro orbe contra sí mismo.
- Si mañana se quiere el look de ellos **sin** nivel ni aire, ya está: es
  `variant: "referencia"` en `OrbCompareSpecimen`.

---

## Ronda 2 — el founder miró producción

Dos hallazgos suyos, y los dos eran reales. El segundo lo estaba **sujetando el
propio gate**.

### Hallazgo 1 · «No se parece en nada al que ellos tienen en su página»

Trajo capturas de la web de ElevenLabs. Puestas al lado de lo que produce su
componente publicado, **no son el mismo objeto**:

| | su componente (`elevenlabs/ui · orb.tsx`) | su página |
|---|---|---|
| estructura | siete óvalos en coordenadas **polares** | ninguna: manchas blandas |
| centro | singularidad — todo converge en el radio cero | no hay centro |
| bordes | rectos en el ángulo (un molinete) | no hay bordes |
| negros | cuñas negras entre óvalos | ningún negro: el oscuro es del color |
| textura | lisa | **grano** visible |

**El porte de la ronda 1 era fiel — al archivo equivocado.** No fue un error de
transcripción: verifiqué línea por línea, y la ronda 1 se cerró contra ese
archivo porque el spec lo nombraba como la fuente. Lo que nadie comprobó, yo
incluido, es que ese componente sea lo que su marketing muestra. No lo es.

Un óvalo polar tiene por construcción las dos cosas que sus orbes no tienen —
borde recto en el ángulo y singularidad en el radio cero — así que el molinete
no era un ajuste mal elegido: era la técnica. **Ninguna cantidad de tuneo lo
iba a acercar.**

**Lo que reemplaza a los óvalos: deformación de dominio.** Un ruido cuyo
argumento es otro ruido. No hay coordenadas polares en ninguna parte, así que no
puede haber ni molinete ni convergencia; y produce justo lo que se ve en sus
capturas: regiones grandes, blandas, enroscadas. Encima, **grano**, que es lo que
más barato compra «material» en vez de «degradado». La rampa sigue siendo de
cuatro paradas pero **ninguna es negra**: el extremo oscuro es el pigmento
profundo de la capa, como en las suyas.

Tres correcciones que salieron de mirar, no de suponer:

| medida | por qué |
|---|---|
| 4 octavas → **2** | con cuatro el campo salía como papel arrugado: detalle en todas las escalas. Sus orbes tienen dos o tres manchas y nada de detalle fino — lo fino lo pone el grano, que va aparte |
| desplazamiento 2,0 → **0,32–0,58** | las manchas de la octava base miden 0,25 de tela; desplazar 2,0 las revuelve ocho veces y devuelve ruido |
| escala 0,62 → **0,22** | con 0,62 el orbe abarcaba cinco manchas y se leía como textura; los suyos muestran dos o tres |

El porte fiel se **conserva** en `orb-reference-shader.ts` y `/dev/vidrio` lo
muestra por lo que es —su código abierto, que no es su página—, con esa
advertencia escrita en la hoja. Es lo único suyo que se puede ejecutar y comparar.

### Hallazgo 2 · «Patrimonio sigue mostrando esa esfera que no concuerda»

Tenía razón dos veces, y la causa era una **colisión de códigos** en el
contrato:

```
orbMaterialCode({ kind: "patrimonio", matter: "liquido", fill: "nivel" })  → 3
orbMaterialCode({ kind: "reserva",    matter: "liquido", fill: "nucleo" }) → 3
```

`ORB_MATERIAL.patrimonio` vale 3, y N3B eligió **ese mismo número** para decir
«sin techo, cristal». El shader lee el 3 como cristal
(`step(2.5, uMat) * step(uMat, 3.5)`), así que **Patrimonio no podía dibujar
líquido nunca** — ni con techo declarado. En producción decía «36% de tu meta»
debajo de una bola de cristal: el texto afirmaba un nivel y la materia lo negaba.

N3B había escrito la doctrina correcta —*«el cristal aparece cuando falta el
techo, en cualquiera de las cinco, y desaparece en cuanto el techo se
declara»*— y el código sólo cumplía la primera mitad.

**Y el gate lo estaba congelando.** El pin de N3-4 decía, literalmente:

```js
orbMaterialCode({ kind, matter: "liquido", fill: "nucleo" }) === ORB_MATERIAL.patrimonio
```

Es decir: exigía la colisión. Es la **trampa 9 del spec**, palabra por palabra —
*«un pin de cadena puede CONGELAR un defecto»*— y esta vez el pin no era de
cadena sino de conducta, lo que lo hace peor: parecía que estaba comprobando la
doctrina y estaba comprobando el bug.

Arreglo: el cristal deja de tomarle prestada la identidad a una capa y tiene su
propio código (`ORB_MATERIAL_CRISTAL = 6`), como ya lo tenía la gota. Es un
**estado**, no una capa. El pin se re-ancló a la conducta completa, incluida la
mitad que faltaba: **ninguna capa con techo declarado puede caer en la materia
del cristal.**

**Y la esfera facetada murió.** Ahí vivía una gema de veintitantas caras
suspendida en el vidrio: un objeto de otra familia, con otra iluminación, dentro
del mismo orbe. La reemplaza la doctrina dicha en la materia de esta etapa: sin
techo, el vidrio se llena **entero** del mismo campo, sin línea de agua y sin
menisco. Un orbe lleno deja aire y tiene menisco; uno sin techo no tiene
ninguno de los dos, porque no hay ninguna altura que afirmar.

Evidencia: `docs/design/evidence/N3C-materias.png` — arriba las cinco capas
líquidas (Patrimonio incluido, por fin), abajo las cinco sin techo.

### Los números de la ronda 2

```
npm run lint    → 0 errores (8 warnings preexistentes, ajenos)
npm run build   → exit 0
capture gate    → 889/889
mutación        → 48/48 mueren con su nombre (43 + 5 nuevas)
```

Las aserciones siguen siendo **889**: la ronda 2 no agregó, **re-ancló**. Tres
pines cambiaron y los tres se declaran:

| pin | antes | ahora | por qué |
|---|---|---|---|
| N3-4 | `orbMaterialCode(nucleo) === ORB_MATERIAL.patrimonio` | `=== ORB_MATERIAL_CRISTAL`, **más** «ninguna capa con techo cae en cristal» | el viejo exigía la colisión |
| N3-4 | la línea literal `step(2.5, uMat) * step(uMat, 3.5)` | el cristal se lee por su número propio | la línea literal **era** el defecto |
| N3C-5 | el bucle de siete óvalos | el campo **no es polar** y **sí** es deformación de dominio, con el grano cableado | el bucle era la técnica equivocada |

Cinco mutaciones nuevas, todas mueren con nombre — entre ellas la que **repone
la colisión exacta** que el founder vio, y la que deja el grano calculado pero
sin sumar.

### El peso, otra vez

| | base | ronda 1 | ronda 2 |
|---|---|---|---|
| `/app` comprimido | 65,7 KB | 69,7 KB | **70,5 KB** |
| `.next/static/chunks` | 1392 KB | 1416 KB | **1428 KB** |

Total de N3C sobre el santuario: **+4,8 KB comprimidos**, cero dependencias.

### Lo que sigue sin poder verificarse acá

El lienzo del santuario quedó **vacío** al medirlo (cero píxeles pintados): el
panel de este entorno está oculto, `requestAnimationFrame` no corre, y el buffer
se limpia al redimensionar sin que nadie lo vuelva a dibujar. Lo que se ve en
`/dev/shell-preview` es el orbe de CSS de reserva, no el lienzo. **No es un
defecto del shader** —las probetas dibujan sincrónicamente y prueban el
material— pero significa que el santuario compuesto sólo se juzga en hardware.
El proxy honesto es `/dev/vidrio?hoja=profundidad`, que usa la MISMA función de
colocación y el MISMO renderer, y sí dibuja.

Queda anotada, otra vez y ahora con más peso, la observación de la ronda 1:
`measure()` de `LiveOrb` redimensiona el buffer y no fuerza un dibujo. Con el
bucle vivo no se nota; con el bucle pausado deja el lienzo en blanco. Sigue
siendo conducta preexistente de N2/N3 y sigue fuera del alcance de una etapa de
presentación — pero es la causa de que este entorno no pueda verificar el
santuario, y merece su propia etapa.

---

## Ronda 3 — el founder lo miró en el teléfono

Seis observaciones suyas. **Las seis tenían una causa medible**, y ninguna era
un ajuste de gusto.

| lo que dijo | la causa | el arreglo |
|---|---|---|
| «manchas super duras combinadas entre sí» | **la rejilla**, no el ruido | muestreo quíntico |
| «el nuestro es mucho más estático» | **45 s** por mancha en reposo | velocidad ×10 |
| «cuando hablo casi no hay movimiento» | la voz movía la deformación 0,32→0,58 | 0,34→1,05, y la velocidad al triple |
| «esa segunda línea de agua se ve terrible» | el menisco rodeaba **toda** la elipse | sólo el borde lejano |
| «la forma del agua como hacia arriba» | cámara a −0,30 + menisco trepando | cámara a **−0,11** |
| «líneas dibujadas que no se entiende qué son» | la **cáustica** del fondo | eliminada |

### La rejilla — el hallazgo de la ronda

Lo que se veía como manchas duras no venía del ruido: venía del **filtrado de
la textura**. Medido:

```
el orbe abarca 113 téxeles · cada téxel ocupa 5,0 px
⇒ magnificación 5,0× — la rejilla bilineal SE VE
```

La GPU interpola **recto** entre téxeles. A cinco píxeles por téxel eso dibuja
los bordes de las celdas — cuadriláteros, exactamente lo que se veía en el orbe
naranja. El arreglo es curvar la coordenada **antes** de muestrear, con la misma
quíntica de Perlin: la GPU sigue interpolando recto, sobre una coordenada ya
curvada, y el resultado es continuo en la segunda derivada. Cinco operaciones,
ninguna lectura extra.

**Su mutación sobrevivía al gate.** Ahora está pinchada.

### El movimiento — una razón no dice nada de la velocidad

El pin de N3C-4 exigía que hablando el campo corriera **5× más rápido** que
callado. Lo cumplía de sobra… con un campo que en reposo **no se movía**:

```
reloj en reposo 0,1 /s  ×  0,055 de tela por unidad  =  0,0055 de tela/s
una mancha mide 0,25 de tela  ⇒  45 SEGUNDOS por mancha
```

Una razón no dice nada sobre la velocidad absoluta, que es lo único que el ojo
juzga. El pin pasa a medir **tiempo**, con la misma cuenta que hace el shader:

| | antes | ahora |
|---|---|---|
| una mancha, callado | 45 s | **4,3 s** |
| una mancha, hablando | 4,5 s | **1,3 s** |

Y la voz abre la deformación tres veces más que antes, además de acelerar el
reloj. Son dos efectos distintos: uno cambia el ritmo, el otro cambia **cuánto
se revuelve**.

### El agua

- **Cámara de −0,30 a −0,11.** Modelado antes de tocar: la curvatura de la
  superficie al 36 % cae de 37,5 a 22,7, y al 100 % de 18,9 a **0,8**. El
  cuenco desaparece. Los cinco umbrales de N3-1 siguen valiendo con margen.
- **Una sola línea.** El menisco se dibujaba alrededor de toda la elipse: el
  borde lejano —el que el ojo lee como «el nivel»— y también el cercano, más
  abajo. Dos arcos paralelos no existen en un vaso. Se conserva el lejano, que
  es además lo que pasa de verdad: el borde de acá lo mirás a través del agua.
- **Se fueron la cáustica y las motas.** Físicamente correctas, y el founder las
  leyó por lo que parecían.
- **El menisco casi no trepa** (0,35 de lo que trepaba).

**Efecto secundario que vale la pena:** `orbWaterApex` dejó de ser una cota
inferior con desvío. Medido sobre el renderer real, contra lo que calcula la
función pura:

| dato | calculado | medido | desvío |
|---|---|---|---|
| 60 % | 48,7 % | **47,5 %** | −1,2 |
| 100 % | 70,7 % | **~70 %** | ~0 |

En N3B el desvío era +2,1 y +6,5 puntos, porque el menisco levantaba el borde y
el contrato no lo modelaba. Ahora el dibujo y la cuenta dicen lo mismo. La
separación se mantiene: vacío ≈ 0,05 · 60 % ≈ 0,475 · 100 % ≈ 0,70, y el lleno
deja **30 % de aire**.

### El material

- **Se va el `smoothstep(0.06, 0.94)`** de la rampa. Lo había puesto para ganar
  rango tonal y lo que hacía era **empinar** la transición — de ahí los bordes.
  El rango se recupera separando las paradas, no acelerando la curva. Y cada
  tramo interpola suavizado: una unión con quiebre de pendiente **se ve** como
  un borde.
- **Un segundo campo, el del color.** Con una sola rampa el orbe es un tono con
  más y menos luz; los suyos funden violeta con rosa con azul. `fieldHue` corre
  el color intermedio entre el líquido y el acento, y comparte la deformación
  pero mira otra parte de la tela, así que sus manchas **no coinciden** con las
  del tono. De ahí sale que los colores se fundan en vez de repartirse en zonas.
  **Su mutación también sobrevivía al gate.**
- **Mate.** El reflejo del vidrio baja a menos de la mitad, el borde a un
  tercio, y el destello duro del panel a una cuarta parte.

### Los números de la ronda 3

```
npm run lint    → 0 errores
npm run build   → exit 0
capture gate    → 889/889
mutación        → 53/53 mueren con su nombre (48 + 5 nuevas)
```

Las aserciones siguen en **889**: la ronda 3 tampoco agrega, **re-ancla y
refuerza**. Dos pines nuevos dentro de aserciones existentes —el muestreo
quíntico y el segundo campo— porque sus mutaciones **sobrevivían**; ésa es la
prueba de que hacían falta.

Dos re-anclajes, los dos declarados:

| pin | antes | ahora | por qué |
|---|---|---|---|
| N3C-4 | «hablando corre 5× más que callado» | «una mancha cruza en <6 s callado y <2 s hablando» | una razón la cumple un campo quieto |
| N3C-3 | la línea literal del menisco | el menisco **más** el factor del borde lejano | el pin viejo permitía los dos arcos |

| peso | base | r1 | r2 | **r3** |
|---|---|---|---|---|
| `/app` comprimido | 65,7 KB | 69,7 | 70,5 | **71,6 KB** |

Total de N3C: **+5,9 KB comprimidos**, cero dependencias.

### Lo que sigue sin poder juzgarse acá

**El movimiento.** Sigue siendo lo único que decide, y este entorno no compone
cuadros. Lo que sí puedo afirmar con números es que el campo pasó de cruzar una
mancha en 45 s a hacerlo en 4,3 s, y en 1,3 s hablando — pero si eso «se mueve
de una forma interesante» sólo lo dice el teléfono.

---

## Ronda 4 — fui a mirar su página

El founder pidió que entrara a `elevenlabs.io` y viera **cómo se mueve**. Lo que
encontré cambia el encuadre por segunda vez.

### Cómo está hecho su orbe en reposo

No es un shader. Es esto, leído de su DOM:

```html
<svg>
  <filter id="…">
    <feGaussianBlur stdDeviation="4"/>
    <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 100 -1"/>
    <feFlood/><feComposite operator="out"/><feComposite in2="SourceGraphic"/>
    <feGaussianBlur stdDeviation="4"/>
  </filter>
  <image width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
         href="data:image/png;base64,…" style="filter:url(#…)"/>
</svg>
```

Decodifiqué ese PNG. **Mide 8×8 píxeles.** Sesenta y cuatro colores, todos
opacos, todos distintos — estirados a 200 px (magnificación **25×**) y pasados
**dos veces** por un desenfoque gaussiano, encima de un PNG pre-renderizado.

Ahí está entera la respuesta a *«se fusionan perfecto sin manchas duras»*:
**no hay casi información espacial con la que hacer un borde.** Es una malla de
color de orden bajísimo, difuminada. No hay ruido fractal, no hay octavas, no
hay deformación.

Y hay un `<canvas>` WebGL encima que sólo pinta al reproducir — ése es el orbe
animado. **No lo pude ver correr:** este entorno no compone cuadros, así que el
lienzo de ellos también quedó en cero píxeles. Intenté capturar su shader
forzando una pérdida/restauración de contexto y no recompiló.

### Lo que cambió en el nuestro

| | antes | ahora | por qué |
|---|---|---|---|
| octavas | 3 | **~1** (0,88 + 0,12) | los suyos tienen 64 muestras y punto |
| deformación | 0,34–1,05 | **0,11–0,26** | 1,05 desplaza cuatro manchas: eso no enrosca, revuelve — y revuelto se lee «brusco» |
| movimiento | traslación + giro | **sólo giro** | «viene de un solo lado como viento» vs «bordea la esfera»: es traslación vs rotación |
| vuelta completa | — | **46 s** callado · **15 s** hablando | la ronda 3 se pasó de largo |
| rampa | de `uDeep*0.55` a casi blanco | **cuatro tonos medios** | en sus orbes no hay ni un negro ni un blanco |

El campo del color gira **al revés** que el del tono: dos rotaciones opuestas se
leen como algo que se revuelve sobre sí mismo en vez de girar como un carrusel.

### La decisión del founder: apagar el agua, para poder juzgar

Textual:

> «Vamos con el campo llena el orbe entero, sólo porque quiero ver con eso qué
> tanto nos logramos parecer al de ellos, y después de eso probamos opciones
> como el tono sin superficie o seguimos tratando con el agua.»

Es un **experimento**, no un cierre, y por eso se implementó como un
interruptor y no como un borrado: `ORB_FIELD_ONLY` en el contrato puro. El agua
—`advanceOrbWater`, el menisco, la superficie, la onda de la voz, `orbWaterline`,
`orbWaterApex`— **no se tocó**. Apagar el interruptor devuelve todo.

**Lo que cuesta, dicho sin adornos:** con el experimento encendido **el orbe
deja de mostrar el nivel.** La cifra y la frase de abajo lo siguen diciendo
enteras —no cambia un solo número— pero el vidrio deja de afirmarlo.

**La excepción que no es estética:** un cero LEÍDO sigue siendo una gota.
Dibujar un cero como un orbe lleno y luminoso no es un gusto distinto, es una
afirmación falsa sobre plata. Eso no entra en un experimento visual, y una
mutación lo prueba.

### Un hallazgo que NO arreglé, a propósito

El founder: *«en los orbes de saldo no hay nada de nivel, ni el nivel mínimo
para mostrar el vacío»*. Lo rastreé hasta `shell-payload.ts`:

```ts
level: saldo.cap > 0 ? clampLevel(saldo.saldo / saldo.cap) : null,
```

Su `cap` —el techo del tanque— **es cero**, así que el nivel es `null`, la
materia pasa a cristal y el orbe dibuja el campo entero sin línea. **El dibujo
está haciendo lo correcto**: sin techo no se inventa un nivel. Lo que hay que
mirar es por qué el motor no puede afirmarle un techo al Saldo, que es su capa
principal — y eso es motor, no presentación, así que queda fuera de N3C y no lo
toqué. Es la doctrina en acción: nadie rellena un número.

### Los números de la ronda 4

```
npm run lint    → 0 errores
npm run build   → exit 0
capture gate    → 890/890  (una aserción NUEVA: N3C-7)
mutación        → 55/55 mueren con su nombre
```

**N3C-7** existe para que el experimento no pueda volverse permanente por
descuido: exige que el interruptor sea uno solo, que **delegue** en
`orbMaterialCode` en vez de reemplazarla, que la doctrina de abajo siga
diciendo lo de siempre al ejecutarla, que un cero leído nunca se dibuje lleno,
y que las cifras no se enteren del experimento.

Cuatro re-anclajes por el cambio de `orbMaterialCode` a `orbPresentationMaterial`
en los cuatro dibujantes; la regla no se movió —sigue habiendo UNA decisión— y
lo que se cuenta es la llamada nueva.

### Lo que queda abierto

1. **El movimiento**, otra vez y sigue siendo lo único que decide.
2. **Cómo se muestra el nivel** si el experimento gusta: el anillo del carrusel,
   un arco fino en el borde, o la opción de «tono sin superficie» que el
   founder ya nombró.
3. **El vacío bajo el experimento.** La gota se conserva por honestidad, pero
   con el resto sin agua se ve fuera de lugar. Si el experimento sigue, el cero
   necesita su propia forma dentro del material nuevo.
4. **El techo del Saldo**, en el motor.

---

## Ronda 5 — el movimiento no es transporte

El founder, sobre la ronda 4: *«es sólo una capa que pasa y se mueve
bruscamente a velocidad super rápida. Incluso es molesto de ver por más de unos
segundos.»* Y: *«en textura está casi idéntico, pero en choque de colores,
movimiento y flujo estamos lejos.»*

### Lo que intenté para ver su movimiento, y por qué no pude

Pidió expresamente que entrara a ver cómo se mueve el suyo. Lo intenté por
cinco caminos y **fallé en los cinco**. Vale la pena dejar por qué:

1. **Renderizar su orbe en el panel de este navegador.** Su lienzo WebGL sólo
   existe *mientras suena el audio* (el clip dura 3,4 s). El panel está oculto,
   `requestAnimationFrame` no corre, y el audio no arranca.
2. **Reemplazar `requestAnimationFrame` por un temporizador**, que sí corre
   oculto. El bucle avanzó (5 pedidos) pero el lienzo nunca llegó a montarse.
3. **Tu Chrome real.** También entrega la pestaña en segundo plano:
   `visibilityState: hidden`, cero cuadros en un segundo.
4. **Capturar su shader forzando pérdida y restauración de contexto.** No
   recompiló.
5. **Buscar su shader en su JavaScript.** Extraje el mapa de webpack y revisé
   **los 409 chunks** del sitio más los ya cargados: **cero** contienen GLSL del
   orbe. El único con GLSL es three.js interno.

**Así que no vi su movimiento, y no voy a decir que sí.**

### Lo que sí extraje, y lo que implica

Su orbe en reposo está hecho con **64 píxeles** (8×8) estirados 25 veces y
desenfocados dos veces. De ahí sale una consecuencia que **no necesita ver el
movimiento para ser cierta**:

> Su campo **no tiene un solo rasgo que el ojo pueda seguir.**

Y ésa es la explicación de las dos rondas fallidas. Mientras nuestro campo tenga
rasgos seguibles, **cualquier** transporte —traslación o giro— se lee como
velocidad y como dirección. El founder lo vio con traslación («viene de un solo
lado como viento») y lo volvió a ver con giro («una capa que pasa»). Bajar la
velocidad no lo arregla: si hay algo que seguir, se ve pasar.

**Así que el movimiento deja de ser transporte y pasa a ser DEFORMACIÓN.**
`p` no se mueve nunca: ni gira ni se traslada. Lo único que avanza con el tiempo
es el campo de desplazamiento, y su amplitud está acotada a un cuarto de mancha.
Las manchas se hinchan, se estiran y se deshacen **en su sitio**. Nada cruza el
orbe, y por eso no hay ni velocidad ni dirección que percibir.

Es una regla, no un ajuste, y está pinchada: `p` no puede reasignarse dentro del
campo. La mutación que repone el giro muere con nombre — y la primera versión de
ese pin **no la mataba**, porque estaba anclada a principio de línea y la
mutación metía el giro en la misma línea que su declaración. Corregido.

### El choque de colores

El extremo oscuro de la rampa seguía siendo el pigmento profundo casi puro, y
contra el medio claro eso es un choque, no una fusión. Las cuatro paradas viven
ahora mucho más juntas.

### Los números

```
lint 0 · build 0 · capture 890/890 · mutación 56/56 con nombre
```

### Lo que le pido al founder

No puedo ver el movimiento con las herramientas que tengo. Lo que sí serviría:
**cuatro o cinco capturas del MISMO orbe, con un segundo de diferencia**,
mientras suena. Con eso puedo medir si se deforma en el sitio o si algo viaja, y
a qué ritmo — que es exactamente lo que no puedo observar.

---

## Ronda 6 — el fluido

El founder pidió que encontrara la forma de ver su movimiento. La encontró él:
**trajo Chrome al frente.** Con la pestaña oculta el navegador suspende
`requestAnimationFrame` y nada se anima — ni lo nuestro ni lo ajeno. Medido:
**0 cuadros/s oculta, 120 cuadros/s visible.** Treinta segundos de su tiempo
valieron más que cinco rondas mías.

### Lo que apareció

Enganché `shaderSource` y capturé **20 shaders**. El compuesto declara:

```
uniform sampler2D uFluidSimTexture;    ← una simulación de fluidos
uniform sampler2D uTexture;            ← un degradado pre-renderizado
uniform vec4 uAudioAverage, uAudioAverageInput, uCumulativeAudio;
float filmGrainNoise(...)  contrast()  exposure()  czm_saturation()
```

Y los shaders chicos son, uno por uno, el solver clásico de Navier-Stokes:

| uniformes | paso |
|---|---|
| `point`, `radius`, `color`, `cumulativeAudio`, `audioAverage` | **salpicadura** — el audio inyecta fuerza |
| `uVelocity` | divergencia |
| `uVelocity` | advección |
| `uVelocity`, `uCurl`, `curl`, `dt` | **vorticidad** |
| `uPressure`, `uDivergence` | presión por Jacobi |
| `uPressure`, `uVelocity` | resta del gradiente |

**Su orbe es una simulación de fluidos empujada por la voz.** Por eso ninguna de
las cinco rondas podía llegar: un campo de ruido sólo sabe quedarse quieto o
desplazarse, y las dos cosas se leen como transporte. Un fluido **advecta** —
cada trozo viaja por su cuenta siguiendo la velocidad local, se enrosca, no
repite, y cuando lo empujás la perturbación se propaga sola y se disipa.

(No pude leer su `main()`: un filtro de seguridad de la herramienta bloqueó el
cuerpo. Los uniformes y las firmas alcanzaron.)

### Lo que se construyó

`orb-fluid.ts`: el solver completo — salpicadura, curl, vorticidad, divergencia,
presión por Jacobi, resta del gradiente y advección — sobre texturas de media
precisión, velocidad a 128² y rastro a 192². **Cero dependencias nuevas.**

- **El rastro advectado ES el desplazamiento del campo.** La estampa del
  material sigue siendo nuestra —las manchas, la rampa, el grano—; lo que cambia
  es que ahora la mueve un líquido de verdad.
- **Un fluido para el lienzo entero**, como el lienzo es uno para los cinco
  orbes. Cada capa lo mira girado 72°, así que ninguna repite el remolino de
  la anterior.
- **El degradado es honesto:** sin texturas de coma flotante `createOrbFluid`
  devuelve `null`, el shader recibe `uHasFluid = 0` y el campo vuelve a su
  deformación de ruido. Peor, y verdadero. Y se puede **medir**: el lienzo
  declara `data-fluid`.
- **La probeta adelanta 6 s de simulación** antes de la primera foto — un fluido
  recién arrancado está quieto, y la mesa de luz mostraría un material sin
  movimiento, que es justo lo que hay que juzgar.

### Lo que el gate sujeta

El solver corre en la GPU y desde node no se ejecuta. Lo que **sí** se ejecuta es
el **calendario de empujones**, que es donde vive la conducta que el founder
juzga. N3C-8 exige:

| | medido |
|---|---|
| en silencio sigue habiendo empuje | 0,0086 |
| hablando empuja mucho más | 0,383 — **44×** |
| la fuerza va por segundo, no por cuadro | mitad de `dt` ⇒ exactamente la mitad del empuje |
| el fluido se disipa | `> 0`, o el orbe termina hirviendo |
| sin coma flotante, sin fluido | `ORB_FLUID_ITERATIONS[1] === 0` y el respaldo de ruido |

### Dos defectos míos, encontrados ejecutando

1. **El shader no compilaba.** Declaré `gFlow` *después* de `fieldGray`, que lo
   usa — y GLSL exige declarar antes de usar. El renderer devolvía `null` y las
   probetas decían «sin contexto WebGL».
2. **Crear los destinos del fluido deja uno atado.** Sin desatar el framebuffer
   al final de la creación, todo lo que el orbe dibujaba después aterrizaba
   dentro de la última textura de la simulación, y el lienzo salía en negro.

Los dos aparecieron en el primer render, no leyendo el código.

### Los números

```
lint 0 · build 0 · capture 891/891 · mutación 62/62 con nombre
```

Peso del santuario: 65,7 KB gz de base → **75,9 KB gz** (+10,2). El solver son
siete programas de shader más; es la pieza más grande del bloque y la única que
podía dar el movimiento. Cero dependencias.

```
```

---

## Ronda 7 — medir el suyo, y calibrar contra el número

El founder trajo su Chrome al frente. Con la pestaña visible el navegador vuelve
a componer cuadros, y por fin pude **capturar su orbe cuadro a cuadro**: 181
cuadros de reposo y 181 con audio, leídos DENTRO del cuadro de animación
(su lienzo no conserva el búfer, así que copiarlo desde fuera devuelve vacío).

### Lo que mide su orbe

| | **en reposo** | **hablando** |
|---|---|---|
| magnitud del movimiento (px/0,5 s sobre 80) | **5,99** | pulsa 3,4 → 7,4 |
| coherencia de traslación | **0,12** | **0,56 – 0,74** |
| coherencia de rotación | 0,07 | 0,10 – 0,39 |
| decorrelación a 0,25 / 0,5 / 1 / 2 s | 0,0246 / 0,0449 / 0,0747 / 0,0969 | — |
| saturación (mín / media / máx) | 0,55 / **0,91** / 1,00 | — |
| luz (mín / máx) | 0,34 / 0,83 | — |
| tono | banda de ~40°, 85 % en un solo tono | — |

**Y ahí está la respuesta a las dos preguntas.**

**En reposo su movimiento es INCOHERENTE.** Las tres coherencias valen ~0,1: no
hay traslación de conjunto, ni giro de conjunto, ni expansión. Cada trozo va por
su lado. Eso es lo que se lee como paz — nada tiene dirección, así que no hay
nada que seguir.

**Hablando pasa a ser COHERENTE.** La coherencia de traslación salta a 0,56–0,74
y la magnitud pulsa al ritmo del sonido. Eso son **olas**: movimiento con
dirección, que barre y vuelve. Es literalmente lo que el founder describió —
«crea como ondas u olas de líquido que responden a la voz».

Son dos regímenes opuestos, y nosotros no teníamos ninguno de los dos.

### Tres defectos nuestros, cada uno encontrado por una medición

**1 · Un error de UNIDADES tenía el fluido congelado.** La advección desplaza
`dt × velocidad × (1/128)` por cuadro: con `dt = 1/60` eso divide la velocidad
por **7680**. Yo inyectaba velocidades de ~0,07, que mueven el rastro **una
diezmilésima de téxel por cuadro**. El fluido no estaba lento: estaba parado.

Lo delató una medición absurda: **quintuplicar la fuerza bajó el movimiento**
(1,52 → 1,02). Ninguna cantidad de ajuste iba a arreglar una escala equivocada.

**2 · El rastro saturaba contra su propio tope.** Con la inyección alta el
rastro vivía en ±10 y el orbe lo recortaba a ±1,35. Pasado el recorte el
desplazamiento es **constante en casi todo el disco**, y un desplazamiento
constante no mueve nada. Ése era, exactamente, el «patrón trabado» que el
founder vio tres rondas seguidas. Ahora el tope es **suave**: siempre queda
pendiente, por fuerte que sea el rastro.

**3 · El mapeo tonal desaturaba el color.** Medido: 0,50 contra su 0,91. No era
el vidrio — es que comprimir los altos les quita saturación. Ellos lo compensan
con un paso propio (`czm_saturation` está en su shader); acá va el mismo.
**Medido después: 0,91, igual que ellos.**

Y una corrección de forma: los agitadores empujaban **hacia donde iban**, así que
los cinco sumaban una corriente de conjunto — coherencia 0,49 contra su 0,12, que
es justo lo que se lee como «una capa que pasa». Ahora empujan **de costado y
con sentidos alternos**: cada uno inyecta un remolino, la suma se cancela, y
queda el corte entre remolinos.

### Dónde quedamos, con el mismo instrumento

| | ellos | antes de la ronda | **ahora** |
|---|---|---|---|
| magnitud | 5,99 | 1,52 | **4,88** |
| coherencia de traslación | 0,12 | 0,21 → 0,49 | **0,26** |
| decorrelación a 1 s | 0,0747 | 0,0048 | **0,0184** |
| saturación media | 0,91 | 0,50 | **0,91** |

La saturación está igualada. La magnitud está al **81 %**. La decorrelación
sigue **4× por debajo**: el campo se renueva menos que el suyo, y ése es el
trabajo que queda.

### Lo que el gate aprendió de todo esto

Tres pines nuevos, y los tres nacieron de un defecto que **había sobrevivido**:

- **las unidades**: un empujón tiene que mover el rastro más de un décimo de
  téxel por cuadro. Por debajo de eso no hay movimiento que ver, y nada lo
  delataba.
- **el tope suave**: prohibido el recorte duro, que es como se fabrica un patrón
  trabado.
- **el factor de saturación** tiene que ser mayor que 1,2: con 1,0 la función
  existe y no hace nada — así sobrevivía su mutación.

```
lint 0 · build 0 · capture 891/891 · mutación 65/65 con nombre
```

---

## Ronda 8 — un retroceso mío, y el guardarraíl que lo permitió

El founder abrió producción y la vio **rota**: rayas rectas, mota y cortes
bruscos, peor al deslizar. Fue un defecto mío de la ronda 7, en el sentido
contrario al que acababa de arreglar.

### La causa

`ORB_FLUID_GRID = 5200` inyectaba velocidades de **5.720**, y eso rompe la
imagen por dos caminos a la vez:

- **El solver recorta la velocidad a ±1000** (lo hace el paso de vorticidad).
  Una salpicadura por encima del tope deja un **salto duro** justo donde
  empujó — los cortes.
- **La advección desplaza `dt × v × (1/128)`.** Con esa velocidad muestrea muy
  fuera del dominio, donde la textura repite el borde — **las rayas rectas**.

El demo clásico de fluidos inyecta 100–300. Yo estaba veinte veces por encima
del techo del propio solver.

### La causa de la causa

Le había atado **todo** el desplazamiento al fluido, así que la única forma de
que el movimiento se notara era subir la simulación hasta que reventara. Su
propio shader no hace eso: tiene ruido animado (`uNoiseSpeed`, `uFbmSpeed`)
**y** el fluido encima. Ahora igual — el fluido **suma** al desplazamiento
propio en vez de sustituirlo. El fondo lo da la deformación propia, calma y sin
artefactos; el fluido aporta lo orgánico y la voz.

Y el gesto dejó de girar el campo: durante un deslizamiento `uSpin` salta, y el
giro brusco se leía como un corte — por eso el founder lo vio «mucho más
evidente» al deslizar. El orbe se mueve; su contenido no.

### Medido después

| | ellos | **nosotros** |
|---|---|---|
| magnitud | 5,99 | **5,85** |
| coherencia | 0,12 | **0,19** |
| saturación | 0,91 | **0,91** |
| bordes duros | — | **0,4 %** |

### El pin tenía UN SOLO LADO

Y por eso dejó pasar esto. Exigía que la velocidad superara un mínimo —quedarse
corto congela el fluido, que era el defecto de la ronda 7— y **no** exigía que
estuviera por debajo del tope que el propio solver aplica. Un umbral con un lado
deja pasar el otro, y el otro llegó a producción.

Ahora comprueba **los dos**, sobre **todas** las salpicaduras, incluida la voz
al máximo. Y dos pines más que nacieron de mutaciones que sobrevivieron: el
factor con el que el fluido entra al tono y al color no puede ser cero — `* 0.0`
conserva la forma de la línea y apaga el fluido entero.

```
lint 0 · build 0 · capture 891/891 · mutación 67/67 con nombre
```

**La lección, y es de método:** cuando una ronda corrige una magnitud que estaba
demasiado baja, el pin que se escribe para que no vuelva a bajar hay que
escribirlo **con los dos extremos**. Yo escribí la mitad, y la otra mitad la
pagó el founder mirando la app rota.

---

## Ronda 9 — las rayas no venían de la fuerza

El founder volvió a ver la app dañada después del arreglo de la ronda 8. Y tenía
razón: yo había corregido **la mitad** del problema.

### La causa real

La textura del fluido es `CLAMP_TO_EDGE`: **fuera de su borde repite la última
fila**. Y el orbe la muestreaba con las coordenadas del **líquido** —desplazadas
hacia abajo para anclar el campo al agua—, así que la parte de arriba del orbe
caía fuera. Medido:

```
plano del agua −1,00 → muestreo v en [0,43 · 1,31]  ← FUERA
plano del agua −0,30 → muestreo v en [0,30 · 1,18]  ← FUERA
plano del agua  0,40 → muestreo v en [0,17 · 1,05]  ← FUERA
```

**Una fila repetida a lo largo de todo el ancho es literalmente una raya
vertical.** Por eso aparecían arriba, en todos los orbes, y sin depender de la
fuerza de la simulación. Sobrevivieron a la ronda 8 porque yo estaba mirando la
magnitud del fluido y no dónde se lo muestreaba.

Arreglo: se muestrea con las coordenadas **crudas** del orbe (`uv`, que dentro
del disco vale como mucho 1) y con un factor de 0,40, así que el muestreo vive
en **[0,10 · 0,90]** y nunca toca el borde.

### Verificado con un instrumento nuevo

Un detector de rayas: la **anisotropía del gradiente**. Una raya vertical tiene
mucho gradiente horizontal y casi ninguno vertical, así que el cociente la
delata aunque sea tenue.

| | resultado |
|---|---|
| anisotropía del gradiente | **1,00** (isotrópico: sin rayas) |
| saltos duros, 241 cuadros en 8 s | media **1,03 %**, máx **1,80 %**, ninguno > 2 % |
| peor fila / peor columna | 1,8× y 1,5× la media, **y en el borde del disco** |

La última fila importa: **no hay ninguna discontinuidad interna**. Lo que parecía
una costura horizontal en una captura era compresión de la propia captura.

### El pin

Ahora el gate exige que el factor de muestreo mantenga el rango **dentro** de la
textura —lo calcula, no lo supone— y que se usen las coordenadas crudas. Dos
mutaciones nuevas reponen exactamente las rayas.

```
lint 0 · build 0 · capture 891/891
```

**La lección se repite, y por eso la escribo otra vez:** en la ronda 8 el defecto
fue un umbral con un solo lado. En la 9 fue mirar la magnitud cuando el problema
estaba en el muestreo. Las dos veces el error fue **corregir lo que ya tenía en
la cabeza en vez de medir dónde estaba el defecto**. El detector de rayas existe
ahora precisamente para no volver a discutirlo a ojo.

---

## Ronda 10 — apago el fluido en producción

**No es un ajuste más. Es admitir dónde se estaba probando.**

Tres despliegues seguidos le llegaron rotos al founder: rayas, cortes duros,
vibración. Los tres los descubrió él, en su teléfono, con la app de verdad. Eso
no es un problema del solver: es que **producción se volvió el banco de
pruebas**, y él el instrumento de medición.

### Lo medido antes de decidir

La ronda 9 arregló el bandeado (rampa lineal en vez de `smoothstep` por tramo)
y bajó el titileo de 0,298 a 0,227 — pero los saltos duros EMPEORARON
(media 1,03 % → 1,29 %, máximo 1,80 % → 4,35 %).

Entonces medí **dónde** vibra, y ahí se cayó el instrumento:

| medida | valor | qué dice |
|---|---|---|
| titileo p95 / mediana | 1,8 | uniforme, no concentrado en frentes |
| estructura fina | 0,057 | espacialmente liso |
| **cambio por cuadro (mediana)** | **0,00075** | **un paso de 8 bits es 0,0039** |

El cambio por píxel entre cuadros es **cinco veces más chico que el escalón más
chico que la pantalla puede representar**. Mi métrica de titileo estaba midiendo
redondeo, no el defecto. Es decir: **ya no tengo instrumento para afinar esto**,
y afinar a ciegas es exactamente lo que costó los tres despliegues.

### La decisión

`ORB_FLUID_ENABLED = false`. Producción vuelve al estado que el founder
prefirió — el campo con su propia deformación, la rampa, el grano, la
saturación, todo lo que él ya dio por bueno («en textura ya estamos ahí»).

Lo que NO pasa:

- **el solver no se borra.** Queda entero, con sus pines y sus mutaciones.
- **se enciende cambiando una línea**, `ORB_FLUID_ENABLED = true`.
- **`/dev/vidrio` lo tiene encendido** (`forceFluid: true` en el specimen
  compartido), así el trabajo sigue sin que el teléfono del founder sea el
  ensayo.

### El pin

El gate exige que apagarlo sea una decisión DECLARADA y que la mesa de luz
pueda encenderla: la constante existe con valor booleano explícito, el guard
está en `createOrbFluid`, y el cable del shader pasa `options.forceFluid`. Sin
eso, «apagado» sería indistinguible de «roto».

### Método (la lección que queda)

**Una métrica que mide por debajo del cuanto de la señal no mide nada.** El
0,227 parecía un número que se podía perseguir; era ruido de cuantización. La
señal de que algo andaba mal estuvo ahí antes: mejoraba el titileo y empeoraban
los saltos, que es la firma de estar optimizando un artefacto.

Gate 891/891 · lint 0 errores.

### Incidente de método: dos auditorías a la vez dejaron un mutante VIVO

Corrí la auditoría de mutación dos veces en paralelo. Cada corrida muta un
archivo, mide y lo restaura — y las dos se pisaron: una restauró sobre lo que la
otra había mutado, y quedó **un mutante vivo en el árbol de trabajo**,
`wealthTargetFrom` devolviendo `100_000` donde debe devolver `null`. Es decir: el
orbe de Patrimonio habría mostrado un nivel INVENTADO para quien no declaró
techo — exactamente el defecto que ese pin existe para matar.

Lo agarró el gate al re-correrlo (890/891). Si hubiera commiteado confiando en
que «la auditoría pasó», eso se despachaba.

Dos reglas que quedan:

1. **La auditoría de mutación no es concurrente consigo misma.** Muta archivos
   reales del árbol; dos corridas comparten el mismo estado.
2. **Después de mutar, el gate se re-corre en limpio antes de commitear.** Una
   auditoría que restaura mal es indistinguible de una que restaura bien si sólo
   se lee su última línea.

Cierre de ronda: gate **891/891** · mutación **70 muertas, 0 fallas**,
restauración 891/891 · lint 0 errores · build verde.

---

## Ronda 11 — más grano

El founder, sobre la ronda 10: «ya no hay vibraciones ni titiliteo… tal vez le
pondría un poco más de grain».

Base del grano **0,030 → 0,055** (en tema claro 0,042 → 0,075, porque ahí el
orbe tapa la página y aguanta más).

### Medido, y casi mal medido otra vez

La primera medición dio +5 % y estuve a punto de creerle. Estaba reduciendo la
imagen de 372 a 220 px antes de medir — y el grano es de ~1 celda por píxel, así
que **el promedio del reescalado se lo comía**. Es exactamente el error de
escala de la ronda 10 (medir por debajo del tamaño de la señal), dos rondas
después y en otro disfraz.

A resolución NATIVA, energía de alto detalle en el centro del disco:

| probeta | antes | después | razón |
|---|---|---|---|
| 1 | 0,00495 | 0,00892 | 1,80× |
| 2 | 0,00492 | 0,00885 | 1,80× |
| 3 | 0,00466 | 0,00840 | 1,80× |
| 4 | 0,00322 | 0,00560 | 1,74× |
| 5 | 0,00386 | 0,00688 | 1,78× |
| 6 | 0,00502 | 0,00901 | 1,79× |

1,8× medido contra 1,83× de la constante: **el cambio aterriza en la pantalla**,
no sólo en el código.

### El pin, con los dos topes

Piso 0,040 (por debajo el material vuelve a leerse como degradado liso) y techo
0,090 (por encima deja de ser grano de película y es ruido sucio). Más: el
término de tema claro tiene que ser positivo y menor que la base. Un umbral con
un solo lado deja pasar el otro — la regla que costó un despliegue roto en la
ronda 8.

Gate **891/891** · mutación **71 muertas, 0 fallas** · lint 0 errores · build verde.

---

## Ronda 12 — el original del que salió el suyo, y el defecto por fin nombrado

El founder pidió dejar de adivinar: «alguna forma de descifrar su orbe exacto en
lugar de estar en prueba y error». Aprobó dos caminos: (1) reconstruir sobre lo
que se pueda leer de verdad, (3) medir su régimen al hablar.

### Lo que se probó y NO sirve

`@elevenlabs/convai-widget-embed@0.17.1` (MIT, © 2025 ElevenLabs) trae el orbe
de **óvalos polares** — `uOffsets`, `uTime`, `uColor` — el mismo `orb.tsx` que
porté en la ronda 1. `@elevenlabs/react` no trae shader. Instalar su agente en
nuestro sitio NO da acceso al orbe de fluido. Descartado por medición.

### El hallazgo

Los diez uniformes que capturé de su página VIVA —`uCurl`, `uPressure`,
`uDivergence`, `uVelocity`, `uSource`, `curl`, `vorticity`, `aspectRatio`,
`dissipation`, `texelSize`— están **todos** en
`PavelDoGreat/WebGL-Fluid-Simulation` (MIT, © 2017 Pavel Dobryakov). Hasta el
`min(max(velocity, -1000.0), 1000.0)` que descubrí a los golpes en la ronda 8 es
literal del original.

**Su orbe deriva del mismo original que el nuestro.** Lo que el filtro del
navegador no me dejó leer de ellos —los cuerpos de las fórmulas— está completo
en un repo público. La atribución MIT quedó en la cabecera de `orb-fluid.ts`.

Comparado el original contra nuestro solver: **el algoritmo ya era fiel** —
mismos shaders, mismo orden, mismo `1 + dissipation*dt`, mismo `clear` a 0,8.

### El defecto, medido por fin

Con el instrumento nuevo (`window.__kipuOrbRepaint`, que llama al `draw` real
sin depender de `requestAnimationFrame`, suspendido en este entorno) medí la
**decorrelación**: cuánto se aleja la imagen de sí misma al pasar el tiempo.

| retardo | nuestro ANTES | de ellos |
|---|---|---|
| 0,25 s | 0,0196 | 0,030 |
| 1 s | 0,0251 | 0,075 |
| 2 s | **0,0157** | — |

El de ellos crece. **El nuestro era PLANO y a los 2 s bajaba** — la firma de un
patrón que vuelve sobre sus pasos. Eso es exactamente «los colores se mueven en
el mismo lugar», y son once rondas de queja convertidas en un número.

La causa era estructural, no de parámetros: el fluido entregaba un **rastro
acotado** (±0,3 por construcción), y un empujón acotado sólo puede SACUDIR un
dibujo anclado. Nunca lo puede llevar.

### El cambio

La textura del fluido deja de guardar un rastro y pasa a guardar **coordenadas
materiales**: cada punto guarda de dónde vino. El orbe lee esa coordenada y le
resta la suya, y esa diferencia **crece**. Se relaja lento hacia la identidad
(`ORB_FLUID_MAP_RELAX = 0,20`) para que no se deshilache en filamentos.

Medido después:

| retardo | 0,25 s | 0,5 s | 1 s | 2 s |
|---|---|---|---|---|
| antes | 0,0196 | — | 0,0251 | 0,0157 |
| **ahora** | 0,0049 | 0,0078 | **0,0142** | **0,0246** |

**La curva pasó a crecer, monótona.** Misma forma que la de ellos. El defecto
estructural está muerto.

### Lo que NO se logró, dicho sin adornos

La amplitud sigue ~5× por debajo (1 s: 0,0142 contra 0,075). Probé tres knobs y
**los tres empeoraron o no movieron nada**:

| knob | probado | resultado a 1 s |
|---|---|---|
| freno del mapa 0,20 → 0,07 | más deriva | 0,0142 → 0,0125 |
| ganancia 26 → 7 | zona lineal | 0,0159 → 0,0142 |
| fuerza 190 → 620 | fluido más rápido | 0,0142 → 0,0099 |

Tres knobs que empujan en la misma dirección y los tres empeoran significa que
el cuello de botella está en otra parte — la sospecha es la geometría de los
agitadores, que están contra-rotados para cancelar el arrastre y quizá se
cancelan a sí mismos. **Paré de tocar ahí**, que es justo lo que prometí no
volver a hacer a ciegas.

### Producción intacta

`ORB_FLUID_ENABLED` sigue en `false`. **Nada de esta ronda llega al teléfono del
founder.** El trabajo vive en `/dev/vidrio`, que es donde él lo va a mirar antes
de que se despliegue nada.

Gate **891/891** · mutación **74 muertas, 0 fallas** · lint 0 errores · build verde.

---

## Ronda 13 — «solo veo fotos»

El founder abrió la mesa de luz para juzgar el movimiento de la r12 y vio
exactamente eso: fotos. Y tenía razón — **las probetas pintan un solo cuadro a
propósito**, porque es lo que las vuelve medibles y comparables entre rondas.

Ahí hay una lección de método, no un olvido: **un instrumento riguroso que no
muestra lo que se le pide juzgar no es riguroso, es inútil.** Toda la etapa se
midió con probetas quietas y la queja del founder siempre fue sobre movimiento.

`/dev/vidrio?hoja=movimiento`: los mismos cinco orbes, el mismo `paint`, el
mismo renderer — avanzando con el reloj de cuadros.

Un detalle que sí importa: el reloj **no pasa por el estado de React**. Cinco
orbes re-renderizando el árbol sesenta veces por segundo se ve a tirones, y un
instrumento que agrega su propio tirón al movimiento que hay que juzgar miente
sobre lo que muestra. El lazo llama a `paint` directo.

Pinchado: el modo animado avanza el reloj (una mutación que lo congela mata un
test nombrado), se cancela al desmontar, y no reaparece el reloj por estado.

Gate **891/891** · mutación **75 muertas, 0 fallas** · lint 0 errores · build verde.
Producción sigue intacta: `ORB_FLUID_ENABLED = false`.

---

## Ronda 14 — las olas duras: el hardware, y una rama del original que no porté

El founder, sobre la r13: «ya fluye mucho mejor, pero de la nada hay olas
bruscas o cortes que se ven super rígidos… después desaparecen y de la nada hay
otra». Con dos capturas donde se ve una **línea curva y limpia** cruzando el
disco.

### Cuatro hipótesis, tres muertas por medición

| hipótesis | prueba | resultado |
|---|---|---|
| quiebre de pendiente de la rampa | rampa lineal → Hermite C¹ | 33,7 → 35,6 · **no era** |
| el mapa material se pliega | relax 0,20 → 3,0 (deriva casi nula) | 6,5 → 7,9 · **no era** |
| vorticidad (normaliza un vector casi nulo) | CURL 30 → 0 | pico 23,3 → 24 · **no era** |
| **el fluido, en general** | `forceFluid: false` | **5,2 PLANO, sin un solo pico** |

La cuarta partió el problema al medio: los cortes existen **sólo con el fluido
encendido**, y no eran ni el mapa ni la vorticidad.

### Dos veces medí el instrumento en vez del defecto

Vale anotarlo porque es la tercera repetición de la misma clase:

1. La primera ventana de medición **incluía el borde del orbe** contra el negro
   — un salto enorme que no es un defecto. De ahí salía el 33,7.
2. Corregida la ventana, el pico (`max` 0,217) resultó ser **≈ 4 × la amplitud
   del grano**: estaba midiendo el grano, que es de un píxel y por diseño duro.
   Hubo que suavizar la imagen ANTES de buscar la línea.

Sólo con la tercera versión del instrumento apareció la firma real: una base de
~5,5 con **picos intermitentes** (5,5 · 5,5 · 10,6 · 6 · … · 23,3), que es
exactamente «de la nada hay una y después desaparece».

### La causa

`OES_texture_half_float_linear` **no existe en todo el hardware** — medido
`false` en este mismo navegador. Sin esa extensión, muestrear una textura de
media precisión es **NEAREST**: la advección lee el mapa a saltos y el orbe
recibe un desplazamiento cuantizado. Un escalón que se mueve **es** una línea
dura barriendo el disco.

**El original MIT ya trae esta rama** (`#ifdef MANUAL_FILTERING`, con su
`bilerp`) exactamente por esto. Yo había portado sólo la otra. Es el segundo
regalo del hallazgo de la r12: el arreglo ya estaba escrito, en el archivo que
ahora sí puedo leer entero.

Va **siempre**, no según la extensión: un defecto que aparece según la GPU es un
defecto que no se puede medir, y el founder tiene otro teléfono.

| | pico de cortes | base |
|---|---|---|
| antes | 23,3 | 5,5 |
| **con bilerp** | **11,3** | **6,0** |
| sin fluido (el suelo) | — | 5,2 |

La base ya toca el suelo del orbe sin fluido. Quedan picos residuales de hasta
11,3 contra 5,2: **no está cerrado**.

### Una corrección incómoda

El flujo medido BAJÓ: 1 s pasó de 0,0142 a **0,0055**. No es que el arreglo haya
frenado el orbe — **parte de lo que yo estaba midiendo como «flujo» era el
escalonado**. El número honesto es 0,0055, y contra los 0,075 de ellos eso es
13× por debajo, no 5×. La r12 se reportó con un número inflado por el defecto.

### Sobre la rampa Hermite

Se midió que NO era la causa y se conservó igual: pasar de tramos rectos a C¹
elimina los quiebres de pendiente, que son una clase de artefacto real. Pero no
se le atribuye ninguna mejora observada.

Gate **891/891** · mutación **77 muertas, 0 fallas** · lint 0 errores · build verde.
`ORB_FLUID_ENABLED = false`: producción intacta.

---

## Ronda 15 — las olas duras, hasta el suelo

El founder, tras la r14: «siguen apareciendo, un 90 % del tiempo… no es la misma
sino que aparecen de varios lados». Siete capturas, y en ellas lo que faltaba:
los bordes son **escalonados** — una recta vertical con escalones rectangulares
en la ámbar, otra en la turquesa.

### La prueba que había que hacer desde el principio

Pinté el **desplazamiento crudo** en el orbe, sin campo ni grano. Razones de
línea de **33 a 256**, contra un suelo de 5,2. Las líneas estaban dentro del
fluido, no las creaba el campo. Cinco rondas mirando el efecto en vez de la
causa.

### Dos defectos, y el segundo era el grande

**1 · La precisión (real, medida).** El mapa guardaba la COORDENADA absoluta en
una textura de media precisión: escalón 4,9e-4 contra una señal de 7,9e-4 — **el
62 %**. Y el orbe hacía `mapa − suPropiaCoordenada`, que es restar dos números
casi iguales y quedarse con todo el error. Ahora guarda el **desplazamiento**,
que vive cerca de cero, donde la media precisión da resolución relativa (~0,1 %):
`D_nuevo(x) = D_viejo(x − v·dt) − v·dt`.

**2 · El mapa resolvía más fino que su propia física.** La velocidad se advecta
a sí misma y forma **choques** — eso es física, no un error. En el original no
se ven porque lo que se mira es el tinte, que se disipa y se difunde. Nuestro
mapa no se disipa (una coordenada no puede), así que copiaba cada choque con
filo perfecto. Y estaba a **640 contra una velocidad de 128**: cinco veces más
detalle del que la física resuelve, o sea puro artefacto numérico.

| mapa | base | pico | flujo 1 s |
|---|---|---|---|
| 640 | 6,1 | 15,3 | 0,0127 |
| 160 | 5,4 | 9,1 | 0,0128 |
| **128** (= la velocidad) | **5,2** | **7,4** | 0,0126 |
| suelo (sin fluido) | 5,2 | — | — |

**La base tocó el suelo del orbe sin fluido.** Y el flujo NO se movió: los 5× de
resolución no compraban nada de movimiento, sólo artefacto.

Más un poco de viscosidad en el mapa (0,35), que se ganó su costo por medición:
pico 8,7 → 7,4.

### Cuatro hipótesis muertas antes de llegar

Vale dejarlas escritas, porque cada una parecía la buena:

| hipótesis | prueba | resultado |
|---|---|---|
| el borde de la textura (CLAMP_TO_EDGE) | ventana 0,40 → 0,22 | pico 15,8 · no era |
| pliegue por pasos grandes | fuerza 190 → 45 | **peor**: 24,5 |
| la dirección normalizada salta | cálculo del giro por cuadro | 1 cuadro en 300 · no era |
| la viscosidad sola | 0 → 0,35 con mapa 640 | 15,8 → 15,3 · insuficiente |

El dato que ignoré tres veces fue **«peor con menos fuerza»**, que es
físicamente imposible si el artefacto fuera de amplitud — y era la firma de que
mi métrica de flujo estaba midiendo el propio artefacto.

### Efectos colaterales

- `ORB_FLUID_DYE_DISSIPATION` quedó MUERTA (el mapa no se disipa) y se borró.
- La ventana de muestreo quedó en 0,22: duplicó el flujo medido (0,0066 →
  0,0127) sin costo en artefacto.
- Flujo hoy: 0,0126 a 1 s contra **0,075** de ellos. Sigue 6× abajo.

Gate **891/891** · mutación **80 muertas, 0 fallas** · lint 0 errores · build verde.
`ORB_FLUID_ENABLED = false`: producción intacta.

---

## Ronda 16 — el founder abrió su Chrome, y ahí aparecieron

«Disminuyó la frecuencia, pero no desaparecieron.» Compartió la pantalla para
que las midiera yo mismo, con cuadros de verdad. Fue la ronda que más enseñó.

### Por qué él las veía y yo no

Midiendo CADA cuadro en su Chrome: los eventos duran **32–67 ms**, o sea **uno o
dos cuadros**, y ocurren cada ~10 s. **Mi instrumento muestreaba cada 200 ms** y
se saltaba cinco de cada seis cuadros. Un destello de un cuadro simplemente no
existía para mí — y «no existe en mi medición» se había vuelto «no existe».

### Dos defectos que sólo se ven con cuadros reales

**1 · Cinco pasos de fluido por cuadro.** Las cinco probetas comparten un
renderer y **cada una avanzaba la simulación**. Medido: 5 pasos por cuadro con
los cinco empujones repetidos casi en el mismo instante y sitio. El founder
miraba una simulación **cinco veces más violenta** que la que yo medía. El
comentario del código decía «un paso de fluido por cuadro» desde la r6:
**una invariante escrita en un comentario y no aplicada por el código es una
intención, no una invariante.**

**2 · La física dependía del ritmo de cuadros.** Su Chrome corría a 30 fps; mi
instrumento headless llamaba siempre con 1/60 exacto. A la mitad de cuadros el
salto de advección es **el doble**, y ahí el mapa se pliega. **Un defecto que
depende del ritmo de cuadros no se reproduce con un reloj fijo.** El paso ahora
se parte en tramos de a lo sumo 1/60 (con la fuerza repartida, o se inyectaría
`tramos` veces): el fluido se comporta igual a 30, 60 o 120.

Resultado: de **20 % de las muestras con ola** a 7 eventos en 70 s.

### Tres experimentos más, y el que sirvió

| cambio | eventos / 70 s |
|---|---|
| recorte de velocidad del original (±1000) | 7 |
| **sin tope** (1e5) | **19** — el tope hacía falta |
| acotar el salto a un téxel (`if` por píxel) | **15** — el umbral dibuja su propio contorno |
| **tope SUAVE** (`inversesqrt`) | **3** |
| + vorticidad segura cerca de cero | 4 a 120 fps (equivalente) |

Un recorte duro **aplana** lo que lo supera y le pone un borde; esa frontera es
una línea que dura lo que dure el pico — 1–2 cuadros, exactamente lo medido. Y
el intento de acotar por píxel repitió el pecado de la rampa: **un `if` por
píxel crea una línea en su propio umbral.**

La vorticidad segura (`force *= mag / (mag² + 0,02)` en vez de dividir por
`mag + 0,0001`) se conserva porque dividir por una magnitud casi nula es un
peligro numérico real, pero **no se le atribuye la mejora**: 4 contra 3 está
dentro del ruido.

### Estado

De «90 % del tiempo con olas» a **3–4 destellos de 1–2 cuadros en 70 segundos**.
No es cero y no se reporta como cero.

Gate **891/891** · mutación **85 muertas, 0 fallas** · lint 0 errores · build verde.
`ORB_FLUID_ENABLED = false`: producción intacta.

---

## Ronda 17 — las olas no estaban en el fluido

El founder se fue por unas horas dejando su Chrome abierto, con una instrucción
sin ambigüedad: **no parar hasta no ver ni una sola ola.** Y con el dato que
resultó ser la llave: «las sigo viendo prácticamente igual de frecuentes que
antes de esta sesión». O sea que todo lo medido como mejora en las rondas 14–16
no había tocado lo que él veía.

### Lo primero que hice fue lo que no había hecho en dieciséis rondas: MIRAR

Una captura de pantalla, y dos defectos enormes a la vista:

1. **Los cinco orbes eran idénticos.** La rotación por capa colgaba de `uMat`, y
   el experimento de campo lleno fuerza CRISTAL en las cinco: `uMat` valía 6 en
   todas. Los cinco dibujaban el mismo campo con el mismo pliegue en el mismo
   sitio. Ninguna métrica podía delatarlo: todas miraban un orbe a la vez.
2. **La «ola» estaba SIEMPRE**, no cada diez segundos. Por eso mi métrica era
   ciega: normalizaba contra la mediana, y una estructura permanente sube la
   mediana también.

### El instrumento que faltaba

Un **mapa de crestas acumulado**: para cada píxel, el máximo del laplaciano
suavizado a lo largo de una ventana larga, pintado en pantalla. Con él la
respuesta apareció en una comparación:

| | mapa de crestas |
|---|---|
| con fluido | **filamentos alargados** cruzando el disco |
| sin fluido | moteado uniforme, ni una veta |

### Diez cosas que probé dentro del solver, y ninguna lo tocó

Agitadores en órbita · relevo de dos fases · ciclo corto · ciclo largo ·
vorticidad · tope de velocidad suave · resolución del mapa · viscosidad ·
precisión · filtrado a mano. Todas medidas, ninguna mató el filamento.

**Porque el defecto no estaba en el fluido.**

### La causa, con su matemática

Deformar el dominio significa evaluar el ruido en `p + a·(q − 0,5)`. La
jacobiana de eso es `I + a·∇q`, y **cuando `a·|∇q|` alcanza 1 el mapa se
pliega**: dos puntos vecinos caen en el mismo sitio, la textura se comprime
contra una línea y aparece una **cáustica** — un filamento brillante de borde
filoso. Eso es la ola.

Con `|∇q| ≈ 5`, el umbral está en `a ≈ 0,20`. Y en el código había:

```
float amount = mix(0.17, 0.40, drive) * (uHasFluid > 0.5 ? 1.55 : 1.0);
```

- sin fluido: 0,17 × 5 = **0,85** → no pliega
- con fluido: 0,264 × 5 = **1,32** → **pliega**
- hablando: 0,62 × 5 = **3,10** → pliega mucho

**El `× 1.55` que yo mismo había agregado en una ronda vieja sólo se aplicaba
con el fluido encendido.** Ésa es la razón exacta de que el defecto apareciera
sólo con fluido y de que ninguna palanca del solver lo tocara.

### El arreglo, y por qué es un tope y no una calibración

1. **La deformación vive por debajo del umbral**: `mix(0.12, 0.22, drive)`.
2. **El fluido deja de tocar el warp** en los dos campos (brillo y color):
   sumar al argumento del ruido multiplica su gradiente.
3. **El fluido entra moviendo el punto de muestreo** (`fp += gFlow * 0.115`),
   donde el gradiente es el del propio fluido, suave y acotado.
4. **El mapa es GRUESO** (24 contra 128 de velocidad): un mapa fino tiene
   gradiente fino, y el gradiente es lo que pliega.
5. **La lectura es filtrada** (cuatro tomas promediadas): baja el gradiente por
   construcción, no por calibración.
6. Los agitadores **orbitan** en vez de barrer: dos de los cinco tenían
   trayectorias degeneradas (razones 2,61 y 3,89, casi segmentos) y un agitador
   que viaja en línea recta carva una capa de cizalla con borde recto — la otra
   mitad de «pasan como capas».
7. Cada capa tiene **identidad propia** (`uSeed`) y mira otra parte del fluido.

### Medido, contra el suelo del propio orbe

El suelo es el mismo orbe **sin fluido** — y es distinto por color, cosa que
casi me hace sacar una conclusión falsa en deuda (ámbar contrasta más).

| orbe | crestas con fluido | su suelo | filamentos |
|---|---|---|---|
| saldo, 40 s | mediana 0,0663 · máx 0,0897 | 0,0654 / 0,0766 | ninguno |
| deuda, 35 s | mediana 0,0728 · máx 0,1139 | 0,0794 / 0,0962 | ninguno |

En los dos, el mapa de crestas es **moteado uniforme**. El exceso del máximo no
es pliegue: un campo en movimiento recorre más configuraciones que uno quieto.

**Y la prueba que el founder pidió con esas palabras:** el **peor cuadro de
sesenta segundos en el peor orbe**, capturado y ampliado. Es una nube ámbar
suave. Ni una línea.

### Y el movimiento subió

| | flujo a 1 s |
|---|---|
| al empezar la sesión | 0,0126 |
| **ahora** | **0,0264** |
| de ellos | 0,075 |

**El doble de movimiento y cero olas** — no era un intercambio: un dominio
plegado *destruye* el movimiento coherente, así que arreglar el pliegue dio las
dos cosas.

### El método, que es lo que más costó

- **Mirar la pantalla es una medición.** Dieciséis rondas de métricas escalares
  no vieron dos defectos que una captura mostró en cinco segundos.
- **Una métrica normalizada contra su propia mediana es ciega a lo permanente.**
- **El instrumento puede fabricar el defecto**: los «listones» de una pasada
  intermedia eran mi visualización saturando, no el campo.
- **El suelo se mide POR ORBE**: los colores no contrastan igual.
- **Calibrar no es garantizar.** Lo que cerró esto fue bajar el gradiente por
  construcción (mapa grueso + lectura filtrada + warp bajo el umbral), no
  encontrar el número justo.

Gate **891/891** · lint 0 errores · build verde.
`ORB_FLUID_ENABLED = false`: producción sigue intacta, a una línea de encenderse.

---

## Ronda 18 — el golpe cada 2,4 s era mi propio relevo

El founder confirmó lo que importaba: **«las olas se fueron definitivamente».**
Y reportó otra cosa: «cada 3 segundos hay como una contracción de todo el orbe o
un golpe», constante y exacto.

**Un período fijo es un reloj, y el único reloj nuevo era mío.**

### Medido por autocorrelación, no estimado

| | pico | armónico |
|---|---|---|
| antes | **2,40 s** (0,73) | **4,80 s** (0,64) |
| después | ninguno | — |

**2,40 s clavados** = `ORB_FLUID_CYCLE_SECONDS`, el relevo de dos fases que yo
mismo había agregado esa misma jornada. El founder lo estimó en 3 s; el reloj
dijo 2,4.

### Por qué latía si cada reinicio era invisible

El diseño era correcto en su propia lógica: dos mapas desfasados medio ciclo,
cada uno volviendo a cero **cuando su peso vale cero**, así que ningún reinicio
se ve. Lo que no vi es que **dos campos independientes pesados al 50 % se
cancelan parcialmente entre sí**: en el cruce la amplitud efectiva cae a ~0,71
de la de un campo solo, y en el reinicio vuelve a 1,0. La amplitud late con el
ciclo aunque cada reinicio sea invisible. Un artefacto de la interpolación, no
de los reinicios.

### La decisión

**Se quitó entero.** No es que se apagara: se borró el mecanismo — la constante,
el reloj, los reinicios, el par de canales, los pesos del shader.

Dos razones, y la primera es la que importa:

1. **No arreglaba lo que decía arreglar.** Lo puse para que el mapa no
   envejeciera hasta plegarse; el pliegue resultó venir de la deformación del
   dominio, no de la edad del mapa. Cuando la r17 encontró la causa real, el
   relevo quedó sin trabajo.
2. **Traía su propio defecto** medible y visible.

El mapa vuelve a una sola fase, acotada por su relajación (`MAP_RELAX` 0,081 →
**0,55**, que es el bound que el relevo estaba haciendo por otra vía).

### Verificado

| | crestas (mediana / p999 / máx) | su suelo (p999 / máx) |
|---|---|---|
| saldo, 25 s | 0,0657 / 0,0768 / 0,0786 | 0,0887 / 0,0766 |
| deuda, 30 s | 0,0741 / 0,1096 / 0,1118 | 0,0950 / 0,0962 |

Saldo queda **por debajo** de su propio suelo. Los dos mapas de crestas son
moteado uniforme, sin filamentos: **las olas siguen muertas.**

Y sin picos periódicos: lo que queda en la autocorrelación (0,63–0,87 s,
decayendo, sin armónicos) es la correlación natural de una señal suave.

### El costo, dicho sin adornos

El flujo bajó de 0,0264 a **0,0184** a un segundo. Y hay que decir de dónde
venía la diferencia: **parte de aquel 0,0264 ERA el latido**. El número honesto
sin golpe es 0,0184, y contra los 0,075 de ellos seguimos **4× abajo**.

### Método

- **Un período fijo es un reloj.** Cuando un defecto se repite con período
  exacto, no se busca en la física: se busca en las constantes de tiempo del
  código. La autocorrelación lo dio en una medición.
- **Un mecanismo correcto puede ser un mecanismo inútil.** El relevo estaba bien
  implementado y bien razonado; su premisa era falsa. Cuando la causa real
  aparece, lo que se puso "por si acaso" se saca — sobre todo si tiene efectos
  propios.

Gate **891/891** · mutación **90 muertas, 0 fallas** · lint 0 errores · build verde.
`ORB_FLUID_ENABLED = false`: producción intacta.

---

## Ronda 19 — los colores, medidos contra los suyos

El founder aprobó el movimiento («ya se parece mucho al de ElevenLabs») y pidió
lo último de esta fase: **los colores**, con el verde de saldo señalado — «los
colores se parecen demasiado, entonces no se ve mucho cómo fluyen».

### Los suyos, con la misma vara

Recorrí su carrusel con las flechas y muestreé los seis orbes en HSL:

| orbe | tono | ancho de tono | sat | luz | **recorrido de luz** |
|---|---|---|---|---|---|
| amarillo | 52 | 118° | 0,50 | 0,52 | 0,53 |
| menta | 157 | 21° | 0,24 | 0,39 | 0,36 |
| violeta (Characters) | 280 | 131° | 0,81 | 0,79 | 0,26 |
| naranja (Narration) | 20 | 22° | 0,94 | 0,64 | 0,39 |
| rojo (Conversational) | 5 | 15° | 0,47 | 0,27 | 0,56 |
| verde (Social Media) | 111 | 158° | 0,45 | 0,68 | 0,32 |

Dos estrategias conviven: **monocromo con mucho recorrido de luz** (15–22° de
tono, 0,36–0,56 de luz) y **policromo** (118–158°). Ninguno hace las dos cosas
poco.

### Los nuestros

| capa | tono | **ancho de tono** | **recorrido de luz** |
|---|---|---|---|
| saldo | 177 | **1°** | 0,13 |
| reserva | 212 | 6° | 0,18 |
| metas | 269 | 4° | 0,17 |
| patrimonio | 195 | 4° | 0,23 |
| deuda | 35 | 3° | 0,17 |

**Ancho de tono medio: 3,6° contra 77,5° de ellos. Recorrido de luz: 0,18
contra 0,40.** El ojo del founder tenía razón en las dos dimensiones, y señaló
justo el peor orbe en ambas.

### La causa, que es un poco vergonzosa

Los tres colores de cada capa —líquido, acento y profundo— son **el mismo
tono**: saldo 170/171/175, reserva 222/222/228, metas 261/259/258.

El shader tiene un **segundo campo de color** (`fieldHue`) construido en la r3
justamente para que «los orbes fundan varios colores», con su pin y su mutación.
**Nunca hizo nada**: mezcla `uLiq` con `uAcc`, y los dos son el mismo tono. Una
función viva, cableada y pinchada, **sin material con qué trabajar**.

Y un problema de conjunto: **saldo (170°), patrimonio (199°) y reserva (222°)
viven todas en la familia azul-turquesa** — tres de cinco capas en 52°.

### La propuesta, derivada del SIGNIFICADO de cada capa

| capa | qué es para el usuario | viaje de color |
|---|---|---|
| **Saldo** | permiso para disfrutar, HOY | turquesa → verde · el más vivo |
| **Reserva** | lo que te protege | azul → índigo · la bóveda, el más profundo |
| **Metas** | hacia dónde vas | violeta → magenta · luminoso |
| **Patrimonio** | lo que construiste | bronce → arena · mineral, callado, poco saturado |
| **Deuda** | lo que tira de vos | terracota → ciruela · cálido y grave, **sin alarma roja** |

Las cinco se reparten la rueda (170 · 235 · 297 · 41 · 13) en vez de amontonarse
en el azul, y cada una tiene 35–55° de separación real entre líquido y acento —
recién ahí `fieldHue` tiene algo que mezclar.

### Medido

| | ancho de tono | recorrido de luz |
|---|---|---|
| hoy | 3,6° | 0,18 |
| **propuesta (sólo colores)** | **31°** | 0,21 |
| propuesta + rampa ensanchada | 31,8° | **0,27** |
| ellos | 77,5° | 0,40 |

Los colores solos multiplican el tono por nueve. El recorrido de luz **no se
arregla con colores**: lo comprime la rampa (`c0 = mix(uDeep, mid, 0.30)`).
Probado con `0.10` / `0.18`: 0,21 → **0,27**. Ese cambio se **revirtió** — es
parte de la propuesta, no un cambio aprobado, y la rampa sí afecta producción.

### Qué se commitea y qué no

Se commitea sólo el **instrumento para decidir**: la probeta acepta una paleta a
la fuerza y `/dev/vidrio?hoja=colores` muestra hoy contra propuesta, animadas,
lado a lado. **Los tokens de producción no se tocaron.**

Y se pincha que la comparación no pueda mentir: si la paleta forzada no llegara
al orbe, las dos filas serían la misma mostrada como distinta — el peor tipo de
instrumento.

Gate **891/891** · mutación **91 muertas, 0 fallas** · lint 0 errores · build verde.

---

## Ronda 20 — el escorzo de la esfera, y un defecto que el founder vio antes que yo

Tres cosas del founder, y las tres resultaron correctas.

### 1 · «El movimiento de la propuesta es un poco más rápido y brusco»

No era impresión: **era un defecto mío**. La r16 decidía «esto es un cuadro
nuevo» por separación temporal —más de 4 ms desde el último paso—. Con cinco
probetas funcionaba; la hoja de colores tiene **diez**, sus dibujos se estiran
más allá de esos 4 ms y se colaban pasos de más.

Medido con la MISMA paleta: **0,0204 en la hoja de diez contra 0,0184 en la de
cinco — 11 % más rápido.** Corregido contando el NÚMERO de cuadro con su propio
`requestAnimationFrame`: 0,0178, otra vez igual que lo aprobado.

**Un cuadro no es un intervalo de tiempo: es un cuadro.** La heurística
funcionaba con la cantidad de probetas con la que la escribí.

### 2 · «Las fluctuaciones nacen desde los bordes y eso da el efecto 3D»

Tiene razón, y tiene nombre: **escorzo**. En una esfera, un paso igual de
superficie ocupa cada vez menos pantalla cerca del contorno — los continentes se
aplastan en el borde de un globo terráqueo. Nuestro campo se muestreaba en
coordenadas **planas**, así que las manchas medían lo mismo en el centro y en el
borde: una calcomanía sobre un círculo.

Y explica exactamente lo que él describe: si el campo se comprime hacia afuera,
las manchas **parecen nacer en el borde** y agrandarse al venir al centro.

La proyección exacta es `r' = asin(r)`, cuya derivada se va al infinito en el
contorno — eso plegaría el dominio justo donde acabábamos de arreglarlo. Va
acotada con `ORB_SPHERE_K = 0,90`: ~2× de compresión en el borde.

**Y mejoró las crestas** en vez de empeorarlas:

| | p999 | su suelo |
|---|---|---|
| deuda, sin escorzo | 0,1096 | 0,0950 |
| **deuda, con escorzo** | **0,0919** | 0,0950 |
| saldo, con escorzo | 0,0799 | 0,0887 |

Los dos quedan **por debajo de su propio suelo**.

### 3 · Los colores, v2

Su realimentación, capa por capa: saldo demasiado chillón (falta blanco
verdoso); reserva le gustaba **lo puro del azul** del original, con más
contraste de blancos; metas menos lila y más morado-azulado con un toque de
amarillo; patrimonio **no le gustó** («el amarillo pálido se ve sucio»); deuda
acertada pero menos intensa.

Y la dirección de conjunto, que es la que manda: *«está bien que nuestros
colores no sean tan saturados ni variados como los de ellos, porque nosotros
queremos transmitir calma, wellness, control, satisfacción, modernidad»*.

| | ancho de tono | recorrido de luz | saturación |
|---|---|---|---|
| hoy | 3,6° | 0,18 | 0,50 |
| propuesta v1 | 31° | 0,21 | 0,44 |
| **propuesta v2** | 10,4° | **0,26** | **0,33** |
| ellos | 77,5° | 0,40 | 0,57 |

La v2 baja el tono y la saturación **a propósito** y sube el recorrido de luz:
es la estrategia MONOCROMA de ellos (su menta: 21° de tono con 0,36 de luz; su
rojo: 15° con 0,56), que es justo el registro sobrio que él pidió.

**Hallazgo que ahorra un cambio:** los acentos casi blancos suben el recorrido
de luz de 0,18 a 0,26 **por sí solos**. La rampa ensanchada que había propuesto
en la r19 ya no hace falta.

Patrimonio sale del amarillo pálido y pasa a **verde profundo con plata** — lo
construido es sólido y callado, y es el registro de su orbe verde oscuro, que es
el más sobrio de los suyos.

### Qué queda en producción y qué no

- **En producción**: el contador de cuadros (corrige un defecto) y el escorzo
  esférico (él lo pidió y está verificado que no daña nada).
- **Sólo en la mesa de luz**: las paletas. Los tokens no se tocaron.

Gate **891/891** · mutación **94 muertas, 0 fallas** · lint 0 errores · build verde.

---

## Ronda 21 — el movimiento nace contra la pared

El founder, tras ver la r20: *«son como ondas super sutiles que vienen desde
afuera hacia adentro. Como cuando el mar choca con los riscos y se regresa»*. Y
me dejó solo con la instrucción de no parar hasta replicarlo.

### Primero observar el suyo, como pidió

Su lienzo WebGL sólo dibuja mientras suena el audio, y copiarlo desde fuera del
cuadro devuelve vacío — así que la captura se montó DENTRO del ciclo de cuadros
y se le dio play. Con 1076 cuadros medidos, el **cambio por anillo del centro al
borde**:

```
0,0012 · 0,0013 · 0,0016 · 0,0017 · 0,0021 · 0,0024 · 0,0026 · 0,0025
```

**Crece 2,2× hacia afuera.** Su intuición era una medida.

### El nuestro daba PLANO

`0,0004` en los ocho anillos. Razón borde/centro: **1,0**.

Y la causa no era el fluido: **nuestro movimiento lo hacía la animación del
campo**, que es espacialmente uniforme por construcción. Pesar el fluido hacia
el borde no alcanzó (la razón siguió en 1,0) porque el fluido no era quien
mandaba en el cambio.

### Lo que sí lo arregló: cambiar quién manda

Dos cosas, y hay que sostener las dos:

1. **El fluido pesa hacia la pared** — `ORB_RIM_CALM = 0,30`: en el centro llega
   el 30 % del desplazamiento, contra la pared el 100 %.
2. **El campo pasó a ser un sustrato lento** — su velocidad en reposo bajó de
   1,78 a 0,65, para que mande el fluido.

Medido: con el campo a 0,85 la razón cae a **1,0**; con 0,42, sube a **2,0**.
Contra el 2,17 de ellos.

Y el efecto secundario es justo lo que él pidió por otro lado: *«se ven un poco
rápidos y bruscos… necesitamos el mismo flujo de tranquilidad, con tiempo»*. El
flujo a 1 s bajó de 0,0184 a **0,0110**, con la curva creciendo parejo
(0,0062 · 0,0110 · 0,0178 · 0,0240 a 0,5/1/2/4 s).

### Un pin que hubo que RE-ANCLAR, con su razón escrita

`n3cCruce(0) < 6` exigía que una mancha del campo cruzara en menos de 6 s. Ese
tope nació cuando **el campo ERA el movimiento**. Con la arquitectura nueva el
campo es sustrato y el tope lo bloqueaba.

No se aflojó: **se movió a donde vive ahora la invariante.** Que el orbe se mueva
en reposo es cosa del empuje ambiente del fluido, y eso lo pincha N3C-8 con sus
dos topes. Del campo queda exigido lo que sigue siendo suyo: que su reloj avance
siempre, que avance más con voz, y que no se congele (`< 14 s`, `speed > 0,2`).

### Una ola explícita que se probó y se borró

Puse un desplazamiento radial cuya fase viajaba hacia adentro — la lectura
literal de «ondas que vienen del borde». **Era peor que nada:** la razón
borde/centro caía de 2,0 a **1,5** (la ola agrega cambio en todo el disco y
diluye justo lo que se busca) y el viaje hacia el centro quedaba idéntico (−1
con y sin ella).

Se borró entera, no apagada. La sensación de «viene de afuera» sale **sola**
cuando el movimiento nace en el borde; dibujarla encima la empeora.

### Verificado

| | valor | referencia |
|---|---|---|
| razón borde/centro | **2,0** | ellos 2,17 |
| viaje radial | **hacia el centro** | — |
| crestas saldo (p999) | 0,0756 | su suelo 0,0887 |
| crestas deuda (p999) | 0,1054 | su suelo 0,0950 |
| latido periódico | **ninguno** | — |

Las olas duras siguen muertas y no apareció ningún golpe.

### Colores v3

Su realimentación: saldo con más tipos de verde (pino) manteniendo el agua;
reserva «casi perfecto», se conserva; metas con azules, amarillos y rosados;
**patrimonio demasiado parecido a saldo** → sale del verde y pasa a **piedra
azul con veta cálida**; deuda con más rojos y rosados, «menos desértico, más
místico».

Gate **891/891** · mutación **96 muertas, 0 fallas** · lint 0 errores · build verde.
