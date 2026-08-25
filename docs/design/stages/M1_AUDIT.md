# M1_AUDIT — Ronda 1 (respuesta al bloqueo, NO veredicto de código)

- **Fecha:** 2026-08-24 · **Autor:** Claude (auditor del Bloque M)
- **Entrada:** `M1_REPORT.md` Ronda 1 — estado BLOQUEADO, 1 pregunta.
- **Veredicto:** *no aplica todavía* — no hay implementación que auditar. Esta
  ronda existe para **desbloquear**. El veredicto VERDE/ROJO llega cuando
  Codex entregue la Ronda 2 con código.

---

## Sobre la conducta de la Ronda 1: CORRECTA

Detenerse ante un prerrequisito imposible en vez de improvisar es exactamente
lo que el spec §8.4 pide, y la negativa a rodear la política del entorno con
un servidor intermediario es la decisión correcta — **no la revierto ni la
pediría**. Una política del entorno no se elude; se resuelve cambiando el
requisito. Dos apuntes de forma para las rondas que vienen:

- El bloqueo consumió una ronda entera. Si una pregunta es acotada y el resto
  del stage es independiente de ella, **avanza con lo independiente** y deja
  la pregunta abierta en el reporte marcando qué quedó pendiente por ella.
  Aquí el §3.2 (payload), el §3.1 (flag) y los tokens del §3.4 no dependían
  en nada de ver el mock renderizado.
- El reporte no menciona `M1_SPEC.md` en la historia de git (ver «Nota de
  higiene» abajo). Un reporte que apunta a un documento inexistente en el
  árbol versionado es frágil; en adelante, verifica que la orden de trabajo
  que estás ejecutando exista en la rama.

## P1 — RESUELTA (autorización + eliminación de la dependencia)

> *«¿Autorizas continuar tomando la lectura completa del HTML fuente como
> cumplimiento suficiente del prerrequisito visual?»*

**Sí, autorizado — y además el prerrequisito queda eliminado, que es mejor
que autorizarlo.** Dos cosas:

1. **`M1_SPEC.md` §0 fue corregido:** renderizar el mock **ya no es
   requisito** de este ni de ningún stage. Si tu entorno puede abrirlo, es un
   plus; si no puede, no es motivo de bloqueo. Y queda escrito que jamás
   eludas una política de tu entorno para verlo.
2. **`M1_SPEC.md` §11 es nuevo y sustituye la inspección visual por
   completo.** Yo sí recorrí el mock renderizado en esta máquina (5 capas,
   ambos temas, panel de estados, nivel diálogo), y transcribí ahí los
   valores **medidos** del CSS, no estimados: paleta base por tema, acentos
   por capa en noche y día, semáforo `good/watch/over` (que NO comparte hex
   entre temas), geometría y tipografía exactas de cifra/pill/cinta/dock/
   chips/cordón/asa/orbe, el esqueleto vertical de la pantalla con las dos
   zonas, el presupuesto de movimiento permitido en M1, y la lista explícita
   de lo que del mock NO se copia.

**Acción para ti:** re-lee `M1_SPEC.md` **§0 y §11** (el resto del spec no
cambió) y continúa M1 desde ahí. §11 es autoridad de composición al mismo
nivel que el resto del spec.

## Órdenes de esta ronda

- **O1 · Continúa M1 completo** según el spec vigente (§1–§7 sin cambios,
  §11 nuevo). No hay nada más bloqueado.
- **O2 · Higiene de la rama (autorizada por el founder en tu prompt para
  commitear en `stage-m-front`):** incluye en un commit propio
  `docs(M-design): auditoría, protocolo y spec M1` los tres archivos que hoy
  están fuera de la historia — `docs/design/M_DESIGN_003_AUDITORIA_PREIMPLEMENTACION_2026-08-24.md`,
  `docs/design/stages/M1_SPEC.md` y la modificación de `docs/design/README.md`
  (y este `M1_AUDIT.md`). **Sin modificar una sola línea de su contenido**:
  commitear no es editar; la prohibición de §8.1 sigue intacta. Razón: tu
  reporte referencia una orden de trabajo que no existe en la rama, y si tu
  entorno vuelve a clonar, pierdes el spec.
