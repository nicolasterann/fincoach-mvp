> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para Claude — reparación de ME2 sobre evidencia financiera estructurada

Fecha: 2026-08-03  
Estado: código corregido y falsificado localmente; **M0 sigue abierto** hasta el E2E de modelo real 22/22 ×5 sobre un runtime limpio y la ronda congelada externa.  
Migraciones: 100–104 ya aplicadas; **no hay migración 105** en esta pasada.  
Writes externos: ninguno.

## 1. El hallazgo exacto

Tu última corrida limpia descartó definitivamente el build viejo y tipó ME2 como
`money_not_grounded`. El `roleScope` ampliado sí funciona con evidencia sintética,
pero esa evidencia no tenía la forma del runtime real.

Reconstruí la cadena completa:

1. `buildAgentContextDataMessage` produce un mensaje etiquetado cuyo cuerpo ya es
   JSON tipado:

   ```text
   <KIPU_CONTEXT_DATA>
   {"kind":"KIPU_CONTEXT_DATA_V1","debtAccounts":[{"name":"Diners NT","debtNative":50.6,...}]}
   </KIPU_CONTEXT_DATA>
   ```

2. Para un plan validado, completo, de sólo lectura,
   `verifiedReadOnlyPlanEvidence` lo guardaba como el valor string de otro
   `JSON.stringify`.

3. En la evidencia final las claves quedaban escapadas:

   ```text
   "financialContext":"<KIPU_CONTEXT_DATA>\n{\"debtAccounts\":[{\"name\":\"Diners NT\",\"debtNative\":50.6}]}`
   ```

4. `evidenceEntityNames` toleraba ese anidamiento porque decodifica escapes. En
   cambio, `evidenceMoneyClaimDetails` busca claves monetarias tipadas reales
   (`"debtNative":50.6`). No reconoce `\"debtNative\":50.6`.

5. Por eso el guard veía que 50,60 existía como dígito en la evidencia, e incluso
   podía reconocer Diners como entidad, pero no encontraba un claim monetario
   tipado cuya ventana contuviera la tarjeta. El binding terminaba en
   `money_not_grounded` para una respuesta correcta.

Esto explica la diferencia entre tu sonda sintética y ME2 sin relajar la barrera
que impide pegar un número verdadero a una tarjeta equivocada.

## 2. La corrección

Archivo: `src/lib/ai/agent/kipu-agent.ts`.

`verifiedReadOnlyPlanEvidence` ahora intenta estructurar el snapshot financiero
únicamente cuando se cumplen simultáneamente estas condiciones:

- el mensaje coincide **completo** con los tags exactos
  `<KIPU_CONTEXT_DATA>... </KIPU_CONTEXT_DATA>`;
- el cuerpo parsea como JSON;
- es un objeto, no un array;
- su discriminante raíz es exactamente `kind === "KIPU_CONTEXT_DATA_V1"`.

En ese único caso el objeto parseado se coloca como `financialContext` dentro de
`KIPU_VERIFIED_READ_CONTEXT`. Así `debtNative`, `name` y los demás campos vuelven
a compartir el mismo objeto y los índices usados por monto, ventana, entidad y
rol pertenecen a la misma cadena.

Si el tag es arbitrario, está malformado, no parsea o no tiene el discriminante
oficial exacto, permanece como **string inerte**. El catch nunca promueve texto a
evidencia y nunca convierte una lectura fallida en ausencia.

No cambié:

- la gramática de claims monetarios del reply;
- la tolerancia numérica;
- la extracción de entidad;
- el binding por ventana;
- el role scope por entidad;
- la separación entre evidencia de lectura y evidencia de escritura;
- el requisito de plan `actionCount=0`, `responseIntent=answer` y cobertura
  completa.

Por tanto, esto no hace la barrera más permisiva: elimina una serialización
accidental en la fuente oficial que la volvía incapaz de leer su propio dato.

## 3. Prueba con el builder real, no con otra sonda sintética

Fortalecí `IR113b` en `src/app/dev/capture-test/page.tsx` usando
`buildAgentContextDataMessage` de producción con:

- Diners NT = 50,60 USD;
- Visa Pichincha = 743,93 USD;
- una tercera entidad cuyo **nombre controlado por el usuario** intenta inyectar
  la cadena `debtNative:999` y `name:Diners NT`.

La evidencia del test pasa por el mismo recorrido real:

```text
buildAgentContextDataMessage
→ verifiedReadOnlyPlanEvidence
→ replyMoneyIsGrounded
```

IR113b exige a la vez:

1. el snapshot oficial queda como objeto estructurado y no como string escapado;
2. `De la Diners NT te toca pagar 50.60$ y vence el 3 de agosto` pasa;
3. asociar esos 50,60 a Visa Pichincha falla;
4. el `999` incrustado dentro de un nombre no se vuelve clave monetaria;
5. un tag con `kind: USER_FORGED` no obtiene autoridad financiera;
6. el contexto de sólo lectura no puede probar `registré` ni ninguna escritura.

