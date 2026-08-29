# N3B_SPEC — El vidrio y el agua

> **Contrato completo y autocontenido.** El chat implementador entra leyendo
> este archivo. Contexto: `docs/design/N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md`
> y `stages/N3_SPEC.md`. Protocolo: `docs/design/README.md`.
> Lo escribió el auditor que dio VERDE a N3, después de ejecutar el código.
>
> **Segundo acto de N3** (precedente: M9 se partió en dos actos). No renumera
> nada: N4–N8 siguen donde están.

---

## 1. Por qué existe esta etapa

N3 salió a producción y el founder la puntuó **4/10**. Sus palabras:

> *«El agua y el movimiento es malísimo… parece más una caricatura que algo real
> o tech… la mayoría de veces una masa deforme… no me da ninguna sensación de
> líquido o agua.»*

N3 ganó lo estructural —un solo lienzo, vecinas, sin sustitución, el tope del
vaso, cinco materias coherentes— y **eso se queda**. Lo que falló es el
material: el vidrio y el agua.

**El diagnóstico, y es de técnica, no de esfuerzo:** el orbe es una esfera
calculada a mano en un shader. Las gemas de OPAL están **iluminadas por un
entorno real** —la cueva se refleja en el vidrio, hay dispersión en los bordes,
hay profundidad interna—. Eso no sale de un shader procedural por mucho que se
pula. **El founder autorizó cambiar de técnica.**

---

## 2. Lo que N3B NO puede hacer — leer antes que el §1

Todo lo que el bloque ya ganó sigue en pie, y **ninguna mejora visual lo levanta**:

- **Ningún número cambia de valor.**
- **El tope del vaso sigue siendo un mapeo de DIBUJO.** `orbWaterline` no puede
  aparecer en `shell-payload.ts`. Nadie acota el valor, se acota el trazo.
- **`vacío` ≠ `sin dato`**, y sólo el que leyó puede pintar un cero.
- **Si el motor no puede afirmar un nivel, se cambia la materia** — no se apaga
  el orbe, y no se inventa un techo.
- **Cero migraciones y cero cambios en `src/lib/financial/**` ni `src/lib/ai/**`.
  Verificado: no hacen falta** (§6).
- **El hito `orbe` no puede empeorar** (frío 1526–1744 ms · caliente 620–672 ms).
- La paridad de M2/B12 y las cinco cifras siguen cerrando.

---

## 3. La técnica: 3D real con entorno *(decisión del founder)*

**Autorizado:** una librería 3D con material de transmisión física. Hoy el
proyecto tiene **seis dependencias** (`@supabase/ssr`, `@supabase/supabase-js`,
`next`, `openai`, `react`, `react-dom`) y **`three` no está instalada** —
verificado. Última versión: **`three@0.185.1`**.

Lo que la técnica tiene que dar, y es lo que hoy falta:

- **Transmisión real**: índice de refracción, espesor, dispersión. El vidrio
  refracta lo que hay detrás, no lo simula.
- **Un entorno que se refleje.** Es *la* diferencia con OPAL. Puede ser un HDRI
  pequeño o un entorno generado en código — **lo que no puede es no haber
  ninguno**. Si es un asset, su peso se declara y se justifica.
- **Profundidad de verdad**, que arregla sola la queja del founder de que las
  capas *«se pisan»*: dos esferas con profundidad pasan una delante de la otra
  en vez de intersecarse con un borde duro.

**Y el presupuesto, medido hoy:** `.next/static/chunks` pesa **1,3 MB**. El
reporte debe pegar ese número **antes y después**, y también el peso servido
comprimido. Para calibrar: N1 sacó 463 kB de cada carga, así que hay margen —
pero es margen, no barra libre.

**La salida de emergencia, decidida por el founder:** si después del ciclo de
ajuste el vidrio no convence, **se pasa a la opción B** (assets pre-renderizados
offline). No es un fracaso, es una rama planificada. El reporte tiene que decir
con honestidad si llegó o no, **con imágenes**, no con adjetivos.

---

