# N2_AUDIT — Un solo orbe

> Auditoría **en frío**. Este chat no vio la conversación del implementador.
> Entró con `stages/N2_SPEC.md`, `stages/N2_REPORT.md` y el código.
> Rama `stage-n-acabado` @ `ef6f56d` + cambios sin commitear.
>
> **Conflicto de interés declarado:** este chat escribió `N2_SPEC.md` y auditó
> N0 y N1. No vio cómo se implementó N2. Lo compenso igual que siempre: todo lo
> de abajo está **ejecutado**, y las acusaciones son reproducibles.

---

## Veredicto

# ⛔ ROJO  ·  *(ronda 1 — resuelto en la ronda 2, ver el final del archivo)*

**Y otra vez conviene leerlo bien: el trabajo de N2 es bueno, y la mayor parte
está verificada verde por mí.** La sustitución murió de verdad, la escalera de
calidad desapareció, los tres denominadores están puestos sin una sola lectura
nueva, la gota se ve preciosa y el `sin-dato` es inconfundible. Cuatro de mis
seis mutaciones mueren por nombre, incluida una por una puerta que el
implementador no probó.

El ROJO es por **un defecto de producto que se ve en pantalla, sin necesidad de
mutar nada, en el momento exacto que este bloque más cuida: el día uno.**

**Dos de los cinco orbes le dicen a un usuario nuevo «no pude leer esto» cuando
la app leyó perfectamente.** Y le dicen eso *mientras* lo invitan a crear su
primera meta. La materia contradice al texto, y la materia equivocada es
justamente la que significa «algo está roto» — que es la frase textual con la
que el founder abrió el Bloque N.

---

## 1. Lo que corrí yo y está verde

```
$ node scripts/qa/run-capture-gate.mjs   871/871 capture checks   (866 + 5)
$ npm run lint                           ✖ 8 problems (0 errors, 8 warnings)  ← preexistentes
$ npm run build                          BUILD EXIT=0 · ƒ Proxy (Middleware)
```

| # | Criterio | Cómo lo verifiqué **yo** |
|---|---|---|
| **C2/C3** | El orbe no se sustituye | `showLiveCanvas = liveReady` (`:577`), sin `liveSettled`/`dialogOpen`/`liveTier`. Y **mi propia mutación por una puerta que el reporte no probó** (`&& !perspectiveOpen`) **cae por nombre** en `N2-5` |
| **C4** | La calidad se decide una vez | `evaluateQuality` y `dropToTier`: **0 apariciones** en `LiveOrb.tsx` |
| **C5** | Tres denominadores, cero lecturas nuevas | En el DOM: Reserva `nivel`, Metas `nivel`, Deuda `nivel`, Patrimonio `nucleo` |
| **C6** | Cada nivel con su frase | `Tu respaldo · 50% de tu meta` · `queda 62% del aporte del mes` · `Ciclo cubierto 38% · te faltan 760$` |
| **C7** | Patrimonio sin nivel | `fill="nucleo"`, única capa de cristal |
| **C8** | Gota ≠ sin-dato | **Verificado a ojo:** la gota es vidrio entero + menisco + gota luminosa; el sin-dato es un anillo punteado sin relleno. Inconfundibles |
| **C10** | Ningún número cambió | Cinco taps a 375×812: paridad total y `82.40$ · 1,200$ · 260$ · 3,480$ · 760$` |
| **C13** | Gates y re-anclajes | 871/871. **Sólo 3 líneas borradas**, y son las del pin `N1-4` |

**El re-anclaje de `N1-4` es legítimo y más fuerte.** Cambiaba
`SHELL_TIMING_GROUPS.orbe.length === 4` —una cuenta incidental— por una
**partición derivada**: los tres grupos cubren todos los tramos sin huérfanos ni
repetidos. Lo probé sacando `preferencias` del grupo `orbe`: **cae por nombre**.

**Y el implementador encontró un error en MI spec.** El §5.3 nombraba
`monthlyProtected.goals` como denominador de Metas. Verifiqué su corrección
(D2) y tiene razón: el numerador `metasAmount` suma las capas `metas` **y**
`ahorro_inversion`, así que con sólo `.goals` el nivel pasaría del 100 % en
cuanto hubiera ahorro. `goals + savings + investment` es el conjunto correcto.

Mis mutaciones que **mueren por nombre**:

```
AUD-N2-A · una capa no leída dibuja un nivel          → ✗ N2-4   870/871
AUD-N2-B · un tramo huérfano fuera de todo grupo      → ✗ N1-4   870/871
AUD-N2-C · un nivel SIN denominador                   → ✗ N2-2   870/871
AUD-N2-F · sustitución por gesto, puerta nueva        → ✗ N2-5   870/871
```

---

## 2. El defecto — el día uno dice «roto» donde debería decir «vacío»

