# N3B_REPORT — El vidrio y el agua

> Append-only por rondas. Contrato: `stages/N3B_SPEC.md`.
> Rama `stage-n-acabado`, a la altura de `main` (`43c4787`). **Sin commitear.**

---

## Ronda 1

### Resumen en una línea

El agua pasó de ser un dibujo a ser una **simulación con masa**, el vidrio pasó de
reflejar un degradado a reflejar **un cuarto**, y los tres defectos concretos que
el founder señaló están medidos y cerrados. **No instalé `three`** — decisión
razonada, coste 0 KB de dependencia, y la opción B sigue abierta.

### La decisión de técnica, que se aparta de la letra del §3

El §3 **autorizaba** una librería 3D con material de transmisión física. No la
usé, y lo digo primero porque es la desviación más grande del reporte.

El razonamiento: lo que hace que las gemas de OPAL se lean como vidrio no es el
material, es que **reflejan un cuarto**. `MeshPhysicalMaterial` con `transmission`
refracta **la escena**, y nuestra escena está vacía — habría refractado la nada.
Además no sabe dibujar un líquido con un nivel adentro de una esfera, así que el
agua había que escribirla igual. El §3 permite explícitamente «un entorno
generado en código»; eso es lo que construí.

Coste de esa elección: **0 KB de dependencia nueva** (el árbol sigue en seis) y
**cero riesgo de que la integración de N3 se caiga**, porque el renderer, el
carrusel, la escalera de calidad y la superficie de medición no se tocaron.

**Si al founder no le convence, la opción B (assets pre-renderizados) sigue
entera y no se gastó presupuesto de bundle en el intento.**

---

### F1 · Ningún número cambió de valor

Verificado por ejecución: el gate corre `reserveLevel`, `goalsLevel`,
`debtCycleLevel`, `metasRead`, `patrimonioRead`, `briefedRead`,
`reserveTargetFrom`, `goalsPlannedFrom` y `debtCycleCardsFrom` con sus casos de
siempre y todos siguen dando lo mismo — incluidas las frases
(`"120% de tu meta"`, `"Ciclo cubierto 100%"`, `"queda 100% del aporte del mes"`).

**Cero cambios en `src/lib/financial/**` y `src/lib/ai/**`** (ver F16).

**Una cosa que sí cambió y hay que declararla:** el orbe de **Patrimonio pasó de
no tener nivel a tenerlo**. No es que un número cambiara de valor — es un número
que **antes no existía** y que F8 ordena mostrar, derivado de `wealth_target`,
que el usuario declara. Sin techo declarado sigue sin nivel, exactamente como
antes.

### F2 · La doctrina sigue ejecutable, y cinco pines se re-anclaron MÁS FUERTES

`orbFill`, `orbWaterline`, `orbMustRedraw` y `vacío ≠ sin dato` siguen puros y
ejecutados por el gate. `orbWaterline` sigue sin aparecer en `shell-payload.ts`.

Cinco pines de N2/N3 quedaron inválidos por cambios deliberados. **Ninguno se
relajó; los cinco se re-anclaron más fuertes y cada uno lo declara en su
comentario:**

| Pin | Antes | Ahora | Por qué es más fuerte |
|---|---|---|---|
| N2 materia | `orbMatter("patrimonio") === "cristal"` | las **cinco** capas son líquidas por naturaleza y el cristal lo produce **siempre** la falta de techo | cubría una capa, ahora cubre cinco |
| N3-1 tope | miraba la **constante** del trazo | mira el **alto visible** (`orbWaterApex`) + exige que la cámara del cálculo sea **literalmente** la del shader | el defecto del founder pasó por el pin viejo |
| N3-3 radio | `slot.radius === 60` para los cinco | la **activa** conserva el radio pedido y las demás encogen **monótonamente** | «todos iguales» era el defecto |
| N3-4 cristal | buscaba una **cadena literal** duplicada | **ejecuta** `orbMaterialCode` sobre las cinco capas | dos copias de una regla no son una regla |
| N3-6 giroscopio | `includes("tiltX: leanX + gyro.x")` | exige por **conducta** que el agua se mueva sin giroscopio | **el pin sujetaba el defecto en su sitio** |

