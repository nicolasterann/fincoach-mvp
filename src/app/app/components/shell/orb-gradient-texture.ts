import type { OrbRgb } from "./orb-shader";

/**
 * N3C r30 · EL DEGRADADO PINTADO, que es lo que de verdad les faltaba a los
 * nuestros.
 *
 * El founder, viendo el porte de la r29: «va por buen camino pero aún no está
 * ahí». Buscando la diferencia apareció la pieza que yo estaba inventando: su
 * orbe muestrea una IMAGEN —`creative-1.png` … `creative-9.png`, 512×512— y esa
 * imagen no es una rampa abstracta. Es un **cuadro**: una esfera luminosa
 * pintada, con manchas de color suaves adentro y afuera, todo muy desenfocado y
 * con grano incrustado. Pesan 250 KB cada una.
 *
 * O sea que buena parte de la riqueza de su orbe no está en el shader: está en
 * la textura. Mi malla de ocho polos no podía competir con un cuadro, y por eso
 * el porte llegaba cerca y no llegaba.
 *
 * Acá se pinta el equivalente con NUESTROS colores, una vez, al arrancar: un
 * lavado de fondo, una esfera grande con su luz, manchas de color repartidas,
 * desenfoque fuerte y grano. La técnica es suya; la imagen es nuestra y sale de
 * los tres colores que el founder aprobó.
 */

export const ORB_GRADIENT_SIZE = 512;

/**
 * N3C r30 · EL RANGO TONAL, y una lección sobre a QUÉ se calibra.
 *
 * Su textura mide p05 0,325 · p95 0,837 (medido sobre su `creative-1.png`).
 * Calibré la nuestra a esos números exactos y el ajuste fue perfecto en la
 * textura… y el ORBE empeoró: su contraste en pantalla cayó de 0,68 a 0,35
 * contra el 0,599 del suyo. Igualar la entrada no es igualar la salida — entre
 * las dos hay un escorzo esférico, un arrastre y un mapeo tonal, y cada uno
 * comprime a su manera.
 *
 * Así que el objetivo de la textura se elige por lo que produce en el ORBE, que
 * es lo que se mira. Estos números son más anchos que los suyos a propósito.
 */
/**
 * N3C r33 · RECALIBRADO CONTRA SU TEXTURA VIVA, que es un WebP y no el PNG.
 *
 * Todo lo anterior se midió sobre `creative-1.png` (p05 0,325 · p95 0,837 ·
 * media 0,605), pero ese PNG es el CARTEL que su página muestra debajo del
 * lienzo mientras carga. Lo que su WebGL muestrea es `creative-1.webp`, 512×512,
 * y mide distinto: **p05 0,297 · p50 0,572 · p95 0,748 · media 0,559**, con
 * diferencia entre píxeles vecinos 0,0016. Es más oscuro y con menos crema
 * arriba. Y con el clon ya exacto (mismo shader, mismo fluido, mismo grano
 * encima), igualar la entrada SÍ es igualar la salida para la misma pintura:
 * las lecciones de «se elige por lo que sale» se aprendieron con una cadena
 * que no era la suya (tonemap, grano gris, fluido de 0 a 1).
 */
export const ORB_GRADIENT_P05 = 0.30;
export const ORB_GRADIENT_P95 = 0.75;
/**
 * Y su MEDIA, que es el tercer número y el que faltaba. Fijar sólo los extremos
 * deja libre cuánta área es oscura: nuestra pintura quedaba con casi todo en la
 * mitad clara y el orbe se leía perlado, como metal pulido, en vez de tener las
 * regiones oscuras que el suyo tiene. Se ajusta con una gamma después del
 * remapeo lineal, que mueve los medios sin tocar los extremos.
 */
// La media de su WebP: 0,559.
export const ORB_GRADIENT_MEDIA = 0.56;

function mezclar(a: OrbRgb, b: OrbRgb, t: number): OrbRgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function css(c: OrbRgb, alpha = 1): string {
  const v = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  return `rgba(${v(c[0])}, ${v(c[1])}, ${v(c[2])}, ${alpha})`;
}

