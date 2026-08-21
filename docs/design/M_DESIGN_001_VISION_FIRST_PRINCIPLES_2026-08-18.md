# M_DESIGN_001 — Visión y first principles del rediseño (Bloque M)

- **Fecha:** 2026-08-18
- **Track:** M-diseño (paralelo a M0; research-only, cero código)
- **Estado:** PROPUESTA — contiene el veredicto sobre la arquitectura visual
  propuesta por el founder, los refinamientos recomendados y las decisiones
  abiertas D1–D7 que el founder debe tomar antes de M_DESIGN_002.
- **Entrada:** propuesta verbal del founder (orbe líquido + carrusel de capas +
  3 niveles verticales + dock de captura universal).

---

## 1. La tesis del producto aplicada a interfaz

Kipu es «un ChatGPT personal que ya sabe toda tu plata y puede actuar sobre
ella con seguridad». La interfaz mínima de ESE producto no es un dashboard:
es **un estado vivo + una conversación**. Todo lo demás es profundidad a
demanda.

El roadmap define el Bloque M exactamente así: *«las 7 superficies de detalle
ya existen contra el motor; lo que falta son las formas de entrar»*. La
arquitectura de 3 niveles propuesta por el founder **es la respuesta a "las
formas de entrar"**: un lugar para mirar (santuario), un lugar para hablar
(chat) y un lugar para entender (perspectiva). No es una ocurrencia estética;
es la forma natural del producto que ya construimos.

## 2. First principles (derivados del producto, no de la moda)

- **P1 · Presencia, no dashboard.** La pantalla default se diseña para una
  mirada de 3 segundos: un número, una sensación, una acción. Abrir Kipu debe
  sentirse como respirar, no como auditar. (Whoop/Oura/Calm operan así; la
  contabilidad queda en niveles profundos.)
- **P2 · El motor YA es un tanque — hay que renderizarlo.** El Saldo Kipu es
  literalmente un tanque: se rellena `fillDaily = libre/30`, tope 10 días de
  gustos, drenado por gustos reales, `saldo = min(tanque, calendario sin
  Reserva)`. La UI actual (quipu de nudos) dibuja un **símbolo**; el orbe con
  líquido dibuja el **modelo mental verdadero**. Éste es el argumento más
  fuerte a favor de la propuesta: no es decoración, es fidelidad semántica al
  motor.
- **P3 · La verdad manda también en píxeles.** Doctrina de los Bloques H/I/M0
  extendida a la capa visual: ningún nivel de líquido sin lectura publicable
  detrás («no pude leerte» ≠ «estás en cero» → orbe en niebla honesta); la
  animación de dinero sigue al **write verificado**, jamás a la esperanza
  (cero optimistic UI en dinero); mismos números en santuario, chat, ambient y
  dashboard (doctrina same-saldo).
- **P4 · Cero culpa en color y movimiento.** El aura nunca castiga; el rojo
  alarma no es un color ambiente; el cruce de capa es un momento de honestidad
  con calma («aviso siempre, bloqueo jamás»). La palabra «colchón» sigue
  prohibida.
- **P5 · Registrar debe ser más fácil que no registrar.** Captura a un toque
  desde la pantalla default; la recompensa inmediata es **ver la verdad
  moverse** (el nivel baja). El loop de hábito premia el registro, no el gasto.
- **P6 · Cada gesto tiene un doble visible.** NN/g: esconder la navegación
  recorta la descubribilidad ≈ a la mitad y baja la completitud de tareas
  (~21% con menús ocultos). Los swipes son atajos de poder; siempre existe un
  asa/botón tappable que hace lo mismo.
- **P7 · Gama media LatAm como presupuesto de rendimiento.** El público real
  usa Android de gama media/baja. La belleza degrada con gracia: física de
  líquido barata (canvas/SVG, onda senoidal), 60fps en un Moto G,
  `prefers-reduced-motion` de primera clase, batería respetada.
