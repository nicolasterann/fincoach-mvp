# M9_SPEC — Stage M9 «Cierre del Bloque M» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M1–M8 aceptados.
- Si algo bloquea de verdad, escríbelo en `M9_REPORT.md` §Preguntas y detente.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`, `docs/ROADMAP.md` (Bloque M).
2. `M1`–`M8_SPEC` y los ocho `*_AUDIT.md`.
3. `docs/PRODUCT_SPEC.md` §«Home (Whoop-for-money)» y §«Information
   architecture & navigation` · `docs/TEST_SCRIPTS.md`.
4. En `docs/ROADMAP.md`, el **cierre de M0**: su limpieza se hizo **después**
   de correr en producción y **con auditoría pre-borrado**. Ese precedente
   gobierna este stage (D‑M9.1).

---

## 1. Qué es M9 (y qué NO)

M9 cierra el bloque: **barrido final**, **borrado de lo que probadamente
sobra**, **documentos de autoridad puestos al día** y **la batería completa**
que exige la casa para un stage grande.

**Fuera de alcance:** funcionalidad nueva de cualquier tipo · **cero
migraciones** · cero dependencias npm · y —lo más importante— **el borrado del
shell viejo y su flag, que NO ocurre en este stage** (D‑M9.1).

---

## 2. Decisiones vinculantes

- **D‑M9.1 · EL CIERRE ES EN DOS ACTOS, y este stage es sólo el primero.**
  Borrar el shell viejo y `KIPU_SHELL` elimina el único camino de vuelta que
  tiene el founder, y su pasada de revisión **todavía no ocurrió**. Este
  proyecto ya resolvió exactamente esta situación en M0: la limpieza del
  planner se hizo **después** de correr en producción y **con auditoría
  pre-borrado**. Se repite el patrón:
  - **Acto 1 (este stage):** todo lo no destructivo, más una **auditoría
    pre-borrado** que deje demostrado —no supuesto— qué quedaría huérfano el
    día que se borre.
  - **Acto 2 (después de la pasada del founder y de uso real):** borrar el
    shell viejo, el flag, `AppNav`/`PARENT_TAB` y su esqueleto legacy, en un
    commit propio, con la auditoría del Acto 1 como evidencia.
  Si el founder ordena borrar ya, se hace; pero **no se decide desde aquí**.
- **D‑M9.2 · Los redirects retirados sobreviven; sus `loading.tsx`, no.**
  `/app/margen`, `/app/readiness`, `/app/precision` y `/app/reality` protegen
  enlaces viejos y siguen siendo redirects. Pero cada uno arrastra un
  `loading.tsx` que dibuja un esqueleto para una ruta que **sólo redirige**:
  eso sí es peso muerto y se va.
- **D‑M9.3 · `/app/cashflow` pasa a redirect a `/app/mes`.** Está huérfano
  desde M6 y `M_DESIGN_002` ya decidió que lo absorben «Tu mes» y «Lo que
  viene». Un redirect conserva cualquier enlace viejo sin dejar una superficie
  sin puerta.
- **D‑M9.4 · Los documentos de autoridad se actualizan SÓLO donde el bloque
  los volvió falsos.** Hoy mienten en cosas concretas y verificadas:
  - `PRODUCT_SPEC.md`: el quipu como héroe (`:38`, `:117`, `:129`, `:512`) y
    la navegación de «four sections / bottom tab bar» (`:530-533`).
  - `CLAUDE.md:55` y `AGENTS.md:261`: el tanque «renderizado como un quipu
    vertical».
  - `ROADMAP.md`: el Bloque M como activo y el hallazgo «CERO accesos
    alcanzables» (`:1931`), que **M6 cerró**.
  No reescribas la doctrina financiera ni las reglas de dinero: **sólo la cara
  del producto que cambió**. El quipu no desaparece del expediente: pasa a ser
  historia (fue el héroe del Bloque D) y sobrevive como identidad en los
  indicadores del carrusel y en el cordón de perspectiva.
- **D‑M9.5 · El barrido es por CONTEXTO, jamás find/replace** (lección J‑6, ya
  aplicada en M7): cada aparición se lee y se decide. El framing semanal que
  es **cadencia elegida** sigue vivo.
- **D‑M9.6 · Sólo se borra lo probadamente no referenciado.** Nada de «esto
  parece muerto». Cada borrado va con su prueba de cero referencias.
- Siguen firmes: constitución `M_DESIGN_001 §10` y las prohibiciones vigentes
  con la corrección de `M7_SPEC §4.1`.

---

## 3. Contrato técnico

### 3.1 Barrido final

Recorre `src/` y `docs/` buscando lo retirado: Pulso, Flexibilidad, Precisión,
Realidad, los estados nombrados, «colchón», la marca «Margen» como cara del
producto y el framing semanal que enmarca. Para cada aparición: **contexto,
decisión y razón**. El trinquete del gate puede bajar; nunca subir.

### 3.2 Borrado seguro (lo que sí se va ahora)

Con prueba de cero referencias por cada uno:
- `GoalPlanCard.tsx` (huérfano desde antes del bloque).
- Los cuatro `loading.tsx` de los redirects (D‑M9.2).
- `saldoStale` en `margen-kipu.ts:201`: campo **declarado y jamás asignado**;
  la niebla real se resuelve por `KipuSaldoUnavailableError` desde M1. Es
  residuo de C6 y su presencia sugiere una garantía que no existe. Bórralo
  **sólo si nadie lo lee** (compruébalo).
