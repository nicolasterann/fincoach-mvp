# M_DESIGN_003 — Auditoría de pre-implementación del rediseño (Bloque M)

- **Fecha:** 2026-08-24 (día del cierre de M0; Bloque M activo y desbloqueado)
- **Track:** M-diseño — este doc abre la fase de implementación del Bloque M
- **Estado:** AUDITORÍA COMPLETA — veredicto + plan propuesto, pendiente de
  discusión con el founder. Los specs por stage para Codex serán
  `M_DESIGN_004+` después de aprobar el plan.
- **Entrada:** M_DESIGN_001 (visión y first principles), M_DESIGN_002
  (decisiones D1–D7 + iteraciones v2–v5 del mock), `prototypes/orbe-kipu.html`
  (v5, recorrido interactivo completo), y el código real en `cd430f8`
  (inventario integral del front + trazado motor↔UI, 2 barridos independientes).

---

## 1. Veredicto

**La propuesta documentada es correcta y hay que construirla. Se retoma desde
ahí, sin cambios de arquitectura.** Orbe líquido + 3 niveles + carrusel de
capas + dock universal no es una capa de pintura: es la primera interfaz que
dice la verdad sobre lo que el producto ya es por dentro. El motor ES un
tanque (`tank`, `cap`, `fillDaily` son campos reales del tipo `SaldoKipu`,
serializables tal cual hacia el cliente); el cerebro ES una conversación con
recibos verificados; la doctrina ES «no pude leer ≠ cero» (niebla). El front
actual no renderiza ninguna de esas tres verdades; el mock v5 renderiza las
tres.

Matices del veredicto:

1. **No hay sobreoptimización en la arquitectura.** 3 niveles + 5 orbes + 1
   dock REEMPLAZA una superficie hoy más compleja (18 páginas, 5 pestañas,
   home de hasta 10 tarjetas). Es una simplificación, no un adorno.
2. **Sí hay riesgo de sobre-pulido, y está localizado:** la carrera del shader
   (v2–v5: raymarching, cáusticas, facetas iluminadas, aura de dos capas). El
   mock ya probó el techo visual; la v1 del código real necesita «líquido
   creíble», no paridad pixel-perfect. Se gestiona con presupuesto de
   rendimiento y time-box por stage, no recortando la visión.
3. **La propuesta subestima ~la mitad del trabajo real.** El nivel diálogo
   está mucho más lejos del mock de lo que los docs asumen (§3), y re-vestir
   las superficies de detalle es el volumen oculto del bloque (§2.7).
4. **Siete supuestos factuales de M_DESIGN_001/002 no se sostienen contra el
   código** y deben corregirse antes de especificar stages (§3). Ninguno
   invalida el diseño; todos cambian el tamaño o el orden de algún stage.

---

## 2. El front actual, medido (por qué quedó viejo — con hechos)

Inventario completo verificado sobre `cd430f8`. Lo esencial:

1. **No es chat-first.** `AppNav.tsx` declara el modelo mental viejo
   («dashboard = feed, chat = DMs»): login aterriza en `/app`, el chat es la
   pestaña del medio entre cinco, y la captura vive a un tap + un teclado de
   distancia. Para un coach cuya puerta principal es la conversación, la
   relación está invertida.
2. **El chat no puede expresar al agente.** `ChatView` renderiza texto plano:
   sin streaming, sin markdown, sin tarjetas, sin recibos, sin affordance de
   confirmación. `ChatResponse.status` (success / needs_clarification /
   unsupported / failed) se DESCARTA en la UI; todo llega como burbuja gris.
   La parte más rica del producto tiene la interfaz más pobre.
3. **Las puertas del roadmap siguen sin existir.** `/app/debt` y `/app/wealth`
   tienen CERO links entrantes en toda la app; `/app/spending` solo es
   alcanzable por el redirect retirado `/app/reality`. Tres páginas de
   250–430 líneas construidas contra el motor, efectivamente sin publicar.
   La pila de capas completa se renderiza en UN solo lugar (`/app/saldo`).
4. **El framing semanal retirado sigue siendo héroe en páginas hermanas.** El
   hero de `/app/spending` es «Tu semana»; `/app/goals` habla en `/semana`;
   el chip de sugerencia del chat pregunta «¿Cómo voy esta semana?».
