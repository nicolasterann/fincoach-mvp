# M7_SPEC — Stage M7 «Re-vestir los detalles: un solo producto» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M1–M6 aceptados (`fa1c3b0`).
- Si algo bloquea de verdad, escríbelo en `M7_REPORT.md` §Preguntas y detente;
  si sólo bloquea una superficie, avanza con las demás y dilo.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`.
2. `M1_SPEC` (**§11 composición: es la fuente de tokens y geometría**, y §4
   prohibiciones) · `M2`–`M6_SPEC` y los seis `*_AUDIT.md`.
3. `M_DESIGN_001` §8 (mapa de superficies) y §10 (constitución) ·
   `M_DESIGN_002` (jerarquía v3/v4) · `M_DESIGN_003` §2 (**la medición del
   front viejo: densidad, cuatro vocabularios de color en `/app/spending`,
   párrafos largos en `/app/saldo`, costuras de identidad**) y **C5**.
4. `docs/ROADMAP.md` → **Bloque J‑6**: la lección de vocabulario, que aquí
   vuelve a aplicar palabra por palabra («90 strings reescritos por CONTEXTO,
   no por find/replace»).

---

## 1. Qué es M7 (y qué NO)

M7 hace que **todo el producto se sienta uno solo**: las superficies de
detalle —que hoy siguen vestidas con el sistema viejo— pasan al lenguaje de
M1–M6. Es el stage de **mayor volumen y menor riesgo aparente**, y por eso el
más peligroso: re-vestir once pantallas puede cambiar un número sin que nadie
lo note.

**Fuera de alcance:** PWA, iconos, landing y modo día completo (**M8**) ·
borrar el shell viejo, redirects y barrido final (**M9**) · **cero
migraciones** · cero dependencias npm · **cero cambios en lo que se calcula**
(D‑M7.1).

---

## 2. Decisiones vinculantes

- **D‑M7.1 · Re-vestir es cambiar CÓMO SE VE, jamás QUÉ SE CALCULA.** Ningún
  número puede cambiar de valor por este stage. Si al re-vestir descubres que
  una cifra está mal, **no la arregles aquí**: anótala en §Hallazgos y sigue.
  Un stage de estética que corrige aritmética es un stage que nadie puede
  auditar.
- **D‑M7.2 · El dinero se calcula en el servidor; en la página sólo hay
  proporciones de dibujo.** Un ancho de barra derivado de dos cifras del motor
  (`balance/maxScale`) es presentación y está bien. **Sumar, restar o
  prorratear dinero en una página no lo está.** Hoy hay al menos tres casos
  reales que este stage resuelve o declara:
  `mes/page.tsx:103-106` (`baseGoalsMonthly` / `foreignGoalsMonthlyBase`),
  `activity/page.tsx:85-121` (neteo de reversas y totales por día) y
  `mes/MesRedistribute.tsx` (previsualización en cliente que se declara «espeja
  la matemática del motor»). Muévelos al servidor o **decláralos con su razón**.
- **D‑M7.3 · El framing semanal muere donde ENMARCA y sobrevive donde es una
  cadencia que el usuario eligió.** Esta distinción es de J‑6 y no se
  resuelve con find/replace:
  - **Muere:** el héroe «Tu semana» de `/app/spending` (`page.tsx:223`) —
    compite con el héroe diario del producto— y el chip «¿Cómo voy esta
    semana?» de `ChatView.tsx:31`.
  - **Sobrevive:** los `/semana` de `/app/goals` (`:220`, `:260`, `:269`),
    porque son **la cadencia de aporte que el usuario comprometió**. Cambiarlos
    haría que la frase mienta.
  - El gate ya lleva un trinquete de conteo: puede **bajar**, nunca subir.
- **D‑M7.4 · C5 se cierra aquí: el detalle de Metas muestra NOMBRES.** El orbe
  Metas suma metas + ahorro + inversión, y hasta hoy el usuario no puede ver de
  qué está hecho. `SaldoLayer` no lleva nombres, así que el detalle los une
  desde donde sí viven (`goalsIntel.portfolio.goals`, planes de ahorro,
  inversiones). Sin nombre legible ⇒ se dice, no se inventa una etiqueta.
- **D‑M7.5 · Los anclajes de `mis-datos` y `settings` son doce.** El gate clava
  literales de `mis-datos/page.tsx`, `data-editor.tsx`, sus `actions.ts` y
  `settings/data-card.tsx`. **Re-viste su chrome, no su formulario**: si tocas
  una línea anclada, re-anclas **sin debilitar** y lo pruebas por mutación.
- **D‑M7.6 · Menos texto, no más.** Esta es la superficie donde el front viejo
  acumuló prosa: los párrafos explicativos de `/app/saldo` en `text-xs` y los
  **cuatro vocabularios de color simultáneos** de `/app/spending`. Re-vestir
  incluye **podar**: una idea por bloque, el número primero.
- **D‑M7.7 · `/app/cashflow` no se re-viste.** Está huérfano (M6 no le abrió
  puerta) y su destino —absorberlo o retirarlo— es de **M9**. Déjalo intacto y
  no le agregues enlaces.
- Siguen firmes: constitución `M_DESIGN_001 §10`, prohibiciones `M1_SPEC §4`,
  y todas las reglas de honestidad de M3–M6 (sin flecha de saldo, sin
  porcentaje sin denominador, no afirmar ausencia cuando no se pudo leer).

---

## 3. Contrato técnico

### 3.1 El inventario primero (para que nada quede a medias)

**Antes de re-vestir, escribe en el reporte la tabla de las once superficies**
con: ruta · qué cambia (chrome / layout / copy) · anclajes del gate que toca ·
derivaciones de dinero que encuentra. Ese inventario es el contrato de
completitud del stage: una superficie sin fila es una superficie olvidada.

Las superficies: `/app/saldo` · `/app/cuentas` · `/app/mes` · `/app/spending` ·
`/app/debt` · `/app/wealth` · `/app/goals` · `/app/activity` · `/app/fx` ·
`/app/household` · **«Tu Kipu»** (`/app/settings` + `/app/kipu-fit` +
`/app/mis-datos`, que se presentan como un solo destino aunque sigan siendo
rutas).

### 3.2 El sistema visual que se aplica

El de M1 §11, sin reinventar nada: tokens de capa y semáforo, Geist con
`tabular-nums` para cifras y Geist Mono como voz del ledger, radios y
superficies del santuario, `prefers-reduced-motion` de primera clase, y AA en
ambos temas. Cada superficie hereda **el acento de su capa** (saldo→emerald,
reserva→sky, metas→violet, patrimonio→cristal, deuda→ámbar) para que al entrar
desde un orbe la transición se sienta continua.

### 3.3 La vuelta

Toda superficie de detalle vuelve al santuario con un control visible (no sólo
el gesto del sistema), y conserva las puertas que M6 abrió: entrar y salir no
puede dejar al usuario en una ruta huérfana.

### 3.4 Prueba de que ningún número cambió

Es el criterio central del stage (X4). Para cada superficie re-vestida,
demuestra que **las cifras que muestra salen de los mismos campos del motor
que antes**: enumera en el reporte, por superficie, los campos leídos antes y
después. Si un campo cambió de nombre o de ruta de acceso, dilo y justifica.
**Cero aritmética de dinero nueva en archivos de página**, y las tres
derivaciones de D‑M7.2 resueltas o declaradas.

### 3.5 Harness y E2E

- `/dev/shell-preview` no necesita crecer. Si te ayuda, añade una vista que
  liste las once superficies con su estado de re-vestido.
- **E2E:** amplía `scripts/qa/m4-thread-persona-e2e.mjs` con **una** prueba de
  datos: el detalle de **Metas** de una persona con una meta, un plan de ahorro
  y una inversión **muestra los tres nombres** (D‑M7.4), y si una fuente no
  expone nombre, lo **declara** en vez de inventarlo. Residuo cero.

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4`; cero migraciones; cero dependencias npm.
2. **Ningún número cambia de valor** (D‑M7.1). Nada de «de paso lo arreglo».
3. Cero aritmética de dinero nueva en páginas (D‑M7.2).
4. Nada de find/replace sobre vocabulario (D‑M7.3).
5. No debilitar aserciones; cada substring anclado aparece **exactamente una
   vez**.
