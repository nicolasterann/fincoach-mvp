# M1_SPEC — Stage M1 «Cimientos» del Bloque M (prompt ejecutable para Codex)

- **Fecha:** 2026-08-24 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, chat nuevo de implementación del front
- **Estado del repo esperado:** `main` en `cd430f8` o posterior; M0 CERRADO;
  Bloque M es el único bloque activo (`docs/ROADMAP.md`).
- **Este documento es la orden de trabajo completa del stage M1.** No hagas
  nada fuera de él. Si algo es ambiguo o imposible tal como está escrito,
  NO improvises: escribe la pregunta en tu reporte (§9) y detente.

---

## 0. Lectura obligatoria antes de escribir código

En este orden, del repo:

1. `CLAUDE.md` y `AGENTS.md` (los leés siempre — reglas de la casa).
2. `docs/design/M_DESIGN_001_VISION_FIRST_PRINCIPLES_2026-08-18.md` — la
   visión (P1–P8, R1–R6, constitución §10).
3. `docs/design/M_DESIGN_002_DECISIONES_2026-08-18.md` — decisiones D1–D7 +
   iteraciones v2–v5 del mock (jerarquía visual, dos zonas, pill fija).
4. `docs/design/M_DESIGN_003_AUDITORIA_PREIMPLEMENTACION_2026-08-24.md` —
   la auditoría: correcciones C1–C7, decisiones D8–D15, plan M1–M9.
5. `docs/design/prototypes/orbe-kipu.html` — el mock v5, norte visual de
   composición. **Es el techo, no la vara**: M1 NO incluye el shader.
   **Renderizarlo NO es requisito** (ver §11, addendum del 2026-08-24): la
   composición medida está transcrita ahí con valores exactos. Si tu entorno
   puede abrirlo, mejor; si no puede, §11 lo sustituye por completo y no es
   motivo de bloqueo. Nunca eludas una política de tu entorno para verlo.

## 1. Qué es M1 (y qué NO es)

M1 construye **el esqueleto navegable del santuario** detrás de un flag de
entorno, con números 100% del motor y un orbe ESTÁTICO honesto (sin WebGL).
El founder debe poder vivir en el front nuevo desde este stage, con rollback
instantáneo al viejo.

**Fuera de alcance de M1 (lo hacen stages posteriores — no lo adelantes):**
shader WebGL (M2) · reconstrucción del chat y recibos verificados (M3) ·
pill con prioridades/pendientes y cámara/voz reales (M4–M5) · módulos de
perspectiva (M6) · re-vestir páginas de detalle (M7) · PWA/iconos/SW (M8) ·
borrar el shell viejo (M9) · **apertura D7 por capa con histéresis**
(diferida: requiere el hecho «cruce vigente del ciclo» como lectura del
motor, que hoy no existe; M1 abre SIEMPRE en Saldo) · **cero migraciones**.

## 2. Decisiones vinculantes (no se re-litigan en el código)

- **D1** PWA-first, web mobile-first; **D3** carrusel de 5 orbes: Saldo ·
  Reserva · Metas (unifica metas+ahorro+inversión) · Patrimonio · Deuda, en
  ese orden; **D4** cero scores compuestos; **D6** onboarding intacto.
- **D8** Deuda: la cifra grande es lo que falta pagar; si existe denominador
  honesto (cobertura del ciclo), el subtítulo lo dice («Ciclo cubierto 62% ·
  te faltan 760$»); si no, cifra sola. Jamás líquido creciente de deuda.
- **D10** Flag de convivencia `KIPU_SHELL` (espejo del patrón
  `KIPU_AGENT_MODE`): `legacy` (default) | `orbe`. Env-only, server-side.
- **D11** Desktop v1 = columna centrada tipo teléfono (max-width ~430px para
  el shell). Sin sidebar en el santuario.
- **D12** Tipografía: **Geist se queda** (SF Pro no existe en Android). Cifras
  grandes: Geist Sans, `tabular-nums`, tracking cerrado. Recibos/datos:
  Geist Mono (la voz del ledger).
- **D13** El toggle de moneda display NO vive en el santuario (queda en las
  superficies viejas hasta M7); el santuario muestra la moneda display del
  perfil vía el formateador existente.
- **D15** Estados día-1: un orbe sin datos es una PUERTA, no un vacío triste
  (copy §5.4). Nunca un porcentaje inventado.
