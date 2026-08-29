# N3_AUDIT — El orbe

> Auditoría **en frío**. Este chat no vio la implementación.
> Contrato: `stages/N3_SPEC.md` · entregado: `stages/N3_REPORT.md` (dos rondas).
> Rama `stage-n-acabado`, sin mergear a `main`.
>
> **Conflicto de interés declarado:** este chat escribió el spec de N3 y auditó
> N0, N1 y N2. No vio cómo se implementó N3. Todo lo de abajo está **ejecutado**.

---

## Veredicto

# ✅ VERDE

Los cuatro gates los corrí yo, y las cinco zonas que el implementador marcó como
sus lugares más probables de error las verifiqué midiendo — no leyendo. **Las
cinco resisten.** Dos de sus tres desviaciones **corrigen mi spec**, no lo
esquivan.

Queda **un hallazgo declarado para N4** (§5), que no abre ronda por la regla que
este bloque ya fijó: la vara se pone una vez.

---

## 1. Los gates, con mis manos

```
$ node scripts/qa/run-capture-gate.mjs      879/879 capture checks
$ node scripts/qa/n3-mutation-audit.mjs     15 mutaciones, las 15 → 878/879
                                            restauración: 879/879
$ npx eslint                                exit 0
$ npx next build                            exit 0
```

Las quince mutaciones caen **cada una por su nombre**, y la mitad son de
**cable**, no de conducta — que es la lección que este bloque pagó en tres
niveles.

---

## 2. El riesgo número uno: los cuatro pines re-apuntados

`git diff main` sobre el gate deja **nueve líneas borradas**, y todas son la
misma invariante: cuándo se pausa el orbe.

**M4-3, M6-4 y N2-5 · legítimos y MÁS FUERTES.** Sujetaban
`active={liveSettled && !dialogOpen && !perspectiveOpen}`. Ahora sujetan
`active={!dialogOpen && !perspectiveOpen}`:

- **La invariante que protegían sobrevive entera**: una hoja encima —chat o
  perspectiva— calma el orbe.
- Lo que se cayó es `liveSettled`, el término del **gesto**. Y tiene que caerse:
  en la forma nueva **el gesto ES el dibujo**, así que pausarlo sería volver a
  congelar el lienzo mientras te movés — exactamente el defecto que N2 metió y
  que el hotfix de `orbMustRedraw` acaba de sacar.
- **Y agregan lo que antes no decían:** `!/active=\{[^}]*liveSettled/` y
  `!/data-orb-paused=\{[^}]*liveSettled/`. El gesto **no puede volver a entrar**
  en esa decisión. Es una prohibición nueva, no un permiso.

**M5-2 · una restricción, no un aflojamiento.** `voice: animatedVoice` pasó a
`voice: isActive ? animatedVoice : 0`. La promesa de M5 —el aura sale de un
`AnalyserNode` real y no se simula— sigue intacta; lo que se agrega es que un
aura repartida entre cinco orbes afirmaría que Kipu te escucha desde una capa
que no abriste.

**Veredicto sobre E11: ninguna se relajó.** Tres conservan su promesa y suman
una prohibición; la cuarta la acota.

---

## 3. La trampa central: ¿el tope del vaso acota el dato?

**No.** `orbWaterline` aparece **sólo** en caminos de dibujo —`LiveOrb`,
`OrbSpecimen`, `orb-shader`, `/dev/sistema`— y **jamás en `shell-payload.ts`**,
que es donde se fabrican la cifra y la frase. `N3-1` lo prohíbe por nombre.

Y lo medí en píxeles, con el renderer real:

```
saldo nivel 1.0  → línea de agua al 80,4 %   (≈20 % de aire arriba)
saldo nivel 0.6  → 63,2 %
saldo nivel 0.0  → 33,4 %       estrictamente creciente
```

**El menisco del 100 % se ve.** Es la regla del vaso del founder, cumplida y
medible: un orbe lleno se lee lleno porque se le ve el límite del agua, no
porque esté pintado entero.

Mi mutación propia —aplanar el trazo contra el tope— **cae por nombre en
`N3-1`**.

---

## 4. Lo visual, medido por mí

Este entorno **no compone cuadros** (lo verifiqué: `0` frames de
`requestAnimationFrame` en 1500 ms, `visibilityState: "hidden"`). Pero
**WebGL2 funciona y el primer cuadro sí se pinta**, así que `/dev/sistema?seccion=vidrio`
es medible. Los 17 lienzos están **vivos**: son 2D alimentados por un renderer
WebGL2 compartido (`data-gl-version="2"`, `data-drawn="1"`), con píxeles reales.

**Las cinco materias, del mismo mundo** — gradiente horizontal por fila, que es
lo que distingue una superficie de agua de un borde de esfera:

```
saldo      63,5 %   pico 125,5   prominencia 8,27
reserva    63,5 %   pico 129,7   prominencia 8,44
metas      63,5 %   pico 131,6   prominencia 8,76
deuda      63,5 %   pico 132,5   prominencia 9,00
patrimonio 62,8 %   pico  55,4   prominencia 3,89   ← SIN línea de agua
```

Las cuatro líquidas caen en **el mismo 63,5 %** con picos en una banda del 2 %:
misma física, distinto pigmento. **E5 verificado.**

**Patrimonio no dibuja agua.** Su pico es **menos de la mitad** y su prominencia
también: lo que hay a esa altura es el borde del núcleo, no una superficie. **El
guard de cristal aguanta.**

**Las vecinas** (alpha medio por quinto del campo):

