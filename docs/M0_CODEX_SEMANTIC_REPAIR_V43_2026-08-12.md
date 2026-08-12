# Bloque M0 — reparación semántica del planner v43

Fecha: 2026-08-12  
Estado: **M0_ABIERTO — listo para un único re-audit completo**  
Migraciones: **001–111 aplicadas; v43 no añade migración**  
Producción: **sigue en `e91df36` (v38)**  
Contrato: `m0-agent-eval-2026-08-12-semantic-repair-v43`

## Qué quedó certificado antes de v43

Claude auditó v42 sin editar el árbol. La autoridad durable de entidad pasó
13/13 adversariales y el transcript exacto que falló al founder pasó 6/6:

- «acabo de pagar el arriendo» preguntó únicamente la cuenta;
- «desde mi cuenta Supervielle» registró 1.010.786,70 ARS, ligado al fijo,
  sin preguntar monto ni pedir una tercera confirmación;
- una corrección actual hacia Luz refutó Arriendo;
- Luz variable siguió preguntando su importe;
- una sola transacción y cleanup exacto.

v42 está cerrado como clase. No se reabrió ni se cambió esa superficie.

## Hallazgo independiente del gate completo

La muestra completa v42 cayó en ME4 y bloqueó los seis checks dependientes. Los
tres intentos tipados fueron:

1. una action `income` sin `income_recognition/increase`;
2. otra action mutante sin ningún effect;
3. un `log_movement` dentro de un grupo que no llevaba una reversión completa.

El mensaje mezcla una continuación válida —tres pagos de tarjeta ya planificados
que reciben su cuenta— con procedencia ya asentada y una entrada cuya dirección
económica aún es ambigua. El planner trató cada veto como una invitación a
parchear y conservar la action, y terminó usando `atomic_group` como identidad
del trabajo conversacional. No fue una regresión de v42, pero sí un defecto
central de inteligencia operacional: una pata incierta congeló las probadas.

## Fix 1 — ontología explícita, sin router

El system prompt establece invariantes generales:

- `atomic_group` significa sólo dependencia transaccional de base; no significa
  operación durable, conversación, turno ni «aparecieron en el mismo mensaje»;
- compartir cuenta, fecha o procedencia no crea dependencia;
- continuar una operación `awaiting_input` conserva sus acciones pendientes y
  no la convierte en corrección histórica;
- `undo + replacements` existe sólo para corregir explícitamente una operación
  `completed`;
- explicar de dónde salió dinero o mencionar un hecho ya asentado no ordena
  volver a registrarlo;
- una nueva pata sin identidad económica completa no recibe action/effects:
  deja missing `$response` y no elimina las actions independientes probadas.

No hay regex, clasificador de frases ni rama para sueldo, préstamo, tarjeta o el
texto de ME4. El modelo sigue decidiendo el significado y las tools.

## Fix 2 — bounded repair deja de enseñar el antipatrón

`plannerContractRepairInstruction` consume cada razón exacta del validador y
declara que el veto no prueba que la action deba existir. Le exige al modelo:

1. volver a comprobar si el usuario pidió realmente esa escritura;
2. no fabricar effects, entidad, dependencia, grupo o undo para satisfacer el
   schema;
3. preservar todas las actions independientes válidas;
4. retirar sólo la action no probada y representar la decisión exacta como
   missing `$response`.

Los errores de action sin effects, contrato económico incompleto y
`log_movement` agrupado repiten esa salida segura con el id/grupo concreto. El
último prohíbe expresamente inventar un undo y distingue movimiento nuevo de
replacement.

La causa exacta viaja tanto en `validation_error` como en `instruction`. Dos
mutantes históricos que sólo apagaban uno de esos canales se reforzaron para
probar ambos por separado; dejaron de ser verdes vacuos.

## Cobertura

**IR290** ejecuta el bounded repair real con las tres firmas observadas y
comprueba:

- la razón exacta llega al segundo intento;
- el veto no obliga a conservar la action;
- las acciones independientes deben preservarse;
- la incertidumbre queda en `$response`;
- operación durable y grupo atómico no se confunden;
- no se inventa `undo_agent_operation`;
- prompt, validator y repair comparten el contrato.

Mutantes:

- **M0M422** vuelve al repair genérico que trata la action como obligatoria;
- **M0M423** enseña otra vez que turno/operación y atomic group son lo mismo;
- **M0M424** invita a agregar undo ante un movimiento agrupado inválido.

Resultados locales:

| Gate | Resultado |
|---|---:|
| Capture | **769/769** |
| Mutaciones M0 | **424/424**, exit 0, cero anchor miss/residuo |
| `tsc` / lint / `git diff --check` | limpios |
| Build con red | **Compiled successfully**, 36/36 páginas |
| PostgreSQL | sin cambios; última batería **73/73 ×2** |
| Migraciones | sin cambios; **001–111 aplicadas** |

Sello ejecutable v43:  
`e9b4ad3f5d562e8a2f705d1063c9d938906438bd8f338e1ed2f9cea88b670fe9`
(486 archivos, comando canónico del protocolo congelado).

No se ejecutó modelo, no se escribió en PostgreSQL, no se aplicó migración y no
se hizo commit, push ni deploy. La cuenta del founder y su operación pendiente
no se tocaron. Producción sigue en v38.

## Auditoría solicitada a Claude

1. Sellar el árbol y verificar handshake v43 antes de levantar el servidor.
2. Auditar por fuente que:
   - no existe inspección de lenguaje en el fix;
   - el modelo conserva autoridad semántica y catálogo completo;
   - validator/repair no eliminan ni fabrican acciones por código;
   - un veto de action no permite inventar effects o undo;
   - una continuación normal no adquiere coreografía de correction;
   - una corrección completed válida de ME10aa sigue compilando igual.
3. Correr batería determinista en serie. PostgreSQL puede tomarse como sin
   cambios, pero si se corre debe permanecer 73/73 ×2.
4. Gastar **una sola muestra completa de 22 checks** sobre servidor limpio y
   contrato v43. No repetir el mismo sello buscando verde.
5. En ME4 conservar antes del cleanup: los tres candidatos/reasons de intake,
   plan final, continuation id, actions, missing fields, groups y writes.
6. Criterio ME4: los tres pagos probados aterrizan; sueldo ya asentado no se
   duplica; la entrada 83,86 no recibe economía inventada y queda como una sola
   pregunta; ME5 puede inspeccionarla sin consumir la operación.
7. Si 22/22: autorizar commit/deploy. Si rojo: detenerse y reportar una causa
   tipada, sin segunda muestra.

La operación real `ad2c093e…` permanece `awaiting_input` en producción v38. No
responder «sí» ni cancelarla hasta que un árbol nuevo esté auditado y desplegado.
