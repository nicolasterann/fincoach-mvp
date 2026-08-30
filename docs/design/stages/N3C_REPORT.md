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
