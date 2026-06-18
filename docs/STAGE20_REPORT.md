# Stage 20 — Completar el Producto, Funciones Diferidas y Listo para Beta del Fundador/Familia (PASS 1)

**Fecha:** 2026-06-18 · **Estado:** PASS 1 **PRODUCTION-LIVE** (incluye micro-stage **A2: proveedor FX real gratis**) · gate **144/144** · lint limpio · build verde · **migraciones 028/029/030 aplicadas + verificadas** · commit `c980cde` · deploy `dpl_GF3VZTjk9VRcFExrnjiNRRxsxFYy` READY · **smoke 16/16 (A–P)** con usuarios desechables · prod limpia a cero. **No se inició PASS 2, monetización ni Stage 21.** (Ver la sección final — **Cierre de rollout PASS 1 (production-live)**.)

> Stage 20 es una fase de COMPLETADO de producto, ejecutada como una secuencia de micro-stages internas. Este reporte cubre el **PASS 1**: auditoría completa de lo diferido + implementación profunda de las 3 micro-stages de mayor valor para beta (C, A, G) + el resto clasificado y diferido con justificación.

---

## 1. Resumen ejecutivo

Stage 20 cierra el ciclo de producto antes de la beta con el fundador/familia. **No es monetización ni escala.** Hice una **auditoría completa** de todo lo diferido/scaffolded a lo largo de Stages 12–19 (27 ítems en 8 categorías), lo prioricé para beta, e implementé a fondo las tres micro-stages de mayor valor con gates completos: **(C) test de personalidad/filosofía de vida** (pedido explícito del fundador, diferido en S18), **(A) capa núcleo de FX/multimoneda** (crítico para LatAm), **(G) motor de snapshots/tendencias** (para tendencias honestas). El Kipu personal (Margen, ledger, metas, privacidad) queda intacto; "genio adentro, simple afuera" se respeta. **GO de código** para PASS 1 (migraciones sin aplicar).

---

## 2. Auditoría completa de lo diferido (Phase 0)

Dos sub-agentes Explore inventariaron docs (BUILD_PROGRESS + reportes S16–S19) y código/esquema. **27 ítems en 8 categorías:**
- **FX/multimoneda (3):** sin conversión FX automática (tasa siempre 1 al escribir; `currency-resolver` ya tiene la compuerta segura `fx_unavailable`), FX en baselines, display por-gasto en hogares.
- **Dashboard/tendencias (2):** sin snapshot diario de Margen, sin comparación histórica.
- **Test de personalidad / onboarding-UI (2):** test dedicado diferido (capacidad lista), UI de onboarding de metas/wealth diferida.
- **Captura/modalidad (4):** tagging real de modalidad (toca el ledger writer), `preferWindow`, rasgos de adherencia, lectura del log de prefs.
- **Hogar (5):** nudges del hogar, cuentas/deuda compartida de 1ª clase, visibilidad por-campo, entrega de invitaciones, trip/family como motores separados.
- **Snapshots (3):** higiene `raw_input`, re-correr matcher en resume, dos estados de cuenta simultáneos.
- **Inversiones (4):** sync eToro/broker en vivo, precios de mercado en vivo, retiro/impuestos profundo, sync de portafolio externo.
- **Otros/aceptados (4+):** estado de cuenta = 1 tarjeta, cron diario (Hobby), split summary/facts, reconciliación goal↔cuenta.

Hallazgo clave de código: `net_worth_snapshots`/`financial_context_snapshots` existen pero **nunca se escriben**; `exchange_rate_to_base` siempre = 1 al escribir; el onboarding **sí** persiste `coach_preferences` + `user_financial_preferences` (la auditoría inicial fue imprecisa al decir que no).

---

## 3. Plan de implementación priorizado

Implementar AHORA si: requerido para la beta, cierra un gap core, conecta stages en un producto completo, evita comportamiento engañoso, o lo necesita la familia para probar. Diferir si: monetización/escala, requiere servicios externos sin configurar, riesgo de privacidad/seguridad alto, o es polish no necesario.