- **P8 · Una sola voz.** Todo texto vivo (pill, tips, módulos de perspectiva)
  lo redacta el agente desde hechos verificados — la misma maquinaria de
  grounding que M0 está cerrando. La interfaz es la cara del agente, no un
  segundo producto.

## 3. Veredicto sobre la propuesta del founder

**La arquitectura es correcta y hay que construirla.** Lo que sigue no cambia
la propuesta: la afina donde el concepto rozaba con el motor o con la física
de la plataforma.

### Lo más fuerte (por qué sí)

1. **El orbe es más fiel al motor que la UI actual.** (P2). El tanque existe
   desde el Bloque D y nunca lo dibujamos. El orbe convierte la mecánica
   estructural (rellenado diario, tope, drenaje) en experiencia física.
2. **Los 3 niveles mapean now/act/reflect con la ergonomía correcta.** El
   chat abajo (zona del pulgar: hablar es la acción más frecuente), la
   perspectiva arriba («levantar la vista para entender»), el presente en el
   centro. Tres pantallas es exactamente la cantidad de lugares que este
   producto necesita.
3. **Captura con feedback físico = el habit loop honesto.** Cue (abrir),
   acción (registrar por dock), recompensa (el líquido baja + recibo). La
   dopamina queda alineada con el comportamiento sano (registrar), no con
   gastar. Whoop retiene por cerrar el loop diario; Kipu puede hacerlo sin
   inventar un score.
4. **Timing cultural.** Apple hizo del vidrio líquido el lenguaje de la era
   (iOS 26 «Liquid Glass», 2025) y el orbe es hoy el significante universal de
   «aquí vive una IA» (Siri en iOS 27 es un orbe desde el Dynamic Island;
   ChatGPT/Gemini voice = orbes). Un orbe líquido financiero se siente 2026,
   no gimmick. **Riesgo gemelo:** genérico — se resuelve con identidad propia
   (§6) y con una lección que Apple pagó cara: la translucidez sobre texto
   destruyó legibilidad (backlash documentado por NN/g; Apple tuvo que añadir
   «Tinted», rollback en 26.2 y un slider en iOS 27). **Regla: el número del
   saldo jamás se apoya sobre vidrio refractivo.**

### Lo que se afina (los 6 refinamientos)

**R1 · El dock ES el chat colapsado — un continuo, no dos superficies.**
En Kipu, capturar ya es conversar (el agente es la puerta principal). El
santuario es, en rigor, el estado minimizado del chat: el input del dock es el
mismo input del nivel 2; swipe up / tap sólo lo expanden con historial
completo (multicanal — web y Telegram ya comparten `chat_messages`). Esto
elimina el riesgo de que «captura rápida» y «chat» se bifurquen en dos
experiencias que digan cosas distintas.

**R2 · El carrusel = exactamente las capas del motor (stocks, no flujos).**
La propuesta original mezclaba stocks (saldo, reserva, deuda) con un flujo
(«compromisos de pago»). Recomendación: el carrusel es la pila de capas del
producto puesta en horizontal — **Saldo · Reserva · Metas · Patrimonio ·
Deuda** — en ese orden, porque es el orden del cascade de drenaje. Bonus
enorme: la geometría del carrusel EXPLICA el aviso de cruce — cuando un gasto
va a comerse la Reserva, el líquido visualmente se drena hacia/desde la página
vecina. El gesto de deslizar enseña el modelo mental central del producto
(tu plata vive en capas; cruzar avisa, nunca bloquea).
«Compromisos» no desaparece: vive en la pill del santuario («Visa corta en 3
días») y como módulo de perspectiva. Si el founder quiere el orbe de
compromisos igualmente, la versión honesta es «% del mes ya cubierto»
(fijos+cuotas+tarjetas con caja apartada vs. total del mes) — un stock
derivado legítimo. Decisión abierta D3.

