> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Smoke de transcripts reales sobre persona disposable — M0 v23

**Fecha:** 2026-08-09 · **Auditor:** Claude (sesión externa)
**Autorizado por el founder:** persona disposable + réplica estructural mínima.
**La cuenta real del founder NO se tocó.** Sin commit, sin deploy, sin migración.
**Árbol devuelto byte-idéntico** (huella `git status` antes = después).

---

## 1. Veredicto

**Todo verde.** Las cuatro conductas que pediste quedan verificadas sobre datos
propios de una persona desechable con la forma de tu configuración.

| Check | Resultado |
|---|---|
| S0 · la réplica deja el corte de Diners ligado a su hecho antes de conversar | **ok** |
| S1 · un corte ya conocido se responde con su monto y no se vuelve a preguntar | **ok** |
| S2 · instrucción sin cuenta de origen: cero escrituras, operación abierta | **ok** |
| S3 · «¿qué te falta?» nombra la cuenta concreta y conserva la operación original | **ok** |
| S4 · los dos pagos aterrizan como `debt_payment`, bajan caja y deuda, no son gasto | **ok** |
| S5 · devolución de capital **no registrada**: caja ↑ sin ingreso ni receivable | **ok** |
| S6 · devolución **registrada**: caja +25, receivable 60→35, fila ligada a su marcador | **ok** |
| S7 · ninguna operación queda `applying`; toda `awaiting_input` conserva su pregunta | **ok** |
| S8 · cleanup por identidad: cero filas de la persona en 14 tablas | **ok** |

Frases nuevas, no las del fixture: «¿de la Diners cuánto me toca pagar y para
cuándo?», «ya cancelé la Diners entera y también la Titanium completa», «¿y qué te
falta para dejarlo listo?», «los dos salieron de mi Produbanco», «me devolvió Ana
de una plata que yo le había prestado y que nunca anoté», «Juan me pasó 25 de los
60 que me debía».

## 2. Un rojo que era mío, no del producto

En la primera pasada `S6` salió rojo porque **yo** afirmé que la fila del ledger
no podía ser `type: "income"`. Fui a leer el contrato real antes de reportarlo, y
el producto tiene razón: `ME10b` —la garantía equivalente de la suite— espera
exactamente una fila `income` cuyo `external_ref` empiece por
`receivable_repayment:` y que esté ligada al marcador durable. «Sin reconocer
ingreso» describe el **tratamiento económico**, no el enum del ledger, que no
tiene un valor `receivable_repayment`.

Reejecuté sólo ese caso con la aserción del contrato real:

```
caja 1000 → 1025 · receivable 60 → 35 (partial)
1 fila income con external_ref receivable_repayment:… · id == marker.transaction_id
marker.reversed_at = null · cero filas income sin ese external_ref
S6 enfocado: 2/2
```

Lo dejo escrito porque es la regla que vengo aplicando toda la auditoría y me
tocaba a mí: **un rojo no es un defecto hasta que se comprueba contra el contrato,
venga de quien venga.**

## 3. Lo que demuestra cada conducta

**Diners no se vuelve a preguntar.** La ocurrencia `card_statement` nace ligada a
su hecho, y al preguntar por la tarjeta el agente responde 50,60 con su
vencimiento **sin pedir el corte otra vez y sin escribir nada**. Es el incidente
que abrió el bloque, cerrado sobre una réplica de tu configuración.

**Ejecución parcial segura.** «Cancelé la Diners entera y también la Titanium»
—sin decir de dónde— **no escribió media operación**: cero transacciones,
operación `awaiting_input` con su aclaración durable. Al aclarar la cuenta,
ambos pagos aterrizaron como `debt_payment`, la cuenta bajó exactamente 251,85 y
las dos tarjetas quedaron en 0, **sin una sola fila de gasto**.

**«Qué falta» responde el dato concreto.** Nombró la cuenta de origen, no escribió,
y —lo que importa— **la operación original siguió abierta con su pregunta intacta**:
el turno de consulta no la consumió ni la reemplazó.

**Las dos devoluciones conservan su dirección.** La no registrada subió caja 45
sin reconocer ingreso y **sin inventar un receivable**; la registrada subió caja
25 y bajó el préstamo de Juan de 60 a 35, con su marcador durable. Ninguna se
convirtió en deuda propia del usuario.

## 4. Estado del entorno

**Residuo cero**, verificado por identidad en 14 tablas dentro del propio smoke y
confirmado después contra la base: 2 usuarios
(`nicolas.terann@gmail.com`, `navaspaulina@hotmail.com`), 0 `agent_operations`,
0 `agent_operation_steps`, 0 `agent_intake_failures`, 0 `receivables`, 0
marcadores de repago, **0 transacciones huérfanas**, 10 accounts, 22
debt_accounts, 39 transacciones.

**Tu cuenta no fue tocada.** Un detalle para que no lo leas como movimiento: el
total base de cuentas figura hoy en 16 298,42 frente a 16 035,34 de ayer, pero el
**nativo no cambió** y ninguna fila de `accounts` se escribió después del
2026-08-08 00:29. La diferencia es la revaluación FX de tus dos cuentas en ARS
(3 372 404,05 ARS), no una escritura.

**Árbol congelado.** Los dos scripts del smoke fueron archivos temporales
(`scripts/qa/.m0-*.tmp.mjs`) y quedaron borrados; la huella de `git status` es
idéntica antes y después, y `git diff --check` está limpio. El servidor quedó
detenido.

## 5. Qué falta para cerrar M0

Sólo una cosa, y no puede ser mía: **la ronda independiente sobre el árbol
congelado por un auditor que no lo haya tocado.** Yo lo toqué —el juez de voz,
TG-6c, M0M158, cinco correcciones del harness de PostgreSQL, la limpieza de una
persona disposable tras mi propio timeout— así que esa firma me está vedada por
la misma regla que vengo aplicando.

Todo lo demás está entregado:

- migraciones **100–108** aplicadas y verificadas por catálogo;
- PostgreSQL **65/65 ×2**;
- capture **750/750**, mutaciones **342/342** con baseline verde;
- build con red limpio;
- modelo **22/22 ×2** sobre árbol y servidor congelados;
- smoke de transcripts reales **verde** sobre persona disposable;
- residuo cero en cada corrida y ningún dato real atribuido a QA.
