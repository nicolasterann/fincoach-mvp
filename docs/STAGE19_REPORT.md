# Stage 19 — Hogar, Finanzas Compartidas y Sistema Operativo de Dinero Colaborativo

**Fecha:** 2026-06-17 · **Estado:** código completo · gate **126/126** · lint limpio · build verde · **migración 027 creada pero NO aplicada** · **sin commit / push / deploy**. **No se inició Stage 20.**

---

## 1. Resumen ejecutivo

Stage 19 le da a Kipu la capacidad de **coordinar dinero compartido con calma** — parejas, familias, roomies, viajes y apoyo familiar — respondiendo "¿quién le debe a quién?", "cerramos cuentas del viaje", "divídelo con mi novia", "yo pago 60 y ella 40", "fue mi invitación", "mi mamá no usa Kipu pero le mando 100 al mes" — **sin destruir la privacidad individual y sin volverse una hoja de cálculo compartida**. El reto central, resuelto de forma determinista: **crear una verdad compartida sin exponer la verdad personal de nadie y sin doble conteo.** El Kipu personal (Margen, ledger, metas) queda **intacto** para quien no usa hogares, y cada quien conserva su propia verdad privada. **GO de código** (migración 027 sin aplicar).

---

## 2. Análisis de producto / diferenciación

Lo que duele hoy en finanzas compartidas: apps tipo Splitwise sienten una **auditoría** ("gastaste más"), las hojas compartidas son frías y manuales, y todo mezcla lo personal con lo común. Kipu gana porque: (a) **lenguaje natural** ("pagué el súper, divídelo con mi novia") sobre el mismo motor de captura; (b) **neutralidad y de-escalada** — habla de "saldos pendientes", nunca de culpa; (c) **separación estructural** personal vs compartido (la verdad personal nunca entra a las tablas del hogar); (d) **una sola pregunta**: ¿qué hay que hacer ahora? No una contabilidad. Esto hace a Kipu útil para **todos**, no solo para quien lleva las cuentas.

---

## 3. Funciones extra propuestas y por qué

1. **Camino de liquidación más simple** (min-transfers) — en vez de N pagos cruzados, el mínimo de transferencias para cuadrar; reduce fricción social.
2. **Participantes no-usuarios** ("mi mamá") — entran en las divisiones y saldos sin tener que instalar Kipu ni recibir mensajes.
3. **Vínculo gasto-compartido ↔ gasto-personal** (`origin_transaction_id`) — el mismo evento real no se cuenta dos veces y el agente sabe que son lo mismo.
4. **Metas compartidas con responsabilidad por miembro** — cada quien afecta su plan personal solo por SU aporte comprometido.
5. **Resumen "qué hacer ahora"** en el dashboard — una sola tarjeta, sin clutter.

---

## 4. Extra features: implementadas vs diferidas

- **Implementadas ahora:** 1–5 de la sección 3 (todas en el núcleo determinista + tools + dashboard).
- **Diferidas (scaffolded, documentadas — el spec lo permite):** nudges ambient del hogar (modelo listo, wiring diferido para blindar privacidad cross-miembro); cuentas compartidas y deuda compartida de primera clase (modeladas vía gastos/settlements + deuda personal reusada); reglas de visibilidad por-campo (hay `privacy_mode` minimal/standard/full; por-campo diferido); UI de entrega de invitaciones (hay lifecycle + token; entrega por email/Telegram diferida); trip-mode y family-support se MODELAN con tipo de hogar + participantes no-usuario (sin motor aparte).

---

## 5. Hallazgos de la inspección del código actual

Dos inspecciones profundas (sub-agentes Explore): (a) **modelo de propiedad/RLS** — no existía ningún concepto de hogar/grupo/invitación; dos patrones RLS: Strategy A (`authenticated` con `auth.uid()=user_id`) para tablas de un solo dueño visibles en UI, y Strategy B (service-role-only, deny-by-default) para tablas internas/derivadas (todo S16/17/18). (b) **persona-a-persona ya existe**: la tool `record_person_payment` + la tabla `receivables` (owed_to_user/user_owes, FIFO) + la taxonomía de efectos del ledger donde **solo `type=expense` cuenta como gasto** (transfer/refund/debt_payment/goal_contribution excluidos). La tabla `transactions` ya tiene columnas dormidas `is_split`/`reimbursed_amount`/`reimbursement_status`.

