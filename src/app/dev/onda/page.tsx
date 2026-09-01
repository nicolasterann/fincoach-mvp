import Link from "next/link";
import { OrbCarrusel } from "@/app/app/components/shell/OrbCarrusel";

/**
 * N3C r28 · LA PÁGINA DE COMPARACIÓN, pedida tal cual por el founder:
 * «una página dentro de nuestro dev que sea exactamente igual a la de ellos, en
 * el sentido en que están los orbes en carrusel y con un audio sample, que
 * puedes poner play y pasar entre uno y otro».
 *
 * Existe por una razón de método que este bloque ya pagó tres veces: comparar
 * dos cosas exige que estén haciendo LO MISMO. Un deslizador no es una voz y una
 * foto no es un movimiento — y cada vez que comparé algo distinto, me inventé un
 * defecto o me perdí uno.
 */
export const metadata = { title: "Kipu · la onda de voz" };

export default function OndaPage() {
  return (
    <main className="kipu-sistema-page">
      <header className="kipu-sistema-head">
        <p className="kipu-sistema-eyebrow">DEV · BLOQUE N3C</p>
        <h1>La onda de voz</h1>
        <p className="kipu-sistema-note">
          El mismo formato que su página: un orbe grande, un botón de play con una
          muestra de voz, y flechas para pasar de uno a otro. Dale play y mirá cómo
          <b> nacen anillos desde adentro</b> y viajan hacia el borde siguiendo el
          sonido. Con la muestra «silencio» el orbe queda en calma: el fluido sólo
          recibe un empujón cuando el sonido <b>sube</b>, igual que el suyo.
        </p>
        <p className="kipu-sistema-note">
          Los cuatro números de abajo son las <b>cuatro bandas</b> que mira el orbe
          —graves, medios, agudos y total—, cada una moviendo otra cosa. Es la ley
          de la referencia, leída de su propio código y no adivinada: los graves
          dan la amplitud de los anillos, el total integrado los hace viajar, y la
          derivada del total decide cuándo se dispara uno.
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
