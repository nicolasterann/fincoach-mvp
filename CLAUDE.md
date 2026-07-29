@AGENTS.md

# Kipu — Claude Code operating guide (AI-native)

This file is the standing brief for every Claude Code session in this repo.
It supersedes general training assumptions AND any older doc that conflicts
with it. Read it first.

> **2027, not 2010.** Kipu is an AI-native financial coach, not a route-based
> chatbot with AI sprinkled on top. If something in this repo makes Kipu feel
> like validation logic, a parser, or a finance tracker, that is a bug to fix,
> not a pattern to extend.

Linked references (updated for this direction):
- docs/AI_NATIVE_ARCHITECTURE.md — **the north star.** Agent core, tools,
  memory & learning, safety model, staged migration. Read this second.
- docs/PRODUCT_SPEC.md — product personality, scope, modules
- docs/TECHNICAL_SPEC.md — stack, financial engine, money model
- docs/ROADMAP.md — **the live roadmap.** The only source of work order
  (Bloques J → K → L → M). Anything else that states a "next" is stale.
- docs/ROADMAP_MVP.md — the original 13-phase plan, kept as HISTORICAL ARCHIVE
  only. It is archaeology, not pending work. Live status lives in
  docs/BUILD_PROGRESS.md. Today: Bloques A–D, F, G, H, I closed; the active
  block is J (see docs/ROADMAP.md).
- docs/TEST_SCRIPTS.md — manual QA (behavior-level, not phrase-level)

## What Kipu is

Kipu is a personal financial AI coach for Latin American users. Opening Kipu
should feel like opening a personal ChatGPT that **already knows the user's
entire financial life** — balances, accounts, cards, debts, fixed expenses,
income, goals, habits, spending patterns, impulses, preferences, history,
corrections, and their emotional relationship with money — and can **act** on
it safely.

The difference from ChatGPT: Kipu does not only answer. It **remembers,
measures, learns, updates, acts, corrects, plans, and adapts** using the
user's real, live, structured financial state. If Kipu cannot beat a generic
Claude/ChatGPT project with a budgeting artifact, there is no reason to build
it. Kipu wins because of **live structured financial memory + safe action**.

The user must be able to say almost anything — "borra los últimos 10
movimientos", "no era con Visa, era Pichincha", "cambia mi sueldo, ahora gano
1400", "Juan me devolvió lo de la cena", "ese gasto era mitad mío y mitad de
Ana", "cuando digo Pichincha me refiero a mi cuenta", "esta semana fue un
desastre, ayúdame a cuadrar", "no registré nada en 5 días, retómame sin
hacerme sentir mal" — and Kipu understands the intent, asks for what's
missing, executes safely when it can, learns, and replies like a coach. It
must NOT break because we didn't pre-code that exact phrase.

## Product surface today (do not resurrect retired concepts)

- **Daily hero = Saldo Kipu** (Bloque D, deployed): an ACCUMULATING balance
  for gustos — a tank refilled `fillDaily = libre-del-mes/30` (structural),
  capped at 10 days of gustos, drained by real gustos;
  `saldo = min(tanque, calendario-sin-Reserva)`. Visual: vertical quipu of
  knots. Runway mode when no active income. Day boundaries in the USER'S
  timezone. Agent, chat, ambient and fallback must cite the SAME saldo as the
  dashboard.
- **Layers** (aviso de cruce ALWAYS, never block): Saldo → Reserva → Metas →
  Ahorro → Patrimonio (liquid investment only) → Deuda. The Reserva is the
  protected layer; the word "colchón" is banned in UI copy.
- **Retired from the product face:** Margen Kipu as a visible brand, Pulso
  Kipu (0–100 score), Flexibilidad, Precisión, Realidad, named states
  (Holgado/Justo/Estirando), weekly framing in the hero. `/app/margen`,
  `/app/readiness`, `/app/precision`, `/app/reality` are redirects;
  `margenWeekly`/`margenDaily` survive only as engine internals.
- **Home:** Principal (Saldo Kipu quipu hero / Hoy / Lo que viene) +
  Secundario (Reserva / Meta principal / Próximo pago / Tu mes / Actividad).
  Detail pages: `/app/saldo` (Tus capas + flow receipt + honest history from
  snapshot `saldo_kipu`) and `/app/cuentas` "Dónde está tu plata" (Bloque F:
  per-account cashflow on the same calendar, per-account operating floors,
  ideal distribution, physical layers, dead pockets, Tesorería TransferAlert
  recommend-only; silent when mono-account).
- **Bloque C (closed):** universal materialization calendar — nightly cron;
  incomes/fijos auto or ask, loans auto-book, cards ask at CORTE and PAGO,
  family/scheduled ask, reserves check-in; resolve by chat; AI-generated
  notifications. Cards are ONE system.
