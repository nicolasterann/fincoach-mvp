# Plan diferido — OpenAI GPT-5.6 + Responses API

**Estado:** DIFERIDO HASTA CERRAR BLOQUE M0  
**Fecha de auditoría:** 2026-08-09  
**Decisión:** no cambiar modelo, SDK ni API mientras M0 siga abierto. El cambio de
runtime/modelo alteraría la muestra que M0 está tratando de estabilizar y haría
imposible atribuir una regresión al producto, al prompt, al modelo o al endpoint.

## Decisión ejecutiva

La modernización recomendada no es sustituir todos los strings por
`gpt-5.6-luna`.

- Usar **Responses API** como endpoint principal.
- Conservar el planner, preflight, operación durable, writers, receipts, CAS,
  confirmaciones y settlement propios de M0.
- Usar **GPT-5.6 Terra** como candidato inicial para planificación financiera.
- Usar **GPT-5.6 Luna** como candidato para narración, repairs y superficies
  read-only de alto volumen.
- Conservar inicialmente `gpt-5.4-mini` en clasificadores: Luna es más nueva,
  pero su precio por token es mayor que el mini actual.
- Reservar **GPT-5.6 Sol** para evaluación offline o escalamiento excepcional
  medido; no como default.
- No adoptar Agents SDK ni Realtime en esta migración.
- No transmitir texto financiero antes de que cruce las barreras deterministas
  de grounding, receipts, pendientes y post-write freshness.

## Foto del repositorio auditado

- OpenAI SDK `6.35.0`; versión npm observada durante la auditoría: `7.4.0`, que
  requiere Node 22.
- 27 llamadas a `chat.completions.create`.
- 0 llamadas a Responses API.
- 26 construcciones independientes de `new OpenAI()`.
- 17 usos de `response_format: { type: "json_object" }` con parseo/validación
  manual posterior.
- 0 caminos de streaming.
- 1 transcripción con `whisper-1`.
- 1 TTS de simulación con `tts-1`.
- 122 tools del agente y 11 de onboarding.
- Sólo 43/122 schemas del agente y 7/11 de onboarding son compatibles de forma
  directa con strict function calling; los demás contienen propiedades
  opcionales que deben representarse como requeridas-nullable o adaptarse antes
  de activar `strict: true`.

## Por qué no usar Agents SDK ahora

M0 ya implementa una orquestación financiera más estricta que un loop genérico:

1. recuperación contextual completa/fail-closed;
2. plan LLM read-only;
3. compiladores semánticos mínimos;
4. validación determinista;
5. preflight contra estado vivo;
6. operación y delivery durables;
7. ejecución tipada/atómica;
8. receipts y post-write verification;
9. generación libre de lenguaje sin autoridad de escritura.

Reemplazar esta capa con Agents SDK mezclaría dos lifecycles de estado, replay,
confirmación y herramientas. Responses API puede modernizar el transporte sin
reemplazar la seguridad ya construida.

Realtime tampoco corresponde al producto actual: Telegram, chat web y notas de
voz son flujos asincrónicos, no una conversación audio-audio de baja latencia.

## Matriz candidata de modelos

| Workload | Candidato inicial | Configuración a comparar |
|---|---|---|
| Planner M0 | `gpt-5.6-terra` | `reasoning.effort: none` vs `low` |
| Respuesta desde receipts | `gpt-5.6-luna` | `reasoning.effort: none`, verbosity low |
| Repair de respuesta | `gpt-5.6-luna` | none |
| Ambient/general coach | `gpt-5.6-luna` | none |
| Onboarding planner | `gpt-5.6-terra` | low |
| Clasificadores/parser | mantener `gpt-5.4-mini` primero | comparar Luna sólo por eval |
| Visión/PDF financiero | Terra inicialmente | comparar Luna con fixtures exactas |
| Auditoría offline difícil | `gpt-5.6-sol` | uso excepcional |
| Transcripción | `gpt-4o-transcribe` | migración independiente |

Precios observados por millón de tokens al 2026-08-09:

| Modelo | Entrada | Salida |
|---|---:|---:|
| GPT-5.4 | $2.50 | $15 |
| GPT-5.6 Terra | $2.50 | $15 |
| GPT-5.6 Luna | $1 | $6 |
| GPT-5.6 Sol | $5 | $30 |
| GPT-5.4 mini | $0.75 | $4.50 |

Luna reduce 60% frente al core GPT-5.4, pero es aproximadamente 33% más cara
que el GPT-5.4-mini usado por los clasificadores. La selección debe hacerse por
workload y costo total por conversación, no por nombre de familia.

## Secuencia de implementación futura

### Fase 0 — control de costo antes de cambiar comportamiento

Crear un gateway único para OpenAI conservando temporalmente Chat Completions y
los modelos actuales. Debe incluir:

- workload tipado;
- modelo/API/latencia/intentos;
- tokens de entrada, salida, razonamiento y caché;
- costo calculado sin guardar prompts ni datos financieros;
- `OPENAI_EVAL_MAX_USD` y `OPENAI_EVAL_MAX_REQUESTS`;
- modos `live`, `record` y `replay` ligados a hash de prompt/schema/contrato.

Ningún E2E de comportamiento debe poder superar su presupuesto declarado.

### Fase 1 — configuración por workload

Introducir modelos separados, con fallback temporal a las variables existentes:

- `OPENAI_AGENT_PLANNER_MODEL`
- `OPENAI_AGENT_REPLY_MODEL`
- `OPENAI_AGENT_REPAIR_MODEL`
- `OPENAI_CLASSIFIER_MODEL`
- `OPENAI_ONBOARDING_PLANNER_MODEL`
- `OPENAI_ONBOARDING_REPLY_MODEL`
- `OPENAI_VISION_MODEL`
- `OPENAI_VOICE_REVIEW_MODEL`
- `OPENAI_API_MODE=chat|responses`

### Fase 2 — SDK aislado

- fijar Node `>=22` y verificar Vercel/CI/local;
- actualizar y fijar la versión exacta del SDK;
- no cambiar endpoint ni modelo en el mismo diff;
- repetir todos los gates deterministas y build.

### Fase 3 — Responses + Structured Outputs en bajo riesgo

Migrar uno por uno clasificadores y salidas read-only. Cada request con datos de
usuario debe llevar:

- `store: false`;
- `safety_identifier` estable y privacy-preserving, derivado con HMAC;
- `text.format` JSON Schema con `strict: true`;
- reasoning y verbosity explícitos;
- handling tipado de refusal, incomplete y output vacío.

### Fase 4 — planner M0

- migrar el planner a Responses sin tocar su prompt en el mismo cambio;
- mantener los compiladores, validadores y preflight actuales;
- no usar `previous_response_id`: Supabase sigue siendo la memoria autoritativa
  cross-channel y de replay;
- comparar Terra none/low contra el mismo corpus y baseline GPT-5.4;
- un planner candidato en shadow jamás ejecuta writes.

### Fase 5 — prosa final y costo por turno

- migrar respuesta y repair a Luna;
- mantener como máximo un repair;
- conservar el backstop de voz determinista;
- sacar el juez semántico de voz del camino crítico: muestreo/asíncrono/advisory,
  nunca veto sobre una respuesta financiera ya verificada;
- no hacer streaming de texto antes del finalizador determinista.

### Fase 6 — schemas/tools

- crear un schema interno independiente de los tipos Chat Completions;
- producir adaptadores Chat y Responses;
- normalizar opcionales/nulls antes de `strict: true`;
- validar cada propiedad publicada contra los accesos `args.X` y el writer;
- migrar onboarding antes de considerar cualquier tool loop general.

### Fase 7 — multimodal y audio

- visión/PDF por Responses, Terra primero;
- validar montos, monedas, fechas y entidades contra fixtures reales;
- migrar Whisper a `gpt-4o-transcribe` en cambio independiente;
- mantener TTS fuera del alcance mientras siga siendo sólo simulación.

### Fase 8 — canary y rollback

- flag por workload, no global;
- rollback a Chat/GPT-5.4 sin deploy de código;
- modelo candidato en shadow sólo para plan read-only;
- canary por usuarios internos antes de producción completa;
- no usar el alias `gpt-5.6`, que resuelve a Sol; configurar Terra/Luna de forma
  explícita.

## Validación obligatoria

1. Ninguna llamada OpenAI directa fuera del gateway.
2. Tests del mapping Responses: `output_text`, refusal, incomplete,
   function-call items, `call_id`, errores y reasoning items.
3. Validador de compatibilidad strict para todos los schemas.
4. Corpus de comportamiento, no de frases exactas: Diners conocida, devolución
   de 83.86, grupo parcial, corrección completa, no-action, redelivery,
   cross-channel, preguntas legítimas y hechos contradictorios.
5. Fixtures de imagen/PDF/audio con importes exactos y español LatAm.
6. Comparación de planner válido a primera muestra, repairs, acciones, receipts,
   costo, tokens, caché y latencia p50/p95.
7. Replay completo primero; una muestra live por candidato; sólo los dos mejores
   pasan al E2E; máximo dos rondas live bajo presupuesto explícito.

## Condición para retomar este plan

No iniciar mientras M0 esté activo. Retomar después de:

1. M0 cerrado sobre árbol congelado;
2. operaciones, planner y publicación estables;
3. baseline de comportamiento y costo guardado;
4. aprobación explícita para abrir una migración de API/modelos separada.

La primera entrega futura debe ser únicamente el gateway + medición + replay.
No debe cambiar ni el modelo ni el endpoint.
