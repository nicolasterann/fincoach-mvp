# Kipu — Build Progress

> **Stage 31 (2026-07-03) — Onboarding nítido: cada dato conectado, notas que actúan,
> validación integral.** Auditoría de conexión (10 trazadores + síntesis: cada campo del
> onboarding → persistencia → consumo real) + recorrido visual en navegador con usuario
> real + 2 personas E2E. **P0s encontrados EN VIVO y arreglados:** (1) "No pude crear tu
> perfil" en la primera carga tras login (race de cookies + 23505; ahora se recupera vía
> admin re-read — el primer contacto nunca se rinde); (2) el aporte por meta no persistía
> (insert masivo con unión de columnas → `cashflow_protected=NULL` → NOT NULL → el guard
> de esquema reintentaba SIN el aporte; ahora inserts por fila) — review 42$ ↔ dashboard
> 42.07$ coherentes; (3) **notas→acción**: las notas del onboarding quedaban inertes; ahora
> un pase post-guardado (LLM SOLO clasifica; código tipado valida y llama
> `createScheduledChange`) convierte "sube 2.5% cada 3 meses desde agosto" en un
> `adjust_percent 2.5 quarterly effective 2026-08-01` real que el cron aplica, y "me suben
> el sueldo en enero" en un reminder 2027-01-01 — verificado en BD. **Notas vivas**: el
> prompt del agente ahora incluye `| nota:` por entidad + bloque ACTIVOS + marcadores
> GUARDADA/moneda (antes se escribían y jamás se leían); recordatorios disparados se
> entregan vía ambient (`scheduled_reminder_due`) con fecha concreta y se desactivan tras
> aparecer; notas de onboarding fijadas en el digest; `set_entity_note` espeja a
> user_context_notes. **Wizard**: notas también en ingresos y metas; ingresos variables
> "por pago" + hint "≈ al mes" (fin de la inflación 4.3× semanal); FX estricto
> (micro-tasas 0.00072, multi-moneda, línea "Entendí: 1 USD = …", tasas pre-existentes);
> paquete de ~16 guías/copys; verdad del review (variable "desde X", préstamo "cuota",
> activo sin valor avisa y no se descarta silencioso); paridad preview↔save
> (payAnchorDate/mínimo); "ya es sólido"→"ya es confiable". **Save**: moneda de deuda
> convertida a base, gate FX cubre activos/metas/estimados, errores reales al usuario (no
> "algo falló"), archetype de meta persistido, nota "no tengo deudas", cuotas-que-faltan,
> statement_date, fuente de pago prefiere cuentas líquidas. **Motor**: patrimonio incluye
> cuentas no-líquidas + filtra `include_in_net_worth` + retornos ponderados al solver;
> `is_variable` real (confianza media en calendario); sin doble conteo de fijos pagados
> con tarjeta; interés préstamo-vs-tarjeta; "Ordenar mi mes" con estado "En marcha" (fin
> del regaño "Falta monto"); clamp de días month-aware; fix del cron para recordatorios
> entity-typed. Migración **037** (`investment_accounts.value_original`) aplicada. Gates
> **189/189 + 120/120 + 21/21**, tsc/lint/build verdes. Usuarios de prueba a cero.

> **Stage 30 (2026-07-02) — Verdad del Margen v2 + modelo de datos de la vida real.**
> Nace de feedback real del founder al llenar su onboarding: el Margen daba números
> irreales (−2,762$ por un gasto en la moneda equivocada; luego +3,732$/semana porque
> el horizonte se colapsaba a "días hasta el próximo de 4 sueldos" y trataba todo el
> saldo como gastable esta semana). **Margen calendario-aware**: ahora es el gasto
> diario sostenible sobre el ciclo completo (reusa la proyección día-a-día S15),
> `margenDaily = min(flujo sostenible = trulyFree/30, safe-spend timing-aware de la
> proyección)`; un buen colchón ya no infla el número. Para los datos reales del
> founder: **143$/semana (~20$/día)**, no 3,732 — validado end-to-end (motor puro +
> pipeline + agente real). **Plata protegida al 100%** (inversión completa, no
> prorrateada). **Ciclo de tarjeta real** (nuevo `card-cycle.ts`): el statement se
> agenda en su fecha de vencimiento con el monto del corte anterior; el saldo que se
> acumula es deuda futura (nunca se reserva hoy); estimado antes del corte (contrato
> de confianza), afinado después; detección de pagado B(rastrear)+A(asumir si venció)
> +C(confirmar montos grandes). **Sin doble conteo**: un gasto con tarjeta se salda en
> el pago del statement, no se cuenta dos veces. **Objeto `capacity`** (income−fijos−
> deuda−esenciales = disponible; −protegido = trulyFree) para **onboarding capacidad-
> primero**: muestra "te quedan X libres" ANTES de pedir ahorro/inversión/meta, con
> recomendación y "te queda Z/día" en vivo. **Onboarding rediseñado** (sigue
> estructurado): nuevo orden con pasos de **activos** y **capacidad+asignación**,
> **fijo vs estimado** separados, toggle **"varía mes a mes"**, **FX guiado** (1 USD =
> [campo]), **formulario de préstamo** distinto al de tarjeta, **notas por fila** que
> Kipu recuerda y agenda (se conecta a `scheduled_changes`). **Chat controla lo nuevo**
> (109 tools): `add_asset`/`update_asset`/`remove_asset` (soft), `set_entity_note`
> (+recordatorio), `register_card_payment` (transferencia, baja deuda, marca el ciclo
> pagado, sin doble conteo), `card_status`, `is_variable` en fijos. **Desglose
> expandible del Margen** (#9) + vista de capacidad + conciencia del ciclo de tarjeta
> en el dashboard/deuda. **Fix de honestidad multi-moneda**: `foreignUnconverted` ya
> no marca "sin tasa" a cuentas que SÍ se convirtieron (afectaba a todo usuario LatAm
> con pesos+tasa). **Activos** reusan `investment_accounts` (S17), expuestos ahora en
> onboarding+chat; suman a patrimonio, nunca al Margen. Migraciones **035** (is_variable,
> notes en cuentas/deudas/metas, last_payment_date) y **036** (RLS authenticated para
> investment_accounts) aplicadas en prod. Gates 179/81/21, tsc/lint/build verdes, QA en
> vivo con los datos reales del founder limpiado a cero.

> **Stage 29 (2026-07-02) — Cierre de brechas pre-beta founder/familia: verdad del
> Margen (confidence-aware), chat 100% control, y primer contacto honesto.** Motor de
> **contrato de confianza**: `MargenKipuResult` ahora expone `confidence`
> (`solid|estimated|preliminary`), `essentialsKnown`, `dataAgeDays`, `marginGaps[]` —
> poblados en `coaching-signals` (`enrichMargenConfidence`). El número **nunca se baja
> falsamente**; se flaggea cuando los datos son débiles y se ofrece la acción para
> mejorarlo. **3 fixes de motor**: (1) safe-spend ya no se infla cuando el gasto
> esencial es 0 por poca historia — se marca preliminar y el cashflow deja de ser
> "high" con `essentialBurnKnown=false`; (2) capacidad de metas ahora resta el MISMO
> gasto esencial que el cashflow (fin de la contradicción metas-vs-flujo) + flag
> `capacityPreliminary`; (3) `safe_weekly` guardaba un valor DIARIO bajo nombre semanal
> → ahora `margenWeekly` (histórico ~7× correcto, forward-only). **Chat 100% control**:
> 109 tools (9 nuevas — `close_account`/`close_card` soft-close auditable via migración
> 034 `status`, `rename_card`, `change_account_currency` solo-si-vacía,
> `update_scheduled_payment`, `cancel_scheduled_payment`, `change_base_currency`
> solo-si-sin-datos, `report_bug`→`user_feedback`, `explain_my_data`) + `update_goal`
> con `cancelled` — todo lo destructivo confirma y valida contra estado real. **Money
> safety**: writer legacy ya no fabrica 1:1 en moneda extranjera sin tasa (lanza
> `KIPU_FX_REQUIRED`, guardado en los 5 call sites → degrada honesto); acción deprecada
> `createChatParsedTransactionAction` (muerta) enrutada al pipeline seguro, 322 líneas
> inseguras removidas. **Primer contacto (onboarding estructurado se mantiene)**:
> empty-state honesto en dashboard (fin del "0$/cuida el ritmo" día 1), chip+nota de
> confianza en Margen/cashflow con acción de prefill, FX pedido al elegir la moneda y
> recuperable in-place (fin del dead-end al confirmar), gasto esencial más prominente,
> copy del landing/signup honesto (2-min, foto/PDF/voz, "por invitación"). **Hogar/
> ajustes**: privacidad explícita, botón copiar-invitación, export honesto, "reportar
> problema" persiste de verdad. Migración **034** aplicada en prod (accounts/debt_accounts
> `status` + `user_feedback` con RLS). Gates 166+/81/21, tsc/lint/build verdes, QA en
> vivo con usuario desechable limpiado a cero. Sin onboarding conversacional; cron diario
> aceptado para beta (docs honestos).

> **Stage 27 (2026-07-02) — Elevación UI/UX pre-beta: dashboard vivo + drilldowns
> por métrica.** Lenguaje visual nativo Kipu: **LivingThread** (anillo de hebras
> de quipu tejidas con nudos, SVG+CSS puro, cero JS/hidratación, colores por
> estado real de la métrica) en Margen/Pulso/Metas/Patrimonio/Kipu Fit; nuevo
> vocabulario de motion en globals.css (draw-in con pathLength=1, rise, fade-up,
> stagger, pop, shimmer, press) con `prefers-reduced-motion` cubriendo TODO
> (from-hidden→to-natural: sin animación se ve el estado final) y `:focus-visible`
> global. **Kit vivo** en components/living/: CurveChart (modo continuo para
> series diarias computadas y modo dotted con EJE TEMPORAL real para snapshots
> dispersos — un hueco de 27 días se ve como hueco; dots como trazos round-cap
> non-scaling), ProgressStrand (cordón con nudo), MetricShell/Section/PressCard/
> ChatCta, LearningState, skeletons. **Dashboard 100% clickeable**: tarjetas
> muertas eliminadas (Patrimonio→/app/wealth, Monedas→/app/fx, Lo que viene→
> /app/cashflow, gasto→/app/spending, trend pills→su métrica, filas de actividad,
> insight sin CTA), affordances kipu-press+chevron, categorías EN ESPAÑOL
> (housing→Vivienda etc.), stagger de entrada. **4 páginas nuevas**: /app/cashflow
> (curva día a día real con marcadores de riesgo + calendario + supuestos),
> /app/spending (presupuesto semanal vs normal, categorías ~35 días honestos,
> suscripciones, anomalías), /app/wealth (patrimonio con composición SIN doble
> conteo, meta, inversiones), /app/fx (tasas como número plano, fuentes, honestidad
> manual>referencia). **Páginas enriquecidas**: margen (tendencia de snapshots +
> "qué lo movió" + fechas humanizadas + fórmula del anillo IDÉNTICA al dashboard),
> readiness (pesos reales 30/25/20/15/10, orden por impacto ponderado, "punto más
> flojo" = score mínimo real, próxima jugada), debt (usa briefing.debtHealth con
> pagos reales — fix de divergencia web/chat — + plan de pago planPayoff + tendencia),
> goals (ritmo comprometido + brecha honesta + joy budget + proyección estimada +
> celebración), household (miembros, prefills de cuadre EN MONEDA BASE, explicador
> de privacidad), kipu-fit (confianza + frescura + 8 dimensiones), activity (moneda
> base del perfil, totales netean reversos = coherencia con dashboard, resumen 7d,
> filas accionables). **Shell**: 16 loading.tsx con skeletons shimmer, Ajustes en
> nav móvil + mapa de tab activo por sección, 404/error raíz en español, pending
> states (SubmitButton useFormStatus) en login/signup/reset/FX, inputs text-base
> (iOS), tap targets ≥44px. **Review adversarial (18 agentes)**: 15 hallazgos
> confirmados → 15 corregidos (P1: prefills de chat llevaban moneda de display al
> agente → siempre base; :focus-visible deformaba controles; 2 textos contradecían
> números visibles). Cero dependencias nuevas. Gates 166/81/21 ×2, tsc/lint/build
> verdes, QA visual viva (desktop+375px) con usuario desechable limpiado a cero.

> **Stage 26 (2026-07-02) — Chat = superficie de control universal + cierre de
> limitaciones.** El chat ahora crea/edita/pausa/corrige/programa TODO: **13 tools
> nuevas** (update_income, create_income, schedule_change, list/cancel_scheduled_change,
> update_account rename, update_fixed_expense extendido con pause/resume/delete/rename/
> dueDay/currency, edit/cancel_shared_expense, remove_household_member,
> remove_recurring_shared_expense, share/unshare_movement, export_my_data) + bloque
> "CONTROL TOTAL POR CHAT" en el prompt. **Motor de cambios programados**: tabla
> `scheduled_changes` (migración 033, additive, RLS deny-by-default), store con
> validación (moneda del plan vs objetivo, set_frequency, fechas), ejecutor diario
> (cron 12:00 en vercel.json, bearer CRON_SECRET estricto) con claim atómico CAS —
> imposible aplicar dos veces el mismo ciclo; fechas pasadas hacen fast-forward sin
> drip-compounding; fallos quedan en español humano en la nota. Pre-migración todo
> degrada honesto (PGRST205 → "no pude dejarlo programado"). **46 hallazgos
> confirmados por 2 workflows adversariales (57 agentes) — todos corregidos**, entre
> ellos: payNow con cambio de moneda fabricaba 1:1; fallbacks de cero coincidencias
> editaban/cancelaban a ciegas (ingreso/cuenta/cambio programado) → solo referencias
> genéricas; updateFixedExpenseFields devolvía éxito con 0 filas; total_original
> corrompido al editar compartidos; ?share= auto-enviaba texto de links externos al
> agente (CSRF/prompt-injection) → ahora solo prefill; token de invitación ajeno
> renderizaba banner propio → verificación de pertenencia; ?message=constructor
> renderizaba banner fantasma; sacar al dueño del hogar por un admin → jerarquía de
> roles; advertencia de saldo pendiente antes de sacar a un miembro. **UI**: banners
> ?message en /app y /app/goals (whitelist), insight negativo ya no duplica el hero,
> tarjeta "Mis datos" + export JSON (RLS, honesto con el tope de 1000 movimientos) en
> Ajustes, entrada "Ayuda y reportar un problema", UI de link de invitación copiable
> con vencimiento, CTAs de Kipu Fit al chat. **QA viva** (usuario desechable, agente
> real): sueldo, pausa/reactiva, guard anti-adivinanza, rename+alias, compartir/editar/
> descompartir, sacar miembro con deuda advertida, export, "qué registraste hoy" — todo
> verificado contra la DB (ledger append-only, saldos exactos, 0 datos residuales).
> Gates: capture-test 166/166 (+2 suites S26), wizard 81/81, loop 21/21, lint+build
> verdes. (Migración 033 quedó pendiente al cierre de S26 por MCP caído; **aplicada
> en producción el 2026-07-02** — verificada: tabla + índices + RLS deny-by-default.)

> **Stage 25 (2026-07-01) — Beta Readiness Mega Review: PRODUCTION-READY.**
> Revisión end-to-end (mapa de sistema + 16 dimensiones + pruebas vivas con usuarios
> desechables y AI real). **4 P0 arreglados**: (1) carrera del perfil en /onboarding
> ("No pude crear tu perfil" al primer segundo); (2) motores sumaban montos nativos
> como base (Margen −976k$ con datos reales del founder) → normalización a base en el
> context-builder; (3) parser básico sin detección de moneda + writer `rate ?? 1` →
> detección + resolución honesta en el writer único; (4) onboarding_completed se
> marcaba ANTES de los inserts (loop de redirects) → al final. **Coherencia de un solo
> número**: chat (advisory + post-registro + digest del agente + tools) y /app/margen
> citan el MISMO margenKipu del hero. **Hogar**: aceptar invitación reclama al
> participante externo homónimo (sin duplicar "Milena"), un miembro existente no quema
> el link, default de nombre = etiqueta de la invitación, links con soykipu.com, FX
> honesto en gastos compartidos. **Auth**: recuperación de contraseña completa
> (/login/reset + /reset-password), forms con action en el <form> (el fallback nativo
> pre-hidratación era GET con la contraseña en la URL), reenviar confirmación,
> redirect si ya hay sesión, copy unificado (tuteo). **Onboarding**: bloqueo honesto
> si hay moneda extranjera sin tasa, CSV acepta ';' (Excel LatAm) y moneda default =
> base, parseFxRateString ya no invierte tasas ("1480 ARS = 1 USD"), selector de
> moneda para presupuestos por categoría (convierte a base). **Agente**: resolver de
> moneda usa las tasas del usuario (no re-pregunta), prompt prohíbe conversión por el
> modelo, correcciones cross-moneda piden en vez de corromper, create_card/account con
> base honesto. Gates: capture-test 164/164, wizard-test 81/81, onboarding-loop 21/21,
> lint+build verdes. Postura beta: `KIPU_AGENT_MODE=on` + `TRANSACTION_PARSER_MODE=
> ai_with_basic_fallback` + `NEXT_PUBLIC_SITE_URL`/`KIPU_APP_BASE_URL` en Vercel
> (ver docs/FOUNDER_BETA_GUIDE.md v2, que también trae la receta "casa como empresa"
> para el caso real del founder y los scripts de Milena/mamá/primo).


## Phase 3 execution status

