// Bloque N3C ronda 6 — EL FLUIDO. Lo que mueve el color de verdad.
//
// ── ATRIBUCIÓN (obligatoria, no decorativa) ──────────────────────────────────
// El algoritmo y las constantes de este archivo derivan de
//   WebGL-Fluid-Simulation — https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
//   MIT License · Copyright (c) 2017 Pavel Dobryakov
// Verificado en la ronda 12: los diez uniformes que capturé del orbe VIVO de
// ElevenLabs (uCurl, uPressure, uDivergence, uVelocity, uSource, curl,
// vorticity, aspectRatio, dissipation, texelSize) están todos en ese repo. El
// suyo deriva del mismo original que el nuestro. No hay que descifrar el de
// ellos: hay que leer el original, que es público, completo y MIT.
//
// POR QUÉ EXISTE, Y POR QUÉ NINGÚN AJUSTE DE RUIDO PODÍA REEMPLAZARLO.
//
// Cinco rondas ajustando un campo de ruido y el founder dijo lo mismo las cinco
// veces: «una capa que pasa». Tenía razón, y la razón es estructural. Un campo
// de ruido sólo sabe hacer dos cosas — quedarse quieto o desplazarse — y las dos
// se leen como transporte. No hay parámetro que arregle eso.
//
// Después capturé el shader de su página (enganchando `shaderSource` con la
// pestaña al frente, que es cuando el navegador compone cuadros) y apareció lo
// que faltaba. Su orbe declara `uFluidSimTexture`, y los shaders chicos que lo
// acompañan son, uno por uno, el solver clásico de Navier-Stokes en GPU:
// salpicadura con `point`/`radius`/`color`/`audioAverage`, divergencia, curl y
// vorticidad, presión por Jacobi, resta del gradiente y advección.
//
// Un fluido no se desplaza: ADVECTA. Se enrosca sobre sí mismo, no repite, y
// cuando lo empujás la perturbación se propaga sola y se disipa. Eso es
// exactamente «se mueve todo el tiempo», «bordea la esfera» y «responde exacto
// al hablar». Y es también, por fin, la intuición original del founder sobre el
// líquido — sólo que el líquido no es un contenido con nivel: es cómo se mueve
// el color.
//
// LO QUE ESTE ARCHIVO NO HACE: no conoce un solo número de dinero, no decide un
// nivel y no dibuja el orbe. Resuelve un fluido y entrega una textura.
//
// LA PARTE PURA VIVE ARRIBA: las constantes, la escalera de calidad y el
// CALENDARIO DE SALPICADURAS son funciones puras que el gate ejecuta. Lo que
// corre en la GPU no se puede auditar desde node; lo que decide CUÁNDO y CON
// CUÁNTA FUERZA se empuja el fluido, sí — y es donde vive la conducta que el
// founder juzga.

/**
 * ── EL FLUIDO ESTÁ APAGADO EN PRODUCCIÓN ───────────────────────────────────
 *
 * Y no porque no funcione: porque **el founder no puede seguir siendo el banco
 * de pruebas.** Tres despliegues seguidos le llegaron con algo roto —rayas,
 * cortes, vibración— y cada uno lo descubrió él, en su teléfono, con la app de
 * verdad. El estado que él prefirió es el anterior al fluido, y ése es el que
 * tiene que estar en producción mientras esto no esté resuelto.
 *
 * Lo que se apaga es SÓLO el fluido. El campo, la rampa, el grano, la
 * saturación y la deformación propia siguen exactamente como estaban — y todo
 * eso él ya lo dio por bueno («en textura ya estamos ahí»).
 *
 * El solver NO se borra. Sigue entero, con sus pines y sus mutaciones, y se
 * enciende cambiando esta línea a `true`. `/dev/vidrio?hoja=fluido` lo muestra
 * encendido para poder seguir trabajándolo sin que producción sea el ensayo.
 *
 * Lo que falta para encenderlo, dicho con nombre: el titileo. Medido, el cambio
 * por cuadro es el 23 % del cambio en medio segundo cuando en un flujo debería
 * ser ~5 %. Mi instrumento dejó de servir para afinarlo —el cambio por píxel es
 * más chico que un paso de 8 bits, así que mide redondeo— y afinar a ciegas es
 * exactamente lo que le costó tres despliegues rotos.
 */
export const ORB_FLUID_ENABLED = false;

/** Lado de la rejilla de velocidad. Cuadrada: el orbe también lo es. */
export const ORB_FLUID_SIM_SIZE = 128;

/** Lado de la rejilla del tinte, que es la que el orbe mira. */
export const ORB_FLUID_DYE_SIZE = 24;
/**
 * N3C r28 · EL TINTE DE LUZ, que es lo que hace VISIBLES las ondas.
 *
 * El founder: «en sus orbes se forman literalmente ondas de voz, como con luz y
 * ondas que siguen exactamente el sonido». La palabra que importa es LUZ.
 *
 * Su fluido entra al color por DOS puertas, no una: desplaza el muestreo
 * (`uv += -fluid.rg * 0.001`) y además se mezcla como luz sobre el color ya
 * compuesto (`blendHardLight(color, blanco, length(fluid) * …)`). Nosotros sólo
 * teníamos la primera, y por eso nuestros anillos existían en la física pero no
 * se veían: deformaban un color, no encendían nada.
 *
 * El mapa material no puede hacer este trabajo — es de 24 px a propósito (r15:
 * un mapa más fino que su velocidad copia choques con filo perfecto). Así que el
 * tinte de luz es su propia textura, y sí puede ser fina porque no dirige nada:
 * sólo se enciende y se deja llevar.
 */
export const ORB_FLUID_LIGHT_SIZE = 256;
/** Cuánto se apaga el tinte por segundo. El suyo: 0,98 por cuadro a 60 Hz. */
export const ORB_FLUID_LIGHT_FADE = 0.55;
/**
 * Cuánta luz inyecta cada anillo. MUY poca a propósito: con el apagado lento, el
 * tinte se vuelve un campo que persiste y evoluciona, no un flash por sílaba.
 * Medido: inyectando fuerte y apagando rápido, el orbe PULSA (correlación −80 a
 * ocho cuadros, donde el suyo da +2,3) — que es otra forma del mismo defecto de
 * la r27, un brillo colgado del ritmo de las sílabas.
 */
export const ORB_FLUID_LIGHT_INJECT = 0.055;

/**
 * Iteraciones de presión por escalón de calidad. El nivel 1 NO corre fluido:
 * es el degradado honesto para un teléfono que no puede con texturas de coma
 * flotante, y el orbe vuelve a su deformación de ruido.
 */
