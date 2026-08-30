// Bloque N3C ronda 6 — EL FLUIDO. Lo que mueve el color de verdad.
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

/** Lado de la rejilla de velocidad. Cuadrada: el orbe también lo es. */
export const ORB_FLUID_SIM_SIZE = 128;

/** Lado de la rejilla del tinte, que es la que el orbe mira. */
export const ORB_FLUID_DYE_SIZE = 192;

/**
 * Iteraciones de presión por escalón de calidad. El nivel 1 NO corre fluido:
 * es el degradado honesto para un teléfono que no puede con texturas de coma
 * flotante, y el orbe vuelve a su deformación de ruido.
 */
export const ORB_FLUID_ITERATIONS: Record<1 | 2 | 3, number> = { 1: 0, 2: 8, 3: 14 };

/** Cuánto se frena el fluido por segundo. Sin esto no se aquieta nunca. */
export const ORB_FLUID_VELOCITY_DISSIPATION = 0.34;
/** Y cuánto se desvanece el rastro. Más lento que la velocidad: deja estela. */
export const ORB_FLUID_DYE_DISSIPATION = 0.16;
/** La vorticidad: cuánto se enrosca. Es lo que hace que «bordee la esfera». */
export const ORB_FLUID_CURL = 22;

/** Una salpicadura: dónde se empuja el fluido, hacia dónde y con cuánta fuerza. */
export interface OrbFluidSplat {
  /** 0–1 en la rejilla. */
  x: number;
  y: number;
  /** El empujón, en unidades de la rejilla por segundo. */
  dx: number;
  dy: number;
  /** Radio del empujón, al cuadrado, como lo quiere el shader. */
  radius: number;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, finite(value)));
}

/** El empujón de fondo: lo que mantiene el fluido vivo sin que pase nada. */
export const ORB_FLUID_AMBIENT_FORCE = 0.85;
/** Y el de la voz, que es el que tiene que sentirse como una respuesta. */
export const ORB_FLUID_VOICE_FORCE = 5.0;

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

  for (let i = 0; i < 2; i += 1) {
    const phase = i * 2.3999632;
    const ax = 0.5 + 0.28 * Math.sin(t * 0.231 + phase);
    const ay = 0.5 + 0.28 * Math.cos(t * 0.187 + phase * 1.7);
    // la dirección es la DERIVADA de la trayectoria: el agitador empuja hacia
    // donde va, que es lo que hace un dedo dentro del agua
    const force = ORB_FLUID_AMBIENT_FORCE * dt * (1 + wave * 1.4);
    splats.push({
      x: ax,
      y: ay,
      dx: Math.cos(t * 0.231 + phase) * 0.231 * 0.28 * force * 60,
      dy: -Math.sin(t * 0.187 + phase * 1.7) * 0.187 * 0.28 * force * 60,
      radius: 0.0090,
    });
  }

  if (voice > 0.02) {
    for (let i = 0; i < 3; i += 1) {
      const phase = i * 2.0943951;
      const spin = t * (0.83 + i * 0.31) + phase;
      const reach = 0.20 + 0.16 * voice;
      const force = ORB_FLUID_VOICE_FORCE * voice * dt;
      splats.push({
        x: 0.5 + reach * Math.cos(spin),
        y: 0.5 + reach * Math.sin(spin),
        // empuja hacia AFUERA desde el centro: la voz abre el fluido, no lo
        // arrastra hacia un lado
        dx: Math.cos(spin) * force * 60,
        dy: Math.sin(spin) * force * 60,
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
uniform float uDt, uDissipation;
void main(){
  vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
  gl_FragColor = texture2D(uSource, coord) / (1.0 + uDissipation * uDt);
}`;

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
export function createOrbFluid(gl: Gl): OrbFluid | null {
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

        usarPrograma(progs.splat, dye.read.texel);
        bindTex(progs.splat, "uTarget", 2, dye.read.tex);
        gl.uniform2f(u(progs.splat, "uPoint"), s.x, s.y);
        // el rastro guarda HACIA DÓNDE empujó: por eso el orbe puede leerlo
        // como un desplazamiento y no como un color
        gl.uniform3f(u(progs.splat, "uValue"), s.dx * 0.030, s.dy * 0.030, Math.hypot(s.dx, s.dy) * 0.020);
        gl.uniform1f(u(progs.splat, "uRadius"), s.radius);
        blit(dye.write);
        dye.swap();
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
      bindTex(progs.advect, "uVelocity", 2, velocity.read.tex);
      bindTex(progs.advect, "uSource", 3, velocity.read.tex);
      blit(velocity.write);
      velocity.swap();

      usarPrograma(progs.advect, dye.read.texel);
      gl.uniform2f(u(progs.advect, "uTexelSize"), velocity.read.texel[0], velocity.read.texel[1]);
      gl.uniform1f(u(progs.advect, "uDt"), dt);
      gl.uniform1f(u(progs.advect, "uDissipation"), ORB_FLUID_DYE_DISSIPATION);
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