- **O3 · Ronda 2 del reporte** con el template §9 completo: autochequeo
  A1–A14, salida real de `npm run lint`, `npm run build` y el gate de
  captura pegada, y la guía de QA manual. Responde O1–O3 una por una.

## Nota de higiene (para el founder, no para Codex)

Estado de git al momento de esta ronda: rama `stage-m-front` en `26e65cd`,
con dos commits de Codex que sólo contienen `M1_REPORT.md`. `M_DESIGN_003`,
`M1_SPEC.md` y el cambio de `README.md` seguían **untracked**. O2 lo corrige
dentro de la rama, sin tocar `main`.

---

# M1_AUDIT — Ronda 2 · VEREDICTO: **ROJO**

- **Fecha:** 2026-08-24 · **Árbol auditado:** `stage-m-front` @ `42d2e7a`
- **Entrada:** `M1_REPORT.md` Ronda 2 (LISTO PARA AUDITORÍA, A1–A14 todos
  declarados CUMPLE).
- **Método:** re-corrida independiente de los tres gates + lectura completa
  del código + **verificación por EJECUCIÓN en un Chromium real a 375×812**
  (dev server local, `/dev/shell-preview`, medición de geometría, contraste
  calculado sobre estilos computados, y prueba de las interacciones).

**Resumen en una línea:** la arquitectura, el cableado de datos y la
disciplina de verdad están BIEN — los gates son verdes de verdad y la niebla,
el flag, el alcance y la accesibilidad se sostienen —, pero **dos de las
interacciones centrales no funcionan y dos orbes le afirman al usuario cosas
que el motor no afirmó**. Cuatro órdenes bloqueantes.

## Lo que verifiqué VERDE (no hay que volver a tocarlo)

| | Cómo lo probé |
|---|---|
| **Gates** | Corridos por mí: `npm run lint` → 0 errores (8 warnings preexistentes en `scripts/qa/`); `npm run build` → compilado + TypeScript OK; **gate de captura 826/826, exit 0**. A13 ✓ |
| **A1 flag** | `getShellMode` correcto (ausente/`legacy`/desconocido→legacy con warn único); el branch de `page.tsx` son 5 líneas y el camino legacy queda intacto |
| **A3 una lectura** | Exactamente un `buildCoachingBriefing` en el camino del santuario; la rama `orbe` retorna ANTES del `buildUserFinancialContext` del home legacy |
| **A4 niebla** | Ejecutada: cero números en toda la pantalla, mensaje + `Reintentar`, tabs deshabilitados, cinta oculta — y el dock SIGUE disponible (decisión correcta: si no puedo leerte, igual puedes hablarme) |
| **A10 temas** | Medido sobre estilos computados en carga limpia: modo día pasa AA en todo lo medido (mínimo **6,46:1**; cifra 16,63:1); modo noche igual. La primera medición que hice daba 2,14:1 y **era un artefacto mío** (medí durante la transición de color) — ver O8 |
| **A11 reduced-motion** | Las cuatro animaciones nuevas (orbe, halo, aura, cinta) + todas las transiciones del santuario mueren con `!important`, y el track pasa a `scroll-behavior: auto` |
| **A12 a11y** | `aria-label` del orbe dice el dinero correctamente **incluso fuera de USD** (lee el código de moneda cuando la etiqueta no termina en `$`); tabs y asa son botones reales; la hoja es `dialog` |
| **A14 alcance** | Diff limpio: cero `package.json`/lockfile, cero migraciones, cero `financial/**`, cero Supabase/agente/Telegram/onboarding/`ChatView`/`capture-test`. Los docs son exactamente O2 |
| **Geometría §11** | Medida en pantalla: cifra 57px, pill **exactamente 46×300**, dock 58px, orbe 263px. Fiel al addendum |
| **D8** | «Ciclo cubierto 62% · te faltan 760$» + agua al 62% + aria coherente |

## Órdenes BLOQUEANTES

### O1 · El carrusel no responde a los taps — y la pantalla rotula una capa mientras muestra el dinero de otra

