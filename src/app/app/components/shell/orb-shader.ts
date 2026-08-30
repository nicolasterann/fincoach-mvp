// Bloque N3 — el orbe deja de ser un lienzo quieto en el centro.
//
// LA FORMA NUEVA: los cinco orbes viven en UN solo lienzo, y el lienzo es el
// carrusel. Cada orbe se dibuja en su propio cuadrilátero, con su centro
// derivado del desplazamiento de la vía. Deslizar los mueve a todos; las
// vecinas asoman a los costados. No hay cambio de capa: hay movimiento — y la
// familia de defectos que costó N2 (sustitución, relevo, lag de una capa) deja
// de existir porque ya no hay nada que sustituir.
//
// Por qué un cuadrilátero por orbe y no un bucle sobre cinco dentro de un
// lienzo completo: el rasterizador descarta gratis los píxeles que no toca cada
// orbe. En reposo sólo hay UNA presencia > 0, así que el costo es el de un solo
// orbe — el mismo que hasta N2. Durante el gesto hay dos. Nunca cinco.
//
// LO QUE ESTE ARCHIVO NO HACE: no decide un nivel, no acota un valor y no sabe
// qué significan las cifras. Recibe una altura de TRAZO ya mapeada por
// `orbWaterline` y la dibuja. La frontera entre dato y dibujo vive en el
// contrato puro, donde el gate puede ejecutarla.
//
// ── N3C · EL CAMPO DE COLOR ES DE ELLOS ─────────────────────────────────────
//
// El founder puntuó N3B 4,5/10 y trajo la referencia: los orbes de ElevenLabs.
// Leerles el código cambió el encuadre — su orbe NO es 3D: es un disco plano
// pintado por un shader de fragmento, exactamente nuestra arquitectura. Lo que
// lo hace lindo es el SHADER, no `three`. Así que acá se adopta su look sin
// adoptar sus dependencias: cero paquetes nuevos, un solo lienzo, cinco orbes.
//
// Y con él muere la ventana de N3B. El founder lo dijo entero: «no cumple
// ninguna función». Sus orbes no reflejan nada reconocible — son campos de
// color abstractos en movimiento. Reflejar un cuarto era una respuesta correcta
// a la pregunta equivocada, así que se van el horizonte, la ventana y el marco.
//
// Lo que NO es de ellos y esta etapa conserva: el agua. Su orbe es sólido; el
// nuestro tiene nivel y aire. El campo vive DENTRO del líquido y por encima de
// la línea de agua hay vidrio.
//
// ─────────────────────────────────────────────────────────────────────────────
// `fieldGray`, `fieldRamp` y `fieldFlow` son una ADAPTACIÓN del fragment shader
// de:
//
//   MIT License · Copyright (c) 2025 ElevenLabs
//   https://github.com/elevenlabs/ui — apps/www/registry/elevenlabs-ui/ui/orb.tsx
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// El porte FIEL y sin adaptar —el que se pone al lado del nuestro para juzgar—
// vive en `orb-reference-shader.ts`. Están duplicados a propósito: si el
// «suyo» estuviera hecho con nuestras funciones, la comparación sería nuestra
// contra nosotros mismos.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ORB_FIELD_OVALS,
  ORB_NOISE_SEED,
  ORB_NOISE_SIZE,
  orbNoiseTexture,
  orbSeededAngles,
} from "./orb-noise-texture";
import {
  ORB_FLUID_ITERATIONS,
  createOrbFluid,
  orbFluidSplats,
  type OrbFluid,
} from "./orb-fluid";

export type OrbRgb = readonly [number, number, number];

/** Cuánto sobra alrededor del radio para el halo y la sombra propia. */
export const ORB_SPAN = 1.62;

export interface OrbDrawCall {
  /** Centro del orbe en píxeles CSS, desde la esquina superior izquierda. */
  centerX: number;
  centerY: number;
  /** Radio del orbe en píxeles CSS. */
  radius: number;
  /** 0–1. Cuánto está presente. Con 0 no se emite la llamada de dibujo. */
  presence: number;
  /** La ALTURA DE TRAZO, ya mapeada por `orbWaterline`. Nunca un valor crudo. */
  waterline: number;
  energy: number;
  voice: number;
  /** Inclinación del plano de agua: gesto + giroscopio, sumados por el caller. */
  tiltX: number;
  tiltZ: number;
  /** Giro acumulado del orbe, en radianes. */
  spin: number;
  /**
   * N3B · CUÁNTA OLA HAY, de la simulación. No es un reloj: es la velocidad del
   * líquido. Con 0 la superficie es un espejo — que es lo que hace que se lea
   * como agua y no como textura animada.
   */
  wave: number;
  /** N3B · El modo vertical del líquido. Un recibo lo empuja y el agua rebota. */
  bob: number;
  /**
   * N3C · RE-ANCLADO. Era «1 = el cuarto (horizonte, ventana, suelo)», y el
   * cuarto murió: el founder dijo que la ventana «no cumple ninguna función».
   * Ahora es el CAMPO DE COLOR: 1 = el vidrio y el líquido llevan el campo
   * abstracto en movimiento; 0 = la luz plana de N3, sin campo. Sigue siendo el
   * instrumento del antes/después, sólo que del cambio de esta etapa.
   * Producción siempre manda 1.
   */
  env: number;
  /**
   * N3B · 0 = el orbe que mirás; 1 = el más lejano. Le da perspectiva aérea a
   * las vecinas para que pasen DETRÁS en vez de intersecarse con un borde duro.
   */
  depth: number;
  material: number;
  /**
   * N3C · EL RELOJ DEL CAMPO DE COLOR. No es `time`: avanza más rápido cuando
   * hay voz, igual que el `uAnimation` de ellos. Lo acumula quien dibuja con
   * `orbFieldSpeed`, así que la velocidad es una función pura que el gate
   * ejecuta y no un número perdido dentro del bucle de animación.
   */
  field: number;
  liquid: OrbRgb;
  deep: OrbRgb;
  accent: OrbRgb;
  /**
   * N3C · SÓLO PARA LA MESA DE LUZ. Dibuja este orbe con el porte fiel del
   * shader de ElevenLabs en vez del nuestro, para poder mirarlos lado a lado en
   * el mismo lienzo, con el mismo reloj y al mismo tamaño. En producción nadie
   * lo enciende: el programa ni siquiera existe si no se inyecta su fuente.
   */
  reference?: boolean;
}

export interface OrbFrame {
  time: number;
  day: number;
  tier: 1 | 2 | 3;
  /**
   * N3C r6 · LO QUE EL FLUIDO NECESITA. La simulación es UNA para todo el
   * lienzo —igual que el lienzo es uno para los cinco orbes—, así que el empuje
   * no puede salir de una llamada de dibujo: llega con el cuadro.
   */
  voice: number;
  wave: number;
  dtSeconds: number;
  orbs: readonly OrbDrawCall[];
}

export interface OrbBufferInfo {
  dpr: number;
  width: number;
  height: number;
  /** `2` cuando el contexto es WebGL2; `1` cuando degradó. */
  glVersion: 1 | 2;
  antialias: boolean;
}

export interface OrbRenderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): OrbBufferInfo;
  draw(frame: OrbFrame): void;
  /**
   * N3C r6 · ADELANTAR EL FLUIDO SIN DIBUJAR. Una probeta pinta UN cuadro, y un
   * fluido recién arrancado está quieto: sin esto las probetas mostrarían el
   * material sin movimiento y la mesa de luz mentiría. Es determinista —mismos
   * segundos, mismo estado— así que las fotos se pueden comparar entre rondas.
   */
  warmFluid(seconds: number, voice?: number): void;
  /** `true` cuando el fluido corre de verdad. `false` es el degradado honesto. */
  hasFluid(): boolean;
  dispose(): void;
}

