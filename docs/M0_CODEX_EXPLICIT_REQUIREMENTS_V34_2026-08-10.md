# Bloque M0 — contrato explícito de requisitos v34

Fecha: 2026-08-10  
Estado: **M0_ABIERTO — listo para una auditoría completa de Claude**  
Migraciones: **001–111 aplicadas; sin migración nueva; próxima 112**  
Contrato de runtime: `m0-agent-eval-2026-08-10-explicit-requirements-v34`

Sello canónico de la superficie ejecutable:
`3720105b69fdb5e021ab6d55a17c19e45ce8aaf3d972134c06c1b094324a6f68`
(486 archivos). Claude debe obtener exactamente ambos valores antes de gastar
la muestra completa.

## Resultado ejecutivo

Acepté el P1 del audit v33. El problema no era que el modelo no entendiera la
pregunta de Diners: el servidor le mostraba `value:object`, ocultaba las claves
del protocolo y luego rechazaba todo salvo `value.date`,
`value.amount+value.currency` o `value.name`. Los reintentos devolvían
`planner returned an invalid response requirement`, por lo que el modelo tenía
que adivinar otra vez. ME2 agotó tres intentos sobre un contrato que el prompt
nunca especificó.

La v34 corrige esa clase sin añadir una ruta, capability, frase o caso Diners:

- el planner sigue decidiendo libremente qué hechos mínimos exige la petición;
- el protocolo de transporte ahora es explícito, discriminado y exacto;
- un rechazo nombra el path concreto y el bounded repair lo consume;
- un requisito sólo es fundamentado si su valor y su entidad están ligados en
  la misma ventana de evidencia;
- un slot no fundamentado ya no silencia los demás hechos: se vuelve
  incertidumbre tipada dentro de la oración escrita por el modelo;
- el fallback jamás reutiliza el valor no verificado propuesto por el planner y
  vuelve a cruzar todas las barreras con el contrato original.

No se cambió ningún writer, RPC ni migración.

## 1. P1 — wire contract oculto al planner

### Antes

El prompt decía únicamente:

```text
"value": object
```

El validador aceptaba aliases no documentados (`value`, `total`) en algunos
lugares pero exigía en otros una forma canónica. Una fecha podía ser rechazada
como `non-canonical date` sin indicar que faltaba `value.date`. El repair sí
recibía `validation_error`, pero ese mensaje no contenía una reparación
accionable.

### Ahora

El prompt y el validador comparten un contrato discriminado:

```text
money  → value={"amount": number, "currency": "USD"}
date   → value={"date": "YYYY-MM-DD"}
entity → value={"name": "exact evidence-backed display name"}
```

Además:

- `id` debe cumplir `^[A-Za-z][A-Za-z0-9_-]{0,79}$` y ser único;
- `source` debe nombrar el origen de evidencia verificada;
- no se admiten aliases ni claves extra;
- money requiere number finito no negativo y moneda ISO mayúscula;
- date requiere una fecha real, no sólo una cadena con forma ISO
  (`2026-02-30` se rehúsa);
- entity exige `entity_ref` y el display name exacto probado.

Cada error lleva índice y path. Ejemplos ejecutados:

```text
plan.response_requirements[0].value must contain exactly {date} for kind date
plan.response_requirements[0].value.date must be an exact valid YYYY-MM-DD date
plan.response_requirements[0].value.amount must be a finite non-negative number
plan.response_requirements[0].source must name the verified evidence origin
```

`validatedPlannerSampleWithRepair` ya reenviaba el motivo al siguiente sample;
IR280 ahora demuestra que el segundo intento recibe esa ruta exacta y converge.

## 2. Observación adicional — fallback todo-o-nada

Claude señaló correctamente que un contrato con dos requisitos podía contener
uno fundamentado y otro no fundamentado. El verificador no exigía el segundo,
pero el renderer retornaba `null` al encontrarlo; por lo tanto tampoco podía
publicar el primero. Después de una escritura, eso podía terminar en dinero
movido sin respuesta en esa entrega.

La v34 hace dos correcciones inseparables:

1. **Binding antes de renderizar.** Money exige amount+currency+entity en la
   misma ventana de evidencia. Date genera un probe por rol (due/cutoff/date) y
   atraviesa el mismo `replyCalendarIsGrounded` que la publicación normal. La
   coexistencia de “Diners” con un 201,25 real de Titanium ya no fundamenta
   Diners=201,25; lo mismo para sus fechas.
2. **Incertidumbre tipada, nunca valor del planner.** Un slot no fundamentado se
   sustituye por `un monto/una fecha/una entidad que no pude verificar`. La
   oración completa sigue siendo el `response_template` del modelo. Los slots
   fundamentados conservan sus valores canónicos; no queda `[[placeholder]]` y
   una cifra no probada como 777,77 no puede cruzar al texto.

El resultado renderizado vuelve a `finalizeAgentReply` con el arreglo original
de requisitos. Los no fundamentados no se exigen; todos los fundamentados sí.
`fallbackResult?.ok` sigue siendo la única salida de publicación. No hay waiver
con `[]` ni advisory que lave una omisión. También retiré del tipo
`AgentVoiceAdvisory` el código huérfano `response_requirements_omitted`; la
omisión sigue siendo un `AgentReplyPublicationFailure`, no estilo.

## 3. Por qué esto preserva inteligencia general

No existe ninguna condición por pregunta, frase, tarjeta o tool. El LLM mantiene
las tres decisiones semánticas:

1. qué quiere el usuario;
2. qué hechos mínimos necesita la respuesta;
3. cómo redactar la respuesta y su template de emergencia.

El servidor sólo define un protocolo pequeño para valores que puede verificar
objetivamente. Es análogo a publicar el schema de una tool: no reduce la
inteligencia del modelo; evita desperdiciarla adivinando claves privadas. Roles
como `amount_due`, `earliest_due` o una combinación futura siguen siendo
vocabulario libre. Estados y explicaciones cualitativas siguen bajo semántica
del modelo, porque el servidor no pretende probarlos con regex.

## 4. Cobertura endurecida

### IR279

- conserva cobertura/omisión/paráfrasis y binding del reply;
- añade amount real de Titanium atribuido falsamente a Diners ⇒ ungrounded;
- añade due date real de Titanium atribuida falsamente a Diners ⇒ ungrounded.

### IR280

- forma exacta para money/date/entity;
- aliases, string amounts, moneda minúscula y fecha imposible rechazados;
- id y source rechazados por su path exacto;
- repair de dos muestras recibe el path exacto y converge;
- fallback mixto publica 50,60 verificado, expresa incertidumbre para 777,77
  no probado, nunca muestra 777 ni un placeholder;
- el fallback mixto completo atraviesa `finalizeAgentReply` con
  `outcome.wrote=true`, probando la garantía post-write.

### Mutaciones

La batería pasó de 387 a **398**. M0M388–M0M398 matan:

- ocultar del prompt la forma exacta de date;
- volver a aceptar el alias no documentado;
- degradar el error a genérico;
- dejar de entregar `lastReason` al repair;
- publicar el valor no verificado del planner;
- desligar monto y entidad en evidencia;
- ocultar la gramática de ids;
- aceptar id inválido, source ausente, moneda minúscula o fecha imposible.

M0M385–387 se repuntaron a la implementación nueva: entidad desconocida,
ref/nombre divergentes y regresión del renderer a todo-o-nada.

## 5. Verificación realizada por Codex

| Gate | Resultado |
|---|---:|
| Capture | **761/761**, exit 0 |
| Mutaciones M0 | **398/398**, exit 0, restauración limpia |
| PostgreSQL real | **73/73 ×2**, exit 0, cleanup limpio |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `git diff --check` | exit 0 |
| `npm run build` con red | compiló, **36/36** páginas |
| Modelo enfocado ME1–ME3 | **3/3**, exit 0 |

El primer intento PostgreSQL corrió dentro del sandbox, falló DNS antes de
crear la persona y reportó 0/0; las dos corridas con red habilitada terminaron
73/73. No fue una muestra de producto ni dejó residuo. El servidor de la prueba
enfocada confirmó `explicit-requirements-v34` y quedó detenido al terminar.

No ejecuté la muestra completa de 22 checks. La reservo para Claude y el
stopping rule continúa: una sola muestra sobre este sello; ante el primer rojo,
detenerse con el diagnóstico tipado y no repetir hasta cambiar el árbol.

## 6. Archivos funcionales de esta pasada

- `src/lib/ai/agent/agent-operation-store.ts`
- `src/lib/ai/agent/agent-planner.ts`
- `src/lib/ai/agent/kipu-agent.ts`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `src/app/dev/capture-test/page.tsx`
- `scripts/qa/telegram-agent-regression-audit.mjs`

Documentación actualizada: `AGENTS.md`, `CLAUDE.md`, `docs/ROADMAP.md`,
`docs/AI_NATIVE_ARCHITECTURE.md`, `scripts/qa/README.md` y este relevo.

## 7. Instrucciones exactas para Claude

No edites código, prompt, fixtures ni aserciones durante la primera pasada.

1. Verifica sello `3720105b…a6f68`, 486 archivos y diff limpio.
2. Audita en fuente:
   - que prompt y validator declaren las tres formas exactas;
   - que cada rechazo diga el path y `validation_error` consuma `lastReason`;
   - que no haya aliases silenciosos;
   - que money/date prueben valor+entidad en la misma evidencia;
   - que un slot no fundamentado use incertidumbre tipada y nunca el valor del
     planner;
   - que el fallback conserve el contrato completo, cruce el finalizador y sólo
     publique con `fallbackResult.ok`;
   - que no reaparezca `response_requirements_omitted` como voice advisory;
   - que el planner siga recibiendo el catálogo completo y no exista router por
     frases.
3. Ejecuta serialmente: diff check, tsc, lint, capture **761/761**, mutaciones
   **398/398**, PostgreSQL **73/73 ×2** y build con red.
4. Borra `.next`, levanta servidor nuevo con `KIPU_AGENT_MODE=on` y confirma el
   handshake `m0-agent-eval-2026-08-10-explicit-requirements-v34`.
5. Ejecuta **una sola muestra completa 22/22**. No reintentes un rojo sobre el
   mismo sello.
6. Verifica cleanup por identidad, Diners sólo lectura y el mismo hash final.
7. Si todo queda verde, autoriza commit/deploy; no los ejecutes sin permiso del
   founder.

## Veredicto de Codex

El P1 del audit v33 y la observación del fallback mixto están corregidos y
refutados por ejecución. La batería local está verde y ME1–ME3 pasa con el
modelo real. **M0 todavía no se declara cerrado:** falta la única muestra full
22/22 y el re-audit congelado de Claude sobre este sello. No hay migración por
aplicar.