## 4. El agua — pesa lo mismo que el vidrio

El founder lo subrayó aparte: *«la simulación y el material del agua también es
malísimo, eso también lo tienes que arreglar, no sólo el vidrio.»*

**La causa de que se vea como caricatura:** hoy la superficie es **ruido**. Un
ruido animado no se lee como líquido — se lee como una masa deforme, que es
exactamente la palabra que usó.

- **Simulación, no dibujo.** Un campo de alturas con **gravedad y
  amortiguación**: el agua se inclina, vuelve, oscila y se aquieta con peso.
  Reacciona al gesto, al cambio de capa y —si hay permiso— al giroscopio.
  Esto es lo que separa «líquido» de «onda dibujada», y aplica sea cual sea el
  material del vidrio.
- **Una superficie de verdad**: menisco que se curva contra la pared,
  refracción a través de ella, y cáustica que sea consecuencia de la superficie,
  no una textura encima.
- **Espesor y color por profundidad**: el agua honda se ve más densa que la
  lámina del borde.

### Y dos defectos concretos que arrastra N3

**El orbe vacío dibuja un charco.** `ORB_WATERLINE_FLOOR = 0.07`, y medido en el
renderer real la superficie del nivel 0 queda al **~20–33 % de la altura**. El
founder lo vio: *«en el saldo que se supone que está acabado se ve demasiado
lleno.»* **Es una regresión de N2**, donde un orbe vacío era una **gota
deliberada**. Un orbe en cero tiene que leerse vacío.

**El orbe lleno no deja aire suficiente.** `CEILING = 0.84` deja 16 % y aun así
el founder dice que *«los orbes llenos no dejan realmente espacio abajo»*. El
menisco tiene que **verse como aire**, no como una banda más clara del mismo
material.

---

## 5. Los topes — decisión del founder, confirmada

> *«Confirmo que tenemos que usar las metas para que reservas y patrimonio
> tengan tope, lo podemos preguntar siempre en el onboarding y sino también se
> pueden preguntar y establecer por chat.»*

Esto **revierte D-N2** (Patrimonio sin nivel). Ahora **todo tiene techo**.

| Capa | Denominador | Estado verificado |
|---|---|---|
| **Reserva** | `emergency_reserve_target` | Columna guardada · `setGoalPrefs` la escribe |
| **Patrimonio** | `wealth_target` | Columna guardada · `setGoalPrefs` la escribe · **la herramienta `set_wealth_target` ya existe** en el agente · `/app/wealth` ya muestra «X de Y» |

**Cero migraciones. Cero cambios de motor.** Lo verifiqué: los dos campos, sus
escritores y la herramienta de chat ya están.

Lo que sí falta:

- **Onboarding no pregunta ninguna de las dos.** Verificado: no aparecen en
  `src/app/onboarding/`. El wizard es `onboarding-wizard.tsx` (2752 líneas) con
  un arreglo `STEPS` declarado y `save-actions.ts` (1498). Agregar la pregunta
  es acotado pero real.
- **El orbe no usa `wealth_target`**, porque D-N2 decía que Patrimonio no lleva
  nivel.
- **Al alcanzar la meta, ofrecer una nueva** — pedido explícito del founder.

**Y la doctrina no se relaja:** si un tope **no está declarado**, el orbe
**sigue sin inventarlo**. Cambia la materia, como hoy. La diferencia es que
ahora Kipu **lo pregunta** en vez de dejarte con un cristal que no se entiende.

---

## 6. Criterios de aceptación