5. **Costuras de identidad.** El landing de marketing vende un ANILLO («Tu
   Saldo Kipu» al 62%) que no existe en la app; el skeleton de carga del home
   (`DashboardSkeleton`) todavía dibuja el dashboard RETIRADO de anillo + 6
   métricas; el onboarding es un mundo de 7 tintes que no comparte lenguaje
   con la app a la que desemboca. Las tres primeras superficies que ve un
   usuario nuevo parecen tres productos distintos.
6. **PWA aspiracional.** Manifest, share_target y shortcuts existen; pero un
   solo ícono SVG sin variantes 192/512/maskable, cero service worker,
   `themeColor` solo oscuro y safe-areas en exactamente dos call sites. La
   decisión D1 (PWA-first) hoy no está honrada por la implementación.
7. **La coherencia interna de `/app/*` es buena** (MetricShell + Section +
   PressCard, paleta semántica estable, 12 keyframes con reduced-motion
   completo, dual theme por inversión de escalas en `globals.css`) — pero la
   densidad contradice la tesis: hasta 10 tarjetas tras el hero, y páginas de
   detalle con 3–4 vocabularios de color simultáneos y párrafos explicativos
   en `text-xs`. Mucho leer para un producto cuya promesa es «no tienes que
   recalcular nada». **Este sistema viejo es lo que hay que re-vestir en ~10
   superficies que sobreviven como destinos** — el volumen oculto del bloque.
8. **El front está congelado a propósito desde julio** («primero el back»):
   los últimos 15 commits solo tocan `/dev/capture-test`. El estado
   intermedio era conocido y asumido; esta auditoría solo lo dimensiona.

Lo que SÍ está sano y el rediseño hereda gratis: doctrina same-saldo cableada
(10 superficies citan `margenKipu.saldo` del mismo builder), RSC puro en todas
las páginas (el shell nuevo será la PRIMERA isla cliente del dashboard, con
frontera limpia), theming por tokens con dual theme funcional, motion system
con reduced-motion de primera clase, y `/dev/ui-preview` como patrón de
harness visual con estados sintéticos.

---

## 3. Correcciones factuales a M_DESIGN_001/002 (el código contradice 7 supuestos)

Ninguna invalida el diseño. Todas cambian el tamaño o el orden de un stage.

| # | El doc asume | El código dice | Consecuencia |
|---|---|---|---|
| C1 | R1: «multicanal — web y Telegram ya comparten `chat_messages`»; el mock dice «aquí también llega lo de Telegram» | La TABLA es compartida; la LECTURA no: `getChatHistory` filtra `channel="web"` y los turnos de Telegram jamás se renderizan en web. Solo `/dev/chat-review` muestra el feed unificado | El chat multicanal del nivel diálogo es trabajo NUEVO de contrato de lectura (orden, dedupe, procedencia — `turnAuthor()` ya existe y distingue usuario/agente/calendario/coach) |
| C2 | La cinta y los recibos del mock («Saldo: 86,90$ → 82,40$») solo «renderizan» datos que ya existen | El dato existe y está verificado (M0), pero `financialWriteReceipt` está documentado como «never rendered to the user» y el manifiesto durable jamás cruza al view layer | Hay que construir el puente recibo→UI por primera vez. Es EL entregable del nivel diálogo, no un detalle |
| C3 | La pill muestra «pregunta pendiente» como preview del chat | `agent_action_challenges` tiene grant SELECT a `authenticated` y CERO consumidores de UI; las preguntas del calendario viven en ocurrencias sin superficie web | La fuente de lectura de la pill hay que cablearla; hoy no existe ningún lector web de pendientes |
| C4 | (implícito) el digest del calendario ya llega al chat web | **BUG real encontrado:** `kipu_publish_calendar_digest` inserta la copia web con `chat_id = NULL` y el chat web filtra `.eq("chat_id", userId)` — esa fila es INVISIBLE desde siempre; solo la copia Telegram se ve | Arreglarlo es prerequisito de la pill/feed. Dos vías: leer también las filas propias con `chat_id NULL` (fix de lectura, sin migración) o estampar `chat_id` en la RPC (migración 125, DDL a mano del founder). Decidir en el spec del stage |
| C5 | D3: el desglose por nombre del orbe Metas «verificar que las tres fuentes exponen nombre» | Confirmado el hueco: `SaldoLayer` lleva solo `kind/label/amount`. Los nombres viven en `goalsIntel.portfolio.goals`, planes de ahorro e inversión — hace falta el join en el payload del detalle | Trabajo menor y acotado, como 002 anticipó; ahora está confirmado y dimensionado |
| C6 | R5/P3: la niebla se activa «sin lectura publicable» | El flag `saldoStale` existe en el tipo pero NUNCA se asigna; el fail-closed real es `KipuSaldoUnavailableError` lanzado desde coaching-signals | La niebla del orbe se mapea a capturar ese error en el loader del shell, no a un flag. Limpiar `saldoStale` muerto al pasar |
| C7 | D5: voz/foto «no es capacidad nueva, es UI sobre un pipeline que ya existe» | Cierto para FOTO (attach web ya acepta jpeg/png/webp/pdf → `sendWebEvidenceAction`) y cierto para el CEREBRO; pero el action web NO acepta audio — la nota de voz solo entra por Telegram | La puerta web de voz = MediaRecorder + ampliar el action a audio + rutear a la transcripción existente. Acotado pero real; stage propio |

