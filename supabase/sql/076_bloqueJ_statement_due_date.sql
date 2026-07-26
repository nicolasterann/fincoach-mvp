-- Migration 076 — Bloque J-4: la fecha de pago de ESTE estado no es la regla mensual.
--
-- El problema: `debt_accounts.due_day` es una REGLA que se repite todos los meses
-- ("mi Diners vence los 22"). No existía dónde guardar "este mes vence el 23".
-- Así que cuando el usuario decía «tengo que pagar 100 hasta el 23 de julio»
-- pasaba una de dos, y las dos estaban mal: o se reescribía la regla —la tarjeta
-- pasaba a vencer los 23 PARA SIEMPRE por el resumen de un mes— o la fecha se
-- ignoraba en silencio y Kipu avisaba un día tarde.
--
-- Un banco corre la fecha de un ciclo por un feriado o un fin de semana sin
-- cambiar nada: eso es un HECHO DEL CICLO, no una regla nueva. Esta columna lo
-- guarda aparte. La regla mensual solo cambia cuando el usuario lo dice
-- explícitamente. Aditiva y nullable: sin dato, todo se comporta como hoy.

begin;

alter table public.debt_accounts
  add column if not exists statement_due_date date;

comment on column public.debt_accounts.statement_due_date is
  'Fecha de pago concreta del estado VIGENTE (J-4). Un ciclo corrido por feriado no cambia due_day, que es la regla mensual. NULL = sin dato para este ciclo, se usa due_day.';

commit;