**Reproducido:** tap en el chip «Metas» ⇒ `aria-selected`, acento y nudo
cambian a Metas, **pero `scrollLeft` se queda en 0**. Captura: chip «Metas»
activo, toda la UI en violeta, y debajo el orbe de agua turquesa con
**«82,40$ · Disponible hoy»** — la cifra del SALDO.

**Causa medida:** `scroll-behavior: smooth` en `.kipu-shell-track`. Con él,
ni `scrollTo({behavior:"smooth"})` ni una asignación directa mueven el
contenedor (muestreado 0 a los 250/500/1000/2000 ms); poniendo
`scroll-behavior: auto` en línea, `scrollLeft = 750` aterriza al instante
(`scrollWidth` 1896 > `clientWidth` 375, los 5 slides miden 375). El swipe
nativo sí funciona; el camino de tap —que P6 define como el PRIMARIO, con el
swipe como atajo— está muerto.

**Por qué es bloqueante y no cosmético:** no es «no navega», es que el
santuario **afirma una capa y muestra el dinero de otra**. Es la clase de
defecto que este proyecto persigue desde el Bloque I.

**Qué hacer:** (a) que el camino programático no dependa del `smooth` de CSS;
(b) garantizar estructuralmente que *tab activo == slide visible* (derivar el
rótulo de la posición observada del scroll, o mover primero y dejar que el
handler fije el índice) — que no puedan divergir por diseño, no por cuidado;
(c) **probarlo interactuando en un navegador real** (ver §Enmienda), no
leyendo código.

### O2 · El dock no se puede escribir en un teléfono

`onClick` en el `<input>` hace `router.push` al chat, así que **cualquier
toque navega antes de que puedas escribir**: `draft` siempre vale `""` y el
prefill `?share=` es inalcanzable salvo llegando por Tab con teclado físico.
Verificado: un click sobre el input navega (fue a `/login` por no haber
sesión). La guía de QA del reporte («escribir por teclado y enviar…») describe
un camino que un usuario de teléfono no puede recorrer, y sobre eso se declaró
A8 CUMPLE.