const VERTEX_SOURCE = `
attribute vec2 aQuad;
uniform vec2 uCanvas;
uniform vec2 uCenter;
uniform float uSpan;
varying vec2 vP;
void main(){
  // El eje Y del lienzo crece HACIA ABAJO y el del orbe hacia ARRIBA: el agua
  // se apoya en el fondo, la luz entra por arriba y la sombra cae abajo. Sin
  // esta vuelta el agua llena el techo del vaso.
  vP = vec2(aQuad.x, -aQuad.y) * ${ORB_SPAN.toFixed(2)};
  vec2 px = uCenter + aQuad * uSpan;
  vec2 clip = (px / uCanvas) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// UN SOLO MUNDO PARA LAS CINCO MATERIAS (§5.3 · E5).
//
// El founder fotografió lo contrario: «unos son super intensos en color y otros
// super opacos, no hay simetría entre ellos». La causa estaba en el código: cada
// material traía su propia amplitud, su propia velocidad y su propio brillo, así
// que cada capa vivía con otra física y otra exposición.
//
// Ahora hay UNA física (el mismo oleaje, el mismo menisco, la misma absorción de
// Beer-Lambert), UNA luz (`LKEY`, una sola dirección coherente) y UNA exposición
// (el mismo tonemap al final, para todas). Lo único que cambia entre capas es el
// PIGMENTO, que entra como coeficiente de extinción. La excepción es Patrimonio,
// y no es una decisión de estilo: el motor no puede afirmarle un techo, así que
// su materia es cristal — la doctrina de N2, no un gusto.
const FRAGMENT_SOURCE = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
varying vec2 vP;
uniform float uTime, uLevel, uEnergy, uDay, uMat, uVoice, uPresence, uSpin;
uniform float uWave, uBob, uDepth, uEnv, uField;
uniform vec2 uTilt;
uniform vec3 uLiq, uDeep, uAcc;
uniform sampler2D uPerlin;
uniform sampler2D uFluid;
uniform float uHasFluid;
const float KIPU_TIER = __KIPU_TIER__;
const vec3 LKEY = vec3(-0.4082, 0.8367, 0.3646);
const vec3 LFILL = vec3(0.6396, -0.2559, 0.7248);

// ── SE FUE EL CUARTO (N3C) ─────────────────────────────────────────────────
//
// N3B llenó el reflejo de cosas reconocibles —horizonte, ventana con marco,
// suelo— porque un degradado reflejado se lee como plástico. Era verdad a
// medias, y el founder cerró la discusión mirando la referencia:
//
//   «La ventana no cumple ninguna función.»
//
// Sus orbes no reflejan ningún objeto: son campos de color abstractos en
// movimiento, y se ven mejor. Así que la ventana, el horizonte y el marco se
// van enteros. Lo que queda del entorno es lo mínimo que un vidrio necesita
// para leerse como vidrio —una luz con dirección y su chispa— y encima de eso,
// el CAMPO: color que se mueve, sin nada que reconocer.
const vec3 ENV_SKY_HI = vec3(0.048, 0.062, 0.086);
const vec3 ENV_SKY_LO = vec3(0.070, 0.086, 0.112);
const vec3 ENV_FLOOR = vec3(0.010, 0.012, 0.017);
const vec3 ENV_SKY_HI_DAY = vec3(0.340, 0.368, 0.420);
const vec3 ENV_SKY_LO_DAY = vec3(0.520, 0.548, 0.596);
const vec3 ENV_FLOOR_DAY = vec3(0.118, 0.130, 0.154);
const vec3 ENV_KEY = vec3(0.90, 0.945, 1.00);
const vec3 ENV_FILL = vec3(0.34, 0.44, 0.62);
const float WAVE_AMP = 0.026;
// N3C · LA ONDA DE LA VOZ, en la superficie del agua. Es lo que más le gustó al
// founder de la referencia —«cómo se mueven las ondas de adentro mientras
// habla»— y por eso NO es un efecto pegado encima: es el mismo líquido que ya
// tiene masa, con un tren de ondas radial que sale del centro. Sin voz vale
// cero exacto y la superficie vuelve a ser el espejo de N3B.
// Medido: con 2,35 la onda desplazaba la superficie 0,061 radios — 3,8 px en un
// orbe de 124, por debajo del ruido de cualquier instrumento y, lo que importa,
// por debajo de lo que se ve. Su anillo mueve el borde 0,2 radios; éste mueve
// la superficie 0,10, que es la mitad y ya se lee. La frecuencia baja para que
// sean ONDAS anchas y no un rizado: a 13 el tren no entraba entero en la elipse
// de la superficie.
const float VOICE_AMP = 3.85;
const float VOICE_FREQ = 9.0;
const float VOICE_SPEED = 5.4;
const float CAM_PITCH = -0.11;
// El menisco DE VERDAD es una película fina, no un bulto. N3 lo tenía en 0.078
// —más alto que el piso del vaso entero— y por eso un orbe vacío dibujaba un
// charco: el bulto trepaba la pared y levantaba la superficie visible.
const float MENISCUS = 0.030;
const vec2 WD1 = vec2(0.9806, 0.1961);
const vec2 WD2 = vec2(-0.3162, 0.9487);
const vec2 WD3 = vec2(0.7071, -0.7071);
const vec2 WD4 = vec2(0.5547, 0.8321);

float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), u.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){
    v += a*vnoise(p);
    p = p*2.03 + vec2(1.7,9.2);
    a *= 0.5;
  }
  return v;
}

// ── EL CAMPO DE COLOR (N3C ronda 2) ────────────────────────────────────────
//
// LA RONDA 1 COPIÓ EL ARCHIVO EQUIVOCADO, y el founder lo vio de una: el orbe
// salía como un molinete de cuñas negras que converge en el centro, y sus orbes
// de verdad no se parecen en nada a eso.
//
// El porte era fiel — 'elevenlabs/ui', 'orb.tsx', línea por línea. El problema
// es que **ese componente no es lo que muestra su página.** Su shader publicado
// dibuja siete óvalos en coordenadas polares, y un óvalo polar tiene dos cosas
// que sus orbes NO tienen: bordes rectos en el ángulo y una singularidad en el
// radio cero. Por eso converge en el centro; es geometría, no un ajuste.
//
// Lo que sí tienen sus orbes —mirando las capturas— son regiones grandes,
// blandas y orgánicas, sin centro y sin bordes, con GRANO encima y sin un solo
// negro: siempre un tono más profundo del mismo color. Eso es DEFORMACIÓN DE
// DOMINIO: un ruido cuyo argumento es otro ruido. No hay coordenadas polares en
// ninguna parte, y por eso no puede haber ni molinete ni convergencia.
//
// El porte fiel de su componente publicado se conserva en
// 'orb-reference-shader.ts', y '/dev/vidrio' lo muestra por lo que es: su
// código abierto, que no es su página.

// EL MUESTREO QUINTICO — la corrección que mata las «manchas duras».
//
// El founder las nombró exacto: «manchas super duras combinadas entre sí».
// No eran del ruido: eran de la REJILLA. La tela se magnifica cinco veces
// (medido: un téxel ocupa 5 px en un teléfono) y el filtrado bilineal de la GPU
// interpola RECTO entre téxeles, así que a esa escala se ven los bordes de las
// celdas — cuadriláteros, que es justo lo que se veía en el orbe naranja.
//
// El truco: se curva la coordenada ANTES de muestrear, con la misma quíntica de
// Perlin. La GPU sigue interpolando recto, pero sobre una coordenada que ya
// viene curvada, y el resultado es continuo en la primera y la segunda
// derivada. Cuesta cinco operaciones y no una lectura más.
const float FIELD_TEX = __KIPU_NOISE__;
// EL FLUIDO DEL PÍXEL: hacia dónde empuja el líquido acá, y cuánto. Se lee una
// sola vez en 'main' —una muestra de textura— y de ahí sale TODO el movimiento.
vec2 gFlow = vec2(0.0);
float gFlowMag = 0.0;

float fieldTex(vec2 p){
  vec2 t = p * FIELD_TEX + 0.5;
  vec2 i = floor(t), f = fract(t);
  f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return texture2D(uPerlin, (i + f - 0.5) / FIELD_TEX).r;
}

// fbm leído de la tela en vez de calculado: la tela cierra sobre sí misma, así
// que sumar octavas escaladas no produce costuras. Y cuesta cuatro lecturas en
// vez de dieciséis hashes, que en un teléfono es la diferencia.
// DOS OCTAVAS, NO CUATRO. Medido mirando: con cuatro el campo salía como papel
// arrugado —fractal, con detalle en todas las escalas— y sus orbes son lo
// contrario: dos o tres manchas grandes y nada de detalle fino. Lo fino lo pone
// el GRANO, que es otra cosa y va aparte.
// N3C r4 · CASI UNA SOLA OCTAVA — y la razón salió de MIRAR SU PÁGINA.
//
// Su orbe en reposo no es un shader: es un PNG de **8×8 píxeles** estirado a
// 200 y pasado dos veces por un desenfoque gaussiano. Sesenta y cuatro colores,
// difuminados. Ahí está entera la respuesta a «se fusionan perfecto sin manchas
// duras»: **no hay casi información espacial con la que hacer un borde**.
//
// Nuestro campo tenía tres octavas de detalle. La segunda baja a un tercio y la
// tercera se va: lo que queda es una malla de color de orden bajísimo, que es
// lo que ellos tienen.
float fieldFbm(vec2 p){
  float v = 0.88*fieldTex(p);
  v += 0.12*fieldTex(p*2.07 + vec2(0.31, 0.77));
  return v;
}

// LA DEFORMACIÓN. 'q' desplaza el punto antes de volver a leer el ruido: es lo
// que convierte manchas redondas en esas lenguas de color que se enroscan.
float fieldGray(vec2 p, float anim, float drive){
  // ── N3C r5 · EL CAMPO NO SE MUEVE: SE DEFORMA ──────────────────────────
  //
  // Rotar tampoco alcanzó. El founder, sobre la ronda 4: «es sólo una capa que
  // pasa y se mueve bruscamente a velocidad super rápida… molesto de ver por
  // más de unos segundos». Girar más despacio no lo arregla, y la razón la
  // encontré leyendo su página, no mirando la nuestra.
  //
  // SU ORBE ESTÁ HECHO CON 64 PÍXELES. Un PNG de 8×8 estirado 25 veces y
  // desenfocado dos veces. Eso quiere decir que **no tiene ni un solo rasgo que
  // el ojo pueda seguir**. Y ahí está la clave: si el campo tiene rasgos
  // seguibles, CUALQUIER traslación o giro se lee como velocidad y como
  // dirección — «una capa que pasa». No importa cuánto se baje: mientras haya
  // algo que seguir, se ve pasar.
  //
  // Así que el movimiento deja de ser transporte y pasa a ser DEFORMACIÓN.
  // 'p' no se mueve nunca: ni gira ni se traslada. Lo único que avanza con el
  // tiempo es el campo de DESPLAZAMIENTO, y como su amplitud está acotada, las
  // manchas se hinchan, se estiran y se deshacen EN SU SITIO. Nada cruza el
  // orbe, y por eso no hay ni velocidad ni dirección que percibir.
  //
  // N3C r6 · Y EL DESPLAZAMIENTO YA NO LO INVENTA UN SENO: LO DA UN FLUIDO.
  // Capturando el shader de su página apareció 'uFluidSimTexture' y, con él,
  // el solver de Navier-Stokes entero. Un fluido advecta: cada trozo viaja por
  // su cuenta siguiendo la velocidad local, se enrosca, no repite, y cuando lo
  // empujás la perturbación se propaga sola. Eso no se fabrica con un seno.
  // Sin texturas de coma flotante no hay fluido y el campo vuelve al ruido:
  // peor, y verdadero.
  vec2 q;
  if(uHasFluid > 0.5){
    q = 0.5 + gFlow;
  } else {
    q = vec2(fieldFbm(p + vec2(anim*0.085, anim*0.052)),
             fieldFbm(p + vec2(5.2, 1.3) - vec2(anim*0.061, anim*0.074)));
  }
  // la voz abre la deformación: el campo se revuelve más mientras hablás, que
  // es lo único que su 'uOutputVolume' hacía con el ángulo.
  //
  // Y el desplazamiento se mide EN UNIDADES DE LA TELA, no en múltiplos sueltos:
  // las manchas de la octava base miden 0,25 de tela, así que desplazar 0,35 las
  // enrosca; desplazar 2,0 —lo que tenía la primera versión— las revuelve ocho
  // veces y devuelve ruido.
  // …y la voz ABRE la deformación mucho más que antes: el founder dijo que al
  // hablar «casi no hay movimiento», y con 0,32→0,58 tenía razón — el campo se
  // movía casi igual callado que hablando.
  // Y LA DEFORMACIÓN SE ACHICA MUCHO. Con 0,34–1,05 desplazaba hasta cuatro
  // manchas: eso no enrosca el campo, lo REVUELVE, y revuelto se lee como
  // brusco. Su orbe no tiene deformación en absoluto — es una malla suave — así
  // que acá queda lo mínimo para que las manchas no sean círculos.
  // La amplitud sube un poco respecto de la ronda 4 porque ahora es lo ÚNICO
  // que se mueve — pero sigue acotada: el desplazamiento máximo es un cuarto de
  // mancha, así que ningún rasgo llega a cruzar nada.
  float amount = mix(0.17, 0.40, drive) * (uHasFluid > 0.5 ? 1.55 : 1.0);
  float f = fieldFbm(p + amount*(q - 0.5) + vec2(1.7, 9.2));
  // El rango útil del fbm no es [0,1]: sin esto el campo vive apretado en el
  // medio de la rampa y sale un color plano.
  return clamp((f - 0.32) / 0.38, 0.0, 1.0);
}

// EL SEGUNDO CAMPO — el del color, no el del tono. Comparte la deformación pero
// mira otra parte de la tela, así que sus manchas NO coinciden con las del
// primero: donde una empieza, la otra va por la mitad. Es lo que hace que los
// colores se fundan en vez de repartirse en zonas.
float fieldHue(vec2 p, float anim){
  // Igual que el del tono: el punto no se mueve, se mueve su deformación — y a
  // otro ritmo, para que el color y el brillo no respiren al unísono.
  // El color usa el MISMO fluido, girado un cuarto de vuelta: los dos vienen
  // del líquido y aun así no respiran al unísono.
  vec2 q;
  if(uHasFluid > 0.5){
    q = 0.5 + vec2(-gFlow.y, gFlow.x) * 0.85;
  } else {
    q = vec2(fieldFbm(p + vec2(2.9, 7.4) - vec2(anim*0.047, anim*0.068)),
             fieldFbm(p + vec2(8.1, 0.6) + vec2(anim*0.072, -anim*0.039)));
  }
  float h = fieldFbm(p + 0.30*(q - 0.5) + vec2(6.3, 2.1));
  return clamp((h - 0.34) / 0.34, 0.0, 1.0);
}

// LA RAMPA. Cuatro paradas, como la suya, pero **ninguna es negra**: el extremo
// oscuro es el pigmento profundo de la capa. Sus orbes no tienen un solo negro
// —lo más oscuro sigue siendo del color— y ahí está la mitad de por qué se ven
// cremosos en vez de duros.
// LA RAMPA, SIN ESCALONES Y CON DOS EJES.
//
// Dos correcciones que salieron de lo que el founder señaló:
//
// 1. Se va el 'smoothstep(0.06, 0.94)'. Lo puse para ganar rango tonal y lo que
//    hacía era EMPINAR la transición: por eso las manchas tenían borde. Sus
//    orbes tienen el mismo rango con la pendiente suave, y el rango se recupera
//    separando más las paradas de color en vez de acelerar la curva.
//
// 2. El color deja de moverse en un solo eje. Con una sola rampa el campo es un
//    tono con más y menos luz, y los suyos FUNDEN VARIOS COLORES —violeta con
//    rosa con azul—. 'hue' es un segundo campo, independiente del primero, que
//    corre el color intermedio entre el líquido y el acento. De ahí sale que
//    «se fusionen perfecto» en vez de verse como un degradado de brillo.
//
// Y ninguna parada es blanca: el claro más alto sigue siendo del color, que es
// lo que conserva el mate.
vec3 fieldRamp(float gray, float hue, float inverted){
  float l = mix(gray, 1.0 - gray, inverted);
  vec3 mid = mix(uLiq, uAcc, hue);
  // Las cuatro paradas se JUNTAN. En sus orbes no hay ni un negro ni un blanco:
  // son todos tonos medios del mismo aire, y por eso se funden. El nuestro
  // llegaba de 'uDeep * 0.55' hasta casi blanco — un rango que ningún
  // difuminado alcanza a integrar.
  // El founder: «choque de colores». El extremo oscuro seguía siendo el
  // pigmento profundo casi puro, y contra el medio claro eso es un choque, no
  // una fusión. Se acerca al medio: el rango entero vive más junto.
  vec3 c0 = mix(uDeep, mid, 0.30);
  vec3 c1 = mix(uDeep, mid, 0.62);
  vec3 c2 = mid;
  vec3 c3 = mix(mid, vec3(1.0), 0.20);
  // interpolación suavizada en cada tramo: sin esto la unión entre paradas es
  // un quiebre de pendiente, y un quiebre de pendiente se VE como un borde
  if(l < 0.38){ float t = l / 0.38; return mix(c0, c1, t*t*(3.0-2.0*t)); }
  if(l < 0.78){ float t = (l - 0.38) / 0.40; return mix(c1, c2, t*t*(3.0-2.0*t)); }
  float t = (l - 0.78) / 0.22;
  return mix(c2, c3, t*t*(3.0-2.0*t));
}

// EL GRANO. Es lo que más se nota en sus capturas y lo que más barato compra
// «material» en vez de «degradado». Vive en el espacio DEL ORBE y no en el de
// la pantalla: si viviera en la pantalla se leería como un filtro encima, y el
// orbe pasaría por debajo del grano al deslizar.
float fieldGrain(vec2 p){
  return hash21(floor(p * 160.0)) - 0.5;
}

// El campo del píxel, calculado UNA vez en 'main' y leído desde el entorno.
// 'envSample' corre hasta cinco veces por píxel (el reflejo, los tres rayos de
// la dispersión y el reflejo del agua): recalcular el campo en cada una
// multiplicaría por cinco las lecturas de tela.
vec3 gField = vec3(0.0);

// EL CAMPO SE PUEDE APAGAR (uEnv = 0). No es un modo de producción: es el
// instrumento del antes/después, con el MISMO renderer y la MISMA exposición.
// Con 0 queda la luz plana y desnuda; con 1, el campo de color en movimiento.
vec3 envSample(vec3 d){
  // Un degradado vertical suave y NADA MÁS. Sin línea de horizonte, sin banda
  // de pared, sin ventana y sin marco: si hubiera un borde reconocible acá,
  // volvería a aparecer un cuarto reflejado en el vidrio.
  float h = d.y;
  vec3 base = mix(mix(ENV_SKY_LO, ENV_SKY_LO_DAY, uDay),
                  mix(ENV_SKY_HI, ENV_SKY_HI_DAY, uDay),
                  smoothstep(-0.85, 0.85, h));
  // La luz: dos lóbulos suaves, que es lo que hacía la rama sin cuarto de N3B.
  base += ENV_KEY * (pow(max(dot(d, LKEY), 0.0), 14.0)*0.30
                   + pow(max(dot(d, LKEY), 0.0), 2.6)*0.055);
  // y su brillo pequeño y duro, que es el que hace la chispa en el borde
  base += ENV_KEY * pow(max(dot(d, LKEY), 0.0), 260.0) * 0.14;
  base += ENV_FILL * pow(max(dot(d, LFILL), 0.0), 5.0) * 0.10;
  // EL CAMPO, dentro del vidrio. Entra como tinte del píxel y no como una
  // dirección: lo que el ojo tiene que ver es color que se mueve, no una forma
  // que se pueda reconocer y ubicar en un cuarto.
  base += gField * (0.055 + 0.075 * smoothstep(-0.6, 0.8, h)) * uEnv;
  return base;
}

vec3 toWater(vec3 p){
  float c = cos(CAM_PITCH), sn = sin(CAM_PITCH);
  return vec3(p.x, c*p.y - sn*p.z, sn*p.y + c*p.z);
}
vec3 fromWater(vec3 q){
  float c = cos(CAM_PITCH), sn = sin(CAM_PITCH);
  return vec3(q.x, c*q.y + sn*q.z, -sn*q.y + c*q.z);
}
vec3 rotY(vec3 v, float a){
  float c = cos(a), sn = sin(a);
  return vec3(c*v.x + sn*v.z, v.y, -sn*v.x + c*v.z);
}
vec3 tonemap(vec3 x){
  x *= 1.04;
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}

// La gota es el 5 EXACTO. Sin el tope de arriba, el cristal —que ahora es el 6—
// también entraría por acá y el campo se le anclaría al fondo del vaso.
float isDrop(){ return step(4.5, uMat) * step(uMat, 5.5); }

// EL PISTÓN entra en el nivel: un recibo empuja el agua y todo el plano sube y
// baja antes de asentarse. Lo calcula la simulación; acá sólo se suma.
float waterBase(){ return clamp(uLevel + uBob, 0.0, 1.0) * 2.0 - 1.0; }

// ── LA AMPLITUD SALE DE LA VELOCIDAD DEL LÍQUIDO, NO DEL RELOJ ──────────────
//
// Es el cambio que mata la «masa deforme». Hasta N3 el oleaje corría a amplitud
// fija estuviera pasando algo o no, así que el agua se veía SIEMPRE revuelta —
// y un agua siempre revuelta no se lee como agua, se lee como textura animada.
// Un agua quieta es un ESPEJO, y ese espejo es justo el aspecto que faltaba.
// Queda un fondo mínimo y lentísimo porque un vaso de verdad tampoco está
// perfectamente plano: respira.
float waveAmp(){
  return WAVE_AMP * (0.17 + uWave*2.9 + uEnergy*1.5);
}

float waterHeight(vec3 p, float detail){
  float base = waterBase();
  float lean = dot(p.xz, uTilt);
  float A = waveAmp();
  float w = A*(       sin(dot(p.xz, WD1)*4.40 + uTime*0.85)
              + 0.75*sin(dot(p.xz, WD2)*3.20 - uTime*0.66)
              + 0.20*sin(dot(p.xz, WD3)*11.70 - uTime*1.35)
              + 0.20*sin(dot(p.xz, WD4)*9.30 + uTime*1.12));
  // El detalle fino ya NO es ruido fractal sumado a la altura: eso era
  // literalmente la «masa deforme». Es un rizo capilar, corto y coherente, que
  // sólo aparece cuando el líquido se está moviendo.
  if(detail > 0.5){
    w += A*0.34*uWave*sin(dot(p.xz, WD2)*23.0 + uTime*3.1)
       * sin(dot(p.xz, WD1)*19.0 - uTime*2.4);
  }
  // LA VOZ, EN LA SUPERFICIE. Un tren de ondas concéntrico que sale del centro
  // del líquido: la misma superficie que ya refleja y refracta, moviéndose. Con
  // uVoice = 0 este término es cero exacto — no hay onda de adorno.
  w += WAVE_AMP * VOICE_AMP * uVoice
     * sin(length(p.xz) * VOICE_FREQ - uTime * VOICE_SPEED);
  // EL MENISCO: una película fina que trepa la pared, y que se APAGA cuando
  // queda poca agua. Un charco no tiene menisco de vaso lleno.
  float wallR = sqrt(max(0.0, 1.0 - base*base));
  float rad = length(p.xz);
  // El menisco trepaba la pared y con poca agua eso dibujaba un CUENCO: el
  // founder lo vio —«la forma del agua como hacia arriba en lugar de ser
  // plana»—. Se reduce a una película fina que casi no levanta el borde.
  float men = smoothstep(wallR*0.80, wallR*1.02, rad) * MENISCUS * 0.35
            * smoothstep(0.0, 0.30, base + 1.0);
  return base + lean + w + men;
}

// La NORMAL de la superficie, analítica. Sin esto no hay reflejo del cuarto en
// el agua —había un 'sheen' sumado a mano, que es pintar un brillo, no
// reflejar— y sin reflejo el agua no puede leerse como agua.
vec3 waterNormal(vec3 p, float detail){
  float A = waveAmp();
  float c1 = A*4.40*cos(dot(p.xz, WD1)*4.40 + uTime*0.85);
  float c2 = A*0.75*3.20*cos(dot(p.xz, WD2)*3.20 - uTime*0.66);
  float c3 = A*0.20*11.70*cos(dot(p.xz, WD3)*11.70 - uTime*1.35);
  float c4 = A*0.20*9.30*cos(dot(p.xz, WD4)*9.30 + uTime*1.12);
  vec2 g = c1*WD1 + c2*WD2 + c3*WD3 + c4*WD4 + uTilt;
  if(detail > 0.5){
    float k = A*0.34*uWave;
    g += vec2(k*23.0, k*19.0)
       * cos(dot(p.xz, WD2)*23.0 + uTime*3.1)
       * cos(dot(p.xz, WD1)*19.0 - uTime*2.4);
  }
  // Y LA PENDIENTE DE LA ONDA DE LA VOZ. Sin esto la onda existiría en la altura
  // pero no en la NORMAL, así que no reflejaría distinto — o sea, no se vería.
  // Es la misma trampa que N3B pagó con el 'sheen': un relieve que no cambia
  // cómo entra la luz no es un relieve, es un dibujo.
  float rho = max(length(p.xz), 0.0004);
  g += (p.xz / rho) * WAVE_AMP * VOICE_AMP * uVoice * VOICE_FREQ
     * cos(rho * VOICE_FREQ - uTime * VOICE_SPEED);
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main(){
  vec2 uv = vP;
  float r = length(uv);
  float rr = r*r;

  // ── EL CAMPO DE COLOR DEL PÍXEL ──────────────────────────────────────────
  //
  // Se calcula antes que nada porque lo mira TODO: el líquido lo lleva adentro,
  // el vidrio lo refracta y el halo lo hereda. Un solo objeto.
  //
  // 'drive' es su 'uInputVolume'/'uOutputVolume': la voz estira los óvalos y
  // sube la distorsión del flujo, que es lo que en su orbe hace que las ondas
  // «se muevan mientras habla». Le sumamos un poco de la agitación del líquido,
  // porque un chapoteo también mueve el color.
  float drive = clamp(uVoice * 0.9 + uWave * 0.25, 0.0, 1.0);
  {
    // EL CENTRO DEL CAMPO ES EL CENTRO DEL LÍQUIDO, no el del vidrio. Es la
    // diferencia entre «su campo, recortado por una línea de agua» y «su campo,
    // adentro del agua»: con el centro fijo, un orbe a medio llenar mostraba
    // justo la parte donde los siete óvalos convergen —la menos linda— y el
    // resto quedaba afuera. Anclado al líquido, el campo BAJA y SUBE con el
    // nivel, que es lo que hace un contenido y no un fondo.
    float wb = isDrop() > 0.5 ? -0.955 : waterBase();
    float cLiq = (wb - 1.0) * 0.5;
    vec2 fq = uv - vec2(0.0, cLiq * 0.85);
    // …y gira con el orbe: un solo objeto, otra vez.
    float sn = sin(uSpin * 0.30), cs = cos(uSpin * 0.30);
    // 0,22 y no 0,62: con 0,62 el orbe abarcaba cinco manchas de la tela y el
    // campo se leía como una textura. Sus orbes muestran DOS o TRES.
    // EL FLUIDO, UNA SOLA MUESTRA. Cada capa lo mira GIRADO 72 grados respecto
    // de la anterior: la simulación es una —un lienzo, un fluido— y aun así las
    // cinco no muestran el mismo remolino.
    if(uHasFluid > 0.5){
      float fa = uMat * 1.2566;
      float fc = cos(fa), fs = sin(fa);
      vec2 fr = vec2(fc*fq.x - fs*fq.y, fs*fq.x + fc*fq.y);
      vec3 fl = texture2D(uFluid, clamp(fr * 0.44 + 0.5, 0.015, 0.985)).xyz;
      gFlow = clamp(fl.xy * 1.85, -1.0, 1.0);
      gFlowMag = clamp(fl.z * 3.0, 0.0, 1.0);
    }
    vec2 fp = vec2(cs*fq.x + sn*fq.y, -sn*fq.x + cs*fq.y) * 0.22;
    // Cada capa mira OTRA PARTE del mismo campo. Sin esto las cinco dibujan el
    // mismo patrón con distinto color, y el carrusel se lee como un filtro.
    fp += vec2(uMat * 0.37, uMat * 0.23);
    gField = fieldRamp(fieldGray(fp, uField, drive), fieldHue(fp, uField), 1.0 - uDay) * uEnv;
    gField += fieldGrain(fq) * (0.055 + 0.02*uDay) * uEnv;
    // donde el fluido acaba de pasar queda un rastro más claro: es la estela,
    // y es lo que hace que se vea DE DÓNDE viene el movimiento
    gField += mix(uAcc, vec3(1.0), 0.35) * gFlowMag * 0.075 * uEnv;
  }

  vec3 soul = vec3(0.0);
  float soulA = 0.0;
  {
    vec2 dir = uv / max(r, 0.0001);
    float n1 = fbm(dir*1.5 + vec2(uTime*0.040, uTime*0.028));
    float n2 = fbm(dir*2.9 - vec2(uTime*0.029, uTime*0.019));
    float breath = 0.5 + 0.5*sin(uTime*0.31);
    float energy = 0.15 + 0.055*breath + uVoice*0.26;
    float reach = 1.0 + energy*(0.95 + (n1-0.5)*1.05 + (n2-0.5)*0.55);
    float nearGlow = 1.0 - smoothstep(1.0, reach, r);
    float farGlow = 1.0 - smoothstep(1.0, 1.0 + (reach - 1.0)*3.1, r);
    float halo = pow(nearGlow, 1.7)*0.45 + pow(farGlow, 1.25)*0.55;
    halo *= smoothstep(0.965, 1.015, r);
    halo *= 0.80 + 0.34*max(dot(dir, LKEY.xy), 0.0);
    // N3C · el halo toma el color que el campo tiene AHORA, así que respira con
    // él en vez de ser una capa aparte pegada al borde.
    vec3 sc = mix(mix(uAcc, uLiq, 0.45), gField * 2.2, 0.45 * uEnv);
    soul = sc * halo * (0.055 + 0.24*uVoice);
    soulA = clamp(halo*(0.030 + 0.15*uVoice) * mix(1.0, 0.50, uDay), 0.0, 1.0);
  }

  float shadow = 0.0;
  {
    vec2 sp = (uv - vec2(0.30, -1.06)) / vec2(0.86, 0.20);
    shadow = (1.0 - smoothstep(0.0, 1.0, length(sp))) * 0.30;
  }

  if(rr > 1.0){
    float aOut = clamp(soulA + shadow, 0.0, 1.0) * uPresence;
    gl_FragColor = vec4(tonemap(soul) * uPresence, aOut);
    return;
  }

  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(uv*0.94, -3.2));
  float b = dot(ro, rd), c = dot(ro,ro) - 1.0, h = b*b - c;
  if(h < 0.0){ gl_FragColor = vec4(0.0); return; }
  h = sqrt(h);
  float t0 = -b - h;
  vec3 pf = ro + rd*t0;
  vec3 N = normalize(pf);
  vec3 V = -rd;
  float ndv = max(dot(N,V), 0.0);
  float fres = pow(1.0 - ndv, 3.4);

  vec3 rdi = refract(rd, N, 0.90);

  float tExit = max(0.0, -2.0*dot(pf, rdi));
  vec3 qo = toWater(pf);
  vec3 qd = toWater(rdi);
  float base = waterBase();
  float wallR = sqrt(max(0.0, 1.0 - base*base));
  float drop = isDrop();
  // LA GOTA (§4) · Un orbe en CERO no dibuja un vaso con poca agua: dibuja una
  // gota. Es el vacío deliberado de N2, que N3 perdió por el camino — el nivel
  // nulo caía al piso del mapeo y el piso del mapeo dibujaba un charco. Acá la
  // gota tiene su propia materia: un disco chico, apoyado en el fondo, con la
  // cara CONVEXA que le da la tensión superficial.
  if(drop > 0.5){ base = -0.955; wallR = 0.30; }

  float tA = 0.0, tB = 0.0;
  float tS = -1.0;
  float surfaceSeen = 0.0;
  vec3 qSurf = qo;
  float detail = KIPU_TIER > 1.5 ? 1.0 : 0.0;
  if(abs(qd.y) > 0.0015){
    tS = (base - qo.y) / qd.y;
    vec3 guess = qo + qd*tS;
    tS += (waterHeight(guess, detail) - guess.y) / qd.y;
    qSurf = qo + qd*tS;
    if(qd.y < 0.0){ tA = max(0.0, tS); tB = tExit; }
    else { tA = 0.0; tB = min(tS, tExit); }
    if(tS > 0.0 && tS < tExit && dot(qSurf, qSurf) <= 1.0) surfaceSeen = 1.0;
  } else {
    tA = 0.0;
    tB = qo.y < base ? tExit : 0.0;
  }
  // La gota está acotada en radio: fuera de su disco no hay líquido.
  if(drop > 0.5){
    float rho0 = length(qSurf.xz);
    float inside = 1.0 - smoothstep(wallR*0.86, wallR, rho0);
    surfaceSeen *= inside;
    tB = mix(tA, tB, inside);
  }
  float thick = max(0.0, tB - tA);
  // 0,075 y no 0,030: con la cámara aplanada la superficie es casi una recta,
  // y una recta con transición de 0,030 es un CORTE. El agua tiene que
  // empezar, no aparecer de golpe.
  float has = smoothstep(0.0, 0.075, thick);
  float hit = step(0.004, thick);

  // N3C r2 · el cristal tiene su propio código (6). Antes era el 3 —el de la
  // capa Patrimonio—, y por eso Patrimonio no podía dibujar líquido nunca.
  float crystal = step(5.5, uMat);
  thick *= 1.0 - crystal;
  has *= 1.0 - crystal;
  hit *= 1.0 - crystal;
  surfaceSeen *= 1.0 - crystal;
  float depth = max(0.0, base - (qo.y + qd.y*(tA + tB)*0.5));
  vec3 hp = qo + qd*mix(tA, tB, 0.62);

  // ── EL LÍQUIDO ES EL CAMPO (N3C) ────────────────────────────────────────
  //
  // Hasta N3B el cuerpo era pigmento y absorción de Beer-Lambert: físicamente
  // correcto y, según el founder, un 4,5. Lo que se ve mejor es el campo de
  // ellos, y acá es lo que llena el vaso. La profundidad ya no decide el COLOR
  // —lo decide el campo— pero sigue decidiendo el CUERPO: una columna gruesa de
  // líquido pesa más que una lámina, y sin eso el agua deja de tener volumen.
  vec3 body = mix(gField, uDeep * 0.28, (1.0 - uEnv))
            + mix(uDeep * 0.92, uLiq * 1.30, exp(-((vec3(1.0) - uLiq) * 1.55 + 0.16) * depth * 1.45))
              * 0.16 * (1.0 - uEnv);
  // El piso sube: donde el líquido es fino —justo debajo de la superficie—
  // 0,52 lo dejaba casi negro, y esa banda oscura contra el aire se leía
  // como una segunda línea dibujada.
  body *= 0.78 + 0.26 * clamp(thick * 1.15, 0.0, 1.0);
  // La gota es una lámina, y una lámina de líquido apenas tiñe: sin esto un
  // orbe VACÍO brillaba más que uno lleno — exactamente al revés.
  body *= 1.0 - drop * 0.45;

  // Las corrientes lentas se quedan, pero PESAN MUCHO MENOS y se mueven con el
  // líquido: eran parte del aspecto de «masa» cuando el agua estaba quieta.
  float flow = fbm(vec2(uv.x*2.3 + uTime*0.055, uv.y*2.7 - uTime*0.042));
  body *= 0.90 + (0.10 + 0.22*uWave)*flow;

  // LA CÁUSTICA SE FUE (N3C r3). Era una red de luz proyectada en el fondo del
  // vaso — físicamente correcta, y el founder la leyó por lo que parecía:
  // «líneas dibujadas que no se entiende qué son». Le quitaba el mate. Con ella
  // se van también las motas suspendidas, que eran de la misma familia: detalle
  // que compite con el campo en vez de acompañarlo.

  // ── LA SUPERFICIE ES UNA INTERFAZ, NO UNA RAYA PINTADA ─────────────────────
  //
  // Acá estaba la mitad del problema. N3 sumaba un 'sheen' —un brillo dibujado
  // en el borde del disco—, y un brillo dibujado no es una superficie: por eso
  // el agua no se leía como agua. Una superficie de líquido REFLEJA el cuarto y
  // REFRACTA el fondo, y Fresnel decide cuánto de cada cosa según el ángulo. De
  // ahí sale sola la propiedad que el ojo reconoce al instante: el borde lejano
  // del disco es un espejo y el cercano deja ver el fondo.
  vec3 rdn = normalize(rdi);
  vec3 wn = waterNormal(qSurf, detail);
  vec3 wnv = normalize(fromWater(wn));
  float wcos = max(dot(wnv, -rdn), 0.0);
  float wfres = clamp(0.02 + 0.98*pow(1.0 - wcos, 5.0), 0.0, 1.0);
  // El agua a ras SÍ es un espejo —eso es física—, pero un espejo total borra
  // el nivel, que es lo único que este objeto tiene que decir. El reflejo entra
  // teñido por el pigmento de la capa, así que aporta el cuarto sin dejar de
  // ser AGUA DE ESA CAPA.
  vec3 wrefl = mix(envSample(reflect(rdn, wnv)), uLiq * 0.55, 0.24);
  body = mix(body, wrefl, wfres * surfaceSeen * 0.20);
  // El destello duro del panel sobre el agua: es el que dice «esto está mojado».
  float wspec = pow(max(dot(reflect(rdn, wnv), LKEY), 0.0), 300.0);
  // el destello duro del panel se va con el resto de lo brillante: es lo que
  // hacía que la superficie se leyera como plástico mojado y no como agua mate.
  // Medido: con ganancia 2.0 el fondo del orbe vacío llegaba a [255,255,233]
  // —recortado— y eso es lo que se veía como una mancha sucia. Un destello que
  // satura deja de ser un destello: es un agujero blanco.
  body += ENV_KEY * wspec * surfaceSeen * 0.10;

  // Y EL MENISCO, ahora como lo que es: la línea exacta donde el líquido toca el
  // vidrio. Fina, no una banda ancha del mismo material — que era la razón de
  // que el aire de arriba no se leyera como aire.
  float rho = length(qSurf.xz);
  float ring = smoothstep(wallR*0.90, wallR*1.005, rho)
             * (1.0 - smoothstep(wallR*1.005, wallR*1.06, rho));
  // N3C · Y CUANDO HAY VOZ, EL BORDE DEL AGUA SE VUELVE IRREGULAR. Es el anillo
  // ruidoso de su orbe, pero puesto donde en el nuestro tiene sentido: en la
  // línea donde el líquido toca el vidrio, no en el borde del vidrio. Sin voz
  // el factor es 1 exacto y el menisco es el mismo de N3B.
  // UNA LÍNEA, NO DOS. El menisco rodea TODA la elipse, así que se dibujaba el
  // borde lejano —el que el ojo lee como «el nivel»— y también el cercano, más
  // abajo. Dos arcos paralelos no existen en un vaso: se leen como dibujados, y
  // el founder los vio así («esa segunda línea de agua se ve terrible»).
  // Se conserva el lejano y se apaga el cercano, que es además lo que pasa de
  // verdad: el borde de acá lo estás mirando a través del agua.
  float ringFar = smoothstep(-0.30, 0.42, -qSurf.z / max(wallR, 0.001));
  float ringAng = atan(qSurf.z, qSurf.x) * 0.15915494;
  float ringNoise = texture2D(uPerlin, vec2(ringAng + uField * 0.35, 0.5)).r - 0.5;
  ring *= (1.0 + uVoice * ringNoise * 2.2) * ringFar;
  body += mix(uAcc, vec3(1.0), 0.55) * ring * surfaceSeen * (0.20 + 0.55*uVoice);

  vec3 R = reflect(-V, N);
  float schlick = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
  // MATE, no vidrio pulido. Sus orbes casi no tienen especular: son discos de
  // color, no bolas brillantes, y eso es la mitad de lo «místico».
  vec3 reflection = envSample(R) * schlick * mix(0.42, 0.52, uDay);
  float rimw = pow(1.0 - ndv, 5.0);

  // ── SIN TECHO: EL VIDRIO SE LLENA ENTERO (N3C r2) ──────────────────────
  //
  // Acá vivía un núcleo facetado —una gema de veintitantas caras suspendida en
  // el medio—, y el founder la señaló mirando producción: «esa esfera no
  // concuerda con el resto». Tenía razón: era un objeto de otra familia, con
  // otra iluminación y otro lenguaje, metido dentro del mismo vidrio.
  //
  // Lo que reemplaza a la gema no es un adorno nuevo: es la doctrina de N2
  // dicha en la materia de esta etapa. Si el motor no puede afirmar un techo,
  // no se inventa un nivel — se llena el vidrio ENTERO del mismo campo, sin
  // línea de agua y sin menisco. Un orbe sin techo se distingue de uno lleno
  // justo por eso: el lleno deja aire y tiene menisco; éste no tiene ninguno de
  // los dos, porque no hay ninguna altura que afirmar.
  vec3 core = vec3(0.0);
  float coreA = 0.0;

  // ── EL VIDRIO VACÍO, CON DISPERSIÓN ────────────────────────────────────────
  //
  // El rayo cruza la esfera y sale al cuarto. La novedad de N3B es que sale
  // TRES VECES, con un índice apenas distinto por canal: el vidrio real separa
  // los colores, y esa franja de color en el borde es la firma óptica que el ojo
  // asocia con cristal en vez de con plástico. Es lo que se ve en las gemas de
  // OPAL y lo que acá no había.
  vec3 backP = normalize(pf + rdi*tExit);
  vec3 empty;
  if(KIPU_TIER > 1.5){
    // LA DISPERSIÓN VIVE ACÁ Y EN NINGÚN OTRO LADO: el rayo sale tres veces con
    // un índice apenas distinto y cada canal se lee del suyo.
    //
    // Y LA SEPARACIÓN ES CHICA, porque medido con una separación grande esto
    // MIENTE. Con ±2,4 % los tres rayos aterrizaban en partes distintas del
    // cuarto cerca del borde: si el rojo pegaba en la ventana y el azul no,
    // salía ámbar puro — [199,161,64] en un orbe cuyo pigmento es turquesa. Un
    // vidrio real separa cerca del 1 % (número de Abbe ~58), no un 5 %. Y
    // además la franja se mezcla contra la muestra acromática, así que el color
    // es un BORDE y nunca puede pintar la esfera entera.
    vec3 eR = refract(rdi, -backP, 1.0/0.8955);
    vec3 eG = refract(rdi, -backP, 1.0/0.9000);
    vec3 eB = refract(rdi, -backP, 1.0/0.9045);
    if(dot(eR,eR) < 0.0001) eR = reflect(rdi, -backP);
    if(dot(eG,eG) < 0.0001) eG = reflect(rdi, -backP);
    if(dot(eB,eB) < 0.0001) eB = reflect(rdi, -backP);
    vec3 sG = envSample(eG);
    empty = mix(sG, vec3(envSample(eR).r, sG.g, envSample(eB).b), 0.55);
  } else {
    vec3 eG = refract(rdi, -backP, 1.0/0.900);
    if(dot(eG,eG) < 0.0001) eG = reflect(rdi, -backP);
    empty = envSample(eG);
  }
  // El cuarto nuevo trae MUCHA más luz que el degradado que reemplazó (tiene
  // ventana, horizonte y pared), así que la ganancia baja en la misma
  // proporción. Con la vieja, el vidrio vacío salía más brillante que el
  // líquido y el orbe se leía al revés: el aire pesaba más que el agua.
  empty = empty * mix(0.72, 0.62, uDay)
        + mix(uAcc, vec3(1.0), 0.42) * 0.050 * pow(1.0 - ndv, 1.6);
  // …y cuando no hay techo, ese vidrio vacío ES el campo, entero.
  // 1,02 y no 1,30: medido, con ganancia el extremo claro de la rampa recorta
  // y el cristal sale con un agujero blanco en el medio.
  empty = mix(empty, gField * 1.02, crystal * 0.86);

  // El borde es el ACENTO de la capa, y nada más. Intenté sumarle aquí la
  // dispersión otra vez y salió mal, medido: el término era 'sR - sB', o sea la
  // diferencia entre DOS MUESTRAS DEL ENTORNO EN DIRECCIONES DISTINTAS, no una
  // diferencia espectral. Cerca del borde de abajo los dos rayos divergen mucho,
  // así que teñía media esfera de rojo — [149,89,100] donde todo lo demás era
  // azul. La dispersión ya está donde corresponde: en 'empty', un canal por
  // índice. Sumarla dos veces no es más física, es un error de color.
  vec3 rim = uAcc * (fres*0.10 + rimw*0.20) * mix(1.0, 1.75, uDay);

  vec3 col = body*has + empty*(1.0 - has*0.985) + core*coreA + rim
           + reflection * (1.0 - has*0.62);
  float alpha = clamp(has*(0.42 + 0.56*clamp(thick*1.25,0.0,1.0)) + coreA*0.90
                      + (1.0 - has)*mix(0.23, 0.30, uDay)
                      // sin techo el vidrio está LLENO del campo, así que tapa
                      // como un cuerpo y no como un vaso vacío
                      + crystal*0.52
                      + fres*0.30 + rimw*0.62
                      + clamp(schlick*1.15, 0.0, 0.85) + 0.02, 0.0, 1.0);
  // EN CLARO EL VIDRIO SE APAGA, y no es un gusto: el lienzo va PREMULTIPLICADO
  // y con mezcla aditiva, así que sobre una página blanca el aire del orbe
  // sumaba luz hasta saturar — un orbe vacío se leía como una bola blanca y uno
  // lleno perdía el nivel. Medido sobre la comparación de G6. Bajar el color y
  // subir la opacidad es lo mismo que decir: en claro el vidrio TAPA la página
  // en vez de sumarse a ella.
  if(uDay > 0.5){ col *= 0.66; alpha = clamp(alpha*1.34, 0.0, 1.0); }

  // ── PROFUNDIDAD ENTRE ORBES (F7) ───────────────────────────────────────────
  //
  // El founder dijo que las capas «se pisan»: dos círculos traslúcidos que se
  // cruzan producen una lente más clara con dos bordes duros, y eso no se lee
  // como una esfera pasando delante de otra — se lee como dos calcomanías.
  // La que está detrás recibe perspectiva aérea: pierde contraste y se va hacia
  // el color del cuarto, exactamente como algo que está más lejos. Y la de
  // adelante gana opacidad, así que TAPA en vez de sumarse.
  if(uDepth > 0.001){
    vec3 air = mix(ENV_FLOOR, ENV_FLOOR_DAY, uDay) * 3.0;
    col = mix(col, air, uDepth*0.34);
    col *= 1.0 - uDepth*0.30;
  } else {
    alpha = clamp(alpha * 1.16, 0.0, 1.0);
  }

#ifdef GL_OES_standard_derivatives
  float aa = max(fwidth(r), 0.0015);
#else
  float aa = 0.006;
#endif
  float edge = 1.0 - smoothstep(1.0 - aa*1.3, 1.0 + aa*0.4, r);

  vec3 outCol = tonemap(col*edge + soul);
  float outA = clamp(alpha*edge + soulA + shadow*(1.0-edge), 0.0, 1.0);
  gl_FragColor = vec4(outCol * uPresence, outA * uPresence);
}`;

