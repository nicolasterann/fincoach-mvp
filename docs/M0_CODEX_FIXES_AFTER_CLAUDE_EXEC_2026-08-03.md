# Informe para auditoría externa — correcciones de Codex después de la ejecución de Claude

**Fecha:** 2026-08-03  
**Stage:** Bloque M0 — inteligencia operacional general del agente  
**Estado:** implementación local terminada; **M0 sigue ABIERTO** hasta ejecutar la frontera PostgreSQL/modelo indicada al final  
**Migraciones instaladas en producción al comenzar esta pasada:** 100, 101 y 102  
**Migraciones nuevas:** 103 y 104, **PREPARADAS, NO APLICADAS**  
**Commit/deploy:** ninguno

## 1. Punto de partida y hallazgo de Claude aceptado

La auditoría ejecutable de Claude probó que la 102 cerró correctamente la
restauración no determinista del hecho bancario: el E2E PostgreSQL quedó 59/59
dos veces. El siguiente rojo no estaba en PostgreSQL sino en la barrera de
publicación.

Una respuesta natural como:

> De la Diners NT te toca pagar 50.60$ y vence hoy, 3 de agosto.

tenía voz válida y evidencia real, pero `replyMoneyIsGrounded` la rechazaba. El
guard exigía que **una sola ventana alrededor del monto** incluyera todos los
roles expresados por la respuesta. El contexto representa normalmente importe y
vencimiento en campos/líneas diferentes, así que combinar “cuánto” y “cuándo”
era imposible aunque ambos hechos fueran verdaderos.

No relajé la identidad monetaria. La corrección conserva la regla fuerte: un
monto sólo prueba la entidad a la que está ligado. Lo que cambia es dónde se
busca el rol: dentro del conjunto de evidencia de **esa misma entidad**, nunca
en una tarjeta/cuenta vecina.

## 2. Correcciones implementadas

### F1 — grounding monetario por entidad y rol, sin exigir una sola ventana

Archivo principal: `src/lib/ai/agent/kipu-agent.ts`.

- `replyMoneyGroundingFailures` mantiene el monto anclado a la ventana exacta
  del hecho.
- Los nombres de entidad se extraen únicamente de campos estructurados
  (`cardName`, `accountName`, `name`, etc.) o, como fallback conservador, de
  nombres propios presentes en la evidencia.
- Los roles (`saldo`, `deuda`, `reserva`, `meta`) se buscan en el scope completo
  de esa misma entidad. El rol de Visa no puede autorizar el monto de Diners.
- Se añadió un diagnóstico tipado (`amount_absent` vs
  `entity_or_role_unbound`) para que un rechazo no vuelva a ser un loop opaco.
- Los recibos estructurados con `amount: 50.6` también son evidencia monetaria;
  antes sólo se reconocían números con sufijo de moneda.

Casos fijados: importe+fecha verdadero; entidad equivocada con monto verdadero;
rol prestado por otra entidad; saldo de cuenta usado como deuda; y monto
histórico verificado.

### F2 — asociación correcta de múltiples montos en una respuesta natural

Antes, una frase como “Diners 50.60, Produbanco 22.14 y Titanium 201.25” podía
asociar cada número a todas las entidades de la oración. La segmentación ahora
usa separadores, posición de los números y fronteras de cláusula para que cada
monto conserve su entidad local. Intercambiar 50.60 y 22.14 falla aunque ambos
números existan de verdad en la evidencia.

### F3 — grounding de calendario independiente y ligado a entidad+rol

`replyCalendarIsGrounded` valida por separado corte, vencimiento y fecha
genérica:

- un `completedDate` de una operación ya no prueba el vencimiento de una
  tarjeta;
- el día de Diners no autoriza el mismo día para Visa;
- una fecha real pero con rol equivocado no publica;
- una fecha inventada no se salva porque el monto sea verdadero.

### F4 — “hoy/mañana/ayer” usa la fecha local tipada del usuario