### Completed

- [x] Local environment verified
- [x] Homebrew installed
- [x] Node.js and npm installed
- [x] Next.js project created
- [x] Product spec created
- [x] Technical spec created
- [x] Agent instructions created
- [x] Initial project structure created
- [x] Base financial domain types created
- [x] Money utilities created
- [x] Flexible spending calculation created
- [x] Financial demo data created
- [x] Demo financial dashboard created
- [x] Goal progress calculation created
- [x] Goal feasibility calculation created
- [x] Debt pressure calculation created
- [x] Budget reality calculation created
- [x] Financial dashboard aggregator created
- [x] Dashboard UI connected to financial aggregator
- [x] Transaction intent types created
- [x] Transaction application engine created
- [x] Transaction engine dev test page created
- [x] Basic transaction intent parser created
- [x] Parser + financial engine dev test page created
- [x] Supabase project created
- [x] Supabase client packages installed
- [x] Environment variable template created
- [x] Local Supabase environment configured
- [x] Supabase browser client created
- [x] Supabase server client created
- [x] Supabase connection test page created
- [x] Initial Supabase schema SQL created
- [x] Initial Supabase schema applied in Supabase
- [x] Core tables verified in Supabase Table Editor
- [x] Visual login page created
- [x] Supabase email/password sign up created
- [x] Supabase email/password sign in created
- [x] Email confirmation tested
- [x] Session reading tested
- [x] Profile row creation verified
- [x] Protected /app route created
- [x] Unauthenticated users redirected to /login
- [x] Authenticated user email displayed in /app
- [x] Logout action created and tested
- [x] Protected onboarding route created
- [x] Authenticated profile reading created
- [x] Missing profile auto-creation added
- [x] Basic profile update form created
- [x] Profile preferences saved to Supabase
- [x] Account creation action created
- [x] Account creation form added to onboarding
- [x] User accounts read from Supabase
- [x] Account creation tested with real authenticated user
- [x] Debt account creation action created
- [x] Debt accounts read from Supabase
- [x] Debt accounts shown in onboarding
- [x] Debt/credit card creation form added
- [x] Debt/credit card creation tested with real authenticated user
- [x] Goal creation action created
- [x] Goals read from Supabase
- [x] Goals shown in onboarding
- [x] Main goal creation form added
- [x] Main goal creation tested with real authenticated user
- [x] Supabase financial mappers created
- [x] User financial data loader created
- [x] Protected /app dashboard connected to real Supabase data
- [x] Real accounts, debt accounts and main goal displayed in /app
- [x] Transactions schema SQL created
- [x] Transactions schema applied in Supabase
- [x] Transactions table verified in Supabase Table Editor
- [x] Manual expense creation action created
- [x] Recent transactions read from Supabase
- [x] Recent transactions shown in /app
- [x] Manual expense form added to /app
- [x] Manual expense creation tested with real authenticated user
- [x] Manual account-paid expense decreases account balance
- [x] Manual credit-card-paid expense increases debt balance
- [x] Dashboard recalculates after manual expense balance updates
- [x] Manual income creation action created
- [x] Manual income form added to /app
- [x] Manual income increases selected account balance
- [x] Manual income appears in recent movements
- [x] Goal contribution action created
- [x] Goal contribution form added to /app
- [x] Goal contribution decreases source account balance
- [x] Goal contribution updates main goal progress
- [x] Goal contribution appears in recent movements
- [x] Expense validation prevents selecting account and credit card at the same time
- [x] Expense source helper text improved
- [x] Double-source expense validation tested
- [x] Chat-style transaction input added to /app
- [x] Chat parsed transaction action connected to basic parser
- [x] Chat parser account-paid expense tested
- [x] Chat parser credit-card-paid expense tested
- [x] Parser fixed to prefer account unless debt/card signal is present
- [x] Transaction parser contract created
- [x] Basic parser adapter created
- [x] AI transaction parser schema created
- [x] OpenAI parser environment variable documented
- [x] OpenAI package installed
- [x] OpenAI transaction parser shell created
- [x] AI parser kept disabled by default
- [x] Transaction parser mode environment variable documented
- [x] Transaction parser router created
- [x] Chat action uses transaction parser router
- [x] Basic parser remains default and was tested through router
- [x] Real main goal context passed into transaction parser router
- [x] Chat parser still works after adding real goal context
- [x] Basic parser recognizes simple goal contribution phrases
- [x] Chat goal contribution uses real main goal
- [x] Chat goal contribution decreases source account balance
- [x] Chat goal contribution updates goal progress
- [x] Chat goal contribution appears in recent movements
- [x] Basic parser recognizes simple income phrases
- [x] Chat income registers transaction
- [x] Chat income increases destination account balance
- [x] Chat income appears in recent movements
- [x] Chat response mapper created
- [x] Chat transaction result helper created
- [x] Chat result helper connected to income flow
- [x] Chat result helper connected to expense and goal contribution flows
- [x] Chat flows retested after response helper integration
- [x] Channel-agnostic chat transaction handler created
- [x] Chat transaction intent application helper created
- [x] Handler connected to parser and transaction application
- [x] Dev test page created for channel-agnostic handler
- [x] Handler tested with real account-paid expense
- [x] Handler returns conversational response object
- [x] Telegram webhook base URL documented
- [x] Telegram user links schema SQL created
- [x] Telegram user links schema applied in Supabase
- [x] Telegram user links table verified in Supabase
- [x] Telegram webhook route shell created
- [x] Telegram webhook secret validation added
- [x] Telegram webhook parses chat id and text
- [x] Telegram webhook shell tested locally with curl
- [x] Supabase service role environment variable documented
- [x] Supabase admin client created
- [x] Telegram webhook looks up linked user by telegram_chat_id
- [x] Service role grants added for telegram_user_links
- [x] Telegram unlinked response tested locally
- [x] Dev Telegram link page created
- [x] Telegram linked response tested locally
- [x] Telegram webhook connected to channel-agnostic transaction handler
- [x] Channel handler switched to Supabase admin client for Telegram compatibility
- [x] Financial service role grants added for Telegram handler
- [x] Telegram simulated expense tested with curl
- [x] Telegram webhook updates account balance through handler
- [x] Telegram webhook returns conversational transaction response
- [x] Telegram sendMessage helper created
- [x] Telegram webhook attempts to send conversational response to chat
- [x] Telegram webhook remains testable through JSON response
- [x] Telegram webhook handles missing bot token without breaking transaction processing
- [x] Telegram setup documentation created
- [x] BotFather setup documented
- [x] Telegram environment variables documented
- [x] Telegram local testing documented
- [x] Telegram security notes documented
- [x] Deployment readiness documentation created
- [x] Production environment variables documented
- [x] Deployment order documented
- [x] Known production risks documented
- [x] Vercel selected as recommended deployment provider
- [x] Vercel deployment documentation created
- [x] Repository confirmed clean before production build
- [x] Production build errors fixed
- [x] Local production build passes successfully
- [x] GitHub remote connected
- [x] Repository pushed to GitHub
- [x] Local branch tracking origin/main
- [x] Repository imported into Vercel
- [x] Production environment variables configured in Vercel
- [x] Production app deployed successfully
- [x] Production webhook endpoint tested with unlinked chat
- [x] Real Telegram chat id obtained
- [x] Real Telegram chat linked to FinCoach user
- [x] Production webhook tested with linked real Telegram chat
- [x] Telegram bot sendMessage confirmed from production
- [x] Real Telegram webhook registered
- [x] Real Telegram message processed successfully
- [x] Real Telegram bot registers expense and updates balance
- [x] Telegram processed updates schema created
- [x] Telegram processed updates schema applied in Supabase
- [x] Telegram duplicate update protection added
- [x] Duplicate Telegram update tested locally
- [x] Duplicate Telegram update ignored successfully
- [x] Duplicate protection passed lint and production build
- [x] Vercel connected to deployment repository
- [x] Latest MVP code pushed to Vercel deployment repository
- [x] Vercel redeployed with duplicate protection commit
- [x] Production duplicate update protection tested
- [x] Production duplicate Telegram update ignored successfully
- [x] Real Telegram income tested successfully
- [x] Real Telegram goal contribution tested successfully
- [x] Real Telegram credit-card expense tested successfully
- [x] Real Telegram flows update correct account/debt/goal balances
- [x] Telegram /start response added for linked users
- [x] Telegram /start response added for unlinked users
- [x] Telegram unlinked-user response improved
- [x] Telegram /start tested locally for linked chat
- [x] Telegram /start tested locally for unlinked chat
- [x] Basic parser clarification message improved
- [x] Unclear Telegram input tested locally
- [x] Clarification response sent successfully to Telegram
- [x] Clarification improvement passed lint and production build
- [x] Vercel redeployed after clarification improvement
- [x] Unclear Telegram input tested in production
- [x] Friendly clarification response confirmed in production Telegram
- [x] Basic parser supports debt payment intent
- [x] Debt payment application helper added
- [x] Debt payment chat response added
- [x] Debt payment tested locally from Telegram webhook
- [x] Debt payment passed lint and production build
- [x] Debt payment deployed to production
- [x] Real Telegram debt payment tested successfully
- [x] Debt payment decreases source account and debt account without duplicate expense
- [x] Recent movements display reviewed
- [x] Debt payment displays as Pago de deuda instead of Gasto
- [x] Credit-card expense displays as Gasto con tarjeta
- [x] Transaction categories translated in recent movements
- [x] Transaction amounts display signs by movement type
- [x] User financial preferences schema created
- [x] User financial preferences grants added
- [x] Dev preferences page created
- [x] Default payment method can be saved
- [x] Basic parser uses default payment method when source is omitted
- [x] Default payment method tested locally
- [x] Default payment method deployed to production
- [x] Real Telegram expense without source tested successfully
- [x] Real Telegram default payment method updates account balance
- [x] Dev preferences page shows default payment method name instead of raw id
- [x] Dev preferences page typo fixed
- [x] Explicit payment source overrides default payment method
- [x] Default card behavior tested successfully
- [x] Default card registers expense as debt without lowering cash account
- [x] Flexible spending calculation reviewed
- [x] Flexible spending dashboard card improved
- [x] Flexible spending breakdown added
- [x] Flexible spending shows available cash, debt payments, recurring expenses and goal contribution
- [x] Flexible spending breakdown tested locally
- [x] Flexible spending breakdown passed lint and production build
- [x] Dynamic flexible spending helper text added
- [x] Flexible spending helper text adapts to negative, low or healthy margin
- [x] Dynamic flexible spending helper tested locally
- [x] Dynamic flexible spending helper passed lint and production build
- [x] Protected goal money added to flexible spending breakdown
- [x] Protected goal money uses current goal amount when no separate goal account exists
- [x] Dashboard clarifies goal money is separate from spendable cash
- [x] Protected goal money tested locally
- [x] Protected goal money passed lint and production build
- [x] Basic weekly plan calculation created
- [x] Weekly plan uses flexible spending as weekly available margin
- [x] Weekly plan calculates daily suggested limit
- [x] Weekly plan card added to dashboard
- [x] Weekly plan tested locally
- [x] Weekly plan passed lint and production build
- [x] Weekly plan helper copy improved
- [x] Weekly plan helper handles healthy, tight and negative weeks
- [x] Weekly plan helper copy tested locally
- [x] Weekly plan helper copy passed lint and production build
- [x] Chat response mapper supports financial context
- [x] Chat transaction result accepts financial context
- [x] Telegram success responses include flexible spending
- [x] Telegram success responses include weekly daily limit
- [x] Flexible spending now considers current credit-card debt
- [x] Enriched Telegram response tested locally
- [x] Enriched Telegram response passed lint and production build
- [x] Enriched Telegram response deployed to production
- [x] Real Telegram enriched response tested successfully
- [x] Enriched Telegram expense response tested successfully
- [x] Enriched Telegram income response tested successfully
- [x] Enriched Telegram goal contribution response tested successfully
- [x] Enriched Telegram debt payment response tested successfully
- [x] Financial context recalculates after each main movement type
- [x] Enriched Telegram response tone shortened
- [x] Short enriched response tested locally
- [x] Short enriched response passed lint and production build
- [x] Short enriched response deployed to production
- [x] Real Telegram short enriched response tested successfully
- [x] Fallback Telegram responses made more coach-like
- [x] Debt payment fallback copy clarified
- [x] Coach-like fallback response tested locally
- [x] Coach-like fallback response passed lint and production build
- [x] Coach-like fallback response pushed to production repo
- [x] OpenAI transaction parser typos fixed
- [x] Safe AI parser fallback mode added
- [x] Parser mode ai_with_basic_fallback documented
- [x] AI parser fallback tested locally
- [x] Basic parser remains stable fallback when AI is unavailable or low confidence
- [x] Safe AI parser fallback passed lint and production build
- [x] Safe AI parser fallback pushed to production repo
- [x] AI parser schema and system prompt inspected
- [x] AI parser prompt limited to MVP-ready transaction types
- [x] AI parser prompt returns unsupported for non-MVP movement types
- [x] OpenAI parser now requests JSON object responses
- [x] Hardened AI parser prompt passed lint and production build
- [x] Hardened AI parser prompt pushed to production repo
- [x] Current OpenAI model options reviewed
- [x] AI transaction parser model selected: gpt-5.4-mini
- [x] Future AI coach model selected: gpt-5.4
- [x] Deep analysis model selected: gpt-5.5
- [x] Environment example updated with AI model configuration
- [x] OpenAI parser default model updated to gpt-5.4-mini
- [x] AI model configuration passed lint and production build
- [x] AI model configuration pushed to production repo
- [x] Dev AI parser testing harness created
- [x] AI parser test page added at /dev/ai-parser-test
- [x] AI parser test action added without applying transactions
- [x] Basic parser tested through AI parser test page
- [x] Direct AI parser handles invalid API key safely
- [x] AI with basic fallback tested through dev page
- [x] AI parser testing harness passed lint and production build
- [x] AI parser testing harness pushed to production repo
- [x] AI coach response contract created
- [x] Coach financial snapshot builder created
- [x] Fallback coach response builder created
- [x] AI coach base structure passed lint and production build
- [x] AI coach base structure pushed to production repo
- [x] Real OpenAI API key configured locally
- [x] AI parser tested with gpt-5.4-mini in dev page
- [x] AI parser uses default payment source
- [x] AI parser maps expense categories to allowed values
- [x] AI parser validated expense interpretation
- [x] AI parser validated income interpretation
- [x] AI parser validated goal contribution interpretation
- [x] AI parser validated debt payment interpretation
- [x] AI parser validated unsupported case
- [x] AI parser validated needs clarification case
- [x] AI parser real validation behavior passed lint and production build
- [x] AI parser real validation behavior pushed to production repo
- [x] Telegram local tested with ai_with_basic_fallback and real OpenAI key
- [x] Telegram local confirmed AI parser source through webhook debug metadata
- [x] Telegram local confirmed AI parser confidence score through webhook debug metadata
- [x] Telegram local AI parser applied expense transaction correctly
- [x] Telegram local AI parser kept enriched financial context response working
- [x] Parser debug metadata added to Telegram webhook JSON response
- [x] Parser debug metadata passed lint and production build
- [x] Parser debug metadata pushed to production repo
- [x] Telegram local AI parser validated income
- [x] Telegram local AI parser validated goal contribution
- [x] Telegram local AI parser validated debt payment
- [x] Telegram local AI parser validated unsupported case
- [x] Telegram local AI parser validated needs clarification case
- [x] AI fallback router hardened to avoid unsafe basic fallback
- [x] Unsupported AI results no longer fall back to basic parser when confidence is high
- [x] AI clarification results can bypass basic fallback when clarification is clear
- [x] Basic parser typo fixed
- [x] Hardened AI parser fallback behavior passed lint and production build
- [x] Hardened AI parser fallback behavior pushed to production repo
- [x] OpenAI API key added to Vercel Production
- [x] OpenAI transaction parser model added to Vercel Production
- [x] OpenAI coach model added to Vercel Production
- [x] OpenAI deep analysis model added to Vercel Production
- [x] Vercel production parser mode kept on basic
- [x] Vercel redeployed after OpenAI env var setup
- [x] Production Telegram tested after redeploy
- [x] Production confirmed stable with basic parser after OpenAI env var setup
- [x] Production TRANSACTION_PARSER_MODE changed to ai_with_basic_fallback
- [x] Production redeployed after controlled AI parser rollout
- [x] Production AI parser rollout validated expense
- [x] Production AI parser rollout validated income
- [x] Production AI parser rollout validated goal contribution
- [x] Production AI parser rollout validated debt payment
- [x] Production AI parser rollout validated unsupported transfer case
- [x] Production AI parser rollout validated needs clarification case
- [x] Rollback switch confirmed: TRANSACTION_PARSER_MODE=basic
- [x] AI coach response prompt created
- [x] OpenAI coach response generator created
- [x] Dev AI coach response test page created at /dev/coach-response-test
- [x] Dev AI coach response test action created without applying transactions
- [x] AI coach responses tested for expense
- [x] AI coach responses tested for income
- [x] AI coach responses tested for goal contribution
- [x] AI coach responses tested for debt payment
- [x] AI coach prompt refined for more natural weekly/daily money wording
- [x] AI coach dev test passed lint and production build
- [x] AI coach dev test pushed to production repo
- [x] Coach response mode env flag added to .env.example
- [x] Coach response router created
- [x] AI coach response router defaults to fallback mode
- [x] AI coach response router falls back safely if AI response fails
- [x] AI coach response router wired after successful transactions
- [x] AI coach debug metadata added to Telegram webhook JSON response
- [x] Local Telegram tested with COACH_RESPONSE_MODE=fallback
- [x] Local Telegram tested with COACH_RESPONSE_MODE=ai
- [x] Local AI coach validated expense response
- [x] Local AI coach validated income response
- [x] Local AI coach validated goal contribution response
- [x] Local AI coach validated debt payment response
- [x] Local AI coach confirmed inactive for unsupported case
- [x] Local AI coach confirmed inactive for needs clarification case
- [x] AI coach feature-flag integration passed lint and production build
- [x] Vercel COACH_RESPONSE_MODE added as fallback
- [x] Production redeployed with COACH_RESPONSE_MODE=fallback
- [x] Production confirmed stable with coach fallback response
- [x] Production COACH_RESPONSE_MODE changed to ai
- [x] Production redeployed with AI coach enabled
- [x] Production AI coach validated income response
- [x] Production AI coach validated expense response
- [x] Production AI coach validated goal contribution response
- [x] Production AI coach validated debt payment response
- [x] Production AI coach confirmed inactive for unsupported case
- [x] Production AI coach confirmed inactive for needs clarification case
- [x] AI module production rollout completed
- [x] AI parser rollback switch confirmed: TRANSACTION_PARSER_MODE=basic
- [x] AI coach rollback switch confirmed: COACH_RESPONSE_MODE=fallback
- [x] Onboarding/context schema designed
- [x] Onboarding/context migration created
- [x] Onboarding/context migration applied in Supabase
- [x] New onboarding/context tables validated in Supabase
- [x] Authenticated grants validated for onboarding/context tables
- [x] Profiles grants added for context builder access
- [x] Onboarding/context TypeScript types created
- [x] Onboarding/context Supabase mappers created
- [x] User Financial Context Builder created
- [x] User Financial Context Builder tested with real user data
- [x] Dev page created at /dev/user-financial-context-test
- [x] Financial goal feasibility copy typo fixed
- [x] Current onboarding page refactored into cleaner layout
- [x] Conversational onboarding architecture created
- [x] Onboarding step completion rules hardened
- [x] Kipu brand naming applied to onboarding direction
- [x] Premium guided interview UI created for onboarding
- [x] Cursor local settings ignored in git
- [x] Interactive local onboarding interview prototype created
- [x] Local mock onboarding interpreter added
- [x] Onboarding collection steps require explicit user confirmation before advancing
- [x] Onboarding mock avoids bogus entities from generic confirmations
- [x] Onboarding panel “Ya entendí” updates from local draft
- [x] Legacy onboarding forms preserved under current data configuration
- [x] Onboarding draft save action created
- [x] Review confirmation button connected to save flow
- [x] Confirmed onboarding draft persists profile, accounts, debts, goals, income sources, fixed expenses, and coach preferences
- [x] Onboarding completion redirects to app
- [x] Saved onboarding data validated through user financial context test
- [x] Mock account parser fixed to avoid generic account names like Tengo/Cuenta
- [x] Profile onboarding flow fixed to ask currency before coach tone preferences
- [x] AI onboarding engine foundation created
- [x] Onboarding draft patch applier added
- [x] Onboarding interview connected to AI engine router
- [x] Onboarding AI edge cases hardened
- [x] Manual onboarding replay validated with accounts, debts, income, expenses, goals, and coach preferences
- [x] End-to-end onboarding persistence validated locally
- [x] End-to-end onboarding persistence validated in Vercel
- [x] Onboarding saved context validated through /dev/user-financial-context-test
- [x] Coach tone preference normalization added
- [x] Direct coach tone now maps to coach_like
- [x] Onboarding tone preference validated after save
- [x] /app data source switched from loadUserFinancialData to buildUserFinancialContext
- [x] /app dashboard now uses real income and fixed expense estimates instead of hardcoded values
- [x] Kipu brand name applied in /app header (removed FinCoach reference)
- [x] /app header personalized with user first name from profile
- [x] First-use summary cards added: available cash, total debt, monthly fixed commitments, main goal progress
- [x] "Lo que Kipu entendió de ti" section added with income sources, fixed expenses, debts, goal, and coach tone
- [x] "Tu siguiente mejor paso" contextual next step added based on goal contributions, debt pressure, and transaction history
- [x] "Cómo hablarle a Kipu" section added with parseable examples using real account and debt names
- [x] Chat section copy updated to remove internal parser implementation details
- [x] Empty state for recent movements improved
- [x] Existing manual expense, income, goal contribution, and chat forms preserved
- [x] First-use module passed lint and production build
- [x] First-use module deployed to Vercel production
- [x] /app polished into Whoop-style financial dashboard (Dashboard v1 bridge)
- [x] Financial Readiness hero card added with score, mode, status bar, and calm coaching copy
- [x] Six core dashboard signals added: flexible spending, goal, debt pressure, accuracy, budget reality, daily limit
- [x] Next-best-step logic improved to avoid goal contributions when flexible spending is negative or debt pressure is high/critical
- [x] Next-best-step priority order refined: first movement, protect the week, review debt pressure, then goal contribution only with real margin
- [x] Dashboard copy aligned to Kipu tone (Necesita atención, Sin margen, budget learning without “modelo”)
- [x] Manual forms moved to secondary “Registro manual avanzado” section
- [x] Chat input, recent movements, goal card, flexible spending breakdown, and transaction flows preserved
- [x] Dashboard v1 bridge passed lint and production build
- [x] Dashboard v1 bridge manual visual QA passed
- [x] Dashboard v1 bridge deployed to Vercel production
- [x] Deterministic transaction prefilter added before parser routing
- [x] Ambiguous or unsupported Telegram messages return specific clarifications without DB writes
- [x] Telegram clarifications improved for vague payments, transfers, multiple movements, refunds, cancelled subscriptions, and invited/no-spend cases
- [x] Telegram success response copy improved for account-paid expenses, credit-card expenses, income, goal contributions, and debt payments
- [x] Basic parser improved with token-aware account matching
- [x] Basic parser recognizes income phrases like “me pagaron 100 en pichincha”
- [x] Basic parser recognizes goal contribution phrases like “mandé 20 a boda”
- [x] Basic parser returns tailored clarification when goal contribution needs source account
- [x] docs/TEST_SCRIPTS.md updated with Telegram daily logging robustness scripts
- [x] Telegram daily logging robustness passed lint and production build
- [x] Telegram daily logging robustness validated locally via webhook/curl
- [x] Telegram daily logging robustness validated in production Telegram
- [x] Telegram daily logging robustness deployed to Vercel production
- [x] Deterministic goal planning engine created in src/lib/financial/goal-planning.ts
- [x] GoalPlan integrated into buildUserFinancialContext
- [x] /app main goal card now uses goalPlan with real planning status instead of static progress only
- [x] Goal planning engine handles no goal, missing target, missing deadline, achieved, on track, tight, at risk, not realistic, and blocked-by-margin/debt states
- [x] Goal planning calculates remaining amount, time remaining, required weekly/monthly contributions, capacity, gap, status, coaching message, next action, and data quality
- [x] Goal planning remains deterministic TypeScript with no AI calls
- [x] Goal planning does not recommend contributions when flexible spending is negative or debt pressure is high/critical
- [x] Goal card visually refined to match dark premium dashboard
- [x] Missing deadline copy explains Kipu needs a date before calculating weekly/monthly amounts
- [x] Tight-week goal card copy protects the goal and avoids forcing contributions
- [x] docs/TEST_SCRIPTS.md updated with goal planning QA scenarios
- [x] Real goal planning engine passed lint and production build
- [x] Real goal planning engine validated locally on /app
- [x] Real goal planning engine validated in production /app
- [x] Real goal planning engine production Telegram smoke test passed
- [x] Real goal planning engine deployed to Vercel production
- [x] Deterministic fixed expense matcher created in src/lib/financial/fixed-expense-matcher.ts
- [x] Fixed expense matching integrated into chat transaction handler before normal parser flow
- [x] Fixed expense matcher checks user fixed expenses before treating a message as unplanned daily spending
- [x] Fixed expense payments linked via existing recurring_expense_id without new tables or SQL migrations
- [x] Confident fixed expense matches apply with recurring_expense_id and fixedExpenseName
- [x] Ambiguous fixed expense matches return clarification and do not write to DB
- [x] Amount mismatches ask whether payment was normal fixed expense or separate charge
- [x] Duplicate fixed expense names do not silently auto-select a match
- [x] Anti-double-counting copy improved to feel human and Kipu-like
- [x] Existing normal expense, card expense, debt payment, and vague payment flows preserved
- [x] docs/TEST_SCRIPTS.md updated with recurring expense anti-double-counting QA scenarios
- [x] Recurring expenses / anti-double-counting passed lint and production build
- [x] Recurring expenses / anti-double-counting validated locally via webhook/Telegram
- [x] Recurring expenses / anti-double-counting production Telegram smoke test passed
- [x] Recurring expenses / anti-double-counting deployed to Vercel production
- [x] /app/page.tsx refactored from ~1090 lines to ~295 lines
- [x] App dashboard components extracted into src/app/app/components/
- [x] page.tsx kept as orchestrator for auth, context load, recent transactions, redirects, derived values, and layout composition
- [x] Extracted GoalPlanCard, FlexibleSpendingCard, RecentMovementsCard, KipuUnderstoodCard, ManualAdvancedSection, and dashboard helpers
- [x] Component extraction preserved product behavior with no intentional financial, Telegram, parser, or coach logic changes
- [x] Chat, recent movements, goal plan card, flexible spending breakdown, Kipu-understood section, and manual forms still render and work
- [x] Component extraction / app page cleanup passed lint and production build
- [x] Component extraction / app page cleanup validated locally on /app
- [x] Component extraction / app page cleanup deployed to Vercel production
- [x] Deterministic guardrails added around AI parser path before DB writes
- [x] AI parser safety guards preserve architecture: AI interprets, deterministic code validates/corrects/blocks
- [x] Payment-source correction routes account-paid expenses to named accounts instead of cards when appropriate
- [x] Payment-source correction routes card expenses like “almuerzo 8 visa” to the correct debt account
- [x] Goal-target safety blocks silent goal contributions to the wrong goal and asks for clarification
- [x] Fixed expense matching behavior preserved under AI parser safety guards
- [x] docs/TEST_SCRIPTS.md updated with AI parser deterministic safety QA scenarios
- [x] AI parser deterministic safety guards passed lint and production build
- [x] AI parser deterministic safety guards validated locally
- [x] AI parser deterministic safety guards production Telegram QA passed
- [x] AI parser deterministic safety guards deployed to Vercel production
- [x] Conversation memory schema added in supabase/sql/012_conversation_memory.sql
- [x] Conversation memory migration applied successfully in Supabase
- [x] pending_chat_clarifications table added for short-lived operational clarification state
- [x] chat_messages table added for recent user/assistant turns
- [x] Telegram chat memory stores incoming user messages and assistant responses with channel and chat_id
- [x] Pending clarification resolution added for fixed expense amount mismatch follow-up
- [x] Fixed expense normal-payment follow-up registers linked payment without treating it as extra spending
- [x] Fixed expense separate-charge follow-up registers normal expense without recurring_expense_id
- [x] Duplicate same-name fixed expense rows still open pending clarification safely when a candidate can be selected
- [x] Distinct-name ambiguous fixed expenses still do not open pending automatically
- [x] Chat memory treated as context only; financial writes remain deterministic and validated
- [x] Fixed expense clarification copy improved to natural conversation instead of robotic commands
- [x] Conversation memory foundation passed lint and production build
- [x] Conversation memory foundation production Telegram QA passed
- [x] Conversation memory foundation deployed to Vercel production
- [x] AI humanizer added for validated financial event responses after parse, validate, apply, and recalculate
- [x] Structured response validation prevents AI from changing amounts, accounts, cards, goals, or core financial truth
- [x] AI humanizer improves Kipu voice with shorter, more natural, less robotic replies
- [x] Deterministic rescue added for clear debt payments when AI parser returns uncertainty
- [x] AI-assisted pending clarification resolution classifies natural fixed expense follow-up replies into safe structured decisions
- [x] AI-assisted pending clarification resolution classifies goal mismatch follow-up replies safely
- [x] AI acts as human↔code translator for natural replies and structured system results without writing to Supabase
- [x] Pending clarification decisions validated deterministically before financial actions
- [x] Existing parser, source, goal, and fixed expense guards preserved under humanizer layer
- [x] AI response humanizer passed lint and production build
- [x] AI response humanizer production Telegram QA passed
- [x] AI response humanizer deployed to Vercel production
- [x] AI-first general financial coach path added for read-only financial conversation
- [x] Kipu defaults to coach mode unless the user clearly asks to record, change, or delete financial data
- [x] Explicit financial writes remain protected through parser → guards → applyChatTransactionIntent
- [x] Read-only coach follow-up handling prevents accidental transaction registration on clarifying replies
- [x] Explicit-write boundary requires clear logging intent before any transaction DB write
- [x] Prefilter improved so comparison and advisory messages are not treated as multi-transaction logs
- [x] General coach responses improved for tradeoffs, guilt/necessity, debt/card worries, and spending boundaries
- [x] Need vs want handling improved: essentials without guilt, discretionary purchases coached without judgment
- [x] Low-cost tradeoff coaching improved for everyday spending decisions
- [x] Transaction logging tone kept emotionally safe and non-punitive
- [x] Fixed expense copy improved to sound more like Kipu
- [x] Pending clarification, fixed expense, goal mismatch, transaction flows, and Universal Router architecture preserved
- [x] Phase 10.6 AI-first conversational financial coach core passed lint and production build
- [x] Phase 10.6 production Telegram QA passed
- [x] Phase 10.6 deployed to Vercel production
- [x] Stage 1 — AI-native Kipu agent core introduced behind KIPU_AGENT_MODE
- [x] Stage 2 — Agent operational tool coverage expanded with memory, alias, person, and pattern resolution
- [x] Stage 3 — Agent became primary happy path in agent mode with reduced legacy route dependency
- [x] Stage 4 — In-chat proactive coaching signals, weekly reconciliation, recovery framing, and wellness-metric foundations added
- [x] Stage 5 — Liquidity-aware coaching added with liquid vs non-liquid accounts, nudge continuity, engagement state, pause/light/reconciliation state, and coach-state persistence
- [x] Stage 6 — Margen Kipu introduced as central product concept and cash-flow-aware spending engine
- [x] Margen Kipu defined as comfortable weekly spend after cash flow, commitments, debt/card payments, fixed expenses, essentials, savings/investment, goals, and income timing
- [x] Margen Kipu documented as distinct from bank balance, net worth, receivables, investments, and protected goal money
- [x] Kipu communicates Margen Kipu simply with one weekly/day number unless the user asks for detail
- [x] Deterministic Margen Kipu engine added
- [x] Migration 015_stage6_margen_kipu.sql added and applied in Supabase production
- [x] user_financial_preferences extended with monthly_savings_commitment, monthly_investment_commitment, and essential_monthly_estimate
- [x] Onboarding updated to capture Margen Kipu inputs: savings/investment commitments, essential estimates, account liquidity, and income timing
- [x] Agent and coaching language updated around Margen Kipu
- [x] Reconciliation adjustment behavior treats balance differences as adjustment, not normal income
- [x] Stage 6 production Telegram QA passed for weekly status, Margen Kipu explanation, spend-today check, balance vs Margen Kipu explanation, and monthly savings commitment persistence
- [x] Basic logging and undo still work after Stage 6
- [x] Stage 6 deployed to Vercel production
- [x] Stage 7 — Onboarding + Dashboard Alignment completed, deployed, and validated
- [x] Dashboard and chat aligned around Margen Kipu using the same coaching briefing engine
- [x] Legacy weekly-plan dashboard numbers replaced with Margen Kipu
- [x] Onboarding save reliability improved by resolving draft ids into real account, debt, and source links
- [x] Onboarding review step became editable before final confirmation
- [x] Goal current savings, goal account, income destination, fixed expense payment source, and default source links improved
- [x] Upcoming commitments card and Whoop-style metric grid added
- [x] Stage 7 required no migration and passed lint/build/deploy