- **Migrations:** 001–092 applied (088 + its fixes 089–092 on 2026-07-28)
  (`supabase/sql/`; 048 = `saldo_kipu` in
  `daily_financial_snapshots`; 051–055 = Bloque H objective history; 056+058 =
  Bloque I scheduled-changes lease + intención durable con fidelidad; 057+059 =
  repago atómico, idempotente ante replay y sin mezclar monedas; 060+061 =
  household atómico (kipu_add_shared_expense / kipu_settle_household /
  kipu_update_shared_expense) con CAS por counts Y TOTALES, lock compartido e
  índice único de origin_transaction_id; 062 = auditoría 3: el repago valida la
  base contra el perfil, cancel/mark_paid pasan por RPC con el MISMO lock del
  settle, actor validado en toda RPC household, y el update verifica el CONJUNTO
  persistido — dup, cobertura exacta y suma post-write; 063 = auditoría 4:
  `kipu_apply_card_payment` — pago de tarjeta ATÓMICO (ledger + baja de
  `full_payment_due` en UNA transacción, CAS sobre el valor leído, replay
  idempotente por dedupe sin re-reducir) — y `kipu_apply_repayment` rechaza al
  usuario sin fila de perfil; 064 = pasada 5: `kipu_set_card_statement` (corte con
  lock — updated / safe_newer_exists / raise), tabla `card_payment_applications`
  (marca durable del pago aplicado, misma transacción; ledger genérico con el
  mismo dedupe sin marca ⇒ conflicto, jamás replayed) y `kipu_apply_card_payment`
  v2 endurecida — debt_payment obligatorio, entry.debt = statement.debt,
  ownership/credit_card con lock y coherencia del monto pagado).
  La 065 (`065_bloqueI_card_cycle_integrity.sql`, pasada 6) está APLICADA:
  total vs remanente del corte + `statement_covered` explícito (un parcial jamás
  cubre el corte), pagos de deuda solo en moneda nativa común (trigger
  transversal), replay con fingerprint y marca por transacción, reconciliación
  de pagos manuales (solo statement+marca) y writers declarativos con lock+CAS.
  La 066 (Bloque J-1) extiende esa defensa a gastos/ingresos/aportes: trigger
  `transactions_cash_movement_currency_guard` — toda pata de cuenta debe estar en
  la moneda del movimiento y la base debe ser la del perfil (reversal/adjustment/
  transfer/refund exentos). La 067 (re-auditoría J-1) suma la pata de la META al
  mismo trigger: goals.current_amount se incrementa con el ORIGINAL, así que
  goal_contribution exige goals.currency = moneda del movimiento (meta sin moneda
  declarada también rehúsa). La 068 (re-auditoría 2 de J-1): cambio de moneda de
  cuenta ATÓMICO (`kipu_change_account_currency` — lock + CAS de moneda/balances +
  re-conteo de movimientos DENTRO de la transacción), trigger
  `accounts_currency_change_guard` (la moneda de una cuenta con movimientos es
  INMUTABLE para cualquier writer) y preferencia moneda→cuenta ESTRUCTURADA
  (`accounts.is_currency_default`, única por moneda, RPC atómica de set — la
  evidencia "learned" del plan de captura). La 069 (re-auditoría 3 de J-1) cierra
  la CARRERA de dos conexiones: los validadores de moneda toman `for key share`
  sobre cuentas (orden determinista), tarjeta, meta y perfil ANTES de validar (con
  SELECT sin lock, un BEFORE INSERT concurrente validaba contra la versión vieja y
  aterrizaba después del cambio); `kipu_change_base_currency` atómica; el default
  solo en cuentas ordinarias activas; sin reinterpret los balances nuevos deben ser
  cero; `already_changed` idempotente. La 070 (re-auditoría 4) cierra la PUERTA
  LATERAL: los validadores suben a `for no key update` (el `for key share` no
  chocaba con un `UPDATE` directo, que toma FOR NO KEY UPDATE, y `authenticated`
  conserva UPDATE por RLS), guards de inmutabilidad para `profiles.base_currency`,
  `debt_accounts.currency` y `goals.currency`, y `kipu__user_base_data_witness` —
  la definición ÚNICA y completa de «hay dinero expresado en la base» (19 tablas:
  activos, planes de ahorro, cuotas, objetivos, snapshots y preferencias
  monetarias incluidos), usada por la RPC y por el trigger del perfil, más
  pre-onboarding obligatorio. La 071 (re-auditoría 5) hace que los guards miren
  VALOR y no solo ledger: la moneda de una tarjeta y de una meta es INMUTABLE
  tras el INSERT (target/weekly/statement ya están denominados aunque no haya
  movimientos, y el guard mira OLD — mirar NEW dejaba que el mismo UPDATE
  escondiera el saldo), la cuenta exige balances viejo Y nuevo en cero salvo por
  la RPC (marca transaccional `kipu.sanctioned_currency_change`), y el witness se
  DERIVA del catálogo. La 072 (re-auditoría 6) corrige un SOBRECLAIM: una regex
  sobre el NOMBRE de la columna no puede garantizar completitud — resolvía
  `budget_categories` a `{amount}` sin ver `mtd_seed` (dinero congelado en base
  según el onboarding) ni `saldo_kipu`. La regla pasa a ser EXISTENCIA DE FILA
  sobre una lista EXPLÍCITA de 26 tablas financieras (más estricta a propósito;
  el catálogo queda como red secundaria) y `kipu__base_data_coverage_gaps()`
  expone la deriva para la próxima auditoría. Además, la RPC rechaza cambiar la
  moneda de una cuenta CABLEADA a configuración denominada (meta, ingreso, plan
  de ahorro, cuenta de pago de deuda, gasto fijo). La 073 (re-auditoría 7)
  protege esa coherencia por LOS DOS LADOS: el trigger de la cuenta usa el MISMO
  helper que la RPC (el UPDATE directo se saltaba las dependencias), suma
  `scheduled_payments` y `spending_alert_rules`, y agrega triggers INVERSOS que
  bloquean la cuenta (`for no key update`) al vincularla desde metas, ingresos,
  pagos programados, gastos fijos, la cuenta de pago de una deuda y planes de
  ahorro — así la carrera «cambio la moneda mientras entra la dependencia» se
  cierra en cualquier orden. El onboarding deriva la moneda del instrumento
  vinculado. La 074 (re-auditoría 8) corrige tres cosas: `savings_plans` se
  valida contra la moneda NATIVA (`original_currency ?? base_currency` — antes
  usaba la equivalencia contable y rechazaba el caso legítimo «base USD, plan de
  50.000 ARS desde cuenta ARS»), `spending_alert_rules` gana su trigger inverso
  (su umbral no declara moneda: hay que SERIALIZAR contra el cambio de cuenta), y
  los guards pasan a VOLATILE (una función STABLE usa el snapshot de la consulta
  que la llama, así que tras esperar un lock podía no ver lo commiteado durante
  la espera). El endurecimiento posterior (sin migración) lleva el onboarding a
  un plan puro ÚNICO: la moneda omitida hereda el instrumento; esa misma decisión
  alimenta el preflight FX, la conversión, la fila y las acciones derivadas; y
  un vínculo incompatible se rehúsa ANTES de cualquier write — jamás se
  reetiqueta el número ni se pierde el vínculo en silencio. Los planes de ahorro
  siguen el mismo contrato: el origen debe existir como cuenta; el destino debe
  existir como cuenta o activo probado. Y su contracara, que es regla: **un
  rechazo cuyo remedio no está en la pantalla es un cerrojo, no un guard** — por
  eso el draft del wizard solo emite un vínculo cuando su objetivo sigue vivo
  (borrar el activo borra el vínculo, igual que lo muestra la pantalla), y el
  preflight rehúsa solo lo que el usuario puede ver y arreglar. La última
  migración aplicada es la **092** (ver más abajo: 088 y sus correcciones
  089–092, aplicadas el 2026-07-28). Las 082–083 ya completaron su rollout
  (082 → deploy `bf7d7d4` → 083, E2E 38/38): publicación/cierre/plan atómicos,
  wrappers v2 con rechazos deterministas en `22023`, quince cores legacy
  cerrados y `savings_plans` sin bypass autenticado. La 084 (J-8) fue aplicada
  manualmente por el editor SQL y por eso no figura en `schema_migrations`; la
  cadena reproducible es 084 (manual, conservada sin reescribir) → 085 (puente
  multifuente) → 086 (backfill de cuotas preservando cualquier indicio de
  liquidación). La 087 está APLICADA (2026-07-28): liga cada draft de captura
  resuelto a `kind + dedupe + operation_id`, para que sólo admita el replay
  exacto y nunca un segundo consumo. La **088** está APLICADA (2026-07-28), junto con sus correcciones 089, 090, 091 y 092:
  cierre first-principles del agente — identidad durable por delivery,
  challenges server-owned para acciones sensibles, transferencia FX de dos
  patas nativas, creates/replays idempotentes y fronteras atómicas household /
  instrumentos / correcciones de comercio. Trajo tres defectos que sólo
  aparecieron EJECUTANDO, corregidos por las migraciones siguientes: la **089**
  arregla `kipu_create_account_idempotent` y `kipu_create_debt_account_idempotent`
  (estaban MUERTAS: `text` sin cast a los enums `account_type`/`debt_account_type`,
  así que crear cuenta o tarjeta desde el agente fallaba siempre) y adelanta el
  chequeo `same_turn` en `kipu_claim_agent_action_challenge` (la adyacencia, que
  CANCELA, corría antes, así que una redelivery tardía del turno que proponía
  mataba la propuesta que el usuario iba a confirmar). La **090** quita un
  CERROJO que la propia 088 creó: su guard de meta compartida abortaba cuando
  `household_id` pasaba a NULL, y esa columna es ON DELETE SET NULL, así que un
  hogar con meta compartida quedaba imposible de borrar; ahora la meta se degrada
  a no-compartida en la misma operación y el INSERT conserva el rechazo estricto.
  La **091** cierra un defecto ANTERIOR al bloque que salió a la luz aquí:
  `shared_expenses.created_by` y `household_settlements.created_by` eran NOT NULL
  con ON DELETE SET NULL —dos reglas que se contradicen—, así que quien hubiera
  creado un gasto compartido o una liquidación no podía borrar su cuenta jamás;
  la columna cede, el write no (guard de INSERT). La **092** completa ese
  contrato y lo hace PROBABLE: `created_by` es INMUTABLE mientras su autor
  exista —un UPDATE manual a NULL falsificaría la firma del cascade y reasignar
  la autoría reescribiría la historia—, y el único cambio legítimo es a NULL
  cuando el autor ya fue borrado, que es exactamente lo que distingue el
  `ON DELETE SET NULL` de un writer. Además expone
  `kipu__schema_contract_report()` (sólo service_role, sólo lectura) para que la
  sonda exija contra el CATÁLOGO cero columnas NOT NULL dentro de un FK
  ON DELETE SET NULL y los cuatro guards de autoría activos: el barrido textual
  del gate (IR170) es alarma temprana, no prueba. Sondas **61/61**, residuo cero.
  Todo ese código quedó desplegado en producción en el cierre de J
  (`54311f6`). La 075
  (Bloque J-3) hace que anotar un
  corte CIERRE su pregunta: wrappers atómicos sobre `kipu_set_card_statement` y
  `kipu_override_debt_due` (cores privados, sin service_role) que resuelven la
  ocurrencia `card_statement` en la MISMA transacción; con varios avisos abiertos
  y sin `occurrence_id` devuelve `ambiguous`: no cierra ninguno y el corte SÍ se
  guarda (abortar con 40001 perdía el dato y fingía un conflicto transitorio ante
  una ambigüedad determinista). APLICADA 2026-07-26.