6. No tocar `/app/cashflow` ni agregarle enlaces.
7. No commits en `main`, no merge, no deploy.

---

## 5. Copy

Se **poda**, no se reescribe por gusto. Reglas: el número primero, una idea por
bloque, cero jerga, cero framing semanal donde enmarca (D‑M7.3), y la voz de
Kipu de siempre. Si una explicación larga es necesaria, va **detrás de un
toque**, no delante del dato.

---

## 6. Criterios de aceptación (X1–X16)

- **X1** El inventario de §3.1 está completo: once superficies, ninguna sin
  fila.
- **X2** Las once usan los tokens, la tipografía y las superficies de M1 §11;
  ninguna conserva el sistema viejo.
- **X3** Cada superficie hereda el acento de su capa y la transición desde su
  orbe se siente continua.
- **X4** **Ningún número cambió de valor**, demostrado campo por campo (§3.4).
- **X5** Cero aritmética de dinero nueva en páginas; las tres derivaciones de
  D‑M7.2 resueltas o declaradas con su razón.
- **X6** «Tu semana» deja de ser el héroe de `/app/spending` y el chip semanal
  del chat desaparece; **los `/semana` de metas siguen intactos** (D‑M7.3), y
  el conteo del trinquete **baja**.
- **X7** **C5 cerrado:** el detalle de Metas muestra los nombres de sus
  fuentes; sin nombre legible, lo dice.
