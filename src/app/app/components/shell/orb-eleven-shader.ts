import {
  createOrbFluid,
  orbFluidSplats,
  ORB_FLUID_DYE_SIZE,
  type OrbFluid,
} from "./orb-fluid";
import type { OrbAudioBands } from "./voice-capture-contract";
import type { OrbRgb } from "./orb-shader";
import { paintOrbGradient } from "./orb-gradient-texture";

/**
 * N3C r29 · EL PORTE FIEL DE SU ORBE, CON NUESTROS COLORES.
 *
 * Tres rondas ajustando la ley de la voz sobre NUESTRO orbe y el founder siguió
 * diciendo lo mismo: «no se parece en nada». Tenía razón, y el problema no era
 * la voz: es la arquitectura del dibujo. Leyendo su shader entero queda claro
 * que su orbe no es un campo de color procedural con una deformación suave —es
 * otra cosa:
 *
 *   1 · un DEGRADADO (una imagen de color) que se muestrea…
 *   2 · …con una coordenada ESFÉRICA (la textura se estira hacia la silueta)…
 *   3 · …ARRASTRADA radialmente por un fbm con deformación de dominio, con una
 *        amplitud ENORME: 0,65 en unidades de la propia textura, o sea que cada
 *        punto puede leer el degradado a un tercio de distancia de donde
 *        debería. Eso es lo que produce las bandas anchas que barren.
 *   4 · …más un desplazamiento de ruido simple (0,15) y el del fluido (0,001).
 *
 * Lo nuestro deformaba 0,12–0,22 en unidades de RUIDO, que es entre seis y diez
 * veces menos y en otro espacio. De ahí el moteado suave en vez de las bandas.
 *
 * Acá va la MISMA estructura con nuestro degradado: los tres colores de la capa
 * repartidos en un campo suave. La técnica es suya; el código es nuestro y los
 * colores son los que el founder aprobó.
 *
 * Vive aparte a propósito: el orbe de producción no se toca hasta que el founder
 * diga que este se parece.
 */