**R3 · Regla madre: todo orbe se llena hacia lo bueno.** Para que el lenguaje
visual sea consistente y cero-culpa, el llenado siempre representa progreso
deseable: Saldo lleno = margen hoy; Reserva llena = respaldo completo; Meta
llena = lograda; **Deuda llena = deuda SALDADA** (progreso de salida — el
orbe de deuda jamás muestra «cuánta deuda tienes» como líquido creciente).
Denominadores honestos por orbe (P3): Saldo → tope del tanque (con marca
sutil si el techo de calendario constriñe por debajo); Reserva → objetivo
declarado, y si no existe → cifra sin %, con invitación a definirlo por chat
(jamás un denominador inventado); Metas → meta principal; Deuda → total
conocido, y para revolvente → ciclo actual cubierto; cualquier lectura no
publicable → niebla.

**R4 · La materia es la liquidez.** Idea de sistema: el estado físico del
contenido de cada orbe comunica qué tan líquida es esa plata. Saldo = agua
viva (oleaje). Reserva = agua en calma. Metas = agua llenando una forma.
Patrimonio = **cristal/hielo** (no líquido: ES la definición de invertido).
Deuda = un vacío que se va llenando al saldar. Transferir entre capas =
cambios de estado (congelar/derretir). Esto convierte el truco visual en un
sistema semántico propio que ningún banco tiene.

**R5 · El orbe es el render del lifecycle de M0.** Estados de verdad:

| Estado | Visual | Regla |
|---|---|---|
| Disponible | nivel + respiración lenta (~6s, cadencia meditativa) | número siempre visible |
| Amanecer | al primer open del día (tz usuario): el rellenado diario sube visiblemente (+fillDaily) | el ritual de volver; recompensa sin culpa que el motor ya calcula y la UI nunca mostró |
| Capturando / pensando | ripple/shimmer — «te escuché» | el nivel NO baja; absorbe la latencia del agente con gracia |
| Escrito y verificado | el nivel baja con física satisfactoria + recibo en la cinta | mapea al post-write verification de M0; jamás antes |
| Necesita aclaración | la pill se convierte en la pregunta pendiente; tap → chat | el nivel conserva su verdad |
| Cruce de capa | el líquido se agota y se ve la capa siguiente absorber; aura transiciona al color de esa capa + copy sereno | EL momento emocional del producto, dramatizado con honestidad |
| Runway (sin ingreso activo) | modo runway explícito (días restantes) | semántica ya definida en Bloque D |
| No disponible (fail-closed) | niebla, sin líquido: «No puedo leer tu saldo ahora» | JAMÁS un nivel inventado ni un snapshot viejo como «ahora» |

**R6 · Perspectiva sin score (candado anti-Pulso).** «Estilo Whoop» = pocos
pilares, diales legibles y un coach que conecta los datos — NO un score
compuesto. Pulso Kipu (0–100) está retirado y no vuelve por ninguna puerta.
Cada módulo del nivel perspectiva responde una pregunta que un humano hace de
verdad (§7).

## 4. La arquitectura de 3 niveles (espacial)

```
        ┌─────────────────────────────┐
        │  NIVEL PERSPECTIVA (arriba) │  swipe down / tap asa superior
        │  «entender» — módulos       │
        ├─────────────────────────────┤
        │  SANTUARIO (centro/default) │  carrusel horizontal de capas
        │  orbe · monto · pill · cinta│  tap orbe → detalle de la capa
        ├─────────────────────────────┤
        │  NIVEL DIÁLOGO (abajo)      │  swipe up / tap input del dock
        │  chat completo multicanal   │  (bottom sheet; orbe desenfocado detrás)
        └─────────────────────────────┘
```

- La app abre **siempre** en el santuario, orbe Saldo (ancla diaria; el
  carrusel no recuerda posición entre sesiones — decisión D7 por confirmar).
- Perspectiva arriba / diálogo abajo: «levantar la vista para entender,
  bajar las manos para hablar». El dock queda en la zona natural del pulgar.
- **P6 aplicado:** asa visible arriba (pill/handle), dock visible abajo; ambos
  tappables. Los swipes son el atajo, nunca el único camino. Tap en el orbe =
  tercera vía (detalle de la capa activa).
- Jerarquía del santuario (constitución, §9): UN número, UNA frase (pill),
  UNA cinta (último registro), UN dock. Nada más. Nunca.