La autoauditoría encontró un hueco adicional: “vence hoy” no contiene un día
numérico y escapaba del guard. Añadí `localDateEvidence(timezone, now)` y una
marca de evidencia interna `KIPU_CURRENT_DATE`.

- La fecha se deriva con la zona IANA del perfil; no con UTC ni con la zona del
  servidor.
- Se recalcula en cada intento de publicación, no antes del planner: un turno
  que cruza medianoche no conserva el día anterior.
- “vence hoy/mañana/ayer” se resuelve a fecha concreta y debe coincidir con el
  mismo rol y entidad.
- Si no hay zona/fecha local probada, la afirmación relativa se rehúsa.
- Una marca genérica de timestamp no puede hacerse pasar por `due` o `cutoff`.

La prueba fija el mismo instante en Buenos Aires y Tokio para demostrar que el
día cambia por zona. Las mutaciones M206–M208 apagan respectivamente la
exigencia de fecha, su consumo productivo y la zona del usuario.

### F5 — evidencia histórica sólo desde recibos durables verificados

El E2E de modelo avanzó después de ME6 y ME7 pidió explicar una operación ya
completada. El modelo llamó correctamente `list_recent_agent_operations`, pero
el finalizador sólo permitía que un write del turno actual autorizara
“registré/pagué”.

Se añadió `verifiedCompletedOperationActionEvidence`:

- sólo consume resultados de `list_recent_agent_operations`;
- sólo admite pasos `verified` cuyo `execution_effect` sea `write` o `noop`;
- conserva argumentos, resultado y refs tipadas del paso;
- chat, plan, pasos fallidos y afirmaciones del modelo no son autoridad;
- esta evidencia entra en `actionEvidence`, por lo que puede explicar trabajo
  histórico sin repetirlo.

El planner está instruido a leer ese archivo durable cuando el usuario pregunta
qué se hizo anteriormente. La mutación M190 promueve un paso fallido, M191
calcula pero no consume los recibos, M192 vuelve a exigir write actual y M194
elimina la lectura del planner; las cuatro mueren.

### F6 — reparación acotada del planner, no fallback bot ni router lexical

`agent-planner.ts` ahora realiza hasta tres muestras sólo cuando la salida viola
el contrato determinista. Cada reparación recibe el motivo exacto y la salida
nueva se revalida completa; una muestra inválida nunca se ejecuta por estar en
un “repair pass”.

Los mensajes de error económico nombran la pata concreta que falta. Esto evita
que una ambigüedad termine en “me falta un dato” y permite preguntar una sola
cosa útil. La selección de capabilities sigue ocurriendo después del plan del
modelo; no se añadió un router por frase.

### F7 — ontología explícita de préstamos y devoluciones

Se eliminó la dependencia de patrones como “me transfirieron” vs “me
devolvieron”. El plan debe declarar actor/propiedad y dirección de cada pata:

- dinero que el usuario pidió prestado: caja ↑ + obligación propia ↑;
- devolución de un préstamo a favor registrado: caja ↑ + receivable ↓;
- préstamo saliente: caja ↓ + receivable ↑;
- retorno de capital nunca registrado: caja ↑ con procedencia durable
  `capital_return_unrecorded`, sin ingreso y sin fabricar deuda/receivable.

Si no se puede determinar quién debía a quién, se pregunta. Para el retorno no
registrado ya no se exige inventar un nombre de contraparte económicamente
irrelevante.

### F8 — autoridad de entidad durable a través de toda la conversación

Hallazgo de autoauditoría: la autorización de entidad usaba el mensaje raíz y el
actual, pero olvidaba una cuenta/persona introducida en una aclaración
intermedia. En recuperación de worker era peor: no llegaba ninguna autoridad de
la continuación.

`agent-operation-store.ts` ahora lee, pagina y agrupa **todas** las filas de
`agent_operation_deliveries` de cada operación abierta. Cada
`DurableAgentOperation` expone `authorityMessages`, formado exclusivamente por
mensajes del usuario ligados durablemente a esa operación. Prosa del asistente
y del planner quedan excluidas.