- **Constitución M_DESIGN_001 §10 completa** — en particular: UN número, UNA
  frase, UNA cinta, UN dock; el número jamás sobre vidrio refractivo; niebla
  honesta; «colchón» prohibido; consumer-facing siempre «Kipu».

## 3. Contrato técnico

### 3.1 Flag y convivencia

- `src/lib/shell-mode.ts` (nuevo): `type ShellMode = "legacy" | "orbe"`;
  `getShellMode(): ShellMode` lee `process.env.KIPU_SHELL` (default
  `legacy`, valores desconocidos ⇒ `legacy` con `console.warn` una vez).
  Agregar `KIPU_SHELL` a `.env.example` con comentario de una línea.
- `src/app/app/page.tsx`: si `orbe`, renderiza `<SantuarioShell …/>` con el
  payload de §3.2; si `legacy`, el JSX actual EXACTO (no lo refactorices más
  allá de extraer el branch — el diff del camino legacy debe ser mínimo).
- `src/app/app/layout.tsx` + `AppNav`: con `orbe` y ruta `/app`, ni bottom
  bar ni sidebar (el santuario ES la navegación); en el resto de rutas la
  nav actual queda intacta (costura conocida durante la transición: los
  detalles se abren con su look viejo — se re-visten en M7). `AppNav` ya
  conoce el pathname; recibe `shellMode` como prop desde el layout.

### 3.2 El payload: UNA lectura, formateada en servidor

**Regla de oro (doctrina same-saldo): el cliente NO calcula dinero.** Todo
número llega formateado desde el servidor; el cliente solo pinta.

- `src/app/app/components/shell/shell-payload.ts` (nuevo, server-only):
  `buildShellPayload(userId): Promise<ShellPayload>` que llama UNA vez la
  cadena existente (`buildUserFinancialContext` → `deriveAdvisorySnapshot` →
  `buildCoachingBriefing({ surfaceNudges: false })`) — exactamente una
  llamada al briefing por carga, igual que el home actual — más la lectura
  ya existente de movimientos recientes (reusa el select del home o
  `describeMovement`). Formatea con `makeDisplayFormatter` (respeta
  displayCurrency) y `formatDateEs`.
- Si la cadena lanza `KipuSaldoUnavailableError` ⇒ `status: "niebla"` (NO
  re-lances al error boundary, NO muestres un número viejo como «ahora»).
  Cualquier otro error sí propaga al boundary actual.

```ts
type ShellStatus = "ok" | "niebla";
type OrbKind = "saldo" | "reserva" | "metas" | "patrimonio" | "deuda";

interface ShellOrb {
  kind: OrbKind;
  amountLabel: string | null;   // "82,40$" — null = sin dato (día-1)
  amountRaw: number | null;     // para aria-label
  subtitle: string;             // §5.2
  level: number | null;         // 0..1 SOLO con denominador honesto; null = sin línea de agua
  levelNote: string | null;     // p.ej. "Ciclo cubierto 62%" (Deuda) — null si no aplica
  emptyInvite: string | null;   // copy D15 cuando el orbe está vacío/día-1
}

interface ShellPayload {
  status: ShellStatus;
  orbs: ShellOrb[];             // los 5, SIEMPRE, en orden D3
  pillLine: string | null;      // v0 = próximo pago (s.nextPayment) formateado; null si no hay
  lastMovement: { timeLabel: string; label: string; amountLabel: string } | null;
  runwayLine: string | null;    // modo runway (semántica Bloque D, como el home actual)
  greetingName: string | null;
}
```

Fuentes por orbe (SOLO lecturas del motor que ya existen — si un campo no
está disponible en el briefing, el orbe degrada según §5.3 y lo anotas en el
reporte como hueco; PROHIBIDO derivar dinero nuevo en UI o tocar
`src/lib/financial/**`):

| Orbe | amount | level (denominador honesto) |
|---|---|---|
| Saldo | `mk.saldo.saldo` | `saldo/cap` si `cap > 0`; null si no |
| Reserva | `mk.saldo.reserva` | null (no existe objetivo declarado de Reserva como hecho del motor) |
| Metas | Σ capas `metas` + `ahorro_inversion` de `mk.saldo.layers` | null en M1 |
| Patrimonio | capa `patrimonio` de `layers` (ausente ⇒ null) | null SIEMPRE (crece, no se llena) |
| Deuda | `briefing.debtHealth.totalDebt` | cobertura del ciclo SOLO si el briefing ya expone `statement_covered`/`statement_total_due` agregables sin lectura nueva; si no ⇒ null y hueco anotado |

