> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para auditoría externa — M0 v12 (planner + publicación de voz)

Fecha: 2026-08-04  
Estado: implementación local terminada; sin commit, sin deploy y sin migración
nueva. Migraciones 100–107 permanecen aplicadas. M0 sigue abierto hasta medir
el modelo real.

## Contexto y restricción de costo

La pasada externa v11 obtuvo 16/22 en una sola corrida del modelo. Al abrir las
aserciones, cuatro rojos eran cascada de ME6 y ME8 incluso demostraba una
redelivery idéntica byte a byte. Había sólo dos defectos reales:

1. ME6: el planner entendía correctamente una devolución de capital no
   registrada, proponía las tres patas económicas correctas y aun así inventaba
   un `missing_field` para preguntar el nombre de la contraparte. El writer no
   necesita ese nombre.
2. ME10b: el plan y la economía eran correctos, pero la propuesta server-owned
   no se podía publicar. El fallo quedaba oculto como
   `reply_structure_or_voice`, etiqueta que mezclaba cuatro causas distintas.

Por el costo acumulado del E2E real, esta reparación NO ejecutó el modelo. Todo
lo que puede probarse sin consumir créditos quedó cerrado primero. La auditoría
externa debe hacer una sola corrida v12 y detenerse ante cualquier rojo.

## Fix 1 — una devolución lista no puede inventar información faltante

### Causa

`record_person_payment` acepta `person` como metadato opcional para
`capital_return_unrecorded`. La identidad económica ya está completa cuando el
plan prueba:

- `direction = in`;
- `inflowKind = capital_return_unrecorded`;
- monto positivo;
- cuenta destino exacta;
- caja aumenta, ingreso no cambia y receivable no cambia.

El modelo había emitido exactamente eso, pero añadió
`person_for_83_86_capital_return_unrecorded` como missing. Como
`missing_fields` es texto libre, nada determinista contradecía esa pregunta.

### Reparación

En `src/lib/ai/agent/agent-planner.ts` añadí
`plannerMissingFieldContractError`. No inspecciona frases del usuario ni nombres
de keys. Identifica acciones de devolución de capital que ya contienen todos
los insumos ejecutables y rehúsa cualquier `missing_field` que pretenda
bloquearlas. Así una paráfrasis nueva no cambia el veredicto.

El prompt también explicita la asimetría de producto:

- en `capital_return_unrecorded`, el nombre es sólo procedencia opcional;
- en `borrowed`, prestamista y deuda concreta sí son obligatorios;
- en `loan_repayment`, el receivable exacto sí es obligatorio.

No se debilitó la ontología: siguen siendo obligatorias las tres patas
económicas del capital devuelto y la dirección debe estar probada.

## Fix 2 — confirmación durable sí; plantilla rígida no

### Causa

La autorización estaba bien: ME10b debía proponer primero y una entrega nueva
debía confirmar. El problema era el texto interno del guard:

> Para aprobar exactamente esta propuesta responde solo “sí, hazlo”.

El modelo copiaba esa plantilla; el juez semántico la podía rechazar por voz de
bot. Cambiar o retirar la confirmación habría sido incorrecto.

### Reparación

`src/lib/ai/agent/agent-action-guard.ts` conserva exactamente la misma
challenge durable, fingerprint, entrega independiente y parser de confirmación,
pero el resumen ahora pide confirmación explícita de forma natural. No dicta una
frase que el usuario deba copiar. Cambiar monto, entidad o condición sigue
creando una propuesta nueva.

La reparación acotada de `kipu-agent.ts` recibe además una regla de clase para
`semantic_voice_rejected`: conservar hechos, explicar la propuesta y pedir
confirmación naturalmente, sin “responde solo”. El servidor —no el copy— sigue
decidiendo si la siguiente entrega autoriza.

## Fix 3 — el fallo de publicación conserva su causa real

### Causa

`finish()` pasaba `null` a `finalizeAgentReply` cuando el juez semántico
rechazaba. Ese `null` se convertía en `reply_structure_or_voice`, igual que una
respuesta vacía, una fuga de estructura o el backstop determinista. La
telemetría no permitía elegir el arreglo correcto y ya costó una ronda de
modelo.

### Reparación

La frontera ahora distingue:

- `reply_empty`;
- `reply_structure_markers`;
- `reply_voice_backstop`;
- `semantic_voice_rejected`.