type Gl = WebGLRenderingContext | WebGL2RenderingContext;
type RenderTier = 1 | 2 | 3;

/**
 * N3C · EL RELOJ DEL PORTE FIEL, tal como lo lleva su `useFrame`:
 *
 *     uTime      += delta * 0.5
 *     speed       = 0.1 + (1 - (out - 1)^2) * 0.9
 *     uAnimation += delta * speed
 *
 * Su suavizado exponencial de la velocidad se resuelve en el punto fijo: la
 * comparación se mira en régimen, no en el primer segundo.
 */
export function orbReferenceClock(time: number, outputVolume: number): {
  time: number;
  animation: number;
} {
  const out = Math.min(1, Math.max(0, outputVolume));
  const speed = 0.1 + (1 - Math.pow(out - 1, 2)) * 0.9;
  const scaled = time * 0.5;
  return { time: scaled, animation: scaled * speed };
}

function compileShader(gl: Gl, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface ProgramBundle {
  tier: RenderTier;
  program: WebGLProgram;
  locations: {
    canvas: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    span: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    level: WebGLUniformLocation | null;
    energy: WebGLUniformLocation | null;
    day: WebGLUniformLocation | null;
    material: WebGLUniformLocation | null;
    voice: WebGLUniformLocation | null;
    presence: WebGLUniformLocation | null;
    spin: WebGLUniformLocation | null;
    wave: WebGLUniformLocation | null;
    bob: WebGLUniformLocation | null;
    depth: WebGLUniformLocation | null;
    env: WebGLUniformLocation | null;
    field: WebGLUniformLocation | null;
    perlin: WebGLUniformLocation | null;
    fluid: WebGLUniformLocation | null;
    hasFluid: WebGLUniformLocation | null;
    tilt: WebGLUniformLocation | null;
    liquid: WebGLUniformLocation | null;
    deep: WebGLUniformLocation | null;
    accent: WebGLUniformLocation | null;
  };
}

const RENDER_TIERS: readonly RenderTier[] = [1, 2, 3];

function linkTierProgram(
  gl: Gl,
  vertex: WebGLShader,
  tier: RenderTier,
): ProgramBundle | null {
  const source = FRAGMENT_SOURCE
    .replace("__KIPU_TIER__", `${tier}.0`)
    .replace("__KIPU_NOISE__", `${ORB_NOISE_SIZE}.0`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, source);
  if (!fragment) return null;
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aQuad");
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return {
    tier,
    program,
    locations: {
      canvas: uniform("uCanvas"),
      center: uniform("uCenter"),
      span: uniform("uSpan"),
      time: uniform("uTime"),
      level: uniform("uLevel"),
      energy: uniform("uEnergy"),
      day: uniform("uDay"),
      material: uniform("uMat"),
      voice: uniform("uVoice"),
      presence: uniform("uPresence"),
      spin: uniform("uSpin"),
      wave: uniform("uWave"),
      bob: uniform("uBob"),
      depth: uniform("uDepth"),
      env: uniform("uEnv"),
      field: uniform("uField"),
      perlin: uniform("uPerlin"),
      fluid: uniform("uFluid"),
      hasFluid: uniform("uHasFluid"),
      tilt: uniform("uTilt"),
      liquid: uniform("uLiq"),
      deep: uniform("uDeep"),
      accent: uniform("uAcc"),
    },
  };
}

/**
 * §5.1 · «Trabajamos desde lo más alto posible», literal.
 *
 * Hasta N2 el orbe le PEDÍA a la GPU el camino de bajo consumo, sin antialiasing
 * y en WebGL1 — en un iPhone, dejar rendimiento sobre la mesa a propósito. Ahora
 * se pide WebGL2 con alto rendimiento, y WebGL1 queda como degradado honesto:
 * el shader está escrito en GLSL ES 1.00, que compila en los dos, así que la
 * rama de degradado es la MISMA que se ejecuta todos los días y no una segunda
 * versión que nadie probó nunca.
 */
function acquireContext(canvas: HTMLCanvasElement): { gl: Gl; version: 1 | 2 } | null {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: false,
    powerPreference: "high-performance",
    // N2 §5.1 · Un lienzo pausado no puede quedarse en blanco: cuando la hoja
    // de conversación tapa el orbe el bucle para, y el último cuadro tiene que
    // sobrevivir debajo.
    preserveDrawingBuffer: true,
  };
  const gl2 = canvas.getContext("webgl2", attributes);
  if (gl2) return { gl: gl2, version: 2 };
  const gl1 = canvas.getContext("webgl", attributes);
  if (gl1) return { gl: gl1, version: 1 };
  return null;
}

