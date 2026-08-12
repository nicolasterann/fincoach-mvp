# Certificación externa de M0 — vigésima ronda (runtime v19)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva. Sin tocar el árbol.**
**Migraciones aplicadas: 100–107.**

---

## 1. Veredicto

**M0 sigue ABIERTO.** Corrida única: **20/22**. `ME10b` pasó —tu fix funcionó—
pero aparecieron `ME9` y `ME10`, y **`ME10` es cascada de `ME9`**. No gasté las
cuatro muestras de estabilidad.

| Paso | Resultado |
|---|---|
| Capture | **745/745** |
| Mutaciones M0 (serial) | **314/314**, exit 0, sin `anchor hits=0` |
| `tsc` · lint · `git diff --check` | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.9s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-08-mutation-subject-v19` |
| **Modelo, corrida única** | **20/22** |

## 2. El fix de v19 es correcto — y encontré cinco fugas de la clase

Probé las diez formas que declaraste contra las expresiones vivas del árbol:
**las diez se comportan como dices**, con cero falsos positivos. `ME10b` publica
su propuesta natural, queda `wrote=false/needsInfo=true` y ya no termina en 500.

Pero la barrera se **estrechó**, y construí quince casos adversariales para ver
qué dejó de proteger. **Cinco escapan:**

| Frase con `wrote=false` | Antes | Ahora |
|---|---|---|
| «Perfecto, guardado.» | bloqueaba | **publica** |
| «Listo: registrado.» | bloqueaba | **publica** |
| «Listo, ya está guardado.» | bloqueaba | **publica** |
| «La devolución ya está registrada.» | bloqueaba | **publica** |
| «Listo, ya quedó.» | (ya se escapaba) | publica |

Dos causas distintas:

1. **El ancla del recibo autónomo.** `STANDALONE_MUTATION_RECEIPT` sólo reconoce
   el participio tras `^` o `[\n.!?]`. Un recibo después de coma o dos puntos
   —«Perfecto, guardado.», «Listo: registrado.»— queda fuera.
2. **`estar` + participio no está cubierto.** `ACTIVE` cubre el pretérito,
   `RESULTATIVE` sólo `quedó …`, `PERFECT` sólo `he/se ha/se han`. «ya está
   registrada» no entra en ninguno.

Y aquí está el punto difícil, que conviene decir antes de intentar otro parche:
**«el préstamo está registrado» y «la devolución ya está registrada» son la misma
construcción gramatical**; lo único que las distingue es a qué entidad se
refieren y si esa entidad tiene un recibo de este turno. Una regla léxica no
puede separarlas sin reintroducir el falso positivo que acabas de eliminar. Si
esta familia importa, el guard correcto probablemente no es gramatical sino de
evidencia — la misma dirección que ya usa `hasProvedHistoricalAction`.

Las mutaciones M0M306–M0M314 cubren las formas que enumeraste; estas cinco
quedan sin red.

## 3. Causa raíz de `ME9`: una escritura sin recibo reversible

**El agente se comportó bien y lo dijo con honestidad.** La propuesta pidió
confirmación (`wrote=false`, 5 filas). En la entrega de confirmación:

```
toolTrace:  [ undo_agent_operation → needs_info ]
wrote:      false
operación:  19912de3… awaiting_input v8   (la MISMA de la propuesta)
payloadHash: 5874583b… idéntico en las dos entregas
targetOperationId: 812d4936…c01c92 idéntico en las dos entregas
```

O sea: **el challenge server-owned se emparejó y se reclamó correctamente.** Lo
que rehusó fue el executor, con este texto durable:

> «Esa operación no puede deshacerse completa con recibos reversibles probados.
> No deshice una parte aislada.»

Y el estado lo confirma: **cero escrituras**, 5 filas intactas, tarjetas en 0,
cuenta en 1385,76. El todo-o-nada se sostuvo y la respuesta al usuario fue
verdadera. Esa parte del contrato funciona.

El origen está en PostgreSQL. `kipu_reverse_agent_operation` exige que **cada**
paso con `execution_effect = 'write'` tenga `status='verified'` y una referencia
de transacción; si falta una, levanta:

```
KIPU_NEEDS_INFO: target operation contains a write without a reversible transaction receipt
```

que el cliente traduce a `unsafe`. Así que la operación objetivo contenía al
menos un write **sin ref de transacción**.

### Un candidato concreto, y por qué esto oscila

`agentAffectedRefsFromResult` deriva las refs por nombre de clave del `data` del
tool. Las dos escrituras de esa operación devuelven refs… **salvo por un camino**
([kipu-agent-tools.ts:6911](src/lib/ai/agent/kipu-agent-tools.ts:6911)):

```ts
data: {
  transactionIds:
    appliedChatPayment.financialWriteReceipt?.transactionIds ?? [],
}
```

Si `financialWriteReceipt` no viene, el paso se registra como **write con cero
referencias de transacción** — exactamente la condición que la RPC llama
irreversible. Es un candidato, no un veredicto: no pude confirmarlo contra las
filas porque el harness ya había limpiado la persona.

Eso explica la inestabilidad: **`ME9` pasó en la corrida válida de v18 con el
mismo fixture.** Que la operación quede reversible o no depende de qué rama de
retorno tome el pago de tarjeta, y eso varía con la muestra. No es un fallo del
undo: es que a veces la operación nace sin el recibo que el undo exige.

### Recomendación de diagnosticabilidad

Hoy el rechazo es **correcto pero indiagnosticable**: dice que falta un recibo y
no dice cuál. Que la RPC nombre el `step_key` y la capacidad del paso sin recibo
convertiría la próxima ocurrencia en una causa localizable sin gastar otra
muestra — es la misma inversión que en v18 convirtió un `reply: ""` opaco en una
raíz identificable en minutos.

## 4. Cascada

**`ME10` es cascada pura.** Su aserción es `transactions.length === 9`, que sólo
se alcanza si el undo de `ME9` escribió las cuatro reversas. El estado quedó en 5
y su conducta propia fue correcta: no convirtió una charla normal en acción
financiera. **No lo trates como defecto independiente.**

## 5. Estado verificado

Árbol de 80 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy, sin migración nueva. **No gasté muestras de estabilidad.** Log en
`/tmp/v19a.log`.

**Residuo cero**, por identidad: 2 usuarios (`nicolas.terann@gmail.com`,
`navaspaulina@hotmail.com`), 0 `agent_operations`, 0 `agent_operation_steps`, 0
`receivables`, **0 transacciones huérfanas**, 10 accounts, 22 debt_accounts.

**Datos reales no atribuidos a QA:** las 39 transacciones son de los dos usuarios
reales; ninguna variación de la base de producción se imputa a esta auditoría.

## 6. Para cerrar

1. **`ME9`**: garantizar que todo paso `execution_effect='write'` persista su
   referencia de transacción. El camino de
   [:6911](src/lib/ai/agent/kipu-agent-tools.ts:6911) que degrada a `[]` es el
   primer sitio a mirar. Un write sin ref no debería poder registrarse como
   write.
2. **Diagnosticabilidad**: que el rechazo `unsafe` nombre el paso sin recibo.
3. **Las cinco fugas de `MUTATION_CLAIM`**, decidiendo primero si la familia
   `estar + participio` se resuelve por evidencia y no por gramática.
4. `ME10`: sin acción propia.
5. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 7. Dónde está M0

Dos rondas seguidas encontrando **defectos de producto reales**, no aserciones
mal escritas — y los dos en la misma frontera: la que separa «lo hice» de «no
pude». `ME10b` era una respuesta verdadera que la barrera no dejaba publicar;
`ME9` es una operación que no se puede deshacer porque uno de sus writes no dejó
recibo. En ambos casos el agente hizo lo correcto y fue honesto con el usuario;
lo que falla es la contabilidad interna de lo que quedó probado.

Vale la pena verlo así porque cambia la prioridad: el riesgo residual de M0 ya no
está en si el agente entiende o miente, sino en si **cada escritura deja el rastro
que sus propias garantías exigen después**. Es una superficie acotada —los
retornos de los writers— y verificable sin gastar muestras del modelo.