### 3.3 El shell (cliente)

- `src/app/app/components/shell/SantuarioShell.tsx` (nuevo, `"use client"`)
  + los subcomponentes que necesites en `components/shell/`. Es la PRIMERA
  isla cliente del dashboard: mantenla chica (sin librerías nuevas — regla
  de la casa: no agregar paquetes).
- **Composición** (mock v4/v5 — dos zonas): zona de LECTURA que viaja con el
  carrusel (tabs de capas + orbe + cifra + subtítulo + pill) y zona de
  ACCIÓN fija abajo (cinta + dock). Jerarquía: cifra 1º (≈56–58px) · pill 2º
  (caja de ALTO FIJO ~46–52px, solo cambia el texto) · cinta 3º (una línea,
  sin caja, estructura `hora-mono · comercio · monto`) · dock.
- **Orbe estático v1:** SVG/CSS — círculo de vidrio sutil con línea de agua
  plana al `level` y tinte del acento de capa; `level: null` ⇒ esfera
  tintada SIN línea de agua (nada de niveles inventados); en `niebla` ⇒
  bruma + «No puedo leer tu saldo ahora» + botón reintentar (recarga). Una
  animación permitida: respiración lenta (~6s) del halo, con
  `prefers-reduced-motion` ⇒ estática. **La cifra vive FUERA del vidrio.**
- **Carrusel:** 5 páginas, scroll-snap horizontal (CSS `scroll-snap-type`,
  sin librería). Dobles visibles (P6): tabs de capas tappables arriba +
  indicadores tipo nudo en cordón. Abre SIEMPRE en Saldo. Swipe = atajo;
  taps = camino primario.
- **Puertas (cierra el hallazgo del roadmap YA):** tap en el orbe/cifra abre
  el detalle de su capa: saldo→`/app/saldo` · reserva→`/app/saldo` ·
  metas→`/app/goals` · patrimonio→`/app/wealth` · deuda→`/app/debt`. Asa
  superior visible («Cómo vas» + chevron) ⇒ abre una hoja simple (lista de
  links, v0 de perspectiva): Tu mes→`/app/mes` · Gasto→`/app/spending` ·
  Cuentas→`/app/cuentas` · Actividad→`/app/activity` · Tu Kipu→
  `/app/settings`. Con esto `/app/debt`, `/app/wealth` y `/app/spending`
  quedan alcanzables por primera vez.
- **Dock v1:** input real («Anota un gasto o pregúntame…») + botones mic y
  cámara + enviar. Enviar/tap del input ⇒ navega a `/app/chat` con el texto
  como prefill vía el mecanismo `?share=` EXISTENTE (jamás auto-envía —
  contrato de seguridad vigente). Cámara ⇒ `/app/chat` (el attach ya vive
  ahí). Mic ⇒ deshabilitado honesto: tooltip/pill «Pronto — por ahora
  mándame una nota de voz por Telegram». NO toques `ChatView.tsx` (sus
  anchors del gate se actualizan en M3, no aquí).

### 3.4 Tokens (additivos en `globals.css`)

Variables nuevas bajo el sistema existente (dark default + override en
`[data-theme="light"]`), SIN romper tokens actuales:
`--layer-saldo/--layer-reserva/--layer-metas/--layer-patrimonio/--layer-deuda`
(acentos por capa, alineados a la paleta semántica vigente:
emerald/sky/violet/teal-cristal/ámbar) · `--good/--watch/--over` (semáforo
del mock v2: verde/ámbar/coral, ajustado para AA en ambos temas) · los
keyframes nuevos que necesites con el prefijo `kipu-` y cobertura en el
bloque `prefers-reduced-motion` existente.

### 3.5 Harness de QA visual

`src/app/dev/shell-preview/page.tsx` (nuevo, patrón `ui-preview`, `notFound()`
en prod salvo allowlist como el resto de `/dev`): renderiza `SantuarioShell`
con payloads SINTÉTICOS: normal · saldo en cero («vacío hasta mañana») ·
runway · niebla · día-1 (todo vacío con invitaciones) · deuda con y sin
denominador. Es donde el founder y el auditor ven estados que los datos
reales no producen a demanda.