Orden de PASS 1: **C (test)** → **A (FX core)** → **G (snapshots/tendencias)** → (E onboarding ya cubierto). PASS 2+: B (charts), D (modalidad), F (hogar diferido).

---

## 4. Micro-stages seleccionadas y por qué

- **C — Test de personalidad:** pedido explícito del fundador en S18; alimenta directamente la personalización S18; autocontenido y gate-testable; alto valor para beta.
- **A — FX/multimoneda:** Kipu es LatAm; usuarios con cuentas/gastos/metas/activos en varias monedas; la capa segura (nunca inventar) es base para todo.
- **G — Snapshots/tendencias:** sin esto no hay tendencias honestas; las tablas existían sin escribirse; habilita "¿qué cambió?" y el dashboard premium.

---

## 5. Micro-stages diferidas y por qué

- **B — Charts dashboard Whoop:** necesita una librería de charts + los snapshots (ahora disponibles); las tarjetas de texto/número + la línea de tendencia salen ahora, el charting completo es PASS 2.
- **D — Tagging de modalidad real:** sigue tocando el escritor canónico del ledger (sensible a dedupe); el clasificador forward-looking de S18 + el test cubren la necesidad para beta.
- **F — Hogar diferido:** nudges del hogar, entrega de invitaciones, visibilidad por-campo, cuentas/deuda compartida de 1ª clase — sensibles a privacidad, suficientemente modelados para beta.
- **Proveedor FX en vivo / eToro / retiro-impuestos:** requieren claves externas / alcance fuera de beta.

---

## 6. Hallazgos de la inspección de código

`currency-resolver.ts` ya rechaza inventar tasas (`fx_unavailable`); rates=1 al escribir. Snapshots definidos, nunca escritos. `input_channel` solo "web"/"chat" (modalidad telegram/voz/foto forward-looking). Onboarding persiste coach + financial prefs (no es bug). Dashboard = tarjetas texto/número, sin charts. Personalización S18 lista para recibir el resultado del test.

---

## 7. Gap analysis

- **Ya existe y se reusó:** `currency-resolver` (compuerta FX segura), setters de personalización S18, NetWorthResult/debtHealth.totalDebt, briefing additive-field pattern, tablas de snapshots (esquema).
- **Existía pero incompleto (completado):** snapshots nunca escritos → ahora se escriben; FX sin proveedor/caché → caché + abstracción.
- **Faltaba y se construyó:** test de personalidad (motor + mapeo + tools + tabla), FX core (convert/valuateMixed + caché + tools), motor de tendencias.
- **Útil pero diferido:** charts, modalidad real, hogar diferido, proveedor FX en vivo.

---

## 8. Resumen de implementación por micro-stage

**C:** `personality-test.ts` (10 preguntas situacionales, 8 dimensiones bipolares, scoring normalizado en centésimas, 6 arquetipos Kipu-native) + `personality-mapping.ts` (eje experiencia↔patrimonio → filosofía; riesgo/detalle/nudge/tono con umbrales) → aplica vía setters S18 como prefs EXPLÍCITAS; tabla 028; store graceful; 4 tools + oferta en el prompt.
**A:** `fx-rates.ts` (convert/findRate directo+inverso, **nunca inventa** → no_rate; valuateMixed agrega multimoneda honesto; ranking determinista; `FxProvider` abstracción) + tabla 029 (caché por-usuario) + store + 2 tools + regla en el prompt.
**G:** `trend.ts` (compara día-a-día, dead-band, semántica "mejora" — deuda-arriba no es mejora, **no_prior** honesto) + tabla 030 (1/usuario/día) + store + integración en `buildCoachingBriefing` (`briefing.trend` + escribe el snapshot de hoy).

---

## 9. Archivos cambiados