Además, del trazado motor↔UI, tres hechos que los specs por stage deben
respetar:

- **Rendimiento:** `buildCoachingBriefing` es la llamada más pesada del
  producto (11 lecturas paralelas + Promise.all de 12 + TRES calendarios
  completos) y además ESCRIBE al leer (snapshot diario). El shell de 3
  niveles debe hidratarse de UNA lectura compartida por carga (el seam
  `buildCoachingBriefingWith` existe), jamás una por nivel/orbe.
- **Gates:** `/dev/capture-test` (826 aserciones) clava con anchors literales
  el JSX del retry de `ChatView`, `mis-datos` y el save path del onboarding.
  El hero, `/app`, saldo/cuentas y `living/*` están LIBRES. Reconstruir el
  chat obliga a actualizar esos anchors como parte del stage, no a
  descubrirlo a mitad.
- **El cruce de capa ya es un hecho del motor** (`planWithdrawal` →
  `layerCrossed: none|reserva|beyond_reserva`; `evaluate_purchase` lo narra)
  — pero no existe UI de cruce. La dramatización del carrusel consume ese
  hecho, no lo inventa.

---

## 4. Análisis first principles desde el usuario

**La mirada de 3 segundos.** Hoy: saludo + hero + hasta 9 tarjetas con
chevron. Mock: UN número («82,40$ · Disponible hoy»), una frase, un recibo, un
input. Para la pregunta diaria real del usuario objetivo («¿puedo gastar hoy
sin romper nada?») el santuario responde en un vistazo; el home actual
responde con una página que hay que leer. Ventaja clara del rediseño.

**Usuario nuevo, primeras 48 horas.** Fortalezas: la comprensión del número
es inmediata; el carrusel enseña el modelo de capas por gesto periférico sin
costo de atención; D7 (abrir en la capa donde vives, con histéresis) convierte
la apertura en información. Riesgos reales a cubrir en specs:

- «Disponible hoy» NO es el saldo del banco. El onboarding ya construye el
  puente («por qué es menor que tu cuenta»); el santuario necesita que ese
  puente aterrice — recomendación: el PRIMER amanecer incluye una línea de
  Kipu explicando el tanque una sola vez (momento, no tutorial).
- Estados día-1 por orbe sin spec: Metas sin metas, Deuda sin deudas,
  Patrimonio en cero. Recomendación: vacío-limpio + invitación por chat
  (nunca un denominador inventado, nunca un orbe celebrando de mentira).
  Reserva sin objetivo ya está definido (cifra sin %, invitación).
- Gestos: P6 (asa arriba, dock abajo, tabs de capas tappables) está bien
  resuelto en el mock — verificado en el recorrido. Sin cambios.

**¿Resuelve los pain points reales?** Mapeo contra el target (18–35 LatAm,
quiere ahorrar para una meta concreta sin dejar de vivir):

