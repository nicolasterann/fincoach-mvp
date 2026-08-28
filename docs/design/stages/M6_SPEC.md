# M6_SPEC — Stage M6 «Perspectiva: entender sin puntajes» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M1–M5 aceptados (`fc75334`).
- Si algo bloquea de verdad, escríbelo en `M6_REPORT.md` §Preguntas y detente;
  si sólo bloquea una parte, avanza con el resto.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`.
2. `M1_SPEC` (§11 composición, §4 prohibiciones) · `M2_SPEC` · `M3_SPEC` ·
   `M4_SPEC` · `M5_SPEC` y los cinco `*_AUDIT.md`.
3. `M_DESIGN_001` **§7** (el «Whoop financiero» SIN score, la tabla de módulos
   como preguntas humanas) y **R6** (candado anti-Pulso) ·
   `M_DESIGN_002` **iteración v4 §4** (anillos vs barras: la forma codifica la
   diferencia) y **v2** (lenguaje de anillos, semáforo `good/watch/over`) ·
   `M_DESIGN_003` §6.
4. En el código: `shell/SantuarioShell.tsx` (la hoja «Cómo vas» de M1 es lo que
   este stage reemplaza), `shell/shell-payload.ts`,
   `lib/financial/coaching-signals.ts`, `lib/trends/snapshot-store.ts`
   (`loadSnapshotSeries`, `DatedSnapshot`), y las páginas que ya existen:
   `/app/mes`, `/app/spending`, `/app/debt`, `/app/wealth`, `/app/cuentas`,
   `/app/goals`, `/app/saldo`.

---

## 1. Qué es M6 (y qué NO)

M6 construye el **nivel perspectiva**: la hoja de arriba deja de ser una lista
de enlaces y pasa a ser **cinco módulos que responden preguntas humanas**, cada
uno **puerta** a su superficie de detalle. Con esto se cierra por fin el
hallazgo más viejo del roadmap: `/app/debt`, `/app/wealth` y `/app/spending`
llevan meses construidos **sin una sola puerta alcanzable**.

**Fuera de alcance:** re-vestir esas superficies de detalle (**M7**) · PWA
(**M8**) · borrar el shell viejo (**M9**) · **cero migraciones** · cero
dependencias npm · **cero scores compuestos** (ver D‑M6.1).

---

## 2. Decisiones vinculantes

- **D‑M6.1 · CANDADO ANTI-PUNTAJE.** Pulso Kipu (0–100), Flexibilidad,
  Precisión, Realidad y los estados nombrados están **retirados y no vuelven
  por ninguna puerta**. Cada indicador de perspectiva es **un cociente honesto
  entre dos hechos del motor** o no existe. Prohibido cualquier número que
  mezcle dimensiones («salud financiera 78») y prohibido inventar una escala.
- **D‑M6.2 · La forma codifica la diferencia** (v4): **anillos** para lo que
  vive dentro de un ciclo que se reinicia (hoy, este mes); **barras** para un
  camino hacia un destino que no se reinicia (progresos). No es decoración: si
  algo se reinicia, es anillo; si acumula, es barra.
- **D‑M6.3 · Sin denominador honesto no hay porcentaje.** Cada indicador
  declara su denominador y de dónde sale (§3.2). Si el usuario no lo declaró o
  no se pudo leer: **cifra sin %**, con la invitación a definirlo por chat —
  jamás un porcentaje inventado ni un 0% que parezca medición.
- **D‑M6.4 · Patrimonio queda como PATRIMONIO TOTAL** (cierro aquí la decisión
  que dejé abierta en `M2_AUDIT`): el orbe y `/app/wealth` ya citan el mismo
  hecho, y el módulo de perspectiva lo acompaña con **su propia historia**
  (`daily_financial_snapshots.net_worth`), que es la única referencia honesta
  de «crece» sin inventar denominador. El orbe sigue **sin lámina** (D‑M2.2).
- **D‑M6.5 · El sueño al frente** (D9 de `M_DESIGN_003`): el módulo de
  progresos **abre con la meta principal por su nombre** («Brasil») y su
  avance. Es el motor emocional del producto y hasta hoy vive a dos gestos.
- **D‑M6.6 · La perspectiva no calcula dinero.** Todo indicador llega
  formateado y resuelto desde el servidor, en la MISMA lectura del santuario
  (§3.7). El cliente pinta.
- Siguen firmes: constitución `M_DESIGN_001 §10`, prohibiciones `M1_SPEC §4`,
  D‑M3.3 (ningún saldo antes→después), D‑M4.3 (no afirmar ausencia cuando no
  se pudo leer).

---

## 3. Contrato técnico

### 3.1 La hoja de perspectiva

Reemplaza la hoja de enlaces de M1 (§3.3 de `M1_SPEC`), reutilizando su patrón
(`role="dialog"`, backdrop, asa, cierre por swipe/backdrop/botón) y las mismas
reglas: doble visible, safe-area, y **el orbe pausa** mientras está abierta —
igual que la hoja del diálogo en M4.

Orden de los módulos, de arriba hacia abajo: **Hoy · Tu mes · Tu Saldo, últimos
días · Tus progresos · Lo que viene**.

### 3.2 Los cinco módulos, con fuentes VERIFICADAS

Verifiqué cada fuente antes de escribir esto. Donde el dato puede faltar, la
regla de degradación es parte del contrato, no un detalle.

| Módulo | Pregunta humana | Forma | Fuente exacta | Si falta |
|---|---|---|---|---|
| **Hoy** | ¿Cómo voy hoy? | **3 anillos iguales** (94px, v3) | Ritmo: `mk.saldo.todaySpent` sobre `mk.saldo.todayFill` · Comida y Transporte: `briefing.objectives.states[]` (`spentMTD` sobre `objectiveBase`, más `projectedCrossDateISO` / `crossed`) | Sin objetivo declarado ⇒ ese anillo **no se dibuja**; sin `todayFill` ⇒ ritmo sin % |
| **Tu mes** | ¿Cómo se reparte? | **Barra apilada** + leyenda con cifras | `mk.capacity` (protegido por destino + `monthlyTrulyFree`), la misma fuente que `/app/mes` | Lectura caída ⇒ el módulo lo dice; nunca una barra a cero |
| **Tu Saldo, últimos días** | ¿Cómo se movió? | **Cordón de nudos, uno por día** | `loadSnapshotSeries(userId, 18, now)` → `DatedSnapshot.saldoKipu`; cada nudo toma el color del semáforo de su día | Días sin snapshot son **huecos honestos** (nunca interpolar); < 2 puntos ⇒ el módulo no se dibuja |
| **Tus progresos** | ¿Hacia dónde voy? | **Barras** (D‑M6.2) | **Meta principal por su NOMBRE** (D‑M6.5) desde `briefing.goalsIntel.portfolio.primary` · **Reserva** contra `goalsWealth.emergencyReserveTarget` (columna `user_financial_preferences.emergency_reserve_target`, **opcional**) · **Salida de deuda** contra la propia historia (`daily_financial_snapshots.total_debt`) | Sin meta ⇒ invitación a crearla · **sin objetivo de reserva ⇒ cifra sin %** e invitación a definirlo por chat · sin historia suficiente de deuda ⇒ cifra y dirección, **sin %** |
| **Lo que viene** | ¿Qué se viene? | **Filas** con punto de color, día y monto | `briefing.cardsDueSoon` + `briefing.upcomingPayments` (lo que ya consume `UpcomingCommitmentsCard`) | Sin compromisos ⇒ estado tranquilo, no vacío triste |

**Semáforo:** los tokens `--good / --watch / --over` que M1 ya definió en ambos
temas. El color **es** el estado; nunca hay un rojo de alarma ambiente (P4).

### 3.3 Las puertas (el hallazgo del roadmap se cierra aquí)

Cada módulo **abre su superficie**: Hoy → `/app/spending` · Tu mes →
`/app/mes` · Saldo → `/app/saldo` · Progresos → `/app/goals` (y la barra de
deuda → `/app/debt`) · Lo que viene → `/app/cuentas`. Añade además el acceso a
**`/app/wealth`** desde el módulo de progresos o desde el orbe Patrimonio
(D‑M6.4): **al terminar M6 no puede quedar ninguna superficie construida sin
puerta alcanzable**, y eso se prueba (W10).

### 3.4 Una sola lectura

Los cinco módulos se alimentan del **mismo** `buildShellPayload` que ya hidrata
el santuario (más `loadSnapshotSeries`, que es una lectura adicional acotada).
**Prohibido** un segundo `buildCoachingBriefing` por abrir la hoja.

### 3.5 Harness y E2E

- `/dev/shell-preview` gana `?sheet=perspectiva` y fixtures para: completo ·
  **sin objetivo de reserva** · sin meta principal · con huecos en el cordón ·
  lectura caída · sin compromisos.
- **Amplía `scripts/qa/m4-thread-persona-e2e.mjs`** (o crea su hermano) con al
  menos dos pruebas de datos: **(a)** una persona **sin** `emergency_reserve_target`
  produce el progreso de Reserva **sin porcentaje**; **(b)** un cordón con días
  faltantes conserva los huecos y **no interpola**. Residuo cero como siempre.

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4`; cero migraciones; cero dependencias npm.
2. **Cero scores compuestos** y cero resurrección de conceptos retirados
   (D‑M6.1). El gate ya vigila el vocabulario: no lo devuelvas por copy.