- **Bloque G (closed): cuotas/installments LatAm.** Opción A: la deuda total
  nace hoy en la tarjeta (gasto con external_ref `installment:<id>` que el
  tanque nunca drena); la cuota mensual baja el RITMO como fijo temporal
  mientras el plan corre; estimado del resumen = corriente − diferido; tools
  `create_installment_plan` (aviso «recarga antes → después») y
  `close_installment_plan`. Migraciones 049–050.
- **Bloque H (closed): Objetivo mensual (comida/transporte).** La comida y el
  transporte llevan un OBJETIVO mensual que el usuario DECIDE (no un estimado
  que Kipu ajuste solo): todo gasto de esas categorías cuenta contra su objetivo;
  dentro del objetivo NO drena el Saldo (ya está reservado vía essentialEstimate);
  al cruzarlo, SOLO el exceso drena el tanque, día a día. Un gasto EXTRAORDINARIO
  confirmado (`budget_treatment='saldo'`, aniversario/festejo/viaje/cena especial —
  jamás sin confirmación del usuario o instrucción permanente) sale directo del
  Saldo, no consume objetivo y queda fuera de la comparación del cierre. Refund
  hereda el registro del original. Excluidos del acumulador: fijos
  (recurringExpenseId), cuotas (installment) y comida en viaje (travel). Señal de
  ritmo PRE-cruce en home/spending/digest/ambient («a este ritmo lo cruzas el N»);
  cierre mensual (cron día 1-3 tz-usuario) = reporte con lo aprendido + sobrante
  → Reservas por defecto (no-write; `resolve_objective_close` para redirigir).
  El objetivo se cablea desde budget_categories (sin objetivo → comportamiento
  legacy exacto) y se VERSIONA por mes (`objective_versions`, migraciones
  052–055): cada mes se mide contra el objetivo VIGENTE entonces — el onboarding
  crea la primera versión, un mes previo a toda versión resuelve a la MÁS
  ANTIGUA (inmutable, jamás al monto actual mutable), el cambio es ATÓMICO
  (RPC `kipu_upsert_budget_objective`: puntero + versión en una transacción), un
  error de lectura NO se confunde con «sin historia» (degrada a mes-corriente,
  nunca reescribe el pasado), y la equivalencia base se CONGELA (`amount_base`)
  para meses cerrados — solo el mes corriente revalúa a FX vivo, así una
  variación de tasa no crea ni borra exceso histórico. Una compra hipotética de
  comida/transporte se evalúa con el objetivo (`category` requerida y tipada;
  dentro → 0; si cruza → solo la parte pasada) y la RECOMENDACIÓN pesa ese mismo
  costo (con tarjeta, la deuda sigue siendo el monto completo). budget-progress
  y el motor comparten el calendario del USUARIO (nunca el mes UTC del server).
  El historial es INMUTABLE de verdad: cambiar el objetivo dentro de su primer
  mes hace que la RPC preserve atómicamente el valor viejo como ANCLA en el mes
  anterior (si no, el upsert por mes borraba la única fila a la que el pasado
  resolvía); el onboarding escribe budgets + primeras versiones en UNA
  transacción (`kipu_upsert_onboarding_budgets`); y `amount_base`/`base_currency`
  son NOT NULL con la RPC rechazando versiones sin congelar. Si la historia no se
  puede reconstruir, el motor NO publica un Saldo recalculado sin sus drenajes:
  queda temporalmente NO DISPONIBLE (`KipuSaldoUnavailableError`) — nunca cero
  drenajes como resultado válido ni un snapshot viejo como «AHORA» (no tiene
  watermark del ledger). **El FEED de transacciones es dinero, no telemetría** y
  aplica la misma regla: nació best-effort para patrones y el Bloque H lo ascendió
  a fuente de los drenajes, así que ahora reporta sobre sí mismo
  (`{ok, complete, rows}` vía `readMoneyTxnFeed`) y el veredicto lo decide
  `moneyFeedPublishable` — error en cualquier página, excepción o tope de
  paginación sin demostrar el final ⇒ Saldo NO DISPONIBLE antes de todo tank math.
  `complete` significa PROBADO, no «la página vino corta»: se pagina por CURSOR
  sobre `(occurred_at, id)` (orden total — `occurred_at` no es único y los empates
  no tenían orden; los offsets se corrían con cualquier escritura concurrente,
  duplicando una fila y perdiendo otra), se deduplica por `id`, una sola página es
  atómica (un statement, un snapshot) y multi-página se verifica contra el conteo
  del ledger: si no cuadra, no podemos demostrar que lo tenemos entero ⇒ no
  publicable (cuesta un reintento, nunca un Saldo equivocado);
  una lectura sana con CERO movimientos sigue siendo válida («no te moviste» y «no
  pude leerte» dejaron de ser la misma frase). La VENTANA carga desde el inicio del
  mes del usuario que contiene (hoy−40d) — el walk sigue en 40 días — porque el
  acumulador mide cada mes desde su día 1: un mes cubierto a medias se caminaba
  desde cum=0 y su exceso desaparecía en silencio (desde el día 12, ése era el mes
  ANTERIOR) con historyReliable en true. Los insights se degradan; el Saldo no.
  Ninguna superficie publica un sustituto: `deriveAlignedAdvisorySnapshot` y la
  confirmación post-captura ya NO caen a la familia legacy del plan semanal.
  El agente aplica el mismo fail-closed con estado tipado:
  refresca obligatoriamente después de cada escritura, bloquea en el dispatcher
  toda tool que cite/decida con Saldo o margen y tiene una barrera final fuera del
  LLM que impide filtrar el número pre-escritura — barrera cuyo veredicto es un
  parámetro REQUERIDO (por defecto, un call site podía omitirlo y desarmarla sin
  romper la compilación) y que NO se come una aclaración pendiente: un needs_info
  sobrevive intacto salvo que cite el Saldo. La zona IANA se captura además en el PRIMER LOAD
  autenticado (`ensureUserTimezoneAction` desde el layout de `/app`), porque el
  onboarding era la única captura automática y quien ya se había onboardeado corría
  para siempre con el default del server. Es un RELLENO: `timezoneBackfillValue`
  escribe solo si no hay zona guardada — una zona ya declarada (chat u onboarding)
  manda sobre el navegador, o un viaje movería el límite del mes en silencio y Kipu
  no puede distinguir un viajero de una mudanza. El onboarding valida y persiste
  la zona IANA como HECHO DE PERFIL para todo usuario (vivía dentro del bloque de
  presupuestos, y como Comida se siembra vacía, «no llenar nada» dejaba a la
  mayoría sin zona); aborta solo donde nace un objetivo, que es donde el mes es
  prerequisito; la RPC deriva el mes desde esa zona y el cliente no puede
  sobreescribirlo. La
  inmutabilidad es POR PRIVILEGIO: `authenticated` solo puede SELECT sobre
  `objective_versions`; las RPC son SECURITY DEFINER y el servidor deriva el mes
  vigente y qué categorías son objetivo (nada de eso se acepta del cliente).
  Motor puro `objectives.ts`; migraciones 051–055. El motor es dueño de la
  matemática; la IA solo detecta posibles extraordinarios y pide confirmación.