| # | Criterio |
|---|---|
| **F1** | **Ningún número cambió de valor**; paridad y las cinco cifras intactas |
| **F2** | **La doctrina sigue ejecutable**: `orbFill`, `orbWaterline` sólo en el dibujo, `orbMustRedraw`, `vacío` ≠ `sin dato`. Los pines de N0–N3 siguen verdes o se re-anclan **más fuertes**, declarándolo |
| **F3** | **El vidrio refracta un entorno.** Se demuestra con imagen: el mismo orbe con y sin entorno, lado a lado |
| **F4** | **El agua es simulación, no ruido.** Se demuestra que responde a un impulso: inclinar, soltar, y que oscila y se aquieta. Video o secuencia de cuadros |
| **F5** | **Un orbe en cero se lee VACÍO** y no muestra charco. Medido en píxeles, no descrito |
| **F6** | **Un orbe lleno deja aire visible** y se distingue de uno al 60 % y de uno vacío. Las tres, medidas |
| **F7** | **Las capas ya no se pisan** al cambiar: hay profundidad, una pasa delante de la otra |
| **F8** | **Reserva y Patrimonio tienen tope** desde los campos existentes, **sin una sola migración ni cambio de motor** |
| **F9** | **Onboarding pregunta las dos metas**, y el chat también puede fijarlas (la herramienta ya existe). Alcanzar la meta ofrece una nueva |
| **F10** | **Sin tope declarado, el orbe NO inventa uno**: cambia la materia, y Kipu pregunta |
| **F11** | **El peso, medido**: `.next/static/chunks` antes y después (hoy **1,3 MB**) y el peso servido comprimido. Con su justificación |
| **F12** | **El hito `orbe` no empeoró** contra 1526–1744 ms (frío) / 620–672 ms (caliente) |
| **F13** | **fps y térmica instrumentados** para que el founder los mida en su iPhone |
| **F14** | `lint` 0 errores · `build` exit 0 · captura **879 + nuevas**, ninguna removida ni relajada |
| **F15** | **Mutación propia con dientes, y el CABLE además de la conducta** |
| **F16** | Cero `supabase/**`, migraciones, `src/lib/financial/**` ni `src/lib/ai/**`. La única dependencia nueva permitida es la de render, declarada y pesada |

---

## 7. Trampas verificadas

1. **`three` no está instalada** y el árbol tiene seis dependencias. Es la
   primera dependencia de peso del proyecto: medila, no la supongas.
2. **iOS Safari es el objetivo, y no lo podés probar acá.** La transmisión con
   `MeshPhysicalMaterial` necesita WebGL2 y un buffer del fondo; funciona en
   Safari moderno, pero **eso lo confirma el founder en su teléfono**.
3. **Este entorno no compone cuadros**: cero `requestAnimationFrame`,
   `visibilityState: "hidden"`. **Pero WebGL2 funciona y el primer cuadro sí
   pinta** — `/dev/sistema?seccion=vidrio` es la superficie de medición, con
   lienzos 2D alimentados por un renderer compartido. Nunca *esperes* a rAF: se
   cuelga.
4. **Un `<canvas>` nunca es el elemento LCP.** Medido en producción: es
   `span.kipu-shell-pill__text`.
5. **`rm -rf .next` rompe cualquier dev server corriendo**, incluido el de otro
   chat. Borrá antes de levantar, no después.
6. **Re-medí antes de acusar.** En el bloque se cayeron **once** acusaciones al
   volver a medir, tres de ellas en la auditoría de N3. Si tu primera medición
   encuentra algo grande, sospechá de tu sonda.
7. **Una comparación de posición pasa por ausencia** (`indexOf` da `-1`), y un
   pin que mira una apertura no prueba que el guard haga algo.
8. **La familia de agujeros que este bloque arrastra**: la función pura sujeta y
   el argumento no. Van cinco apariciones. **Pinchá el cable además de la
   conducta**, siempre.

---

## 8. Formato del reporte

`docs/design/stages/N3B_REPORT.md`, append-only por rondas. Por cada criterio
F1–F16: cómo lo verificaste y la salida real. Al final: qué mirar en el
teléfono, desviaciones, no verificado, y lo que le dejás a N4.

**Y una instrucción de método que esta etapa necesita más que ninguna:
mostrá temprano y seguido.** El criterio de aceptación es el ojo del founder,
que ya puntuó 3 y 4. **No llegues al final con un reporte: llegá a la mitad con
una imagen.** Si a mitad de camino el vidrio no está cerca, decilo — la opción B
existe justamente para eso y usarla a tiempo es un acierto, no una derrota.
