import Link from "next/link";
import { OrbCarrusel } from "@/app/app/components/shell/OrbCarrusel";

/**
 * N3C r28 · LA PÁGINA DE COMPARACIÓN, pedida tal cual por el founder:
 * «una página dentro de nuestro dev que sea exactamente igual a la de ellos, en
 * el sentido en que están los orbes en carrusel y con un audio sample, que
 * puedes poner play y pasar entre uno y otro».
 *
 * N3C r33 · Ahora compara de verdad contra lo suyo: el orbe de la derecha es un
 * CLON —su shader línea por línea, su fluido con sus magnitudes, su grano
 * negro-con-alfa encima, su recorte redondo, su fondo crema— comiendo SU
 * textura WebP y SU clip de voz grabada. El del medio es el mismo clon con
 * nuestra pintura y nuestros colores: la distancia entre los dos es lo que
 * falta de PINTURA, y la distancia entre el de la derecha y su portada es lo
 * que falta de CLON (que debería ser cero).
 */
export const metadata = { title: "Kipu · la onda de voz" };

export default function OndaPage() {
  return (
    <main className="kipu-sistema-page">
      <header className="kipu-sistema-head">
        <p className="kipu-sistema-eyebrow">DEV · BLOQUE N3C</p>
        <h1>La onda de voz</h1>
        <p className="kipu-sistema-note">
          Tres orbes sobre el mismo fondo crema de su portada, comiendo el mismo
          audio en el mismo cuadro. <b>Izquierda:</b> el nuestro de producción.
          <b> Centro:</b> el clon de su orbe con nuestra pintura y nuestros
          colores. <b>Derecha:</b> el clon con <b>su</b> textura y <b>su</b>
          grano — tiene que verse como el orbe naranja de elevenlabs.io, y si no,
          la diferencia está en el clon y no en la pintura.
        </p>
        <p className="kipu-sistema-note">
          La primera muestra es <b>su clip real de voz</b> («Christopher», el que
          suena en su portada), decodificado y pasado por su mismo analizador. Las
          otras son sintéticas. Dale play y compará contra su página con la misma
          voz: el arco aparece al hablar, los anillos nacen adentro y viajan hacia
          el borde, y el orbe <b>se acelera</b> al hablar — eso es suyo, no un
          defecto nuestro.
        </p>
        <p className="kipu-sistema-note">
          Flags: <code>?pintado=1</code> hace que el orbe de la derecha use nuestra
          pintura con su paleta en vez de su WebP; <code>?tex=&lt;url&gt;</code>
          mete una imagen ajena en el del centro.
        </p>
        <p className="kipu-sistema-note">
          <Link href="/dev/vidrio?hoja=voz">← la mesa de luz</Link>
        </p>
      </header>

      <section className="kipu-sistema-section">
        <OrbCarrusel />
      </section>
    </main>
  );
}