// MÁS ITERACIONES DE PRESIÓN. Una proyección que no converge deja divergencia
// residual, y una divergencia residual comprime y expande el rastro cada
// cuadro: eso se ve como VIBRAR. Medido: el cambio por cuadro era el 30 % del
// cambio en medio segundo, o sea que el campo se sacudía y volvía en vez de
// avanzar.
export const ORB_FLUID_ITERATIONS: Record<1 | 2 | 3, number> = { 1: 0, 2: 12, 3: 20 };

/**
 * Cuánto se frena el fluido por segundo.
 *
 * MEDIDO, y es la corrección que importa: con 0,34 el fluido llegaba a un
 * RÉGIMEN ESTACIONARIO — la disipación se comía la energía tan rápido que el
 * campo quedaba dominado por el forzado, que es periódico, y se asentaba en una
 * figura. Quintuplicar la fuerza no movió el patrón ni un píxel (1,52 → 1,02):
 * ésa fue la prueba de que el problema no era cuánto se empuja sino que el
 * fluido se estaba asentando. El founder lo había visto sin medir nada: «fluye
 * pero sigue quedando estático en ese patrón».
 *
 * Con una disipación baja el fluido CONSERVA su energía, los remolinos se
 * rompen entre sí y el campo no vuelve a pasar dos veces por el mismo estado.
 */
export const ORB_FLUID_VELOCITY_DISSIPATION = 0.2;
/**
 * N3C r12 · CADA CUÁNTO EL MAPA MATERIAL VUELVE A SU SITIO, por segundo.
 *
 * Éste es el número que decide la queja del founder —«nuestros colores se
 * mueven en el mismo lugar, el de ellos fluye»— y ahora está MEDIDO. La curva
 * de decorrelación de un orbe que fluye CRECE con el retardo; la del nuestro
 * era plana y a los 2 s bajaba, que es la firma de un patrón que vuelve.
 *
 * Con 0 el mapa se aleja para siempre y a los pocos segundos el dibujo se
 * deshilacha en filamentos. Con un valor alto vuelve a estar anclado y
 * volvemos al defecto. Es el único freno, así que va con los dos topes puestos.
 */
/**
 * N3C r16 · CUÁNTOS TRAMOS COMO MÁXIMO PARTE UN PASO LARGO.
 *
 * Con 1 la física depende del ritmo de cuadros: a 30 fps el salto de advección
 * es el doble que a 60 y el mapa se pliega en filos. Sin tope, un cuadro perdido
 * de medio segundo pediría treinta tramos y congelaría la página.
 */
export const ORB_FLUID_MAX_SUBSTEPS = 4;

export const ORB_FLUID_MAP_RELAX = 0.90;

/**
 * N3C r15 · CUÁNTA VISCOSIDAD LLEVA EL MAPA, por cuadro.
 *
 * Con 0 el mapa copia los choques de la velocidad con filo perfecto y aparecen
 * las «olas duras». Con 1 se promedia entero cada cuadro y el flujo desaparece
 * en una mancha. Los dos topes van puestos porque un umbral de un lado deja
 * pasar el otro — lección de la r8, pagada con la app rota.
 */
export const ORB_FLUID_MAP_DIFFUSE = 0.35;
/** La vorticidad: cuánto se enrosca. Es lo que hace que «bordee la esfera». */
// 20 y no 34: la vorticidad alta afila los remolinos hasta el pixel de la
// rejilla, y ahí es donde el campo empieza a vibrar en vez de fluir.
export const ORB_FLUID_CURL = 30;

/**
 * Una salpicadura. **Las dos mitades viven en unidades distintas y por eso van
 * separadas** — confundirlas fue el defecto que tuvo el fluido congelado tres
 * mediciones seguidas.
 *
 * La ADVECCIÓN desplaza `dt × velocidad × (1/128)` por cuadro. Con dt = 1/60 eso
 * divide la velocidad por 7680: para que el rastro se mueva un téxel por cuadro
 * la velocidad tiene que valer varios cientos. Yo estaba inyectando 0,07.
 *
 * El RASTRO, en cambio, es lo que el orbe lee como desplazamiento, y tiene que
 * quedarse en ±0,3: pasado de ahí satura contra el tope y deja de variar — que
 * es exactamente el «patrón trabado».
 */
export interface OrbFluidSplat {
  /** 0–1 en la rejilla. */
  x: number;
  y: number;
  /** Empujón de VELOCIDAD, en unidades de la rejilla (cientos, no décimas). */
  dx: number;
  dy: number;
  /** Lo que se inyecta en el RASTRO. Acotado, y en otra escala. */
  tx: number;
  ty: number;
  tz: number;
  /** Radio del empujón, al cuadrado, como lo quiere el shader. */
  radius: number;
  /** N3C r28 · `true` = tren de anillos desde el centro (la onda de voz). */
  ring?: boolean;
  /** La fase del tren de anillos. Sólo la mira una salpicadura de anillos. */
  phase?: number;
}

/**
 * El puente entre las dos escalas — y el número que hay que respetar, porque
 * pasarse ROMPE la imagen.
 *
 * El solver recorta la velocidad a **±1000** (lo hace el paso de vorticidad). Si
 * la salpicadura inyecta más que eso, el recorte produce un salto duro justo
 * donde se empujó: cortes visibles. Y la advección desplaza `dt × v × (1/128)`,
 * así que una velocidad enorme muestrea FUERA del dominio, donde la textura
 * repite el borde — y eso dibuja rayas rectas.
 *
 * Con 5200 inyectaba 5.720 y aparecieron las dos cosas a la vez. El demo
 * clásico de fluidos inyecta del orden de 100–300, y ése es el rango sano: el
 * fluido se desarrolla en segundos, sin recortes y sin muestrear fuera.
 */
export const ORB_FLUID_GRID = 300;

/** Cuánto rastro deja cada empujón. Chico a propósito: ver arriba. */
export const ORB_FLUID_TRAIL = 0.030;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, finite(value)));
}

/**
 * El empujón de fondo. MEDIDO contra el suyo con el mismo instrumento: su orbe
 * en reposo mueve el patrón **5,99 px** por medio segundo sobre una muestra de
 * 80; el nuestro movía **1,52**. Cuatro veces menos — y por debajo de lo que el
 * ojo registra como movimiento, que es de dónde salía «se queda estático».
 */
export const ORB_FLUID_AMBIENT_FORCE = 6.2;

/**
 * CUÁNTOS AGITADORES, y por qué importa más que su fuerza.
 *
 * Con dos, el fluido llega a un régimen estacionario: dos remolinos siempre en
 * el mismo sitio, y el campo se traba en una forma que el ojo reconoce. El
 * founder lo vio exacto — «un patrón trabado… fluye pero sigue quedando
 * estático en ese patrón».
 *
 * Medido: la coherencia de traslación de su orbe es 0,12 y la nuestra era 0,21.
 * Casi el doble de movimiento «en bloque», que es justo lo que hace que se
 * reconozca un patrón. Cinco agitadores con frecuencias que no son múltiplos
 * entre sí reparten el forzado, no vuelven a alinearse y el campo no se asienta.
 */