**No hace falta mutar nada.** `/dev/shell-preview?state=dia-1`, que es el
escenario de un usuario nuevo al que la app leyó **perfectamente**:

| Capa | Materia | Texto en pantalla | |
|---|---|---|---|
| Saldo | **gota** | «Vacío hasta mañana — vuelven 24$ al amanecer.» | ✅ |
| Reserva | **gota** | «Tu respaldo se construye solo, mes a mes.» | ✅ |
| **Metas** | **sin-dato** | «¿Armamos tu primera meta? Cuéntame qué sueñas.» | ⛔ |
| **Patrimonio** | **sin-dato** | «Aún no hay un patrimonio para mostrar. Cuéntame qué tienes y qué debes.» | ⛔ |
| Deuda | **gota** | «Sin deudas registradas.» | ✅ |

Los dos textos son inequívocamente **«leí bien, todavía no hay nada, y te
invito a empezar»** — la afirmación `medido-en-cero` de N0. La materia dibujada
es **`sin-dato`**: el anillo fantasma que significa «no pude leer». Y esas dos
capas **no muestran cifra ninguna**, mientras las otras tres muestran su `0$`.

Así que un usuario nuevo abre Kipu y ve tres orbes con un cero y una gota, y
**dos círculos punteados vacíos y sin número**. La lectura natural de eso es
«esto no cargó» o «esto está roto» — que es, palabra por palabra, la queja con
la que abriste el bloque.

Es peor que «parecerse»: es **usar el estado equivocado**. Y contradice el
§5.4 del propio spec de N2 y `C8`.

### La causa raíz, y por qué el arreglo es chico

`shell-payload.ts` usa `null` para **dos cosas opuestas**:

```ts
const metasAmount = metasLayers.length ? suma : hasMetasEntity ? 0 : null;
//                                                                   ↑
//        «no hay ninguna meta ni activo»  ─── y también ───  «no pude leer»
```

Y `orbFill` mapea `null → "sin-dato"` sin excepción — correctamente, porque
**`orbFill` no puede saber cuál de las dos cosas le pasaron.**

La información para distinguirlas **ya está ahí, dos líneas más abajo**: el
propio `emptyInvite` ramifica con `ctx.assetsAvailable` para elegir entre la
invitación y «No puedo confirmar tus metas e inversiones ahora». O sea: el
payload **sí sabe** cuál de los dos casos es. Sólo que no se lo pasa al orbe.

Lo mismo con `patrimonioAmount = briefing.goalsIntel.netWorth?.totalNetWorth ?? null`.

---

## 3. El segundo hallazgo — la clase que ya veníamos arrastrando, ahora sobre dinero

Dos mutaciones mías, **las dos pasan 871/871**:

```
AUD-N2-D · sin meta declarada, se cablea un denominador de 1000
           ⇒ todo usuario sin meta de respaldo ve un nivel INVENTADO
           :: GATE EXIT 0   871/871

AUD-N2-E · statementCovered: true cableado
           ⇒ todo corte de tarjeta se declara cubierto: «Ciclo cubierto 100 %»
           :: GATE EXIT 0   871/871
```

Es la familia de `AUD-N1-D`: **la función pura está sujeta, los argumentos que
se le pasan no.** El propio reporte celebra —con razón— que su mutación D mata
el guard de moneda *dentro* de `debtCycleLevel`. Pero el cable que alimenta ese
guard se puede falsificar sin que nada chille.

**Por qué esta vez sí es orden y en N1 no lo fue.** En N1 argumenté que el
arreglo bueno era un E2E fuera de alcance y el barato un pin de cadena de los
malos. Aquí es distinto por dos motivos:

1. **Son denominadores de dinero.** El de Deuda fabrica cobertura de deuda —
   exactamente la clase de defecto que el Bloque J pagó con diez migraciones.
2. **Existe el arreglo bueno y es barato:** que la *derivación* del denominador
   sea también una función pura del contrato, que el gate ejecute. Es el mismo
   patrón de `cintaState` que N1 estrenó, aplicado un eslabón más arriba.

---

## 4. Sobre lo que N2 declara como no verificado

**Lo digo claro: la lista de ocho puntos del reporte es correcta y honesta, y no
se la reprocho.** Este entorno no compone cuadros — lo midió (`0` cuadros de
`requestAnimationFrame` en 1500 ms, `visibilityState: "hidden"`) en vez de
suponerlo. Que el relevo del orbe no se note **sólo lo puede decir el founder**,
y ninguna orden mía puede sustituir eso.

Dos que me parecen los más importantes para tu pasada:

- **El relevo** (punto 2). Es el único cambio visible que N2 deja y nadie lo vio.
- **La gota no cruzó al shader** (punto 6): en cero, al relevarse el orbe vivo,
  **la gota desaparece**. Está declarado, es consciente, y es el único sitio
  donde el relevo todavía cambia algo a la vista.