`runKipuAgent` entrega esos mensajes tanto a una continuación normal como a un
plan recuperado. La normalización de nombres convierte puntuación en espacio:
“Salió desde Produbanco; el resto…” conserva la mención y no vuelve a preguntar
por la cuenta.

La lectura es complete-or-declared-partial. Si pasos o deliveries quedan
truncados/ilegibles, todo el catálogo de operaciones se rechaza antes de
planificar; nunca se interpreta el fragmento como historia completa.

### F9 — migración 103: cast legacy seguro por CASE

Archivo: `supabase/sql/103_m0_safe_legacy_fact_amount.sql`.

La 102 protegía un cast numérico con una regex en otro predicado `AND`.
PostgreSQL no promete orden de evaluación: podía ejecutar el cast antes y un
payload histórico malformado abortaba toda reapertura.

La 103 deriva el cuerpo vivo y sustituye exactamente un anchor:

- JSON number → cast dentro de su rama;
- JSON string numérico → regex y cast dentro de su rama;
- cualquier otra forma → `NULL`, nunca excepción.

La migración aborta si el anchor no aparece exactamente una vez, es idempotente
por marker, conserva owner `postgres` y deja el helper de trigger sin EXECUTE
para roles externos, incluido `service_role`.

### F10 — migración 104: READY conserva y exige su pregunta exacta

Archivo: `supabase/sql/104_m0_ready_plan_keeps_pending_question.sql`.

Un plan puede tener writes independientes y un dato faltante que sólo bloquea
otro paso o la respuesta. Ese plan es READY, pero la 100 guardaba
`pending_question` únicamente si todo el plan era `awaiting_input`. Si el worker
moría después de los writes, la recuperación encontraba `missing_fields` con
pregunta NULL y se rechazaba a sí misma.

La 104 hace dos cambios inseparables:

1. persiste `pending_question = v_question` para READY y AWAITING;
2. PostgreSQL rehúsa **cualquier** `missing_fields` sin pregunta, aunque existan
   acciones independientes y el status calculado sea READY.

Tiene markers separados para assignment y guard, detecta estado parcial,
exige un anchor exacto de cada uno y preserva owner/ACL service-role-only.

El E2E pasa de 59 a 62 checks:

- READY conserva la pregunta literal;
- un caller service-role no puede guardar missing sin pregunta;
- todas las aclaraciones del usuario reaparecen como autoridad de entidad.

### F11 — dos huecos de los propios gates encontrados y corregidos

1. IR143 usaba `tgE2E` antes de su declaración (`ReferenceError`/TDZ). Ahora lee
   el archivo localmente en el test; capture vuelve a poder arrancar.
2. M205 sobrevivió porque TG-1e sólo fijaba el nombre del check E2E. Ahora fija
   la condición viva: `ok:false` más el motivo determinista de la 104.

No cuento ninguno como defecto financiero, pero ambos invalidaban un veredicto
verde si se dejaban.

## 3. Verificación local realizada

| Batería | Resultado |
|---|---:|
| Capture gate | **731/731** |
| Mutaciones M0 | **208/208**, exit 0, residuo cero |
| Loop onboarding | **22/22** |
| Wizard onboarding | **161/161** |
| J-2 / J-3 / J-4 | **17/17 · 21/21 · 18/18** |
| Mutaciones Pre-M | **28/28**, residuo cero |
| Mutaciones K | **280/280**, residuo cero |
| Mutaciones L refund | **24/24**, residuo cero |
| `tsc --noEmit` | limpio |
| lint | limpio |
| `git diff --check` | limpio |
| sintaxis E2E DB/modelo/runner | limpia |

`npm run build` llegó al compilador y falló únicamente al descargar Geist y
Geist Mono desde Google Fonts por la red del sandbox. No lo presento como build
verde: Claude debe certificarlo con red.

No pude ejecutar el E2E de modelo desde este entorno: el sandbox impide abrir el
servidor local (`listen EPERM`) y la elevación para exponerlo fue rechazada. No
intenté una ruta indirecta que cambiara el poder de la prueba. Tampoco apliqué
103/104 ni escribí contra producción.