Nuevos: `src/lib/personality/{personality-test,personality-mapping,personality-store}.ts`, `src/lib/fx/{fx-rates,fx-store}.ts`, `src/lib/trends/{trend,snapshot-store}.ts`, `supabase/sql/028_stage20_personality_test.sql`, `029_stage20_fx_rates.sql`, `030_stage20_daily_snapshots.sql`, `docs/STAGE20_REPORT.md`.
Modificados: `src/lib/financial/coaching-signals.ts` (campo trend + carga/escritura snapshot + digest), `src/lib/ai/agent/kipu-agent.ts` (emptyBriefing trend + tool-list + prompts test/FX), `src/lib/ai/agent/kipu-agent-tools.ts` (6 schemas + ejecutores + switch), `src/app/dev/capture-test/page.tsx` (12 aserciones), `docs/BUILD_PROGRESS.md`.

---

## 10. Migraciones creadas (no aplicadas)

`028_stage20_personality_test.sql` (`user_personality_test`), `029_stage20_fx_rates.sql` (`fx_rates`), `030_stage20_daily_snapshots.sql` (`daily_financial_snapshots`). Las tres aditivas, RLS habilitada, **0 políticas de cliente (deny-by-default)**, grants solo a `service_role`. **NO aplicadas.**

---

## 11. Cambios en el modelo de datos

Solo aditivos (3 tablas nuevas). Ningún objeto existente alterado. Stores graceful (`select *`/try-catch) → **producción idéntica hasta aplicar**. El ledger personal nunca se toca.

---

## 12. FX / multimoneda

`convert(amount, from, to, rates)`: misma moneda → 1; tasa conocida (directa/inversa) → convierte; sin tasa → `no_rate` (honesto, base 0) — **nunca inventa**. `valuateMixed`: confía el base ya calculado, convierte lo convertible, EXCLUYE y reporta lo no convertible (sin cross-rate adivinado, sin doble conversión). Ranking determinista (manual>historical>provider>cached). `FxProvider` permite conectar un proveedor en vivo después sin cambiar la lógica. Tools: `set_exchange_rate` (guarda la tasa que dice el usuario), `convert_currency` (usa caché o pide). Reusa la compuerta de `currency-resolver` en captura.

---

## 13. Dashboard / analítica tipo Whoop

PASS 1 entrega la base honesta de tendencias: `briefing.trend` (Margen, gasto seguro, patrimonio, deuda, Pulso vs el último día). El charting visual completo (líneas/áreas) queda para PASS 2 (necesita librería de charts + los snapshots que ahora ya se escriben). Las tarjetas actuales (Margen/Pulso/metas) siguen simples.

---

## 14. Test de personalidad / filosofía de vida

10 preguntas situacionales (estilo de vida, no cuestionario financiero), 8 dimensiones bipolares (experiencias↔patrimonio, seguridad↔crecimiento, estructura↔flexibilidad, simple↔detalle, presente↔futuro, solo↔compartido, consistencia↔tandas, motivación), 6 arquetipos cálidos (Explorador/Constructor/Guardián/Ambicioso/Realizador/Equilibrista). El resultado mueve comportamiento real (filosofía→joy-floor, riesgo, detalle, recordatorios, tono) vía los setters S18, como prefs EXPLÍCITAS; un cambio explícito posterior gana. Opcional, divertido, honesto ("para adaptarme a ti", nunca diagnóstico), rehacer/olvidar.

---

## 15. Completar modalidad de captura

DIFERIDO con justificación: el tagging real de modalidad (voz/foto/estado/telegram) sigue tocando el escritor canónico del ledger (sensible a dedupe). El clasificador forward-looking de S18 + el test de personalidad cubren la necesidad de personalización para beta. Se completará cuando se pueda taggear la modalidad de forma aditiva sin riesgo al dedupe.

---

## 16. Completar onboarding adaptativo

En la inspección, el onboarding **ya** persiste `coach_preferences` + `user_financial_preferences` (no era bug). La pieza faltante —ofrecer el test tras onboarding— ahora está wired de forma agent-native (oferta en el prompt + las 4 tools). Una UI de onboarding dedicada para el test queda como polish (diferido).

---

## 17. Completar funciones diferidas del hogar