export const ORB_FLUID_STIRRERS = 5;

/**
 * N3C r22 · A QUÉ DISTANCIA DEL CENTRO MIRA CADA CAPA su parte del fluido.
 *
 * Es el mismo número que el `fofs` del shader (`* 0.17`): cada capa muestrea
 * una ventana centrada ahí, y cada agitador se planta en esa misma ventana para
 * que las cinco reciban el mismo movimiento. Si los dos números se separan,
 * unas capas se mueven al doble que otras — medido: razón 2,11.
 */
export const ORB_FLUID_WINDOW_R = 0.17;
/** Y el de la voz, que es el que tiene que sentirse como una respuesta. */
export const ORB_FLUID_VOICE_FORCE = 3.2;
/**
 * N3C r28 · EL TREN DE ANILLOS, con sus números leídos de la referencia.
 *
 * SPAN es su `radius` del splat (multiplica la coordenada antes de medir la
 * distancia, así que decide cuántos anillos entran en el orbe) y WIDTH es el
 * grosor de cada anillo dentro del período. Con SPAN 1,5 y WIDTH 0,15 caben dos
 * anillos y medio, que es lo que se ve en el suyo.
 */
export const ORB_FLUID_RING_SPAN = 1.5;
export const ORB_FLUID_RING_WIDTH = 0.15;
/** Cuánto empuja el tren de anillos. Su `audioAverage.x * 30` con su escala. */
export const ORB_FLUID_RING_FORCE = 30;
/** Su `InputScale`: cuánto se desvía la dirección del empuje del centro. */
export const ORB_FLUID_RING_INPUT_SCALE = 12;
/**
 * El umbral de su compuerta: sólo se empuja cuando el promedio de TODO el
 * espectro está SUBIENDO. Es la mitad del asunto — en silencio, o mientras el
 * sonido cae, no entra ni una salpicadura y el fluido sólo coasta.
 */
export const ORB_FLUID_RISING_THRESHOLD = 1e-4;
/**
 * N3C r26 · CUÁNTOS AGITADORES SUMA LA VOZ. Par: la mitad abre desde el centro
 * y la otra mitad gira en tangencial más afuera, para que se crucen. Ver el
 * comentario largo en `orbFluidSplats`.
 */
export const ORB_FLUID_VOICE_STIRRERS = 6;

/**
 * EL CALENDARIO DE SALPICADURAS — puro, y por eso auditable.
 *
 * Dos agitadores de fondo recorren trayectorias lentas y distintas entre sí, y
 * empujan el fluido en la dirección en la que van. Es poco: alcanza para que
 * nunca esté quieto y no alcanza para que se vea venir nada.
 *
 * La voz entra por arriba y con MUCHA más fuerza, en tres puntos que giran a
 * ritmos distintos — así el empujón no sale siempre del mismo lado, que es lo
 * que el founder señaló de todas las versiones anteriores.
 *
 * La fuerza se multiplica por `dt`: si dependiera del cuadro, el fluido correría
 * al doble en un teléfono de 120 Hz.
 */