- **X8** `/app/spending` deja de usar cuatro vocabularios de color a la vez;
  `/app/saldo` pierde sus muros de prosa (D‑M7.6).
- **X9** «Tu Kipu» se presenta como un destino único aunque sean tres rutas.
- **X10** Toda superficie tiene vuelta visible al santuario y conserva las
  puertas de M6.
- **X11** `/app/cashflow` intacto y sin enlaces nuevos.
- **X12** Anclajes de `mis-datos`/`settings`: si los tocaste, re-anclados sin
  debilitar y probados por mutación; si no, dilo.
- **X13** Temas AA en ambos modos y `prefers-reduced-motion` correcto en las
  once.
- **X14** No-regresión M1–M6: santuario, orbe, hilo, captura, voz, perspectiva
  y **las nueve puertas**.
- **X15** **E2E** con la prueba de nombres de Metas y **residuo cero**; salida
  pegada.
- **X16** Gates verdes por **los dos runners headless** (`lint`, `build`,
  captura 842 o el número nuevo explicando el delta), **más una mutación propia
  por cada aserción nueva** que mate un test **con nombre**.

---

## 7. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M7): …` / `chore(M7): …`.
- Protocolo de `M1_SPEC §8` con la enmienda vigente.
- Reporte `M7_REPORT.md` con el template de `M1_SPEC §9`, autochequeo X1–X16,
  y tres secciones propias: **«Inventario de superficies»** (§3.1),
  **«Campos leídos, antes y después»** (§3.4) y **«Hallazgos»** (lo que
  encontraste mal y NO arreglaste, con su ruta y su línea).

## 8. Definición de HECHO

X1–X16 verificados, gates verdes con salida pegada, E2E corrido con residuo
cero, reporte escrito, y VERDE del auditor en `M7_AUDIT.md`. Después NO
arranques M8.
