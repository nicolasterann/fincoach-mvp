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
export const ORB_GRADIENT_P05 = 0.20;
export const ORB_GRADIENT_P95 = 0.95;

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
  const base = mezclar(liquid, accent, 0.34);
  const alto = mezclar(accent, [1, 1, 1], 0.38);
  const bajo = deep;
  const medio = mezclar(liquid, accent, 0.12);
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
  esfera.addColorStop(0, css(alto));
  esfera.addColorStop(0.34, css(mezclar(base, alto, 0.35)));
  esfera.addColorStop(0.68, css(base));
  esfera.addColorStop(0.88, css(medio));
  esfera.addColorStop(1, css(bajo));
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
  for (let i = 0; i < 3; i += 1) reparto.push(alto);
  for (let i = 0; i < 6; i += 1) reparto.push(bajo);
  for (let i = 0; i < 5; i += 1) reparto.push(medio);
  for (let i = 0; i < 4; i += 1) reparto.push(mezclar(base, accent, 0.5));
  ctx.save();
  ctx.filter = `blur(${Math.round(N * 0.045)}px)`;
  for (let i = 0; i < reparto.length; i += 1) {
    // Fisher-Yates con el mismo azar determinista: el reparto es fijo, las
    // posiciones no.
    const j = i + Math.floor(rnd() * (reparto.length - i));
    const tmp = reparto[i]!;
    reparto[i] = reparto[j]!;
    reparto[j] = tmp;
    const ang = rnd() * Math.PI * 2;
    const rad = (0.02 + rnd() * 0.78) * N * 0.5;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    const rr = N * (0.07 + rnd() * 0.17);
    const col = reparto[i]!;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, css(col, 0.85));
    g.addColorStop(0.55, css(col, 0.40));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ── 4 · EL REALCE, uno solo y ancho ──
  ctx.save();
  ctx.filter = `blur(${Math.round(N * 0.06)}px)`;
  const lx = cx - R * 0.42;
  const ly = cy - R * 0.48;
  const luz = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.60);
  luz.addColorStop(0, css(alto, 0.50));
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
  ctx.filter = `blur(${Math.round(N * 0.024)}px)`;
  ctx.lineCap = "round";
  for (let i = 0; i < 78; i += 1) {
    const ang = rnd() * Math.PI * 2;
    const rad = rnd() * N * 0.52;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    const largo = N * (0.05 + rnd() * 0.16);
    const dir = ang + (rnd() - 0.5) * 1.6 + Math.PI / 2;
    const col = rnd() < 0.45 ? alto : bajo;
    ctx.strokeStyle = css(col, 0.07 + rnd() * 0.11);
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
    ctx.putImageData(img, 0, 0);
  }

  // ── 6 · EL GRANO ──
  // El suyo viene incrustado en el PNG (250 KB para un degradado sólo se
  // explican con grano). Sin él la textura se ve plástica y las bandas quedan
  // demasiado limpias.
  const fuerza = input.grain ?? 9;
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