export function orbFluidSplats(input: {
  time: number;
  voice: number;
  wave: number;
  dtSeconds: number;
  /**
   * N3C r28 · LAS CUATRO BANDAS. Con esto la voz entra por la ley de la
   * referencia (un tren de anillos, sólo en los flancos de subida); sin esto se
   * usa el camino escalar anterior.
   */
  audio?: {
    average: { low: number; mid: number; high: number; all: number };
    cumulative: { low: number; mid: number; high: number; all: number };
    /** La DERIVADA del promedio total. Positiva = el sonido está subiendo. */
    risingAll: number;
  };
}): OrbFluidSplat[] {
  const dt = Math.min(1 / 30, Math.max(1 / 240, finite(input.dtSeconds, 1 / 60)));
  const t = finite(input.time);
  const voice = clamp01(input.voice);
  const wave = clamp01(input.wave);
  const splats: OrbFluidSplat[] = [];

  // ── N3C r17 · LOS AGITADORES ORBITAN. NO BARREN ────────────────────────
  //
  // Ésta es la causa de las «olas que pasan como capas», y se ve de un vistazo
  // pintando el mapa: una banda horizontal recta y una vertical recta, ambas
  // con borde filoso. Un fluido no dibuja rectas.
  //
  // Antes cada agitador tenía DOS frecuencias, una por eje, y su trayectoria
  // era una Lissajous. Medidas las razones: el agitador 3 daba 2,61 y el 4
  // daba 3,89 — o sea trayectorias DEGENERADAS, casi segmentos. Uno barría
  // horizontal y el otro vertical, y un agitador que viaja en línea recta
  // empujando de costado carva una capa de cizalla con borde recto. Eso es
  // exactamente la ola: una capa que cruza el orbe y se va.
  //
  // Ahora cada uno ORBITA: una sola frecuencia angular, radio que respira, y el
  // empuje tangencial. Una órbita no tiene lados rectos, así que no hay bordes
  // que carvar; y los sentidos siguen alternando, que es lo que cancela el
  // arrastre de conjunto (la coherencia 0,49 contra 0,12 de ellos que la r5
  // midió empujando hacia adelante).
  //
  // Además cada órbita tiene SU centro, repartido con el ángulo áureo: cinco
  // remolinos concéntricos dejarían un anillo, que es otra estructura fija.
  const giros = [0.229, 0.317, 0.409, 0.173, 0.541];
  const respiros = [0.083, 0.117, 0.061, 0.139, 0.097];
  for (let i = 0; i < ORB_FLUID_STIRRERS; i += 1) {
    const phase = i * 2.3999632;
    const w = giros[i]!;
    const sentido = i % 2 === 0 ? 1 : -1;
    // ── N3C r22 · CADA AGITADOR VIVE DONDE MIRA SU CAPA ────────────────────
    //
    // El founder: «se ven un poco rápidos y bruscos, NO TODOS pero sí algunos
    // colores». Medido, tenía razón y era grande: el cambio a 1 s por capa daba
    // saldo 0,0123 · reserva 0,0236 · metas 0,0259 · patrimonio 0,0177 · deuda
    // 0,0166 — metas se movía al DOBLE que saldo (razón 2,11).
    //
    // La causa: las cinco capas miran zonas DISTINTAS del mismo fluido
    // (`fofs` en el shader, radio 0,17 en espiral áurea) y los agitadores
    // orbitaban a 0,10 — o sea, ni cerca de donde mira cada una. Las capas que
    // caían junto a un agitador se movían el doble.
    //
    // Ahora cada agitador se planta EN el centro de la ventana de su capa: el
    // mismo ángulo áureo y el MISMO radio 0,17. Cada orbe tiene su propio
    // remolino adentro, y las cinco reciben lo mismo.
    //
    // Este 0,17 y el del shader son EL MISMO NÚMERO: si uno se mueve sin el
    // otro, vuelve el desbalance. El gate lo pincha atado.
    const cx = 0.5 + Math.cos(phase) * ORB_FLUID_WINDOW_R;
    const cy = 0.5 + Math.sin(phase) * ORB_FLUID_WINDOW_R;
    // el radio respira para que la órbita no deje un anillo fijo
    const radio = 0.115 + 0.045 * Math.sin(t * respiros[i]! + phase * 1.3);
    const ang = t * w * sentido + phase;
    const ax = cx + radio * Math.cos(ang);
    const ay = cy + radio * Math.sin(ang);
    // el empuje es TANGENTE a la órbita: eso inyecta rotación, que es lo que
    // un remolino hace, en vez de arrastre
    const ux = -Math.sin(ang) * sentido;
    const uy = Math.cos(ang) * sentido;
    const force = (ORB_FLUID_AMBIENT_FORCE / ORB_FLUID_STIRRERS) * (1 + wave * 1.4);
    splats.push({
      x: ax,
      y: ay,
      dx: ux * force * ORB_FLUID_GRID * dt * 60,
      dy: uy * force * ORB_FLUID_GRID * dt * 60,
      tx: ux * ORB_FLUID_TRAIL * force,
      ty: uy * ORB_FLUID_TRAIL * force,
      tz: ORB_FLUID_TRAIL * force * 0.6,
      radius: 0.0115,
    });
  }

  // ── N3C r28 · LA ONDA DE VOZ, PORTADA DE SU CÓDIGO ────────────────────────
  //
  // El founder: «en sus orbes se forman literalmente ondas de voz […] las
  // nuestras reaccionan como un golpe pero no se parecen en nada». Buscó bien:
  // su ley estaba publicada en su propio bundle, y dice tres cosas que ninguna
  // medición mía podía ver.
  //
  // 1 · UNA salpicadura por cuadro, no once. Nosotros empujábamos cinco
  //     agitadores de fondo más seis de voz, TODOS los cuadros. Su fluido
  //     recibe UNA, y sólo a veces.
  //
  // 2 · SÓLO CUANDO EL SONIDO SUBE. La compuerta es la derivada del promedio de
  //     todo el espectro: si el sonido cae o está quieto, no entra nada y el
  //     fluido coasta. Ésa es la razón de que el suyo se vea calmo entre
  //     sílabas y el nuestro agitado todo el tiempo.
  //
  // 3 · LA POSICIÓN LA CAMINAN LOS INTEGRADOS. El punto se pasea por una
  //     Lissajous de ∫medios y ∫graves — dos cantidades que sólo crecen, así
  //     que el paseo es suave y jamás retrocede. La dirección del empuje es
  //     ese mismo desvío, hacia afuera.
  //
  // El tren de anillos en sí lo dibuja el shader; acá se decide CUÁNDO y CON
  // CUÁNTO. Con `audio` ausente no cambia nada de lo anterior: el fluido sigue
  // teniendo su empuje de fondo y su voz escalar, que es el camino que usan el
  // gate y las probetas viejas.
  const audio = input.audio;
  if (audio) {
    if (audio.risingAll > ORB_FLUID_RISING_THRESHOLD) {
      const tx = -0.2 * Math.sin(0.5 * audio.cumulative.mid) + 0.5;
      const ty = 0.15 * Math.cos(0.38 * audio.cumulative.low) + 0.5;
      const empuje = audio.average.low * ORB_FLUID_RING_FORCE;
      splats.push({
        ring: true,
        // la fase, que es lo que hace VIAJAR los anillos: reloj + ∫total
        phase: t * 0.25 + audio.cumulative.all * 0.15,
        x: 0.5 + 0.1 * tx,
        y: 0.5 + 0.1 * ty,
        dx: (tx - 0.5) * ORB_FLUID_RING_INPUT_SCALE * empuje * ORB_FLUID_GRID * dt * 60,
        dy: (ty - 0.5) * ORB_FLUID_RING_INPUT_SCALE * empuje * ORB_FLUID_GRID * dt * 60,
        tx: (tx - 0.5) * ORB_FLUID_TRAIL * empuje,
        ty: (ty - 0.5) * ORB_FLUID_TRAIL * empuje,
        tz: ORB_FLUID_TRAIL * empuje * 0.6,
        radius: 0.02,
      });
    }
  } else if (voice > 0.02) {
    for (let i = 0; i < ORB_FLUID_VOICE_STIRRERS; i += 1) {
      // El camino ESCALAR, anterior a la r28. Sigue vivo porque el gate y las
      // probetas fijas lo ejecutan sin bandas, y porque es el degradado honesto
      // cuando no hay un analizador de cuatro bandas del otro lado.
      const anillo = i >= ORB_FLUID_VOICE_STIRRERS / 2;
      const j = anillo ? i - ORB_FLUID_VOICE_STIRRERS / 2 : i;
      const phase = j * 2.0943951 + (anillo ? 1.0471976 : 0);
      const spin = t * (0.83 + j * 0.31) * (anillo ? -0.74 : 1) + phase;
      const reach = anillo ? 0.34 + 0.10 * voice : 0.20 + 0.16 * voice;
      const force = ORB_FLUID_VOICE_FORCE * voice;
      const ux = Math.cos(spin), uy = Math.sin(spin);
      const px = anillo ? -uy : ux;
      const py = anillo ? ux : uy;
      splats.push({
        x: 0.5 + reach * ux,
        y: 0.5 + reach * uy,
        dx: px * force * ORB_FLUID_GRID * dt * 60,
        dy: py * force * ORB_FLUID_GRID * dt * 60,
        tx: px * ORB_FLUID_TRAIL * force * 1.6,
        ty: py * ORB_FLUID_TRAIL * force * 1.6,
        tz: ORB_FLUID_TRAIL * force,
        radius: 0.0180 + 0.062 * voice,
      });
    }
  }

  return splats;
}

/** Cuánta fuerza total entra en un cuadro. Existe para poder medirla. */
export function orbFluidPush(splats: readonly OrbFluidSplat[]): number {
  let total = 0;
  for (const s of splats) total += Math.hypot(s.dx, s.dy);
  return total;
}

// ── DE ACÁ PARA ABAJO ES LA GPU ────────────────────────────────────────────

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