- **Bloque I (CLOSED 2026-07-19, commit `7a575cf`, migraciones 056–065): que
  ningún número pueda inflarse solo.** Doctrina PERMANENTE de toda lectura y
  escritura de dinero: `MoneyReadStatus {ok, complete}` + `moneyReadPublishable()`
  (`src/lib/financial/money-read.ts`) — `readX()` devuelve el contrato (dinero),
  `loadXForDisplay()` colapsa el fallo y se llama así para que el mal uso se vea.
  Reglas que NO se relajan: «no pude leer» ≠ «no hay nada» · un guard que no pudo
  leer NO autoriza · un read-modify-write necesita CAS · «el write falló» ≠ «no
  aterrizó» · la completitud se PRUEBA (cursor + CAP+1 que sea posible bajo el
  max-rows de PostgREST), no se asume · toda operación de dos mitades vive en UNA
  transacción con marca durable, jamás en dos escrituras encadenadas · un estado
  terminal solo se marca con el write monetario probado. Seis pasadas de auditoría
  externa cerradas (11→10→7→6→7→7 defectos); gate 317→406 aserciones, 31
  mutaciones verificadas, sondas RPC A–G contra prod en transacciones revertidas.
- **Next:** the live order lives in **docs/ROADMAP.md** — read it there, don't
  re-derive it here. Principle: back-end and features to 100% first; the ENTIRE
  front as its own final stage.
  - **Bloque J (CERRADO 2026-07-28, commit final `54311f6`):** J-1…J-8 y la
    inspección first-principles posterior cerraron el agente contra los incidentes
    reales y contra las familias completas de fallo: autoridad de cada acción,
    identidad por delivery, replays/no-op, evidencia numérica y por entidad,
    fallbacks, frescura post-write, contratos runtime de las ~115 tools, reads
    completas y atomicidad/idempotencia de cada writer. Migraciones 066–092
    aplicadas; sonda final 61/61 con residuo cero; capture 604/604; loop 21/21;
    wizard 161/161; J-2/J-3/J-4 17/17, 21/21 y 18/18; build, lint y tsc limpios.
    Producción sirve exactamente `54311f6`, los alias están promovidos, responde
    200 y no hubo errores nuevos de runtime. Una pasada independiente sobre el
    árbol congelado no encontró defectos nuevos de producto.
    **J-2 (CERRADO): una corrección no es un movimiento nuevo.** «no era con
    Pichincha, era Supervielle» registraba un gasto NUEVO —
    el mismo dinero dos veces. Las dos defensas de duplicado son ciegas a esto por
    construcción (la EXACTA exige el mismo `sourceId`, que una corrección de cuenta
    cambia por definición; la CERCANA solo cubre gastos con comercio). Ahora
    `correctivePhrasing` + `movementCorrectionTargets` (`capture-matching.ts`) son
    una decisión del EJECUTOR sobre `ctx.rawMessage` — reformulación correctiva +
    movimiento reciente compatible ⇒ `log_movement` y el lote devuelven el
    `transactionId` y mandan a `correct_movement`, y `confirmedNew` no lo abre.
    Re-auditoría: el loader anterior convertía errores PostgREST en `[]`, topaba
    en 40 filas, una evidencia pendiente apagaba el guard y `correct_movement`
    volvía a buscar el id dentro de otro top 25. Ahora la decisión usa lectura
    tipada y completa por cursor `(created_at,id)` + conteo, la corrección falla
    cerrada ante error/incompletitud/target ausente, y el executor corrige el id
    exacto con lectura tipada. `created_at` gobierna la recencia (la fecha
    contable puede ser precisamente lo corregido); una identidad descriptiva
    cubre cambios de monto también en ingresos/pagos/aportes; fecha se propaga
    como `newOccurredAtISO`. El duplicado común conserva fail-open.
    Última barrera: `correctionBlocked` solo existe después de ejecutar una tool.
    Un fallo PRE-tool del agente todavía podía caer al pipeline legacy y duplicar
    la corrección. `resolveLegacyFallbackSafely` intercepta ese único downgrade:
    una reformulación correctiva recibe aclaración segura, mientras una captura
    normal conserva el fallback. `correctivePhrasing` ya no depende de una lista
    incompleta de locuciones `no + preposición`; exige evidencia estructural
    (corrección explícita o contraste completo) para no bloquear gastos normales.
    **J-3 (075 APLICADA 2026-07-26; sondas post-migración verdes): la repregunta del calendario.** Una
    ocurrencia solo deja de preguntarse si el agente puede RESOLVERLA, y la lista
    de pendientes —que ya tenía el contrato de Bloque I— se colapsaba a `[]` en
    tres capas del lado del chat (helper, bloque vacío y `.catch(() => "")`), así
    que una lectura caída se veía como «no tenés pendientes» y la respuesta del
    usuario podía volverse un movimiento nuevo. La re-auditoría exige set
    completo también para el match por nombre, exige unicidad real (nunca
    `.find()` sobre «Visa»), consulta nombres solo por los ids acotados y apaga
    todo el bloque si esos nombres no son legibles. La procedencia durable del
    notifier llega tipada al executor para que un writer genérico no adivine.
    La migración 075 hace que anotar/corregir un corte cierre su
    ocurrencia en la misma transacción; identidad por occurrenceId, fecha exacta
    o único pendiente, y conflicto ante ambigüedad.
    Última barrera: `correctionBlocked` solo existe después de ejecutar una tool.
    Un fallo PRE-tool del agente todavía podía caer al pipeline legacy y duplicar
    la corrección. `resolveLegacyFallbackSafely` intercepta ese único downgrade:
    una reformulación correctiva recibe aclaración segura, mientras una captura
    normal conserva el fallback. `correctivePhrasing` ya no depende de una lista
    incompleta de locuciones `no + preposición`; exige evidencia estructural
    (corrección explícita o contraste completo) para no bloquear gastos normales.
  - **Bloque K (ACTUAL):** variable fijos (luz/gas/internet) learn from history
    instead of being overwritten by the last month.
  - **Bloque L:** shared/refunds — LOW priority (0 rows in production).
  - **Bloque M:** the complete front (UI, UX, navigation, entry points,
    surfaces, animations). Final stage — the 7 detail surfaces already exist
    against the engine; what's missing are the ways in.

  No monetization; no bank connections — manual capture by design.

