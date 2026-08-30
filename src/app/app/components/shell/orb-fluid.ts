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
export const ORB_FLUID_DYE_SIZE = 640;

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
/** Y cuánto se desvanece el rastro. Más lento que la velocidad: deja estela. */
// 0,10 y no 0,045: con la disipación muy baja el rastro desarrolla frentes
// AFILADOS —un fluido sin difusión los produce solo— y esos frentes son los
// cortes duros que aparecían cada tanto. Un poco de disipación los suaviza
// sin quitarle estela.
export const ORB_FLUID_DYE_DISSIPATION = 1.0;

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
export const ORB_FLUID_MAP_RELAX = 0.20;
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
export const ORB_FLUID_GRID = 190;

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
export const ORB_FLUID_AMBIENT_FORCE = 5.5;

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
/** Y el de la voz, que es el que tiene que sentirse como una respuesta. */
export const ORB_FLUID_VOICE_FORCE = 3.2;

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
}): OrbFluidSplat[] {
  const dt = Math.min(1 / 30, Math.max(1 / 240, finite(input.dtSeconds, 1 / 60)));
  const t = finite(input.time);
  const voice = clamp01(input.voice);
  const wave = clamp01(input.wave);
  const splats: OrbFluidSplat[] = [];

  // Cinco agitadores, cada uno con SU velocidad, y ninguna es múltiplo de otra:
  // así no vuelven a alinearse nunca y el fluido no se asienta en una figura.
  const ritmos = [0.231, 0.317, 0.409, 0.173, 0.541];
  const ritmosY = [0.187, 0.263, 0.347, 0.451, 0.139];
  for (let i = 0; i < ORB_FLUID_STIRRERS; i += 1) {
    const phase = i * 2.3999632;
    const wx = ritmos[i]!;
    const wy = ritmosY[i]!;
    const alcance = 0.19 + 0.09 * ((i * 7) % 5) / 4;
    const ax = 0.5 + alcance * Math.sin(t * wx + phase);
    const ay = 0.5 + alcance * Math.cos(t * wy + phase * 1.7);
    // la dirección es la DERIVADA de la trayectoria: el agitador empuja hacia
    // donde va, que es lo que hace un dedo dentro del agua
    // la dirección normalizada: la fuerza la ponen las constantes, no la
    // velocidad del agitador, que sólo dice HACIA DÓNDE
    let ux = Math.cos(t * wx + phase) * wx;
    let uy = -Math.sin(t * wy + phase * 1.7) * wy;
    const norma = Math.hypot(ux, uy) || 1;
    ux /= norma; uy /= norma;
    // GIRAN LA DIRECCIÓN UN CUARTO DE VUELTA, Y ALTERNANDO EL SENTIDO.
    //
    // Empujando hacia donde van, los cinco suman una corriente de conjunto: la
    // coherencia medida subió a 0,49 contra 0,12 de ellos, y eso es exactamente
    // lo que el ojo lee como «una capa que pasa». Empujando de costado, cada uno
    // inyecta un REMOLINO en vez de arrastre, y con sentidos alternos la suma se
    // cancela: queda el corte entre remolinos, que es lo que revuelve el campo
    // sin llevarlo a ninguna parte.
    const giro = i % 2 === 0 ? 1 : -1;
    const gx = -uy * giro, gy = ux * giro;
    ux = gx; uy = gy;
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

  if (voice > 0.02) {
    for (let i = 0; i < 3; i += 1) {
      const phase = i * 2.0943951;
      const spin = t * (0.83 + i * 0.31) + phase;
      const reach = 0.20 + 0.16 * voice;
      const force = ORB_FLUID_VOICE_FORCE * voice;
      const ux = Math.cos(spin), uy = Math.sin(spin);
      splats.push({
        x: 0.5 + reach * ux,
        y: 0.5 + reach * uy,
        // empuja hacia AFUERA desde el centro: la voz abre el fluido, no lo
        // arrastra hacia un lado
        dx: ux * force * ORB_FLUID_GRID * dt * 60,
        dy: uy * force * ORB_FLUID_GRID * dt * 60,
        tx: ux * ORB_FLUID_TRAIL * force * 1.6,
        ty: uy * ORB_FLUID_TRAIL * force * 1.6,
        tz: ORB_FLUID_TRAIL * force,
        radius: 0.0180 + 0.016 * voice,
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
  /** La textura que el orbe mira: xy = desplazamiento advectado, z = densidad. */
  texture: WebGLTexture;
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
const SPLAT = `${HEAD}
uniform sampler2D uTarget;
uniform float uRadius;
uniform vec3 uValue;
uniform vec2 uPoint;
void main(){
  vec2 p = vUv - uPoint;
  vec3 splat = exp(-dot(p, p) / uRadius) * uValue;
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
}`;

// ADVECCIÓN: cada punto toma el valor de DONDE VENÍA. Es el corazón de todo:
// el campo no se desplaza entero, cada trozo viaja por su cuenta siguiendo la
// velocidad local, y por eso se enrosca en vez de pasar.
const ADVECT = `${HEAD}
uniform sampler2D uVelocity, uSource;
uniform vec2 uTexelSize;
uniform float uDt, uDissipation, uRelax;
void main(){
  vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
  vec4 r = texture2D(uSource, coord) / (1.0 + uDissipation * uDt);
  // N3C r12 · LA RELAJACIÓN HACIA LA IDENTIDAD.
  // Con uRelax = 0 esto es la advección clásica del original MIT. Con uRelax > 0
  // el mapa material vuelve LENTAMENTE a su sitio, lo que acota el filamentado
  // sin volver a anclar el dibujo: el patrón se aleja de su pasado —que es lo
  // que faltaba— pero no se deshilacha al infinito.
  gl_FragColor = mix(r, vec4(vUv, 0.0, 1.0), clamp(uRelax * uDt, 0.0, 1.0));
}`;

// N3C r12 · EL MAPA MATERIAL EMPIEZA SIENDO LA IDENTIDAD: cada punto guarda su
// propia coordenada. Advectado, cada punto guarda DE DÓNDE VINO, y esa
// diferencia es un desplazamiento que crece — no un empujón acotado que vuelve.
const IDENTITY = `${HEAD}
void main(){ gl_FragColor = vec4(vUv, 0.0, 1.0); }`;

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
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 vel = texture2D(uVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
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
  const pressure = double(ORB_FLUID_SIM_SIZE);
  const divergence = makeFbo(ORB_FLUID_SIM_SIZE);
  const curl = makeFbo(ORB_FLUID_SIM_SIZE);
  if (!velocity || !dye || !pressure || !divergence || !curl) {
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
    step(dtSeconds, splats, iterations) {
      if (disposed || gl.isContextLost()) return;
      const dt = Math.min(1 / 30, Math.max(1 / 240, Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60));
      gl.disable(gl.BLEND);
      bindQuad();

      for (const s of splats) {
        usarPrograma(progs.splat, velocity.read.texel);
        bindTex(progs.splat, "uTarget", 2, velocity.read.tex);
        gl.uniform2f(u(progs.splat, "uPoint"), s.x, s.y);
        gl.uniform3f(u(progs.splat, "uValue"), s.dx, s.dy, 0);
        gl.uniform1f(u(progs.splat, "uRadius"), s.radius);
        blit(velocity.write);
        velocity.swap();

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
      bindTex(progs.advect, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.advect, "uSource", 3, velocity.read.tex);
      blit(velocity.write);
      velocity.swap();

      usarPrograma(progs.advect, dye.read.texel);
      gl.uniform2f(u(progs.advect, "uTexelSize"), velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1f(u(progs.advect, "uDt"), dt);
      // El mapa material NO se disipa: una coordenada no se desvanece hacia cero,
      // se relaja hacia su identidad. Disiparla arrastraría todo el orbe hacia
      // la esquina inferior izquierda.
      gl.uniform1f(u(progs.advect, "uDissipation"), 0);
      gl.uniform1f(u(progs.advect, "uRelax"), ORB_FLUID_MAP_RELAX);
      bindTex(progs.advect, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.advect, "uSource", 3, dye.read.tex);
      blit(dye.write);
      dye.swap();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const p of todos) if (p) gl.deleteProgram(p);
      for (const f of [velocity.read, velocity.write, dye.read, dye.write, pressure.read, pressure.write, divergence, curl]) {
        gl.deleteTexture(f.tex);
        gl.deleteFramebuffer(f.fbo);
      }
      gl.deleteBuffer(quad);
    },
  };
}
