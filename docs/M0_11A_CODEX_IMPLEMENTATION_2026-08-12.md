> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0.11A — informe de implementación de Codex para auditoría de Claude

> **HISTÓRICO, SUPERADO POR EL RE-AUDIT.** Claude aplicó la 112 y su primera
> corrida PostgreSQL encontró dos defectos de instrumento/diagnóstico. El
> relevo vigente, con la corrección append-only 113, es
> `docs/M0_11A_CODEX_POST_AUDIT_FIX_2026-08-12.md`.

Fecha: 2026-08-12  
Estado: **IMPLEMENTADO LOCALMENTE; NO APLICADO, NO COMMITEADO, NO DESPLEGADO**  
Base al iniciar: `ce223190d67b72c51610e1c32c829100257557e2` (`main == origin/main`, árbol limpio)  
Migraciones en producción: 001–111  
Nueva migración: `112_m0_operation_manifest_authority.sql`, **PREPARADA, NO APLICADA**

Sello canónico de la superficie ejecutable tras la batería final:

```text
5d8714932ee62590c8ee255b94ad451f37d334fe2975ce6b1ec23e1a6f960335
488 archivos
```

El sello usa el comando de
`M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`; no incluye documentación.

## 1. Qué problema resuelve

El incidente de los cuatro créditos no era otra frase que faltaba reconocer. La
arquitectura v44 permitía una sola propuesta pendiente por conversación:

```sql
create unique index agent_action_challenges_live_uq
  on public.agent_action_challenges(user_id, channel, coalesce(chat_id,''))
  where status = 'pending';
```

Cuatro `register_card_payment` sensibles competían por esa única fila. A la vez,
la confirmación seguía dependiendo de una clasificación lingüística mecánica.
El modelo había entendido la petición, pero la capa inferior fragmentaba su
plan y luego exigía otra superficie verbal. Ésta es una contradicción de
autoridad, no un caso de lenguaje faltante.

M0.11A cambia la unidad de autorización: de un challenge por tool a **un
manifiesto durable por operación**, que contiene una o N acciones exactas. El
modelo es la única autoridad que decide qué quiso decir el usuario. Las capas
mecánicas ya no vuelven a interpretar esa frase; comprueban identidad,
procedencia, ownership, estado, CAS, álgebra, effects y el resultado final.

## 2. Invariantes implementadas

### 2.1 Una sola autoridad semántica

El planner declara `operation_transition` con uno de estos estados:

`new`, `observed`, `resolved`, `partially_resolved`, `insufficient`, `modified`,
`confirmed`, `rejected`, `abandoned`, `unrelated`.

Ningún regex del executor decide si «sí son esos cuatro», «dale con todos» o
«el primero por Pichincha y los demás por Produbanco» es una confirmación o una
modificación. El modelo lo declara. El servidor verifica que la transición sea
compatible con el estado durable:

- `confirmed` reutiliza el plan/manifiesto persistido exacto y exige `actions=[]`;
- `partially_resolved` debe reducir realmente el conjunto de missing fields;
- `observed` sólo puede inspeccionar una operación abierta sin consumirla;
- `rejected`/`abandoned` deben cerrar durablemente su target sin acciones;
- `modified` debe apuntar al trabajo previo que cambia;
- `new`/`unrelated` no pueden apropiarse de una continuación.

### 2.2 Anti-loop estructural

La regla no es «no repetir palabras». Es «demostrar qué hizo el turno con la
respuesta».

- Una primera respuesta insuficiente puede producir una pregunta aclarada.
- Repetir literalmente la pregunta se rehúsa.
- Parafrasearla otra vez con exactamente el mismo conjunto pendiente, después
  de una aclaración insuficiente, también se rehúsa.
- Para continuar hay que resolver algo, cambiar materialmente la propuesta,
  observar, rechazar, abandonar o salir de esa operación.

El contador y la última transición viven en `agent_operations`; los eventos
quedan en `agent_operation_transition_events`. La decisión del modelo se
persiste, pero la progresión se verifica por estructura before/after.

### 2.3 Procedencia, no frase mágica

Cada argumento monetario persistible declara una fuente:

