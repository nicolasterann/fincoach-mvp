import Link from "next/link";
import type { OrbRgb } from "@/app/app/components/shell/orb-shader";
import {
  OrbCompareSpecimen,
  OrbFieldSpecimen,
  OrbSloshStrip,
  OrbSpecimen,
} from "@/app/app/components/shell/OrbSpecimen";
import {
  ORB_KINDS,
  ORB_WATERLINE_CEILING,
  ORB_WATERLINE_FLOOR,
  orbMatter,
  orbWaterApex,
  orbWaterline,
  type OrbKind,
} from "@/app/app/components/shell/shell-orb-contract";

// Bloque N3B · LA MESA DE LUZ.
//
// `/dev/sistema?seccion=vidrio` sigue siendo la regla del sistema. Esta página
// es otra cosa y por eso vive aparte: es la EVIDENCIA de N3B, una hoja por
// criterio, con los orbes al tamaño en el que el material de verdad se juzga.
//
// La razón es de método y la dejó escrita el spec: «el criterio de aceptación es
// el ojo del founder». Un orbe de 148 px en una grilla de cinco no permite
// juzgar si un vidrio parece vidrio — permite comprobar que están todos. Acá
// cada hoja entra en una pantalla de teléfono y se puede fotografiar sola.
//
// Todo lo que se ve lo pinta `createOrbRenderer`, el mismo del santuario.

const SHEETS = [
  "colores",
  "movimiento",
  "comparacion",
  "vaso",
  "campo",
  "voz",
  "chapoteo",
  "materias",
  "profundidad",
] as const;
type Sheet = (typeof SHEETS)[number];

/**
 * N3C r19 · LA PALETA PROPUESTA, derivada del SIGNIFICADO de cada capa.
 *
 * Dos reglas, y las dos salen de medir los suyos:
 *  1. Cada orbe necesita un VIAJE de tono (los suyos van de 15° a 158°; los
 *     nuestros valían 1–5°, o sea ninguno). Acá cada capa tiene un líquido y un
 *     acento con 35–55° de separación real: recién ahí `fieldHue` tiene algo que
 *     mezclar.
 *  2. Cada orbe necesita RECORRIDO DE LUZ (los suyos ~0,38; los nuestros 0,18).
 *     Los profundos bajan a l ≈ 0,13.
 *
 * Y una tercera que es de conjunto: las cinco capas tienen que repartirse la
 * rueda. Hoy saldo (170°), patrimonio (199°) y reserva (222°) están todas en
 * azul-turquesa.
 */
const PALETA_PROPUESTA: Record<OrbKind, { liquid: OrbRgb; deep: OrbRgb; accent: OrbRgb }> = {
  // v5 · MISMA ESCALERA DE LUMINANCIA para las cinco (Y = 0,030 / 0,300 / 0,760),
  // en el registro SOBRIO: saturaciones bajas, claros altos.
  //
  // La v3 igualaba la CLARIDAD HSL, que no es lo que ve el ojo: un verde y un
  // azul con la misma «L» tienen brillos muy distintos, porque el verde pesa
  // 0,7152 en la luminancia y el azul 0,0722. Resultado medido: el movimiento
  // aparente se dispersaba 2,47× entre capas — el founder lo vio como «algunos
  // colores se ven más rápidos». Con la luminancia igualada, la misma física se
  // ve igual en las cinco.
  //
  // Los TONOS son los que él aprobó; lo único que cambia es a qué claridad se
  // ponen para que las cinco pesen lo mismo.
  // v6 · los ajustes finos del founder, sobre la misma escalera de luminancia
  saldo: { liquid: [0.167, 0.3391, 0.3047], accent: [0.6897, 0.7951, 0.6194], deep: [0.0113, 0.0358, 0.0276] },
  reserva: { liquid: [0.1553, 0.3236, 0.4919], accent: [0.5348, 0.8137, 0.8909], deep: [0.0149, 0.0296, 0.0781] },
  metas: { liquid: [0.3637, 0.2472, 0.6356], accent: [0.8826, 0.726, 0.7364], deep: [0.0448, 0.0214, 0.0716] },
  patrimonio: { liquid: [0.228, 0.3108, 0.4053], accent: [0.7788, 0.7569, 0.7351], deep: [0.0197, 0.031, 0.0506] },
  deuda: { liquid: [0.5944, 0.2217, 0.2088], accent: [0.8829, 0.7296, 0.699], deep: [0.0665, 0.0199, 0.023] },
};

