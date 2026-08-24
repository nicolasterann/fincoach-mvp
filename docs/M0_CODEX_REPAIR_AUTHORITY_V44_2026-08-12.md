> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 v44 — autoridad semántica durante la reparación

## Por qué v43 no era desplegable

El audit externo de v43 encontró dos rojos independientes en el modelo real:

- ME12c entendió correctamente un préstamo saliente de 25 USD, pero ante un
  payload incompleto abandonó una escritura inequívoca y fabricó un
  `missing_field` sobre `$response` diciendo que la capability la había
  rechazado;
- ME4 agotó sus tres intentos intentando fabricar o reconciliar ese mismo tipo
  de pendiente artificial.

La causa estaba en el propio contrato v43. El nuevo repair decía que un veto no
obligaba a conservar una action, mientras tres razones antiguas del validador
recomendaban expresamente eliminarla y convertirla en `$response`. El modelo
recibía dos autoridades incompatibles y escogía la salida de rendición.

## Contrato v44

v44 separa el origen del fallo sin mirar el lenguaje del usuario ni enumerar
casos financieros:

1. `action_payload`: argumentos, schema o álgebra económica internos. Si la
   intención y los hechos están probados, el modelo conserva y repara la action;
   nunca presenta el defecto interno como dato que el usuario pueda aportar.
2. `transaction_wiring`: sólo puede reparar `atomic_group` y `depends_on`; no
   cambia significado financiero, no elimina una action probada y no inventa un
   undo.
3. `clarification_lifecycle`: sólo reconcilia `missing_fields`,
   `pending_question` y `response_intent`, sin alterar actions, argumentos o
   effects.
4. `general`: reevalúa únicamente la dimensión nombrada por la razón exacta.

La clasificación consume exclusivamente la razón tipada del servidor. No lee
el mensaje, nombres de tools concretas, comercios, cuentas ni palabras del
transcript.

## Barrera transicional

`plannerRepairTransitionError` impide que un rechazo `action_payload` invente
un nuevo pendiente `$response`. No elimina actions ni decide intención por
código. Una ambigüedad real que ya estaba declarada en el candidato rechazado
sí puede convertirse en pregunta: el modelo conserva su autoridad semántica
sobre lo que la evidencia del usuario no prueba.

La salida `$response` también queda ligada estructuralmente: su `key` debe ser
exactamente el `field` de una `plan.ambiguities[]` con razón concreta, y no
puede mezclarse con ids de actions. Esto distingue una incertidumbre del mundo
real de un error interno autodeclarado.

Se retiraron de tres razones del validador las instrucciones antiguas que
promovían eliminar la action, inventar missing state o agregar undo. La razón
tipada vuelve a describir el defecto; la política de reparación vive en una
sola capa.

## Cobertura

**IR291** prueba:

- las cuatro scopes con las razones literales de ME4/ME12c;
- que payload probado exige reparar y wiring sólo cambia wiring;
- que un payload rechazado no puede fabricar una pregunta nueva;
- que una ambigüedad de usuario ya declarada sí conserva ese camino;
- que `$response` necesita field+reason coincidentes y exclusivos;
- que prompt, envelope de reparación y consumo comparten el mismo contrato.

Mutantes v44: **M0M425–430**, además de reanclar **M0M422/M0M424** a las
fronteras vivas. El contrato de runtime es
`m0-agent-eval-2026-08-12-repair-authority-v44`.

Resultados locales finales:

| Gate | Resultado |
|---|---:|
| Capture | **770/770** |
| Mutaciones M0 | **430/430**, exit 0, cero anchor miss y restauración byte a byte |
| `tsc` / lint / `git diff --check` | limpios |
| Build con red | **Compiled successfully**, 36/36 páginas |
| PostgreSQL | sin cambios; última evidencia **73/73 ×2** |
| Migraciones | sin cambios; **001–111 aplicadas** |

Sello v44: `131ce62746d4035c8137b1e387067a7291135852302d3828681fb9bdda94df0a`
(486 archivos, comando canónico del protocolo congelado).

## Secuencia de auditoría

1. Sellar el árbol; cero ediciones durante la ronda.
2. `git diff --check`, `tsc`, lint, capture y mutaciones seriales.
3. PostgreSQL no cambió; su última evidencia sigue en 73/73 ×2. Si se repite,
   debe seguir verde y con residuo cero.
4. Build limpio y handshake v44 contra servidor recién levantado.
5. Una sola muestra completa. No repetir el mismo sello buscando verde.
6. Conservar antes del cleanup los candidatos/reasons de ME4 y ME12c.

Criterio falsable: ME12c debe conservar y reparar el préstamo inequívoco; ME4
debe preservar los pagos probados y preguntar sólo por la ambigüedad económica
ya presente en la evidencia. Un error interno no puede convertirse en algo que
el usuario deba confirmar.

Sin commit, push, deploy ni migración. Producción sigue en v38. La operación
real `ad2c093e…` sigue fuera de alcance y no debe responderse con «sí».