### F3 · El vidrio refracta un ENTORNO — demostrado con imagen

`/dev/vidrio?hoja=cuarto`: **el mismo orbe, el mismo renderer, la misma
exposición, con y sin cuarto, lado a lado.**

El apagado es un uniforme (`uEnv`) que existe **sólo para probar esto**;
producción manda siempre `1` y el gate no lo usa como configuración.

Qué cambió en el entorno, y es lo que faltaba: N3 **ya tenía** un entorno, pero
no tenía **forma** — un degradado vertical más dos lóbulos de potencia, o sea un
cielo sin horizonte y una luz sin ventana. Un degradado reflejado se lee como
plástico porque no hay nada que **reconocer**. Ahora hay una **línea de horizonte
nítida**, una **ventana rectangular con su marco** (proyección gnomónica, se
deforma con el ángulo como un reflejo real) y un suelo que devuelve luz. En la
imagen se ve la ventana con su cruz dibujada sobre el vidrio.

Y hay **dispersión real**: el rayo sale tres veces con índices distintos y cada
canal se lee del suyo.

### F4 · El agua es simulación, no ruido — demostrado con secuencia de cuadros

`/dev/vidrio?hoja=chapoteo`. El impulso entra **una sola vez**, en el primer
paso; todo lo demás es el líquido solo. Integrando el mismo `advanceOrbWater` que
corre en el santuario, con paso fijo:

| t | inclinación |
|---|---|
| 0,00 s | 0,000 |
| 0,12 s | **−0,260** |
| 0,28 s | −0,239 |
| 0,45 s | **+0,038** ← cruza el cero |
| 0,90 s | **−0,045** ← cruza otra vez |
| 2,20 s | 0,014 (quieto) |

El gate lo integra 3 s a 120 Hz y exige **≥ 3 cruces por cero**, pico > 0,05 y
reposo < 0,01. Cruzar el cero varias veces es lo que separa un líquido de un
amortiguador.

**Las dos causas reales de la «masa deforme», y las dos estaban en el código:**

1. **El giroscopio entraba CRUDO al shader.** Una línea de N3:
   `tiltX: leanX + gyro.x`. Cero inercia entre el teléfono y el agua: inclinabas
   y el agua se inclinaba con vos, al instante y sin peso. Ahora el giroscopio es
   el **objetivo** del plano y el agua llega **pasándose de largo** (medido:
   sobrepico > 0,01, y termina a < 0,01 del ángulo).
2. **La ola corría con el reloj, no con el líquido.** Amplitud fija, pasara algo
   o no — por eso el agua se veía **siempre** revuelta, que es textura animada,
   no agua. Ahora la amplitud sale de la **velocidad** del líquido: un orbe
   quieto es casi un espejo, y ese espejo es justo el aspecto que faltaba.

También saqué el ruido fractal de la altura de la superficie (era literalmente la
masa deforme) y lo reemplacé por un rizo capilar corto que **sólo aparece cuando
el líquido se mueve**.

Y la superficie dejó de ser un brillo pintado: ahora es una **interfaz** que
refleja el cuarto y refracta el fondo, con Fresnel decidiendo cuánto de cada
cosa. De ahí sale sola la propiedad que el ojo reconoce: el borde lejano del
disco es espejo y el cercano deja ver el fondo.

`advanceOrbWater` vive en `orb-water-sim.ts`, **puro**. N3 llevaba siete líneas
de resorte sueltas dentro del `requestAnimationFrame`, donde nadie podía
ejecutarlas — sexta aparición de la familia de agujeros del bloque.

### F5 · Un orbe en cero se lee VACÍO — medido en píxeles