DIFERIDO (suficientemente modelado para beta): nudges del hogar (sensibles a privacidad cross-miembro), entrega de invitaciones, visibilidad por-campo, cuentas/deuda compartida de 1ª clase. El hogar ya cubre couples/roommates/trips/family-support con el modelo actual (S19 production-live).

---

## 18. Completar snapshots / tendencias

`daily_financial_snapshots` (1/usuario/día, upsert idempotente). El briefing compara las métricas EN VIVO con el último snapshot de un día PREVIO (`loadPriorSnapshot`) y escribe el de hoy. `trend.ts` produce dirección + delta% + "mejora" (deuda-arriba NO es mejora), con **no_prior** honesto y dead-band. Digest solo en cambio real, nunca recitado por defecto.

---

## 19. Polish de listo-para-beta del fundador/familia

Se entrega un checklist de beta (sección 34). Empty/loading/error states existentes se mantienen; el test/FX/tendencias respetan "simple afuera". El polish profundo de UI (charts, navegación) es PASS 2.

---

## 20. Funciones adicionales descubiertas y manejadas

`FxProvider` (abstracción para proveedor en vivo futuro), ranking determinista de tasas, "good-direction" semantics en tendencias (deuda invertida), oferta de test una sola vez. Todo no-gimmick y aterrizado en datos reales.

---

## 21. Integración AI / chat

6 tools nuevas (4 test + 2 FX), permission/honestidad-aware, sin exponer ids/JSON. Bloques de prompt: "TEST OPCIONAL" (oferta una vez, opt-in, nunca diagnóstico) y "MONEDAS / TIPO DE CAMBIO" (nunca inventar tasa; pedir/guardar). El agente lee `briefing.trend.digest` para "¿qué cambió?".

---

## 22. Integración dashboard

`briefing.trend` disponible para el dashboard; las tarjetas de tendencia/charts visuales son PASS 2. La integración de datos está lista.

---

## 23. Integración onboarding

El test se ofrece tras onboarding vía el prompt; las prefs de onboarding ya persisten y alimentan la personalización.

---

## 24. Integración personalización

El resultado del test aplica filosofía/riesgo/detalle/nudge/tono vía los setters S18 (explicit-overrides intacto). `explain_personalization` puede mencionar el arquetipo (vía el store).

---

## 25. Integración cashflow / Margen

El snapshot captura el Margen semanal en vivo; las tendencias lo comparan día-a-día. La verdad del Margen no cambia (es solo lectura/foto).

---

## 26. Integración metas / wealth

El snapshot captura patrimonio neto (`goalsIntel.netWorth.totalNetWorth`) y deuda total (`debtHealth.totalDebt`); las tendencias muestran su evolución honesta.

---

## 27. Integración hogar

Sin cambios en S19; el hogar sigue production-live. El test puede sugerir (dim solo↔compartido) sin forzar; no se tocó la verdad compartida.

---

## 28. Integración ambient / Telegram

El cron diario (ambient-loop) construye el briefing → ahora también escribe el snapshot diario para usuarios elegibles (vía buildCoachingBriefing). Sin nuevos nudges (los del hogar siguen diferidos).

---

## 29. Revisión privacidad / seguridad / RLS

Las 3 tablas nuevas: RLS habilitada, 0 políticas de cliente (deny-by-default), service-role-only. Resultado del test, tasas FX y snapshots son por-usuario, sin exposición cross-usuario. El test nunca infiere rasgos sensibles (solo de las respuestas del propio usuario), no expone etiquetas internas. Sin secretos. Degradación graceful pre-migración.

---

## 30. Revisión de correctitud del dinero

Ninguna micro-stage toca el ledger ni cambia la verdad del dinero: FX es advisory (el ledger sigue guardando original+base con la tasa confirmada vía currency-resolver); el test solo fija prefs de encuadre; las tendencias son lectura. **Nunca** inventa una tasa (gate), **nunca** fabrica un ayer/hoy (gate), sin doble conversión (gate).

---

## 31. Resultados de tests