const VERT = `
attribute vec2 aQuad;
varying vec2 vUv;
void main(){
  vUv = aQuad * 0.5 + 0.5;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

/** Sus constantes, leídas de su configuración. */
export const EL_SPHERE_SCALE = 0.9;
export const EL_SPHERE_POWER = 1.1;
export const EL_FBM_SCALE = 3.25;
export const EL_FBM_POWER = 2.75;
export const EL_FBM_AMPLITUDE = 0.65;
export const EL_FBM_SPEED = 4.5;
export const EL_NOISE_SCALE = 0.65;
export const EL_NOISE_SPEED = 0.25;
export const EL_NOISE_AMPLITUDE = 0.15;
// El arco SUMA luz encima del orbe. Con su 0,25 el 42% de los cuadros hablando
// tenían algún píxel en 1,0 —quemado—, porque nuestro degradado llega más claro
// a la zona del arco que el suyo. 0,17 lo deja en cero quemados sin que el arco
// deje de verse.
export const EL_RING_OPACITY = 0.17;
export const EL_FLUID_OPACITY = 0.1;
export const EL_EXPOSURE = 0.15;
export const EL_SATURATION = 1.0;
export const EL_CONTRAST = 0.0;
export const EL_TIME_SCALE = 1.4;
/**
 * N3C r31 · CUÁNTO ACELERA EL SONIDO LOS RELOJES, y por qué NO es su constante.
 *
 * Su shader suma el audio integrado a los relojes con coeficientes 0,25 · 0,1 ·
 * 0,2. Portados tal cual, nuestro orbe pasa de 1,45 a 3,6 de cambio por cuadro
 * al hablar. Medí el suyo con el mismo instrumento y su orbe **cambia lo mismo
 * callado (1,36) que hablando (1,40)**: el sonido le cambia la ESTRUCTURA —el
 * arco aparece, el hueco se abre, los anillos nacen— pero no la velocidad.
 *
 * Eso es exactamente lo que el founder describió como «el movimiento está cerca
 * pero sigue sin ser tan fluido»: un orbe que se acelera dos veces y media al
 * hablar se lee agitado, no fluido.
 *
 * No sé por qué su fórmula no les acelera a ellos —puede haber un tope que no
 * encontré, o su pintura satura antes—. Lo que sí sé es lo que MIDE su orbe, y
 * la vara es ésa. Este factor lleva el término del audio a donde su conducta
 * dice que tiene que estar.
 */
export const EL_AUDIO_CLOCK = 0.02;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform vec4 uAvg;        // graves, medios, agudos, total — el PROMEDIO
uniform vec4 uCum;        // los mismos, INTEGRADOS
uniform vec4 uSlow;       // …y los mismos, LENTOS (900 ms)
uniform vec3 uDeep, uLiquid, uAccent;
uniform sampler2D uFluid;
uniform sampler2D uGradient;
uniform float uHasFluid;
uniform float uGrain;

float random(vec2 p){
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}
float noise(vec2 st){
  vec2 i = floor(st), f = fract(st);
  float a = random(i), b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0)), d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
// 4 octavas con rotación entre ellas, que es la forma clásica y la que ellos usan
float fbm(vec2 st){
  float v = 0.0, a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for(int i = 0; i < 4; i++){
    v += a * noise(st);
    st = rot * st * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}
// ── N3C r31 · SIMPLEX 3D DE VERDAD ────────────────────────────────────────
//
// El porte usaba un ruido de valor con hash de seno, interpolado trilineal.
// Ellos usan simplex. La diferencia no es de gusto: un ruido de valor tiene
// derivada discontinua en cada celda, así que al avanzar su coordenada de
// tiempo el dibujo cambia A SALTOS. Medido con el mismo instrumento en las dos
// pantallas: nuestro porte cambiaba 2,58 por cuadro contra 1,40 del suyo —o sea
// que se movía MÁS y se veía menos fluido—, que es exactamente lo que el
// founder describió: «el movimiento está cerca pero sigue sin ser tan fluido».
//
// Implementación clásica de Ashima Arts / Stefan Gustavson (MIT), que es la
// misma familia que usa cualquier snoise de WebGL.
vec3 mod289_3(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289_4(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute4(vec4 x){ return mod289_4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float noise3(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289_3(i);
  vec4 p = permute4(permute4(permute4(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt4(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ── N3C r31 · SUS FUNCIONES DE COLOR, EXACTAS ─────────────────────────────
//
// El porte tenía nuestro tonemap ACES y ELLOS NO HACEN TONEMAP: su shader
// termina en un clamp y ya. Se vio aislando: metiendo SU textura naranja en
// nuestro porte, el resultado salía crema lavado y el suyo no. ACES comprime los
// altos y desatura — justo lo que le faltaba de fuerza al porte.
vec3 contrasteEl(vec3 c, float v){
  return clamp(0.5 + (1.0 + v) * (c - 0.5), vec3(0.0), vec3(1.0));
}
vec3 exposicionEl(vec3 c, float v){ return (1.0 + v) * c; }
vec3 saturacionEl(vec3 rgb, float k){
  vec3 W = vec3(0.2125, 0.7154, 0.0721);
  return mix(vec3(dot(rgb, W)), rgb, k);
}
float overlayEl(float b, float m){
  return b < 0.5 ? (2.0 * b * m) : (1.0 - 2.0 * (1.0 - b) * (1.0 - m));
}
vec3 overlayEl(vec3 b, vec3 m){
  return vec3(overlayEl(b.r, m.r), overlayEl(b.g, m.g), overlayEl(b.b, m.b));
}
vec3 luzDuraEl(vec3 base, vec3 mezcla, float opacidad){
  return overlayEl(mezcla, base) * opacidad + base * (1.0 - opacidad);
}

void main(){
  vec2 uv0 = vec2(1.0 - vUv.x, vUv.y);
  vec2 uvDot = (uv0 - 0.5) * 2.0;
  float rr = dot(uvDot, uvDot);

  // ── 1 · LA COORDENADA ESFÉRICA ──
  float d = sqrt(max(1.0 - clamp(rr, 0.0, 1.0), 0.0));
  d = pow(d, ${EL_SPHERE_POWER.toFixed(2)});
  vec3 normals = vec3(uvDot, d);
  vec2 uv = uvDot / ((vec2(d, d) + vec2(1.0)) * (1.0 / ${EL_SPHERE_SCALE.toFixed(2)}));
  uv = (uv + 1.0) * 0.5;

  // ── 2 · LA DEFORMACIÓN DE DOMINIO ──
  // El integrado corre el reloj; el promedio, más abajo, escala amplitudes.
  float fbmTime2 = uTime * (${EL_FBM_SPEED.toFixed(2)} * 0.5) + uCum.x * (0.25 * ${EL_AUDIO_CLOCK.toFixed(3)});
  vec2 fbmUv = uv * ${EL_FBM_SCALE.toFixed(2)};
  vec2 q = vec2(fbm(fbmUv), fbm(fbmUv + vec2(1.0)));
  vec2 r = vec2(
    fbm(fbmUv + q + vec2(91.3, 0.55) + 0.15 * fbmTime2),
    fbm(fbmUv + q - vec2(45.33, 1.2) + 0.126 * fbmTime2)
  );
  float f = fbm(fbmUv + r);
  float ffbm = mix(0.8, 0.66, clamp(f * f * ${EL_FBM_POWER.toFixed(2)}, 0.0, 1.0));
  ffbm = mix(ffbm, 0.0, clamp(length(q), 0.0, 1.0));
  ffbm = mix(ffbm, 1.0, clamp(length(r.x), 0.0, 1.0));

  float noiseTime1 = uTime * ${EL_NOISE_SPEED.toFixed(2)} * 0.5 + uCum.z * (0.1 * ${EL_AUDIO_CLOCK.toFixed(3)});
  float noiseTime2 = uTime * ${EL_NOISE_SPEED.toFixed(2)};
  vec2 noiseDisp = vec2(
    noise3(vec3(vUv * ${EL_NOISE_SCALE.toFixed(2)}, noiseTime1)),
    noise3(vec3(vUv * ${EL_NOISE_SCALE.toFixed(2)} + vec2(54.0), noiseTime2))
  );
  noiseDisp *= 1.0 + uAvg.z * 0.25;

  // N3C r29 · el fluido se lee en vUv y del TINTE, no del mapa material.
  // Su uFluidSimTexture es su densidad —lo que lleva los anillos—; nuestro
  // mapa material guarda DESPLAZAMIENTO y es de 24 px a propósito, así que
  // leerlo acá era leer otra cosa con otra escala.
  vec3 fluido = vec3(0.0);
  if(uHasFluid > 0.5) fluido = texture2D(uFluid, vUv).rgb;

  // ── 3 · EL ARRASTRE, que es lo que produce las bandas ──
  uv += -fluido.rg * 0.001;
  uv += normals.xy * (ffbm - 0.5) * ${EL_FBM_AMPLITUDE.toFixed(2)};
  uv += noiseDisp * ${EL_NOISE_AMPLITUDE.toFixed(2)};

  // Su muestreo: la textura es cuadrada y el lienzo también, así que su
  // getCoverUv es la identidad y no hace falta. Se repite en espejo para que un
  // arrastre que se sale del cuadro no encuentre un borde duro — el suyo usa el
  // borde repetido de la imagen, que con su fondo claro da lo mismo.
  // Su textura se muestrea con el borde REPETIDO (clamp): su fondo es claro, así
  // que salirse no produce un salto. Espejar, en cambio, dibuja una costura.
  vec2 tuv = clamp(uv, 0.0, 1.0);
  vec3 color = texture2D(uGradient, tuv).rgb;

  // ── 4 · EL ARCO, que sólo existe con sonido ──
  vec2 ringUv = uvDot * 0.75;
  float ang = atan(ringUv.y, ringUv.x);
  float len = length(ringUv);
  float ringTime = (-uTime * 0.5) - uCum.a * (0.2 * ${EL_AUDIO_CLOCK.toFixed(3)});
  // ── N3C r29 · EL ARCO VA CON EL RELOJ LENTO, y esto es una CORRECCIÓN sobre
  // su propio código, medida.
  //
  // El suyo cuelga el desplazamiento del anillo y su compuerta del promedio
  // RÁPIDO. Portado tal cual, el arco parpadea una vez por sílaba: medido,
  // correlación a ocho cuadros −32 con el arco encendido y +0,78 apagándolo,
  // contra los +2,3 del suyo. En el suyo se nota menos porque su arco va sobre
  // un degradado claro y pesa poco; sobre nuestro líquido oscuro, salta.
  //
  // La rotación SÍ sigue con el integrado —es un reloj, y acelerar un giro no lo
  // invierte—. Lo que pasa al lento es lo que tiene amplitud. Es exactamente el
  // principio de la r27, aplicado ahora a un término que copiamos de ellos.
  ringUv.x += 1.0 + uSlow.y * 1.5;
  float escala = 0.65 + uSlow.x * 0.4;
  float n0 = noise3(vec3(ringUv * escala, ringTime * 0.5)) * 0.5 + 0.5;
  float cl = cos(ang + ringTime * 2.0) * 0.5 + 0.5;
  float v2 = smoothstep(1.0, mix(0.25, 1.0, n0 * 0.5), len);
  float v3 = pow(smoothstep(0.25, mix(0.25, 1.0, n0 * 0.75), len), 2.0);
  cl = cl * v2 * v3;
  cl = clamp(pow(cl * min(uSlow.a * 4.0, 1.0), 3.0), 0.0, 1.0);
  color += vec3(cl) * ${EL_RING_OPACITY.toFixed(2)};

  // ── 5 · EL FLUIDO COMO LUZ, con SU mezcla ──
  color = luzDuraEl(color, vec3(1.0), length(fluido) * 0.01 * ${EL_FLUID_OPACITY.toFixed(2)});

  // ── 6 · SU CORRECCIÓN DE COLOR, en su orden: saturación, contraste,
  // exposición. Y NADA de tonemap: terminan en un clamp.
  color = saturacionEl(color, ${EL_SATURATION.toFixed(2)});
  color = contrasteEl(color, ${EL_CONTRAST.toFixed(2)});
  color = exposicionEl(color, ${EL_EXPOSURE.toFixed(2)});
  color = clamp(color, 0.0, 1.0);

  float aa = fwidth(sqrt(rr)) + 1e-4;
  float mascara = 1.0 - smoothstep(1.0 - aa, 1.0, sqrt(rr));
  gl_FragColor = vec4(color * mascara, mascara);
}`;