## 4. Prohibiciones duras de este stage

1. NO tocar: `supabase/**`, `src/lib/supabase-*`, auth/login/middleware,
   `src/app/api/telegram/**`, `src/lib/ai/agent/**`, `src/lib/ai/kipu-agent-*`,
   writers/stores, `src/lib/financial/**` (solo LECTURA de tipos/valores),
   `ChatView.tsx`, `onboarding/**`, `/dev/capture-test`.
2. NO recalcular dinero en el cliente; NO fabricar denominadores; NO
   optimistic UI en dinero.
3. NO agregar dependencias npm. NO migraciones. NO borrar nada del shell
   viejo (eso es M9).
4. NO commits en `main`; NO merge; NO deploy.
5. Copy en español LatAm, voz Kipu (cercana, cero culpa); «colchón» y todo
   vocabulario retirado prohibidos (el gate los vigila).

## 5. Copy v0 (reemplazable por la voz del agente en stages futuros)

- **5.1 Saludo/estado:** sin saludo de texto en el santuario (la cifra ES el
  saludo). `runwayLine` reutiliza el copy actual del home.
- **5.2 Subtítulos:** Saldo «Disponible hoy» · Reserva «Tu respaldo» · Metas
  «Por aportar este mes» · Patrimonio «Ya invertido» · Deuda «Te falta
  pagar» (+ `levelNote` «Ciclo cubierto X%» cuando exista denominador).
- **5.3 Degradaciones:** dato ausente pero cuenta legible ⇒ cifra `0$` solo
  si el motor lo AFIRMA; lectura no publicable ⇒ niebla global (§3.2).
- **5.4 Día-1 / vacíos (`emptyInvite`):** Metas sin metas ⇒ «¿Armamos tu
  primera meta? Cuéntame qué sueñas.» · Deuda sin deudas ⇒ «Sin deudas
  registradas. Si tienes una tarjeta, dímelo y la cuidamos juntos.» ·
  Patrimonio vacío ⇒ «Cuando inviertas o ahorres a largo plazo, esto crece
  contigo.» · Reserva en cero ⇒ «Tu respaldo se construye solo, mes a mes.
  Pregúntame cómo.» — Saldo en cero SIN cruce ⇒ «Vacío hasta mañana —
  vuelven {fillDaily} al amanecer.»

## 6. Criterios de aceptación (la auditoría verifica EXACTAMENTE esto)

- **A1** `KIPU_SHELL` ausente/`legacy` ⇒ el home actual byte-idéntico en
  comportamiento; `orbe` ⇒ santuario. Flip en caliente = rollback.
- **A2** Same-saldo: la cifra del orbe Saldo == `/app/saldo` == lo que el
  chat cita, mismo usuario mismo instante (misma fuente, cero derivaciones).
- **A3** UNA sola llamada a `buildCoachingBriefing` por carga del santuario
  (se verifica por lectura de código).
- **A4** Niebla: con `KipuSaldoUnavailableError` simulada (harness), el
  shell muestra niebla + reintentar; JAMÁS un número inventado o viejo.
- **A5** Los 5 orbes en orden D3 con valores del motor; Deuda cumple D8;
  ningún `level` sin denominador honesto (Reserva/Metas/Patrimonio sin
  línea de agua en M1).
- **A6** Puertas: desde el santuario se llega a saldo, goals, wealth, debt,
  mes, spending, cuentas, activity, settings y chat. (`/app/debt`,
  `/app/wealth`, `/app/spending` alcanzables por primera vez.)
- **A7** P6: todo gesto tiene doble tappable; carrusel opera con taps
  solamente; targets ≥44px.
- **A8** Dock: enviar prefill a `/app/chat` sin auto-enviar; cámara ruta al
  chat; mic honesto «pronto»; `ChatView.tsx` sin tocar.
- **A9** Día-1: harness muestra los 5 vacíos con invitaciones §5.4; cero
  porcentajes inventados.
- **A10** Temas: dark y light AA (cifra, subtítulo, pill, cinta, tabs);
  tokens nuevos definidos en ambos temas.