## What Kipu is not

- Not a generic expense tracker. Not a banking app. Not a budget spreadsheet.
- Not a generic GPT wrapper. The financial engine — not the LLM — is the
  source of truth for every number.
- **Not a router where every intent must be pre-coded.** Not a phrase-matcher.
  Not fallback-driven. Not command-based.

## The core architecture: agent plans, tools execute

```
User message (any channel)
  → Kipu Agent (LLM): reads live financial memory + history + learned facts,
      understands intent broadly, decides what to do
  → calls one or more TOOLS (safe, deterministic capabilities)
  → each tool VALIDATES and executes (or asks for confirmation / more info)
  → Agent composes a natural, personalized reply and updates memory
```

Kipu also acts **proactively**: the universal materialization calendar
(Bloque C, nightly cron) and ambient topics (e.g. transfer_needed,
payday_distribution) produce AI-generated notifications; the user resolves
them in the same chat through the same tools. Proactive and reactive paths
cite the same numbers.

Two unbreakable halves:

1. **Intelligence is flexible (the LLM).** It interprets messy natural
   language, remembers context, infers patterns, plans, and chooses tools. It
   is NOT limited to a fixed list of regex routes.
2. **Execution is safe (deterministic tools).** Every database write goes
   through a typed tool that validates against the real financial state.
   Balances, reversals, transfers, and corrections are computed by code, never
   hallucinated. A tool may refuse or ask for confirmation; the LLM never
   writes to the DB directly.