Gate determinista **138/138** (12 aserciones de Stage 20, 126–137): test (explorer→experiences/light_touch, constructor→wealth/power_builder/detailed/power/direct, eje de riesgo, **gating de umbral sin sobre-personalizar**, confianza + test vacío seguro); FX (misma/conocida/inversa, **nunca inventa**, valuateMixed con exclusión honesta, ranking); tendencias (semántica de mejora, **no_prior honesto**, dead-band). Lint limpio, build verde.

---

## 32. Resultados de revisión adversaria

Auto-revisión por dimensión: privacidad (deny-by-default + sin inferencia sensible + sin etiquetas), money-safety (cero escritura al ledger, FX nunca inventa, tendencias solo lectura), no-fabricación (no_rate + no_prior), simple-afuera (test opt-in una vez, digest de tendencia no recitado, FX solo cuando aplica), explicit-overrides (test como prefs explícitas, cambio posterior gana). Sin hallazgos abiertos.

---

## 33. Limitaciones conocidas

1. FX sin proveedor en vivo (por diseño): usa tasas que el usuario confirma; sin triangulación de cross-rates (no se inventa una). 2. Charts visuales del dashboard: PASS 2 (la base de datos de tendencias ya está). 3. Tagging de modalidad real: diferido (riesgo al ledger writer). 4. Nudges del hogar / invitación-delivery / visibilidad por-campo: diferidos. 5. El test es agent-native (sin UI dedicada todavía).

---

## 34. Checklist de beta del fundador/familia

- [ ] Capturar gastos por chat/Telegram (texto/voz/foto/PDF) y ver el Margen actualizado.
- [ ] Preguntar "¿cuánto puedo gastar hoy/esta semana?" (Margen/safe-spend).
- [ ] Subir un estado de cuenta y revisar la importación.
- [ ] Crear una meta y una mini-meta; ver el presupuesto de gustos.
- [ ] Tomar el **test de personalidad** ("hagamos el test") → ver que Kipu se adapta; rehacer/olvidar.
- [ ] Decir una tasa ("el dólar está a 4000") y pedir una conversión multimoneda.
- [ ] Volver al día siguiente y preguntar "**¿qué cambió?**" (tendencias honestas).
- [ ] Crear un hogar/grupo, registrar un gasto compartido, "¿quién le debe a quién?", cerrar cuentas.
- [ ] Ajustar tono/detalle/recordatorios; pedir "explícame por qué te ves así"; resetear.
- [ ] Confirmar que nada expone datos privados de otra persona y que las respuestas siguen simples.

---

## 35. Stage 20 — GO / NO-GO (PASS 1)

**GO de código** para PASS 1 (migraciones 028/029/030 sin aplicar). Tres micro-stages profundas, gate 138/138, money-safe, privacy-safe, simple-afuera. Pendiente para producción: aplicar 028/029/030 + smoke con usuarios desechables (test→adaptación, FX nunca-inventa, snapshot→tendencia día-a-día). El resto de micro-stages (B/D/F) son PASS 2, no bloquean la beta.

---

## 36. Plan de migración / despliegue

1. Aplicar `028_stage20_personality_test.sql`, `029_stage20_fx_rates.sql`, `030_stage20_daily_snapshots.sql` (aditivas, RLS deny-by-default) — la humana ejecuta.
2. Commit + push (rama).
3. Deploy Vercel + esperar READY.
4. Smoke con usuarios desechables: test (responder → arquetipo + prefs aplicadas; rehacer; olvidar); FX (guardar tasa → convertir; par sin tasa → pide, no inventa); snapshot/tendencia (escribe hoy; con un snapshot previo sembrado, "qué cambió"); briefing no crashea; gating de umbral.
5. Limpiar toda la data desechable; verificar DB en cero.
6. Reporte GO/NO-GO.
`vercel.json` cron sin cambios. Sin datos reales/de fundador.

---

## 37. Próximo paso exacto que requiere tu autorización