## 5. Nivel diálogo (chat + dock)

- El dock ofrece 4 modos: texto · voz · foto (tickets) · documento. **Realidad
  técnica:** hoy la captura es texto; voz/foto/doc son capacidades NUEVAS del
  agente (tools + ingestión multimodal) que pertenecen a fases posteriores del
  Bloque M o post-M. El diseño debe contemplar el dock completo desde el día 1
  (layout estable), pero la construcción llega por fases (decisión D5).
- Las preguntas del calendario universal (cortes, pagos, check-ins) y los
  challenges de M0 aterrizan aquí, como hoy; la pill del santuario es su
  preview (prioridad: pregunta pendiente > próximo compromiso > ritmo de
  objetivo > insight aprendido > educativo — una a la vez, rotación lenta,
  jamás trivia genérica sobre la cara del dinero).
- La cinta de último registro es un recibo vivo: tap → el hilo de esa
  operación en el chat (corrección/undo con la confirmación de segunda entrega
  que M0 ya construyó). La certeza de «quedó registrado» es parte del habit
  loop.

## 6. Identidad: el agua y el cordón (la síntesis orbe + quipu)

El orbe reemplaza al quipu de nudos como hero — pero retirar el quipu del todo
dejaría al producto llamado «Kipu» sin su razón gráfica, justo cuando el orbe
genérico de IA se vuelve commodity (Siri, ChatGPT, Gemini: todos orbes en
2026).

Síntesis propuesta: **el agua es tu presente; el cordón es tu historia.** El
khipu andino era literalmente un registro contable de cuerdas y nudos — un
ledger portátil. Kipu tiene un ledger append-only y snapshots diarios
(`saldo_kipu`). Aplicaciones concretas del cordón:

- Los indicadores del carrusel son **nudos en un cordón** (no dots).
- La curva histórica del saldo (nivel perspectiva) se dibuja como un **cordón
  anudado: un nudo por día** (desde `daily_financial_snapshots.saldo_kipu`),
  con huecos honestos si los hay.
- Registrar = «atar un nudo» (micro-animación del recibo en la cinta).
- Loading/transiciones = el cordón atándose.

Resultado: sistema gráfico propio (agua + cordón) que ningún competidor puede
copiar sin contar nuestra historia. Decisión abierta D2.

## 7. Nivel perspectiva (el «Whoop financiero» sin score)

Módulos como preguntas humanas — todos respaldados por motor existente, cero
conceptos nuevos, cero glosario:

| Pregunta | Módulo | Motor/superficie existente |
|---|---|---|
| ¿Cómo voy este mes? | Tu mes (plan vs real; aquí vive el Sankey) | `/app/mes` |
| ¿Cómo se ha movido mi saldo? | Cordón histórico (un nudo por día) | snapshot `saldo_kipu`, `/app/saldo` |
| ¿Qué se viene? | Lo que viene (calendario materializado: cortes, pagos, cobros) | Bloque C |
| ¿Cómo van comida y transporte? | Objetivos con señal de ritmo pre-cruce («a este ritmo lo cruzas el 24») | Bloque H, `/app/spending` |
| ¿Dónde está mi plata? | Cuentas / Tesorería (recommend-only; silencioso mono-cuenta) | Bloque F, `/app/cuentas` |
| ¿Cómo van deuda y metas? | Progresos (salida de deuda; meta principal) | `/app/debt`, `/app/goals` |

- Cada módulo abre su superficie de detalle ya construida: la perspectiva es
  **la puerta** que a `/app/spending`, `/app/debt` y `/app/wealth` siempre les
  faltó (hallazgo viejo del next-block-map).
- El copy de cada módulo lo redacta el agente desde hechos verificados (P8),
  con los mismos números del santuario.
- Referencia estructural: el home de Whoop 2025-26 pone 3 diales al frente
  (Sleep/Recovery/Strain) y un coach IA que conecta los datos. Kipu: pocos
  pilares, diales honestos, la voz del agente — sin score compuesto (R6).