/** Ruido determinista: la misma imagen en cada máquina y en cada corrida. */
function azar(semilla: number): () => number {
  let s = (semilla * 2654435761) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

export interface OrbGradientInput {
  deep: OrbRgb;
  liquid: OrbRgb;
  accent: OrbRgb;
  /**
   * N3C r32 · CINCO TONOS EXPLÍCITOS, de oscuro a claro.
   *
   * Con los tres colores de la capa hay que INVENTAR los intermedios, y ahí se
   * cuela mi criterio. Para replicar su naranja de Narrator hacen falta los
   * suyos exactos, y se sacan de su WebP vivo por percentiles de luminancia
   * (r33; los del PNG eran más claros): #a6361a · #c5532b · #de8156 · #f1ae82 ·
   * #f5b488.
   */
  tonos?: readonly OrbRgb[];
  /** Qué capa es: dos capas nunca comparten el mismo cuadro. */
  seed: number;
  size?: number;
  /** Cuánto grano. El suyo viene incrustado en el PNG. */
  grain?: number;
}

export function paintOrbGradient(
  input: OrbGradientInput,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const N = input.size ?? ORB_GRADIENT_SIZE;
  const cv = document.createElement("canvas");
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;

  const { deep, liquid, accent } = input;
  // ── LOS CUATRO TONOS, con sus proporciones fijadas ──
  //
  // Dos pasadas se fueron por los extremos —primero todo verde oscuro, después
  // casi blanco— porque yo elegía colores sueltos y miraba el resultado. Acá los
  // tonos y CUÁNTA ÁREA ocupa cada uno están escritos: es un cuadro, y un cuadro
  // se compone, no se tantea.
  //
  // La receta sale de mirar los suyos: un tono medio que manda, un realce claro
  // que ocupa poco, y sombras profundas que ocupan algo más que el realce.
  const t = input.tonos;
  const base = t ? t[2]! : mezclar(liquid, accent, 0.34);
  const alto = t ? t[4]! : mezclar(accent, [1, 1, 1], 0.38);
  const bajo = t ? t[0]! : deep;
  const medio = t ? t[1]! : mezclar(liquid, accent, 0.12);
  const claroMedio = t ? t[3]! : mezclar(base, accent, 0.5);
  const rnd = azar(input.seed + 1);

  // ── 1 · EL LAVADO DE FONDO: el tono medio, con una diagonal suave ──
  const fondo = ctx.createLinearGradient(0, 0, N, N);
  fondo.addColorStop(0, css(mezclar(base, alto, 0.30)));
  fondo.addColorStop(0.55, css(base));
  fondo.addColorStop(1, css(mezclar(medio, bajo, 0.40)));
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, N, N);

  // ── 2 · LA ESFERA ──
  ctx.save();
  ctx.filter = `blur(${Math.round(N * 0.035)}px)`;
  const cx = N * (0.50 + (rnd() - 0.5) * 0.06);
  const cy = N * (0.52 + (rnd() - 0.5) * 0.06);
  const R = N * 0.47;
  const esfera = ctx.createRadialGradient(
    cx - R * 0.35, cy - R * 0.40, R * 0.05,
    cx, cy, R,
  );
  // N3C r31 · LA ESFERA VA SUAVE, y las manchas mandan.
  //
  // Con la esfera recorriendo todo el rango, el cuadro es un degradado radial y
  // el orbe se lee como METAL PULIDO: una perla con un reflejo. En los suyos la
  // esfera apenas se insinúa y lo que se ve son las manchas de la pintura. Es la
  // diferencia entre un objeto iluminado y un campo de color.
  esfera.addColorStop(0, css(mezclar(base, alto, 0.45)));
  esfera.addColorStop(0.5, css(base));
  esfera.addColorStop(0.85, css(mezclar(base, medio, 0.55)));
  esfera.addColorStop(1, css(medio));
  ctx.fillStyle = esfera;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── 3 · LAS MANCHAS, con su reparto ──
  // Dieciocho manchas: tres de realce, seis de sombra y nueve del tono medio.
  // El realce ocupa poco a propósito — en el suyo el crema es una minoría, y
  // subirlo es lo que convirtió el orbe en una perla.
  const reparto: OrbRgb[] = [];
  for (let i = 0; i < 5; i += 1) reparto.push(alto);
  for (let i = 0; i < 10; i += 1) reparto.push(bajo);
  for (let i = 0; i < 8; i += 1) reparto.push(medio);
  for (let i = 0; i < 7; i += 1) reparto.push(claroMedio);
  ctx.save();
  ctx.filter = `blur(${Math.round(N * 0.058)}px)`;
  for (let i = 0; i < reparto.length; i += 1) {
    // Fisher-Yates con el mismo azar determinista: el reparto es fijo, las
    // posiciones no.
    const j = i + Math.floor(rnd() * (reparto.length - i));
    const tmp = reparto[i]!;
    reparto[i] = reparto[j]!;
    reparto[j] = tmp;
    // N3C r32 · TRES MANCHAS AL CENTRO, a propósito.
    //
    // El founder: «parece que el líquido solo fluye por los lados y casi nunca
    // toca el centro». Medido por anillos, el centro es en realidad el MÁS
    // activo (2,01 contra 1,92 del borde): lo que falta no es movimiento, es
    // algo que se vea moverse. El centro del cuadro era el núcleo liso de la
    // esfera, y una zona lisa arrastrada no cambia nada aunque se mueva.
    //
    // (El arrastre además se apaga en el centro por construcción —va
    // multiplicado por la normal, que ahí vale cero—, así que la única forma de
    // que el centro tenga vida es que tenga DIBUJO.)
    const alCentro = i < 3;
    const ang = rnd() * Math.PI * 2;
    const rad = alCentro
      ? rnd() * N * 0.13
      : (0.10 + rnd() * 0.70) * N * 0.5;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    // N3C r31 · MASAS CON BORDE BLANDO, no degradados que se funden.
    //
    // Con manchas de degradado radial el cuadro se vuelve papilla: todo se
    // mezcla con todo y el orbe se lee como METAL PULIDO, una perla con reflejo.
    // En sus pinturas hay REGIONES —una zona clara junto a una oscura, con el
    // borde blando pero definido—. Eso se consigue rellenando la forma con color
    // plano y dejando que el desenfoque le dé el borde, no pintando el borde.
    const rr = N * (0.10 + rnd() * 0.24);
    const col = reparto[i]!;
    ctx.fillStyle = css(col, 0.78);
    ctx.beginPath();
    // una forma irregular, no un círculo: tres arcos con radios distintos
    const p1 = rnd() * Math.PI * 2;
    for (let k = 0; k <= 12; k += 1) {
      const th = p1 + (k / 12) * Math.PI * 2;
      const rad = rr * (0.62 + 0.5 * Math.abs(Math.sin(th * 1.5 + p1)));
      const qx = px + Math.cos(th) * rad;
      const qy = py + Math.sin(th) * rad;
      if (k === 0) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // ── 4 · EL REALCE, uno solo y ancho ──
  ctx.save();
  ctx.filter = `blur(${Math.round(N * 0.06)}px)`;
  const lx = cx - R * 0.42;
  const ly = cy - R * 0.48;
  const luz = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.42);
  luz.addColorStop(0, css(alto, 0.34));
  luz.addColorStop(1, css(alto, 0));
  ctx.fillStyle = luz;
  ctx.fillRect(0, 0, N, N);
  ctx.restore();

  // ── 4b · LAS PINCELADAS ──
  //
  // Con manchas grandes solamente, el orbe queda con el contraste correcto y
  // TRES VECES más calmo que el suyo (1,3 contra 3,8 de cambio por cuadro). La
  // razón es que lo que se ve es la textura ARRASTRADA: si no hay detalle fino,
  // un arrastre grande mueve una mancha grande y eso cambia pocos píxeles.
  //
  // Sus texturas son pinturas y tienen pincelada a esa escala. Acá son trazos
  // cortos, poco difuminados y de bajo contraste: no se ven como trazos en el
  // resultado —el escorzo y el arrastre los deshacen— pero le dan al arrastre
  // algo que mover.
  ctx.save();
  // Más difuminadas y más flojas de lo que uno pondría: a la primera pasada se
  // veían como RAYONES sobre el orbe. Lo que hacen falta no son trazos visibles
  // sino energía de detalle fino para que el arrastre tenga qué mover.
  ctx.filter = `blur(${Math.round(N * 0.046)}px)`;
  ctx.lineCap = "round";
  for (let i = 0; i < 14; i += 1) {
    const ang = rnd() * Math.PI * 2;
    const rad = rnd() * N * 0.52;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    const largo = N * (0.05 + rnd() * 0.16);
    const dir = ang + (rnd() - 0.5) * 1.6 + Math.PI / 2;
    const col = rnd() < 0.45 ? alto : bajo;
    ctx.strokeStyle = css(col, 0.05 + rnd() * 0.08);
    ctx.lineWidth = N * (0.016 + rnd() * 0.038);
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(dir) * largo * 0.5, py - Math.sin(dir) * largo * 0.5);
    ctx.quadraticCurveTo(
      px + (rnd() - 0.5) * largo * 0.5,
      py + (rnd() - 0.5) * largo * 0.5,
      px + Math.cos(dir) * largo * 0.5,
      py + Math.sin(dir) * largo * 0.5,
    );
    ctx.stroke();
  }
  ctx.restore();

  // ── 4c · UNA SUAVIZADA FINAL DE TODO EL CUADRO ──
  //
  // Sus pinturas están más suaves que la mía a TODAS las escalas: medí la
  // diferencia entre píxeles vecinos a 512 y la suya da 0,0023 contra los
  // 0,0233 que daba la mía. Lo que se ve del orbe es la textura barrida, así que
  // cada punto de detalle de más se convierte en cambio por cuadro — y demasiado
  // cambio por cuadro es lo que el founder llamó «menos fluido».
  {
    const tmp = document.createElement("canvas");
    tmp.width = N;
    tmp.height = N;
    const t = tmp.getContext("2d");
    if (t) {
      t.drawImage(cv, 0, 0);
      ctx.clearRect(0, 0, N, N);
      ctx.save();
      ctx.filter = `blur(${Math.max(1, Math.round(N * 0.010))}px)`;
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    }
  }

  // ── 5 · LA CALIBRACIÓN TONAL, contra la medida de su textura ──
  //
  // Dos pasadas eligiendo colores a ojo se fueron a los dos extremos. Esto lo
  // resuelve de una: se MIDE la imagen pintada y se la lleva al rango tonal de
  // la suya, que medí sobre su propio PNG a 256×256:
  //
  //     media 0,605 · desvío 0,161 · p05 0,325 · p95 0,837
  //
  // La nuestra daba 0,412 / 0,117 / 0,265 / 0,634 — más oscura y con menos
  // rango en todas las escalas. El remapeo es en LUMINANCIA y multiplicativo,
  // así que corrige el rango sin tocar el tono: los colores siguen siendo los
  // que el founder aprobó, y lo que cambia es cuánta luz recorren.
  {
    const img = ctx.getImageData(0, 0, N, N);
    const d = img.data;
    const lum = new Float64Array(N * N);
    for (let i = 0, k = 0; i < d.length; i += 4, k += 1) {
      lum[k] = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
    }
    const orden = Float64Array.from(lum).sort();
    const p05 = orden[Math.floor(orden.length * 0.05)] ?? 0;
    const p95 = orden[Math.floor(orden.length * 0.95)] ?? 1;
    const rango = Math.max(1e-3, p95 - p05);
    const escala = (ORB_GRADIENT_P95 - ORB_GRADIENT_P05) / rango;
    for (let i = 0, k = 0; i < d.length; i += 4, k += 1) {
      const l = lum[k]!;
      const objetivo = ORB_GRADIENT_P05 + (l - p05) * escala;
      const factor = Math.min(3, Math.max(0.15, objetivo / Math.max(l, 1e-3)));
      d[i] = Math.max(0, Math.min(255, d[i]! * factor));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! * factor));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! * factor));
    }
    // ── la gamma que lleva la MEDIA a la suya ──
    let suma = 0;
    for (let i = 0, k = 0; i < d.length; i += 4, k += 1) {
      lum[k] = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
      suma += lum[k]!;
    }
    const media = suma / lum.length;
    if (media > 0.02 && media < 0.98) {
      const gamma = Math.min(3, Math.max(0.35, Math.log(ORB_GRADIENT_MEDIA) / Math.log(media)));
      for (let i = 0, k = 0; i < d.length; i += 4, k += 1) {
        const l = lum[k]!;
        if (l <= 1e-3) continue;
        const factor = Math.min(3, Math.max(0.15, Math.pow(l, gamma) / l));
        d[i] = Math.max(0, Math.min(255, d[i]! * factor));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! * factor));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! * factor));
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── 5b · EL BORDE UNIFORME, que es lo que mata las rayas ──
  //
  // El founder: «en los filos de abajo y a veces del costado izquierdo hay unas
  // rayas perpendiculares a la esfera que se ven como cortando». Es el recorte
  // de la textura: el arrastre saca el muestreo fuera de [0,1] y ahí la textura
  // REPITE su última fila — una fila repetida a lo largo del borde es
  // literalmente una raya. (Es primo del defecto de la r9 en el fluido.)
  //
  // En el suyo no se nota porque el borde de sus cuadros es un lavado claro y
  // uniforme: repetirlo no dibuja nada. Acá se hace lo mismo a propósito: el
  // 12% exterior se funde hacia el color medio del propio borde, así que
  // repetirlo es repetir un color plano.
  {
    const img = ctx.getImageData(0, 0, N, N);
    const d = img.data;
    // el color medio del anillo exterior, que es hacia donde se funde
    let r0 = 0, g0 = 0, b0 = 0, c0 = 0;
    const margen = Math.floor(N * 0.06);
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        if (x > margen && x < N - margen && y > margen && y < N - margen) continue;
        const i = (y * N + x) * 4;
        r0 += d[i]!; g0 += d[i + 1]!; b0 += d[i + 2]!; c0 += 1;
      }
    }
    r0 /= c0; g0 /= c0; b0 /= c0;
    const banda = N * 0.12;
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const dBorde = Math.min(x, y, N - 1 - x, N - 1 - y);
        if (dBorde >= banda) continue;
        const t = 1 - dBorde / banda;
        const k = t * t * (3 - 2 * t);
        const i = (y * N + x) * 4;
        d[i] = d[i]! + (r0 - d[i]!) * k;
        d[i + 1] = d[i + 1]! + (g0 - d[i + 1]!) * k;
        d[i + 2] = d[i + 2]! + (b0 - d[i + 2]!) * k;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── 6 · EL GRANO ──
  // El suyo viene incrustado en el PNG (250 KB para un degradado sólo se
  // explican con grano). Sin él la textura se ve plástica y las bandas quedan
  // demasiado limpias.
  // N3C r31 · EL GRANO ES DIEZ VECES MÁS FLOJO DE LO QUE YO CREÍA, y ésta era
  // la causa del «menos fluido».
  //
  // Medí la variación de píxel a píxel de las dos texturas a 512: la suya da
  // 0,0023 y la nuestra daba 0,0233 — DIEZ VECES más. Lo que se ve del orbe es
  // la textura barrida, así que un grano fuerte no se lee como grano: CAMINA. El
  // orbe cambiaba 7,5 por cuadro contra 1,4 del suyo, callado y hablando por
  // igual, que es hormigueo y no movimiento.
  //
  // El grano de sus PNG existe pero es finísimo. Acá se calibra contra ese
  // número, no contra lo que parece bien mirando la textura de cerca.
  const fuerza = input.grain ?? 0.3;
  if (fuerza > 0) {
    const img = ctx.getImageData(0, 0, N, N);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 2 * fuerza;
      d[i] = Math.max(0, Math.min(255, d[i]! + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
    }
    ctx.putImageData(img, 0, 0);
  }

  return cv;
}