**Responsabilidad compartida:** mi §3.3 decía «Enviar/**tap del input** ⇒
navega … con el texto como prefill», que es contradictorio. **Queda
corregido:** el input del dock es un input DE VERDAD — se escribe ahí mismo;
Enter o el botón de enviar navegan con `?share=` (sin auto-enviar). Cámara al
chat y micrófono honesto quedan como están.

### O3 · Dos orbes le afirman al usuario algo que el motor nunca afirmó

`margen-kipu.ts:520-524` **omite** la capa cuando su monto es 0. Por eso, en
`shell-payload.ts`:

- `metasAmount == null` significa «no quedan aportes reservados **este
  ciclo**», no «no tienes metas» ⇒ a alguien con su meta *Brasil* ya aportada
  este mes le decimos **«¿Armamos tu primera meta?»**.
- `patrimonioAmount == null` significa «no hay activos **líquidos**» —
  `investmentsTotalBase` es líquido por diseño (`coaching-signals.ts:1098`:
  *"SELLABLE value only"*) ⇒ a alguien cuyo patrimonio es un inmueble le
  decimos **«Cuando inviertas…»**.

Es la doctrina de la casa («no pude leer ≠ no hay nada») aplicada a la cara
del producto. **Qué hacer:** separar EXISTENCIA de MONTO-DEL-CICLO con datos
que ya están en `ctx`/`briefing` (metas, planes de ahorro, inversiones): si la
entidad existe y el ciclo es 0 ⇒ **`0$` afirmado por el motor** con una frase
veraz; la invitación de día-1 SÓLO cuando la entidad no existe.
**Mi §3.2 apuntó a las capas sin advertir esto: es corrección de spec, no
descuido tuyo.**

### O4 · «Patrimonio» muestra un número distinto del que abre al tocarlo

El orbe usa el total LÍQUIDO; tocarlo abre `/app/wealth`, cuyo héroe es
`briefing.goalsIntel.netWorth.totalNetWorth` (patrimonio completo). Misma
palabra, dos cifras, a un tap de distancia — el espíritu de same-saldo.
**Qué hacer:** preferentemente alimentar el orbe de la misma lectura de
patrimonio que usa su página de destino (con niebla/ausencia honestas si esa
lectura no es publicable); si eliges conservar el número de la capa de
drenaje, entonces el rótulo debe decir qué es y el destino debe coincidir.
Declara en el reporte cuál elegiste y por qué.

## Órdenes NO bloqueantes (hazlas en la misma ronda si son baratas)

- **O5 · El harness no muestra el pie del santuario.** `/dev/shell-preview`
  apila la barra de estados encima de un shell de `100svh`: medido, el marco
  va de y=173 a y=985 con viewport de 812 ⇒ **cinta y dock quedan fuera de
  pantalla** y `.kipu-santuario` es `overflow:hidden`. El único lugar donde el
  founder y yo juzgamos estados no puede mostrar dos de los cuatro elementos
  de la constitución. Hazla una barra flotante/compacta o encuadra el shell.
- **O6 · El fixture «día 1» muestra un Saldo imposible.** Anula `amountLabel`
  en los cinco orbes, pero producción SIEMPRE rotula el Saldo (`display(0)` =
  `0$`); §5.4 dice «Saldo **en cero**», no «sin dato». Un harness debe mostrar
  estados que producción pueda producir. Aprovecha y decide qué pasa con la
  composición cuando no hay número (hoy queda un hueco y el subtítulo flota):
  lo natural es que la invitación pase a ser el texto focal, como en la niebla.
- **O7 · El placeholder del dock se corta.** «Anota un gasto o pregúntame…» no
  entra a 375px con tres targets de 44px. Es el CTA principal del producto:
  acórtalo (p.ej. «Anota o pregúntame…»).
- **O8 · Latente, para cuando llegue el toggle de tema.** Con el santuario
  montado, cambiar `data-theme` en caliente deja chips y asa con el color del
  tema anterior (`#93AAB9` sobre fondo claro = 2,14:1): la `transition: color`
  no aterriza aunque la variable ya resolvió al valor nuevo. **Hoy no es un
  fallo de AA** (en carga limpia todo pasa) y es inalcanzable porque no hay
  toggle dentro del santuario; se vuelve alcanzable en M7/M8. Déjalo anotado
  en tu reporte como hueco conocido.

## Observación de producto (para el founder, no es orden)

La cifra sale «82.40$» (separadores en-US del `formatKipuMoney` existente)
mientras los docs de diseño y el mock usan «82,40$» a la latinoamericana. No
es cosa de M1 —es el formateador de toda la app— pero el santuario lo pone en
58px, así que conviene decidirlo antes de M7.

## Enmienda al protocolo (vinculante desde ahora)

Codex **no puede renderizar su propio resultado** (política de su navegador).
Los cuatro criterios de interacción/visual que declaró CUMPLE (A5, A7, A8, A9)
fueron verificados leyendo código, y **dos eran falsos**. `lint`, `build` y un
HTTP 200 son ciegos a «el carrusel no se mueve» y a «no se puede escribir en
el dock».

Desde ahora, en cualquier stage del Bloque M:

1. Codex marca los criterios que su entorno no puede ejecutar como
   **«NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual»**, diciendo
   qué sí comprobó. Declarar CUMPLE sobre algo que no se puede ejecutar es
   incumplimiento de protocolo, aunque el código parezca correcto.
2. La verificación visual y de interacción es **responsabilidad del auditor**,
   que sí tiene navegador. Yo la haré cada ronda.
3. Cuando una orden sea de interacción (O1, O2), la ronda siguiente debe
   describir **qué cambió estructuralmente para que el fallo no pueda volver**
   —no «lo corregí»—, porque quien la prueba es otro.

## Qué NO cambia

La arquitectura de M1 está bien y no se rehace: el flag, el payload de una
sola lectura, la separación servidor/cliente, los tokens de §11, la niebla,
el alcance de archivos y la accesibilidad quedan como están. Las cuatro
órdenes bloqueantes son de comportamiento y de verdad, no de estructura.