Con **la misma sonda** con la que medí N3 al empezar (salto de alfa en la columna
central, sobre el renderer real en `/dev/vidrio`):

| | N3 (antes) | N3B (después) |
|---|---|---|
| **orbe vacío** | **26,0 %** de la altura | **4,9 %** |

**Confirmé la queja del founder con números antes de creerle**: con el piso del
trazo en 7 %, la superficie del nivel cero aterrizaba al 26 %. Un vaso vacío
dibujaba un cuarto de vaso.

Y no era un número mal elegido, eran **tres causas**:

1. **Geometría.** La cámara mira el agua desde arriba, así que la superficie es
   una **elipse** y lo que el ojo lee como «el nivel» es su borde **lejano**, que
   queda alto. Un pin sobre la constante no podía ver eso. Ahora existe
   `orbWaterApex`, la proyección, **pura**, y el gate mira lo que se ve.
2. **El menisco era más grueso que el piso entero** (0,078 contra 0,07). Ahora
   vale 0,030 y **se apaga** cuando queda poca agua: un charco no tiene menisco
   de vaso lleno.
3. **La GOTA de N2 no llegaba al vidrio.** Esto no estaba en el spec y es la
   mitad del defecto: `orbFill` seguía devolviendo `"gota"`, pero el lienzo sólo
   miraba `matter` y `fill === "nucleo"`, así que un cero leído caía en la
   materia de agua con `orbWaterline(null)` — el piso del mapeo. **La decisión
   estaba viva y el cable cortado.** La causa de fondo era una tabla de materias
   **duplicada** (`MATERIAL_BY_KIND` en `LiveOrb` y otra igual en la probeta):
   dos copias de una regla no son una regla. Ahora hay **una** función pura,
   `orbMaterialCode`, y el gate cuenta las llamadas.

### F6 · Vacío, medio y lleno se distinguen — las tres medidas

Misma sonda, mismo renderer:

| orbe | alto del agua, medido |
|---|---|
| vacío (gota) | **4,9 %** |
| 60 % | **58,1 %** |
| 100 % | **83,5 %** |

Tope del vaso: 0,84 → **0,70**, así que un orbe lleno deja ~16 % de aire visible
donde antes dejaba ~12 %, y ese aire ahora **se lee como aire** porque el vidrio
vacío refracta el cuarto en vez de pintarse de su propio color.

**Una honestidad sobre el instrumento:** `orbWaterApex` es una **cota inferior** —
proyecta el plano y no incluye el menisco ni la ola. Medido contra el renderer:
+2,1 puntos al 60 % y +6,5 al 100 %. Por eso el pin del lleno quedó en 0,80 y no
en 0,86: con el tope flojo, «queda aire arriba» habría sido verdad del cálculo y
falso del dibujo — la clase exacta de agujero por el que se coló el charco. Está
documentado en el contrato con los números.

### F7 · Las capas ya no se pisan — y era GEOMETRÍA

**Primero, un error mío que confesar:** miré la hoja de las capas y **juré** que
seguían pisándose. Medí, y eran **dos lienzos vecinos pegados por el borde** —
el solapamiento no existía. Trampa nº 6 del spec, y me la comí igual. Ya cambié
el maquetado de esa hoja para que no engañe a nadie más.

El defecto real sí existía, y no era sombreado: el santuario pide
`orbRadius ≈ 0,35 × ancho` y coloca los centros a `ORB_TRAVEL × ancho`. Con los
números de N3, **242 px de separación para dos círculos que necesitan 272 px**.
Se pisaban **siempre**, matemáticamente.

Elegir mejor un número en la superficie no servía: el radio sale del DOM
(`boxRect.width / 2`), así que la próxima maquetación lo rompería y nadie se
enteraría hasta la próxima foto. **La regla vive ahora en quien coloca**
(`orbMaxRadius`), y el gate la barre entera — todo el recorrido, todos los pares
visibles, con el radio que el santuario pide de verdad:

```
hueco mínimo entre dos orbes visibles: +15,44 px   (peor caso, posición 0,765)
```

Medido también en píxeles sobre el lienzo real, a mitad del gesto:
dos siluetas de **131 px cada una con 152,5 px de hueco** — y de 131 px, no de
145,5, porque **están más lejos**. Eso es la profundidad: la vecina se ve
**entera** (presencia sigue valiendo 1, D-N3.2 intacta), sólo más lejos.

### F8 · Reserva y Patrimonio tienen tope, sin una sola migración

Confirmado contra el código, como decía el spec: `emergency_reserve_target` y
`wealth_target` **ya son columnas guardadas**, `setGoalPrefs` ya las escribe, y
`set_wealth_target` ya es una herramienta del agente.

`wealth_target` entra por **la misma lectura** que ya se hacía — una columna más
en un `.select()` de una fila. **Cero consultas nuevas, cero migraciones, cero
cambios de motor.**

Revierte D-N2: el cristal deja de ser una **naturaleza** de Patrimonio y pasa a
ser un **estado** que produce la falta de techo, en cualquiera de las cinco capas.

### F9 · El onboarding pregunta las dos — y una discrepancia del spec

**Onboarding:** la meta de respaldo se pregunta en el paso de Ahorro y la de
patrimonio en el paso de Patrimonio. Las dos **opcionales**: en blanco no se
escribe nada y el orbe hace lo de siempre.

**Al alcanzar la meta se ofrece una nueva**, en las dos capas
(`orbTargetReached`, función pura y pinchada — no un `>=` suelto).

**Discrepancia verificada contra el código, y no la resolví por scope:** el spec
dice «el chat también puede fijarlas (la herramienta ya existe)». Es cierto para
Patrimonio (`set_wealth_target`) y **falso para Reserva**: no hay ninguna
herramienta de `emergency_reserve_target` en `kipu-agent-tools.ts`. Agregarla
sería tocar `src/lib/ai/**`, que **F16 prohíbe explícitamente**. Lo dejo sin
hacer y lo señalo: **decisión del founder** si se abre esa excepción o si va a N4.

### F10 · Sin tope declarado, el orbe NO inventa uno

Sin techo no hay nivel — ni un 0, ni un 1, ni una estimación —, la materia cambia
a cristal, y ahora además **Kipu lo pregunta** en vez de dejarte con un cristal
que no se entiende:

- Reserva: *«¿Cuánto quieres tener de respaldo? Dímelo y te muestro cuánto llevas.»*
- Patrimonio: *«¿A cuánto quieres llegar? Dime tu meta de patrimonio…»*

El gate pincha las cinco formas de ausencia (`null`, `undefined`, `0`, `NaN`, no
numérico) y una mutación repone el defecto: hacer que `wealthTargetFrom` devuelva
`100_000` cuando el usuario no declaró nada **mata la aserción por su nombre**.

### F11 · El peso, medido

| | antes (N3) | después (N3B) | delta |
|---|---|---|---|
| `.next/static/chunks` en disco | **1320 KB** | **1392 KB** | +72 KB |
| JS crudo | 1 133 487 B | 1 195 419 B | +61 932 B |
| **gzip (suma por archivo)** | **358 144 B** | **380 807 B** | **+22 663 B (+22 KB)** |
| archivos `.js` | 32 | 33 | +1 |
| **dependencias** | **6** | **6** | **0** |

**Y la cifra que de verdad le importa a un usuario** — la ruta del santuario
`/app`, no el total del directorio:

| | antes | después | delta |
|---|---|---|---|
| `/app` (9 chunks), crudo | **202 677 B** | **208 206 B** | **+5 529 B (+2,7 %)** |

El grueso de los +22 KB **no lo carga ningún usuario**: el archivo nuevo es la
ruta **dev** `/dev/vidrio` (la mesa de luz de esta etapa), y el gate
`/dev/capture-test` creció con las aserciones nuevas. Next parte por ruta.