```
en reposo (pos 0)        0 · 0,125 · 0,514 · 0,126 · 0     → sólo la activa
mitad del gesto (0,5)    0,405 · 0,355 · 0,002 · 0,294 · 0,342  → las dos, enteras
asentándose (0,88)       0,03 · 0,005 · 0,374 · 0,261 · 0  → la que se va, YÉNDOSE
```

La tercera es la que importa: la saliente no se apaga, **se va**. La regla del
founder se cumple en sus dos mitades.

**La frontera de N0** la verifiqué forzando `data-live-visible="true"` sobre el
escenario de lectura caída: `sin-dato` conserva su **anillo punteado sin
relleno** y el lienzo no pinta nada ahí (captura tomada).

**La paridad y las cifras**, que es lo que la arquitectura nueva podía romper:

```
paridad posición/slide/chip/capa/nudo/materia: TOTAL
82.40$ · 1,200$ · 260$ · 3,480$ · 760$   — las de siempre
```

---

## 5. Las tres desviaciones, juzgadas

**No abandonar el scroll nativo · ACEPTADA, y corrige mi spec.** Mi §4.1 daba
por hecho que había que reponer inercia, snap y accesibilidad a mano. El
implementador mudó **el dibujo** y dejó el gesto donde estaba. Eso cumple el
requisito real del §4.1 —vecinas durante el gesto, movimiento continuo, sin
sustitución— **y conserva gratis** lo que mi ruta habría hecho reconstruir. Lo
verifiqué: la paridad de M2/B12 sigue cerrando. **Mi premisa era peor que su
solución.**

**Antialiasing analítico con `fwidth` en vez de MSAA · ACEPTADA, y el argumento
es correcto.** No se lo creí: lo revisé. La esfera se calcula en el fragmento
sobre un cuad; la única geometría es el cuad, cuyos bordes no se ven. **MSAA
suavizaría un borde invisible y no la silueta.** El suavizado analítico es la
herramienta correcta, no un atajo. Mi spec pedía «MSAA o supersampling» y era
impreciso.

**Refracción ablandada (0,90 en vez de 0,78) · ACEPTADA con nota.** Es producto
sobre realismo, declarado. Y va en la dirección de la queja que originó la
etapa: con el índice realista el orbe se ve lleno mire donde mire, que es
literalmente *«en ninguno logro identificar nivel de agua»*. **Es el ojo del
founder el que cierra esto**, no una medición mía.

---

## 6. El hallazgo que declaro para N4, sin abrir ronda

Mutación mía, distinta de las quince del arnés: **acotar el dato a mano en el
payload, con un número mágico que no nombra el mapeo.**

```diff
- level: deuda.level,
+ level: deuda.level == null ? null : deuda.level * 0.801,
```

```
### AUD-N3-A :: GATE EXIT 0     879/879 capture checks
```

`N3-1` prohíbe que el payload **nombre** `orbWaterline`, y eso cierra la trampa
que el spec describió. No cierra un recorte arbitrario, que dejaría el orbe
dibujando por debajo de su propia frase.

**Por qué no abre ronda:** es la quinta aparición de la misma familia
—`AUD-N1-D`, `AUD-N2-D/E`, `AUD-N2-G` y ésta—, la vara de esta etapa se fijó en
el spec y está cumplida, y la regla del bloque dice que un eslabón nuevo se
declara para la etapa siguiente.

**Y una advertencia para quien lo intente en N4:** el atajo obvio —exigir que el
porcentaje de la frase coincida con el nivel— **no funciona**, y lo comprobé
antes de recomendarlo: `reserveLevel({amount:2880,target:2400})` devuelve
`level: 1` con la frase `"120% de tu meta"`. La divergencia es deliberada: el
agua se acota, la frase no. **El cierre real de esta familia no es otro pin de
texto: es recorrer la cadena con datos**, el E2E de persona desechable que el
proyecto ya usa para los caminos de dinero.

---

## 7. Lo que nadie pudo verificar — ni el implementador ni yo

Queda **declarado, ni verde ni rojo**. Es del founder en hardware:

1. **La fluidez del gesto** y que el paso entre capas se sienta continuo.
2. **fps y térmica** con el lienzo vivo, incluida la decisión D-N3.4 que sigue
   con default declarado y sin respuesta.
3. **El giroscopio en iOS**: que el permiso se conceda desde el gesto elegido, y
   que el agua se vea igual de viva con el permiso **denegado**.
4. **El hito `orbe`** después de N3, contra 1526–1744 ms (frío) / 620–672 ms
   (caliente).
5. **La PWA instalada.**
6. **Si le vuela la cabeza.** Es el criterio de aceptación real de la etapa y no
   se audita con un gate.

---

## 8. Notas de método

**Tres veces mi propia sonda mintió en esta auditoría, y las tres re-medir lo
arregló** — van once en el bloque:

- Esperé cuadros de `requestAnimationFrame` en una página oculta y **la sonda se
  colgó**. Nunca hay que *esperar* a rAF acá; hay que contarlo contra un
  temporizador.
- Los 17 lienzos me dieron «muertos» porque les pedí un contexto WebGL: son 2D
  alimentados por un renderer compartido. **Estaban perfectamente vivos.**
- El primer detector de línea de agua tomaba «el salto más grande» de una
  columna y confundía reflejos con superficie. El bueno mide **gradiente por
  fila a lo ancho**, que es lo que separa una superficie plana de un borde
  curvo — y es el que dejó a Patrimonio en evidencia como cristal.

**Y una que rompí yo:** borré `.next` con el dev server de otro chat corriendo
en el 3000 y lo dejé en HTTP 500. Es la trampa que el propio reporte advertía.
Levanté el mío en otro puerto para no seguir pisándolo; **ese server ajeno se
recupera reiniciándolo.**