## 8. Mapa de superficies actuales → nuevo modelo

Inventario real de rutas (`src/app/app/*`) y su destino, para que nada quede
huérfano:

| Ruta actual | Destino en el nuevo modelo |
|---|---|
| `/app` (home Principal+Secundario) | Se disuelve: hero → santuario; tarjetas secundarias → módulos de perspectiva |
| `/app/saldo` | Detalle del orbe Saldo (tap en el orbe) — capas + recibo de flujo + historia |
| `/app/cuentas` | Detalle «¿Dónde está mi plata?» (desde perspectiva) |
| `/app/chat` | Nivel diálogo |
| `/app/mes` | Módulo «Tu mes» |
| `/app/spending` | Detalle de objetivos/gasto |
| `/app/debt` | Detalle del orbe Deuda |
| `/app/wealth` | Detalle del orbe Patrimonio |
| `/app/goals` | Detalle del orbe Metas |
| `/app/activity` | Historial: dentro del diálogo o como detalle de la cinta (decidir en M_DESIGN_004) |
| `/app/cashflow` | Absorbido por «Tu mes» / «Lo que viene» (decidir) |
| `/app/household` | Detalle desde perspectiva (hogar) — prioridad baja (Bloque L sigue sin construirse) |
| `/app/fx` | Utilitario dentro de Mis Datos/ajustes |
| `/app/kipu-fit` | Revisar qué es hoy y si sobrevive (inventario en M_DESIGN_004) |
| `/app/mis-datos`, `/app/settings` | «Tu Kipu» (datos + ajustes), acceso discreto desde perspectiva |
| `/app/margen`, `/app/readiness`, `/app/precision`, `/app/reality` | Siguen siendo redirects; ninguna resurrección |
| `/onboarding` | Wizard actual se mantiene; re-vestido al final del Bloque M (D6); onboarding conversacional = ambición post-M |
| `/dev/*` | Intactos (QA) |

## 9. Plataforma, gestos y rendimiento (realidad técnica)

- **Hoy:** Next.js web (mobile-first) + Telegram. La visión gestual apunta a
  app instalada. **Recomendación (D1): diseñar para PWA instalada primero**,
  degradando con gracia en pestaña de browser; Capacitor como envoltura
  futura si se quieren stores/haptics/push nativo — no un rewrite nativo.
- **Conflictos de gesto concretos:**
  - swipe-down (perspectiva) vs pull-to-refresh del browser → en PWA
    standalone se controla (`overscroll-behavior`); en pestaña Safari hay
    rubber-band → umbral de gesto + asa tappable como camino primario.
  - swipe-up vs gesto home de iOS → el dock no puede vivir pegado al borde
    inferior; respetar safe-area; el gesto de expandir chat parte del dock,
    no del edge.
- **Presupuesto de animación:** líquido con canvas/SVG (onda senoidal +
  gradiente; sin WebGL ni refracción en v1); 60fps en Android de gama media;
  `prefers-reduced-motion` → nivel estático con transiciones de opacidad;
  el aura ambient es un gradiente animado barato, no un shader.
- **Temas:** el dual theme existente (claro/oscuro) se conserva; decidir cuál
  es el «hero» de marketing en M_DESIGN_002.
- **Accesibilidad:** el líquido es codificación redundante — el número siempre
  está; contraste AA sobre aura en ambos temas; VoiceOver: «Saldo disponible:
  82 dólares, tanque al 64 por ciento». Reglas de dinero existentes: signo
  después del número («25$»), dos decimales sólo si hay centavos.

## 10. Constitución inicial (reglas duras del rediseño)

1. El santuario tiene UN número, UNA frase, UNA cinta, UN dock. Toda feature
   nueva nace en perspectiva o en el chat — el santuario no acumula.
2. Ningún nivel de líquido sin lectura publicable detrás (niebla honesta).
3. La animación de dinero sigue al recibo verificado, jamás a la esperanza.
4. Cada gesto tiene un doble visible y tappable.
5. Cero score compuesto; cero resurrección de conceptos retirados (Pulso,
   Margen-marca, Flexibilidad/Precisión/Realidad, estados nombrados).