Justificación de los +5,5 KB en la ruta real: el shader creció 2 469 B (el GLSL
viaja como texto, así que se cuenta entero), la simulación pura y las funciones
nuevas del contrato son el resto. **`three` habría costado ~150 KB gzip.**

*Nota de método:* el gzip **de la concatenación** resultó no determinista entre
compilaciones (57,7 KB y 60,8 KB para los mismos bytes crudos, porque el orden de
módulos cambia). Todas las cifras gzip de arriba son **suma del gzip de cada
archivo**, que sí es estable. El gzip a nivel de ruta del estado *anterior* no lo
capturé antes de rehacer la compilación; por eso ahí doy bytes crudos, que son
comparables.

### F12 · El hito `orbe` — NO MEDIDO, y digo por qué

**No lo medí y no voy a decir que sí.** El hito sale del `metro` del payload del
santuario, que necesita **una sesión autenticada con datos reales**; en este
entorno no la tengo.

Lo que sí puedo afirmar por construcción: el único cambio en el camino crítico es
**una columna más en un `.select()` que ya se hacía** sobre una sola fila por
`user_id`. No agrega una consulta, no agrega un `await`, no cambia el orden de
las promesas. El resto de la etapa es shader y funciones puras, que corren
después del primer byte.

**Queda para la pasada del founder** contra 1526–1744 ms (frío) / 620–672 ms
(caliente).

### F13 · fps y térmica, instrumentados

La instrumentación **ya existe desde N3** y no la toqué: `LiveOrbTelemetry` mide
`fps`, `medianMs`, `p95Ms`, `dpr`, `bufferPixels`, `tier`, `glVersion`,
`antialias`, `drawnOrbs` y — lo que sirve como proxy térmico — `fpsAt` **al
abrir, a los 30 s y a los 3 min**.

**Cómo verla en el teléfono:** `/dev/shell-preview?perf=1`. No necesita sesión.

### F14 · lint · build · captura

```
npm run lint    → exit 0 · 0 errores (8 warnings preexistentes en scripts/qa/*.mjs)
npm run build   → exit 0
capture-test    → 883/883   (879 base + 4 nuevas · ninguna removida ni relajada)
```

Las cuatro nuevas: **N3B-1** (el agua tiene masa), **N3B-2** (la gota llega al
vidrio), **N3B-3** (dos orbes nunca se intersecan), **N3B-4** (el techo sale de
lo declarado y nadie lo inventa).

### F15 · Mutación con dientes, y el CABLE además de la conducta

`scripts/qa/n3-mutation-audit.mjs` — **30/30 mutaciones muertas por su NOMBRE**,
exit 0, restauración a 883/883. Quince son nuevas de N3B, y siete de ellas cortan
**cables**, no conductas:

- el giroscopio vuelve a entrar crudo al shader *(el defecto de N3, textual)*
- el shader recibe la ola y no la usa
- la probeta vuelve a traer su propia copia de la tabla de materias
- el lienzo calcula la profundidad y no la manda
- el nivel de Patrimonio se calcula y el orbe lo tira
- el onboarding deja de guardar el techo que el usuario acaba de escribir
- vuelve el charco de N3 (piso al 7 %)

**Dos agujeros que encontró la mutación en mis propios pines, y los dos los
arreglé:**

1. **`ORB_CAM_PITCH = 0` sobrevivía con 883/883 en verde.** Y estaba bien que
   sobreviviera: con otra cámara la proyección sigue siendo internamente
   coherente, sólo deja de describir **lo que se dibuja**. Ése es exactamente el
   agujero por el que se coló el charco del 26 %. Ahora el gate exige que las
   **cuatro constantes de cámara aparezcan literales en el shader**, así que las
   dos mitades no pueden derivar.