This is how "flexible intelligence" and "reliable money" coexist. Reliability
must NOT mean rigidity.

The tool surface lives in `src/lib/ai/agent/kipu-agent-tools.ts` — ~115
typed tools today (capture, corrections, transfers, commitments, calendar
resolves, `plan_reserve_withdrawal`, memory, …) wrapping the safe writer
modules, the financial context builder, and the memory store. When adding a
capability, add a **tool**, not a new regex route.

### Memory & learning (what makes Kipu "know you")

Kipu maintains structured memory beyond the ledger:
- **Financial state** — accounts, cards, debts, income, fixed expenses, goals,
  balances (source of truth; `transactions` is the audit log).
- **Learned facts / aliases / preferences** — "Pichincha = the bank account,
  not the Visa", default payment source, "la cena de siempre", who "Juan" and
  "mi mamá" are, recurring patterns, weak spots (overspends on food after
  weekends), emotional cues. Stored in `user_context_notes` /
  `user_financial_preferences` (among other memory stores — merchant memory,
  personalization, personality) and surfaced to the agent every turn.
- **Corrections teach.** When the user corrects Kipu, the agent should persist
  the correction as a learned fact via the `remember_fact` tool so it does not
  repeat the mistake.

The agent reads memory before acting and writes memory after learning. This is
the self-improving loop. Memory is context for intelligence; the financial
engine is still the source of truth for numbers.

