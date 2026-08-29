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
  material: number;
  liquid: OrbRgb;
  deep: OrbRgb;
  accent: OrbRgb;
}

export interface OrbFrame {
  time: number;
  day: number;
  tier: 1 | 2 | 3;
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
uniform vec2 uTilt;
uniform vec3 uLiq, uDeep, uAcc;
const float KIPU_TIER = __KIPU_TIER__;
const vec3 LKEY = vec3(-0.4082, 0.8367, 0.3646);
const vec3 LFILL = vec3(0.6396, -0.2559, 0.7248);
// EL ESTUDIO. Un vidrio de verdad no refleja un punto: refleja un CUARTO. Hasta
// acá el orbe tenía un especular y un borde, que es lo que se ve en una bola de
// plástico. Esto es un entorno procedural —suelo, cielo, un panel de luz
// principal y un relleno frío— y es NEUTRO y COMPARTIDO a propósito: las cinco
// capas se reflejan en el mismo cuarto, que es la mitad de por qué se sienten
// del mismo mundo. Lo que las distingue sigue siendo el pigmento, no la luz.
// El cuarto SIGUE AL TEMA. Con un estudio oscuro fijo, sobre fondo claro el
// vidrio vacío se leía como una cúpula gris pegoteada: un vidrio refleja el
// cuarto donde está, y en tema claro el cuarto es claro.
const vec3 ENV_SKY = vec3(0.052, 0.070, 0.094);
const vec3 ENV_FLOOR = vec3(0.011, 0.013, 0.018);
const vec3 ENV_SKY_DAY = vec3(0.300, 0.322, 0.360);
const vec3 ENV_FLOOR_DAY = vec3(0.132, 0.146, 0.172);
const vec3 ENV_KEY = vec3(0.86, 0.92, 1.00);
const vec3 ENV_FILL = vec3(0.34, 0.44, 0.62);
const float WAVE_AMP = 0.026;
// LA CÁMARA MIRA UN POCO DESDE ARRIBA. Es el cambio que convierte el orbe de un
// disco con una raya en un VOLUMEN: mirada de frente, la superficie del agua es
// una cuerda recta; inclinada, es una elipse, y el ojo lee profundidad al
// instante. La silueta sigue siendo un círculo perfecto —se inclina el plano
// del agua, no la esfera—, así que el orbe no se deforma en la maqueta.
// Negativo a propósito: mirando el agua DESDE ARRIBA, el borde lejano de la
// elipse queda ALTO y el cercano BAJO. Con el signo al revés se mira la
// superficie por debajo, y el vaso parece más lleno de lo que está.
const float CAM_PITCH = -0.30;
const float MENISCUS = 0.078;
// Cuatro trenes de olas en direcciones que NO son perpendiculares. Con senos en
// x y en z puros el campo es separable y su cáustica sale como una reja de
// rayas paralelas; cruzadas, sale la RED que uno reconoce del fondo de una
// pileta. Dos de marejada, dos de rizo.
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
vec3 envSample(vec3 d){
  float up = d.y*0.5 + 0.5;
  vec3 base = mix(mix(ENV_FLOOR, ENV_FLOOR_DAY, uDay),
                  mix(ENV_SKY, ENV_SKY_DAY, uDay),
                  pow(up, 1.35));
  float k = max(dot(d, LKEY), 0.0);
  // el panel: un núcleo chico y duro dentro de una caja grande y suave, que es
  // como se ve una ventana reflejada en vidrio
  base += ENV_KEY * (pow(k, 220.0)*1.15 + pow(k, 14.0)*0.30 + pow(k, 2.6)*0.055);
  base += ENV_FILL * pow(max(dot(d, LFILL), 0.0), 5.0) * 0.085;
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

// La misma exposición para las cinco. Filmic ACES: sin esto, un pigmento claro
// se satura y uno oscuro se apaga, que es exactamente la asimetría fotografiada.
vec3 tonemap(vec3 x){
  x *= 1.04;
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}

// EL TOPE DEL VASO YA VINO MAPEADO. uLevel es altura de TRAZO, no un dato:
// quien lo acotó fue orbWaterline en el contrato puro, y la cifra y la frase
// nunca lo vieron. Aquí sólo se convierte de 0–1 del vidrio a la coordenada Y
// de la esfera.
float waterBase(){ return uLevel * 2.0 - 1.0; }

float waveAmp(){
  return WAVE_AMP * (1.0 + uEnergy*2.2 + min(length(uTilt)*3.4, 1.6));
}

float waterHeight(vec3 p, float detail){
  float base = waterBase();
  float lean = dot(p.xz, uTilt);
  float A = waveAmp();
  // La marejada da el vaivén; el rizo da la RED de la cáustica, porque la
  // curvatura va con el CUADRADO de la frecuencia: pesa poco en la altura y
  // muchísimo en dónde se junta la luz.
  float w = A*(       sin(dot(p.xz, WD1)*4.40 + uTime*0.85)
              + 0.75*sin(dot(p.xz, WD2)*3.20 - uTime*0.66)
              + 0.20*sin(dot(p.xz, WD3)*11.70 - uTime*1.35)
              + 0.20*sin(dot(p.xz, WD4)*9.30 + uTime*1.12));
  if(detail > 0.5){
    w += (fbm(p.xz*2.6 + vec2(uTime*0.15, 0.0)) - 0.5)*A*2.4;
  }
  // EL MENISCO: el agua trepa por la pared. Se mide contra el radio REAL del
  // vidrio a esa altura, no contra el eje — si no, cerca del tope curvaría donde
  // no hay pared. Es la mitad de por qué un orbe lleno se lee lleno.
  float wallR = sqrt(max(0.0, 1.0 - base*base));
  float rad = length(p.xz);
  float men = smoothstep(wallR*0.42, wallR*1.02, rad) * MENISCUS;
  return base + lean + w + men;
}

void main(){
  vec2 uv = vP;
  float r = length(uv);
  float rr = r*r;

  // El halo es DISPERSIÓN de la misma luz, no un box-shadow: varía por
  // dirección y nunca por atan, así que no hay costura.
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
    // La luz se dispersa más hacia donde ilumina.
    halo *= 0.80 + 0.34*max(dot(dir, LKEY.xy), 0.0);
    vec3 sc = mix(uAcc, uLiq, 0.45);
    soul = sc * halo * (0.21 + 0.30*uVoice);
    // En claro el halo aporta MENOS: un resplandor claro sobre una página clara
    // engorda la silueta en vez de separarla del fondo.
    soulA = clamp(halo*(0.105 + 0.20*uVoice) * mix(1.0, 0.50, uDay), 0.0, 1.0);
  }

  // SOMBRA PROPIA. Con alfa premultiplicado un color negro con alfa oscurece lo
  // que hay detrás, así que la sombra es de verdad y no un degradado pintado.
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
  float t0 = -b - h, t1 = -b + h;
  vec3 pf = ro + rd*t0;
  vec3 N = normalize(pf);
  vec3 V = -rd;
  float ndv = max(dot(N,V), 0.0);
  float fres = pow(1.0 - ndv, 3.4);

  // Refracción al entrar en el vidrio: es lo que da PROFUNDIDAD. Sin esto el
  // agua es un relleno plano detrás de una bola.
  // La refracción se ablanda A PROPÓSITO. Con el índice del vidrio real los
  // rayos del borde se doblan tanto que casi todos terminan en el agua, y
  // entonces el orbe se ve lleno mire donde mire: la refracción se comía el
  // NIVEL, que es lo único que este objeto tiene que decir. Queda la que
  // muestra volumen sin mentir sobre la altura.
  vec3 rdi = refract(rd, N, 0.90);

  // EL AGUA SE RESUELVE, NO SE MARCHA.
  //
  // Hasta acá el volumen se muestreaba paso a paso, y con los pasos que aguanta
  // un teléfono la superficie salía gruesa y temblona — 34 muestras para una
  // línea que necesita precisión de píxel. El plano del agua es un PLANO: su
  // corte con el rayo tiene solución exacta, y una sola iteración de Newton le
  // agrega la ola y el menisco. Sale más nítido y cuesta una fracción.
  float tExit = max(0.0, -2.0*dot(pf, rdi));
  vec3 qo = toWater(pf);
  vec3 qd = toWater(rdi);
  float base = waterBase();
  float wallR = sqrt(max(0.0, 1.0 - base*base));

  float tA = 0.0, tB = 0.0;
  float tS = -1.0;
  float surfaceSeen = 0.0;
  vec3 qSurf = qo;
  if(abs(qd.y) > 0.0015){
    tS = (base - qo.y) / qd.y;
    vec3 guess = qo + qd*tS;
    tS += (waterHeight(guess, KIPU_TIER > 1.5 ? 1.0 : 0.0) - guess.y) / qd.y;
    qSurf = qo + qd*tS;
    if(qd.y < 0.0){ tA = max(0.0, tS); tB = tExit; }
    else { tA = 0.0; tB = min(tS, tExit); }
    if(tS > 0.0 && tS < tExit && dot(qSurf, qSurf) <= 1.0) surfaceSeen = 1.0;
  } else {
    // Rayo paralelo al agua: o está entero abajo, o entero arriba.
    tA = 0.0;
    tB = qo.y < base ? tExit : 0.0;
  }
  float thick = max(0.0, tB - tA);
  float has = smoothstep(0.0, 0.030, thick);
  float hit = step(0.004, thick);

  // LA MATERIA DE CRISTAL NO LLEVA AGUA, y no es una decisión de estilo: cuando
  // el motor no puede afirmar un techo —Patrimonio siempre, y cualquier capa sin
  // denominador— un nivel sería una mentira. La doctrina de N2, ejecutada acá
  // donde se dibuja: sin techo honesto no hay línea de agua que mirar.
  float crystal = step(2.5, uMat) * step(uMat, 3.5);
  thick *= 1.0 - crystal;
  has *= 1.0 - crystal;
  hit *= 1.0 - crystal;
  surfaceSeen *= 1.0 - crystal;
  // Profundidad MEDIA del tramo mojado: es lo que la luz recorrió hacia abajo.
  float depth = max(0.0, base - (qo.y + qd.y*(tA + tB)*0.5));
  float below = clamp(depth*1.15, 0.0, 1.0);
  vec3 hp = qo + qd*mix(tA, tB, 0.62);

  // ESPESOR QUE SE NOTA — Beer-Lambert POR CANAL. El pigmento entra como
  // coeficiente de extinción, así que el agua no se limita a oscurecerse:
  // CAMBIA DE TONO al bajar, que es lo que hace un líquido de verdad. La misma
  // ley para las cinco capas; lo único distinto es de qué color se traga la luz.
  vec3 sigma = (vec3(1.0) - uLiq) * 1.55 + 0.16;
  vec3 Tl = exp(-sigma * depth * 1.45);
  vec3 body = mix(uDeep * 0.92, uLiq * 1.30, Tl);
  body *= 0.60 + 0.55 * clamp(thick * 1.15, 0.0, 1.0);

  // Corrientes lentas: el agua se mueve SIEMPRE, no sólo al tocar.
  float flow = fbm(vec2(uv.x*2.3 + uTime*0.055, uv.y*2.7 - uTime*0.042));
  float flow2 = fbm(vec2(uv.x*4.6 - uTime*0.03, uv.y*4.1 + uTime*0.025));
  body *= 0.82 + 0.30*flow + 0.12*flow2;

  if(KIPU_TIER > 1.5){
    // CÁUSTICA ENFOCADA — es CONVERGENCIA, no ruido.
    //
    // Hasta acá esto era fbm con un umbral: manchas que se movían, que es lo
    // que se ve cuando alguien dibuja «cáustica» sin calcularla. La cáustica
    // real es DENSIDAD DE RAYOS: donde la superficie curva junta la luz, el
    // mismo haz cae sobre menos fondo y brilla. Eso es el jacobiano del mapeo
    // superficie→fondo, y como la ola son dos senos sus segundas derivadas
    // salen EXACTAS — la cáustica de verdad cuesta dos senos más que la falsa.
    //
    // Donde el jacobiano se acerca a cero los rayos se cruzan y aparece la
    // línea brillante: por eso salen filamentos y no manchas.
    // LA CÁUSTICA VIVE EN EL FONDO DEL VASO, no flotando en el volumen. Pintada
    // en un punto cualquiera del rayo salían rayones cruzando el agua entera;
    // es una mancha de luz apoyada en la pared interior de abajo.
    vec3 qFloor = qo + qd*tExit;
    float dBelow = max(0.0, base - qFloor.y);
    float onFloor = smoothstep(0.04, 0.34, dBelow) * smoothstep(0.05, -0.55, qFloor.y);
    vec3 lw = toWater(LKEY);
    // por dónde entró ESE rayo de luz: se sigue la dirección de la LUZ hacia
    // arriba, no la del ojo. Sin esta paralaje el dibujo no se corre con la
    // profundidad y vuelve a parecer una calcomanía pegada al fondo.
    vec2 entry = qFloor.xz + (lw.xz / max(lw.y, 0.30)) * dBelow;
    // y gira con el vaso: el agua se la lleva consigo cuando lo hacés rodar
    entry = rotY(vec3(entry.x, 0.0, entry.y), uSpin).xz;
    float A = waveAmp();
    // Segundas derivadas EXACTAS de los cuatro trenes, montadas en la HESSIANA
    // completa. El jacobiano del mapeo superficie→fondo es su determinante:
    // donde se acerca a cero los rayos se cruzan y ahí está la línea brillante.
    // Con el término cruzado la red se cierra; sin él quedaban rayas paralelas.
    float h1 = -A * 1.00 *  19.36 * sin(dot(entry, WD1)*4.40 + uTime*0.85);
    float h2 = -A * 0.75 *  10.24 * sin(dot(entry, WD2)*3.20 - uTime*0.66);
    float h3 = -A * 0.20 * 136.89 * sin(dot(entry, WD3)*11.70 - uTime*1.35);
    float h4 = -A * 0.20 *  86.49 * sin(dot(entry, WD4)*9.30 + uTime*1.12);
    float hxx = h1*WD1.x*WD1.x + h2*WD2.x*WD2.x + h3*WD3.x*WD3.x + h4*WD4.x*WD4.x;
    float hyy = h1*WD1.y*WD1.y + h2*WD2.y*WD2.y + h3*WD3.y*WD3.y + h4*WD4.y*WD4.y;
    float hxy = h1*WD1.x*WD1.y + h2*WD2.x*WD2.y + h3*WD3.x*WD3.y + h4*WD4.x*WD4.y;
    float f = dBelow * 3.4;
    float jac = abs((1.0 + f*hxx)*(1.0 + f*hyy) - f*f*hxy*hxy);
    float caus = clamp(1.0/max(jac, 0.11) - 1.0, 0.0, 4.0);
    body += mix(uAcc, vec3(1.0), 0.46) * caus * hit * onFloor * 0.22;
  }

  // LA SUPERFICIE, VISTA COMO LO QUE ES: un disco dentro de la esfera. En
  // perspectiva se lee como una elipse, y su borde brillante es EL MENISCO —
  // el sitio exacto donde el agua toca el vidrio. Es lo que hace que un orbe
  // lleno se lea lleno en vez de pintado.
  float rho = length(qSurf.xz);
  float ring = smoothstep(wallR*0.70, wallR*1.005, rho);
  float glance = pow(1.0 - min(1.0, abs(normalize(qd).y)), 3.0);
  float sheen = surfaceSeen * clamp(ring*0.85 + glance*0.55, 0.0, 1.0);
  body += mix(uAcc, vec3(1.0), 0.34) * sheen * 1.25;

  if(KIPU_TIER > 2.5){
    // MOTAS SUSPENDIDAS, en el volumen y no pegadas a la pantalla: se mide la
    // distancia del rayo REFRACTADO a un punto 3D, así que derivan con
    // profundidad y giran con el orbe.
    float motes = 0.0;
    for(int i=0;i<7;i++){
      float fi = float(i);
      // La mota vive EN EL AGUA, así que su altura se juzga en espacio de agua
      // y su distancia al rayo en espacio de vista. Mezclar los dos la habría
      // dejado flotando fuera del líquido cuando el vaso está a medio llenar.
      vec3 mq = rotY(vec3(
        sin(uTime*0.11 + fi*2.13)*0.56,
        fract(uTime*0.020 + fi*0.1631)*1.72 - 0.86,
        cos(uTime*0.09 + fi*1.71)*0.56), uSpin);
      if(mq.y < base + dot(mq.xz, uTilt)){
        vec3 mp = fromWater(mq);
        motes += smoothstep(0.034, 0.004, length(cross(mp - pf, rdi)));
      }
    }
    body += mix(uAcc, vec3(1.0), 0.45) * motes * 0.52 * hit;
  }

  // EL VIDRIO REFLEJA EL CUARTO, no un punto. Fresnel de Schlick sobre el
  // entorno: de frente el vidrio es casi transparente y al ras devuelve casi
  // todo, que es exactamente lo que hace que se lea como vidrio y no como
  // plástico brillante.
  vec3 R = reflect(-V, N);
  float schlick = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
  vec3 reflection = envSample(R) * schlick * mix(2.35, 1.45, uDay);
  float rimw = pow(1.0 - ndv, 5.0);
  vec3 irid = 0.5 + 0.5*cos(6.28318*(vec3(0.0,0.34,0.68) + fres*1.5 + uTime*0.025));
  vec3 rim = mix(uAcc, irid, 0.26) * (fres*0.62 + rimw*1.05);

  // Patrimonio conserva su núcleo de cristal, y no por estética: el motor no
  // puede afirmarle un techo honesto, así que un nivel sería una mentira.
  vec3 core = vec3(0.0);
  float coreA = 0.0;
  if(uMat > 2.5 && uMat < 3.5){
    float cr = 0.38;
    float bb = dot(pf, rdi), cc2 = dot(pf,pf) - cr*cr, hh = bb*bb - cc2;
    if(hh > 0.0){
      hh = sqrt(hh);
      float ct0 = max(-bb - hh, 0.0);
      vec3 cn = normalize(pf + rdi*ct0);
      float rota = uTime*0.05 + uSpin;
      vec2 sph = vec2(atan(cn.z, cn.x) + rota, acos(clamp(cn.y,-1.0,1.0)));
      vec2 q = vec2(sph.x*1.55, sph.y*2.15);
      vec2 tri = vec2(q.x + q.y*0.577, q.y*1.155);
      float fx = fract(tri.x), fy = fract(tri.y);
      float sub = step(1.0, fx + fy);
      vec2 cell = floor(tri) + mix(vec2(0.3333), vec2(0.6667), sub);
      float qy = cell.y/1.155, qx = cell.x - qy*0.577;
      vec2 cs = vec2(qx/1.55, qy/2.15);
      vec3 fn = rotY(normalize(vec3(sin(cs.y)*cos(cs.x), cos(cs.y), sin(cs.y)*sin(cs.x))), -rota);
      float lam = max(dot(fn, LKEY), 0.0);
      float sp = pow(max(dot(reflect(rdi, fn), LKEY), 0.0), 24.0);
      float fh = hash21(floor(tri) + sub*17.0);
      core = uDeep*(0.75 + 0.35*fh) + uLiq*(0.16 + 0.80*lam*lam);
      core += vec3(0.94,0.98,1.0) * sp * 0.85;
      float cfres = pow(1.0 - max(dot(cn, -rdi), 0.0), 2.4);
      core += uAcc * cfres * 0.75;
      coreA = clamp(0.88 + cfres*0.28, 0.0, 1.0);
    }
  }

  // ARRIBA DE LA LÍNEA HAY VIDRIO, Y EL VIDRIO TIENE CUERPO: una pared trasera
  // que devuelve algo de luz y un tinte propio. Sin esto, un orbe a medio llenar
  // se lee como media bola cortada sobre un agujero negro — y entonces el tope
  // del vaso no serviría de nada, porque el aire de arriba no se vería.
  // Y por el vidrio VACÍO se ve el cuarto, refractado: el rayo entra, cruza la
  // esfera y sale al entorno. Antes era un degradado inventado; ahora es el
  // mismo estudio que se refleja por fuera, lo que ata las dos mitades.
  vec3 backP = normalize(pf + rdi*tExit);
  vec3 exitDir = refract(rdi, -backP, 1.0/0.90);
  if(dot(exitDir, exitDir) < 0.0001) exitDir = reflect(rdi, -backP);
  // En claro el vidrio DEJA PASAR el fondo en vez de pintarlo: menos energía y
  // menos cobertura. Un vidrio vacío que tapa la página no es vidrio, es una
  // bola blanca.
  vec3 empty = envSample(exitDir) * mix(2.15, 1.05, uDay)
             + mix(uAcc, vec3(1.0), 0.42) * 0.085 * pow(1.0 - ndv, 1.6);

  vec3 col = body*has + empty*(1.0 - has*0.74) + core*coreA + rim + reflection;
  float alpha = clamp(has*(0.42 + 0.56*clamp(thick*1.25,0.0,1.0)) + coreA*0.90
                      + (1.0 - has)*mix(0.23, 0.12, uDay)
                      + fres*0.30 + rimw*0.62
                      + clamp(schlick*1.15, 0.0, 0.85) + sheen*0.4 + 0.02, 0.0, 1.0);
  if(uDay > 0.5){ col *= 0.88; alpha = clamp(alpha*1.20, 0.0, 1.0); }

  // BORDE DE UN PÍXEL EXACTO, a cualquier DPR. Para una esfera calculada en el
  // fragmento el MSAA no hace nada —sólo suaviza bordes de geometría, y aquí la
  // geometría es un cuadrilátero—, así que el antialiasing que sirve es este:
  // analítico, con la derivada del radio.
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
  const source = FRAGMENT_SOURCE.replace("__KIPU_TIER__", `${tier}.0`);
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

export function createOrbRenderer(canvas: HTMLCanvasElement): OrbRenderer | null {
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
      gl.useProgram(bundle.program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(locations.canvas, cssWidth, cssHeight);
      gl.uniform1f(locations.time, frame.time);
      gl.uniform1f(locations.day, frame.day);
      // Atrás primero: las vecinas quedan DEBAJO de la activa, así que al
      // solaparse durante el gesto la que mirás nunca queda tapada.
      const ordered = [...frame.orbs]
        .filter((orb) => orb.presence > 0.002 && orb.radius > 0.5)
        .sort((a, b) => b.presence - a.presence);
      for (let i = ordered.length - 1; i >= 0; i -= 1) {
        const orb = ordered[i]!;
        gl.uniform2f(locations.center, orb.centerX, orb.centerY);
        gl.uniform1f(locations.span, orb.radius * ORB_SPAN);
        gl.uniform1f(locations.level, orb.waterline);
        gl.uniform1f(locations.energy, orb.energy);
        gl.uniform1f(locations.material, orb.material);
        gl.uniform1f(locations.voice, orb.voice);
        gl.uniform1f(locations.presence, orb.presence);
        gl.uniform1f(locations.spin, orb.spin);
        gl.uniform2f(locations.tilt, orb.tiltX, orb.tiltZ);
        gl.uniform3fv(locations.liquid, orb.liquid);
        gl.uniform3fv(locations.deep, orb.deep);
        gl.uniform3fv(locations.accent, orb.accent);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteBuffer(buffer);
      for (const compiled of programs) gl.deleteProgram(compiled.program);
    },
  };
}