| Pain point | Respuesta del rediseño | Estado |
|---|---|---|
| «¿Puedo gastar hoy?» | El orbe Saldo — el tanque renderizado | Resuelto por diseño |
| Registrar da pereza | Dock omnipresente + voz + cámara + recompensa física (nivel baja + recibo) | Resuelto; voz = stage propio (C7) |
| Culpa / miedo a abrir la app | Cero rojo ambiente, cruce con calma, amanecer como ritual de retorno | Resuelto por doctrina |
| «¿Dónde se me fue la plata?» | Perspectiva: Tu mes + cordón 18 días + objetivos | Resuelto |
| Compromisos que se olvidan | Pill (corta en 3 días) + Lo que viene | Resuelto — depende de C3/C4 |
| **El sueño (Brasil, el depa)** | Orbe Metas = «por aportar este mes» + progresos en perspectiva | **Débil — ver abajo** |

**El hallazgo de producto de esta auditoría: el sueño queda a dos gestos.** El
caso de uso inicial del spec es «ahorrar para una meta concreta»; el driver
emocional de retención es la meta CON NOMBRE. En el modelo nuevo, el orbe
Metas (correctamente) muestra el dato del ciclo («260$ · Por aportar este
mes») y el progreso de la meta vive en perspectiva o en el detalle. Nada de
la estructura cambia, pero el CONTENIDO debe traer el sueño al frente:
la rotación de la pill incluye hitos de meta («Brasil pasó el 60%»), el
detalle del orbe Metas ABRE con la meta principal nombrada y su progreso, y
el amanecer celebra hitos cuando los hay. Costo cero en arquitectura, alto en
retención.

**Deuda: el número y el líquido miden cosas opuestas.** Verificado en el mock:
orbe ámbar lleno ~78% (progreso de salida, regla R3) con «760$ · Te falta
pagar» debajo. Un usuario nuevo lee «esfera llena de deuda». R3 es correcta
(jamás dibujar la deuda como líquido creciente); falta que el texto cargue la
lectura: subtítulo doble — **«Ya saldaste 62% · te faltan 760$»** — y regla
escrita en el spec del orbe. Es la única capa donde cifra y nivel no son la
misma magnitud; con una línea se resuelve.

**Anillos de HOY: excepción documentada, no inconsistencia.** Los orbes se
llenan hacia lo bueno; los anillos de HOY se llenan hacia el consumo (74% del
ritmo de hoy usado) con el color cargando el juicio (verde/ámbar/coral). Es la
gramática Whoop correcta («estado dentro de un ciclo»), pero el spec debe
declararla excepción explícita de la regla madre para que ningún implementador
la «corrija» hacia el lado equivocado.

**¿Sobreoptimización?** La arquitectura no: reduce superficies, pestañas y
densidad. El punto de vigilancia es el shader (v2–v5 ya viven en raymarching
con cáusticas y facetas con normal propia). Regla propuesta para
implementación: la v1 de producción usa el shader del mock (WebGL1, cero
dependencias — verificado: `getContext("webgl")`, sin libs externas) con
presupuesto medido en un Android de gama media, fallback estático honesto
(nivel plano canvas/SVG + número) por capability check, y
`prefers-reduced-motion` como camino de primera clase. Cáusticas, motas y
deriva son lo primero que se degrada. El mock es el techo, no la vara de
aceptación.

**Tipografía — una corrección al mock:** v2 retiró `ui-rounded` y adoptó
SF Pro Display. SF Pro NO existe en Android (caería a Roboto: dos productos
distintos justo en el público objetivo). La app ya carga Geist Sans/Mono con
`tabular-nums`; la recomendación es quedarse con Geist (tracking cerrado para
cifras grandes, Geist Mono como voz del ledger en recibos) — consistencia
cross-platform gratis y cero fuentes nuevas.

---

## 5. Decisiones nuevas para el founder (D8–D14)

Las D1–D7 siguen resueltas. Esta auditoría abre siete más, todas con
recomendación:

- **D8 · Deuda, subtítulo doble** («Ya saldaste X% · te faltan Y$») —
  recomendado sí.
- **D9 · El sueño al frente** (pill con hitos de meta; detalle de Metas abre
  con la meta principal nombrada) — recomendado sí.
- **D10 · Convivencia y rollback:** construir el shell nuevo detrás de un
  flag de entorno (patrón espejo de `KIPU_AGENT_MODE`: el founder usa el
  front nuevo en producción, rollback instantáneo al viejo), y borrar el
  shell viejo en el stage de cierre — recomendado, es el patrón que este
  proyecto ya confía.
