# Sonda de CARRERA — cambio de moneda vs captura concurrente (dos conexiones)

**Por qué existe:** la re-auditoría 3 de J-1 encontró que el validador monetario
(`kipu__validate_cash_movement_currency`, migraciones 066/067) leía las monedas
con un `SELECT` **sin lock**. Secuencia peligrosa, con dos conexiones:

1. **T1** `kipu_change_account_currency` toma `FOR UPDATE` sobre la cuenta (USD→ARS).
2. **T2** inserta un gasto USD. Su `BEFORE INSERT` lee la cuenta *sin lock* ⇒ ve la
   versión vieja (USD) y **valida OK**.
3. **T2** llega al chequeo de FK (`transactions.source_account_id → accounts`), que
   **sí** toma `FOR KEY SHARE`, y ahí recién espera al `FOR UPDATE` de T1.
4. **T1** commitea (la cuenta ya es ARS).
5. **T2** continúa y **aterriza un gasto USD sobre una cuenta ARS**.

La migración **069** cierra esto: el validador toma `for key share` sobre cada fila
que lee (cuentas en orden determinista, tarjeta, meta y perfil) **antes** de
validar. `FOR KEY SHARE` choca con `FOR UPDATE`, así que T2 espera en el paso 2 y,
al despertar, READ COMMITTED re-lee la fila actualizada (EvalPlanQual): ve ARS y
rechaza. Se eligió `FOR KEY SHARE` y no `FOR SHARE` porque es la misma fuerza que
ya toma el FK y **no** choca con el `FOR NO KEY UPDATE` de los updates de balance —
si chocara, dos capturas concurrentes sobre la misma cuenta podrían deadlockearse.

**Estado de ejecución:** esta sonda **no se ejecutó** desde la sesión de Claude: el
entorno no tiene cadena de conexión directa a Postgres (`DATABASE_URL`), ni `psql`,
ni cliente `pg`, y `dblink` no está instalado (ni hay password de la base). Lo que
sí se verificó allí: la función **desplegada** en producción contiene los locks
(`pg_get_functiondef` ⇒ 4 `for key share` en el validador de efectivo, 3 en el de
deuda, `order by 1` presente), y la mutación **RM-49** (quitar el `for key share`)
rompe el test nombrado IR40. Ejecutá esto para cerrar la prueba empírica.

## Cómo correrla

Necesitás la cadena de conexión directa del proyecto (Supabase → Project Settings →
Database → Connection string, modo **session**, no el pooler en modo transaction:
las transacciones largas y los locks entre sesiones necesitan sesión dedicada).

Abrí **dos** terminales, cada una con `psql "$DATABASE_URL"`.

### Preparación (sesión A, se revierte al final)

```sql
-- Sesión A
BEGIN;
-- Usá tu propio user_id de prueba
\set uid 'e8b79a2f-7795-417d-bac2-3c79a95f1ee3'
INSERT INTO accounts (user_id, name, type, currency, current_balance_original, current_balance_base)
VALUES (:'uid', 'RACE probe', 'bank', 'USD', 0, 0) RETURNING id AS acc;
-- anotá el id devuelto; abajo va como :'acc'
COMMIT;  -- la cuenta debe existir COMMITEADA para que la otra sesión la vea
```

### La carrera

```sql
-- Sesión A (T1): toma el lock y NO commitea todavía
BEGIN;
SELECT kipu_change_account_currency(jsonb_build_object(
  'user_id', :'uid', 'account_id', :'acc',
  'expected_currency','USD','expected_balance_original',0,'expected_balance_base',0,
  'new_currency','ARS','new_original',0,'new_base',0,'reinterpret',false));
-- dejar ABIERTA
```

```sql
-- Sesión B (T2): intenta el gasto USD mientras A tiene el lock
BEGIN;
SELECT kipu_apply_ledger_entry(jsonb_build_object(
  'user_id', :'uid','type','expense','effect_type','expense','sign',1,
  'description','RACE gasto USD','category','other',
  'original_amount',10,'original_currency','USD','exchange_rate_to_base',1,
  'base_amount',10,'base_currency','USD','source_account_id', :'acc',
  'confidence_score',1,'raw_input','race','input_channel','web',
  'occurred_at', now(), 'dedupe_key','race:1'));
-- DEBE QUEDARSE ESPERANDO (bloqueada por el FOR UPDATE de A)
```

```sql
-- Sesión A: confirmá el cambio
COMMIT;
```

### Resultado esperado (post-069)

La sesión B **despierta y falla** con:

```
KIPU_FX_REQUIRED: expense in USD cannot hit account <id> in ARS
```

Es decir: re-leyó la fila actualizada y rechazó. **Antes de la 069** la sesión B
habría insertado el gasto USD sobre la cuenta ya ARS.

### Limpieza

```sql
-- Sesión B
ROLLBACK;
-- Sesión A (nueva transacción)
BEGIN;
DELETE FROM transactions WHERE dedupe_key = 'race:1';
DELETE FROM accounts WHERE name = 'RACE probe';
COMMIT;
```

### Variante recomendada (el gemelo de la base)

Repetir con `kipu_change_base_currency` en la sesión A (usuario sin datos) y un
movimiento en la sesión B: el validador toma `for key share` sobre `profiles`, así
que aplica el mismo razonamiento.