---

## 6. Gap analysis

- **Ya existe y se reusó:** receivables + record_person_payment (reembolsos/préstamos), efectos del ledger + regla de "solo expense cuenta", metas de S17, briefing/agent/ambient/dashboard, convención RLS service-role-only.
- **Existía pero se fortaleció:** la verdad personal-vs-compartido (se hizo explícita y determinista con separación estructural).
- **Faltaba y se construyó:** households/members/invites/shared_expenses/splits/settlements/contributions/audit, los 3 motores, store permission-checked, 10 tools, integración en briefing/dashboard.
- **Útil pero diferido:** nudges del hogar, cuentas/deuda compartida de primera clase, visibilidad por-campo, entrega de invitaciones.

---

## 7. Alcance exacto de la implementación

3 motores puros (split, settlement, intelligence) + orquestador con digest y fallback vacío; migración 027 (8 tablas + 2 columnas en goals, additive, no aplicada); store graceful permission-checked; 10 tools del agente + bloque de prompt; campo `briefing.household` + digest; superficie de dashboard; gate 126/126. No se añadieron rutas regex; todo es tool + memoria + prompt; el ledger personal nunca se toca.

---

## 8. Archivos cambiados

Nuevos: `src/lib/household/split-engine.ts`, `settlement-engine.ts`, `household-intelligence.ts`, `household-store.ts`; `supabase/sql/027_stage19_household.sql`; `docs/STAGE19_REPORT.md`.
Modificados: `src/lib/financial/coaching-signals.ts` (campo household + carga + digest), `src/lib/ai/agent/kipu-agent.ts` (emptyBriefing + tool-list + bloque HOGAR), `src/lib/ai/agent/kipu-agent-tools.ts` (10 schemas + ejecutores + switch), `src/app/app/reality/page.tsx` (superficie compartida), `src/app/dev/capture-test/page.tsx` (11 aserciones), `docs/BUILD_PROGRESS.md`.

---

## 9. Migraciones creadas (no aplicadas)

`027_stage19_household.sql` — aditiva, **NO aplicada**. 8 tablas nuevas + 2 columnas en `goals` (`household_id`, `is_shared`). Todas con RLS habilitada, **0 políticas de cliente (deny-by-default)**, grants solo a `service_role`; `household_audit_log` append-only (solo select+insert). FKs a `auth.users`/`households` con cascade. Ningún objeto existente se elimina ni debilita.

---

## 10. Cambios en el modelo de datos

Solo aditivos (sección 9). Las filas del hogar son **multi-dueño**, por eso NO usan la política `auth.uid()=user_id`: van deny-by-default + chequeo de permisos en la capa de store. El store degrada con gracia (`select *` + try/catch) → **producción idéntica hasta aplicar 027**. La verdad personal queda en `transactions`/`accounts` (sin cambios).

---

## 11. Modelo de hogar / grupo

`households`: id, owner_id, name, type (couple|family|roommates|trip|custom), base_currency, mode, privacy_mode (minimal por defecto), status. Tipos cubren pareja, familia, roomies, viaje y custom; modos cubren solo-gastos, solo-metas, full, trip-split, family-support, custom.

---

## 12. Roles y permisos de miembros

`household_members.role` ∈ owner|admin|member|contributor|viewer|external; `status` ∈ active|invited|left|removed. Permisos deterministas en el store: **escribir gastos/reembolsos/metas** → owner/admin/member/contributor; **invitar/quitar/ajustes** → owner/admin; **ver** → cualquier miembro activo. viewer/external no escriben; no-miembro no lee. Los datos personales privados de otro miembro **nunca** son visibles (no están en estas tablas).

---

## 13. Ciclo de vida de invitaciones