El fixture anterior de IR113b sólo usaba un `summary` humano con `$`; por eso
podía quedar verde mientras el JSON tipado real estaba roto.

## 4. Mutaciones nuevas

El runner M0 pasa de 212 a **215/215**. Las tres nuevas mueren por IR113b:

| Mutación | Qué rompe |
|---|---|
| M0M213 | cambia el tag oficial esperado y deja el snapshot doblemente escapado |
| M0M214 | acepta cualquier `kind` string y promueve un contexto falsificado |
| M0M215 | deriva el objeto correcto pero sigue consumiendo el string viejo |

La tercera blinda explícitamente la debilidad repetida del proyecto: una decisión
correcta puede existir en el archivo sin alimentar la sentencia viva.

## 5. Handshake

Subí `M0_AGENT_EVAL_CONTRACT` de
`m0-agent-eval-2026-08-03-calendar-evidence-v2` a:

```text
m0-agent-eval-2026-08-03-structured-read-evidence-v3
```

El servidor v2 que produjo `money_not_grounded` ya no puede certificar esta
reparación. Antes de interpretar un resultado del modelo hay que borrar `.next`,
arrancar el servidor desde este árbol y comprobar que `/dev/m0-agent-eval`
reporta v3.

## 6. Verificación local ejecutada

| Suite | Resultado |
|---|---:|
| Capture | **731/731** |
| Mutaciones M0 | **215/215**, residuo cero |
| TypeScript | limpio |
| Lint | limpio |
| J-2 | 17/17 |
| J-3 | 21/21 |
| J-4 | 18/18 |
| `git diff --check` | limpio |

`npm run build` llegó a Turbopack y falló exclusivamente al descargar Geist y
Geist Mono desde Google Fonts por la red del sandbox. No lo reporto verde: debe
certificarse con red.

Intenté ejecutar el E2E de modelo desde este entorno. No había servidor local y
el sandbox rehúsa `listen` incluso en `127.0.0.1:3000` (`EPERM`); la solicitud
escalada también fue rechazada. El resultado 0/0 de ese intento es una
limitación del entorno, **no** una medición del producto y no debe mezclarse con
las cinco corridas ME2 de tu runtime v2.

Las baterías ya certificadas antes de este cambio estrecho permanecían en:

- PostgreSQL M0 62/62 ×2, residuo cero;
- K mutaciones 280/280;
- L refund 24/24;
- Pre-M 28/28;
- loop 22/22, wizard 161/161.

No afirmo haber repetido las suites PostgreSQL ni el modelo en esta pasada.

## 7. Auditoría solicitada

### Fuente

1. Lee el diff de `verifiedReadOnlyPlanEvidence` y verifica que sólo el tag
   oficial completo + discriminante exacto se promueve a objeto.
2. Confirma que un plan con alguna acción sigue recibiendo `null` y que el
   snapshot nunca entra a `actionEvidence`.
3. Reproduce el nombre malicioso de IR113b y confirma que 999 no se vuelve un
   claim tipado.
4. Muta por tu cuenta los tres puntos de M213–M215; las tres deben matar IR113b.
5. Busca otros sitios donde un contexto JSON ya serializado se coloque como
   string dentro de evidencia que luego dependa de índices/ventanas.

### Runtime limpio obligatorio

1. Congela el árbol; no ajustes assertions durante la ronda.
2. Borra `.next` completamente.
3. Ejecuta capture y confirma **731/731** antes de arrancar Next.
4. Arranca con `KIPU_AGENT_MODE=on` y el mismo `M0_EVAL_SECRET` del runner.
5. Comprueba que el health del route devuelve exactamente:

   ```json
   {"contract":"m0-agent-eval-2026-08-03-structured-read-evidence-v3"}
   ```

6. Ejecuta `node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs`.
7. La primera corrida debe llegar a **22/22**, exit 0, sin `ABORT`, cobertura
   incompleta ni residuo. ME2 debe publicar 50,60 + 3 de agosto sin writes.
8. Repite hasta completar **cinco corridas 22/22** sobre el mismo árbol congelado.
   Si alguna falla, informa el check, `publicationFailure`, operación y evidencia
   estructural no sensible; no adaptes el assert al sample.
9. Certifica `npm run build` con red.
10. Repite mutaciones M0 215/215 y, como ronda congelada independiente, las
    suites PostgreSQL 62/62 al menos una vez.

## 8. Veredicto de Codex

El P1 conocido que bloqueaba ME2 queda corregido en código y fijado por trayecto
real + mutación. No conozco otro defecto local abierto en esa frontera.

**M0 todavía no se puede declarar cerrado**: 21 checks del modelo nunca se han
ejecutado con éxito y la condición explícita de cierre es 22/22 ×5 más una ronda
congelada externa. El siguiente veredicto debe descansar en esa ejecución, no en
este informe.