- [x] Stage 8 — Customer-facing Product UI, Navigation & Chat completed, deployed, and validated
- [x] App changed from single-scroll MVP dashboard into real customer-facing product shell
- [x] Navigation added: Resumen, Actividad, Kipu chat, Metas
- [x] Dedicated pages added for chat, activity, goals, and Margen Kipu detail
- [x] Manual advanced register moved out of customer app into dev-only route
- [x] Activity feed language improved
- [x] PWA metadata, manifest, and icon added
- [x] Customer-facing MVP residue removed
- [x] Stage 8 required no migration and passed lint/build/deploy

- [x] Stage 9 — Final Customer-facing Experience completed, deployed, and validated
- [x] MargenRing added as the main visual identity for Margen Kipu
- [x] Dashboard hierarchy improved with stronger visual system
- [x] /app/debt added
- [x] Metrics improved with colors, icons, bars, and real destinations
- [x] Chat gained optimistic send behavior, typing/reply-in-place feel, and “Nueva conversación”
- [x] Migration 016_stage9_chat_cleared.sql added and manually applied in Supabase
- [x] Goals gained direct actions: date picker and quick contribution
- [x] Mobile/PWA safe-area behavior improved
- [x] Dashboard became a strong premium financial wellness app first version
- [x] Stage 9 passed lint/build/deploy

