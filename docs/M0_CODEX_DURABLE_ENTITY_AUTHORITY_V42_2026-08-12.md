# Bloque M0 — autoridad durable de entidad v42

Fecha: 2026-08-12  
Estado: **M0_ABIERTO — listo para un único re-audit/smoke disposable**  
Migraciones: **001–111 aplicadas; v42 no añade migración**  
Producción: **sigue en `e91df36` (v38)**  
Contrato: `m0-agent-eval-2026-08-12-durable-entity-authority-v42`

## Hallazgo de v41

Claude validó v41 con 21/21 adversariales. En el smoke exacto, el primer turno
por fin fue correcto:

> «¿Desde qué cuenta salió el pago del arriendo?»

El segundo plan también fue correcto y completo: `log_movement`, monto
1.010.786,70 ARS, `fixedExpenseId` de Arriendo y cuenta Supervielle. Sin
embargo, el executor pidió confirmar si correspondía a Arriendo o era un gasto
aparte.

La entidad se comprobaba sólo contra el mensaje actual («Desde mi cuenta
Supervielle»). La mención «acabo de pagar el arriendo» estaba ligada a la raíz
de la misma operación durable, pero esa ruta no consumía
`entityAuthorityMessages`. Era el espejo exacto del monto que cerraron v39/v41.

## Fix 1 — autoridad de entidad por operación durable

`resolvedEntityNeedsConfirmation` acepta ahora los mensajes user-authored de la
operación exacta. `guardResolvedEntityChoice` le pasa
`ctx.entityAuthorityMessages`, la misma colección que ya usa la barrera general
de selección de cuentas/tarjetas/metas.

Reglas:

- si el turno actual nombra la entidad elegida, está probada;
- si el turno actual no nombra ninguna entidad peer, una mención anterior de la
  misma operación puede probarla;
- si el turno actual nombra otro peer, esa corrección gana y la entidad vieja
  vuelve a estar no probada;
- sin mensajes de esa operación no hay herencia;
- una confirmación server-owned exacta conserva su semántica anterior.

No se consulta conversación global ni una ventana léxica arbitraria. El
snapshot de operaciones determina qué deliveries user-authored pertenecen a la
continuación.

## Fix 2 — paridad del vínculo de gasto fijo

`validateFixedExpenseMovementLink` consume también
`entityAuthorityMessages`. Para un movimiento ligado por `fixedExpenseId`, el
matcher ve:

1. mensajes user-authored de la operación;
2. mensaje actual;
3. el monto ya validado del argumento.

El turno actual tiene un guard adicional: si nombra otro gasto fijo y no el
target, se rehúsa explícitamente y obliga a replanificar. El monto sigue siendo
necesario para conservar las reglas históricas de mismatch/currency.

Se eliminó del batch la descripción de fila como evidencia del nombre. Esa
descripción la escribió el modelo y podía fabricar la prueba de la entidad. El
mensaje humano completo sigue entrando, y el monto validado se añade dentro del
validator.

## Cobertura

**IR289** prueba en funciones reales:

- raíz «pagué el arriendo» + continuación «desde Supervielle» ⇒ entidad y
  vínculo probados;
- la misma continuación sin autoridad de operación ⇒ no probado;
- raíz Arriendo + turno actual «en realidad era la luz» ⇒ Arriendo refutado;
- el rechazo del fixed linker identifica la corrección actual;
- wiring de `entityAuthorityMessages` en el guard y en el matcher.

Mutantes:

- **M0M418** descarta la autoridad durable del resolved-entity guard;
- **M0M419** vuelve a validar el fijo sólo con el último mensaje;
- **M0M420** ignora un peer distinto nombrado ahora en el guard general;
- **M0M421** ignora esa corrección en el fixed linker.

Resultados locales antes del sello:

| Gate | Resultado |
|---|---:|
| Capture | **768/768** |
| Mutaciones M0 | **421/421**, exit 0, cero anchor miss/residuo |
| `tsc` / `diff --check` | limpios |
| PostgreSQL | sin cambios; última batería **73/73 ×2** |
| lint / build con red | limpios · **36/36 páginas** |

Sello: `54b73ae62bbf53d574483571f4e569ce54ce3495d25acb6292a441d1af2bf837`
(486 archivos, protocolo canónico).

No ejecuté modelo, no escribí en PostgreSQL, no apliqué migración y no hice
commit/push/deploy. La cuenta del founder no se tocó.

## Auditoría solicitada a Claude — una muestra

1. Verificar sello y contrato v42 antes de levantar el servidor.
2. Auditar por fuente y adversariales:
   - raíz durable autoriza el mismo id en una continuación;
   - mensaje de otra operación no autoriza;
   - current turn con otro peer refuta el anterior;
   - dos nombres ambiguos no permiten elección silenciosa;
   - descripción model-authored nunca prueba entidad;
   - monto/currency y controles variable de v39/v41 siguen fail-closed.
3. Ejecutar batería determinista sobre el sello.
4. Gastar **una sola muestra disposable** con Arriendo estable + Luz variable:
   - «Hola, acabo de pagar el arriendo» ⇒ pregunta sólo cuenta;
   - «Desde mi cuenta Supervielle» ⇒ escribe inmediatamente 1.010.786,70 ARS,
     vincula Arriendo, completa la operación y no solicita monto/confirmación;
   - control «en realidad era la luz» no puede escribir Arriendo;
   - Luz variable pregunta monto y conserva la ruta variable;
   - ledger, cuenta, receipt y cleanup por identidad exactos.
5. Detenerse en el primer rojo y conservar plan/missing/challenge/receipt antes
   del cleanup. No repetir el mismo sello buscando verde.

## Estado productivo

Producción sigue en v38. La operación real `ad2c093e…` continúa con el payload
viejo. **No responder «sí»**. No cancelarla durante el smoke disposable; sólo
después de un v42 verde, deploy y verificación se decide su cancelación para que
el founder repita el chat desde cero.

## Veredicto de Codex

v42 corrige la asimetría exacta que bloqueó v41 y la extiende como invariante de
operación, no como caso de Arriendo. **M0 sigue abierto** hasta el smoke externo.