## Legacy pipeline (being migrated, kept as deterministic fallback)

The previous deterministic pipeline (`chat-transaction-handler.ts` with its
prefilter, Universal Router, and per-intent gates) still exists and runs when
the agent is disabled or unavailable. It is the **safety net**, not the target.
Do not invest in widening regex gates or adding new narrow routes. New
capability work goes into agent tools. The legacy gates are being collapsed
into tools over the staged migration in docs/AI_NATIVE_ARCHITECTURE.md.

Current agent posture (production, beta): `KIPU_AGENT_MODE=on` — the agent is the
real primary. The agent-era write gates it fully owns (recovery-confirmation,
transfer, commitment) are **skipped** when `agentMode() === "on"`; `runChatPipeline`
runs only as the emergency fallback on agent failure, leaving just the core net
(parser + fixed-expense matcher + advisory/coach/router). Those guarded gates still
serve `KIPU_AGENT_MODE=off` unchanged and remain until fully retired — never
re-extend them. (The full staged-migration history lives in
docs/AI_NATIVE_ARCHITECTURE.md §5 and docs/BUILD_PROGRESS.md.)

`KIPU_AGENT_MODE` (`off` | `shadow` | `on`) selects the front door:
- `off` — legacy pipeline only (the safe default in `.env.example`; NOT the
  production posture).