export interface ElevenOrbFrame {
  timeSeconds: number;
  dtSeconds: number;
  average: OrbAudioBands;
  cumulative: OrbAudioBands;
  /** Las mismas bandas con el envolvente lento: lo que puede mover amplitudes. */
  slow: OrbAudioBands;
  /** Qué capa es: decide su cuadro pintado. */
  seed: number;
  /** Cinco tonos explícitos, de oscuro a claro. Para replicar una paleta ajena. */
  tonos?: readonly OrbRgb[];
  risingAll: number;
  deep: OrbRgb;
  liquid: OrbRgb;
  accent: OrbRgb;
  grain?: number;
}

export interface ElevenOrbRenderer {
  resize(css: number, dpr: number): { width: number; height: number };
  /** Sólo para medir: reemplaza el degradado pintado por una imagen. */
  useImage(img: TexImageSource): void;
  draw(frame: ElevenOrbFrame): void;
  hasFluid(): boolean;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, tipo: number, src: string) {
  const sh = gl.createShader(tipo);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function createElevenOrbRenderer(
  canvas: HTMLCanvasElement,
): ElevenOrbRenderer | null {
  const gl =
    (canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      // N3C r29 · sin esto el lienzo se lee VACÍO fuera del cuadro en que se
      // dibujó, y toda medición sobre él da cero sin que nada esté roto.
      preserveDrawingBuffer: true,
    }) as
      | WebGLRenderingContext
      | null) ?? null;
  if (!gl) return null;
  gl.getExtension("OES_standard_derivatives");
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(
    gl,
    gl.FRAGMENT_SHADER,
    `#extension GL_OES_standard_derivatives : enable\n${FRAG}`,
  );
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aQuad");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const fluid: OrbFluid | null = createOrbFluid(gl, true);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const locs = {
    time: u("uTime"), avg: u("uAvg"), cum: u("uCum"), slow: u("uSlow"),
    deep: u("uDeep"), liquid: u("uLiquid"), accent: u("uAccent"),
    fluid: u("uFluid"), hasFluid: u("uHasFluid"), grain: u("uGrain"),
    gradient: u("uGradient"),
  };

  // ── LA TEXTURA PINTADA ──
  const gradTex = gl.createTexture();
  let gradSeed = -1;
  /**
   * N3C r31 · PODER PONER SU TEXTURA, para separar los dos problemas.
   *
   * El founder: «replica exactamente su orbe naranja, el de Narration, con los
   * mismos colores y tonos, así eliminamos factores». Es el método correcto y se
   * puede llevar más lejos: si nuestro shader come SU imagen y el resultado es
   * idéntico al suyo, entonces el shader está bien y lo único que falla es
   * nuestra pintura. Y si no es idéntico, la diferencia está en el shader y la
   * pintura no tiene nada que ver.
   *
   * Sólo para medir: se pasa desde la mesa de luz y nunca desde producción.
   */
  const subirImagen = (img: TexImageSource) => {
    if (!gradTex) return;
    gradSeed = -2;
    gl.bindTexture(gl.TEXTURE_2D, gradTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    conMipmaps();
  };
  /**
   * N3C r31 · LOS MIPMAPS, que estaban en su cargador y yo no había portado
   * (`generateMipmaps: true`). No es un detalle de rendimiento: es LO QUE MATA
   * EL HORMIGUEO DEL GRANO.
   *
   * La textura trae grano, y el escorzo esférico la MINIFICA hacia la silueta.
   * Sin mipmaps cada cuadro muestrea granos distintos y el grano CAMINA: medido,
   * nuestro orbe cambiaba 8–10 por cuadro contra 1,4 del suyo, callado y
   * hablando por igual. Eso no es movimiento, es hormigueo — y es justo lo que
   * hace que se lea «menos fluido».
   *
   * Con mipmaps el grano se promedia donde la textura se comprime, que es lo que
   * hace cualquier motor con una textura minificada.
   */
  const conMipmaps = () => {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const subirGradiente = (frame: ElevenOrbFrame) => {
    if (!gradTex || gradSeed === -2 || frame.seed === gradSeed) return;
    const cv = paintOrbGradient({
      deep: frame.deep, liquid: frame.liquid, accent: frame.accent,
      seed: frame.seed, tonos: frame.tonos,
    });
    if (!cv) return;
    gradSeed = frame.seed;
    gl.bindTexture(gl.TEXTURE_2D, gradTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    conMipmaps();
  };
  let disposed = false;

  return {
    resize(css, dpr) {
      const d = Math.min(Math.max(dpr || 1, 1), 2);
      const px = Math.max(1, Math.round(css * d));
      if (canvas.width !== px) canvas.width = px;
      if (canvas.height !== px) canvas.height = px;
      gl.viewport(0, 0, px, px);
      return { width: px, height: px };
    },
    useImage(img) {
      subirImagen(img);
    },
    draw(frame) {
      if (disposed || gl.isContextLost()) return;
      if (fluid) {
        fluid.step(
          frame.dtSeconds,
          orbFluidSplats({
            time: frame.timeSeconds,
            voice: frame.average.all,
            wave: 0,
            dtSeconds: frame.dtSeconds,
            audio: {
              average: frame.average,
              cumulative: frame.cumulative,
              risingAll: frame.risingAll,
            },
          }),
          3,
        );
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(locs.time, frame.timeSeconds * EL_TIME_SCALE);
      const a = frame.average;
      const c = frame.cumulative;
      gl.uniform4f(locs.avg, a.low, a.mid, a.high, a.all);
      gl.uniform4f(locs.cum, c.low, c.mid, c.high, c.all);
      const sl = frame.slow;
      gl.uniform4f(locs.slow, sl.low, sl.mid, sl.high, sl.all);
      gl.uniform3fv(locs.deep, frame.deep);
      gl.uniform3fv(locs.liquid, frame.liquid);
      gl.uniform3fv(locs.accent, frame.accent);
      gl.uniform1f(locs.grain, frame.grain ?? 0.10);
      gl.uniform1f(locs.hasFluid, fluid ? 1 : 0);
      subirGradiente(frame);
      if (gradTex) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, gradTex);
        gl.uniform1i(locs.gradient, 2);
      }
      if (fluid) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fluid.lightTexture);
        gl.uniform1i(locs.fluid, 1);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      void ORB_FLUID_DYE_SIZE;
    },
    hasFluid() {
      return fluid !== null;
    },
    dispose() {
      disposed = true;
      fluid?.dispose();
      gl.deleteProgram(prog);
      if (gradTex) gl.deleteTexture(gradTex);
      gl.deleteBuffer(buf);
    },
  };
}
