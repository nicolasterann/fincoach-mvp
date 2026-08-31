// Bloque N3B — EL AGUA SIMULA, NO SE DIBUJA.
//
// El founder puntuó N3 en 4/10 y separó la queja en dos mitades: «el agua y el
// movimiento es malísimo… la mayoría de veces una masa deforme… no me da
// ninguna sensación de líquido o agua». La causa no era la falta de pulido: era
// la TÉCNICA. Hasta N3 la superficie del agua era la suma de cuatro senos más
// un ruido fractal, y la inclinación entraba CRUDA al shader —
// `tiltX: leanX + gyro.x`, sin una sola línea de inercia entre el teléfono y el
// agua. Un ruido animado no se lee como líquido; se lee como una masa deforme,
// que es exactamente la palabra que usó.
//
// Lo que separa un líquido de una onda dibujada no es el detalle de la
// superficie: es que el líquido TIENE MASA. Se queda atrás cuando el vaso
// arranca, se pasa de largo cuando el vaso frena, vuelve, oscila y se aquieta.
// Eso es un oscilador armónico amortiguado, y aquí está.
//
// POR QUÉ VIVE ACÁ Y NO DENTRO DEL BUCLE DE DIBUJO. Es la familia de agujeros
// que este bloque arrastra desde N1 y que ya lleva cinco apariciones: lo que
// sólo existe adentro de un `requestAnimationFrame` no se puede ejecutar en un
// entorno que no compone cuadros, y entonces «se mueve como agua» es una
// afirmación de fe. N3 dejó el resorte del arrastre suelto dentro del bucle
// (`leanV += -dPos * 2.6` y siete líneas más) y por eso nadie pudo probar nunca
// que amortiguara. Acá el gate lo EJECUTA: se le puede dar un golpe, avanzar
// dos segundos y exigir que haya oscilado y que se haya quedado quieto.
//
// LO QUE ESTE ARCHIVO NO HACE: no conoce un solo número de dinero. Recibe una
// altura de trazo ya mapeada y una inclinación de entrada, y devuelve el estado
// del líquido. La frontera entre dato y dibujo no se toca.

/**
 * El estado del líquido dentro de UN orbe. Todo en el marco del vaso: `x` y `z`
 * son la inclinación del plano de agua, `bob` su modo vertical (el pistón), y
 * `spin` cuánto giró el vaso llevándose el agua consigo.
 */
export interface OrbWaterState {
  /** Inclinación del plano, en el eje horizontal de la pantalla. */
  tiltX: number;
  /** Inclinación del plano, en profundidad. */
  tiltZ: number;
  /** Velocidad angular del chapoteo. Es lo que hace la ola, no el reloj. */
  velX: number;
  velZ: number;
  /** Modo vertical: el agua sube y baja entera cuando el nivel cambia de golpe. */
  bob: number;
  bobVel: number;
  /** Giro acumulado del vaso, en radianes. */
  spin: number;
  spinVel: number;
  /** La altura de trazo que el líquido está SIGUIENDO, con su propio retardo. */
  waterline: number;
}

/** Lo que el mundo le hace al vaso en este cuadro. */
export interface OrbWaterInput {
  /** Inclinación del CONTENEDOR: giroscopio + lo que el gesto le imponga. */
  tiltX: number;
  tiltZ: number;
  /** Desplazamiento del carrusel desde el cuadro anterior, en anchos de vía. */
  travel: number;
  /** La altura de trazo objetivo, ya mapeada por `orbWaterline`. */
  waterline: number;
  /** Un golpe deliberado: un recibo, un cruce de capa, una gota que cae. */
  impulse: number;
}

// ── La física, en constantes con nombre y motivo ───────────────────────────
//
// La frecuencia del primer modo de chapoteo de un líquido en un recipiente
// redondo va como sqrt(g/R). No sirve de nada calcularla en metros: el orbe mide
// lo que mide en la pantalla, así que lo que se fija es el PERÍODO que el ojo
// tiene que leer como agua. Con un período mucho más corto el líquido parece
// gelatina; mucho más largo, aceite.

/** Período del chapoteo: ~0,85 s. Es el vaivén de un vaso de agua en la mano. */
export const SLOSH_OMEGA = 7.4;
/**
 * Amortiguación. Por debajo de ~0,08 el agua no se aquieta nunca y marea; por
 * encima de ~0,3 vuelve sin pasarse y entonces NO se lee como líquido, se lee
 * como una aguja de instrumento. 0,15 deja tres vaivenes visibles antes de
 * quedarse quieta, que es lo que hace un vaso de verdad.
 */
export const SLOSH_ZETA = 0.15;
/** El pistón vertical es más rígido y se apaga antes que el chapoteo lateral. */
export const BOB_OMEGA = 11.0;
export const BOB_ZETA = 0.26;
/** Cuánto empuja el agua un desplazamiento del carrusel. */
export const TRAVEL_COUPLING = 3.1;
/** El vaso rueda al viajar: el orbe es un cuerpo, no una lámina que se traslada. */
export const SPIN_COUPLING = 1.35;
export const SPIN_DAMPING = 0.94;
/**
 * El plano no puede inclinarse tanto que salga de la esfera. No es estética: con
 * una inclinación mayor el agua asoma por encima del vidrio.
 */