- `user_stated`: entrega durable exacta + quote exacto; no busca libremente en
  todo el historial. La cifra del quote tiene que ser la de ese argumento.
- `stored_fact`: hecho estructurado revalidado bajo lock. M0.11A habilita sólo
  el verificador que ya existe para el monto declarado de un gasto fijo estable.
- `derived`: el protocolo y sus políticas de drift están tipados, pero en A
  fallan cerrado hasta que M0.11B implemente cada derivación bajo lock.

La clase 552,77 sigue protegida: que un saldo verdadero exista en el mensaje no
autoriza usarlo como monto del pago. El modelo declara una entrega y un quote;
el servidor prueba exactamente esa fuente.

### 2.4 Una autorización cubre N acciones exactas

`buildAgentOperationManifest` conserva, en orden:

- action id y capability;
- argumentos completos;
- procedencia;
- `atomic_group` y dependencias;
- state witness;
- effects y postconditions;
- estado final proyectado.

El manifiesto se canoniza y hashea. Una acción ordinaria se autoriza en la
entrega que la pidió. Sólo las superficies con impacto destructivo/social o
creación de instrumentos exigen segunda entrega; incluso entonces se propone
un solo manifiesto completo. La confirmación posterior autoriza por CAS el hash
y `plan_version` ya guardados: no reproduce N payloads y no crea N challenges.

La atomicidad no se deduce de «misma cuenta» ni de una capability. El planner
agrupa cuando una falla parcial volvería falsa la proyección final que el
usuario autorizó. El validador y el preflight existentes siguen verificando la
forma exacta.

### 2.5 Autorizado = preparado = ejecutado

Antes de ejecutar, PostgreSQL mueve el manifiesto `authorized → executing`
bajo el mismo lease de la operación. Después del write compara de forma exacta:

- número de acciones;
- action id, orden y capability;
- argumentos;
- state witness, effects y postconditions;
- atomic group;
- estado terminal de cada step.

Una diferencia deja el manifiesto en `failed_integrity` con un receipt durable;
no es una advertencia ni un éxito parcial narrable. En una operación parcial,
cada acción del plan vigente debe quedar explícitamente `verified`,
`needs_input`, `refused` o `failed`; un step fantasma tampoco pasa.

## 3. Migración 112

Objetos nuevos:

- columnas `agent_operations.semantic_stall_count` y
  `agent_operations.last_operation_transition`;
- tabla `agent_operation_manifests`;
- tabla `agent_operation_transition_events`;
- `kipu_record_agent_operation_transition(jsonb)`;
- `kipu_register_agent_operation_manifest(jsonb)`;
- `kipu_authorize_agent_operation_manifest(jsonb)`;
- `kipu_begin_agent_operation_manifest(jsonb)`;
- `kipu_verify_agent_operation_manifest(jsonb)`.

Seguridad prevista:

- RLS en ambas tablas, política SELECT-own para `authenticated`;
- sin INSERT/UPDATE/DELETE para `authenticated` o `anon`;
- RPCs `SECURITY DEFINER`, owner postgres, `search_path=public,pg_temp`;
- EXECUTE sólo `service_role`;
- ownership, delivery identity, plan version, operation lease y CAS en cada
  frontera que muta autoridad;
- advisory lock por conversación al proponer/autorizar.

El índice legacy `agent_action_challenges_live_uq` **no se elimina**. Conserva
su trabajo de serialización para rollback y para cualquier operación v44 que
aún no tenga manifiesto. El camino M0.11A no crea challenges por acción, por lo
que el índice ya no puede canibalizar N pasos del manifiesto.

## 4. Cambios de aplicación

### `agent-operation-authority.ts` (nuevo)

Contrato puro de transiciones, anti-loop, procedencia, drift, manifiesto,
política de confirmación, hash e igualdad post-ejecución.

### `agent-planner.ts`

- enseña al modelo transición, procedencia, estado proyectado y confirmación
  natural;
- exige esos contratos sólo en el planner vivo, preservando la lectura de
  planes históricos;
- compila el monto estable de fixed expense junto con su procedencia tipada;
- nunca selecciona una rama por una frase o caso financiero;
- una confirmación devuelve `actions=[]`: el runtime recupera el plan exacto.

### `agent-operation-store.ts`

