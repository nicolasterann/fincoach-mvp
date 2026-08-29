# N3B_AUDIT — El vidrio y el agua

> Auditoría **en frío**. Contrato: `stages/N3B_SPEC.md` · entregado:
> `stages/N3B_REPORT.md`. Rama `stage-n-acabado`, sin mergear.
>
> **Conflicto declarado:** este chat escribió el spec de N3B y auditó N0–N3.

---

## Veredicto

# ✅ VERDE en lo verificable · ⚠️ **una decisión que es del founder, no mía**

Todo lo medible resiste, y lo verifiqué ejecutando. Pero **la etapa no usó la
técnica que el founder eligió**, y eso no lo puede aprobar un auditor: lo
aprueba él, mirando. Está declarado en la primera línea del reporte, con
argumento, y el resultado hay que juzgarlo con los ojos (§4).

---

## 1. Los gates, con mis manos

```
$ node scripts/qa/run-capture-gate.mjs      883/883 capture checks
$ node scripts/qa/n3-mutation-audit.mjs     25 mutaciones, las 25 → 881-882/883
                                            restauración: 883/883
$ npx eslint                                exit 0  (8 warnings preexistentes)
$ npx next build                            exit 0
```

**Diez de las 25 están etiquetadas `CABLE`.** Es la familia que este bloque
persigue desde N1 —la función pura sujeta y el argumento no— y por primera vez
la mitad del arnés la ataca de frente.

---

## 2. El agua: la integré yo

Cargué `orb-water-sim.ts` con el mismo cargador del gate y la integré 3 s a
120 Hz, con un solo impulso en el primer paso:

```
cruces por cero: 7        pico: 0,2996
t=0,12 s → −0,260   t=0,28 s → −0,228   t=0,45 s → +0,051   t=0,90 s → −0,052
```

Coincide con la tabla del reporte. **El agua oscila, cruza el cero varias veces
y se aquieta** — que es lo que separa un líquido de un amortiguador.

**Una sospecha mía que se cayó al medirla.** El gate mide el reposo como **la
última muestra**, no como el máximo de una ventana, y eso puede pasar por
casualidad si cae en un cruce por cero. Lo probé cortando en siete instantes
vecinos:

```
356→0,0025  357→0,0016  358→0,0008  359→0,0000  360→0,0008  361→0,0016  362→0,0023
```

Todos muy por debajo del umbral. **No pasa por suerte.** Queda como nota de
forma —una ventana sería un instrumento más robusto que una muestra—, no como
defecto.

---

## 3. Los tres defectos del founder, medidos

**El orbe vacío ya no dibuja un charco.** Lo miré en `/dev/vidrio?hoja=vaso`
con el renderer real: el vacío es vidrio oscuro **sin agua**, el 60 % tiene una
superficie curva legible, y el 100 % deja vidrio oscuro visible arriba.

**Y los números del reporte reconcilian exactamente con los de la página**, que
es lo que más me costó entender y vale anotarlo: la página muestra
`alto visible 56 %` y `77 %` (la cota inferior que calcula `orbWaterApex`) y el
reporte dice `58,1` y `83,5` (lo medido en el render). La diferencia es
justamente el `+2,1` y `+6,5` que el propio reporte documenta como el aporte del
menisco y la ola. **Dos instrumentos distintos, ambos declarados, que cierran.**

**Las capas ya no se pisan.** Calculé el hueco mínimo recorriendo todo el gesto
con la geometría real: **+14,85 px en el peor caso**. Y el reporte confiesa algo
que vale más que el número: creyó ver solapamiento, midió, y **eran dos lienzos
vecinos pegados** — la trampa nº 6 del spec, pagada y declarada.

---

## 4. La decisión que no es mía: no se usó `three`

El founder eligió la **opción A** después de que yo le dijera que el shader a
mano se quedaba corto. **`three` no se instaló**: el árbol sigue en seis
dependencias.

El argumento del implementador, que está primero en el reporte y es serio:
`MeshPhysicalMaterial` con `transmission` refracta **la escena**, y la nuestra
está vacía; y además no sabe dibujar un líquido con nivel adentro de una esfera,
así que el agua había que escribirla igual. Lo que sí construyó es lo que el
diagnóstico decía que era decisivo: **un entorno con forma** —horizonte, una
ventana con su marco, un suelo— y dispersión real. **Mi §3 permitía
explícitamente «un entorno generado en código»**, así que respeta la letra del
spec.

**Mi juicio, y su límite:**