- **A11** `prefers-reduced-motion`: cero animación, estado final correcto.
- **A12** A11y: orbe con `aria-label` («Saldo disponible: 82 dólares con 40,
  tanque al 64 por ciento» — nivel solo si existe), asas y tabs como
  botones, focus visible.
- **A13** Gates verdes: `npm run lint` · `npm run build` · gate de captura
  (826/826, sin anchors tocados) — outputs pegados en el reporte.
- **A14** Cero dependencias nuevas, cero migraciones, cero cambios fuera de
  la lista §3 + `globals.css` + `.env.example` + los archivos nuevos.

## 7. Rama y commits

- Rama: **`stage-m-front`** cortada de `main` actual. Todo M1 vive ahí.
- Commits chicos, mensaje `feat(M1): …` / `chore(M1): …`. El founder
  mergea SOLO después del veredicto VERDE del auditor.

## 8. Protocolo de comunicación (el repo es el canal)

Tú y el auditor (Claude) NO comparten chat. Se hablan por archivos con
nombre fijo en `docs/design/stages/`; el founder solo transporta señales
(«listo», «audita», «corrige»), nunca contenido.

1. **Spec** (`M1_SPEC.md`, este archivo): lo escribe el auditor. NO lo
   edites jamás.
2. **Reporte** (`M1_REPORT.md`): lo escribes TÚ al terminar, formato §9.
   Append-only: cada iteración agrega una sección `## Ronda N`, nunca
   reescribe rondas anteriores.
3. **Auditoría** (`M1_AUDIT.md`): la escribe el auditor. Contiene veredicto
   VERDE/ROJO y, si rojo, **órdenes numeradas O1, O2…**. Cuando el founder
   te diga «corrige M1», lees la última ronda de `M1_AUDIT.md`, ejecutas las
   órdenes, y agregas tu `## Ronda N+1` al reporte respondiendo orden por
   orden (`O1: hecho — <commit> — <cómo verificarlo>`).
4. **Dudas bloqueantes:** sección `## Preguntas` en tu reporte + STOP. No
   improvises sobre ambigüedad.
5. Prohibido para ambos: editar los archivos del otro; declarar verde sin
   pegar la salida real de los comandos.

## 9. Template del reporte (`M1_REPORT.md`)

```markdown
# M1_REPORT — Ronda 1
- Rama/commits: stage-m-front · <shas>
- Estado: LISTO PARA AUDITORÍA | BLOQUEADO (ver Preguntas)

## Qué se construyó
<mapa de archivos nuevos/modificados, 1 línea por archivo>

## Decisiones tomadas dentro del spec
<solo las que el spec dejaba abiertas; con razón>

## Desviaciones del spec
<qué + por qué; "ninguna" si no hay>

## Huecos honestos
<p.ej. "Deuda sin denominador: el briefing no expone cobertura de ciclo agregable">

## Autochequeo A1–A14
<tabla: criterio · cómo lo probaste · resultado>

## Gates (salida real pegada)
lint / build / capture — tails de las corridas

## Cómo verlo (guía de QA manual)
<pasos exactos: flag, rutas, harness /dev/shell-preview, qué mirar>

## Preguntas
<numeradas, o "ninguna">
```

## 10. Definición de HECHO para M1

M1 está hecho cuando: A1–A14 verificados por ti, gates verdes con salida
pegada, reporte escrito, y el auditor emite VERDE en `M1_AUDIT.md`. Después
de eso NO arranques M2: el spec M2 llegará como archivo nuevo cuando el
founder lo ordene.

---

## 11. ADDENDUM (2026-08-24) — Composición medida del mock

**Por qué existe:** en la Ronda 1 el entorno de Codex bloqueó por política la
apertura de `file://`, y el §0 pedía renderizar el mock. La respuesta correcta
no es que Codex eluda su política ni que «adivine desde el HTML»: es que el
auditor —que SÍ vio el mock renderizado, recorrió sus 5 capas, los dos temas,
el panel de estados y el nivel diálogo— transcriba aquí los valores exactos.
**Con §11, ver el mock deja de ser prerrequisito de cualquier stage.**

Todos los valores de abajo están LEÍDOS del CSS de `orbe-kipu.html`, no
estimados. Adáptalos al sistema de la app (Tailwind v4 + tokens de
`globals.css`), no los copies como CSS suelto.

### 11.1 Paleta base por tema