export interface OrbFluid {
  /** Un paso de simulación. Devuelve la textura del rastro, ya avanzada. */
  step(dtSeconds: number, splats: readonly OrbFluidSplat[], iterations: number): void;
  /** La textura que el orbe mira: xy = el desplazamiento acumulado. */
  texture: WebGLTexture;
  /**
   * N3C r28 · EL TINTE DE LUZ: dónde pasó un anillo de voz y con cuánta fuerza.
   * Es la segunda puerta por la que el fluido entra al color, y la que hace que
   * las ondas se VEAN en vez de sólo deformar.
   */
  lightTexture: WebGLTexture;
  lightTexel: [number, number];
  dispose(): void;
}

interface Fbo {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  size: number;
  texel: [number, number];
}

interface DoubleFbo {
  read: Fbo;
  write: Fbo;
  swap(): void;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv, vL, vR, vT, vB;
uniform vec2 uTexel;
void main(){
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `precision highp float;
varying vec2 vUv, vL, vR, vT, vB;
`;

// El empujón. Una gaussiana sumada al campo — el mismo `exp(-dot(p,p)/radius)`
// que usa su salpicadura.
// ── N3C r28 · DOS FORMAS DE EMPUJAR, y la segunda es «las ondas de voz» ─────
//
// El founder, viendo la r27: «en sus orbes se forman literalmente ondas de voz,
// con luz y ondas que siguen exactamente el sonido; las nuestras reaccionan como
// un golpe». Tenía razón, y la razón es estructural: nosotros empujábamos
// MANCHAS y ellos empujan ANILLOS.
//
// Leído de su bundle: su salpicadura no usa el punto que le pasan (está
// comentado en su propio código) — siempre sale del CENTRO, y no es una
// gaussiana sino un tren de anillos concéntricos:
//
//     pDist = mod(dist * 2 - fase, 1)
//     pulso = smoothstep(0, w, pDist) - smoothstep(w, 2w, pDist)
//     empuje = pulso * amplitud * clamp(dist, 0, 1) * dirección
//
// La FASE avanza con el tiempo y con el audio INTEGRADO, así que los anillos
// viajan hacia afuera y nunca retroceden. La AMPLITUD son los graves. Y el
// `clamp(dist)` los apaga en el centro, que es lo que hace que nazcan adentro y
// crezcan — literalmente una onda de voz.
//
// La mancha se queda para el empuje de fondo, que es otra cosa: mantener el
// fluido vivo en silencio sin dibujar nada reconocible.
const SPLAT = `${HEAD}
uniform sampler2D uTarget;
uniform float uRadius;
uniform vec3 uValue;
uniform vec2 uPoint;
uniform float uRing;
uniform float uPhase;
uniform float uRingWidth;
uniform float uRingSpan;
void main(){
  vec3 splat;
  if(uRing > 0.5){
    vec2 p = (vUv - vec2(0.5)) * uRingSpan;
    float dist = length(p);
    float pDist = mod(dist * 2.0 - uPhase, 1.0);
    float pulso = smoothstep(0.0, uRingWidth, pDist)
                - smoothstep(uRingWidth, uRingWidth * 2.0, pDist);
    splat = pulso * clamp(dist, 0.0, 1.0) * uValue;
  } else {
    vec2 p = vUv - uPoint;
    splat = exp(-dot(p, p) / uRadius) * uValue;
  }
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
}`;

// ADVECCIÓN: cada punto toma el valor de DONDE VENÍA. Es el corazón de todo:
// el campo no se desplaza entero, cada trozo viaja por su cuenta siguiendo la
// velocidad local, y por eso se enrosca en vez de pasar.
const ADVECT = `${HEAD}
uniform sampler2D uVelocity, uSource;
uniform vec2 uTexelSize, uSourceTexel;
uniform float uDt, uDissipation, uRelax, uDiffuse;
// ── N3C r14 · EL FILTRADO A MANO, y por qué NO es opcional ──────────────────
//
// 'OES_texture_half_float_linear' NO existe en todo el hardware — medido en
// este mismo navegador: false. Sin esa extensión, muestrear una textura de
// media precisión es NEAREST: la advección lee el mapa a saltos, en escalones,
// y un escalón que se mueve es una LÍNEA DURA que barre el orbe. Eso es lo que
// el founder fotografió: «olas duras que de la nada distorsionan todo».
//
// El original MIT ya trae esta rama (un ifdef MANUAL_FILTERING) exactamente por
// esto, y yo había portado sólo la otra. Acá va SIEMPRE, sin depender de la
// extensión: si el filtrado por hardware está, da el mismo resultado, y si no
// está, el orbe se ve igual en vez de romperse sólo en algunos teléfonos. Un
// defecto que aparece según la GPU es un defecto que no se puede medir.
vec4 bilerp(sampler2D sam, vec2 uv, vec2 ts){
  vec2 st = uv / ts - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * ts);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * ts);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * ts);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * ts);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
void main(){
  vec2 paso = uDt * bilerp(uVelocity, vUv, uTexelSize).xy * uTexelSize;
  vec2 coord = vUv - paso;
  vec4 r = bilerp(uSource, coord, uSourceTexel) / (1.0 + uDissipation * uDt);
  // ── N3C r15 · SE GUARDA EL DESPLAZAMIENTO, NO LA COORDENADA ───────────────
  //
  // Ésta es la causa REAL de las «olas duras», y es de precisión, no de física.
  // La textura es de media precisión: diez bits de mantisa. Guardando la
  // coordenada absoluta (0,1 a 0,9) el escalón vale 4,9e-4 — y el
  // desplazamiento que el orbe necesita leer es del orden de 7,9e-4. O sea que
  // **el escalón era el 62 % de la señal**: del desplazamiento sobrevivían un
  // puñado de niveles discretos, y la frontera entre dos niveles es exactamente
  // una línea con borde escalonado barriendo el disco.
  //
  // Peor todavía: el orbe hacía mapa menos su propia coordenada, que es restar dos
  // números casi iguales. Esa resta se queda con TODO el error absoluto y no
  // con la parte buena.
  //
  // Guardando el desplazamiento el valor vive cerca de cero, donde la media
  // precisión da resolución RELATIVA: el escalón pasa a ser ~0,1 % de la señal.
  // La identidad ya no es vUv, es el cero, y el paso propio se resta acá:
  //   M(x) = D(x) + x  ⇒  D_nuevo(x) = D_viejo(x - v·dt) - v·dt
  // ── N3C r18 · SE LLEVÓ UN RELEVO DE DOS FASES, Y SE QUITÓ ────────────────
  //
  // En la r17 puse dos mapas desfasados medio ciclo, cada uno volviendo a cero
  // cuando su peso era cero, para que ninguno envejeciera lo suficiente como
  // para plegarse. La técnica es estándar y está bien implementada. **No servía
  // de nada**: el pliegue no venía de la edad del mapa sino de la deformación
  // del dominio, y eso se arregló en otro sitio.
  //
  // Y traía su propio defecto. El founder: «cada 3 segundos hay una contracción
  // de todo el orbe». Medido por autocorrelación: **2,40 s exactos, con
  // armónico en 4,8** — el ciclo, clavado. La causa: dos campos independientes
  // pesados al 50 % se cancelan parcialmente entre sí, así que la amplitud
  // efectiva late con el ciclo aunque cada reinicio sea invisible.
  //
  // Un mecanismo que no arregla lo que decía arreglar y que introduce un
  // artefacto propio se saca entero. El mapa vuelve a una sola fase, acotada
  // por su relajación.
  vec2 d = r.xy - paso;
  // ── N3C r15 · LA VISCOSIDAD QUE LE FALTABA AL MAPA ───────────────────────
  //
  // La velocidad SE ADVECTA A SÍ MISMA, y eso forma choques: es física, no un
  // error de implementación. En el original no se ven porque lo que se mira es
  // el TINTE, que se disipa y se difunde. Nuestro mapa no se disipa —una
  // coordenada no puede— así que copia cada choque con filo perfecto, y un filo
  // que se mueve es una línea dura barriendo el disco. Medido pintando el
  // desplazamiento crudo: razones de 33 a 256 contra un suelo de 5,2.
  //
  // La cura es la que usa cualquier fluido real: un poco de viscosidad. Se
  // promedia con los cuatro vecinos, lo justo para redondear el filo sin
  // borrar el flujo. Va sólo en el mapa; la velocidad conserva su física.
  if(uDiffuse > 0.0){
    vec2 vecinos = 0.25 * (
      bilerp(uSource, coord + vec2(uSourceTexel.x, 0.0), uSourceTexel).xy +
      bilerp(uSource, coord - vec2(uSourceTexel.x, 0.0), uSourceTexel).xy +
      bilerp(uSource, coord + vec2(0.0, uSourceTexel.y), uSourceTexel).xy +
      bilerp(uSource, coord - vec2(0.0, uSourceTexel.y), uSourceTexel).xy);
    d = mix(d, vecinos - paso, clamp(uDiffuse, 0.0, 1.0));
  }
  d = mix(d, vec2(0.0), clamp(uRelax * uDt, 0.0, 1.0));
  gl_FragColor = vec4(d, 0.0, 1.0);
}`;

// N3C r12/r15 · EL MAPA MATERIAL EMPIEZA EN CERO: cada punto guarda cuánto se
// ha desplazado, no dónde está. Advectado, ese desplazamiento CRECE — no es un
// empujón acotado que vuelve. En cero la media precisión da resolución
// relativa; guardando la coordenada absoluta, el escalón se comía el 62 % de
// la señal (r15).
const IDENTITY = `${HEAD}
void main(){ gl_FragColor = vec4(0.0); }`;

const DIVERGENCE = `${HEAD}
uniform sampler2D uVelocity;
void main(){
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if(vL.x < 0.0) L = -C.x;
  if(vR.x > 1.0) R = -C.x;
  if(vT.y > 1.0) T = -C.y;
  if(vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CURL = `${HEAD}
uniform sampler2D uVelocity;
void main(){
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

// VORTICIDAD: le devuelve al fluido los remolinos que la rejilla se come. Es lo
// que hace que el movimiento «bordee» en vez de disolverse.
const VORTICITY = `${HEAD}
uniform sampler2D uVelocity, uCurl;
uniform float uCurlStrength, uDt;
void main(){
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  // ── N3C r16 · NORMALIZAR UN VECTOR QUE PASA POR CERO ES UNA RULETA ────────
  //
  // El original divide por 'length(force) + 0.0001'. Donde la fuerza es casi
  // nula —y lo es en franjas enteras, porque es una diferencia de curls
  // vecinos— esa división convierte ruido de precisión en una DIRECCIÓN de
  // magnitud completa. Píxeles contiguos salen apuntando a lados opuestos, y
  // eso es un filo que aparece y desaparece en un cuadro.
  //
  // El épsilon suma en vez de multiplicar: por debajo de él la fuerza se apaga
  // en vez de dispararse, y por encima el comportamiento es el del original.
  float mag = length(force);
  force *= mag / (mag * mag + 0.02);
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy + force * uDt;
  // ── N3C r16 · EL TOPE DE LA VELOCIDAD, SUAVE ──────────────────────────────
  //
  // El original recorta a ±1000 con un clamp. Un recorte APLANA la zona que lo
  // supera y le pone un borde: la frontera entre lo recortado y lo que no lo
  // está es una línea, y dura exactamente lo que dure el pico — uno o dos
  // cuadros. Eso es lo que el founder describe como «de la nada aparece y
  // después desaparece», medido en 7 eventos de 32–67 ms cada 70 s.
  //
  // Probado que el tope hace falta: levantarlo a 100000 subió los eventos de 7
  // a 19. Y probado que un 'if' por píxel no sirve: acotar el salto a un téxel
  // los subió a 15, porque el propio umbral dibuja su contorno.
  //
  // Éste satura sin borde: por debajo del tope el factor es ~1 y por encima
  // tiende a L/|v|, igual que el recorte, pero sin discontinuidad en ninguna
  // parte. Es el mismo cambio que la r8 hizo en el orbe, aplicado al solver.
  float largo = length(vel);
  vel *= inversesqrt(1.0 + (largo * largo) / 1000000.0);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`;

const PRESSURE = `${HEAD}
uniform sampler2D uPressure, uDivergence;
void main(){
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

// La proyección: le saca al campo la parte que comprime. Sin esto el fluido
// acumula materia en unos sitios y la vacía en otros, y deja de ser un fluido.
const GRADIENT = `${HEAD}
uniform sampler2D uPressure, uVelocity;
void main(){
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}`;

const CLEAR = `${HEAD}
uniform sampler2D uTexture;
uniform float uValue;
void main(){ gl_FragColor = uValue * texture2D(uTexture, vUv); }`;

function compile(gl: Gl, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: Gl, vert: WebGLShader, fragSrc: string): WebGLProgram | null {
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!frag) return null;
  const p = gl.createProgram();
  if (!p) {
    gl.deleteShader(frag);
    return null;
  }
  gl.attachShader(p, vert);
  gl.attachShader(p, frag);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

/**
 * EL DEGRADADO HONESTO. El fluido necesita dibujar en texturas de coma
 * flotante, y no todo teléfono puede. Si no puede, esto devuelve `null` y el
 * orbe sigue con su deformación de ruido — peor, y verdadero. Nunca se finge
 * un fluido que no corrió.
 */
export function createOrbFluid(gl: Gl, forzar = false): OrbFluid | null {
  if (!ORB_FLUID_ENABLED && !forzar) return null;
  const isGl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  let internal: number;
  let type: number;
  if (isGl2) {
    const gl2 = gl as WebGL2RenderingContext;
    if (!gl2.getExtension("EXT_color_buffer_float") && !gl2.getExtension("EXT_color_buffer_half_float")) {
      return null;
    }
    internal = gl2.RGBA16F;
    type = gl2.HALF_FLOAT;
  } else {
    const half = gl.getExtension("OES_texture_half_float");
    if (!half || !gl.getExtension("EXT_color_buffer_half_float")) return null;
    internal = gl.RGBA;
    type = (half as { HALF_FLOAT_OES: number }).HALF_FLOAT_OES;
  }
  gl.getExtension("OES_texture_half_float_linear");
  gl.getExtension("OES_texture_float_linear");

  const makeFbo = (size: number): Fbo | null => {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.activeTexture(gl.TEXTURE0 + 2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, size, size, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, size, texel: [1 / size, 1 / size] };
  };

  const double = (size: number): DoubleFbo | null => {
    const a = makeFbo(size);
    const b = makeFbo(size);
    if (!a || !b) return null;
    const d: DoubleFbo = {
      read: a,
      write: b,
      swap() {
        const t = d.read;
        d.read = d.write;
        d.write = t;
      },
    };
    return d;
  };

  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  if (!vert) return null;
  const progs = {
    splat: link(gl, vert, SPLAT),
    advect: link(gl, vert, ADVECT),
    divergence: link(gl, vert, DIVERGENCE),
    curl: link(gl, vert, CURL),
    vorticity: link(gl, vert, VORTICITY),
    pressure: link(gl, vert, PRESSURE),
    gradient: link(gl, vert, GRADIENT),
    clear: link(gl, vert, CLEAR),
    identity: link(gl, vert, IDENTITY),
  };
  gl.deleteShader(vert);
  const todos = Object.values(progs);
  if (todos.some((p) => !p)) {
    for (const p of todos) if (p) gl.deleteProgram(p);
    return null;
  }

  const velocity = double(ORB_FLUID_SIM_SIZE);
  const dye = double(ORB_FLUID_DYE_SIZE);
  const light = double(ORB_FLUID_LIGHT_SIZE);
  const pressure = double(ORB_FLUID_SIM_SIZE);
  const divergence = makeFbo(ORB_FLUID_SIM_SIZE);
  const curl = makeFbo(ORB_FLUID_SIM_SIZE);
  if (!velocity || !dye || !light || !pressure || !divergence || !curl) {
    for (const p of todos) if (p) gl.deleteProgram(p);
    return null;
  }

  const quad = gl.createBuffer();
  if (!quad) return null;

  // CREAR LOS DESTINOS DEJA UNO ATADO. Sin esto, todo lo que el orbe dibuje
  // después de crear el fluido aterriza dentro de la última textura de la
  // simulación en vez de en la pantalla — y el lienzo sale en negro.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const u = (p: WebGLProgram | null, name: string) => (p ? gl.getUniformLocation(p, name) : null);
  let disposed = false;

  const bindQuad = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  };
  bindQuad();

  const blit = (target: Fbo) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.size, target.size);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const usarPrograma = (p: WebGLProgram | null, texel: [number, number]) => {
    gl.useProgram(p);
    gl.uniform2f(u(p, "uTexel"), texel[0], texel[1]);
  };
  const bindTex = (p: WebGLProgram | null, name: string, unit: number, tex: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u(p, name), unit);
  };


  // El mapa material nace siendo la IDENTIDAD: cada punto guarda su propia
  // coordenada. Sin esto arranca en ceros y el orbe entero leería un
  // desplazamiento gigante hacia la esquina.
  for (const destino of [dye.read, dye.write]) {
    usarPrograma(progs.identity, destino.texel);
    blit(destino);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    get texture() {
      return dye.read.tex;
    },
    get lightTexture() {
      return light.read.tex;
    },
    get lightTexel(): [number, number] {
      return light.read.texel;
    },
    /**
     * ── N3C r16 · EL PASO SE PARTE, PORQUE EL DEFECTO ERA EL TAMAÑO DEL PASO ──
     *
     * La advección desplaza `dt × velocidad`. A 60 cuadros por segundo ese
     * salto es chico y el mapa se deforma suave; a 30 —lo que mide el Chrome
     * del founder— el salto es EL DOBLE, y ahí el mapa se PLIEGA: dos téxeles
     * vecinos vienen de puntos cruzados y la frontera entre ellos es un filo.
     * Un filo que se mueve es una línea dura barriendo el disco.
     *
     * Por eso mi instrumento headless nunca lo reprodujo: llamaba con 1/60
     * exacto. **Un defecto que depende del ritmo de cuadros no aparece con un
     * reloj fijo** — él miraba 30 y yo medía 60.
     *
     * Partirlo en tramos de a lo sumo 1/60 hace además que el fluido se
     * comporte IGUAL a 30, 60 o 120 cuadros: la física deja de depender de qué
     * tan rápido va el teléfono, que es lo mínimo que se le puede pedir.
     *
     * La fuerza del empujón YA lleva el dt adentro (`dx = u·f·GRID·dt·60`), así
     * que repetir los mismos empujones en cada tramo inyectaría `tramos` veces
     * la energía: se reparte.
     */
    step(dtSeconds, splats, iterations) {
      if (disposed || gl.isContextLost()) return;
      const total = Math.min(1 / 20, Math.max(1 / 240, Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60));
      const tramos = Math.min(ORB_FLUID_MAX_SUBSTEPS, Math.max(1, Math.ceil(total * 60)));
      const repartidos =
        tramos === 1
          ? splats
          : splats.map((sp) => ({
              ...sp,
              dx: sp.dx / tramos,
              dy: sp.dy / tramos,
              tx: sp.tx / tramos,
              ty: sp.ty / tramos,
              tz: sp.tz / tramos,
            }));
      for (let tramo = 0; tramo < tramos; tramo += 1) {
        unPaso(total / tramos, repartidos, iterations);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const p of todos) if (p) gl.deleteProgram(p);
      for (const f of [velocity.read, velocity.write, dye.read, dye.write, light.read, light.write, pressure.read, pressure.write, divergence, curl]) {
        gl.deleteTexture(f.tex);
        gl.deleteFramebuffer(f.fbo);
      }
      gl.deleteBuffer(quad);
    },
  };

  function unPaso(dt: number, splats: readonly OrbFluidSplat[], iterations: number): void {
      // El estrechamiento de tipos del chequeo de arriba no cruza una
      // declaración de función: se repite acá, y de paso el tramo se vuelve
      // seguro por sí mismo.
      if (!velocity || !dye || !light || !pressure || !divergence || !curl) return;
      gl.disable(gl.BLEND);
      bindQuad();

      for (const s of splats) {
        usarPrograma(progs.splat, velocity.read.texel);
        bindTex(progs.splat, "uTarget", 2, velocity.read.tex);
        gl.uniform2f(u(progs.splat, "uPoint"), s.x, s.y);
        gl.uniform3f(u(progs.splat, "uValue"), s.dx, s.dy, 0);
        gl.uniform1f(u(progs.splat, "uRadius"), s.radius);
        gl.uniform1f(u(progs.splat, "uRing"), s.ring ? 1 : 0);
        gl.uniform1f(u(progs.splat, "uPhase"), s.phase ?? 0);
        gl.uniform1f(u(progs.splat, "uRingWidth"), ORB_FLUID_RING_WIDTH);
        gl.uniform1f(u(progs.splat, "uRingSpan"), ORB_FLUID_RING_SPAN);
        blit(velocity.write);
        velocity.swap();

        // N3C r28 · …y el mismo anillo ENCIENDE el tinte de luz. Sólo los de
        // voz: el empuje de fondo mueve el líquido pero no debe dibujar nada,
        // que es lo que mantiene el orbe callado en silencio.
        if (s.ring) {
          usarPrograma(progs.splat, light.read.texel);
          bindTex(progs.splat, "uTarget", 2, light.read.tex);
          gl.uniform2f(u(progs.splat, "uPoint"), s.x, s.y);
          gl.uniform3f(
            u(progs.splat, "uValue"),
            Math.abs(s.tx) * ORB_FLUID_LIGHT_INJECT,
            Math.abs(s.ty) * ORB_FLUID_LIGHT_INJECT,
            s.tz * ORB_FLUID_LIGHT_INJECT,
          );
          gl.uniform1f(u(progs.splat, "uRadius"), s.radius);
          gl.uniform1f(u(progs.splat, "uRing"), 1);
          gl.uniform1f(u(progs.splat, "uPhase"), s.phase ?? 0);
          gl.uniform1f(u(progs.splat, "uRingWidth"), ORB_FLUID_RING_WIDTH);
          gl.uniform1f(u(progs.splat, "uRingSpan"), ORB_FLUID_RING_SPAN);
          blit(light.write);
          light.swap();
        }

        // N3C r12 · EL MAPA NO SE SALPICA.
        // Antes acá se salpicaba un RASTRO en la misma textura, y el orbe leía
        // ese rastro como desplazamiento. Ese rastro estaba acotado por
        // construcción (±0,3), así que el dibujo sólo podía sacudirse dentro de
        // un tope y VOLVER — la curva de decorrelación plana que midió el
        // defecto. Ahora la textura guarda coordenadas materiales: se empuja la
        // VELOCIDAD y el mapa se deja llevar. Salpicarlo lo corrompería.
      }

      usarPrograma(progs.curl, velocity.read.texel);
      bindTex(progs.curl, "uVelocity", 2, velocity.read.tex);
      blit(curl);

      usarPrograma(progs.vorticity, velocity.read.texel);
      bindTex(progs.vorticity, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.vorticity, "uCurl", 3, curl.tex);
      gl.uniform1f(u(progs.vorticity, "uCurlStrength"), ORB_FLUID_CURL);
      gl.uniform1f(u(progs.vorticity, "uDt"), dt);
      blit(velocity.write);
      velocity.swap();

      usarPrograma(progs.divergence, velocity.read.texel);
      bindTex(progs.divergence, "uVelocity", 2, velocity.read.tex);
      blit(divergence);

      usarPrograma(progs.clear, pressure.read.texel);
      bindTex(progs.clear, "uTexture", 2, pressure.read.tex);
      gl.uniform1f(u(progs.clear, "uValue"), 0.8);
      blit(pressure.write);
      pressure.swap();

      usarPrograma(progs.pressure, velocity.read.texel);
      bindTex(progs.pressure, "uDivergence", 2, divergence.tex);
      for (let i = 0; i < iterations; i += 1) {
        bindTex(progs.pressure, "uPressure", 3, pressure.read.tex);
        blit(pressure.write);
        pressure.swap();
      }

      usarPrograma(progs.gradient, velocity.read.texel);
      bindTex(progs.gradient, "uPressure", 2, pressure.read.tex);
      bindTex(progs.gradient, "uVelocity", 3, velocity.read.tex);
      blit(velocity.write);
      velocity.swap();

      usarPrograma(progs.advect, velocity.read.texel);
      gl.uniform2f(u(progs.advect, "uTexelSize"), velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1f(u(progs.advect, "uDt"), dt);
      gl.uniform1f(u(progs.advect, "uDissipation"), ORB_FLUID_VELOCITY_DISSIPATION);
      gl.uniform1f(u(progs.advect, "uRelax"), 0);
      gl.uniform1f(u(progs.advect, "uDiffuse"), 0);
      gl.uniform2f(u(progs.advect, "uSourceTexel"), velocity.read.texel[0], velocity.read.texel[1]);
      bindTex(progs.advect, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.advect, "uSource", 3, velocity.read.tex);
      blit(velocity.write);
      velocity.swap();

      // N3C r28 · el tinte de luz VIAJA con el fluido y se apaga. Sin apagarse,
      // los anillos se acumularían hasta dejar el orbe blanco; sin viajar,
      // serían un dibujo pegado en vez de una onda.
      usarPrograma(progs.advect, light.read.texel);
      gl.uniform1f(u(progs.advect, "uDt"), dt);
      gl.uniform1f(u(progs.advect, "uDissipation"), ORB_FLUID_LIGHT_FADE);
      gl.uniform1f(u(progs.advect, "uRelax"), 0);
      gl.uniform1f(u(progs.advect, "uDiffuse"), 0);
      gl.uniform2f(u(progs.advect, "uSourceTexel"), light.read.texel[0], light.read.texel[1]);
      bindTex(progs.advect, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.advect, "uSource", 3, light.read.tex);
      blit(light.write);
      light.swap();

      usarPrograma(progs.advect, dye.read.texel);
      gl.uniform2f(u(progs.advect, "uTexelSize"), velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1f(u(progs.advect, "uDt"), dt);
      // El mapa material NO se disipa: una coordenada no se desvanece hacia cero,
      // se relaja hacia su identidad. Disiparla arrastraría todo el orbe hacia
      // la esquina inferior izquierda.
      gl.uniform1f(u(progs.advect, "uDissipation"), 0);
      gl.uniform1f(u(progs.advect, "uRelax"), ORB_FLUID_MAP_RELAX);
      gl.uniform1f(u(progs.advect, "uDiffuse"), ORB_FLUID_MAP_DIFFUSE);
      gl.uniform2f(u(progs.advect, "uSourceTexel"), dye.read.texel[0], dye.read.texel[1]);
      bindTex(progs.advect, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.advect, "uSource", 3, dye.read.tex);
      blit(dye.write);
      dye.swap();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
  }
}