- `shadow` — agent runs read-only/observed; legacy still answers.
- `on` — agent is the primary brain; legacy is the fallback on failure.
  **This is the production posture (founder/family beta).**

## Safety boundaries (these REMAIN — intelligence flexible, money safe)

Claude Code must not do the following without explicit per-task permission:

- **SQL / migrations** in `supabase/`: additive migrations are allowed when a
  capability needs them; never drop/rewrite applied objects, never weaken RLS.
  RLS stays enabled on every user-owned table. Print exact DDL; the human
  applies it.
- **Row Level Security policies / grants.** Service-role grants are
  intentional (channel handlers run without a user session).
- **Auth / session logic** (`lib/supabase-server.ts`, `lib/supabase-admin.ts`,
  login, middleware).
- **Telegram production behavior** (webhook secret, dedupe, send-message).
- **Secrets.** Never commit secrets. `.env.example` is the shape of truth.
- **Destructive DB actions.** No hard deletes of financial rows — reversals are
  append-only and auditable. No mass updates / truncates / backfills without
  approval.
- **Direct model calls from the browser.** All model calls go through a server
  action or route handler.
- **No DB write outside a typed executor.** Transaction-ledger writes go
  through the single writer module; other domain writes go through their store
  module. The LLM never issues raw SQL or writes directly.

Everything else — routing, the pipeline, response generation, prompts,
classifiers, docs — is fair game to refactor toward the vision.

## Required workflow per task

1. **Inspect first** (code + the two north-star docs).
2. **Build the AI-native way:** add/extend a tool, enrich the agent's context
   or memory, improve the agent prompt — do NOT add a regex route.
3. **Keep execution safe:** every write validated by a typed executor; ambiguity
   → ask or confirm, never guess a money movement.
4. **Run `npm run lint` and `npm run build`** — both must be clean/green.
5. **Test by behavior, not phrasing** (docs/TEST_SCRIPTS.md); keep
   `/dev/capture-test` green (356 assertions), and for stage-level work run a
   disposable-persona E2E battery + red-team pass.
6. **Report** files changed, intentional non-changes, risks, and any DDL to
   apply manually.
7. **Do not commit** unless explicitly told.

## Coding style

- TypeScript strict; no `any` in shared types.
- Pure functions in `lib/`; effects (DB, model, network) in `actions` /
  route handlers / agent executors.
- Server-only secrets. RSC by default; `"use client"` only where needed.
- Money: store `original_*` and `base_*`; display two decimals only when
  cents exist, integer otherwise; sign after the number ("25$"), never
  "USD 25.00" in user copy.
- Default to no comments; add a one-liner only when the *why* is non-obvious.

## Response & voice

- Natural LatAm Spanish. Close, playful, motivating, zero judgment, clear,
  human, financially responsible. Never expose parser/route/fallback/DB/JSON
  language as the normal experience.
- Responses are generated from structured facts + memory, not copied from a
  template. Deterministic strings are fallback/confirmation safety only.
- Consumer-facing copy always says **Kipu** (never "FinCoach"/"Kipu X").
  **Kipu X** is business/legal/investor only.

## When uncertain

- Prefer the **most intelligent safe** action, not the most rigid one.
- Ambiguous money movement → ask one natural question or confirm; never mutate
  on a guess.
- Touching a safety-boundary item → stop and ask.
- Surface risks and intentional non-changes in the final summary.