## 4. Instrucciones exactas para Claude

### A. Auditar y aplicar 103, luego 104

1. Confirmar pre-state contra los cuerpos vivos de 102/100:
   - marker 103 ausente y su anchor exactamente una vez;
   - ambos markers 104 ausentes y ambos anchors exactamente una vez.
2. Aplicar **103 → 104**, sin editar 100–102.
3. Verificar por catálogo/cuerpo vivo:
   - CASE de 103 presente y cast fuera de ramas ausente;
   - dos markers de 104 presentes;
   - `pending_question = v_question` vivo;
   - guard por `jsonb_array_length(v_missing) > 0` vivo;
   - funciones `SECURITY DEFINER`, owner postgres, `search_path` conservado;
   - 0 EXECUTE para anon/authenticated; helper de trigger 103 tampoco para
     service_role; writer 104 sólo service_role.
4. Reaplicar ambas en una transacción revertida y probar no-op idempotente.

### B. Sondas PostgreSQL que no se pueden reemplazar por lectura

1. Ejecutar `telegram-agent-100-e2e.mjs` **dos veces**: debe dar **62/62**, exit
   0, cero `ABORT`, `COBERTURA INCOMPLETA`, `LIMPIEZA ILEGIBLE`, `RESIDUO` o
   `FALL`.
2. Crear dentro de una transacción revertida un fact legacy con `payload.amount`
   malformado que alcance el fallback de reapertura. Debe ignorarse sin
   `invalid input syntax for numeric`; sólo un monto válido y exacto puede ser
   restaurado.
3. Inspeccionar M100.8/M100.8b/M100.8ab: la pregunta exacta y los mensajes raíz,
   intermedio y actual deben sobrevivir una recuperación real.

### C. E2E de modelo real — criterio duro

Con `KIPU_AGENT_MODE=on` y `M0_EVAL_SECRET`, correr
`m0-model-conversation-e2e.mjs` hasta obtener **22/22 cinco veces** sobre el
mismo árbol congelado, con residuo cero cada vez.

No ajustar asserts para acomodar una salida observada. Guardar transcript y
diagnóstico de cualquier rojo. Mirar especialmente:

- ME2: Diners conocida, monto+fecha y voz neutral;
- ME3–ME6: pregunta concreta, ejecución parcial segura y continuación;
- ME7: explicación histórica desde recibo, sin repetir el write;
- ME8: redelivery exacta;
- ME9/ME10aa: undo/corrección de operación completa;
- ME10b/10c y ME11–ME13: las cuatro direcciones de préstamos/devoluciones;
- paráfrasis nuevas, preguntas legítimas y no-acción.

Además agregar o ejecutar un sample que responda “vence hoy/mañana” alrededor de
un límite UTC y compruebe que la zona del usuario gobierna.

### D. Ronda congelada y release

1. Certificar `npm run build` con red.
2. Repetir capture 731/731, mutaciones M0 208/208 y regresiones listadas.
3. Auditar first-principles el árbol **sin modificarlo**. Si aparece un P1/P2,
   M0 sigue abierto y se repite la ronda después del fix.
4. Sólo con DB 62/62×2 + modelo 22/22×5 + build + ronda congelada limpia:
   commit, deploy, verificar SHA/runtime y repetir smoke post-deploy.

## 5. Veredicto de Codex

No conozco otro defecto local reproducible después de esta pasada, y todas las
defensas añadidas mueren con una mutación nombrada. Sin embargo, **M0 todavía no
está cerrado**: la historia de este proyecto demuestra que las RPC y la elección
real del modelo encuentran fallos invisibles a lectura y gates estáticos.

El árbol queda listo para esa auditoría ejecutable. El veredicto correcto hoy es:

> **Implementación local completa; listo para aplicar 103/104 y ejecutar la
> batería de cierre. No commitear, desplegar ni activar M hasta que esas pruebas
> sean verdes.**