export const TILT_LIMIT = 0.34;
/** Y el nivel tampoco: el pistón no puede empujar el agua fuera del vaso. */
export const BOB_LIMIT = 0.13;
/** Con qué retardo el líquido alcanza un nivel nuevo. Un líquido no teletransporta. */
export const LEVEL_FOLLOW = 9.0;

export function createOrbWaterState(waterline: number): OrbWaterState {
  const start = Number.isFinite(waterline) ? waterline : 0;
  return {
    tiltX: 0,
    tiltZ: 0,
    velX: 0,
    velZ: 0,
    bob: 0,
    bobVel: 0,
    spin: 0,
    spinVel: 0,
    waterline: start,
  };
}

function clampAbs(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * UN OSCILADOR ARMÓNICO AMORTIGUADO, integrado semi-implícito.
 *
 * `v += a·dt` ANTES de `x += v·dt` — el orden importa. Con Euler explícito el
 * oscilador gana energía en cada paso y termina divergiendo, que en pantalla se
 * ve como un agua que se sacude cada vez más fuerte hasta salirse del vaso.
 * Semi-implícito conserva energía y es incondicionalmente estable con los pasos
 * que da un teléfono cuando pierde cuadros.
 */
function spring(
  position: number,
  velocity: number,
  target: number,
  omega: number,
  zeta: number,
  dt: number,
): { position: number; velocity: number } {
  const accel = -omega * omega * (position - target) - 2 * zeta * omega * velocity;
  const nextVelocity = velocity + accel * dt;
  return { position: position + nextVelocity * dt, velocity: nextVelocity };
}

/**
 * Un cuadro de líquido.
 *
 * `dt` viene en segundos y se ACOTA: cuando la pestaña vuelve de segundo plano
 * el navegador entrega un delta de varios segundos, y un solo paso así lanzaría
 * el agua fuera del vaso. Se acota el paso, no el resultado — el agua sigue las
 * mismas ecuaciones, sólo que no da un salto que ningún líquido daría.
 */
export function advanceOrbWater(
  state: OrbWaterState,
  input: OrbWaterInput,
  dtSeconds: number,
): OrbWaterState {
  const dt = Math.min(1 / 30, Math.max(1 / 240, Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60));
  const travel = Number.isFinite(input.travel) ? input.travel : 0;
  const impulse = Number.isFinite(input.impulse) ? input.impulse : 0;

  // EL GESTO NO INCLINA EL AGUA: LA EMPUJA. Es la diferencia entera entre esto
  // y N3. Mover el vaso no mueve el líquido — le transmite una fuerza, y el
  // líquido responde con su propia masa. Por eso el agua se queda atrás al
  // arrancar y se pasa de largo al frenar, que es lo que el ojo reconoce.
  const velX = state.velX - travel * TRAVEL_COUPLING;

  // El giroscopio es el OBJETIVO de reposo del plano, no su valor. Con el
  // teléfono quieto e inclinado, el agua termina horizontal respecto del suelo
  // — pero llega ahí oscilando, no de un salto.
  const targetX = clampAbs(Number.isFinite(input.tiltX) ? input.tiltX : 0, TILT_LIMIT);
  const targetZ = clampAbs(Number.isFinite(input.tiltZ) ? input.tiltZ : 0, TILT_LIMIT);

  const x = spring(state.tiltX, velX, targetX, SLOSH_OMEGA, SLOSH_ZETA, dt);
  const z = spring(state.tiltZ, state.velZ, targetZ, SLOSH_OMEGA, SLOSH_ZETA, dt);

  // Un recibo, un cruce o una gota: el golpe entra por la VELOCIDAD del pistón,
  // que es como entra un impacto en un líquido de verdad. Empujar la posición
  // daría un salto instantáneo — otra vez el teletransporte.
  const bobStep = spring(
    state.bob,
    state.bobVel + impulse,
    0,
    BOB_OMEGA,
    BOB_ZETA,
    dt,
  );

  const spinVel = (state.spinVel + travel * SPIN_COUPLING) * Math.pow(SPIN_DAMPING, dt * 60);

  // El nivel también se persigue con retardo: cuando el motor afirma una altura
  // nueva el agua VIAJA hasta ella. Exponencial y no lineal, así que llega sin
  // frenar de golpe.
  const targetLine = Number.isFinite(input.waterline) ? input.waterline : state.waterline;
  const follow = 1 - Math.exp(-LEVEL_FOLLOW * dt);

  return {
    tiltX: clampAbs(x.position, TILT_LIMIT),
    tiltZ: clampAbs(z.position, TILT_LIMIT),
    // La velocidad se acota junto con la posición, o el agua rebota contra el
    // tope guardando energía y sale disparada en cuanto puede.
    velX: Math.abs(x.position) >= TILT_LIMIT ? x.velocity * 0.2 : x.velocity,
    velZ: Math.abs(z.position) >= TILT_LIMIT ? z.velocity * 0.2 : z.velocity,
    bob: clampAbs(bobStep.position, BOB_LIMIT),
    bobVel: Math.abs(bobStep.position) >= BOB_LIMIT ? bobStep.velocity * 0.2 : bobStep.velocity,
    spin: state.spin + spinVel * dt,
    spinVel,
    waterline: state.waterline + (targetLine - state.waterline) * follow,
  };
}

/**
 * CUÁNTA OLA HAY. Es la salida que arregla la queja de la «masa deforme»: la
 * amplitud del oleaje sale de la VELOCIDAD del líquido, no del reloj. Un orbe
 * quieto tiene la superficie casi lisa —y un agua quieta se lee como un espejo,
 * que es justo el aspecto que hoy falta—; un orbe que acabás de sacudir tiene
 * olas. Antes el ruido corría igual estuviera pasando algo o no, y por eso el
 * agua se veía siempre igual de revuelta: pura textura.
 */
export function orbWaveEnergy(state: OrbWaterState): number {
  const swirl = Math.sqrt(state.velX * state.velX + state.velZ * state.velZ);
  const piston = Math.abs(state.bobVel);
  return Math.min(1, swirl * 0.42 + piston * 0.30);
}

/**
 * Lo que el vidrio no puede esconder: el plano de agua está QUIETO.
 * Se usa para no gastar cuadros cuando no hay nada que mostrar, y es la razón de
 * que se pueda pausar el bucle sin que el agua quede a mitad de un chapoteo.
 */
export function orbWaterAtRest(state: OrbWaterState, target: number): boolean {
  return (
    orbWaveEnergy(state) < 0.002 &&
    Math.abs(state.bob) < 0.001 &&
    Math.abs(state.waterline - target) < 0.001
  );
}

// ── N3C · EL RELOJ DEL CAMPO DE COLOR ──────────────────────────────────────
//
// El campo de ellos no corre con el reloj de pared: corre con su propio reloj,
// que ACELERA cuando hay voz. Es la mitad de por qué el orbe parece escuchar —
// no cambia de color, cambia de ritmo.
//
// Vive acá, puro, por la misma razón que el resto de este archivo: lo que sólo
// existe dentro de un `requestAnimationFrame` no se puede ejecutar, y entonces
// «se mueve más rápido cuando hablás» es una afirmación de fe. Acá el gate lo
// integra y le exige que un minuto hablando avance más que un minuto callado.

/** La velocidad del campo, en unidades de reloj por segundo. */
export function orbFieldSpeed(drive: number): number {
  const bounded = Math.min(1, Math.max(0, Number.isFinite(drive) ? drive : 0));
  // N3C r3 · MEDIDO, y era el defecto. Con la curva de su componente
  // (`0.1 + (1 - (v-1)^2) * 0.9`) el campo tardaba CUARENTA Y CINCO SEGUNDOS en
  // cruzar una mancha estando en reposo: no es «se mueve despacio», es que no
  // se mueve. El founder lo dijo de las dos maneras — «el nuestro es mucho más
  // estático» y «cuando hablo casi no hay movimiento».
  //
  // La forma de la curva se conserva —arranca lento y acelera con la voz— y lo
  // que cambia es la ESCALA: en reposo una mancha cruza en ~4 s, y hablando en
  // algo más de 1 s. Eso es lo que se ve como «se está moviendo todo el tiempo»
  // y como «responde exacto» al hablar.
  // N3C r4 · la ronda 3 se pasó de largo. El founder: «está muy rápido y muy
  // brusco». De 45 s por mancha pasé a 4,3, y 4,3 es demasiado para un campo
  // que tiene que sentirse calmo. Acá queda en ~11 s callado y ~3 hablando:
  // se mueve todo el tiempo, se nota, y no corre.
  // N3C r5 · con DEFORMACIÓN en vez de transporte, el reloj puede volver a
  // correr sin que se lea como velocidad: nada cruza el orbe. Lo que se nota
  // es que las manchas cambian de forma, y eso quiere ritmo.
  return 0.42 + (1 - Math.pow(bounded - 1, 2)) * 2.60;
}

/** Un paso del reloj del campo. Monótono: el campo nunca retrocede. */
export function advanceOrbField(current: number, drive: number, dtSeconds: number): number {
  const dt = Math.min(1 / 30, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60));
  const base = Number.isFinite(current) ? current : 0;
  return base + dt * orbFieldSpeed(drive);
}

/**
 * CUÁNTO EMPUJA EL CAMPO: la voz manda y el chapoteo acompaña. Es el mismo
 * número que el shader arma para estirar los óvalos, escrito una sola vez.
 */
export function orbFieldDrive(voice: number, wave: number): number {
  const v = Number.isFinite(voice) ? voice : 0;
  const w = Number.isFinite(wave) ? wave : 0;
  return Math.min(1, Math.max(0, v * 0.9 + w * 0.25));
}