**Autoriza el rollout de Stage 20 PASS 1**: (1) aplicar las migraciones 028/029/030; (2) commit + push; (3) deploy + READY; (4) smoke con usuarios desechables; (5) limpiar; (6) reporte GO/NO-GO. Hasta tu visto bueno, el repo queda **sin commitear** y las migraciones **sin aplicar**; no se hizo commit/push/deploy/migración, no se inició monetización ni Stage 21. Tras el rollout de PASS 1, el siguiente PASS de Stage 20 abordaría B (charts del dashboard) y F (hogar diferido) si decides continuar el completado antes de monetización.

---

# Addendum — Micro-stage A2: Integración de Proveedor FX Real Gratis (Frankfurter)

## 1. Opciones de proveedor revisadas
- **Frankfurter** (frankfurter.dev): gratis, **sin API key**, open-source, tasas de referencia del BCE (ECB), actuales + históricas (desde 1999), uso comercial permitido, caché explícitamente permitido, **sin cuotas** (rate-limit anti-abuso). Verificado vía docs + curl: endpoint `https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL` (200) e histórico `https://api.frankfurter.dev/v1/<fecha>?base=USD&symbols=BRL` (200). `/v1/currencies` lista 201 códigos, pero las TASAS del endpoint público son el set BCE (~31): USD, EUR, GBP, BRL, MXN, JPY, CHF, CNY, etc. — **COP/ARS/PEN/CLP/UYU NO** están (se omiten de `rates`).
- **ExchangeRate-API (open access):** descartada como primaria — su endpoint abierto y términos/atribución son menos claros que Frankfurter; no se añadió para evitar incertidumbre de términos. Se puede sumar como fallback en el futuro si su atribución se maneja.
- **Alternativa en el repo:** `currency-resolver.ts` (ya rechaza inventar) — reusado, no duplicado.

## 2. Proveedor elegido y por qué
**Frankfurter** como proveedor primario: gratis, sin key, sin costo, sin env vars, términos claros (comercial + caché OK), fuente institucional (BCE), histórico incluido. Cumple todas las reglas de "no usar si…".

## 3. Términos / costo / key
Gratis, **sin API key**, sin costo, uso comercial permitido, caché permitido, sin atribución obligatoria, sin cuotas. **No se hardcodean secretos; no requiere env vars.**

## 4. Detalles de implementación
- `src/lib/fx/fx-provider-frankfurter.ts`: `parseFrankfurter` (puro, gate-testable) + `makeFrankfurterProvider` (fetch inyectable para tests, timeout 4s con AbortController, maneja HTTP/timeout/parse → `null` nunca lanza, atajo misma-moneda, `getRate` latest + `getHistorical` por fecha con validación `YYYY-MM-DD`). `frankfurterProvider` por defecto (sin key/env).
- `src/lib/fx/fx-resolver.ts`: `resolveRate` cache-first (misma → conocida/manual+cache → proveedor en vivo → `no_rate`), inyectable.
- `convert_currency` reescrito para usar el resolver con el proveedor en vivo + caché.

## 5. Comportamiento de caché
Tabla global nueva `fx_rate_cache` (añadida a la migración 029, no aplicada): `(base, quote, rate, rate_date, source, provider, fetched_at)`, único `(base, quote, rate_date)`, upsert idempotente. Cada fila lleva la **fecha efectiva real** del proveedor (sin sentinel NULL). `loadLatestCachedRates` = la fila más reciente por par; `loadCachedRateForDate` = la fila de esa fecha. Códigos ISO sanitizados (solo A–Z×3) contra inyección en el filtro `.or()`. Cache-first evita llamadas repetidas.

## 6. Comportamiento histórico / latest
Conversión actual → `/v1/latest`; conversión histórica (fecha de transacción) → `/v1/<fecha>`. `cacheProviderRate` guarda con la `rate_date` real del proveedor. La verdad original de la transacción **no se muta** (esto es valuación advisory, no reescribe el ledger).

## 7. Comportamiento de la tool
`convert_currency`: resuelve manual → caché → Frankfurter en vivo → pedir. Si trae del proveedor, lo cachea. Etiqueta la tasa como **"de referencia (no la del banco; puede variar)"**, nunca garantizada, respuesta **corta** (no explica de más). `set_exchange_rate` sigue guardando la tasa del usuario, que **vence** a la del proveedor.

