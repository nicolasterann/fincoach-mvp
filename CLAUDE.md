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
  (Bloque M0 → M). Anything else that states a "next" is stale.
- docs/ROADMAP_MVP.md — the original 13-phase plan, kept as HISTORICAL ARCHIVE
  only. It is archaeology, not pending work. Live status lives in
  docs/BUILD_PROGRESS.md. Today: Bloques A–D, F, G, H, I, J, K and Pre-M are
  closed; only the refund fail-safe of L was built by decision; the active block
  is M0 and the visual M is blocked (see docs/ROADMAP.md).
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
- **Migrations:** 001–111 applied (088 + its fixes 089–092 on 2026-07-28;
  093–095 on 2026-07-29; Pre-M 096–099 on 2026-07-31; M0 100–107 on
  2026-08-02/03; M0 108 on 2026-08-08; M0 109–111 on 2026-08-09). The next new
  file is 112.
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
  - **Bloque K (CERRADO 2026-07-29; producción sirve `a7f99bb`, que contiene el
    commit funcional `36ed895`):** los fijos
    variables (luz/gas/internet) separan plan declarado, observación por ciclo
    y proyección prudente. La factura nativa se puede observar sin mover caja;
    pagar guarda factura+ledger+ocurrencia+forecast en UNA transacción; un
    `from_now` explícito abre régimen nuevo. El estimador usa hasta 24
    observaciones actuales del mismo régimen/moneda/cadencia, p75 robusto,
    outlier fence y fallback declarado con poca muestra. Calendario, contexto,
    Saldo/cashflow, agente y superficies consumen la proyección durable y
    fallan cerrado ante lectura incompleta. Ambient ya no pregunta por su lado.
    La 093 crea forecasts/observations/operations, estado `observed`, writer
    idempotente, convergencia desde cualquier ledger ligado y lock order común.
    La primera ejecución real destapó que correct/zero/retract de una factura
    ya pagada chocaban con una observación impaga intermedia: el ledger descarta
    el `external_ref` de la reversa que el trigger intentaba usar como marca.
    La 094 retira el hecho actual antes de la reversa dentro de la misma
    transacción y elimina esa convención muerta. PostgreSQL ya certificó K7.
    K13 destapó otra frontera real en TypeScript: el dedupe de la observación
    llevaba `operationId`, pero el del ledger no; tras undo, una nueva orden
    con el mismo monto/cuenta/fecha reusaba la transacción ya revertida.
    `variableFixedPaymentLedgerDedupe` incluye ahora la identidad durable:
    estable ante redelivery y distinta ante una orden nueva. El fixture K56
    reproduce una fila pre-K real: plan estable, ledger genérico y cero
    observaciones antes de activar variabilidad; K56/K58 fallan por nombre sin
    abortar el resto. La 095 aplicada agrega el signo
    negativo que faltaba al retract pagado, acota el bloqueo histórico al ciclo
    que conserva la factura y repara una reversa pre-K inequívoca sin impedir
    devolver caja. El harness ya no interpreta ids escalares como objetos,
    no depende del orden privado de guards y verifica `profiles` por su PK
    real. El E2E ya recorre **79/79 con exit 0, residuo cero y limpieza
    legible** (`profiles` verificada por su columna real `id`); capture
    **689/689 en el momento de cerrar K** (694 tras el micro-fix de
    reembolsos; el total VIGENTE tras Pre-M es 701) y auditoría adversarial **281/281**. Los cinco defectos de
    producto del bloque estaban TODOS en la misma frontera: el payload que se
    entrega a `kipu_apply_ledger_entry` — cast a enum ausente, `sign = -1`
    ausente, identidad de operación ausente y un `external_ref` que las reversas
    nunca persisten. La 095 fija esa paridad (2 llamadas / 2 signos) para las dos
    que cubre. El fix de `operationId` en el dedupe del pago es CÓDIGO, no
    migración, y ya está DESPLEGADO: producción sirve `a7f99bb`, que contiene el
    commit funcional `36ed895`; alias promovidos, apex/www/login en 200 y cero
    errores de runtime.
  - **Bloque L (sólo el micro-fix; el resto NO se construye):** shared/refunds
    sigue en prioridad BAJA con cero filas en producción. Se hizo únicamente el
    fail-safe que el propio roadmap señalaba: un reembolso HEREDA el registro de
    su compra original (categoría, `budget_treatment` literal incluido NULL,
    `related_transaction_id`, y la marca fixed/installment para no restaurar un
    tanque que el original nunca drenó). Antes caía a `category: "other"` en
    silencio, así que no neteaba el objetivo ni restauraba el tanque; y eso vivía
    sólo como instrucción del prompt, que no es un guard. La precedencia es
    HECHO > conjetura: original único ⇒ hereda · ambigüedad ⇒ devuelve candidatos
    con id y pregunta · id explícito incompatible ⇒ `invalid_id` (jamás degrada a
    «nunca lo registré») · lectura incompleta ⇒ cero writes · sin original ⇒
    `other` sin objetivo ni Saldo SÓLO si el usuario afirma que nunca lo registró.
    Los once schemas `category`/`newCategory` declaran su enum (las seis
    superficies de compra excluyen `income`), y `applyChatTransactionIntent` cierra
    la puerta lateral legacy: un refund sin procedencia probada no es escribible.
  - **Cierre Pre-M (CERRADO y desplegado 2026-07-31, commit `2f41a00`):** atomic Mis Datos writers, durable
    calendar/month-close cursors, current-FX TTL + daily refresh and real
    H.44/H.46 executor coverage. Its first pre-apply audit caught two lock-outs:
    web forms were calling the SECURITY INVOKER ledger as `authenticated`
    (now session-authenticated + service-role writer), and close v3 refused an
    ordinary base-only FX rounding residue (now bounded sweep + reversible
    snapshot in reopen v3). Legacy authenticated reconciliation is revoked.
    Migrations 096–099 are APPLIED (2026-07-31). Three external audit rounds each
    found a real defect the green gates had missed. 096's guard would have locked
    out the SECURITY INVOKER ledger itself — the web forms call it under the user
    session, so its own balance UPDATE ran as `authenticated` (fixed: those three
    actions authenticate with the session and write through service_role, with
    ownership still enforced inside the ledger). 097/098's native-residue sweep
    was bounded by a COUNT of native units, not by value: it erased 1000 ARS,
    5 EUR and 500 USD on a zero base leg and stamped a fabricated rate of 1 into
    its own marker. **099 is the rule: a threshold on money is expressed in the
    unit of account** — sweep only when `|native × current rate| < 0.005`, with
    the rate supplied by the caller and an outright refusal when there is none.
    Then both callers turned out to derive it from `convert(1, …).baseAmount`,
    which rounds to cents, so ARS→USD reported "no rate" with a current one in
    hand — the shared pure helper `rateToBase` (`fx-rates.ts`) is now the single
    source, and the E2E DERIVES the rate instead of hardcoding it. Gates:
    mutations 28/28, DB E2E 40/40, capture 701/701.
  - **Bloque M0 (ACTUAL/ACTIVO):** inteligencia operacional general del agente.
    Un chat real posterior a Pre-M demostró que el agente todavía podía repetir
    una pregunta de Diners ya respondida, caer en un loop vago de «me falta un
    dato» y confundir una devolución de un préstamo A FAVOR con dinero que el
    usuario pidió prestado. M0 no agrega rutas por frase: crea recuperación de
    contexto relevante, operación durable, plan tipado sin writes, preflight
    transversal, grupos atómicos, verificación post-write y respuesta natural
    desde hechos verificados. El rediseño local ya está implementado: la
    cadena 100–106 está APLICADA (2026-08-02/03): 101 corrige la llamada muerta
    `jsonb_object_length` del claim y 102 restaura el hecho exacto al reabrir una
    resolución; 103 hace seguro por CASE el cast legacy y 104 vuelve obligatoria
    y durable la pregunta de un plan READY con trabajo parcial; 105 usa el reloj
    de PostgreSQL para acotar sus propias filas; 106 admite referencias
    económicas tipadas sólo cuando clase+UUID coinciden. PostgreSQL volvió a
    62/62 dos veces después de aplicarlas. El código local cierra
    además evidencia histórica tipada, binding dinero/calendario por
    entidad+rol, reparación acotada del planner, autoridad de entidad de todas
    las entregas y fechas relativas según la zona del usuario. El boundary de
    lectura estructura sólo el tag oficial y ahora incluye el corte vigente de
    cada tarjeta (monto nativo, due/cutoff y fechas) con roles tipados; tags
    falsos, swaps de tarjeta, días truncados e ISO reinterpretados se rehúsan.
    La caída posterior 62→59 fue deriva entre el reloj web y timestamps DB: la
    **105 está APLICADA** y lee el snapshot desde PostgreSQL; el E2E volvió a
    62/62 dos veces con -24 h en el proceso. Notas/memoria del usuario quedan fuera
    del grounding lexical y el calendario abierto llega como hechos tipados por
    ocurrencia, no como un blob de prosa. La primera medición multivuelta mostró
    que ME9/ME10 esperaban saltarse la confirmación destructiva, ME10a convertía
    metadata opcional en dato faltante y las escrituras verificadas de una
    operación aún abierta no autorizaban explicar lo ya hecho. El árbol local
    corrige esas fronteras. La pasada económica posterior añade confirmación
    server-owned para repago/undo, álgebra obligatoria de capital devuelto,
    corrección atómica como undo + reemplazos individuales y repair de copy
    acotado a tres intentos bajo las mismas barreras. El primer 21/22 aisló
    ME10aa: el planner emitía la referencia canónica `account:<uuid>` y el
    preflight SQL sólo aceptaba el UUID desnudo. La 106 está APLICADA y
    admitir ambas formas sólo cuando tipo+id coinciden, y el E2E PostgreSQL ya
    usa la forma real. La pasada siguiente aisló que el adapter agrupado exigía
    `args.amount` antes de permitir que `paidInFull=true` derivara 50,60 del
    corte; el guard quedó limitado a entradas user-stated y el fixture ya omite
    amount. La primera corrida PostgreSQL real reveló el P1 simétrico: omitir
    `amount` apagaba la comparación SQL y aceptaba un payload falsificado. La
    **107 está APLICADA**; deriva el full desde la tarjeta viva
    bajo lock, conserva el monto persistido para parciales y liga también
    `expected_due`/`paid_in_card_currency`. PostgreSQL da **64/64×2**. El primer
    modelo v10 ejecutó ME10aa correctamente, pero el check consultaba la columna
    inexistente `reversed_by_transaction_id`; ahora verifica las reversas
    append-only por `related_transaction_id`, identidades exactas, delta local y
    montos 12/19. La pasada independiente siguiente quedó en 19/22 y reveló tres
    contratos app-side, no ruido: un batch ordinario explícito pedía confirmación
    sólo por tener dos montos; "hoy" podía convertirse en fecha futura al no
    llegar el día local al planner; y una explicación histórica podía omitir los
    importes verificados. La reparación v11 prueba monto↔descripción por cláusula,
    las entidades anidadas del batch, el día local antes de persistir el plan y
    la enumeración de todos los montos solicitados. ME10a ahora aterriza en el
    primer turno. La pasada v12 rechaza determinísticamente un `missing_field`
    dirigido a una devolución de capital ya ejecutable: el nombre de la
    contraparte es procedencia opcional, no identidad económica. Además, la
    publicación separa reply vacío, estructura, backstop de voz y rechazo del
    juez semántico; una confirmación server-owned se pide con lenguaje natural,
    sin dictar una frase. La pasada v13 alinea la fecha de
    `record_person_payment` como `occurredAtISO` en schema, planner y ambos
    executors; además, un campo/tipo/enum inventado se repara dentro del planner
    y jamás se presenta como un dato que el usuario pueda aportar. La pasada
    v14 corrige la medición y la garantía del caso mixto: `de una sola
    operación` deja de ser un falso regionalismo; ME4 consume la aclaración
    durable en lugar de fijar palabras del transcript; una respuesta de éxito
    parcial debe nombrar cada pendiente verificado; y
    `record_person_payment` rehúsa balances `owner="counterparty"` que su writer
    nunca modifica. La pasada v15 elimina la última medición por conjugación:
    ME5, ME9, ME10b y ME10c prueban el challenge server-owned por tool pendiente,
    ausencia de write y operación `awaiting_input`; el batch ordinario prueba el
    inverso durable. La v16 corrige la ontología del pendiente: `toolName` dice
    quién creó la aclaración, mientras `appliesToActionIds` enlaza un
    missing-field de `agent_plan` con la capacidad realmente bloqueada. La v17
    reconoció además `"$response"` como scope durable de primera clase cuando la
    ambigüedad impide, correctamente, crear una acción financiera; ME5 prueba
    ese scope sin premiar una action inventada. La primera muestra v17 reveló
    fragmentación real: la consulta de estado duplicaba el pendiente dentro de
    una segunda operación `awaiting_input`. La v18 agrega
    `plan.observed_operation_ids`: el turno de consulta queda completed, la
    operación original conserva su pregunta y su identidad, y el pendiente
    observado restringe la publicación sin convertirse en estado del turno
    nuevo. La primera auditoría v18 confirmó ese lifecycle (ME5 verde), pero
    encontró un falso positivo productivo en la barrera de publicación:
    `registrado` se interpretaba siempre como una escritura de Kipu, incluso en
    el estado previo del usuario «el préstamo que ya tienes registrado». La v19
    clasifica afirmaciones gramaticales de acción —pretérito de Kipu,
    perfecto/impersonal, resultado con `quedó` o recibo breve autónomo— y no un
    participio descriptivo. Conserva fail-closed `Registrado.`, `he registrado`,
    `se registró`, `quedó registrado` y `lo registré`; además, `de hecho` y
    `listo para confirmar` dejan de parecer recibos. La v20 cierra las cinco
    fugas adversariales posteriores: recibos tras coma/dos puntos cuentan, y
    `está registrado` sólo es historia si la misma cláusula liga una entidad de
    evidencia estructurada verificada. La migración **108 está APLICADA
    (2026-08-08)**: el undo de operación usa la ontología financiera persistida en
    `step.effects`, por lo que memoria/configuración no necesitan una transacción
    y un write económico sí. Los dos sentidos quedan probados: memoria sin
    transacción no bloquea el undo; un write económico sin transacción sí. La
    batería DB pasa a **65/65**. La v21 separa autoridad de verdad y opinión de
    estilo: grounding, recibos, estructura y voz determinista siguen bloqueando;
    el juez semántico puede pedir una sola reescritura pero nunca silenciar una
    candidata determinísticamente segura, y deja advisory durable para QA. Los
    recibos terminales se reconocen por forma gramatical y evidencia de entidad,
    no por enumerar prefijos. La auditoría v21 quedó 21/22: el planner sí declaró
    una reversa completa y dos reemplazos, pero agotó tres intentos copiando la
    coreografía mecánica de grupo/dependencias. La v22 mantiene el validador
    estricto y compila esa coreografía únicamente cuando una reversa, sus
    reemplazos individuales contiguos y su relación ya son inequívocos; jamás
    inventa acciones, target, montos ni efectos. Si el planner aun así se agota,
    el modelo primario redacta una explicación natural de no-acción sometida a
    las barreras normales, no un 500 vacío ni una pregunta imposible. El runner
    de mutaciones aborta si el capture baseline está rojo, cerrando el falso
    verde que esta misma pasada destapó. La v23 hace observable un fallo de
    intake antes del cleanup sin filtrar el candidato, prompt ni mensaje crudo,
    y distingue un seed rojo de sus checks dependientes bloqueados. Esa evidencia
    encontró una contradicción de ontología, no un transcript faltante: la tool
    llamaba `TRANSFER` al pago de tarjeta mientras el contrato exige `payment`.
    La descripción quedó alineada y un compilador guiado sólo por capability y
    modo tipados corrige la etiqueta redundante únicamente si las patas existentes
    ya satisfacen el álgebra; nunca inventa ni cambia dinero, entidad, dirección,
    owner, argumentos o dependencias. Un plan inseguro queda intacto y se rehúsa.
    La reproducción enfocada ME1–ME3 dio **3/3**. Capture **750/750**, mutaciones
    M0 **342/342**, handshake `intake-diagnostics-v23`. La auditoría congelada
    del 2026-08-09 corrió esa batería en verde más una muestra 22/22, y el
    re-audit de Codex escaló un P2 subclasificado: la lectura abierta se armaba
    con tres lectores paginados (hijos por OFFSET sin límite de snapshot; el
    keyset del padre sobre `updated_at` mutable) y podía publicar una lectura
    rota como `complete:true`. La **109 (APLICADA 2026-08-09)** la convierte en
    UNA RPC de snapshot único (`kipu_read_open_agent_operations`, CAP+1
    contado, reloj del statement, caller fail-closed por forma y membresía;
    lectores viejos eliminados) y la **110 (APLICADA 2026-08-09)** saca el
    mensaje crudo de `agent_intake_failures` conservando fingerprint e
    identidad — la promesa documental de v23 se vuelve verdadera por esquema.
    La muestra v24 quedó **20/22** y aisló otra clase real: el recibo del lote
    no declaraba montos ni entidades por fila, así que una respuesta veraz del
    batch escrito moría determinísticamente en `money_not_grounded` (500 con el
    dinero ya escrito) y la corrección caía en cascada fail-closed (el undo
    exige target `completed`). La v25 restaura la PARIDAD con el writer
    individual (recibo por fila + `data.movements` tipado), IR274 la prueba en
    puro en ambas direcciones, M0M352/353 la muerden y el contrato pasó a
    `batch-receipt-v25`. La muestra v25 quedó **20/22** con ME10a/ME10aa ya
    verdes y aisló la clase siguiente (ME9): un query semántico sin
    coincidencias se presentaba como «No hay operaciones completadas», y esa
    paráfrasis sin match se volvió un reclamo falso de inexistencia que
    bloqueó el undo — el miss de un FILTRO no es ausencia. La v26 lo cierra en
    la capa de evidencia: `queryMatched:false` + summary que distingue filtro
    de ausencia + degradación a las recientes sin filtrar
    (`recentUnfiltered`); la ausencia absoluta sólo existe sin filtro y con
    scan completo. IR275 la fija, M111.1 la prueba en runtime, M0M354–356 la
    muerden; contrato `search-miss-v26`. La muestra v26 quedó **22/22** con
    ME9/ME10a/ME10aa verdes, pero el segundo re-audit de Codex encontró DOS P2
    de fuente que un 22/22 no anula: (a) el archivo completado aún paginaba por
    offset en varios statements — bajo MVCC una operación que commitea entre
    páginas entra a la región ya leída y se PIERDE con archiveComplete=true (mi
    argumento «append-only sólo duplica» era falso); (b) `queryMatched:false`
    afirmaba una negación sobre un scan topado. La **111 (APLICADA
    2026-08-09)** lleva el archivo al contrato de la 109 (scan de candidatos en
    UN statement con CAP+1 a 120 sobre el conjunto filtrado; bundle ops+steps
    en un statement con identidad terminal verificada contra la fase 1;
    matcher Unicode en TypeScript como verdad única; reloj validado sin
    truncar microsegundos) y el veredicto pasa a TERNARIO (false exige scan
    completo; topado sin match observado ⇒ null). M111.2 prueba presencia bajo
    concurrencia, M111.3/M111.4 el ternario topado (incluida una coincidencia
    real fuera de la ventana); IR276/IR277 + M0M357–363 los fijan; contrato
    `archive-snapshot-v27`. La muestra v27 quedó **20/22** (ME9): propuesta y
    confirmación de undo CORRECTAS, y el executor rehusó con un KIPU_* que el
    wrapper colapsaba a «unsafe» — inobservable tras el cleanup. La v28 es
    pasada de OBSERVABILIDAD (doctrina v23, cero writers): `detail` KIPU_*
    acotado en el wrapper, `undoRefusal/undoDetail` persistidos en el receipt
    durable del step, y el harness de ME9 captura los steps de corrección y
    target antes del cleanup. IR278 + M0M364–366; contrato
    `undo-observability-v28`. Batería v28 (árbol `8a36cc18…`, 486 archivos):
    capture **757/757**, mutaciones **366/366**, PostgreSQL **73/73×2**, build
    limpio, residuo cero. La muestra v28 quedó **22/22**, y el re-audit de Codex
    aceptó 111 y el ternario pero encontró el P2 de CLASE que faltaba: M0
    verificaba que lo dicho fuera verdad, nunca que estuviera TODO lo que la
    pregunta necesitaba — ME2 respondió el vencimiento y omitió los 50,60 con
    todas las barreras verdes, porque la completitud se trataba como estilo.
    La **v29** separa tres autoridades: verdad/grounding (determinista),
    completitud (`plan.response_requirements`: hechos mínimos que el PLANNER
    deriva de la petición, ligados a evidencia y verificados CONTRA EL TEXTO
    con binding de entidad y rol) y voz (advisory). Un requisito que la
    evidencia no prueba jamás se exige; un valor ligado a otra entidad no
    cubre; la cobertura nunca es autodeclarada. Una omisión read-only bloquea y
    pide reparación acotada con sólo los hechos omitidos; después de una
    escritura verificada la respuesta se preserva con advisory durable — v21
    intacta. IR279–IR282 y M0M367–M0M378 lo fijaban inicialmente; contrato
    `diagnosable-turns-v32`. El muestreo obligó a tres iteraciones de la misma
    familia: un turno que PREGUNTA no arrastra el contrato; los identificadores
    internos no son prosa exigible; y —la corrección de fondo— **sólo un VALOR
    CANÓNICO es verificable contra texto libre** (importe, fecha o el
    NOMBRE de una entidad que ya existe en la evidencia). Un descriptor libre
    del planner no se exige: exigir prosa convierte la garantía en deadlock,
    que es peor que la omisión. Una comparación se cubre nombrando a su
    ganador. El audit de Codex encontró después que v32 todavía podía borrar el
    contrato al agotar la reparación, que los kinds cualitativos se fingían
    cubiertos con sólo nombrar una entidad y que un plan factual podía optar por
    contrato vacío. **v33** elimina esa autorización: sólo money/date/entity son
    deterministas, un contrato no vacío exige un `response_template` natural
    escrito por el planner con slots únicos, y el fallback sustituye únicamente
    valores canónicos probados antes de volver a pasar TODAS las barreras con el
    contrato original. Estado/pending/comparison cualitativos siguen siendo
    responsabilidad semántica del modelo, no una garantía falsa del servidor.
    IR279–IR282 + M0M367–M0M387; contrato histórico
    `canonical-fallback-v33`. La auditoría completa de Claude expuso que v33
    pedía al modelo un `value:object` sin declarar sus claves y luego rechazaba
    las formas que el modelo tenía que adivinar. **v34** convierte eso en un
    protocolo explícito y discriminado (`money={amount,currency}`,
    `date={date}`, `entity={name}`), devuelve la ruta exacta al repair acotado,
    liga valor+entidad en una misma ventana de evidencia y hace que un slot no
    probado exprese incertidumbre sin ocultar los demás hechos ni publicar el
    valor del planner. M0M388–398 fijan la clase; contrato
    `explicit-requirements-v34`. Batería local: capture **761/761**, mutaciones
    **398/398**, PostgreSQL **73/73×2**, tsc/lint/build limpios, enfocada modelo
    **3/3**, residuo cero. La muestra completa de Claude certificó ME2 y quedó
    **21/22** únicamente en ME5: el guard factual exigía un valor canónico para
    explicar un pending cualitativo, mientras v18 prohibía copiar ese pending a
    la operación de inspección. **v35** reconoce la segunda autoridad de
    completitud que ya existía en runtime: una inspección estrictamente
    read-only (`answer`, `observed_operation_ids` no vacío, cero actions y cero
    missing fields) debe su contenido al pending durable observado, que la
    frontera de publicación obliga a reconocer. No amplía los kinds ni exime
    `answer_and_act` o una respuesta sin operación observada. M0M399–401 fijan
    los dos sentidos; contrato histórico `observed-pending-v35`. La muestra
    completa externa de v35 encontró una clase previa a esa pasada: tras tres
    pagos verificados, una cifra adicional sin receipt podía hacer fallar
    `money_not_grounded` sin revelar cuál, dejando dinero escrito y HTTP 500.
    **v36** conserva el grounding estricto pero devuelve un diagnóstico acotado
    `{value, reason, roles}`, lo persiste antes del cleanup y dirige una única
    reparación para quitar sólo la cifra no probada. Después de una escritura,
    la prosa puede mencionar procedencia sin repetir montos de sueldo/saldo o
    contexto anterior que no estén en los receipts de ese turno. Además,
    observar una operación sólo sustituye el contrato canónico si TODAS las
    operaciones observadas poseen un pending durable real y TODAS las
    assertions provienen de `openOperations`; un id visible ajeno ya no puede
    lavar una respuesta factual. IR265/IR283 + M0M399–407. Contrato
    `grounding-repair-v36`. La muestra completa de Claude certificó ME4 y quedó
    21/22 en ME5: runtime exigía `assertions[].source` con una forma que el prompt
    nunca enseñaba, y devolvía sólo el error factual genérico. **v37** comparte
    una única fuente `openOperationAssertionSource` entre prompt, validador y
    fixtures; enseña exactamente
    `openOperations[<observed_operation_id>].<campo>` y devuelve la ruta
    `plan.assertions[i].source` al repair. La validación liga además el source a
    uno de los ids realmente observados, no sólo al nombre de la colección.
    IR265/IR284 + M0M399–410; contrato `observed-source-v37`. Batería: capture
    **763/763**, mutaciones **410/410**, PostgreSQL sin cambios **73/73×2**,
    tsc/lint/build limpios y modelo enfocado ME1–ME5 **5/5**, residuo cero.
    La muestra completa externa certificó ese wire en el modelo real, pero ME4
    cayó por un intake failure recuperado como HTTP 200. Su causa tipada ya
    estaba capturada en `turn.intakeDiagnostic`; `turnDetail` sólo leía la rama
    HTTP-error y el cleanup borraba la única evidencia accionable. **v38** no
    cambia planner, ejecución, dinero ni publicación: hace que el reporter
    consuma también el diagnóstico acotado del camino HTTP 200 y lo fija con
    IR270/IR285 + M0M411. Contrato `intake-reporting-v38`; capture **764/764** y
    mutaciones **411/411**. La próxima muestra debe diagnosticar ME4 por
    stage/code/attempts/validationFailures si vuelve a fallar; no se repite un
    sello opaco ni se inventa un fix sin causa.
    v38 fue auditado 22/22, comiteado como `e91df36` y desplegado, pero la
    revisión final del founder reabrió M0 inmediatamente: «acabo de pagar el
    arriendo» → Kipu pidió la cuenta; «desde Supervielle» → pidió un tercer
    consentimiento. La lectura productiva probó que el planner había resuelto
    correctamente cuenta, fijo, importe y fecha; el guard genérico creó un
    challenge `unstated_amount` porque buscó el importe durable del fijo sólo
    en el SEGUNDO mensaje. **v39** separa autoridad de usuario de autoridad
    server-owned: un registro de paths monetarios sólo exime un argumento si un
    verificador de dominio lo re-deriva exactamente del estado actual. La
    primera clase es `log_movement.amount` ligado a un fijo activo ESTABLE con
    monto/moneda nativos idénticos. Variable, catálogo ausente, divergencia o
    cualquier monto contradictorio del usuario conservan el challenge. No hay
    routing por «arriendo» ni confianza en `amount_source` del planner.
    IR286/M0M412; contrato `stored-money-authority-v39`; capture **765/765**,
    mutaciones **412/412**, tsc/lint/build limpios. Sin migración.
    El smoke disposable externo confirmó el verificador con 24/24
    adversariales, pero destapó otra clase anterior: una pregunta pendiente
    razonable podía morir en `pending_question_contract / missing_requirement_hidden`.
    El planner también podía declarar missing un path que ya estaba presente en
    su propia action. **v40** vuelve esas dos fronteras coherentes sin routing
    de frases: un argumento ya suministrado invalida el missing_field y entra al
    repair acotado; si la pregunta del planner y su repair tropiezan con el
    matcher léxico, un último fallback enumera TODOS los `answer_shape` tipados
    y vuelve a cruzar las mismas barreras deterministas. No inventa hechos,
    valores ni semántica financiera. IR287 + M0M413/414; contrato
    `pending-question-coherence-v40`; capture **766/766**, mutaciones
    **414/414**, tsc/lint/build limpios. Sin migración.
    El re-audit ejecutó el transcript exacto dos veces y demostró que la capa
    que faltaba era anterior al guard: el planner identificaba el fijo estable
    pero omitía `amount`, declaraba el mismo monto missing y volvía a
    preguntarlo. También probó que la pregunta canónica de v40 para `amount`
    era correcta pero no podía cruzar un matcher léxico que deliberadamente
    descarta «monto/exacto». **v41** compila sólo la parte mecánica después de
    la decisión semántica del modelo: para `log_movement` expense con un
    `fixedExpenseId` exacto, catálogo financiero COMPLETO y una única fila
    activa/no-variable, adopta monto+moneda nativos, marca sólo esa procedencia
    `stored_fact` y retira `amount` únicamente de las actions ya resueltas.
    Catálogo parcial, variable/inactivo/no-único, conflicto de moneda o una
    cifra contradictoria escrita por el usuario devuelven el plan intacto. La
    pregunta fallback construida desde TODOS los `answer_shape` salta sólo el
    solapamiento léxico que no puede citar keys internas; sigue pasando por el
    resto de las barreras. IR287/IR288 + M0M415–417; contrato
    `stored-plan-adoption-v41`; capture **767/767**, mutaciones **417/417**. Sin
    migración.
    El re-audit v41 certificó 21/21 adversariales y el primer turno preguntó por
    primera vez sólo la cuenta. El segundo turno llevaba un payload perfecto,
    pero el executor revalidaba `Arriendo` sólo contra «Desde mi cuenta
    Supervielle» e ignoraba la raíz user-authored de la misma operación durable.
    **v42** unifica la autoridad de entidad: los guards de entidades resueltas y
    el vínculo de gasto fijo consumen los mensajes del usuario ligados a la
    operación exacta. El turno actual manda sobre la historia: si nombra otro
    peer, invalida la entidad heredada y obliga a replanificar. Otra operación no
    presta autoridad. El matcher de fijos usa mensajes user-authored + monto
    validado; ya no usa la descripción de fila que escribió el modelo. IR289 +
    M0M418–421; contrato `durable-entity-authority-v42`; capture **768/768**,
    mutaciones **421/421**. Sin migración.
    El audit v42 certificó el transcript de Arriendo 6/6. Su gate completo
    aisló otro defecto en ME4: bounded repair trataba cada rechazo como una
    orden de conservar y parchear la action, hasta confundir la identidad de la
    operación durable con un grupo atómico de reemplazo. **v43** corrige la
    ontología y el feedback, no frases: `atomic_group` significa dependencia
    transaccional; procedencia/hechos ya asentados no son nuevas escrituras; un
    veto no prueba que la action deba existir; y una pata sin identidad
    económica sale del plan como missing de `$response` sin eliminar las
    actions independientes válidas. Los errores de efectos y de
    `log_movement` agrupado devuelven esa salida segura y prohíben inventar
    patas o undo. IR290 + M0M422–424; contrato `semantic-repair-v43`; capture
    **769/769**, mutaciones **424/424**. Sin migración.
    El audit v43 refutó esa salida: ante un préstamo inequívoco, el modelo usó
    `$response` para presentar un error de álgebra interna como dato faltante
    del usuario; ME4 mostró la misma confusión de lifecycle. **v44** separa la
    autoridad de reparación por la razón tipada del servidor —payload, wiring,
    lifecycle o general— y elimina de los errores del validador las antiguas
    instrucciones contradictorias. Un rechazo de payload no puede inventar un
    nuevo missing `$response`; una ambigüedad real ya declarada sí conserva su
    camino de pregunta. Todo `$response` liga exactamente su key a una
    ambiguity concreta con reason y sin targets de action. IR291 +
    M0M425–430; contrato `repair-authority-v44`. Sin migración.
    El relevo vigente está en
    `docs/M0_CODEX_REPAIR_AUTHORITY_V44_2026-08-12.md`; el checkpoint de
    implementación es histórico y la vara vive en `docs/ROADMAP.md`.
  - **Bloque M (BLOQUEADO por M0):** the complete front (UI, UX, navigation,
    entry points, surfaces, animations). Final visual stage — the 7 detail
    surfaces already exist against the engine; what's missing are the ways in.

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
   `/dev/capture-test` green (753 assertions), and for stage-level work run a
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