- **Técnicamente el argumento es correcto** en su parte central: sin escena ni
  mapa de entorno, `transmission` no da nada; y el líquido interior había que
  escribirlo igual.
- **Pero está incompleto**: un `environment` map alimenta *también* la
  refracción, así que «la escena está vacía» no era un bloqueo insalvable — era
  precisamente lo que un HDRI resolvía.
- **Y sobre todo: el founder eligió A sabiendo el costo.** Cambiar la técnica
  elegida no es una desviación de implementación, es cambiar la decisión.

**Lo que sí puedo afirmar:** el resultado mejoró de forma medible y el costo fue
**0 KB de dependencia** y cero riesgo para la integración de N3. **Lo que no
puedo afirmar es si alcanza**, porque el criterio es el ojo del founder, que
viene de puntuar 3 y 4.

**Por eso esto no es ROJO ni VERDE de mi parte: es una pregunta para él.** Y la
opción B sigue entera, sin presupuesto de bundle gastado, que era exactamente la
salida que el spec dejó preparada.

---

## 5. Los cinco pines re-anclados: ninguno relajado

Los revisé uno por uno contra `main`. Dos merecen mención:

- **La materia.** N2 pinchaba `orbMatter("patrimonio") === "cristal"`: el cristal
  era la **naturaleza** de una capa. Con D-N2 revertida por el founder, ahora se
  exige que **las cinco** sean líquidas por naturaleza y que el cristal lo
  produzca **siempre** la falta de techo. Cubría una capa; cubre cinco.
- **El giroscopio, y esto es lo más importante que encontró la etapa.** El pin
  de N3 exigía la cadena `tiltX: leanX + gyro.x` — **y esa línea ERA el
  defecto**: la inclinación del teléfono entraba cruda al shader, sin una sola
  línea de inercia. **El pin estaba sujetando el problema en su sitio.** Ahora
  exige la conducta: que el agua se mueva sin giroscopio.

> **Doctrina nueva para el bloque:** un pin de cadena no sólo puede fallar por
> ausencia — **puede congelar un defecto**. Si un pin describe *cómo* está
> escrito algo en vez de *qué hace*, cada vez que ese algo esté mal, el pin lo
> protege.

---

## 6. Un error de MI spec que el implementador detectó y bien no arregló

Mi §5 decía «el chat también puede fijarlas (la herramienta ya existe)». Lo
verifiqué: **cero** apariciones de `emergency_reserve_target` en
`kipu-agent-tools.ts`. Es cierto para Patrimonio (`set_wealth_target`) y **falso
para Reserva**.

El implementador lo detectó, **no lo arregló** —habría tocado `src/lib/ai/**`,
que mi propio F16 prohíbe— y lo dejó señalado como decisión del founder. **Es la
respuesta correcta**: obedecer la prohibición y declarar el conflicto, en vez de
elegir cuál de mis dos reglas romper.

Es la cuarta vez en el bloque que un implementador corrige un error factual de
un spec mío.

---

## 7. Mi propia mutación, que resultó vacua

Aflojé un 6 % el tope del radio esperando que volvieran a pisarse. **Pasó
883/883** — y antes de reportarlo calculé la consecuencia: el radio pedido
(`0,35 × ancho`) ya está por debajo del tope, así que aflojarlo **no produce
solapamiento**, ni al +6 % ni al +20 %. **No hay defecto: no había nada que
atrapar.** Decimotercera acusación que se me cae al medirla, y la anoto porque
es exactamente lo que el spec pide hacer antes de acusar.

---

## 8. Lo que sigue sin verificar — del founder, en hardware

1. **Si el vidrio y el agua alcanzan.** Es el criterio real y es su ojo.
2. **La fluidez del gesto**, fps y térmica con el lienzo vivo.
3. **El giroscopio en iOS**, y que el agua se vea igual de viva con el permiso
   denegado.
4. **El hito `orbe`** después de N3B.
5. **El onboarding nuevo**: que las dos preguntas se entiendan y que dejarlas en
   blanco no rompa nada.

---

## 9. Nota de método

Este entorno **no compone cuadros** (cero `requestAnimationFrame`), pero WebGL2
pinta el primer cuadro y `/dev/vidrio` es medible. Aun así **gasté cuatro sondas
fallidas** buscando la línea de agua por gradiente, y la causa es interesante:
**cuanto mejor es el vidrio, más difícil es encontrar el agua con un detector de
bordes**, porque el reflejo del cuarto es ahora una línea horizontal más fuerte
que la superficie. Lo resolví mirando, que para un criterio visual sigue siendo
el instrumento correcto.