`household_invites` con status pending|accepted|declined|cancelled|expired + token. Un miembro **no entra hasta aceptar**. `invite_household_member` (owner/admin) → `respond_household_invite` (acepta/rechaza; solo el usuario objetivo resuelto puede aceptar). **Nunca** se agrega a nadie por contacto/email/nombre. Para no-usuarios, `add_household_participant` (no se les escribe). La entrega de invitaciones por canal queda diferida (las invitaciones con etiqueta abierta son accept-by-link/token).

---

## 14. Modelo de gastos compartidos

`shared_expenses` (household, payer_member, total original+base, currency, occurred_at, split_method, status, **origin_transaction_id** opcional al gasto personal del pagador, audit) + `shared_expense_splits` (un row por participante: share_base, settled_base). Es la verdad del hogar, **contada una vez**.

---

## 15. Métodos de división

`split-engine.ts`: equal, percentage, fixed, income_weighted, custom, payer_absorbs ("mi invitación"). Trabaja en **centavos enteros** con reparto de residuo por mayor-fracción → las partes **siempre suman el total exacto** (gate #115). División inválida (porcentajes ≠ 100, fijos que no suman) → **marca inválido y pregunta**, nunca adivina dinero (gate #117). Income-weighted es explícito (no infiere desigualdad de ingresos).

---

## 16. Motor de liquidación / reembolsos

`settlement-engine.ts`: saldo NETO con signo por miembro (>0 le deben, <0 debe; suma ≈ 0), **camino mínimo de transferencias** (greedy), reembolsos parciales y sobrepagos manejados por signo, **netting** de muchos gastos, pendiente vs pagado. Marcar reembolso pagado (`mark_reimbursement_paid`) ajusta el saldo. Neutral: produce saldos + próximo paso, nunca reproche (gates #118–#121).

---

## 17. Metas compartidas

Extiende las metas de S17 con `goals.household_id`/`is_shared` + `household_goal_contributions` (aporte semanal por miembro). Cada miembro es responsable **solo de su propio aporte comprometido** (nunca auto-asignado); su plan personal se afecta solo por ESE aporte.

---

## 18. Cashflow del hogar

El orquestador produce: gasto compartido del mes, saldos quién-debe-a-quién, reembolsos pendientes, progreso de metas compartidas, próximo paso del usuario. **No expone el cashflow personal privado de otros miembros** (no está en estas tablas). Responde "¿quién pagó más / qué falta cuadrar / cómo vamos?".

---

## 19. Verdad personal vs compartida (determinista)

Regla central, sin doble conteo: el gasto **personal** del pagador (la plata que realmente puso) va con `log_movement` → su Margen refleja lo de hoy; `add_shared_expense` registra SOLO la verdad compartida (quién debe a quién), contada **una vez** desde `shared_expenses`. Un **reembolso** mueve el saldo compartido — **NO es ingreso ni gasto nuevo**; el puente a la caja personal usa el flujo `refund` existente (excluido de gasto). Total del hogar = plata real (p.ej. $100), nunca ×N (gate #121: 3×90=270, no 540).

---

## 20. Cuentas / gastos fijos / deuda compartidos

Cuentas compartidas y deuda compartida de primera clase quedan **scaffolded/diferidas**: hoy se modelan con gastos compartidos + settlements y con la deuda personal reusada; gastos fijos compartidos se modelan como gastos compartidos recurrentes (un motor dedicado queda para después). La deuda personal **nunca** se expone por defecto.

---

## 21. Viaje / apoyo familiar / participantes no-usuario

Trip-mode = household `type='trip'` (presupuesto, participantes, split, liquidación al final). Family-support = household `type='family'` + participante no-usuario ("mi mamá") o compromiso personal, sin obligar a nadie a entrar. `household_members.user_id` NULL = participante no-usuario (entra en divisiones y saldos, **nunca** recibe mensajes), convertible a invitado después.

---

## 22. Controles de visibilidad

`households.privacy_mode` minimal (por defecto) | standard | full (`set_household_visibility`, solo owner/admin). Lo compartido es solo lo que se registró como compartido; nada se comparte por defecto. La visibilidad **por-campo** (categoría/monto/descripción) queda diferida. Las finanzas personales **nunca** se exponen, sea cual sea el modo.

---

## 23. Dashboard del hogar

`/app/reality` gana una tarjeta "Compartido" (guardada, solo si el usuario está en un hogar) que responde **una** pregunta: qué hacer ahora (próximo paso + camino más simple para cuadrar + progreso de metas compartidas). Sin clutter, sin contabilidad.

---

## 24. Tools del agente del hogar (10)

`create_household`, `add_household_participant`, `invite_household_member`, `respond_household_invite`, `add_shared_expense`, `household_summary`, `mark_reimbursement_paid`, `create_shared_goal`, `leave_household`, `set_household_visibility`. Todas permission-aware (chequeo de membresía+rol en el store), tipadas, sin exponer ids/JSON/enums, neutrales.

---

## 25. Nudges ambient del hogar

**Diferidos (scaffolded)** intencionalmente: el modelo está listo (saldos pendientes, meta compartida fuera de rumbo, liquidación de viaje lista), pero el wiring a Telegram se difiere para blindar la privacidad cross-miembro (un nudge nunca debe exponer datos de otro miembro y solo va a quien optó). Documentado como siguiente incremento.

---

## 26. Revisión de privacidad / RLS / seguridad

- Todas las tablas del hogar: RLS habilitada, **0 grants a authenticated** (verificado), service-role-only, deny-by-default. El navegador nunca las toca; lee `briefing.household` construido server-side, que solo carga hogares donde el usuario es miembro **activo**.
- Privacidad cross-miembro **estructural**: los datos personales de un miembro no están en estas tablas, así que no hay forma de leerlos vía el hogar.
- Permisos chequeados en el store antes de cada escritura (no-miembro/viewer/external → rechazado). Invitación solo aceptable por el usuario objetivo resuelto.
- Auditoría append-only. Graceful degradation: pre-migración todo cae a vacío/false, Kipu personal intacto.

---

## 27. Auditabilidad / correcciones

`household_audit_log` (append-only): quién creó/editó/marcó-pagado/invitó/salió, con detalle no sensible. Gastos compartidos se cancelan (status='cancelled'), no se borran de forma destructiva. Los settlements quedan en historial.

---

## 28. Degradación elegante

Sin migración aplicada: `loadHouseholdData` → vacío; toda escritura → `{ok:false}` sin lanzar. `briefing.household` = fallback neutral (hasHousehold false). Dashboard no muestra la tarjeta. Chat personal sin cambios. **Producción idéntica** hasta aplicar 027.

---

## 29. Resultados de tests

Gate determinista **126/126** (11 aserciones de Stage 19, 115–125). Lint limpio, build verde. Security self-check: 0 grants a authenticated, auditoría append-only, aceptación de invitación restringida al usuario objetivo.

---

## 30. Resultados de calidad de conversación

Por comportamiento: el digest del hogar lleva las REGLAS DURAS (no culpar; no exponer datos personales; reembolso no es ingreso; contado una vez) y no expone JSON crudo (gate #122). El agente, vía prompt, mantiene tono neutral, no toma partido, pregunta UNA cosa si falta el reparto, distingue personal vs compartido, y explica por qué un reembolso no es ingreso.

---

## 31. Escenarios del pre-mortem (70) y resultados

Se razonaron los 70 escenarios. Resumen por categoría:
- **Hogar/membresía/invitaciones (1–10)**: crear (couple/roommates/trip), invitar/aceptar/rechazar/cancelar/salir/quitar; un no-miembro no accede (gate #124 + permisos del store). OK.
- **Permisos/privacidad (11–13, 39–41, 50, 58–59, 62)**: ver cuenta/transacción privada de otro → imposible (estructural); deny-by-default; nudge sin exponer datos ajenos (nudges diferidos). OK.
- **Gastos/divisiones (14–20, 53)**: equal/60-40/fixed/income-weighted/"mi invitación"/inválido→pregunta; multi-moneda normalizada a base. OK (gates #115–#117).
- **Reembolsos/liquidación (21–26, 42–44, 67)**: pagado/parcial/sobrepago/netting; reembolso no es ingreso; gasto no se cuenta dos veces. OK (gates #118–#121).
- **Metas compartidas (27–30)**: aportes desiguales; solo el aporte propio afecta el plan; meta personal sigue privada. OK.
- **Fijos/subs/viaje/familia/no-usuario (31–35, 52, 54)**: modelados; no-usuario en splits sin mensajes. OK (scaffold documentado).
- **Cuentas/visibilidad (36–38, 55)**: cuenta personal NO es compartida salvo marca; visibilidad minimal por defecto. OK (shared accounts diferido).
- **Edición/borrado/auditoría (44–45, 57)**: cancelar gasto (no destructivo), audit log. OK.
- **Seguridad (58–60)**: bypass de ruta / acceso RLS de cliente → deny-by-default; migración sin aplicar degrada con gracia. OK.
- **Conversación (61, 63, 70)**: nunca culpa; no expone internos; recomendación personal separada del plan compartido. OK (prompt).
- **Dashboard (64–65)**: sin data → no muestra tarjeta; con muchos gastos → resumen, no contabilidad. OK.
Los de mayor riesgo (no-doble-conteo, reembolso-no-ingreso, liquidación, gate de membresía) tienen cobertura automática.

---

## 32. Limitaciones conocidas

1. Multi-moneda: gastos guardan original+base; los motores trabajan en base (consistente con el resto de Kipu). Display por-gasto en su moneda original es básico.
2. El doble registro (gasto personal + gasto compartido) depende de que el agente registre ambos; el prompt lo instruye, pero es comportamiento del modelo (a monitorear).
3. Invitaciones con etiqueta abierta son accept-by-link/token (sin entrega de invitación por canal todavía).
4. Nudges del hogar, cuentas/deuda compartida de primera clase, visibilidad por-campo: diferidos.
5. Los permisos a nivel store están probados por código pero no por el gate (requieren DB); se validarían en el smoke de rollout.

---

## 33. Stage 19 — GO / NO-GO

**GO de código** (migración 027 sin aplicar). El núcleo de dinero es determinista y correcto (gate 126/126: sin doble conteo, reembolso-no-ingreso, liquidación, divisiones exactas), la privacidad/RLS es deny-by-default con permisos en el store, y el Kipu personal queda intacto. Pendiente para producción: aplicar 027 + smoke con usuarios desechables (incluyendo el camino de permisos store-level que el gate no cubre).

---

## 34. Plan de migración / despliegue

1. Aplicar `027_stage19_household.sql` (8 tablas + 2 columnas, aditivas, RLS deny-by-default, audit append-only) — la humana ejecuta.
2. Commit + push (rama).
3. Deploy Vercel + esperar READY.
4. Smoke con usuarios desechables: crear hogar; invitar/aceptar; no-miembro rechazado; gasto compartido (cada método, suma exacta); quién-debe-a-quién; reembolso (no ingreso, parcial, sobrepago); meta compartida (solo afecta aporte propio); permisos (viewer no escribe); privacidad (un miembro no ve lo personal de otro); degradación; dashboard.
5. Limpiar toda la data desechable; verificar DB en cero.
6. Reporte GO/NO-GO.
`vercel.json` cron sin cambios. Sin datos reales/de fundador.

---

## 35. Próximo paso exacto que requiere tu autorización

**Autoriza el rollout de Stage 19**: (1) aplicar la migración 027; (2) commit + push; (3) deploy + READY; (4) smoke con usuarios desechables (incluyendo permisos y privacidad cross-miembro); (5) limpiar; (6) reporte GO/NO-GO. Hasta tu visto bueno, el repo queda con cambios **sin commitear** y la migración **sin aplicar**; no se hizo commit, push, deploy ni migración, y **no se inició Stage 20**.