2. **Un `includes` se conformaba con cualquier sitio de llamada.** Cortar el
   cable de una de las dos probetas dejaba el gate verde porque la otra todavía
   llamaba. Ahora se **cuentan** las llamadas (2 en la probeta, 1 en el lienzo) —
   que es justo donde se había perdido la gota.

### F16 · Fronteras

**Cero** `supabase/**` · **cero** migraciones · **cero** `src/lib/financial/**` ·
**cero** `src/lib/ai/**` · **cero dependencias nuevas** (`three` **no** instalada;
el árbol sigue en las mismas seis).

```
 M scripts/qa/n3-mutation-audit.mjs
 M src/app/app/components/shell/LiveOrb.tsx
 M src/app/app/components/shell/OrbSpecimen.tsx
 M src/app/app/components/shell/orb-shader.ts
 M src/app/app/components/shell/shell-orb-contract.ts
 M src/app/app/components/shell/shell-payload.ts
 M src/app/dev/capture-test/page.tsx
 M src/app/dev/sistema/page.tsx
 M src/app/onboarding/onboarding-wizard.tsx
 M src/app/onboarding/save-actions.ts
 M src/lib/onboarding/draft-types.ts
 M src/lib/onboarding/wizard-model.ts
?? src/app/app/components/shell/orb-water-sim.ts
?? src/app/dev/vidrio/
```

---

## Qué mirar en el teléfono

`/dev/vidrio` — una hoja por criterio, al tamaño en el que se juzga un material:

| hoja | qué mirar |
|---|---|
| `?hoja=vaso` | ¿el vacío se lee **vacío**? ¿se distinguen los tres? |
| `?hoja=cuarto` | ¿se ve la **ventana** reflejada? ¿el de la derecha parece vidrio y el de la izquierda plástico? |
| `?hoja=chapoteo` | ¿el agua **pesa**? ¿la quieta parece un espejo? |
| `?hoja=materias` | ¿las cinco se sienten del mismo mundo? |
| `?hoja=profundidad` | ¿una pasa **detrás** de la otra? |

Y lo que **sólo existe en hardware** y este entorno no puede componer:

1. **fps y térmica** — `/dev/shell-preview?perf=1`, al abrir / 30 s / 3 min.
2. **El giroscopio.** Toda la simulación de peso se juzga inclinando el teléfono.
   Acá sólo pude integrar el modelo y medir sus números.
3. **La transmisión en iOS Safari** — WebGL2 funciona en este entorno y el primer
   cuadro pinta, pero el teléfono es el juez.
4. **El hito `orbe`** (F12), que necesita una sesión real.

---

## Desviaciones y no verificado

| # | Qué | Estado |
|---|---|---|
| 1 | **No instalé `three`**, aunque el §3 lo autorizaba | Decisión razonada arriba. Opción B intacta. **Revocable por el founder.** |
| 2 | **F12 (hito `orbe`) no medido** | Necesita sesión autenticada. Argumento por construcción arriba. |
| 3 | **F9 a medias: no hay herramienta de chat para la meta de RESERVA** | El spec la daba por existente; verifiqué que no existe. Crearla toca `src/lib/ai/**`, que F16 prohíbe. **Decisión del founder.** |
| 4 | **La animación en movimiento no la vi** | Este entorno no compone cuadros. Medí el modelo y cuadros fijos deterministas. |

## Lo que le dejo a N4

- El veredicto del founder sobre el material. Si no llega, **opción B**.
- La herramienta de chat para la meta de respaldo (punto 3), si se autoriza.
- `orbWaterApex` es una cota inferior con desvío medido (+2,1 / +6,5 puntos). Si
  alguna vez hace falta exactitud, hay que subir el menisco al contrato — con la
  advertencia de que duplicar lógica del shader es cómo las dos mitades se
  separan.
- `/dev/vidrio` queda como la mesa de luz del bloque: cualquier etapa que toque
  el material tiene dónde fotografiarse antes y después.