---

## 5. Órdenes

### O1 — El día uno no puede decir «no pude leer» cuando leyó *(bloqueante)*

`orbFill` tiene que recibir **la afirmación**, no inferirla de un `null`
ambiguo. La forma que este bloque ya usa: un tercer argumento explícito —
`readOk` o el `claim` de N0 — y que la decisión siga siendo pura y ejecutable.

- «leí y no hay nada» ⇒ **gota**, con su `0` visible como el resto.
- «no pude leer» ⇒ **sin-dato**.
- El payload ya sabe cuál es: usa la misma señal con la que elige el
  `emptyInvite` (`ctx.assetsAvailable` para Metas; el equivalente para
  Patrimonio).

**Prueba de que quedó hecho, sin navegador:** el gate ejecuta las dos ramas —
`orbFill({amount: null, readOk: true}) === "gota"` y
`orbFill({amount: null, readOk: false}) === "sin-dato"` — y **con navegador**:
la captura de `?state=dia-1` muestra **cinco orbes con materia coherente con su
texto**, y ningún círculo punteado en una capa que se leyó bien.

### O2 — Que un denominador de dinero no se pueda cablear a mano

La derivación de los tres denominadores pasa al contrato puro y el gate la
ejecuta, igual que `cintaState`:

```
reserveTargetFrom({ prefsError: true,  raw: 2400 })  === null   // no leyó ⇒ sin denominador
reserveTargetFrom({ prefsError: false, raw: null  })  === null   // no declaró ⇒ sin denominador
debtCycleCardsFrom([...])  ← la cobertura sale del motor, nunca de un literal
```

**Prueba:** `AUD-N2-D` y `AUD-N2-E` (§3, con el diff exacto) deben **fallar por
nombre**. Pegar la salida.

---

## 6. Lo que este entorno no pudo verificar

1. **La lectura del LCP** (C1). El instrumento está y lo verifiqué ejecutado;
   la lectura es del founder. **Las dos hipótesis del §4 siguen abiertas.**
2. **El relevo del orbe** (C2/C3) y **la materia del orbe vivo**: sin cuadros no
   hay WebGL.
3. **El hito `orbe` después de N2** (C11/C12): `/app` necesita sesión.
4. **fps con el orbe siempre encendido** en un Android de gama media.
5. **`prefers-reduced-motion`** ejercido.

**Nota de método, cuarta vez en el bloque:** mi primera sonda del `sin-dato`
midió `borderStyle` y dio `solid`, lo que sugería que el anillo punteado no
existía. La captura mostró que sí existe y que se ve perfecto. **El instrumento
equivocado miente en las dos direcciones**, y por eso el criterio visual se
cierra mirando, no midiendo.

---

## 7. Qué tiene que pasar para el VERDE

Una ronda. **O1 toca producto** (poco: pasarle al orbe una señal que el payload
ya tiene). **O2 es del gate más una función pura.**

El implementador responde las dos en una `## Ronda 2`, con la captura de
`?state=dia-1` y con `AUD-N2-D` y `AUD-N2-E` cayendo por nombre.

Y que quede dicho, porque es verdad: **N2 mató las dos causas que fotografiaste.**
La sustitución se acabó —lo probé por una puerta que ni el implementador
probó— y cuatro de cinco orbes dejaron de ser bolas de vidrio huecas. La gota
funciona: se ve deliberada, se ve viva, y no se parece en nada a un error. Lo
que falta es que el día uno use la gota en las dos capas donde todavía dibuja un
fantasma.

---

# Ronda 2 — veredicto

# ✅ VERDE

Las dos órdenes están pagadas y **lo verifiqué re-corriendo mis propias
mutaciones y mirando la pantalla**, no leyendo el reporte.

```
872/872 capture checks · lint 0 errores (8 warnings preexistentes) · build EXIT=0
871 → 872: una nueva (N2-6), cero removidas
```

## O2 — mis dos mutaciones caen por nombre

```
### AUD-N2-D (denominador de respaldo cableado a 1000)      :: GATE EXIT 1
✗ N2-6 · la derivación de los tres denominadores es pura y ejecutable;
         ninguno se puede cablear a mano                        871/872

### AUD-N2-E (statementCovered: true, sin pasar por el contrato) :: GATE EXIT 1
✗ N2-6 · …                                                      871/872
```

Las dos las re-escribí contra el código nuevo, no reusé el diff viejo. Y el
hallazgo lateral que el implementador reporta es real y valioso: la meta de
respaldo se derivaba **dos veces** —una para el orbe y otra copiada dentro de la
perspectiva— y sólo una pasaba por el contrato. Ahora hay un solo dueño.