/**
 * N3C · LA TELA, SUBIDA UNA VEZ.
 *
 * `LUMINANCE` de un byte porque el shader lee un solo canal, `REPEAT` porque el
 * flujo la desplaza sin techo, y 256 —potencia de dos— porque WebGL1 sólo
 * repite texturas POT. Y `LINEAR` sin mipmaps: con mipmaps, las lecturas de las
 * franjas angulares saltarían de nivel y el campo temblaría.
 */
function uploadNoise(gl: Gl): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.LUMINANCE,
    ORB_NOISE_SIZE,
    ORB_NOISE_SIZE,
    0,
    gl.LUMINANCE,
    gl.UNSIGNED_BYTE,
    orbNoiseTexture(ORB_NOISE_SIZE, ORB_NOISE_SEED),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

interface ReferenceBundle {
  program: WebGLProgram;
  canvas: WebGLUniformLocation | null;
  center: WebGLUniformLocation | null;
  span: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  animation: WebGLUniformLocation | null;
  inverted: WebGLUniformLocation | null;
  offsets: WebGLUniformLocation | null;
  color1: WebGLUniformLocation | null;
  color2: WebGLUniformLocation | null;
  input: WebGLUniformLocation | null;
  output: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  perlin: WebGLUniformLocation | null;
}

