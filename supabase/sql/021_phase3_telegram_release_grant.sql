-- Kipu — Stage 12 Phase 3.1: grant DELETE on telegram_processed_updates to the
-- service role.
--
-- WHY: the webhook's releaseReservation() deletes the update_id reservation when
-- the financial pipeline fails transiently BEFORE a known outcome, so Telegram's
-- retry is reprocessed (H1: a failed update is never silently consumed). Channel
-- handlers run as the service role. Migration 007 granted only SELECT, INSERT —
-- so the DELETE was being DENIED ("permission denied for table"), and the
-- release-on-failure (for BOTH media and text) was a silent no-op. This grant
-- makes the reservation actually releasable.
--
-- ADDITIVE ONLY (a single grant; weakens no RLS, drops no object). Apply manually
-- AFTER 020, BEFORE deploying Phase 3 code that relies on reservation release.

grant delete on public.telegram_processed_updates to service_role;