- las lecturas abiertas exponen cada entrega como `{deliveryKey,requestText}`;
- wrappers tipados para las cinco RPCs nuevas;
- persiste/lee transición, stall count y manifiesto.

### `kipu-agent.ts`

- registra la transición declarada;
- construye y registra el manifiesto sólo para un plan mutante `ready`;
- si es sensible, publica una pregunta natural para el conjunto completo;
- en una confirmación, recupera y autoriza el manifiesto persistido por CAS;
- inicia ejecución con lease + manifest hash;
- exige verificación estándar y luego igualdad del manifiesto;
- eliminó del runtime la antigua confirmación desnuda basada en texto.

### `kipu-agent-tools.ts` / `agent-action-guard.ts`

Con un manifiesto autorizado, se apaga únicamente la **reinterpretación
lingüística** posterior (mención de cuenta, correction phrasing, split lexical,
challenge por tool). Permanecen:

- schema y enums;
- exact planned-action match;
- ownership y moneda;
- preflight y CAS;
- compatibilidad económica;
- writers tipados;
- receipts y verificación post-write.

## 5. Pruebas añadidas

### Capture / mutaciones

- IR292: manifiestos de 1, 4 y 20 acciones; cuatro pagos ordinarios no requieren
  cuatro confirmaciones.
- IR293: progreso parcial, loop literal y loop parafraseado.
- IR294: entrega durable exacta y refutación explícita de 552,77.
- IR295: igualdad exacta post-write.
- IR296: forma y seguridad de la migración 112.
- IR297: se retira reinterpretación, no controles monetarios.
- IR298: lifecycle estructural completo.
- M0M431–439 apagan una por una esas garantías, incluido el CAS de transición.

Además reanclé M0M48 al consumo runtime real de verificación parcial y M0M318
al receipt-less domain write concreto; antes podían sobrevivir porque sus
detectores aceptaban otra ocurrencia de la misma cadena.

### PostgreSQL E2E

`telegram-agent-100-e2e.mjs` pasa de 73 a 78 checks:

- M112.1 transición durable, replay exacto y dedupe mismatch;
- M112.2 cuatro acciones bajo un manifiesto y cero challenges;
- M112.3 igualdad exacta de cuatro receipts;
- M112.4 confirmación natural de cuatro acciones sensibles por un solo CAS;
- M112.5 acción ausente produce `failed_integrity` durable.

Las cuatro tarjetas del fixture sensible son filas distintas; el check no se
beneficia de repetir una misma entidad.

### Modelo conversacional

La batería pasa de 22 a 24 checks:

- ME16: cuatro tarjetas nuevas, referencia natural a «esos cuatro», cuatro
  pagos en una operación, cuatro filas y un manifiesto verificado;
- ME17: una propuesta sensible de cuatro cierres, confirmación natural distinta
  de los fixtures viejos, mismo manifiesto exacto, cero challenges legacy.

Las confirmaciones ya existentes de ME9/ME10b/ME10c recorren otras superficies
lingüísticas. Se evalúan los efectos durables, no una frase del modelo.

## 6. Estado de validación local

- `npx tsc --noEmit`: verde.
- `npm run lint`: verde.
- capture: **777/777**.
- build con red: **36/36 páginas**, exit 0. El primer intento sin red falló sólo
  al descargar Geist; la repetición autorizada compiló en 2,6 s.
- sintaxis de ambos E2E (`node --check`): verde.
- `git diff --check`: verde.
- mutaciones M0: **438/438**, exit 0, baseline verde y restauración byte a
  byte. Durante la implementación se reforzaron dos detectores que antes eran
  débiles.

No se ejecutó PostgreSQL 78/78 porque la 112 no está aplicada. No se gastó una
muestra del modelo por la misma razón. No se tocó producción ni la operación
pendiente real del founder.

## 7. Auditoría solicitada a Claude — orden obligatorio

1. Sellar hash/archivo-count del árbol antes de tocar nada.
2. Auditar la fuente de la 112 y el caller. En particular:
   - CAS y leases de propuesta, confirmación, comienzo y verificación;
   - carrera entre entregas concurrentes;
   - RLS, grants, owner y `search_path`;
   - igualdad exacta plan↔manifest↔steps;
   - transición/anti-loop contra estado durable;
   - procedencia `user_stated` ligada a una entrega de la misma operación;
   - stored fixed amount bajo lock;
   - que `derived` siga fail-closed;
   - que el índice legacy siga presente y no participe en M0.11A.