- **D11 · Desktop v1:** columna centrada tipo teléfono (el sidebar muere con
  el shell viejo); un desktop propio es post-M — recomendado.
- **D12 · Tipografía:** Geist se queda (razón Android, §4) — recomendado.
- **D13 · Toggle de moneda display (multi-moneda):** vive en el detalle de
  capa + Tu Kipu; el santuario siempre en la moneda elegida, jamás dos cifras
  — recomendado.
- **D14 · Streaming del chat:** NO en v1. El estado «pensando» del orbe/aura
  absorbe la latencia con más gracia que un token-stream, y el loop de tools
  no streamea limpio por naturaleza (la respuesta nace después de los
  writes). Reevaluar post-M — recomendado.

Notas sin decisión (quedan registradas): push web no entra en M (Telegram
sigue siendo el canal proactivo; la pill cubre in-app); el cron
`scheduled-payments` no está en `vercel.json` (fuera de alcance de M, se
reporta); `GoalPlanCard` es código muerto (se borra en el cierre).

---

## 6. Plan de stages propuesto (M1–M9)

Principios del plan: valor primero (santuario + diálogo son el loop diario),
riesgo temprano (shader y rendimiento se prueban en M2, no en M8), las
puertas del roadmap se cierran en M6, el volumen de re-vestir va después de
que el corazón lata, y el borrado del shell viejo es el último acto (patrón
M0). Cada stage: spec propio (`M_DESIGN_004+`), Codex implementa, Claude
audita, gates verdes SIEMPRE (lint · build · capture 826 · TEST_SCRIPTS por
comportamiento), cero migraciones salvo la posible 125 de C4.

| Stage | Alcance | Sale con |
|---|---|---|
| **M1 · Cimientos** | Tokens formales (color por capa + semáforo `--good/--watch/--over` + tipografía + motion) en `globals.css`; flag de convivencia (D10); shell de 3 niveles con gestos + asas (P6) y carrusel estructural con orbe ESTÁTICO honesto; apertura D7 con histéresis; UNA lectura compartida (`buildCoachingBriefingWith`) hidrata todo el shell | El esqueleto navegable del producto nuevo, con números reales, sin shader |
| **M2 · El orbe vivo** | Shader WebGL1 del mock portado (un shader, uniforms por capa: agua viva/calma/molde/cristal/ámbar); máquina de estados completa (disponible · amanecer · capturando · escrito · cruce · niebla · runway · vacío-día-1); fallback estático por capability + reduced-motion; presupuesto medido en Android de gama media; harness `/dev/orb-preview` con estados sintéticos (patrón ui-preview) | El corazón del producto, con la verdad de C6 (niebla = error real) |
| **M3 · Diálogo I — la conversación de verdad** | Reconstruir `ChatView`: recibos estructurados al view layer (C2), render status-aware (fin del descarte de `ChatResponse.status`), lectura multicanal web+Telegram con procedencia y dedupe (C1), fix del bug del digest (C4), cinta→hilo de operación, anchors del gate actualizados en el mismo stage | El chat que por fin expresa al agente |
| **M4 · Dock + pill** | Dock texto+cámara (attach existente re-vestido); pill con prioridad (pregunta pendiente > compromiso > ritmo > insight) y caja fija v4; lector web de pendientes (C3); cinta con estructura de recibo v4 | El santuario completo de contenido |
| **M5 · Voz + aura** | Puerta web de audio (MediaRecorder → action ampliado → transcripción existente, C7); aura con `uVoice` ligado al ciclo REAL del agente (escuchando/pensando/respondiendo); micrófono con fallback honesto | El alma, conectada al cerebro de verdad |
| **M6 · Perspectiva** | Módulos desde el payload compartido: HOY (3 anillos iguales) · Tu mes (barra apilada) · cordón 18 días (desde snapshot `saldo_kipu`, huecos honestos) · Tus progresos (barras) · Lo que viene (calendario); cada módulo ES la puerta a su detalle — cierra el hallazgo de las puertas del roadmap | spending/debt/wealth por fin alcanzables |
| **M7 · Re-vestir los detalles** | Las superficies que sobreviven, al sistema nuevo: saldo (detalle del orbe), cuentas, mes, spending (matar «Tu semana»), debt, wealth, goals (matar `/semana`), Tu Kipu (settings+kipu-fit), mis-datos, fx, household; absorber cashflow/activity como destinos; join de nombres del orbe Metas (C5) | Un solo producto, sin costuras |
| **M8 · PWA + pulido** | Iconos 192/512/maskable, SW mínimo, `themeColor` por tema, safe-areas completas, skeletons nuevos (matar `DashboardSkeleton` retirado), landing de marketing al orbe (matar el anillo), modo día completo | La D1 honrada de verdad |
| **M9 · Cierre** | Borrar shell viejo + flag + `AppNav`/`PARENT_TAB` + código muerto; barrido final de framing semanal y vocabulario; batería E2E de comportamiento + red team visual; actualizar PRODUCT_SPEC (la IA de 4 pestañas deja de ser verdad) y TEST_SCRIPTS | Bloque M cerrado al estándar de la casa |