| Token | Noche (default) | Día |
|---|---|---|
| fondo / fondo profundo | `#060A10` / `#02050A` | `#EDF2F6` / `#DFE8EE` |
| tinta 1 / 2 / 3 | `#ECF4F8` / `#93AAB9` / `#566B7B` | `#08131C` / `#44596A` / `#7C91A0` |
| vidrio / vidrio-2 | `rgba(18,29,41,.5)` / `rgba(24,37,51,.7)` | `rgba(255,255,255,.6)` / `rgba(255,255,255,.84)` |
| línea de vidrio / brillo | `rgba(170,210,235,.11)` / `rgba(255,255,255,.13)` | `rgba(8,25,38,.09)` / `rgba(255,255,255,.92)` |
| tarjeta / cordón | `rgba(19,29,40,.66)` / `rgba(140,175,195,.24)` | `rgba(255,255,255,.78)` / `rgba(14,45,66,.18)` |
| sombra | `0 18px 42px -20px rgba(0,0,0,.92)` | `0 16px 34px -18px rgba(16,42,60,.34)` |
| **semáforo** `good/watch/over` | `#35E39A` / `#FFC96B` / `#FF7C6B` | `#12B87C` / `#D9922B` / `#E05F4F` |

El semáforo día NO es el mismo hex que noche: el mock ya lo oscurece para
contraste sobre fondo claro. Respeta esa separación al crear
`--good/--watch/--over` (§3.4) y verifica AA en ambos temas (A10).

### 11.2 Acento por capa (`--layer-*` de §3.4)

| Capa | Líquido | Profundo | Acento noche | Acento día |
|---|---|---|---|---|
| Saldo | `#2FE3C4` | `#07564F` | `#4FEAD2` | `#0B8B78` |
| Reserva | `#5B8CFF` | `#152C86` | `#87ABFF` | `#2A55CC` |
| Metas | `#A97BFF` | `#3A1E7E` | `#C0A2FF` | `#6A3FD4` |
| Patrimonio | `#8FCFEC` | `#0F3350` | `#BFE6F8` | `#256B8C` |
| Deuda | `#FF9A5C` | `#6B2E0C` | `#FFBD8E` | `#A2551D` |

El **acento** es el color de textos/detalles (el que debe pasar AA); el
**líquido** es el relleno del orbe; el **profundo** es el fondo del líquido
(en M1, un gradiente vertical líquido→profundo basta y se ve bien).

### 11.3 Geometría y tipografía (valores medidos)

- **Cifra:** `clamp(34px, 7cqh, 58px)`, weight 600, `letter-spacing:-.038em`,
  `line-height:1`, `tabular-nums`, color tinta-1. En el mock la unidad es
  `cqh` del marco de teléfono; en la app real usa la altura del viewport
  (equivalente práctico: `clamp(34px, 7svh, 58px)`). **Fuente: Geist Sans**
  (D12 manda sobre el `SF Pro Display` del mock).
- **Cifra en niebla:** `clamp(16px,3cqh,20px)`, weight ~520, tinta-2,
  `max-width:17ch`, `line-height:1.35` — la frase de niebla ocupa el lugar
  del número, más chica y en dos líneas máximo.
- **Subtítulo:** `12.5px`, tinta-2. Gap cifra↔subtítulo: `2px` (van juntos
  como un bloque, centrados).
- **Pill:** caja FIJA `height:46px`, `max-width:300px`, `width:100%`,
  `padding:9px 15px`, `border-radius:18px`, fondo vidrio + borde línea-vidrio,
  `font-size:13px` tinta-2 (los números en negrita usan tinta-1 weight 600),
  `line-height:1.45`, texto alineado a la IZQUIERDA. Punto de color: `5.5px`
  con el acento de la capa. Cambio de texto = fundido de opacidad `.35s`
  (la caja nunca se mueve). Variante «pregunta pendiente»: borde con el
  acento al 42%.
- **Cinta (recibo):** grid `auto 1fr auto`, `gap:11px`, `padding:11px 14px`,
  `border-radius:15px`, fondo tarjeta + borde línea-vidrio. Columnas: hora en
  **mono 11px** tinta-3 · descripción `13px` tinta-1 con elipsis · monto en
  **mono 13px** con el acento de capa, `tabular-nums`. Entrada: `translateY(7px)`
  + opacidad, `.5s`. (Mono = **Geist Mono**, la voz del ledger.)