const ETIQUETA_PROPUESTA: Record<OrbKind, string> = {
  saldo: "agua → verde amarillento · el permiso de hoy",
  reserva: "azul → capri caribe · la bóveda",
  metas: "morado azulado → palo de rosa · lo que viene",
  patrimonio: "piedra azul → gris · lo construido",
  deuda: "rojo → salmón · el peso, sin alarma",
};

export default async function VidrioPage({
  searchParams,
}: {
  searchParams: Promise<{ hoja?: string | string[] }>;
}) {
  const { hoja } = await searchParams;
  const asked = Array.isArray(hoja) ? hoja[0] : hoja;
  const only = (SHEETS as readonly string[]).includes(asked ?? "")
    ? (asked as Sheet)
    : null;
  const show = (sheet: Sheet) => only === null || only === sheet;

  return (
    <main className="kipu-sistema">
      <header className="kipu-sistema-head">
        <p className="kipu-sistema-kicker">Dev · Bloque N3C</p>
        <h1>El orbe de ElevenLabs, con nuestro líquido</h1>
        <p className="kipu-sistema-lede">
          Una hoja por criterio, al tamaño en el que se juzga un material. Los
          pinta el mismo <code>createOrbRenderer</code> del santuario.
        </p>
        <nav className="kipu-sistema-nav" aria-label="Hojas">
          <Link href="/dev/vidrio" aria-current={only === null ? "page" : undefined}>
            todo
          </Link>
          {SHEETS.map((sheet) => (
            <Link
              key={sheet}
              href={`/dev/vidrio?hoja=${sheet}`}
              aria-current={only === sheet ? "page" : undefined}
            >
              {sheet}
            </Link>
          ))}
        </nav>
      </header>

      {show("comparacion") && (
        <section className="kipu-sistema-section">
          <h2>G6 — su código abierto y el nuestro, lado a lado</h2>
          <p className="kipu-sistema-note">
            Mismo lienzo, mismo contexto WebGL, mismo reloj y el mismo diámetro
            en píxeles. Los dos primeros son el <b>porte fiel de{" "}
            <code>elevenlabs/ui · orb.tsx</code></b> —su componente publicado—
            con sus colores y con los nuestros; el tercero es <b>el nuestro</b>.
          </p>
          <p className="kipu-sistema-note">
            <b>Cuidado con leer esto como «su orbe».</b> El founder trajo
            capturas de la web de ElevenLabs y no se parecen a su propio
            componente: el publicado dibuja siete óvalos en coordenadas polares
            —un molinete que converge en el centro— y los de su página son
            manchas blandas con grano, sin centro y sin bordes. <b>Su código
            abierto no es lo que muestra su página.</b> El porte se conserva
            porque es lo único suyo que se puede ejecutar y comparar; el
            objetivo real son las capturas.
          </p>
          <OrbCompareSpecimen
            size={220}
            slots={[
              { variant: "referencia", kind: "patrimonio" },
              { variant: "referencia", kind: "saldo" },
              { variant: "kipu", kind: "saldo", level: 0.6 },
            ]}
          />
          <p className="kipu-sistema-note">
            Y las cinco capas, suyo contra nuestro, para ver si el look aguanta
            los cinco pigmentos y no sólo uno.
          </p>
          {ORB_KINDS.map((kind: OrbKind) => (
            <div key={kind} className="kipu-sistema-matrix__band">
              <p className="kipu-sistema-slot__name">{kind}</p>
              <OrbCompareSpecimen
                size={186}
                slots={[
                  { variant: "referencia", kind },
                  { variant: "kipu", kind, level: 0.6 },
                  { variant: "kipu", kind, level: 1 },
                  { variant: "kipu", kind, level: 0, fill: "gota" },
                ]}
              />
            </div>
          ))}
        </section>
      )}

      {show("vaso") && (
        <section className="kipu-sistema-section">
          <h2>F5 · F6 — vacío, medio y lleno se distinguen</h2>
          <p className="kipu-sistema-note">
            Trazo del 100 % = {Math.round(ORB_WATERLINE_CEILING * 100)} % del
            vidrio; del 0 % = {Math.round(ORB_WATERLINE_FLOOR * 100)} %. Lo que
            se mide no es el trazo sino el <b>alto visible</b>: la cámara mira el
            agua desde arriba, así que la superficie es una elipse y lo que el
            ojo lee como «el nivel» es su borde más alto, no el plano.
          </p>
          <div className="kipu-sistema-row">
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">leído en CERO · gota</p>
              <OrbSpecimen kind="saldo" level={0} fill="gota" size={230} label="vacío" />
            </div>
            {[0.6, 1].map((level) => (
              <div key={level} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">
                  dato {Math.round(level * 100)} % · alto visible{" "}
                  {Math.round(orbWaterApex(orbWaterline(level)) * 100)} %
                </p>
                <OrbSpecimen
                  kind="saldo"
                  level={level}
                  size={230}
                  label={`nivel ${Math.round(level * 100)}%`}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {show("campo") && (
        <section className="kipu-sistema-section">
          <h2>El campo de color reemplaza al cuarto</h2>
          <p className="kipu-sistema-note">
            El mismo orbe, el mismo renderer, la misma exposición. A la
            izquierda, la luz plana y desnuda: pigmento y absorción, que es lo
            que había debajo del cuarto de N3B. A la derecha, el <b>campo</b>:
            siete óvalos en coordenadas polares que se mueven despacio y una
            rampa de cuatro paradas. <b>Se fueron la ventana, el horizonte y el
            marco</b> — no queda nada reconocible en el reflejo, que es lo que
            el founder pidió.
          </p>
          <div className="kipu-sistema-row">
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">sin campo</p>
              <OrbSpecimen kind="saldo" level={0.62} size={230} env={0} label="antes" />
            </div>
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">con campo</p>
              <OrbSpecimen kind="saldo" level={0.62} size={230} env={1} label="N3C" />
            </div>
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">vacío · sin campo</p>
              <OrbSpecimen kind="reserva" level={0} fill="gota" size={230} env={0} label="antes" />
            </div>
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">vacío · con campo</p>
              <OrbSpecimen kind="reserva" level={0} fill="gota" size={230} env={1} label="N3C" />
            </div>
          </div>
        </section>
      )}

      {show("voz") && (
        <section className="kipu-sistema-section">
          <h2>G8 — la onda de la voz vive en la superficie del agua</h2>
          <p className="kipu-sistema-note">
            Lo que más le gustó al founder de la referencia: «cómo se mueven las
            ondas de adentro mientras habla». Acá la onda <b>no está pegada
            encima</b>: es el mismo líquido que ya tiene masa, con un tren de
            ondas concéntrico en la superficie y un menisco que se vuelve
            irregular. Sin voz el término vale cero exacto y la superficie
            vuelve a ser el espejo de N3B. El volumen es el de M5.
          </p>
          <div className="kipu-sistema-row">
            {[0, 0.35, 0.75, 1].map((voice) => (
              <div key={voice} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">voz {voice}</p>
                <OrbSpecimen
                  kind="saldo"
                  level={0.6}
                  size={200}
                  voice={voice}
                  label={voice === 0 ? "callado" : `${Math.round(voice * 100)}%`}
                />
              </div>
            ))}
          </div>
          <p className="kipu-sistema-note">
            Y el mismo volumen en el suyo, que lo lleva a los anillos del borde
            del disco:
          </p>
          <OrbCompareSpecimen
            size={186}
            slots={[
              { variant: "referencia", kind: "saldo", voice: 0 },
              { variant: "referencia", kind: "saldo", voice: 0.75 },
              { variant: "kipu", kind: "saldo", level: 0.6, voice: 0 },
              { variant: "kipu", kind: "saldo", level: 0.6, voice: 0.75 },
            ]}
          />
        </section>
      )}

      {show("chapoteo") && (
        <section className="kipu-sistema-section">
          <h2>F4 — el agua simula: un golpe, y después nada</h2>
          <p className="kipu-sistema-note">
            El impulso entra una sola vez, en el primer paso. Todo lo demás es el
            líquido solo: se queda atrás, se pasa de largo, <b>cruza el cero</b> y
            se aquieta. La inclinación de cada viñeta sale de integrar el mismo{" "}
            <code>advanceOrbWater</code> que corre en el santuario, con paso fijo.
          </p>
          <OrbSloshStrip size={168} />
          <p className="kipu-sistema-note">
            Y el agua quieta es un ESPEJO: la amplitud de la ola sale de la
            velocidad del líquido, no del reloj. Antes el oleaje corría igual
            estuviera pasando algo o no, y por eso se veía siempre revuelta.
          </p>
          <div className="kipu-sistema-row">
            {[
              { wave: 0, label: "en reposo" },
              { wave: 0.3, label: "asentándose" },
              { wave: 1, label: "recién sacudida" },
            ].map((frame) => (
              <div key={frame.label} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">ola {frame.wave}</p>
                <OrbSpecimen
                  kind="saldo"
                  level={0.55}
                  size={200}
                  wave={frame.wave}
                  label={frame.label}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {show("colores") && (
        <section className="kipu-sistema-section">
          <h2>Los colores — lo que hay contra lo que propongo</h2>
          <p className="kipu-sistema-note">
            El founder: «los colores se parecen demasiado, entonces no se ve
            mucho cómo fluyen». Medido contra los seis orbes de ellos, con la
            misma vara: su <b>ancho de tono</b> va de 15° a 158°; el nuestro
            valía <b>1° a 5°</b>. Y su <b>recorrido de luz</b> ronda 0,38; el
            nuestro, 0,18.
          </p>
          <p className="kipu-sistema-note">
            La causa: los tres colores de cada capa —líquido, acento y
            profundo— son <b>el mismo tono</b> (saldo: 170°, 171°, 175°). El
            shader tiene un segundo campo de color, <code>fieldHue</code>, que
            mezcla el líquido con el acento… y nunca hizo nada, porque los dos
            colores que mezcla son el mismo. Función viva, cableada y pinchada,
            sin material con qué trabajar.
          </p>
          <p className="kipu-sistema-note">
            Arriba lo que hay. Abajo la propuesta: cada capa recibe un
            <b> segundo tono de verdad</b> (un viaje de 35° a 55°) y un profundo
            más profundo, y las cinco se reparten mejor la rueda — hoy saldo
            (170°), patrimonio (199°) y reserva (222°) viven todas en la misma
            familia azul-turquesa.
          </p>
          <p className="kipu-sistema-note">
            Nada de esto toca los tokens de producción: la propuesta se le pasa
            a la probeta a mano, para poder ver las dos al lado.
          </p>
          <h3 className="kipu-sistema-slot__name">Hoy</h3>
          <div className="kipu-sistema-row">
            {ORB_KINDS.map((kind: OrbKind) => (
              <div key={`hoy-${kind}`} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">{kind}</p>
                <OrbSpecimen kind={kind} level={0.62} matter={orbMatter(kind)} size={168} animado />
              </div>
            ))}
          </div>
          <h3 className="kipu-sistema-slot__name">Propuesta</h3>
          <div className="kipu-sistema-row">
            {ORB_KINDS.map((kind: OrbKind) => (
              <div key={`prop-${kind}`} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">{kind}</p>
                <OrbSpecimen
                  kind={kind}
                  level={0.62}
                  matter={orbMatter(kind)}
                  size={168}
                  animado
                  paleta={PALETA_PROPUESTA[kind]}
                  label={ETIQUETA_PROPUESTA[kind]}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {show("movimiento") && (
        <section className="kipu-sistema-section">
          <h2>El movimiento — esto SÍ se mueve</h2>
          <p className="kipu-sistema-note">
            El resto de esta página pinta <b>un solo cuadro</b> a propósito: así
            se puede medir y comparar entre rondas. Pero para juzgar el
            movimiento eso no sirve — se ven fotos. Acá los mismos orbes avanzan
            con el reloj del navegador.
          </p>
          <p className="kipu-sistema-note">
            <b>Qué mirar:</b> si el color <i>se va</i> y no vuelve, o si se
            sacude en el sitio. En la r12 la textura del fluido pasó a guardar
            <i> de dónde vino cada punto</i> en vez de un empujón con tope, y la
            curva de decorrelación pasó de plana-y-que-vuelve (0,0196 → 0,0251 →
            <b> 0,0157</b> a los 2 s) a creciente (0,0049 → 0,0078 → 0,0142 →
            <b> 0,0246</b>). Falta amplitud: la de ellos llega a 0,075 al
            segundo.
          </p>
          <div className="kipu-sistema-row">
            {ORB_KINDS.map((kind: OrbKind) => (
              <div key={kind} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">{kind}</p>
                <OrbSpecimen
                  kind={kind}
                  level={0.62}
                  matter={orbMatter(kind)}
                  size={186}
                  animado
                  label={kind}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {show("materias") && (
        <section className="kipu-sistema-section">
          <h2>Las cinco capas, del mismo mundo</h2>
          <p className="kipu-sistema-note">
            Misma física, misma luz, misma exposición. Lo único que cambia es el
            pigmento — <b>las cinco</b>, Patrimonio incluido.
          </p>
          <p className="kipu-sistema-note">
            Hasta N3C r2 Patrimonio no podía: su código de capa era el mismo
            número que el shader lee como «cristal», así que dibujaba una bola
            de cristal aunque el texto dijera <i>«36% de tu meta»</i>. El
            cristal dejó de tomarle prestada la identidad a una capa y tiene el
            suyo. Es un <b>estado</b>, como la gota, no una capa.
          </p>
          <div className="kipu-sistema-row">
            {ORB_KINDS.map((kind: OrbKind) => (
              <div key={kind} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">{kind}</p>
                <OrbSpecimen
                  kind={kind}
                  level={0.62}
                  matter={orbMatter(kind)}
                  size={186}
                  label="62%"
                />
              </div>
            ))}
          </div>
          <p className="kipu-sistema-note">
            Y la otra mitad de la doctrina, la que faltaba: <b>sin techo
            declarado no se inventa un nivel — cambia la materia.</b> El vidrio
            se llena entero del mismo campo, sin línea de agua y sin menisco. Un
            orbe lleno deja aire y tiene menisco; éste no tiene ninguno de los
            dos, porque no hay ninguna altura que afirmar.
          </p>
          <div className="kipu-sistema-row">
            {ORB_KINDS.map((kind: OrbKind) => (
              <div key={kind} className="kipu-sistema-slot" data-slot-shape="orbe">
                <p className="kipu-sistema-slot__name">{kind} · sin techo</p>
                <OrbSpecimen
                  kind={kind}
                  level={null}
                  fill="nucleo"
                  size={186}
                  label="cristal"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {show("profundidad") && (
        <section className="kipu-sistema-section">
          <h2>F7 — las capas ya no se pisan</h2>
          <p className="kipu-sistema-note">
            El founder dijo que se pisaban: dos discos traslúcidos que se cruzan
            producen una lente más clara con dos bordes duros, y eso se lee como
            dos calcomanías, no como una esfera pasando delante de otra. Ahora la
            que se va se va <b>hacia atrás</b>: más chica y con menos contraste,
            que es lo que hace la distancia. Sale de la MISMA distancia al centro
            que ya decide la presencia.
          </p>
          {[
            { position: 0, label: "en reposo — una sola" },
            { position: 0.5, label: "a mitad del gesto — las dos, enteras" },
            { position: 0.82, label: "asentándose — la que se va, yéndose" },
          ].map((frame) => (
            <div key={frame.position} className="kipu-sistema-matrix__band">
              <p className="kipu-sistema-slot__name">
                posición {frame.position} · {frame.label}
              </p>
              <OrbFieldSpecimen
                position={frame.position}
                levels={{ saldo: 0.62, reserva: 0.4, metas: 0.75, deuda: 0.3 }}
                width={430}
                height={230}
              />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