6. El texto vivo lo escribe el agente desde hechos verificados; mismos números
   que el resto del producto.
7. El número del saldo jamás se apoya sobre vidrio refractivo/translúcido que
   comprometa contraste (lección Liquid Glass).
8. Presupuesto gama media; `reduced-motion` de primera clase.
9. «Colchón» sigue prohibido; la capa protegida se llama Reserva.
10. Consumer-facing siempre «Kipu» (jamás FinCoach/Kipu X).

## 11. Plan del track

| Fase | Entregable | Estado |
|---|---|---|
| M-D1 | Visión + first principles + decisiones abiertas (este doc) | ✅ 2026-08-18 |
| M-D2 | Constitución formal + tokens (color por capa, tipografía, motion, dark/light) | pendiente |
| M-D3 | Spec del orbe: máquina de estados completa, física, semántica por capa, edge cases (runway, negativo, cruce, multi-moneda, niebla) | pendiente |
| M-D4 | Mapa IA completo + wireframes de los 3 niveles + flujos clave (capturar, corregir, resolver pregunta de calendario, cruce de capa) + inventario definitivo de superficies | pendiente |
| M-D5 | Spec del nivel perspectiva + sistema de copy del agente en superficies | pendiente |
| M-D6 | Prototipo interactivo aislado (fuera de `src/`; artifact o `prototypes/`) para sentir orbe + gestos — requiere autorización explícita del founder | pendiente |
| M-D7 | Handoff spec de implementación (post-cierre de M0) | pendiente |

## 12. Decisiones abiertas para el founder (D1–D7)

1. **D1 · Plataforma target:** ¿PWA instalada first (recomendado) o ambición
   Capacitor/nativa incorporada al diseño desde ya?
2. **D2 · Identidad:** ¿síntesis «agua = presente / cordón-quipu = historia»
   (recomendado) o el quipu se retira por completo?
3. **D3 · Carrusel v1:** ¿capas puras del motor — Saldo · Reserva · Metas ·
   Patrimonio · Deuda — con Compromisos en pill + perspectiva (recomendado),
   o se incluye un sexto orbe «Compromisos: % del mes cubierto»?
4. **D4 · Candado anti-score:** ¿confirmas cero score compuesto en
   perspectiva?
5. **D5 · Dock v1:** ¿los 4 modos visibles desde el día 1 (voz/foto/doc
   honestamente «pronto») o texto primero y el dock crece?
6. **D6 · Onboarding:** ¿entra al scope de M (re-vestir el wizard) o queda
   intocado?
7. **D7 · Apertura:** ¿la app abre siempre en el orbe Saldo (recomendado) o
   recuerda la última capa vista?

## 13. Referencias

- NN/g — [Liquid Glass Is Cracked, and Usability Suffers in iOS 26](https://www.nngroup.com/articles/liquid-glass/) (translucidez vs legibilidad).
- TechCrunch — [iOS 26.2 permite revertir Liquid Glass en el Lock Screen](https://techcrunch.com/2025/12/12/with-ios-26-2-apple-lets-you-roll-back-liquid-glass-again-this-time-on-the-lock-screen/); [iOS 27 añadió slider de translucidez](https://www.bgr.com/2191219/ios-27-liquid-glass-fix-customization/).
- NN/g — [Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/) y [Basic Patterns for Mobile Navigation](https://www.nngroup.com/articles/mobile-navigation-patterns/) (gestos ocultos → dobles visibles).
- Whoop — [The All-New WHOOP Home Screen](https://www.whoop.com/us/en/thelocker/the-all-new-whoop-home-screen/) y [2026 What's New](https://www.whoop.com/us/en/thelocker/2026-whats-new/) (pilares + diales + coach IA; referencia de estructura, no de score).
- MacRumors — [Siri chatbot / orbe en iOS 27](https://www.macrumors.com/guide/siri-chatbot/) (el orbe como significante universal de IA en 2026 → riesgo de genericidad, resuelto con agua+cordón).