- [x] Stage 10 — Dashboard Closure completed, deployed, and validated
- [x] Pulso Kipu added as the signature financial wellness identity
- [x] PulsoOrb added
- [x] Dedicated metric detail pages added: /app/readiness, /app/precision, /app/reality
- [x] Readiness/Pulso now explains the composite financial wellness state instead of collapsing into Margen Kipu
- [x] Precision now explains data trust, freshness, reconciliation, source completeness, income setup, fixed expense mapping, and savings/essentials setup
- [x] Reality/Budget Reality now explains learned spending behavior, estimates vs reality, and categories Kipu is observing
- [x] Margen Kipu ring and detail page improved with more interactive/futuristic visual feel
- [x] Activity language improved further, including better day totals and less repetitive movement naming
- [x] Goals controls improved to feel less like raw browser forms
- [x] Chat visual behavior improved with bottom anchoring, dark scrollbar, and cleaner empty state
- [x] Money/date formatting inconsistencies inside /app were reduced
- [x] Stage 10 required no migration and passed lint/build/deploy
- [x] Dashboard/UI is now considered closed enough to move to another module

- [x] Stage 11 — AI-first Onboarding Foundation completed and validated
- [x] Onboarding changed from mock-first to AI-first with deterministic fallback
- [x] Onboarding draft persistence, safe restart, editable review, and first Margen Kipu preview added
- [x] Duplicate account, income, debt, goal, and fixed-expense protection strengthened
- [x] Assumptions, estimates, missing dates, and uncertain data became visible in the review
- [x] Negative Margen Kipu gained a calm, non-punitive recovery experience
- [x] Recent conversation context and hybrid structured debt editing added
- [x] Debt clarification loops gained deterministic circuit-breaker protection
- [x] Onboarding memory began persisting into user_context_notes for the daily Kipu agent
- [x] Amount and date editing added directly to the onboarding review
- [x] Legacy customer-facing manual configuration tables removed from onboarding
- [x] Weekly Margen Kipu became the primary review number with separate daily guidance
- [x] Savings, investment, goal timing, and tone-preference capture improved
- [x] Stage 11.6 replaced the deterministic conversational wizard with a tool-driven onboarding agent
- [x] The onboarding LLM now owns natural dialogue, interpretation, clarification, correction, and section completion
- [x] Deterministic tools safely mutate the draft and validate financial seed quality
- [x] Hardcoded closure-phrase dependency removed from the primary agent path
- [x] Agent tools safely upsert profile, accounts, debts, incomes, fixed expenses, commitments, goals, preferences, and memory
- [x] Existing draft entities are updated by identity instead of duplicated
- [x] Credit cards now distinguish minimum payment, total due this month, and accumulated balance
- [x] Card validation prevents a known minimum from being silently treated as the full monthly obligation
- [x] Goals require target amount, current saved amount, and date or explicit unknown date
- [x] Saved onboarding tone preference now influences the daily Kipu agent
- [x] Deterministic onboarding build gate expanded to 21/21 passing assertions
- [x] Live AI field simulator added for realistic users, messy language, corrections, unknowns, and unseen closure phrases
- [x] Live simulator passed 25/25 checks across base, closure, and correction scenarios
- [x] The simulator identified and helped fix real seed-completeness and regression issues before delivery
- [x] /dev/onboarding-sim protected behind authenticated session access
- [x] Live simulation remains explicit and does not run during normal builds
- [x] Stage 11 required no Supabase migration
- [x] Stage 11 passed lint and production build
- [x] Stage 11 committed and pushed to main in commit ad63184
- [x] Stage 12 built universal capture: one evidence pipeline (validate → hash idempotency → faithful extraction → deterministic matching → the daily agent acts via tools)
- [x] Telegram now accepts photos, voice notes, and PDF documents (size-checked download, dedupe-safe)
- [x] Web chat gained attach, paste, drag-drop, and mobile camera capture into the same pipeline
- [x] PWA manifest gained share target ("share to Kipu" text from any app) and home-screen shortcuts
- [x] Voice notes transcribe and flow through the full existing chat pipeline as user speech
- [x] Receipts, bank-alert screenshots, transfers, and statements extract faithfully (no invented amounts)
- [x] Deterministic dedup/reconciliation matcher: external_ref identity, amount+date+merchant similarity, shrinking-pool statement reconciliation, never merging different amounts
- [x] Card statements update real obligations via the new update_card_obligations tool (mínimo, pago del mes, saldo, corte, día de pago)
- [x] Multi-movement messages register in one safe pass via the new log_movements_batch tool
- [x] Content-hash idempotency short-circuits re-sent files with zero model cost (capture_evidence, migration 017)
- [x] File safety: magic-byte sniffing, mime-coherence, 12MB cap (renamed executables can never reach a model)
- [x] Inbound-email foundation: /api/inbound-email with per-user token + shared secret, honestly disabled (503) until provider/DNS setup
- [x] Deterministic capture gate /dev/capture-test prerenders at build with 15/15 assertions
- [x] Live capture field-sim (/dev/capture-sim + scripts/capture-sim.ts): live PDF extraction 5/5, voice TTS→Whisper 2/2, matcher-over-real-ledger 3/3; dedup checks pending migration 017
- [x] Stage 12 requires applying migration 017 manually before deploy (capture_evidence + transactions.external_ref + inbound_email_token)
- [x] Stage 12 passed lint and production build; not committed yet
- [x] Stage 12 hardening pass: evidence lifecycle is race-safe (claim stays 'processing' until the real outcome; only the claim owner finalizes via an optimistic-lock version guard; unexpected claim-store errors fail CLOSED, never process unguarded; fresh in-flight duplicates get honest copy)
- [x] Matcher now selects the STRONGEST match across all rows (not the first), separates exact amounts (can dedup) from approximate (ask only, never silent merge), rejects impossible calendar dates, and a ledger-load failure fails closed instead of reading as "no matches"
- [x] Deterministic provenance: external_ref + evidence_id + occurrence date are set AT INSERT TIME by the canonical writer (the post-write "newest matching row" heuristic that could tag the wrong equal-amount row is gone); the writer maps a duplicate-reference conflict to a no-double-write
- [x] Cross-channel transaction idempotency: a repeated bank reference can never be written twice across text/voice/image/PDF/email (unique index, migration 018)
- [x] Batch writes validate ALL rows before writing, reject >15 explicitly (no silent truncation), and report partial completion honestly (a partly-failed batch can't read as full success)
- [x] Currency is the real account/card currency (never a blind USD fallback for a non-USD card); card-obligation base balance is only set with a trusted 1:1 conversion, days must be integers 1–31 (invalid values rejected and reported, not silently rounded)
- [x] The agent now reports its real tool outcome so a nice reply can never hide a failed/partial/clarify-pending write; evidence status reflects processed / needs_clarification / failed
- [x] Extraction treats receipt/PDF/email text as untrusted DATA (anti prompt-injection), never assumes USD, drops impossible dates, flags truncation, and carries an audit snippet
- [x] Telegram media has bounded timeouts and reserve/release semantics (transient failure releases the update so Telegram retries; no duplicate replies); inbound email has request/aggregate size caps, timing-safe secret compare, race-safe token creation, and text-body replay idempotency
- [x] Stage 12 hardening requires applying migration 018 manually before deploy (transactions unique external_ref index + capture_evidence 'needs_clarification' status)
- [x] Stage 12 hardening: deterministic gate 29/29 and live field-sim 21/21 (lifecycle, claims, dedup, matcher, archivos, voz); lint + build green; not committed

#### Stage 12 — COMPLETE (production-validated and closed, 2026-06-16)

- [x] **Stage 12 — Low-friction data capture: COMPLETE.** Committed to main (5ebec36 statement-card resolution; 803f1a7 resumable statement import + adversarial-review hardening) and deployed to Vercel Production (deployment commit 803f1a7, READY). Supabase migrations 017–021 applied in production; `KIPU_AGENT_MODE=on`.
- [x] Stage 12 production validation (real Telegram bot + production Supabase): web text capture; Telegram text; Telegram voice (real transcription); Telegram image/photo (real receipt extraction); Telegram PDF/card statement; statement card resolution (network-aware — a Mastercard statement is never confidently matched to a same-bank Visa); new-card creation/linking from chat (`create_card`/`create_account`, idempotent by name); card-obligation import (full payment / minimum / due day / cutoff day kept distinct); debt/card payment from a statement using the ORIGINAL statement row date (`occurred_at`, not the chat timestamp); statement rows written under ONE `evidence_id` with `ev:<evidence_id>#<fingerprint>#<occurrence>` dedupe keys; long/resumable statement import (durable session in `clarification_context`; a chat answer AND a re-upload both resume idempotently; ≤15-row atomic batches under one evidence id; truthful detected/imported/pending counts; honest truncation beyond the 120-row ceiling); exact-replay safety; conservative semantic-duplicate protection; multi-movement batch atomicity; deterministic ledger RPCs (019) + atomic correction/reconcile (020) + Telegram reservation-release grant (021); currency safety (no invented FX); AI-first contextual responses with no raw IDs/JSON/tool summaries leaked.
- [x] Stage 12 final production retest: statement "Banco Pichincha Mastercard" emitted 2026-04-06 → 8 detected / 8 registered (7 expenses + 1 debt_payment), all targeting Mastercard Banco Pichincha; payment 614.57 from account Pichincha dated 2026-03-20; obligations full 331.42 / minimum 52.17 / due 21 / cutoff 6; Mastercard Produbanco untouched.
- [x] Stage 12 adversarial pre-mortem (30 real-user scenarios + 4-lens money-safety review): HIGH findings fixed — batch validation no longer pre-consumes dedupe occurrence indices; `create_card`/`create_account` are idempotent; card resolution is network-aware; a partial statement write keeps the durable session open; truncation is reported truthfully via an explicit signal; `maxDuration=300` on the capture entry routes; a re-upload claims the evidence row before resuming. Deterministic gate 52/52; live DB sims green (ledger 15/15, workflows 18/18, reconcile-security 7/7, channel-idempotency 7/7, lifecycle 4/4, claims 5/5, dedup 3/3, matcher 3/3, telegram-http 4/4); archivos 5/5, voz 2/2; lint + build green.
- [x] Stage 12 accepted, NON-BLOCKING limitations: no automatic FX conversion (foreign movements ask, never invent a rate); one-off scheduled payments don't auto-close when paid; undoing a loan expense doesn't auto-close its receivable; manual dashboard entry remains a separate path; statement import models ONE card per statement; an older statement can overwrite current card obligations until Stage 14 / date-aware debt protection improves it; `transactions.raw_input` may store a large evidence digest (it never leaked to users — future hygiene should move technical digest out of `raw_input`); resume idempotency for identical-looking rows across a multi-turn resume relies on dedupe keys (next hardening: re-run the deterministic matcher on resume); two simultaneously-pending statements aren't auto-disambiguated.
- [x] Stage 12 production QA data reset (founder-authorized): all polluted QA/test users and their financial/chat/evidence data deleted — auth users → 0 (cascade across every user-owned table); `telegram_processed_updates` cleared; production DB left in a clean empty-state. Schema, migrations, functions/RPCs, config tables and environment variables were NOT touched (data-only reset). The deployed app boots cleanly at empty-state (login, root, and the new-user/unlinked-Telegram path verified).
- [x] Stage 12 boundaries: **Stage 13 (Ambient Telegram Loop & Data Freshness) is NOT implemented; Stage 14 (Card/Debt Protection) is NOT implemented.** Stage 12 created foundations for both — Telegram channel, conversation memory, idempotent retries, live financial context, engagement/pause state; card debt, statement import, distinct obligations, debt pressure, Margen integration — but did not build the proactive ambient loop or the protection stage.


#### Stage 13 — Ambient Telegram Loop & Data Freshness — PRODUCTION-LIVE & CLOSED (deploy commit 2bf9a8f, Vercel Production READY, 2026-06-16)

- [x] **Stage 13 — Ambient Telegram Loop & Data Freshness: PRODUCTION-LIVE & CLOSED (deploy commit `2bf9a8f`, READY), AI-first.** Deterministic code decides eligibility/timing/freshness/cooldowns/idempotency; the AI writes every user-facing line. No scripted phrase trees, no canned notification copy, no guilt. Kipu can now *reach out first* on Telegram when it's genuinely useful — and stays quiet otherwise.
- [x] Stage 13 freshness engine (`src/lib/financial/freshness.ts`, pure): classifies the real financial picture into `insufficient_data | paused | needs_completion | stale | needs_reconciliation | slightly_stale | fresh` from onboarding, account/income/fixed-expense presence, idle days (cross-channel), days-since-reconcile, account age (new-user grace) and goal presence — not a naive "days since last transaction".
- [x] Stage 13 anti-spam decision layer (`src/lib/ambient/ambient-decision.ts`, pure, unit-tested): one ordered gate chain — not linked, insufficient data, ambient disabled / frequency off, paused, snoozed, quiet hours (wrap-aware), off-schedule (weekly with no/unmatched day → never daily), recent cross-channel interaction (<18h), daily cap (0 honored as "none"). Then it picks the single highest-priority topic that is not in its per-topic cooldown and is allowed by light mode, returning STRUCTURED facts (currency + names, no ids/JSON) for the AI to phrase — or a non-sensitive skip reason.
- [x] Stage 13 AI message (`src/lib/ambient/ambient-message.ts`): ONE bounded model completion turns the structured facts into a short, human, guilt-free Spanish check-in; a structure-leak guard (braces / real JSON key:value / UUID / `_id` / tool markers) and empty/too-long guard make it return `null` → the loop SENDS NOTHING rather than ever falling back to a template.
- [x] Stage 13 idempotent ledger (`ambient_nudges`, migration 022): the per-`(user, topic, local-day)` `status='sent'` claim is a unique partial index — the INSERT is the race winner, so cron repeats, retries and concurrent workers can never double-send. The claim is PERMANENT for the day (a failed delivery keeps `status='sent', delivered=false`) so even "Telegram delivered but the response was lost" cannot re-send. Skip rows never occupy the slot. RLS on, default-deny, service-role grant only.
- [x] Stage 13 orchestrator + cron (`src/lib/ambient/ambient-loop.ts`, `src/app/api/cron/ambient-loop/route.ts`): for each active Telegram-linked user it assembles the SAME live financial truth as chat/dashboard, runs the decision, claims, generates, sends, records the real outcome, feeds the per-topic cooldown and persists the message to `chat_messages` (cross-channel history). A failed send never corrupts state and never blocks anything. The cron route (`CRON_SECRET` / `x-vercel-cron` auth, `maxDuration=300`) is empty-state-safe and logs only non-sensitive aggregates keyed on topic, never on the name-bearing reason.
- [x] Stage 13 chat-driven preferences (`set_ambient_preferences` agent tool): the user controls everything in natural language — pause/resume, snooze "hasta el lunes", quiet hours, daily/weekly/off frequency, specific weekdays, max-per-day, timezone — with no settings screen. Snooze anchors at local midday so "el lunes" lifts that morning; an empty weekday list for `weekly` asks which days instead of defaulting to daily; the timezone is validated before storing.
- [x] Stage 13 cross-channel consistency: a user who just chatted on the WEB is not nudged on Telegram as if they'd gone quiet (the idle gate folds in the last inbound message on any channel); replying on any channel marks the recent nudge as `replied` (learning + recency suppression).
- [x] Stage 13 adversarial pre-mortem (30 real-user scenarios) + multi-agent review: no money-unsafe findings. Hardened — daily cap of 0 honored as "none" (not floored to 1); empty `weekdays` no longer means "every day"; snooze no longer lifts the night before in LatAm timezones; an invalid timezone no longer silently shifts quiet hours to UTC; cron logs no longer leak card/payment names; the structure-leak guard no longer false-positives on a legitimate quoted name + colon. Deterministic gate 54/54 (incl. freshness 8-case + decision 12-case: card→send; quiet/paused/max/cap-0/recent/off-schedule/weekly-no-days→skip; nothing-useful; light-mode filter; cooldown→all-cooldown). Lint + build green.
- [x] Stage 13 accepted, NON-BLOCKING limitations: the per-day cap is enforced by check-then-act (not an atomic claim), so two cron runs firing in the same second could, in theory, send two DIFFERENT topics the same day — the per-topic `sent` claim still makes same-topic duplication impossible; an AI-unavailable turn burns that day's topic slot (intentional — a permanent claim is what guarantees "no duplicates"; a missed nudge is acceptable, a duplicate is not); when nothing is sendable because every candidate is cooling down the skip reason is `all_cooldown` vs `nothing_useful` (harmless observability nuance).
- [x] Stage 13 PRODUCTION ROLLOUT (2026-06-16): committed + pushed to `main` (Stage 13 implementation `cde0352`; **deploy commit `2bf9a8f`, Vercel Production READY**). Migration `022_stage13_ambient_loop.sql` **applied and verified** in production (`user_engagement` ambient columns + `ambient_nudges` table + the `(user_id, topic, day_bucket) WHERE status='sent'` unique partial index + RLS enabled default-deny + service-role SELECT/INSERT/UPDATE grant, no DELETE). `CRON_SECRET` **configured** in Vercel Production as a *Sensitive* env var and **rotated** afterward (the secret was accidentally pasted into chat; the live value is the rotated one).
- [x] Stage 13 `/api/cron/ambient-loop` is **live and protected** (verified against production): no secret → `401 Unauthorized`; valid `Authorization: Bearer <CRON_SECRET>` → `200 OK`. Empty-state cron execution returns `{ ok:true, considered:0, sent:0, skipped:0, failed:0 }` — confirming the route exists, Stage 13 code is deployed, the auth guard works, the secret works, the loop runs safely, and with no users/no data **no messages are sent**.
- [x] Stage 13 production logic validation (disposable user against the real production DB + migrated schema + real OpenAI + real Telegram bot, then fully cleaned): **18/18** — empty-state no-op, new-user-without-Telegram, linked-but-insufficient-data (`insufficient_data`), eligible→exactly-one nudge with natural Spanish AI copy (no JSON/ids/guilt), idempotency at both the loop (`already_claimed`) and DB unique-index level, 7 preference gates (off / frequency=off / paused / quiet-hours / weekly-other-day / weekly-no-days / cap-0), and graceful Telegram-failure (delivered=false, error recorded, no crash, no duplicate). Disposable data torn down; production DB re-verified clean (all user-owned counts 0; 022 objects intact).
- [x] Stage 13 cron frequency is currently **daily** (`0 14 * * *`) because the project is on the **Vercel Hobby plan** (sub-daily cron schedules require Pro; the hourly `0 * * * *` expression blocked the Hobby deploy). This is an **accepted temporary limitation, NOT a code blocker**: the decision/freshness/anti-spam/idempotency logic and per-user quiet-hours + timezone gating are unchanged and already support hourly execution. **True hourly ambient behavior** is a platform upgrade only — either Vercel **Pro** (restore `0 * * * *` in `vercel.json`) or an **external scheduler** hitting `/api/cron/ambient-loop` hourly with the `CRON_SECRET` bearer.
- [x] Stage 13 is **COMPLETE and production-live.** Accepted limitations: ambient loop runs **once daily on Hobby** (for hourly, upgrade to Vercel Pro or use an external scheduler); the per-day cap is check-then-act (per-topic `sent` claim still makes same-topic duplication impossible); an AI-unavailable turn burns that day's topic slot (intentional — the permanent claim guarantees "no duplicates"). **Stage 14 (Card/Debt Protection) has NOT started.**
- [x] Stage 13 boundaries respected throughout the rollout: did NOT build full Stage 14 Card/Debt Protection (card/debt due info is used only as ONE freshness input); did NOT reopen Stage 12; did NOT create a spam engine; did NOT hardcode Spanish templates; did NOT use or leave behind founder/real-user data.


#### Stage 14 — Card & Debt Protection / Interest Intelligence / Financial Health Guardrails — IMPLEMENTED (migration 023 created NOT applied; not committed/deployed, 2026-06-16)

- [x] **Stage 14 — Card/Debt/Interest protection: code-complete, AI-first.** Deterministic code computes debt truth (health states, dates, interest math, payoff, debt-vs-investment, conflicts, payment classification, date-aware obligations); the AI turns that truth into natural, contextual, guilt-free coaching. The engine never fabricates a rate, balance, payment confirmation or date; missing/stale/ambiguous data makes Kipu ASK or qualify. Money stays money-safe: a card payment is debt-down (never an expense), the ledger writer is untouched, and all new analysis tools are READ-ONLY.
- [x] Stage 14 pure deterministic core (all unit-tested in the gate): `interest-math.ts` (monthly/annual rate kinds, monthly interest, cost-of-delay, amortizing payoff projection that honestly returns feasible=false when payment ≤ interest, full/minimum/partial comparison); `debt-statement.ts` (date-aware `decideApplyObligations` + payment classification full/minimum/partial/below-minimum/overpay/unclear + statement staleness); `debt-payoff.ts` (avalanche/snowball/urgency/hybrid, always pays minimums first, cashflow-capped extra); `debt-vs-investment.ts` (guaranteed-saving vs uncertain-return, reserve-protected, never advises skipping a minimum to invest, `insufficient_data` when the rate is unknown); `debt-health.ts` (per-card states healthy/watch/due_soon/due_today/overdue/needs_payment_confirmation/stale_statement/revolving_risk/high_interest_risk/unknown + portfolio totals + debt pressure + next action).
- [x] Stage 14 DATE-AWARE obligations (fixes the known Stage 12 limitation): `update_card_obligations` now takes a `statementDate` and refuses to overwrite newer minimum/full/due/cutoff/balance/rate with an OLDER (or undated) statement — it keeps current obligations, still imports the statement's movements, records the cycle in `debt_statement_cycles`, and tells the user naturally. The statement extractor captures statement emission date/period/rate; the digest passes `statementDate` to the tool; out-of-order and duplicate uploads are safe and idempotent.
- [x] Stage 14 single-truth integration: `buildCoachingBriefing` now carries `debtHealth` (computed from the same live debts, with recent debt-payment recency) so CHAT, the TELEGRAM ambient loop, and the DASHBOARD all read ONE truth. New chat tools (all read-only): `analyze_debt_health`, `plan_debt_payoff`, `compare_debt_vs_investment`, `estimate_card_interest`; `update_card_obligations` extended for interest rate + statement date; the agent prompt gained card/debt/interest guidance (ask before asserting paid, label estimates, no investment-advice overreach). Natural chat handles "ya pagué la Mastercard / pagué el mínimo / pagué 100 / la tasa es 15.6% / cierra el 6 vence el 21 / ¿pago mínimo o total? / ¿qué deuda pago primero? / ¿pago deuda o invierto? / hazme un plan".
- [x] Stage 14 protective Telegram nudges (built ON Stage 13, anti-spam intact): added topics `card_due_today`, `card_overdue`, `payment_confirmation`, `minimum_payment_warning`, `high_interest_debt`, `debt_pressure`, `statement_stale`, derived from `debtHealth`, each with a per-topic cooldown + priority; urgent ones join light mode. They reuse Stage 13's quiet hours / pause / snooze / max-per-day / idempotent per-(user,topic,day) claim — still at most one nudge per run, AI-written, never a template; overdue/confirmation copy ASKS ("¿ya pagaste?"), never accuses.
- [x] Stage 14 dashboard: the `/app/debt` page surfaces per-card health-state chips (¿ya pagaste? / tasa alta / interés corriendo / dato viejo) and an estimated monthly-interest line for revolving high-interest cards — from the same `debtHealth`, no overbuild.
- [x] Stage 14 migration `023_stage14_debt_protection.sql` (additive, NOT applied): `debt_accounts` += `statement_date`, `statement_period_end`, `interest_rate_kind`, `last_statement_evidence_id`; new `debt_statement_cycles` audit table (per-statement history + date-aware ordering + idempotency index, RLS default-deny, service-role grant). Reads degrade gracefully before 023 (debt selects use `*`; the cycle write is best-effort) so production is unchanged until applied.
- [x] Stage 14 verification: deterministic gate 60/60 (added 6 Stage 14 assertions: interest payoff feasible/infeasible + full-vs-minimum, date-awareness + payment classification, payoff avalanche/snowball + cashflow cap, debt-vs-investment verdicts, debt-health states, ambient debt-topic priority). Lint clean, build green. Caught + fixed a real false-positive in the overdue logic (it would have flagged mid-cycle cards for users who don't log card payments).
- [x] Stage 14 safety/honesty guardrails: never fabricate bank rates (ask or label assumption); never say a card is paid without evidence (cautious states ASK); never recommend missing a minimum to invest; card payment never modeled as an expense; older statement never silently overwrites newer obligations; estimates always labeled; ambiguous source/target → ask; idempotency + replay safety preserved (per-(card,statement_date) cycle index + the existing ledger dedupe).
- [x] Stage 14 boundaries: did NOT begin a later stage; did NOT reopen Stage 12/13 (extended the statement extractor only for date-awareness, the Stage 14 mandate).
- [x] **Stage 14 ROLLOUT — PRODUCTION-LIVE (deploy commit `7d93113`, READY).** Migration 023 applied + verified in production (debt_accounts date/rate columns + `debt_statement_cycles`, RLS default-deny, service-role grant, `interest_rate` numeric(8,4)); committed + pushed to main; Vercel auto-deployed READY; smoke validation 9/9 (A–I: no-debt safety, current statement applies obligations + cycle applied=true, older statement kept + cycle applied=false reason older_statement, payment classification, interest intelligence asks for missing rate, payoff avalanche focus, debt-vs-investment pay_debt + no-skip-minimum guardrail, ambient debt topic, dashboard); disposable user fully cleaned; production DB clean; cron unchanged (daily on Hobby).


#### Stage 15 — Financial Life Planning, Cashflow Autopilot & Intelligent Money Calendar — IMPLEMENTED (no migration — fully derived; not committed/deployed, 2026-06-16)

- [x] **Stage 15 — Kipu's financial operating system: code-complete, AI-first.** Internally sophisticated, externally calm. Deterministic code computes cashflow truth (a dated money calendar, a day-by-day forward projection, timing-aware safe spend, runway, risk windows, scenarios, confidence); the AI turns it into ONE simple daily answer ("hoy puedes gastar X, esta semana Y, cuida esto"). Built ON the existing Margen Kipu / Pulso / commitments engines — it STRENGTHENS Margen rather than adding a second concept. **No migration: everything is derived from existing tables each turn (correctness via determinism, no new persistence), matching the prefer-derived rule.**
- [x] Stage 15 pure deterministic core (all gate-tested): `financial-calendar.ts` (one reusable, dated, signed, typed stream of money events — expected income, fixed expenses, scheduled payments, card/debt due, goal/savings/investment reservations — each with confidence / required-flexible-optional / reserves / internal-transfer / origin); `cashflow-projection.ts` (day-by-day balance curve, lowest projected balance + date, runway, end-of-week/month projected balance, and the heart: a TIMING-AWARE safe daily/weekly spend = `min_d (balance[d] − floor)/(d+1)` that respects WHEN money leaves, with risk windows and a confidence model); `cashflow-scenario.ts` (deterministic what-if: buy now, income earlier/later, add expense, change goal, protect reserve → change in safe spend / runway / end-of-month + honest verdict); `spending-patterns.ts` (cautious, confidence-tagged recurring-charge / typical-daily-spend / weekend-lift detection — explains risk, never fabricates an obligation; ignores income/transfers).
- [x] Stage 15 single-truth integration: `buildCoachingBriefing` now carries `cashflow` (the projection), `cashflowScenarioBase` (for consistent what-ifs) and `patterns`. The agent digest HEADLINE became the cashflow ("hoy/semana/runway/una cosa a cuidar") — the SAME Margen Kipu, projected, so chat, the dashboard and Telegram never show contradictory numbers. New read-only chat tools `cashflow_outlook`, `simulate_scenario`, `plan_cashflow`; agent prompt steers answers to stay SIMPLE (today, this week, one risk — no five numbers, no jargon).
- [x] Stage 15 ambient autopilot (on the Stage 13 loop, all safeguards intact): topics `runway_risk` (projection dips below the floor before income), `payments_cluster`, `low_daily_spend`, `confirm_balance` (low confidence → ask to confirm balance), and a rare `safe_week` positive reinforcement — each with a per-topic cooldown + priority, urgent `runway_risk` in light mode, guarded so empty-state/no-data users get NO irrelevant nudge. Still one nudge per run, AI-written, quiet-hours/pause/max-per-day respected, never shaming.
- [x] Stage 15 dashboard: `/app/margen` HERO now leads with the same `cashflow` truth (esta semana + hoy + runway + lo que cuidaría + confianza) — the legacy reservation `mk` numbers no longer drive the headline (they remain only as the "cómo se forma" breakdown), so the dashboard never contradicts chat/Telegram and stays honest/conservative when the income date is unknown (income date shown only when confidence ≠ low; the composition's free slice uses the timing-aware figure with a "colchón" remainder). Pulso/readiness reads the projection via the briefing; the readiness score formula is unchanged to keep it explainable.
- [x] Stage 15 confidence & honesty: every projection carries a confidence (low when no income source / stale balance / foreign-unconverted / no recent activity) with assumptions + missing-data messages surfaced as "con lo que sé hoy… confírmame tu saldo y te lo afino"; scenarios return recommended / possible-but-tight / not-recommended; nothing fabricates an income date or FX; safe spend is never negative; analysis tools are READ-ONLY.
- [x] Stage 15 safety: no double counting (transfers excluded; card purchase ≠ card payment; card_due reserves the amount due not the whole balance; goal contribution flagged internal-transfer; only cashflow-affecting events move the projection; out-of-horizon income not counted); pure modules; deterministic gate **65/65** (added 5 Stage 15 assertions: calendar dating/sign/horizon, projection runway/lowest/timing-aware-safe/confidence, scenario deltas, cautious patterns, ambient cashflow topics). Lint clean, build green. Adversarial multi-agent review run.
- [x] Stage 15 boundaries: did NOT begin Stage 16+ (mapped them as future: Budget Intelligence, Goals/Wealth, Personalization, Household, Scale); did NOT create a second user-facing concept (it IS Margen Kipu, projected); did NOT add a migration (derived); did NOT commit/push/deploy.


#### Stage 16 — Budget Intelligence, Category Learning & Behavioral Spending OS — PRODUCTION-LIVE (deploy commit `33c52bf`, `dpl_Ve2C4XQrRZybeiJRS3NVYKhnJNQP` READY, migration 024 applied, smoke 13/13, 2026-06-17)

- [x] **Stage 16 — the spending-behavior brain: production-live, AI-first, "genius inside, simple outside."** Deterministic code computes a rich behavioral model of the user's spending; the AI answers SIMPLY (what changed / what matters / what to do / how it affects this week). It is NOT a 30-category budgeting module — it learns the user's own "normal" and only surfaces the few things that matter, always tied back to safe spend, never shaming. Built ON Stage 15 (cashflow safe-spend) and the existing ledger; numbers come from the engine, never the LLM.
- [x] Stage 16 pure deterministic core (all gate-tested, 8 modules): `category-intelligence.ts` (classifies every txn so spending analysis NEVER double-counts — only `expense` is spending; transfers, card/debt payments, income, refunds, goal moves, reversals excluded; card purchase IS spending, card payment is NOT; spendingType essential/variable/discretionary/recurring; merchant only SUGGESTS a category, never overrides the stored one); `merchant-normalization.ts` (messy descriptors → readable family + likely category + confidence; processor prefixes stripped PAYU/AMZN/DLC/Stripe/MercadoPago…; user memory wins first; SPECIFIC brands group by family slug so NETFLIX.COM/Netflix/"netflix 123" collapse to one, GENERIC buckets keep raw keys so two supermarkets never merge); `category-baselines.ts` (learns per-category weekly/monthly/weekday-weekend/volatility/trend with sample-size safeguards → low confidence on thin data, never fabricates a pattern); `budget-intelligence.ts` (adaptive, cashflow-aware, non-shaming — the few categories over the user's normal THIS week + ONE practical adjustment; early-week guard so a single Monday charge isn't extrapolated ×7 into a false "over"); `subscription-detection.ts` (recurring charges with consistent interval AND similar amount → cadence, next-charge, alreadyModeled vs existing fixed expenses, suggestConvert; never overclaims from weak evidence); `anomaly-detection.ts` (graded & quiet — possible duplicate, large one-off, category spike with honest margin impact; NEVER fires on a single normal purchase); `margin-attribution.ts` (answers "¿por qué bajó mi margen?" by naming the few real drivers; HONEST that there's no day-by-day snapshot yet, compares against the learned normal); `behavioral-insights.ts` (the synthesis layer — ranks by urgency tier then usefulness × confidence and picks THE one thing; money-safety leads over soft budget guidance, a large one-off can still lead).
- [x] Stage 16 orchestrator + single-truth integration: `spending-intelligence.ts` assembles all 8 into one `SpendingIntelligence` (+ a compact Spanish agent digest, "genius inside, simple outside") now carried on `buildCoachingBriefing().spendingIntel`, computed once per turn from the same live ledger truth as Margen/cashflow. It also feeds the Stage 15 cashflow a LEARNED everyday burn (essential+variable monthly) ONLY when the user has no configured estimate and only with non-low confidence — a strict improvement (those users previously got a zero burn and an over-optimistic safe spend); Margen Kipu itself is untouched.
- [x] Stage 16 chat tools (all read-only except the learner): `where_did_money_go`, `why_margin_changed`, `spending_anomalies`, `my_subscriptions`, `budget_suggestion`, `recommend_cut` (each returns a SIMPLE structured fact — 2–3 things, no lists, no five numbers, no internal labels), plus `learn_spending_correction` which persists a GENERALIZABLE correction ("eso es transporte, no comida"; "PAYU*XYZ siempre es mi gym") to structured merchant memory so it applies to FUTURE matching charges. Agent prompt gained a "GASTO Y COMPORTAMIENTO" block (budget = learned normal not fixed limits; control never failure; never suggest skipping a minimum; ask before converting a subscription; corrections that teach call the learner too).
- [x] Stage 16 persistence: `merchant-memory-store.ts` (`loadMerchantMemory` / `saveMerchantCorrection`, upsert with correction_count) reads/writes migration 024's `user_merchant_memory` — the structured learning store the deterministic classifier needs (free-text `user_context_notes` can't be read reliably by code). EVERY call degrades gracefully (load → `[]`, save → no-op) so production behavior is UNCHANGED until 024 is applied.
- [x] Stage 16 ambient autopilot (on the Stage 13 loop, all safeguards intact): a deliberately FEW, quiet topics — `duplicate_charge` (money-safety, allowed in light mode), `unusual_transaction` (a notable graded anomaly), `spending_spike` (a category over its learned normal), `subscription_detected` (an unmodeled recurring → ASK to convert), `pattern_changed` (a high-confidence rising trend) — each with a per-topic cooldown + priority, guarded so empty-state/no-data users get NO nudge. Intentionally did NOT add gimmicky/overlapping topics (weekend_warning, margin_killer). Still one nudge per run, AI-written, never a template, never shaming.
- [x] Stage 16 dashboard (no clutter): `/app/reality` gained two minimal surfaces from the same `spendingIntel` — "Lo que más importa" (the single behavioral insight, with the concrete small move) and "Cobros recurrentes que detecté" (subscriptions with already-fixed vs not-yet-fixed chips) — both guarded so low-confidence/empty states render nothing.
- [x] Stage 16 migration `024_stage16_merchant_memory.sql` (additive, **applied in production 2026-06-17**): `user_merchant_memory` (per-user learned merchant facts keyed by normalized match pattern; unique (user_id, match_pattern) so corrections upsert; RLS default-deny, service-role grant). No existing object dropped or weakened.
- [x] Stage 16 verification: deterministic gate **79/79** (added 14 Stage 16 assertions: merchant normalization + family grouping, no-double-count classification, baseline sample-size safeguards, budget-over + one-adjustment, subscription cadence/next-charge/already-modeled, graded anomalies + no-fire-on-normal, honest margin attribution, insight synthesis ranking, learned essential burn, empty-intelligence fallback, ambient Stage-16 topics, generic-family no-merge regression, early-week budget guard regression). Lint clean, build green. TWO adversarial reviews run (financial correctness + voice/safety); both surfaced findings that were FIXED: generic merchant-family over-merging, early-week ×7 extrapolation, over-alarming duplicate copy, a confidence-label leak, a deficit-framed budget detail, and a possibly-dismissive anomaly instruction.
- [x] Stage 16 safety/honesty guardrails: never double-counts (type-based classification; statement+ledger never both counted); never shames or says a budget "failed" (framed as control); never overreacts to one transaction; never calls something a subscription from weak evidence; never fabricates categories/merchants/baselines from tiny samples (low confidence propagates); never recommends skipping a minimum debt/card payment; never auto-creates an obligation/subscription (asks first); never exposes raw JSON/IDs/internal labels/confidence words to the user.
- [x] Stage 16 boundaries: did NOT begin Stage 17+; did NOT create a second user-facing concept (budget intelligence ties back to Margen/cashflow).
- [x] **Stage 16 ROLLOUT — PRODUCTION-LIVE (2026-06-17).** Migration `024_stage16_merchant_memory.sql` **applied + verified** in production (table `user_merchant_memory`: 12 columns, unique index `(user_id, match_pattern)` + lookup index `(user_id)`, RLS enabled with 0 client policies → deny-by-default, `service_role` SELECT/INSERT/UPDATE/DELETE, `anon`/`authenticated` no privileges, 0 rows). Committed (`33c52bf`) + pushed to main; Vercel auto-deployed **`dpl_Ve2C4XQrRZybeiJRS3NVYKhnJNQP` READY** (production, `https://fincoach-mvp-vercel.vercel.app`). Preflight confirmed a clean production DB (no real/founder data). Final local validation green (gate 79/79, lint, build). **Smoke 13/13 (A–K)** on disposable users against the real production DB + executors: empty-state safety + no Stage-16 ambient nudge; no-double-count (transfer/card-payment/income excluded, totalSpend 524 not ~2574); merchant normalization (Uber/Amazon grouped, generic not over-merged, local readable/low-confidence); baselines + dynamic budget tied to safe spend; Netflix monthly subscription + suggestConvert; duplicate + large-one-off anomalies with a normal purchase NOT flagged; honest margin attribution (no daily snapshot); the 6 read tools return simple facts with no JSON/internal labels; **merchant-correction loop persists to `user_merchant_memory` via service-role, upsert increments without duplicating, future normalization uses the learned memory**; ambient picks `duplicate_charge`; `/app/reality` shows the one insight + subscriptions with data and nothing when empty. All disposable test data deleted; production DB verified back to all-zero. `vercel.json` cron unchanged (`0 14 * * *`, daily on Hobby); no unrelated deploy/config change. Stage 17 NOT started.


#### Stage 17 — Goals, Mini-Goals, Wealth Builder & Human Financial Priorities — PRODUCTION-LIVE (deploy commit `1cfdf8e`, `dpl_4xaxDjE95fsajcwzoNtdnvWQkp1Y` READY, migration 025 applied, smoke 16/16, 2026-06-17)

- [x] **Stage 17 — Kipu's personal system for turning money into life goals: production-live, AI-first, "genius inside, simple outside."** Multiple goals + mini-goals for impulse-safe purchases + a priority-aware, human-realistic allocation engine + opportunity cost + goal feasibility + investment/compounding + net worth + a goal-aware cashflow feed. The deterministic core computes; the agent answers SIMPLY (¿se puede? ¿qué afecta? mejor plan, aporte semanal, fecha). Built ON the validated single-goal/cashflow/Margen engines — it makes them a PORTFOLIO without forking the money math.
- [x] Stage 17 load-bearing safety design (no double counting): the engine was single-goal everywhere (`weeklyGoalContribution`/`plannedGoalContribution` scalars). Stage 17 keeps those scalars but feeds them the SUM of COMMITTED per-goal contributions (active + cashflow-protected) — a zero-sum **recarve** that REPLACES, never adds. The allocation engine then distributes only the REMAINING free surplus (`cashflow.safeThisWeek`) toward each goal's FUNDING GAP (required − committed), never re-suggesting committed money. Pre-migration (no committed contributions) it falls back to the legacy planned figure → single-goal behavior is unchanged.
- [x] Stage 17 pure deterministic core (all gate-tested, 8 modules + orchestrator): `goal-portfolio.ts` (multi-goal: per-goal `buildGoalPlan` reuse, priority, primary selection where a mini NEVER becomes primary, committed-reserve sum, conflict detection); `allocation-engine.ts` (reserve top-up → CAPPED extra debt (never 100%) → goals by priority → preserved JOY floor; minimums reserved upstream so it can't recommend skipping one); `mini-goal.ts` (`evaluatePurchase` buy-today vs mini-goal vs wait + `planMiniGoal` cashflow-safe weekly from the joy budget + realistic date); `opportunity-cost.ts` (internal: joy reduced, competing-goal delay, debt interest avoided, verdict); `goal-feasibility` (per-goal via reused `buildGoalPlan`); `investment-math.ts` (compounding reusing the Stage 14 `monthlyRateDecimal`; póliza/CD/DCA; no rate → flat, honest); `net-worth.ts` (assets−debt, liquid vs total, no double-count of liquid investments, wealth-target progress + required monthly via binary search); `psychological-adherence.ts` (mini-goal eligibility, controlled-joy quotient, slip-risk — keeps plans sustainable); `goals-intelligence.ts` orchestrator (+ a compact Spanish agent digest) → `buildCoachingBriefing().goalsIntel`.
- [x] Stage 17 chat tools (9): `evaluate_purchase_as_goal` (the impulse-safe check — buy today vs mini-goal vs wait), `create_goal`, `create_mini_goal`, `prioritize_goals`, `update_goal` (pause/resume/repriotize/reschedule), `register_investment`, `net_worth`, `set_wealth_target`, `set_ambition_mode`. Agent prompt gained a "METAS, MINI-METAS Y PATRIMONIO" block (never just "no"; controlled joy; never skip a minimum; never fabricate returns/values; ask one question if price/data missing; check mini-goal eligibility before creating).
- [x] Stage 17 persistence: `goals-wealth-store.ts` (graceful, service-role) + migration `025_stage17_goals_wealth.sql` (additive, **applied in production 2026-06-17**): `goals` += portfolio columns (goal_type, archetype, parent_goal_id, is_primary, priority, cadence, contribution_amount, cashflow_protected, flexible_deadline, can_pause, contribution_model, investment_eligible); `user_financial_preferences` += ambition_mode, risk_tolerance, emergency_reserve_target, investment_horizon, investment_readiness, wealth_target; NEW tables `investment_accounts`, `recurring_investment_plans`, `goal_allocation_revisions` (audit-only, immutable), `net_worth_snapshots`, `external_portfolio_connections` (eToro/broker SCAFFOLD only — no sync, no secrets, no fake real-time values). All reads `select *` + try/catch → production unchanged until applied.
- [x] Stage 17 goal-aware cashflow/Margen: committed contributions reserve money through the SAME `weeklyGoalContribution` scalar fed to `calculateMargenKipu` + `buildFinancialCalendar` (single recarve). `goalsIntel` is an additive briefing field (like Stage 16 `spendingIntel`); the allocation/audit table is recomputed every turn and NEVER read back into Margen.
- [x] Stage 17 ambient (on the Stage 13 loop, all safeguards intact): `mini_goal_ready` (celebration, money-positive, light-mode OK), `goal_milestone`, `goal_off_track`, `too_many_goals`, `allocation_opportunity` — positive/optional framing, guarded so empty-goal users get nothing; one nudge per run, AI-written, never shaming.
- [x] Stage 17 dashboard: `/app/reality` gained a no-clutter "Metas y patrimonio" surface (weekly joy budget, primary goal progress, mini-goals ready/active, net worth + wealth-target %), all guarded.
- [x] Stage 17 adaptive onboarding: scaffolded — ambition/risk/reserve/wealth prefs persist (migration 025) and the agent can progressively ask (`set_ambition_mode`, `create_goal`, `register_investment`); a dedicated onboarding-UI flow is deferred (the agent already adapts simple vs power).
- [x] Stage 17 verification: deterministic gate **95/95** (added 16 Stage 17 assertions: portfolio priority/no-double-count, allocation never-100%-to-debt + joy floor + no re-suggest of committed, purchase buy/mini/wait, mini-goal planner, investment compounding, net worth + wealth target, opportunity cost, adherence, orchestrator recarve + digest, empty fallback, ambient mini-goal-ready, conflicts, + 3 review-fix regressions). Lint clean, build green. Adversarial review run across 5 dimensions with per-finding verification; confirmed-real fixes applied: NaN-guard in allocation, net-worth rate-model consistency, mini-goal divide-by-zero guard, mini-goal-eligibility prompt guard, two ambient voice softenings.
- [x] Stage 17 safety/honesty guardrails: never fabricates returns/asset values/prices; never recommends a specific security; never says a broker is connected (eToro = scaffold only); never tells the user to skip a debt/card minimum; never routes 100% of surplus to debt (joy floor + controlled indulgence preserved even with debt); goal contributions are NOT spending; no double-count (committed recarve, audit table never re-read); estimates always labeled; no raw JSON/IDs/internal labels to the user.
- [x] Stage 17 boundaries: did NOT begin Stage 18; eToro/live brokerage sync, live market prices, deep retirement/tax modeling and a dedicated onboarding-UI flow are explicitly DEFERRED.
- [x] **Stage 17 ROLLOUT — PRODUCTION-LIVE (2026-06-17).** Migration `025_stage17_goals_wealth.sql` **applied + verified** in production (12 additive `goals` columns + `goals_user_parent_idx`; 6 additive `user_financial_preferences` columns; 5 new tables `investment_accounts`/`recurring_investment_plans`/`goal_allocation_revisions`/`net_worth_snapshots`/`external_portfolio_connections` with RLS enabled, 0 client policies → deny-by-default, `service_role` grants, `goal_allocation_revisions` IMMUTABLE (no UPDATE), `anon`/`authenticated` denied, 0 rows). Base implementation committed (`2ab906e`) + pushed; production smoke surfaced one gap (reactivating a paused goal — not in the active portfolio) which was FIXED, re-validated, committed (`1cfdf8e`) + re-deployed so deployed == validated. Vercel auto-deployed **`dpl_4xaxDjE95fsajcwzoNtdnvWQkp1Y` READY** (production, `https://fincoach-mvp-vercel.vercel.app`). Preflight confirmed a clean production DB (no real/founder data). Final local validation green (gate 95/95, lint, build). **Smoke 16/16 (A–N)** on disposable users against the real production DB + executors: empty-state safety + no Stage-17 ambient nudge; main goal persisted as primary; mini-goal (buy-today vs cashflow-safe weekly set-aside) persisted; goal-aware Margen **recarve** (committed contribution reserves once, goal_contribution not counted as spend, pause releases + reactivate restores); allocation never 100% to debt + joy floor; opportunity cost / prioritize; investment compounding (póliza 5%) persisted; net worth + 500k wealth target; eToro scaffold (no fake connection); ambition mode persisted; `mini_goal_ready` ambient celebration; `/app/reality` surfaces goals/wealth without clutter; chat tools simple, no JSON/IDs/internal labels. All disposable test data deleted; production DB verified back to all-zero. `vercel.json` cron unchanged (`0 14 * * *`, daily on Hobby); no unrelated deploy/config change. Stage 18 NOT started.
- [x] Stage 17 known deferred/accepted: tool `summary` strings carry agent-facing coaching guidance (the established cross-stage pattern; the system prompt + output sanitizer keep it out of user-facing copy) — a future cross-cutting facts/summary split is noted, not done in Stage 17.

- [x] **Stage 18 — Personalization, Memory & Life Context Engine (PRODUCTION-LIVE 2026-06-17; deploy commit `b90ad10`, `dpl_CxCtykPotbWwM4Sc67jpGhvNa8M5` READY, migration 026 applied + verified, smoke 14/14 A–N).** The founder's core: Kipu adapts HOW it knows, recommends and responds to each user's **life philosophy** — an experiences/lifestyle user is never nagged to save (Kipu helps them enjoy without debt), a wealth-builder gets pushed harder and less permissive with discretionary — **without ever changing financial truth, obligations, minimums, cashflow, Margen Kipu, or the default simplicity/brevity.** "Genius inside, simple outside."
- [x] Stage 18 pure deterministic core (4 modules + orchestrator, all gate-tested): `personalization-signals.ts` (INFERRED behavior from raw usage — capture rhythm/time-window/weekly-batch, channel, modality, nudge engagement, correction tendency, activity level; every signal carries a confidence that degrades to `unknown` on thin data; NEVER infers sensitive attributes or emotions); `personalization-profile.ts` (unifies EXPLICIT prefs + inferred signals into one profile where **explicit ALWAYS overrides inferred**, every trait records `provenance` = explicit|inferred|default, and `financial_philosophy` is **explicit-only — never inferred from behavior**); `personalization-decisions.ts` (profile → safe concrete adaptations: tone/detail with **`defaultBrevity: true` as a hard invariant**, philosophy→`effectiveAmbition` joy-floor lever, promoted/collapsed dashboard surfaces, nudge `suppressBelowPriority` threshold, capture suggestion); `personalization-intelligence.ts` orchestrator (+ a compact Spanish agent digest whose FIRST rule is unconditional default brevity, then philosophy framing, tone/detail, risk, declared life context, transparency + privacy) → `buildCoachingBriefing().personalization`.
- [x] Stage 18 the founder's mechanism, money-safe: `financial_philosophy` (experiences|balanced|builder|wealth) → `philosophyToAmbition` (experiences→`light_touch`, wealth→`power_builder`, builder/balanced→`steady`) → `effectiveAmbition = explicit ambition_mode ?? philosophy-derived` → fed as the Stage 17 allocation's `ambitionMode` (the **joy floor only**). Verified: `goalsWealth.ambitionMode` is `undefined` when unset, so the philosophy-derived value genuinely fires for users who never set an explicit ambition. Minimums, debt protection, reserved commitments and Margen recarve are unchanged — personalization shapes only FRAMING + allocation posture + surfaces + nudge gating.
- [x] Stage 18 chat tools (10): `set_financial_philosophy`, `get_personalization_profile`, `set_communication_preference` (tone/detail via `coach_preferences`), `set_risk_preference` (reuses `setGoalPrefs`), `set_onboarding_mode`, `set_nudge_sensitivity`, `update_life_context`, `explain_personalization` (honest transparency from `provenance`), `personalization_feedback` (logs + applies the obvious unambiguous change), `reset_personalization_preference` (back to neutral; financial data untouched). Agent prompt gained a "PERSONALIZACIÓN" block: REGLA DE ORO (default brevity, adapt tone/framing not length), life-philosophy framing, use tools on explicit prefs, transparency + privacy (no sensitive/emotional inference, no internal labels/JSON/IDs).
- [x] Stage 18 persistence: `personalization-store.ts` (graceful `select *` + try/catch, service-role; reads explicit prefs + declared life context + raw inferred inputs — capture events, nudge engagement, correction count — and reuses `coach_preferences`/`user_financial_preferences`/`user_engagement` rather than duplicating them) + migration `026_stage18_personalization.sql` (additive, **NOT applied**): NEW `user_personalization` (philosophy + UX prefs), `user_life_context` (user-declared only, unique per kind), `user_preference_events` (append-only audit). All RLS enabled, 0 client policies → deny-by-default, `service_role` grants; `user_preference_events` gets NO UPDATE grant (immutable). Inferred behavior stays DERIVED at read time (no table). Production behavior unchanged until applied.
- [x] Stage 18 ambient: the personalization nudge `suppressBelowPriority` threshold (high sensitivity → only the important nudges) is passed into `decideAmbientNudge` on top of every Stage 13 safeguard (daily cap, per-topic cooldown, quiet hours, light mode). Only SUPPRESSES — never increases frequency; "low" sensitivity = no suppression, not extra nudges.
- [x] Stage 18 dashboard: `/app/reality` honors `dashboardDensity` + `collapsedSurfaces` — the net-worth line collapses for `minimal` density / lifestyle orientation, so an experiences user isn't shown a patrimonio-first dashboard. Default for unknown users is unchanged.
- [x] Stage 18 verification: deterministic gate **115/115** (Stage 18 assertions 96–114: cautious signal inference from REAL production channel strings + a forward-looking classifier check; explicit-overrides-inferred + provenance; philosophy→orientation; **`defaultBrevity` always true** + philosophy→effective ambition + explicit-ambition override; surfaces by orientation; nudge suppression by sensitivity; **philosophy never inferred**; orchestrator digest golden rule + privacy + framing; empty/new-user neutral fallback; **power user still defaultBrevity=true**; ambient suppression at the REAL high threshold (50) with protected obligations firing even at 999; normal-default no-floor; inferred-high capped at 25; founder joy-floor money chain (light_touch joy > power_builder); dashboard density gate; provenance honesty; tone/detail write-mapping). Lint clean, build green.
- [x] **Stage 18 ULTRACODE REVIEW & ADVERSARIAL HARDENING (2026-06-17).** A full multi-agent review (14 dimension reviewers + 64-scenario pre-mortem + adversarial verification of every high/medium finding + synthesis; 76 agents) audited the lower-reasoning Stage 18 build against the vision. Verdict: the deterministic spine (signals→profile→decisions→digest) was sound, money-safe, brevity-safe and privacy-safe — but **46 correctness/honesty/completeness defects survived verification.** All were fixed and re-verified by a second 5-agent workflow (clean GO, 0 unresolved, 0 regressions). Fixes: **(HIGH)** `set_communication_preference` wrote tone/detail values that violated the live `coach_preferences` CHECK so every tone but one silently failed to persist → added a write-side mapping (`toCoachTone`/`toCoachDetail`) to the `clear|coach_like|playful` / `short|medium|detailed` vocabulary; **`personalization_feedback` strictness** rerouted from overwriting the explicit-only `financial_philosophy` lever to the `ambition_mode` joy-floor lever (+ nudge-positive→normal, dashboard→density) so a single weak signal never rewrites the user's declared life identity; **reset** copy narrowed to its true scope and broadened to also forget declared life context (never touching the NOT-NULL/shared `coach_preferences`/`user_financial_preferences`); **ambient** `normal` sensitivity restored to a zero floor (Stage 13 behavior), inferred-`high` capped at 25 (only explicit `high` reaches 50), and a `PERSONALIZATION_PROTECTED_TOPICS` set so obligation/debt/cashflow/fraud nudges can NEVER be suppressed by personalization; **provenance honesty** (tone no longer sourced from the force-defaulted `profiles.tone_preference`; userMode/dashboardDensity provenance fixed) so `explain_personalization` can't claim a preference the user never set; **dashboard** net-worth line hidden only on explicit-minimal density or orientation collapse (never on a low-confidence inferred guess, never core truth); new **`forget_life_context`** tool wiring the previously-dead `removeLifeContext`; **`explain_personalization`** enriched with dashboard facts; migration `user_preference_events` grant tightened to append-only (no DELETE); honesty fixes to `set_nudge_sensitivity` copy. Kept-as-is: the 4 pure engines' core logic, orchestrator digest, money-safety chain. Deferred (documented, not claimed as delivered): real capture-modality tagging (forward-looking classifier; would touch the ledger writer — out of scope), `preferWindow`-aware timing (daily cron), adaptive onboarding UI, adherence-trait inference, feedback-loop read-back.
- [x] Stage 18 safety/privacy guardrails: never infers sensitive attributes, emotional states or personality with certainty; never exposes internal labels/enums/JSON/IDs; never manipulates or shames; never over-personalizes from weak signals (confidence-gated); explicit preferences always override inferred behavior; personalization NEVER changes financial truth, debt/card minimums, cashflow, Margen Kipu, or the default brevity (especially after routine actions); nudge frequency never increased aggressively.
- [x] **Stage 18 ROLLOUT — PRODUCTION-LIVE (2026-06-17).** Preflight: clean prod DB (all-zero, no real/founder data), HEAD `6a2974d`, only Stage-18 changes, migration 026 not yet applied. Migration `026_stage18_personalization.sql` **applied + verified** in production (3 additive tables `user_personalization`/`user_life_context`/`user_preference_events`; PK + FK→`auth.users` ON DELETE CASCADE on all three; unique `(user_id,kind)`; RLS enabled, **0 client policies → deny-by-default**; `service_role` SELECT/INSERT/UPDATE/DELETE on personalization+life-context and **SELECT/INSERT only on `user_preference_events` (append-only immutable, no UPDATE/DELETE)**; anon/authenticated have no data access; grant shape identical to the existing `goal_allocation_revisions` audit table). Final local validation green (gate 115/115, lint, build). Committed (`b90ad10`) + pushed; Vercel auto-deployed **`dpl_CxCtykPotbWwM4Sc67jpGhvNa8M5` READY** (production, `iad1`, `https://fincoach-mvp-vercel.vercel.app`, build ~31s). **Smoke 14/14 (A–N)** on disposable users against the real production DB + store/briefing: empty-state neutral + no crash; tone/detail persist vs the live `coach_preferences` CHECK (`direct`→`coach_like`, `balanced`→`medium`; raw `direct` rejected; documented lossy read-back) with brevity intact; explicit precedence (philosophy/nudge beat inference); **experience-first vs wealth-first = identical Margen but light_touch vs power_builder ambition and more joy budget for experiences**; power user keeps short default confirmations; honest capture (no fabricated telegram/voice); ambient `high`→50 / `normal`→0 with obligations protected; dashboard density gates only the optional net-worth line; life-context add/forget; feedback routes strictness→ambition (philosophy untouched) + append-only audit (UPDATE/DELETE denied); honest reset (clears personalization+life-context, keeps tone/detail/financial data); digest carries golden rule + privacy with no raw JSON; briefing builds for every dashboard variant. All disposable test data deleted; production DB independently verified back to all-zero (0 `s18smoke` users). `vercel.json` cron unchanged (`0 14 * * *`, daily on Hobby); no unrelated deploy/config/env change. Stage 19 NOT started.
- [x] Stage 18 boundaries: did NOT begin Stage 19. A dedicated personality-test onboarding UI is SCAFFOLDED (prefs persist + the agent can progressively ask) but the standalone test flow is DEFERRED.

- [x] **Stage 19 — Household, Shared Finance & Collaborative Money OS (PRODUCTION-LIVE 2026-06-17; deploy commit `ee57195`, `dpl_6iG4HfNPydVQunt9w54JMpe5UnHo` READY, migration 027 applied + verified, smoke 14/14 A–P).** Helps people coordinate shared money CALMLY — "¿quién le debe a quién?", "cerramos cuentas del viaje", "divídelo con mi novia", "yo pago 60 y ella 40", "fue mi invitación", "mi mamá no usa Kipu pero le mando 100/mes" — for couples, families, roommates, trips and family support, WITHOUT destroying individual privacy and WITHOUT becoming a shared spreadsheet. Personal Kipu (Margen, ledger, goals) is untouched for solo users and everyone keeps their own private truth.
- [x] Stage 19 pure deterministic core (3 engines, gate-tested 11 assertions): `split-engine.ts` (equal/percentage/fixed/income_weighted/custom/payer_absorbs; integer-cent largest-remainder so shares ALWAYS sum to the total exactly — never a lost/invented cent; invalid splits → ask, never guess money); `settlement-engine.ts` (signed net balances per member, greedy minimal who-owes-whom transfers, partial reimbursements + overpayments + netting, totalSharedBase counted ONCE — no double count, neutral never blameful); `household-intelligence.ts` orchestrator (+ Spanish digest + `emptyHouseholdIntelligence()`) → `buildCoachingBriefing().household`, permission-scoped (only households where the user is an ACTIVE member; never another member's private personal data).
- [x] Stage 19 personal-vs-shared truth (deterministic, no double-count): the payer's REAL outflow is their personal `expense` (Margen reflects what they paid today, logged via `log_movement`); `add_shared_expense` records ONLY the shared truth (who owes whom), counted once from `shared_expenses`; a reimbursement is a settlement that moves the shared balance — NOT income, NOT a new expense (the personal-cash bridge uses the existing `record_person_payment`/`refund` flow which is excluded from spend). Built on Kipu's existing `receivables` + ledger effect-types (only `type=expense` counts as spend). Household total = real money, never ×N members.
- [x] Stage 19 permission/privacy model: ALL household tables are RLS-enabled, deny-by-default (0 client policies), service_role-only (multi-owner shared rows can't use the simple `auth.uid()=user_id` policy), with membership + role permission checks enforced deterministically in the typed store BEFORE every write (viewer/external/non-member refused; owner/admin gate invites & settings). The browser never touches these tables; the dashboard reads the server-built `briefing.household`, which only loads households the user is an active member of. A member's private personal ledger/Margen is structurally never in these tables.
- [x] Stage 19 persistence: `household-store.ts` (graceful `select *`/try-catch → production UNCHANGED until applied) + migration `027_stage19_household.sql` (additive, NOT applied): NEW `households`, `household_members` (user_id NULL = non-user participant), `household_invites` (explicit accept lifecycle), `shared_expenses` (+ optional `origin_transaction_id` link to the payer's personal row), `shared_expense_splits`, `household_settlements` (reimbursements), `household_goal_contributions`, `household_audit_log` (append-only); additive `goals.household_id`/`goals.is_shared` so a Stage-17 goal can be shared (each member responsible only for their own committed contribution).
- [x] Stage 19 chat tools (10, permission-aware, neutral, no internals leaked): `create_household`, `add_household_participant` (non-Kipu people; never messaged), `invite_household_member` (owner/admin; never auto-add), `respond_household_invite`, `add_shared_expense` (natural-language split), `household_summary` (who owes whom + simplest settlement), `mark_reimbursement_paid`, `create_shared_goal`, `leave_household`, `set_household_visibility`. Agent prompt gained a "HOGAR Y DINERO COMPARTIDO" block (neutral/no-blame; privacy-first; personal-vs-shared no-double-count; reimbursement-not-income; natural language; ask one thing if a split is unclear; simple outside).
- [x] Stage 19 dashboard: `/app/reality` gained a guarded, no-clutter "Compartido" surface answering one question — what to do now (next action + simplest settlement path + shared-goal progress) — only when the user is in a household.
- [x] Stage 19 verification: deterministic gate **126/126** (11 Stage-19 assertions, 115–125: split-sum-exact on indivisible amounts; percentage/income/payer-absorbs; invalid→ask; single-expense who-owes-whom + simplest transfer; reimbursement settles + not income; partial + overpayment; **no double count (3×90=270 not 540)**; orchestrator digest carries no-blame/privacy/no-double-count rules with no raw JSON; empty/solo neutral fallback; membership gate excludes a non-active self; multi-household independence). Lint clean, build green. Security self-check: 0 authenticated grants (all deny-by-default), append-only audit, invite acceptance restricted to the resolved target user.
- [x] Stage 19 safety/privacy guardrails: never exposes a member's private accounts/transactions/income/debt/net-worth by default (structurally absent from shared tables); never infers relationship type from names/messages; never auto-invites/auto-links contacts; shared only when explicitly created; revocable (leave); neutral language (no "gastaste más"/blame); never counts a shared expense twice or a reimbursement as income; never suppresses a personal obligation nudge for household reasons; never changes personal ledger/cashflow/Margen truth.
- [x] Stage 19 boundaries / DEFERRED (safely scaffolded, documented — the spec permits scaffolding): household-aware ambient nudges (model ready; topic wiring deferred to keep cross-member privacy airtight); first-class shared accounts and shared debt (modeled via shared expenses/settlements + reused personal debt; dedicated tables deferred); granular per-field visibility rules table (privacy_mode minimal/standard/full implemented; per-field deferred); a full invite-delivery UI (tool-level lifecycle + token implemented; email/Telegram delivery deferred — open-label invites are accept-by-link only); trip-mode and family-support are MODELED via household type + non-user participants (no separate engine). Did NOT begin Stage 20.
- [x] **Stage 19 ROLLOUT — PRODUCTION-LIVE (2026-06-17).** Preflight: clean prod DB (all-zero, no real/founder data), HEAD `8a03be9`, only Stage-19 changes, 027 not yet applied. Migration `027_stage19_household.sql` **applied + verified** in production (8 additive tables households/household_members/household_invites/shared_expenses/shared_expense_splits/household_settlements/household_goal_contributions/household_audit_log; 8 PKs, 23 FKs with cascade chain (`owner_id`/`household_id`→cascade, `payer_member_id`→restrict); `goals` +`household_id`/`is_shared`; unique `(household_id,user_id)`/`(shared_expense_id,member_id)`/`(goal_id,member_id)`; RLS enabled, **0 client policies → deny-by-default**; `service_role` full DML on 7 tables and **SELECT+INSERT only on `household_audit_log` (append-only)**; **anon/authenticated fully denied** — no SELECT/INSERT/UPDATE/DELETE on any household table). Final local validation green (gate 126/126, lint, build). Committed (`ee57195`) + pushed; Vercel auto-deployed **`dpl_6iG4HfNPydVQunt9w54JMpe5UnHo` READY** (production, `iad1`, `https://fincoach-mvp-vercel.vercel.app`, build ~40s). **Smoke 14/14 (A–P)** on disposable users A/B/C + a non-user participant against the real prod DB + store/engines/briefing: empty-state neutral (personal Kipu intact); create household (owner active, privacy minimal, only owner sees it); invite→accept (a non-invited user CANNOT accept; an unauthorized user has no access); **non-member write refused**; equal split 50/50 sums exact, B owes A 50, **household total = 100 counted once (no double-count)**; split variants (60/40, invalid→ask, payer-absorbs); reimbursement settles (lives in household_settlements, not income); shared goal persists shared with the creator's own contribution; **non-user participant** in the split (90/3=30, never messaged); visibility change owner-only (a normal member refused); **cross-member privacy** (B's view holds only shared data, no personal account/transaction/income/debt fields); dashboard `briefing.household` shows a next action; **audit append-only (UPDATE/DELETE denied)**; digest neutral/no-blame/no-raw-JSON. All disposable data deleted (expenses→households→users order, respecting the payer restrict); production DB independently verified back to all-zero (0 `s19smoke` users). `vercel.json` cron unchanged (`0 14 * * *`, daily on Hobby); no unrelated deploy/config/env change.

- [x] **Stage 20 — Product Completion, Deferred Features & Founder Beta Readiness (PASS 1 code-complete 2026-06-18; migrations 028/029/030 created NOT applied; not committed/deployed; gate 144/144 incl. micro-stage A2).** A product-completion phase run as a sequence of internal micro-stages. **Phase 0 audit:** a 2-agent inventory of every deferred/scaffolded/forward-looking item across Stages 12–19 + docs → **27 items in 8 categories**, classified beta-required vs defer-to-scale. **Pass 1 completed three deep micro-stages with full gates:**
- [x] Stage 20 — Micro-stage C (**Personality / Life-Philosophy Test**, founder-requested, deferred at S18): pure Kipu-native situational test (`personality-test.ts` — 10 lifestyle questions, 8 bipolar dimensions, integer-normalized scoring, 6 warm archetypes) + `personality-mapping.ts` (axis→philosophy/risk/detail/nudge/tone, threshold-gated so weak signals never over-personalize; philosophy from the experience↔wealth AXIS, not the label) → applies via the existing Stage 18 setters as EXPLICIT prefs (a later explicit change still wins). Migration `028_stage20_personality_test.sql` (`user_personality_test`, service-role deny-by-default) + graceful store. 4 chat tools (`get_personality_test` to ask conversationally, `submit_personality_test` to score+apply+save, `personality_test_result`, `reset_personality_test`) + a prompt "TEST OPCIONAL" offer (once, opt-in, presented as adaptation NEVER diagnosis). Honest, no creepy labels, reversible.
- [x] Stage 20 — Micro-stage A (**FX / Multicurrency core**): pure `fx-rates.ts` (`convert`/`findRate` direct+inverse, **never invents a rate** → `no_rate` honest fallback; `valuateMixed` aggregates mixed-currency, trusts pre-computed base, converts the convertible and EXCLUDES+flags the rest — no guessed cross-rate, no double conversion; deterministic source ranking manual>historical>provider>cached; `FxProvider` abstraction so a live provider plugs in later with zero business-logic change). Migration `029_stage20_fx_rates.sql` (`fx_rates` user-scoped manual cache, service-role deny-by-default) + graceful store. 2 chat tools (`set_exchange_rate` saves a user-stated rate, `convert_currency`) + a "MONEDAS / TIPO DE CAMBIO" prompt rule. Reuses the existing `currency-resolver` safe gate.
- [x] Stage 20 — Micro-stage A2 (**Free real FX provider — Frankfurter**): researched provider terms from official docs/curl before coding (free, **no API key, no cost**, commercial use OK, caching explicitly allowed, no quotas, ECB-sourced; verified the working endpoint `https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL` + historical `/v1/<date>?...`; confirmed COP/ARS/PEN/CLP are NOT in the ECB set → omitted from `rates` → fall through to manual). Built `fx-provider-frankfurter.ts` (pure `parseFrankfurter` + an injectable-fetch provider with 4s AbortController timeout, HTTP/parse/timeout → null never throw, same-currency shortcut, latest + historical-by-date) + `fx-resolver.ts` (cache-first orchestration: same → known/manual+cached → live provider → honest `no_rate`; **a user's manual rate ALWAYS outranks the provider** because the network is only hit when no known rate exists). Extended migration 029 with a GLOBAL `fx_rate_cache` (provider/reference rates, one row per pair+real-effective-date, idempotent upsert, service-role deny-by-default) + store cache fns (sanitized ISO codes vs PostgREST `.or()` injection). `convert_currency` now resolves manual→cache→live Frankfurter→ask, caches the fetched reference rate, and labels it as **reference (not bank/transaction) rate, never guaranteed**, concise. No env vars, no secrets, graceful when offline/unavailable.
- [x] Stage 20 — Micro-stage G (**Snapshot / Trend engine**): the `net_worth_snapshots`/`financial_context_snapshots` tables existed but were NEVER written → no honest trends were possible. Built `trend.ts` (pure day-over-day compare: direction with a dead-band, "good-direction" semantics so debt-up is NOT an improvement, **honest `no_prior`** — never a fabricated yesterday/today, compact digest only on real change and never recited by default) + migration `030_stage20_daily_snapshots.sql` (`daily_financial_snapshots`, one row/user/day, service-role deny-by-default) + graceful store (idempotent daily upsert + `loadPriorSnapshot` = the most recent PRIOR day). Wired into `buildCoachingBriefing`: compares live headline metrics (Margen, daily safe-spend, net worth, total debt, Pulso) to the last stored day, adds `briefing.trend` + a digest line, and writes today's snapshot. Powers honest "¿qué cambió?".
- [x] Stage 20 — Micro-stage E (**Adaptive onboarding**) substantially addressed: on inspection, onboarding ALREADY persists `coach_preferences` + `user_financial_preferences` (the Phase-0 sub-agent was imprecise — not a bug); the missing piece, a post-onboarding personality-test OFFER, is now provided agent-natively (prompt offer + the 4 test tools). A dedicated onboarding-UI test flow remains polish (deferred).
- [x] Stage 20 verification: deterministic gate **144/144** (18 Stage-20 assertions, 126–143: personality explorer→experiences/light_touch, constructor→wealth/power_builder/detailed/power/direct, risk axis, **threshold-gating no-over-personalization**, confidence + empty-test safety; FX same/known/inverse + **never-invents** + mixed valuation honest exclusion + source ranking; trend improvement-semantics + **honest no-prior** + dead-band; A2 provider parser real-rate/unsupported-null/base-mismatch, resolver same-no-call, **cache-first + manual-outranks-provider**, fetched+historical-endpoint, **provider disabled/throwing→no_rate no-crash**, unsupported-pair→no_rate). Lint clean, build green.
- [x] Stage 20 safety/privacy: none of the three micro-stages touch the ledger or change money truth (FX is advisory; the ledger still stores original+base with the user-confirmed rate; the test only sets framing prefs; trends are read-only display). All new tables service-role deny-by-default. No creepy labels, no sensitive inference, simple-outside preserved (test opt-in once, trend digest never recited by default, FX only when needed).
- [x] Stage 20 DEFERRED to later passes / scale (documented, NOT beta-blocking): Micro-stage B (Whoop-style dashboard CHARTS — needs a chart lib + the now-available snapshots; text/number cards + the trend line ship now, full charting later); Micro-stage D (real capture-modality tagging — still risky to the dedupe-sensitive ledger writer; the S18 forward-looking classifier + the personality test cover the need for beta); Micro-stage F household deferred (ambient nudges, invite delivery, per-field visibility, first-class shared accounts/debt — privacy-sensitive, modeled-sufficiently for beta); live FX provider + eToro/live prices + deep retirement/tax (need external keys/scope). No commit/push/deploy; migrations 028/029/030 created but NOT applied — awaiting explicit approval. Did NOT begin Stage 21; did NOT begin monetization/billing/scale.
- [x] **Stage 20 PASS 1 ROLLOUT — PRODUCTION-LIVE (2026-06-18).** Preflight: clean prod DB (all-zero, no real/founder data), HEAD `29cd28b`, only Stage-20 PASS-1 changes, 028/029/030 not yet applied. Migrations **applied + verified** in production: `028_stage20_personality_test.sql` (`user_personality_test`, PK `user_id`→`auth.users` cascade), `029_stage20_fx_rates.sql` (user-scoped `fx_rates` unique `(user_id,base,quote)` + GLOBAL `fx_rate_cache` unique `(base,quote,rate_date)` with provider/source metadata — the only S20 table without a user FK, intentional), `030_stage20_daily_snapshots.sql` (`daily_financial_snapshots` unique `(user_id,snapshot_date)`). Verified: **4 tables, RLS all enabled, 0 client policies → deny-by-default, 4 PKs, 3 user FKs (cache is global), 3 unique indexes, service_role full DML on all four, anon/authenticated fully denied, 0 rows.** Final local validation green (gate **144/144**, lint, build). Committed (`c980cde`) + pushed; Vercel auto-deployed **`dpl_GF3VZTjk9VRcFExrnjiNRRxsxFYy` READY** (production, `iad1`, `https://fincoach-mvp-vercel.vercel.app`, build ~36s). **Smoke 16/16 (A–P)** on disposable users against the real prod DB + stores/engines/provider/briefing/agent: empty-state graceful; test available (10 q, v2); submit→persist→reload→map (wealth→wealth/aggressive/detailed/direct, archetype ambicioso); experience-vs-wealth opposite philosophies (explorador/experiences/conservative/gentle); retake = single row + reset deletes; manual FX persists & drives conversion + mixed valuation excludes the unconvertible; **LIVE Frankfurter USD→BRL fetched a real current rate (5.084, 2026-06-17), cached it, cache-first on reuse**; unsupported USD→COP → honest `no_rate` + **manual outranks provider**; **historical USD→BRL 2024-01-02 → dated reference rate (4.8888)**; provider crash/HTTP-500 → `no_rate` never throws; daily snapshot idempotent (1 row/day); trend honest no-prior (empty digest); trend with prior → debt-up NOT an improvement, net-worth-up is, digest correct; briefing builds with `briefing.trend` (no regression); **agent answers personality + FX questions in natural Spanish (used `get_personality_test`)**; **core regression: agent created 1 account + recorded 1 expense (ledger writer intact)**. All disposable data deleted; production independently re-verified all-zero (0 S20 rows, `fx_rate_cache` 0, 0 disposable auth users by id + by email, `user_financial_preferences`/`coach_preferences`/`transactions`/`accounts`/`chat_messages`/`profiles` all 0 — the two service-role-DELETE-restricted pref tables cleared via the auth-user cascade). Temp smoke route (`src/app/dev/stage20-prod-smoke`) deleted, never committed. `vercel.json` cron unchanged (`0 14 * * *`, daily on Hobby); no unrelated deploy/config/env change. Did NOT begin Stage 20 PASS 2, monetization, or Stage 21.
- [x] **Stage 20 PASS 2 — Visual Dashboard, Household Completion & Founder/Family Beta Polish (CODE-COMPLETE 2026-06-18; migration 031 created NOT applied; not committed/deployed; gate 158/158).** Product-completion pass to make Kipu feel beta-ready, run as micro-stages on the PASS-1 base. **Charting decision: hand-rolled SVG, NO dependency** (matches PulsoOrb/MargenRing; server-rendered, zero hydration, mobile-safe). **Micro-stage B (Visual Dashboard):** new SVG primitive library `src/app/app/components/Charts.tsx` (Sparkline, MiniBars, ProgressRing, StackedBar, TrendPill, CashflowTimeline); a PURE personalization-aware view-model `src/lib/dashboard/dashboard-model.ts` (orders surfaces, promotes/collapses by Stage-18 decisions, **obligations NEVER collapsed/hidden** — iron rule); honest snapshot history `loadSnapshotSeries` (query-only, no migration; only real recorded days, no fabricated points); new cards `DashboardCards.tsx` (TrendStrip "¿qué cambió?", SpendingPressure, Household, Wealth/Patrimonio, KipuFit, FX/Monedas, CashflowTimeline) assembled by `DashboardSecondary.tsx`; wired into `/app` (trend strip + secondary region; core Margen/Pulso untouched) + new detail routes `/app/kipu-fit` and `/app/household`. **Micro-stage F (Household completion):** invite-by-link/token (reuses 027 `token`, no migration) — `createInviteLink`/`acceptInviteByToken`/`declineInviteByToken`/`cancelInvite`/`listHouseholdInvites` + 14-day computed expiry + a `/app/join/[token]` accept page; recurring shared bills (migration **031** `household_recurring_expenses`, graceful) — template+`logRecurringSharedExpense` instantiates ONE shared expense (no double count) + `upcomingSharedBills` on the view + dashboard/digest; privacy-mode ENFORCEMENT (`visibleTransfers`: minimal = only the member's own position; standard/full = full graph) + `householdVisibilityExplainer`; trip/family polish via `settleHousehold` ("cerramos el viaje", records simplest reimbursements as paid, optional archive) + family-support as a payer-absorbs recurring; 6 new agent tools (`household_invite_link`, `accept_household_invite`, `add_recurring_shared_expense`, `log_recurring_shared_expense`, `settle_household`, `household_visibility_explainer`) + HOGAR prompt block extended; **household ambient nudges with NO migration** — new topics `household_settlement_pending`/`household_bill_due`/`household_shared_goal` sourced ONLY from `briefing.household` (privacy-structural facts), neutral, SUPPRESSIBLE (not protected), idempotent via the existing `(user,topic,day)` claim, competing for the single daily slot. **Micro-stage H (Beta polish):** **fail-closed `/app/dev` layout gate** (`KIPU_INTERNAL_EMAILS` allowlist — beta users can no longer reach internal live-model simulators in production); a `/app/settings` control hub + sidebar/header entry (Kipu Fit, Hogar, statement import, FX rate, Telegram, reminders, reset, privacy — agent-native CTAs via the chat `?share=`); `docs/FOUNDER_BETA_GUIDE.md`. Gate **158/158** (14 new PASS-2 assertions: view-model obligation-pinning + promote/collapse + minimal-density + present-gating; recurring cadence math; household minimal-visibility + standard-full + upcoming bills; household nudge selected/privacy-clean-facts/suppressible). Lint clean, build green. **DEFERRED (documented, not beta-blocking):** first-class shared accounts/debt (scaffold only); per-field visibility; email/SMS invite delivery (link/code suffices); settlement proof-of-payment evidence; multi-day net-worth chart needs accrued history; eToro/live prices. No commit/push/deploy; migration 031 NOT applied. Did NOT begin monetization or Stage 21.
- [x] **Stage 20 PASS 2 ROLLOUT — PRODUCTION-LIVE (2026-06-18).** Preflight: clean prod DB (all-zero, no real/founder data), HEAD `9add01a`, only PASS-2 changes, 031 not applied, no drift. Migration `031_stage20pass2_household_recurring.sql` **applied + verified** in production (`household_recurring_expenses`: 16 cols, PK, **household_id→households CASCADE**, **payer_member_id→household_members RESTRICT** integrity guard, partial index on active, RLS enabled, **0 client policies**, service_role full DML, **anon/authenticated no SELECT/INSERT/UPDATE/DELETE**, 0 rows; 027 tables intact). Env: no programmatic Vercel env tool/CLI → `KIPU_INTERNAL_EMAILS` left UNSET, which is the **fail-closed safe state** (production `/dev/*` blocks everyone; founder sets it in the dashboard only to gain prod /dev access); `KIPU_APP_BASE_URL` not needed (invite links use the working production-alias fallback); no secrets exposed, no unrelated env changed. Final local validation green (gate **158/158**, lint, build). Committed (`aee435b`) + pushed; Vercel auto-deployed **`dpl_A1frEQe3PR8hN1ZBRjYR146apLyo` READY** (production, `iad1`, `https://fincoach-mvp-vercel.vercel.app`, build ~40s). Deployed `/dev/*` confirmed **307→/login** (gate active, not a 200 internal page). **Smoke 14/14 (A,D,E,F,G,H,I,J,K,L,N,O,Q,R)** on disposable users A/B/C (+ a non-user participant) against the real prod DB incl. migration 031: empty-state graceful; personalization never hides obligations + wealth-first promotes patrimonio; honest 2-pt snapshot series + debt-up≠improvement; **invite-by-link** token valid + wrong-user rejected + target joins + non-member excluded; **privacy** minimal=own-position-only / standard=full graph; **recurring** template + upcoming bill + log = exactly ONE shared expense (no double count); family-support payer-absorbs to a non-user participant; **settle** records reimbursements → allSettled; **household nudge** household_* topic, privacy-clean facts, suppressible; visibility explainer accurate/no-IDs; Kipu Fit available; FX card known-rate vs honest no-rate (no network, no invented rate); **agent conversation** (household_summary / add_recurring_shared_expense / household_visibility_explainer) ok with no JSON/IDs/leak; **core regression** agent created account + expense (ledger intact) + briefing builds. All disposable data deleted (households-children-before-households for the RESTRICT FK; auth-user cascade for the append-only/no-DELETE tables); production **independently re-verified all-zero** (households/members/invites/shared_expenses/splits/settlements/recurring/goal_contribs/audit_log + transactions/accounts/goals + snapshots/fx/personality + ufp/coach_prefs/ambient_nudges/chat/profiles + 0 disposable auth users by id and email). Temp smoke route (`src/app/dev/stage20pass2-smoke`) deleted, never committed. The `/app/dev` gate was refined to production-only enforcement (production fail-closed UNCHANGED; local QA/gate unblocked) and rode along in the docs-close. `vercel.json` cron unchanged (`0 14 * * *`, daily on Hobby); no unrelated deploy/config change. Did NOT begin monetization or Stage 21.



### Current phase & module status

> **This section is the at-a-glance status board. It supersedes the older
> "Immediate next milestone" prose that used to sit here (which was frozen at
> Stage 18/19). The per-stage detail below and the newest-first heads at the top
> of this file remain the full history.**

**Phase (updated 2026-07-02, HEAD `b97bd33`):** post–Stage 27, **READY for
founder/family beta.** Stages 1–27 are production-live at www.soykipu.com.

- **Agent:** `KIPU_AGENT_MODE=on` in production — the AI-native agent is the primary
  brain; the legacy deterministic pipeline is fallback-only. `TRANSACTION_PARSER_MODE=
  ai_with_basic_fallback`. Model default `gpt-5.4` (`OPENAI_COACH_MODEL`). 109 typed
  tools after S30 (S29 +9 chat-control; S30 +6: add/update/remove_asset, set_entity_note,
  register_card_payment, card_status). The Margen is calendar-aware (S30): sustainable
  safe-spend over the full cycle, card billing-cycle aware, savings/investment/goals
  protected in full, with an expandable breakdown + capacity view.
- **Migrations:** 001–037 applied in production. `033 scheduled_changes` verified
  2026-07-02. `034` (soft-close `accounts.status`/`debt_accounts.status` + `user_feedback`)
  applied 2026-07-02. `035` (S30: `fixed_expenses.is_variable`, `notes` on accounts/
  debt_accounts/goals, `debt_accounts.last_payment_date`) + `036` (authenticated RLS for
  `investment_accounts` so onboarding can write assets) applied 2026-07-02. All live.
- **Latest gates:** capture-test 179/179, onboarding-wizard-test 81/81,
  onboarding-loop-test 21/21; lint + build green.

| Module | Stage(s) | Migration | Status |
|---|---|---|---|
| AI agent core (typed tools, live context, memory) | 12→27 | — | live (`on`) |
| Onboarding (structured AI-guided wizard + CSV + multi-currency) | 8–11, 22–24 | 010, 032 | live |
| Universal capture (multimodal → dedup to ledger) | 12 | 017–020 | live |
| Ledger & money model (`original_*`/`base_*`, reversals) | 1–5 | 003 | live |
| Margen Kipu + attribution | 6, 16 | 015 | live |
| Cashflow, calendar, scenarios | 15 | (derived) | live |
| Debt protection (health, payoff, statements, interest) | 14 | 023 | live |
| Spending / merchant intelligence | 15–16 | 024 | live |
| Goals, mini-goals, wealth, net worth | 17 | 025 | live |
| Personalization + life context | 18 | 026 | live |
| Personality / life-philosophy test | 20C | 028 | live |
| Household / shared finance + recurring shared | 19, 20-P2 | 027, 031 | live |
| FX / multi-currency (honest rates, Frankfurter) | 20A, 24 | 029, 032 | live |
| Trends / daily snapshots | 20G | 030 | live |
| Ambient loop (proactive Telegram, daily cron) | 13 | 022 | live |
| Universal chat control (create/edit/pause/close/cancel everything by chat; 109 tools) | 26, 29 | 034 | live |
| Scheduled changes (future planned mutations, daily cron) | 26 | 033 | live |
| Living dashboard + 11 metric drilldown pages | 8–10, 27 | (reads) | live |
| Channels (web chat, Telegram webhook, inbound email) | 3, 12 | 004–007 | live |
| Legacy deterministic pipeline | 1–11 | — | fallback-only |

**Deferred / not in scope for beta:** monetization/pricing/billing; live
brokerage (eToro) sync + market prices; deep retirement/tax modeling; hourly
ambient cron (Vercel Hobby caps at 2 daily crons); dedicated onboarding-UI flows
for goals/wealth and the personality test.

**How the product got here:** financial truth (11–12) → keeping it fresh (13) →
debt/interest protection (14) → whole-cashflow into one calm daily number (15) →
learning spending behavior without shame (16) → life goals + wealth (17) →
personalization by life philosophy (18) → household/shared finance (19) →
personality + FX + trends (20) → pre-beta hardening + public surface (21) →
multi-currency onboarding (22–24) → beta-readiness money-truth review (25) →
universal chat control + scheduled changes (26) → living dashboard + metric
drilldowns (27).

Gates before any module ships: lint clean, build passes, automated internal QA
(`/dev/*-test` routes) where applicable, manual QA per TEST_SCRIPTS.md, human
review, and explicit commit approval.
