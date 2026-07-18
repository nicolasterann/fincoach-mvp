-- Kipu — Bloque I (re-auditoría 2, punto 2): la intención durable del ejecutor de
-- cambios programados gana FIDELIDAD. Aditiva; 056 queda como está.
--
-- POR QUÉ: pending_prev guardaba el valor NORMALIZADO (NULL→0) y perdía dos hechos
-- que el CAS necesita: si la columna era NULL de verdad y si la fila de prefs ni
-- siquiera existía. La recuperación reconstruía `.eq(col, 0)` contra un NULL que
-- jamás matchea (cambio atascado para siempre) o un UPDATE contra una fila
-- inexistente (ídem). También se perdía el patch acompañante (p.ej. `cadence` de
-- una contribución), así que el write recuperado no era el planeado.
--
--   pending_prev_kind — 'value' | 'null' | 'row_missing': el estado previo REAL.
--                       El CAS lo ejecuta: .eq(col, pending_prev) / .is(col, null)
--                       / INSERT que pierde ante una fila concurrente (23505).
--   pending_extra     — el patch acompañante del write (jsonb), para que recovery
--                       re-aplique EXACTAMENTE lo planeado.
alter table public.scheduled_changes
  add column if not exists pending_prev_kind text
    check (pending_prev_kind is null or pending_prev_kind in ('value', 'null', 'row_missing')),
  add column if not exists pending_extra jsonb;