- Cualquier otro residuo que encuentres, con la misma vara.

**No se toca** en este stage: el shell viejo, `KIPU_SHELL`, `AppNav`,
`PARENT_TAB`, `LegacyDashboardSkeleton` ni el camino `legacy` de `page.tsx`.

### 3.3 Auditoría pre-borrado (el entregable que habilita el Acto 2)

Un documento `docs/design/stages/M9_PREDELETE_AUDIT.md` que deje **probado**:
- qué archivos, exports y rutas quedarían huérfanos al borrar el shell viejo;
- qué anclajes del gate se caerían y cuáles habría que re-anclar;
- qué depende hoy de `KIPU_SHELL` y qué pasa cuando la variable desaparece;
- qué NO se puede borrar aunque lo parezca, y por qué.
Con esto, el Acto 2 se ejecuta leyendo, no investigando.

### 3.4 Documentos de autoridad

Actualiza `PRODUCT_SPEC.md`, `CLAUDE.md`, `AGENTS.md` y la sección del Bloque M
de `ROADMAP.md` en los puntos de D‑M9.4. La navegación descrita debe ser la
real (santuario + dos hojas + superficies de detalle), el héroe debe ser el
orbe, y el hallazgo de las puertas debe constar **cerrado**.

### 3.5 La batería completa

Es un stage grande: corre y pega **todo**.
- `lint`, `build`, captura por **los dos runners**, y el harness de mutaciones.
- **E2E de persona desechable** con residuo cero.
- **`docs/TEST_SCRIPTS.md` actualizado y recorrido**: la QA por comportamiento
  tiene que describir el producto que existe hoy. Si un guion quedó obsoleto,
  reescríbelo; si falta uno para el santuario, la hoja de diálogo, la voz o la
  perspectiva, agrégalo.
- **Pasada de red team visual sobre los estados honestos**: niebla, día‑1,
  lectura caída, sin conexión, reserva sin objetivo, cordón con huecos, recibo
  incompleto y patrimonio negativo. Cada uno debe seguir diciendo la verdad.

---

## 4. Prohibiciones duras

1. **No borrar el shell viejo, el flag ni su nav** (D‑M9.1).
2. Cero migraciones, cero dependencias, cero funcionalidad nueva.
3. Nada de find/replace sobre vocabulario (D‑M9.5).
4. Ningún borrado sin prueba de cero referencias (D‑M9.6).
5. No debilitar aserciones; cada substring anclado aparece **exactamente una
   vez**.
6. No reescribir doctrina financiera en los documentos de autoridad: sólo la
   cara del producto (D‑M9.4).
7. No commits en `main`, no merge, no deploy.

---

## 5. Criterios de aceptación (Z1–Z16)

- **Z1** El shell viejo, `KIPU_SHELL`, `AppNav`/`PARENT_TAB` y el esqueleto
  legacy **siguen intactos** (D‑M9.1).
- **Z2** Existe `M9_PREDELETE_AUDIT.md` con las cuatro respuestas de §3.3,
  cada una probada.
- **Z3** Barrido final entregado como tabla contexto/decisión/razón; el
  trinquete de vocabulario **baja o queda igual**, nunca sube.
- **Z4** Los `/semana` que son cadencia siguen vivos (no-regresión de M7).
- **Z5** `GoalPlanCard`, los cuatro `loading.tsx` de redirects y —si nadie lo
  lee— `saldoStale` borrados, **cada uno con su prueba de cero referencias**.
- **Z6** Los cuatro redirects retirados siguen funcionando.
- **Z7** `/app/cashflow` redirige a `/app/mes` y ninguna superficie queda sin
  puerta (las nueve de M6 siguen alcanzables).
- **Z8** `PRODUCT_SPEC.md` describe la navegación real y el orbe como héroe;
  el quipu queda como historia e identidad, no como héroe.
- **Z9** `CLAUDE.md` y `AGENTS.md` corregidos en el punto del quipu, **sin
  tocar** doctrina financiera.
- **Z10** `ROADMAP.md`: Bloque M con su estado real y el hallazgo de las
  puertas **marcado cerrado**.
- **Z11** `TEST_SCRIPTS.md` actualizado y recorrido; incluye guiones para
  santuario, diálogo, voz y perspectiva.
- **Z12** Red team visual de los ocho estados honestos, con su resultado.
- **Z13** No-regresión M1–M8 completa.
- **Z14** **E2E** en verde con residuo cero; salida pegada.
- **Z15** Gates verdes por los dos runners + **harness de mutaciones completo**
  en verde; salidas pegadas.
- **Z16** Una mutación propia por cada aserción nueva, muriendo por su nombre.

---

## 6. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M9): …` / `chore(M9): …`.
- Reporte `M9_REPORT.md` con el template de `M1_SPEC §9`, autochequeo Z1–Z16, y
  tres secciones propias: **«Barrido final»** (tabla),
  **«Borrados y su prueba»** y **«Qué queda para el Acto 2»**.

## 7. Definición de HECHO

Z1–Z16 verificados, batería completa pegada, `M9_PREDELETE_AUDIT.md` escrito, y
VERDE del auditor en `M9_AUDIT.md`. **Con eso el Bloque M queda cerrado en su
Acto 1** y la pelota pasa al founder: su pasada, y después el Acto 2.