3. Tomar preestado de producción sólo lectura. Verificar que 001–111 están
   aplicadas y 112 ausente.
4. Aplicar 112 append-only sólo si los puntos 1–3 pasan. No reescribir 112 tras
   aplicarla; cualquier defecto posterior sería 113.
5. Verificar catálogo completo de tablas, columnas, índices, políticas, owner,
   SECURITY DEFINER, search_path y revokes.
6. Ejecutar PostgreSQL **78/78 dos veces**, exit 0 y residuo cero.
7. Ejecutar capture **777/777**.
8. Ejecutar mutaciones **438/438** en serie, desde baseline verde, sin otro
   runner vivo y con restauración byte a byte.
9. Ejecutar tsc, lint, build con `.next` limpio y `git diff --check`.
10. Levantar servidor nuevo y verificar handshake
    `m0-agent-eval-2026-08-12-operation-manifest-m0-11a` archivo↔runtime.
11. Gastar **una sola** muestra completa del modelo, esperando **24/24**. Primer
    rojo: detener, conservar operación/manifest/transiciones/steps antes del
    cleanup y reportar una causa tipada. No remuestrear el mismo sello.
12. Ejecutar adversariales con persona disposable y lenguaje nuevo. Medir
    convergencia por estado final, preguntas y writes, no por JSON ni copy:
    - confirmación, modificación parcial, rechazo y abandono de un conjunto;
    - 1, 4 y hasta 20 acciones bajo una autorización;
    - una respuesta ambigua que justifica una aclaración y una segunda respuesta
      que no puede producir loop;
    - 552,77 sigue rehusado;
    - una falla parcial no puede narrarse como estado proyectado completo;
    - replay no mueve dinero dos veces.
13. Verificar residuo por identidad y hash final idéntico. No hacer commit,
    push ni deploy en esta auditoría.

## 8. Riesgos e intencionales no-cambios

- **112 no fue ejecutada:** su sintaxis/semántica real y concurrencia son el
  primer gate externo, no una afirmación de este informe.
- **M0.11B sigue pendiente:** selección por conjuntos, país/institución/alias,
  derivaciones `current_balance`, `target_balance`, `exact_difference` y
  coordinación masiva. A quita las esposas de autorización; B añade la nueva
  superficie de «deja en cero mis cuentas negativas/de Ecuador».
- Los valores `derived` se declaran pero fallan cerrado hasta B. No se acepta un
  witness escrito sólo por el modelo.
- `user_stated` prueba entrega, quote y valor exactos; deliberadamente no usa
  una gramática mecánica para decidir si una frase significa saldo, pago o
  deuda, porque ésa es autoridad semántica del modelo. Por eso la auditoría debe
  incluir el adversarial real «saldo 552,77 / pago 743,93»: si el planner liga
  el saldo como pago, A no se aprueba. La salida correcta sería una pregunta o
  una confirmación única del manifiesto, nunca agregar otro regex por palabras.
- El único pending real pre-112 no tiene manifiesto. Debe abandonarse
  explícitamente después de desplegar el código auditado; no se migró ni tocó.
- El índice/challenge legacy se conserva deliberadamente para rollback. No es
  la autoridad del camino nuevo.
- No se relajó ningún writer, RLS, trigger, CAS financiero, preflight de moneda,
  receipt ni undo.

## 9. Veredicto de Codex

**M0.11A está implementado localmente, pero M0 sigue abierto.**

La implementación ataca la clase correcta: el modelo interpreta una vez y la
infraestructura verifica lo que declaró, en lugar de reinterpretar el lenguaje
natural en cada tool. La autorización ya escala a N acciones y el anti-loop
depende de progreso durable, no de frases.

No autorizo commit/deploy todavía. La autorización depende de que Claude cierre
la migración 112 contra PostgreSQL real, obtenga 78/78×2, 438/438 y una única
muestra 24/24 sobre el runtime sellado.