Dependencias duras: M1→M2→(M3‖M4)→M5; M6 tras M1 (puede solaparse con M3–M5);
M7 tras M6; M8–M9 al final. El founder vive en el front nuevo desde M1 vía
flag; nada se borra hasta M9.

---

## 7. Reglas de auditoría por stage (cómo audito a Codex)

1. **Same-saldo:** toda cifra del shell sale del payload del briefing; PROHIBIDO
   recalcular dinero en el cliente (la excepción viva `MesRedistribute` se
   revisa en M7). Verificación por lectura de código + prueba de paridad
   chat↔santuario.
2. **Verdad visual:** ningún nivel sin lectura publicable (niebla = capturar
   `KipuSaldoUnavailableError`); la animación de dinero SIGUE al recibo
   verificado (cero optimistic UI en dinero); el número jamás sobre vidrio
   refractivo.
3. **Gates verdes por stage** (lint, build, capture 826 con anchors
   actualizados donde el stage los toque) + TEST_SCRIPTS de comportamiento
   actualizado en el mismo stage que cambia el comportamiento.
4. **Presupuesto de rendimiento:** M2 define el número (fps en gama media,
   memoria, batería en 10 min de santuario); los stages posteriores no lo
   degradan.
5. **Accesibilidad:** AA en ambos temas, VoiceOver por estado del orbe,
   reduced-motion recorrido completo.
6. **Constitución de M_DESIGN_001 §10** como checklist literal de cada
   auditoría (UN número/UNA frase/UNA cinta/UN dock; cero scores; cero
   resurrecciones; «colchón» prohibido; Kipu siempre).

---

## 8. Párrafo no técnico (para el founder)

Estudié el producto entero: lo que está hoy en producción, la propuesta del
orbe que documentamos, y cómo se conectan por dentro. Mi conclusión es que la
propuesta no es un capricho estético: es la primera vez que la cara del
producto cuenta la misma historia que el interior. Hoy Kipu por dentro es un
tanque que se rellena cada mañana, un coach que ejecuta con recibos, y una
regla de honestidad que prefiere decir «no pude leerte» antes que inventar un
número — pero la pantalla actual muestra tarjetas de resumen, esconde tres
secciones enteras que ya construimos (nadie puede llegar a Deuda, Patrimonio
ni Gasto: no tienen puerta), y trata la conversación — nuestra alma — como
una pestaña más con burbujas de texto plano. El rediseño arregla exactamente
eso: abres y ves UNA cosa (cuánto puedes gastar hoy, como agua en una
esfera), hablas desde cualquier lugar, y todo lo demás está a un gesto. En el
camino encontré detalles que nos van a ahorrar sorpresas: el chat web hoy no
muestra lo que escribes por Telegram (hay que construirlo, no «ya está»), un
aviso del calendario se estaba guardando en un lugar donde la app jamás lo
lee (bug real, ya ubicado), la esfera de Deuda necesita una línea de texto
para que «lleno» se lea como «casi libre de deuda» y no como «lleno de
deuda», y tu sueño — la meta con nombre, el viaje, el depa — merece estar en
la primera pantalla y no a dos gestos de distancia. Nada de esto cambia la
propuesta: la confirma, la dimensiona honestamente, y la deja lista para
construirla por etapas sin apagar la app ni un día.
