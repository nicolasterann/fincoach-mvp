import Link from "next/link";
import {
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

const SHEETS = ["vaso", "cuarto", "chapoteo", "materias", "profundidad"] as const;
type Sheet = (typeof SHEETS)[number];

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
        <p className="kipu-sistema-kicker">Dev · Bloque N3B</p>
        <h1>El vidrio y el agua</h1>
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

      {show("cuarto") && (
        <section className="kipu-sistema-section">
          <h2>F3 — el vidrio refracta un ENTORNO</h2>
          <p className="kipu-sistema-note">
            El mismo orbe, el mismo renderer, la misma exposición. A la izquierda,
            la luz plana que tenía N3: un cielo sin horizonte y una luz sin
            ventana. A la derecha, un cuarto: <b>línea de horizonte</b>, una{" "}
            <b>ventana rectangular con su marco</b> y un suelo que devuelve luz.
            Lo que hace que el ojo lea «vidrio» no es más brillo — es reflejar
            cosas que se pueden reconocer.
          </p>
          <div className="kipu-sistema-row">
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">sin cuarto</p>
              <OrbSpecimen kind="saldo" level={0.62} size={230} env={0} label="N3" />
            </div>
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">con cuarto</p>
              <OrbSpecimen kind="saldo" level={0.62} size={230} env={1} label="N3B" />
            </div>
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">vacío · sin cuarto</p>
              <OrbSpecimen kind="reserva" level={0} fill="gota" size={230} env={0} label="N3" />
            </div>
            <div className="kipu-sistema-slot" data-slot-shape="orbe">
              <p className="kipu-sistema-slot__name">vacío · con cuarto</p>
              <OrbSpecimen kind="reserva" level={0} fill="gota" size={230} env={1} label="N3B" />
            </div>
          </div>
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

      {show("materias") && (
        <section className="kipu-sistema-section">
          <h2>Las cinco materias, del mismo mundo</h2>
          <p className="kipu-sistema-note">
            Misma física, misma luz, misma exposición. Lo único que cambia es el
            pigmento. Patrimonio es el único que cambia de materia, y no por
            gusto: sin techo declarado el motor no puede afirmarle un nivel.
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
                  label={orbMatter(kind) === "cristal" ? "cristal" : "62%"}
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
