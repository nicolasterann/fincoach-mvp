-- Kipu — Bloque I (re-auditoría): el ejecutor de cambios programados se vuelve
-- crash-safe. Aditiva; 033/039 quedan como están.
--
-- POR QUÉ: el ejecutor adelantaba/cerraba el plan (claim) ANTES de tocar el
-- destino. Una caída entre el claim y la escritura perdía un cambio `once` para
-- siempre (fila 'applied', destino intacto); una respuesta perdida del claim
-- dejaba la fila adelantada mientras el código la contaba como 'skipped'; y el
-- revert compensatorio podía fallar dejando solo un log.
--
-- EL PROTOCOLO NUEVO (la lógica vive en scheduled-changes-store.ts):
--   1. CLAIM  — lease (claimed_at/claim_run) SIN adelantar el plan.
--   2. INTENT — se calcula el valor ABSOLUTO nuevo y se persiste (pending_value,
--               junto al valor leído pending_prev). adjust_percent se computa UNA
--               vez: el reintento re-escribe el absoluto, nunca re-compone el %.
--   3. WRITE  — el destino se escribe con CAS contra pending_prev.
--   4. FINAL  — recién ahí se adelanta/cierra el plan y se limpia el lease.
-- RECOVERY: un lease vencido con pending_value dice exactamente dónde quedó el
-- vuelo: destino == pending_value → la escritura aterrizó → finalizar; destino ==
-- pending_prev → nunca aterrizó → re-escribir; otra cosa → conflicto (el usuario
-- editó en el medio) → soltar el lease y recalcular en el próximo run.
alter table public.scheduled_changes
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_run date,
  add column if not exists pending_value numeric,
  add column if not exists pending_prev numeric;