- **Dock:** `border-radius:999px`, `padding:6px 6px 6px 14px`, `gap:6px`,
  fondo vidrio-2 + borde. Input `13.5px`. Botones circulares de `33px`
  (mic, cámara) y el de enviar con fondo del líquido de la capa. En la app
  real los targets deben llegar a **44px** de área tappable (A7): agranda el
  área con padding sin agrandar el círculo visible.
- **Chips de capa (tabs):** `padding:6.5px 11px`, `border-radius:999px`,
  `font-size:11.5px` weight 500; inactivo tinta-3 sin borde; activo tinta-1
  con fondo vidrio + borde. Fila centrada, scroll horizontal sin scrollbar.
- **Cordón (indicadores):** SVG `120×14px` centrado, `margin-top:8px`: una
  línea horizontal del color cordón con 5 nudos; el nudo activo toma el
  acento de la capa y crece. (Es la identidad quipu, D2 pendiente — mantenlo
  como componente separable en un archivo propio para poder retirarlo en una
  sola pasada.)
- **Asa superior:** grip de `34×3.5px` radio completo + rótulo en `10px`
  `letter-spacing:.15em` MAYÚSCULAS tinta-3 + chevron de `10px`. En el mock
  dice «SALUD FINANCIERA»; **en M1 usa «CÓMO VAS»** (§3.3).
- **Orbe:** `width:min(70cqw, 34cqh)`, `aspect-ratio:1` (en la app:
  `min(70vw, 34svh)`), con halo radial exterior del color de capa
  (`blur(20px)`, opacidad ~.20 al centro) y una «sombra de piso» elíptica
  debajo (`bottom:-13%`, `blur(9px)`). Niebla: `grayscale(.9) blur(3px)
  opacity(.45)` sobre el orbe y halo casi apagado (.12).

### 11.4 Esqueleto de la pantalla (orden vertical exacto)

```
[safe-area-top + 8px]
  ASA (grip · CÓMO VAS · chevron)        ← zona fija superior
  CHIPS de capa (5)                       ← zona fija superior
  CORDÓN de 5 nudos
  ─────── track del carrusel (flex:1) ───────
    slide centrado verticalmente, gap ~1.4cqh+4px, padding lateral 22px:
        ORBE
        CIFRA
        SUBTÍTULO
        PILL            ← viaja CON el carrusel (pertenece al número)
  ───────────────────────────────────────────
  CINTA (recibo)                          ← zona de acción, FIJA
  DOCK                                    ← zona de acción, FIJA
[padding-bottom 12px + safe-area-bottom]
```

Las dos zonas son la corrección v4 del founder: **lectura** (cifra→subtítulo→
pill) se desliza con la capa; **acción** (cinta→dock) queda quieta abajo.

### 11.5 Movimiento permitido en M1 (y sólo esto)

- Deriva del orbe: ciclo de **23s**, `translate ±1,3%` y `scale ±0,7%`
  (mock: `floatOrb`). Es lo que hace que «esté vivo» sin shader.
- Respiración del halo ~6s (§3.3).
- Cambio de capa: transición del acento/aura `~.9s`; el track del carrusel
  con `cubic-bezier(.22,.61,.24,1)`.
- Fundido del texto de la pill `.35s`; entrada de la cinta `.5s`.
- Aura de fondo: dos gradientes radiales por capa con deriva de 22–33s
  (opcional en M1 — si lo haces, cuesta poco y suma mucho; en modo día el
  mock lo baja a opacidad .42 con `mix-blend-mode:multiply`).
- **Todo lo anterior desaparece bajo `prefers-reduced-motion` (A11).**
  Nada de cáusticas, motas, refracción ni corona de voz: eso es M2/M5.

### 11.6 Lo que del mock NO se copia

- El marco de teléfono, el panel «Guion», los botones «Modo día/Guion» del
  escenario: son andamios del prototipo, no producto.
- `SF Pro Display` → Geist (D12). `system-ui` → la fuente de la app.
- El shader WebGL entero → M2.
- Los módulos de perspectiva (anillos, barras, cordón de 18 días) → M6. En
  M1 el asa abre sólo la hoja de links (§3.3).
- El nivel diálogo del mock (burbujas, recibos en el hilo) → M3. En M1 el
  dock navega a `/app/chat` existente.