## 8. Fallback elegante
Proveedor deshabilitado (null) o que lanza (timeout/red/HTTP/parse) → `no_rate` honesto, base 0, sin crash → el agente pide la tasa. Par no soportado (COP) → ausente en `rates` → `null` → `no_rate` → manual. Pre-migración: el store es graceful (sin caché) → producción intacta.

## 9. Archivos cambiados
Nuevos: `src/lib/fx/fx-provider-frankfurter.ts`, `src/lib/fx/fx-resolver.ts`. Modificados: `src/lib/fx/fx-store.ts` (cache fns + sanitizer), `supabase/sql/029_stage20_fx_rates.sql` (+`fx_rate_cache`), `src/lib/ai/agent/kipu-agent-tools.ts` (`convert_currency` → resolver+proveedor+caché), `src/app/dev/capture-test/page.tsx` (6 aserciones A2), docs.

## 10. Cambios en la migración 029
Añadida (aditiva, no aplicada) la tabla global `fx_rate_cache` (RLS deny-by-default, service-role-only). `fx_rates` (manual del usuario) sin cambios. Ningún objeto existente alterado.

## 11. Tests / gates añadidos (6, todas offline con proveedor mock + parser puro)
138 parser (tasa real / par no cubierto → null / base distinta → null), 139 misma-moneda sin llamar al proveedor, 140 **cache-first + manual vence al proveedor**, 141 fetch en vivo + endpoint histórico, 142 **proveedor deshabilitado/lanza → no_rate sin crash**, 143 par no soportado → no_rate. (Cubren los 12 puntos pedidos: red mockeada deterministamente.)

## 12. Resultados gate/lint/build
Gate **144/144** (incluye las 138/138 previas + 6 de A2), lint limpio, build verde. Endpoint en vivo verificado por curl (200, shape correcto); el gate corre offline con mock (regla determinista).

## 13. Riesgos / limitaciones
1. Cobertura BCE: COP/ARS/PEN/CLP/UYU **no** las da Frankfurter → caen a tasa manual del usuario (honesto, documentado). 2. Tasa de referencia ≠ tasa de banco/transacción — la copia lo dice; no garantizada. 3. `convert_currency` ahora puede hacer 1 llamada de red (timeout 4s) por conversión sin tasa conocida; el caché la evita en repeticiones; falla a `no_rate`. 4. La integración FX por-superficie (transacciones/metas/activos/hogar usando el resolver) sigue como trabajo continuo; A2 entrega el núcleo + la tool + la caché. 5. ExchangeRate-API fallback diferido (términos).

## 14. GO/NO-GO actualizado para el rollout de Stage 20 PASS 1
**GO de código** (migraciones 028/029/030 sin aplicar; 029 ahora incluye `fx_rate_cache`). A2 es seguro (nunca inventa, sin key/secretos, sin tocar el ledger, fallback graceful, copia honesta) y gate-verificado. El rollout PASS 1 ahora aplica 028/029/030, despliega y hace smoke (incluyendo FX en vivo: una conversión de par BCE como USD→BRL debe traer y cachear una tasa de referencia; un par no-BCE como USD→COP debe pedir/usar manual). Sin commit/push/deploy/migración hasta tu aprobación.

---

# Cierre de rollout PASS 1 (PRODUCTION-LIVE · 2026-06-18)

> Ejecutado con autorización explícita. Sin datos reales/del fundador; solo usuarios desechables; todo limpiado. No se inició PASS 2, monetización ni Stage 21.

## R1. Preflight
Rama `main`, HEAD `29cd28b` (cierre S19). Solo cambios de Stage 20 PASS 1 presentes; 028/029/030 sin aplicar. Verificación independiente vía MCP: prod **completamente limpia** (0 tablas S20, 0 auth.users, 0 profiles, 0 transactions/accounts/goals/households) → sin datos reales, sin drift.

## R2. Migraciones aplicadas (en orden)
`028_stage20_personality_test.sql` → `029_stage20_fx_rates.sql` → `030_stage20_daily_snapshots.sql`. Las tres `{"success":true}`, sin error.