3. Ningún porcentaje sin denominador declarado (D‑M6.3).
4. El cliente no calcula dinero.
5. No debilitar aserciones del gate; cada substring anclado debe aparecer
   **exactamente una vez**.
6. No commits en `main`, no merge, no deploy.

---

## 5. Copy

- Sin objetivo de reserva: **«Tu respaldo va en {X}. Dime cuánto quieres tener
  y te muestro cuánto te falta.»**
- Sin meta principal: **«¿Qué estás soñando? Ponle nombre y lo seguimos
  juntos.»**
- Huecos en el cordón: **«Los días sin registro quedan en blanco, no
  inventados.»**
- Lectura caída de un módulo: **«No pude leer esto ahora.»** + reintento.
- Prohibido cualquier copy que puntúe al usuario o que nombre un estado.

---

## 6. Criterios de aceptación (W1–W16)

- **W1** La hoja de perspectiva abre por swipe **y** por tap, cierra por los
  tres caminos, y **el orbe pausa** mientras está abierta.
- **W2** Los cinco módulos existen, en orden, y cada uno responde su pregunta.
- **W3** **Hoy** son tres anillos del mismo tamaño; **Progresos** son barras
  (D‑M6.2), y ninguna de las dos formas se usa para lo contrario.
- **W4** Cada porcentaje declara su denominador y sale de dos hechos del motor.
- **W5** **Sin objetivo de reserva ⇒ cifra sin %** con su invitación; jamás un
  porcentaje inventado.
