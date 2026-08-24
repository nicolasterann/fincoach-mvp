> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Bloque M0 — autoridad monetaria server-owned v39

Fecha: 2026-08-11  
Estado: **ABIERTO — defecto de aceptación real corregido localmente; pendiente re-audit**  
Migraciones: **001–111 aplicadas; v39 no añade migración**  
Producción actual: `e91df36` (v38; contiene el defecto)  
Contrato v39: `m0-agent-eval-2026-08-11-stored-money-authority-v39`

Sello ejecutable canónico:
`f666273482ff7a0bad72662033d3563e4a4b59c0228bbc38d9833b5855a7cda0`
(486 archivos).

## Incidente que reabrió M0

La auditoría congelada de v38 dio 22/22 y el árbol se desplegó. La primera
revisión real del founder produjo:

1. «Hola, acabo de pagar el arriendo».
2. Kipu preguntó desde qué cuenta salió — correcto.
3. «Desde mi cuenta Supervielle».
4. Kipu reconoció Banco Supervielle, pero pidió confirmar otra vez la propuesta
   completa — incorrecto y bot-like.

No se movió dinero. La operación y el challenge quedaron fail-closed.

## Diagnóstico contra producción, read-only

Las filas durables separan responsabilidades sin ambigüedad:

- el planner continuó la operación original;
- resolvió `sourceAccountId` a Banco Supervielle;
- vinculó el fijo activo estable Arriendo;
- usó su monto nativo declarado exacto: 1.010.786,70 ARS;
- resolvió la fecha local del pago;
- declaró cero ambigüedades y que ya no debía preguntar nada.

Después del planner, el guard genérico creó un challenge:

- tool: `log_movement`;
- reason: `unstated_amount`;
- cifra: `amount=1010786.7`;
- motivo: la cifra no aparecía en el mensaje ACTUAL «Desde mi cuenta
  Supervielle».

El guard ignoró que esa cifra no era una selección del modelo: era el monto
nativo del fijo durable que el executor podía cotejar con el catálogo actual.
Confirmarla en un tercer turno no añadía autoridad.

## Reparación v39

### Contrato general

`serverConfirmationRequirement` acepta opcionalmente
`serverVerifiedMonetaryClaimPaths`. Sólo omite el challenge de un claim cuyo
path esté en esa lista. Todos los demás claims siguen recorriendo
`unstatedMonetaryClaims` sin cambios.

La lista la construye el executor mediante
`serverVerifiedStoredMonetaryClaimPaths`. Es un registro de pruebas por dominio,
no un router lexical. El planner no puede llenarlo ni autodeclarar autoridad con
`amount_source: stored_fact`.

### Primera prueba de dominio: fijo estable

`log_movement.amount` queda probado únicamente si:

- el movimiento es `expense`;
- existe `fixedExpenseId` exacto;
- el catálogo de fijos está disponible;
- la fila pertenece al contexto, está activa y `isVariable=false`;
- el monto coincide a centavos con el declarado nativo;
- la moneda coincide exactamente con la moneda nativa;
- ningún monto declarado por el usuario en la operación contradice el monto
  durable (si aparecen el monto del plan Y uno corregido, se rehúsa).

Si cualquiera falla, la lista queda vacía y el challenge original sigue vivo.
El vínculo con el fijo, la cuenta, la moneda y el writer se siguen validando en
sus fronteras existentes antes de escribir.

## Qué no se hizo

- no hay regex para «arriendo»;
- no se acepta cualquier `stored_fact` del plan;
- no se amplió la evidencia monetaria con contexto libre;
- no se eximieron facturas variables;
- no se modificó PostgreSQL ni se aplicó migración;
- no se consumió ni canceló el challenge real del founder;
- no se escribió sobre su ledger.

## Cobertura

IR286 prueba en ambas direcciones:

- fijo estable + importe/moneda exactos + continuación sin cifra ⇒ path
  `amount` probado y cero challenge;
- monto distinto ⇒ challenge;
- moneda distinta ⇒ challenge;
- fijo variable ⇒ challenge;
- cifra user-authored contradictoria ⇒ challenge;
- el executor entrega esa lista al guard real.

M0M412 neutraliza el verificador y debe morir por IR286.

## Batería local

| Gate | Resultado |
|---|---:|
| Capture | **765/765** |
| Mutaciones M0 | **412/412**, exit 0 |
| TypeScript | limpio |
| Lint | limpio |
| Build con red | **36/36**, compilado |
| `git diff --check` | limpio |
| PostgreSQL | sin cambios; último certificado **73/73 ×2** |
| Modelo completo | no repetido: el planner productivo ya fue correcto |

## Auditoría solicitada a Claude

1. Confirmar por fuente que sólo el path re-derivado se exime y que el guard de
   monto no probado sigue intacto.
2. Construir adversariales adicionales: fijo de igual monto pero otro id,
   moneda base/nativa, catálogo ausente, variable, monto corregido por el
   usuario y cantidad cercana por redondeo.
3. Correr diff, tsc, lint, capture 765/765, mutaciones 412/412 y build.
4. PostgreSQL no cambió; puede reusar 73/73×2 o repetirlo si quiere congelar la
   ronda completa.
5. En una persona disposable con un fijo estable en moneda extranjera y una
   cuenta compatible, ejecutar exactamente dos entregas nuevas:
   «acabo de pagar <fijo>» → pregunta sólo cuenta; «desde <cuenta>» → escribe
   una vez y no pide confirmación adicional.
6. Probar al menos un caso variable o monto contradictorio que DEBE seguir
   preguntando.
7. Limpiar por identidad y verificar cero residuo.

No usar la cuenta del founder. Su challenge v38 sigue pendiente y debe
cancelarse/abandonarse explícitamente después del deploy, antes de repetir el
transcript real; responderle «sí» probaría el payload viejo, no v39.

## Veredicto de Codex

**M0 permanece abierto.** La prueba final del founder hizo exactamente su
trabajo: encontró una frontera no cubierta por ME1–ME22. v39 corrige la clase
server-owned frente a user-owned sin reducir la inteligencia del modelo ni
convertir el producto en un conjunto de casos por frase.