## R3. Verificación de migraciones (independiente, MCP)
**4 tablas presentes; RLS habilitado en las 4; 0 políticas de cliente (deny-by-default); 4 PKs; 3 FKs de usuario** (`user_personality_test`, `fx_rates`, `daily_financial_snapshots` → `auth.users` ON DELETE CASCADE; **`fx_rate_cache` es GLOBAL, sin FK de usuario — intencional**); **3 índices únicos** (`fx_rates (user_id,base,quote)`, `fx_rate_cache (base,quote,rate_date)`, `daily_financial_snapshots (user_id,snapshot_date)`); **service_role con SELECT/INSERT/UPDATE/DELETE en las 4; anon/authenticated totalmente denegados**; **0 filas**. `fx_rate_cache` con metadata `source`/`provider`/`rate_date` (provider vs manual distinguible); una sola foto por usuario/día garantizada por el único de 030.

## R4. Gate / lint / build
Gate **144/144**, lint limpio, build verde (revalidados localmente justo antes del commit).

## R5. Commit + push
Commit `c980cde16bc7e660af338bfa2c2b464efcbf96c4` — "Stage 20 PASS 1 — Product Completion: Personality, FX and Trends". Push `29cd28b..c980cde` a `main`, exit 0.

## R6. Deploy de producción
`dpl_GF3VZTjk9VRcFExrnjiNRRxsxFYy` **READY** (target production, región `iad1`, SHA `c980cde`, alias `https://fincoach-mvp-vercel.vercel.app`, build ~36s). `vercel.json` cron **sin cambios** (`/api/cron/ambient-loop`, `0 14 * * *`); sin cambios de env/config no relacionados.

## R7. Smoke de producción 16/16 (A–P) — usuarios desechables
A empty-state graceful · B test disponible (10 q, v2) · C submit→persist→reload→map (wealth→wealth/aggressive/detailed/direct, arquetipo *ambicioso*) · E experiencia-vs-wealth filosofías opuestas (*explorador*/experiences/conservative/gentle) · D retake = 1 fila + reset borra · F tasa manual persiste y convierte (10 USD→40000 COP) + valuación mixta excluye lo inconvertible (JPY) · **G Frankfurter EN VIVO USD→BRL tasa real actual 5.084 (2026-06-17), cacheada, cache-first al reusar** · H par no soportado USD→COP → `no_rate` honesto + **manual gana al proveedor** · **I histórico USD→BRL 2024-01-02 → tasa de referencia fechada 4.8888** · O proveedor que falla / HTTP 500 → `no_rate` sin romper · J snapshot idempotente (1 fila/día) · K tendencia sin previo honesta (digest vacío) · L tendencia con previo → deuda-sube NO es mejora, patrimonio-sube sí, digest correcto · M briefing construye con `briefing.trend` (sin regresión) · **N el agente responde personalidad + FX en español natural (usó `get_personality_test`)** · **P regresión core: el agente creó 1 cuenta + registró 1 gasto (writer del ledger intacto)**.

## R8. Limpieza + verificación a cero (independiente, MCP)
Borradas todas las filas de los usuarios desechables + las filas globales de `fx_rate_cache` del smoke + ambos auth.users (cascade). Reverificación: **0** en todas las tablas con `user_id` para esos ids, **0** `user_personality_test`/`fx_rates`/`daily_financial_snapshots`/`fx_rate_cache`, **0** auth.users desechables (por id y por email `%kipu-smoke.invalid`), **0** en `user_financial_preferences`/`coach_preferences` (estos dos negaban DELETE a service_role pero se limpiaron por el cascade del borrado del usuario), **0** transactions/accounts/chat_messages/profiles. Ruta temporal `src/app/dev/stage20-prod-smoke` **eliminada, nunca commiteada** (git status limpio).

## R9. Veredicto
**GO — Stage 20 PASS 1 en producción, verificado de punta a punta.** Stages 1–20 (PASS 1) production-live. Detenido aquí: sin PASS 2, sin monetización, sin Stage 21.