`applySemanticVoiceReview` consume el veredicto después del finalizador
determinista:

- un fallo determinista conserva su propia razón;
- un rechazo semántico verificado bloquea con razón tipada;
- un juez no disponible (`verified=false`) no se convierte en veredicto y deja
  pasar únicamente texto que ya superó el backstop determinista.

La misma función se consume en la primera respuesta y en cada reparación. No se
aflojó money grounding, calendar grounding, proof de mutación ni Saldo.

## Cobertura añadida

IR261 ejecuta los contratos, no sólo busca líneas:

1. el mismo plan de capital devuelto sin `person` es válido;
2. añadirle un missing de contraparte lo vuelve inválido;
3. reply nulo produce `reply_empty`;
4. estructura interna produce `reply_structure_markers`;
5. voz no neutral determinista produce `reply_voice_backstop`;
6. texto limpio + rechazo semántico verificado produce
   `semantic_voice_rejected`;
7. texto limpio + juez no disponible sigue publicable;
8. el guard no contiene la clase “responde solo” y la reparación no la puede
   reintroducir.

El contrato de runtime pasó de `direct-expense-v11` a
`m0-agent-eval-2026-08-04-planner-voice-v12`, por lo que un servidor compilado
viejo aborta antes de crear la persona disposable.

## Mutaciones

La batería creció de 264 a 271. Las nuevas M0M265–M0M271 prueban por nombre:

- neutralizar el consumo del validador de missing;
- volver obligatorio `person`;
- reintroducir una confirmación rígida válida (no un archivo que sólo deje de
  compilar);
- colapsar reply vacío;
- colapsar el backstop de voz;
- perder la razón semántica;
- volver a dictar “responde solo” en la reparación.

Resultado final: **271/271**, exit 0, residuo cero.

Durante la primera pasada, M0M267 generaba TypeScript inválido. Eso no prueba la
invariante porque el gate moría antes de nombrar IR261. La mutación se corrigió
para reintroducir una instrucción rígida sintácticamente válida; sólo entonces
se aceptó el 271/271.

## Verificación local final

- `npx tsc --noEmit`: limpio.
- `npm run lint`: limpio.
- `git diff --check`: limpio.
- capture: **740/740**.
- mutaciones M0: **271/271**, exit 0, residuo cero.
- no se ejecutó el modelo real: cero créditos consumidos por esta pasada.
- no se ejecutó PostgreSQL porque no cambió SQL y la pasada externa ya había
  certificado 64/64×2 sobre las migraciones 100–107.
- `npm run build` llegó a Next/Turbopack y falló exclusivamente al descargar
  Geist/Geist Mono de Google Fonts por red bloqueada en el sandbox. La
  escalación fue rechazada; no se usó workaround. Claude debe certificar build
  con red.

## Auditoría pedida a Claude (orden y presupuesto)

1. Auditar el diff de los tres contratos anteriores; en particular, confirmar
   que `plannerMissingFieldContractError` sólo trata como lista una devolución
   realmente ejecutable y no vuelve opcionales prestamista/deuda/receivable.
2. Confirmar que `applySemanticVoiceReview` se consume tanto en el primer texto
   como en el reparado, que `verified=false` no lava el backstop y que un
   rechazo semántico verificado nunca publica.
3. Confirmar que la nueva redacción no debilita la challenge server-owned ni su
   necesidad de una entrega separada.
4. Certificar build con red y verificar handshake v12 con `.next` limpio.
5. Capture 740/740 y mutaciones 271/271 pueden reejecutarse: no usan API.
6. PostgreSQL 64/64 una vez es suficiente como smoke porque no existe migración
   108 ni cambio SQL en esta pasada.
7. Ejecutar **UNA sola** corrida del modelo v12. Si cualquier check queda rojo,
   detenerse y reportar el primer fallo real con plan, receipts,
   `publicationFailure` tipado y estado posterior; no reintentar. Si da 22/22,
   informar primero antes de gastar las cuatro muestras de estabilidad.

## Veredicto de Codex

Los dos defectos conocidos de la ronda v11 están corregidos y cubiertos por
ejecución determinista adversarial. No declaro M0 cerrado: falta la evidencia
cara que sólo puede dar el modelo real. El árbol queda listo para una auditoría
externa de una sola muestra, con diagnósticos suficientemente precisos para no
quemar otra ronda adivinando entre cuatro barreras.