export interface OrbRendererOptions {
  /**
   * N3C · SÓLO PARA LA MESA DE LUZ. La fuente GLSL del porte fiel del orbe de
   * ElevenLabs. Se INYECTA en vez de importarse para que el shader de la
   * comparación no viaje en el paquete del santuario: producción llama a
   * `createOrbRenderer` sin opciones y el programa no llega a existir.
   */
  referenceFragmentSource?: string;
}

export function createOrbRenderer(
  canvas: HTMLCanvasElement,
  options: OrbRendererOptions = {},
): OrbRenderer | null {
  const acquired = acquireContext(canvas);
  if (!acquired) return null;
  const { gl, version } = acquired;
  // Core en WebGL2; en WebGL1 hay que pedirla, y si no está el shader cae a un
  // ancho de borde fijo en vez de mentir con una derivada que no existe.
  if (version === 1) gl.getExtension("OES_standard_derivatives");

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  if (!vertex) return null;
  const programs: ProgramBundle[] = [];
  for (const tier of RENDER_TIERS) {
    const bundle = linkTierProgram(gl, vertex, tier);
    if (!bundle) {
      for (const compiled of programs) gl.deleteProgram(compiled.program);
      gl.deleteShader(vertex);
      return null;
    }
    programs.push(bundle);
  }
  let reference: ReferenceBundle | null = null;
  if (options.referenceFragmentSource) {
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, options.referenceFragmentSource);
    const program = fragment ? gl.createProgram() : null;
    if (fragment && program) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.bindAttribLocation(program, 0, "aQuad");
      gl.linkProgram(program);
      gl.deleteShader(fragment);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const at = (name: string) => gl.getUniformLocation(program, name);
        reference = {
          program,
          canvas: at("uCanvas"),
          center: at("uCenter"),
          span: at("uSpan"),
          time: at("uTime"),
          animation: at("uAnimation"),
          inverted: at("uInverted"),
          offsets: at("uOffsets[0]"),
          color1: at("uColor1"),
          color2: at("uColor2"),
          input: at("uInputVolume"),
          output: at("uOutputVolume"),
          opacity: at("uOpacity"),
          perlin: at("uPerlin"),
        };
      } else {
        gl.deleteProgram(program);
      }
    } else if (fragment) {
      gl.deleteShader(fragment);
    }
  }
  gl.deleteShader(vertex);

  const buffer = gl.createBuffer();
  if (!buffer) {
    for (const compiled of programs) gl.deleteProgram(compiled.program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // EL FLUIDO. Puede no existir —hay teléfonos sin texturas de coma flotante—
  // y en ese caso el orbe vuelve a su deformación de ruido. Nunca se finge.
  const fluid: OrbFluid | null = createOrbFluid(gl);

  const noise = uploadNoise(gl);
  if (!noise) {
    gl.deleteBuffer(buffer);
    for (const compiled of programs) gl.deleteProgram(compiled.program);
    if (reference) gl.deleteProgram(reference.program);
    return null;
  }
  for (const bundle of programs) {
    gl.useProgram(bundle.program);
    gl.uniform1i(bundle.locations.perlin, 0);
    gl.uniform1i(bundle.locations.fluid, 1);
    gl.uniform1f(bundle.locations.hasFluid, fluid ? 1 : 0);
  }
  if (reference) {
    // Los siete desfasajes son de SU componente, no del nuestro: nuestro campo
    // ya no tiene óvalos que desfasar.
    gl.useProgram(reference.program);
    gl.uniform1i(reference.perlin, 0);
    gl.uniform1fv(reference.offsets, orbSeededAngles(ORB_NOISE_SEED, ORB_FIELD_OVALS));
  }

  let cssWidth = 1;
  let cssHeight = 1;
  let antialias = gl.getContextAttributes()?.antialias === true;
  let disposed = false;

  return {
    resize(nextCssWidth, nextCssHeight, requestedDpr) {
      const dpr = Math.min(Math.max(requestedDpr || 1, 1), 2);
      cssWidth = Math.max(1, nextCssWidth);
      cssHeight = Math.max(1, nextCssHeight);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      antialias = gl.getContextAttributes()?.antialias === true;
      return { dpr, width, height, glVersion: version, antialias };
    },
    draw(frame) {
      if (disposed || gl.isContextLost()) return;
      const bundle = programs[frame.tier - 1];
      if (!bundle) return;
      const { locations } = bundle;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Atrás primero: las vecinas quedan DEBAJO de la activa, así que al
      // solaparse durante el gesto la que mirás nunca queda tapada.
      const ordered = [...frame.orbs]
        .filter((orb) => orb.presence > 0.002 && orb.radius > 0.5)
        .sort((a, b) => b.presence - a.presence);
      // El porte fiel de ellos: mismo lienzo, mismo contexto, mismo reloj. Si
      // nadie inyectó su fuente, estas llamadas no dibujan nada — no hay una
      // segunda versión silenciosa de nuestro orbe.
      if (reference) {
        gl.useProgram(reference.program);
        gl.uniform2f(reference.canvas, cssWidth, cssHeight);
        gl.uniform1f(reference.opacity, 1);
        gl.uniform1f(reference.inverted, frame.day > 0.5 ? 0 : 1);
        for (let i = ordered.length - 1; i >= 0; i -= 1) {
          const orb = ordered[i]!;
          if (!orb.reference) continue;
          const clock = orbReferenceClock(frame.time, orb.energy);
          gl.uniform2f(reference.center, orb.centerX, orb.centerY);
          gl.uniform1f(reference.span, orb.radius * ORB_SPAN);
          gl.uniform1f(reference.time, clock.time);
          gl.uniform1f(reference.animation, clock.animation);
          gl.uniform1f(reference.input, orb.voice);
          gl.uniform1f(reference.output, orb.energy);
          gl.uniform3fv(reference.color1, orb.deep);
          gl.uniform3fv(reference.color2, orb.liquid);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      // ── UN PASO DE FLUIDO POR CUADRO, ANTES DE DIBUJAR ──────────────────
      // El calendario de empujones es una función PURA: el gate la ejecuta y le
      // exige que en silencio siga habiendo movimiento y que la voz empuje
      // mucho más. Lo que corre en la GPU es sólo el solver.
      if (fluid) {
        fluid.step(
          frame.dtSeconds,
          orbFluidSplats({
            time: frame.time,
            voice: frame.voice,
            wave: frame.wave,
            dtSeconds: frame.dtSeconds,
          }),
          ORB_FLUID_ITERATIONS[frame.tier],
        );
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fluid.texture);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, noise);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.useProgram(bundle.program);
      gl.uniform2f(locations.canvas, cssWidth, cssHeight);
      gl.uniform1f(locations.time, frame.time);
      gl.uniform1f(locations.day, frame.day);
      for (let i = ordered.length - 1; i >= 0; i -= 1) {
        const orb = ordered[i]!;
        if (orb.reference) continue;
        gl.uniform2f(locations.center, orb.centerX, orb.centerY);
        gl.uniform1f(locations.span, orb.radius * ORB_SPAN);
        gl.uniform1f(locations.level, orb.waterline);
        gl.uniform1f(locations.energy, orb.energy);
        gl.uniform1f(locations.material, orb.material);
        gl.uniform1f(locations.voice, orb.voice);
        gl.uniform1f(locations.presence, orb.presence);
        gl.uniform1f(locations.spin, orb.spin);
        gl.uniform1f(locations.wave, orb.wave);
        gl.uniform1f(locations.bob, orb.bob);
        gl.uniform1f(locations.depth, orb.depth);
        gl.uniform1f(locations.env, orb.env);
        gl.uniform1f(locations.field, orb.field);
        gl.uniform2f(locations.tilt, orb.tiltX, orb.tiltZ);
        gl.uniform3fv(locations.liquid, orb.liquid);
        gl.uniform3fv(locations.deep, orb.deep);
        gl.uniform3fv(locations.accent, orb.accent);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
    warmFluid(seconds, voice = 0) {
      if (!fluid || disposed) return;
      const dt = 1 / 60;
      const pasos = Math.max(0, Math.min(600, Math.round(seconds / dt)));
      for (let i = 0; i < pasos; i += 1) {
        const t = i * dt;
        fluid.step(
          dt,
          orbFluidSplats({ time: t, voice, wave: 0, dtSeconds: dt }),
          ORB_FLUID_ITERATIONS[3],
        );
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    hasFluid() {
      return fluid !== null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      fluid?.dispose();
      gl.deleteBuffer(buffer);
      gl.deleteTexture(noise);
      for (const compiled of programs) gl.deleteProgram(compiled.program);
      if (reference) gl.deleteProgram(reference.program);
    },
  };
}