## O1 — verificado en las dos direcciones, que es lo que importa

Un arreglo que hiciera desaparecer el `sin-dato` no sería un arreglo. Miré las
dos pantallas.

**`?state=dia-1`** — un usuario nuevo al que la app leyó bien:

```
saldo      · gota · 0$ · «Vacío hasta mañana — vuelven 24$ al amanecer.»
reserva    · gota · 0$ · «Tu respaldo se construye solo, mes a mes…»
metas      · gota · 0$ · «¿Armamos tu primera meta? Cuéntame qué sueñas.»
patrimonio · gota · 0$ · «Aún no hay un patrimonio para mostrar…»
deuda      · gota · 0$ · «Sin deudas registradas…»
```

**Cinco de cinco con materia coherente con su texto**, y las dos capas que antes
eran un anillo fantasma sin número ahora muestran su `0$` como el resto.

**`?state=lectura-caida`** — la lectura sí falló:

```
metas      · sin-dato · (sin cifra) · «No puedo confirmar tus metas e inversiones ahora.»
patrimonio · sin-dato · (sin cifra) · «No puedo leer tu patrimonio ahora. Intenta de nuevo.»
```

Lo capturé: el anillo punteado sigue ahí, sin relleno y sin número. **La materia
sigue a la afirmación, no a un `null`** — que era exactamente la orden.

**C10 re-verificado por mí** tras un cambio grande del payload (+129/−44): los
cinco taps con paridad total y `82.40$ · 1,200$ · 260$ · 3,480$ · 760$`.

## Reconocimiento: el implementador fue un nivel más lejos que mi orden

Con `readOk` puesto, mutó **el cable** en vez de la función (`readOk: false`) y
descubrió que pasaba. Lo cerró exigiendo que cada `readOk:` del bloque `orbs`
venga de una de las tres lecturas del contrato. **Yo no pedí eso**; salió de
aplicarse el criterio a sí mismo. Es la misma disciplina que en N1 encontró el
guard vaciado.

## Un hallazgo nuevo que NO abre una ronda 3 — `AUD-N2-G`

Ataqué el nivel siguiente: cambiar el lector de una capa por **otro lector
válido**.

```diff
-      readOk: metas.ok,
+      readOk: briefed.ok,
```

```
### AUD-N2-G :: GATE EXIT 0     872/872 capture checks
```

Pasa. Y la consecuencia es real: `briefedRead` devuelve **siempre** `ok: true`,
así que Metas afirmaría «leí bien» incluso con `assetsAvailable` en `false` — el
`sin-dato` se volvería inalcanzable para esa capa. Es el defecto original al
revés.

**Por qué no pido otra ronda:** la vara de la ronda 1 fueron dos órdenes con sus
pruebas, y las dos están cumplidas y verificadas por mí. Mover el poste cada
ronda vuelve la auditoría inaprobable — el mismo criterio que apliqué en N1.

**Pero lo que este hallazgo enseña sí merece quedar escrito**, porque ya es un
patrón de tres:

| Dónde | Qué estaba sujeto | Qué no |
|---|---|---|
| N1 · `AUD-N1-D` | la conducta de la cinta | el cable que la alimenta |
| N2 r1 · `AUD-N2-D/E` | las funciones de nivel | el cable de los denominadores |
| N2 r2 · `AUD-N2-G` | que el cable venga de un lector | **que sea el lector de esa capa** |

Cada arreglo empuja el agujero **un nivel más arriba**. Eso no es un fracaso del
método: es su límite. **Un pin de texto siempre se puede esquivar un nivel más
arriba; lo único que cierra la clase es recorrer la cadena con datos** — el E2E
de persona desechable que el proyecto ya usa para los caminos de dinero.

**Recomendación para N3:** que su spec lo pida como criterio *antes* de empezar,
en vez de descubrirlo auditando. Es la lección de la región de N1 aplicada a la
verificación: fijar la vara antes, no después.

## Lo que sigue sin verificar

Sin cambios, y el reporte lo declara bien: el relevo del orbe, la materia del
orbe vivo, el hito `orbe` después de N2, la lectura del LCP y los fps. Todo eso
es del founder, por una razón medida y no supuesta (`0` cuadros de
`requestAnimationFrame`, `visibilityState: "hidden"`).

**Lo primero que conviene mirar en el teléfono es `?state=dia-1`**: es la
pantalla que un desconocido va a ver en la prueba de pasillo de N7, y es la que
esta ronda arregló.

## Cierre

N2 queda **VERDE**. Mató las dos causas que el founder fotografió: la
sustitución del orbe —probada por una puerta que el implementador no probó— y
las bolas de vidrio huecas. Y en el camino corrigió un error de mi propio spec
(el denominador de Metas) y encontró un agujero que yo no había pedido cerrar.