- **W6** El cordón dibuja huecos donde no hay snapshot y **no interpola**.
- **W7** **Cero scores compuestos** y cero vocabulario retirado en toda la
  superficie (pruébalo por búsqueda y dilo en el reporte).
- **W8** La meta principal aparece **por su nombre** en progresos (D‑M6.5).
- **W9** Un módulo cuya lectura falló lo **dice**; no muestra ceros ni
  ausencia.
- **W10** **Ninguna superficie sin puerta:** desde el santuario se llega a
  saldo, mes, spending, debt, wealth, cuentas, goals, activity y chat.
  Enumera las rutas y demuestra el camino de cada una.
- **W11** Una sola lectura pesada por carga: cero `buildCoachingBriefing`
  nuevos al abrir la hoja.
- **W12** Temas AA en ambos modos para el semáforo y los textos de los
  módulos; `prefers-reduced-motion` sin animación y con estado final correcto.
- **W13** No-regresión M1–M5: flag y camino legacy, carrusel, orbe (un solo
  contexto, tiers), hilo y recibos, captura en sitio, voz.
- **W14** Harness con los seis fixtures de §3.5.
- **W15** **E2E con las dos pruebas nuevas** de §3.5 y **residuo cero**;
  salida pegada.
- **W16** Gates verdes por **los dos runners headless**: `lint`, `build`,
  captura (838 o el número nuevo, explicando el delta), **más una mutación
  propia por cada aserción nueva** que mate un test **con nombre**.

---

## 7. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M6): …` / `chore(M6): …`.
- Protocolo de `M1_SPEC §8` con la enmienda vigente: marca **«NO VERIFICABLE
  EN MI ENTORNO»** lo que no puedas ejecutar. M6 es sobre todo DOM, datos y
  navegación: **se espera que puedas verificar casi todo**.
- Reporte `M6_REPORT.md` con el template de `M1_SPEC §9`, autochequeo W1–W16,
  y dos secciones propias: **«Denominadores»** (uno por indicador: cuál es, de
  dónde sale, y qué pasa si falta) y **«Mapa de puertas»** (ruta por ruta).

## 8. Definición de HECHO

W1–W16 verificados, gates verdes con salida pegada, E2E corrido con residuo
cero, reporte escrito, y VERDE del auditor en `M6_AUDIT.md`. Después NO
arranques M7.
