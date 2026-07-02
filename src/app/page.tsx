import Link from "next/link";
import type { ReactNode } from "react";

// Kipu public landing (Stage 21.1). Server-rendered, no client JS — motion is pure
// CSS (kipu-breathe/float, respects prefers-reduced-motion). Honest by design: no
// bank connection, no auto-sync, no integrations, no pricing claims. Premium, calm,
// consumer-first. CTAs route to /login (which offers sign-in → /app and create
// account → /onboarding).

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-50">
      {/* Ambient background glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="kipu-breathe absolute -top-40 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="absolute -right-40 top-1/3 h-[30rem] w-[30rem] rounded-full bg-emerald-400/8 blur-[120px]" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-5">
        <SiteNav />
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <Features />
        <Philosophy />
        <Privacy />
        <Faq />
        <FinalCta />
        <Footer />
      </div>
    </main>
  );
}

// ── Brand wordmark ───────────────────────────────────────────────────────────
function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-black tracking-tight ${className}`}>
      <svg aria-hidden viewBox="0 0 64 64" className="h-6 w-6">
        <rect width="64" height="64" rx="16" fill="#0a0a0b" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="#34d399" strokeWidth="5" strokeLinecap="round" strokeDasharray="104 138" transform="rotate(-90 32 32)" />
        <path d="M26 20v24M26 32l12-11M26 32l13 12" fill="none" stroke="#e4e4e7" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-emerald-300">Kipu</span>
    </span>
  );
}

// ── Nav ──────────────────────────────────────────────────────────────────────
function SiteNav() {
  return (
    <nav className="flex items-center justify-between py-5">
      <Wordmark className="text-lg" />
      <div className="flex items-center gap-2 sm:gap-3">
        <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:text-white">
          Entrar
        </Link>
        <Link href="/signup" className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300">
          Empezar
        </Link>
      </div>
    </nav>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="grid items-center gap-10 pb-8 pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:pb-16 lg:pt-16">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Coach financiero con IA
        </span>
        <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          Gasta tranquilo.
          <br />
          <span className="text-emerald-300">Kipu hace las cuentas.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">
          Te dice cuánto puedes gastar esta semana —ya descontados tus pagos, deudas, ahorro y metas— y
          te avisa antes de que algo te sorprenda. Le hablas como a un amigo que entiende de plata.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="rounded-2xl bg-emerald-400 px-6 py-3.5 text-center text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
          >
            Crear cuenta — gratis en beta
          </Link>
          <Link
            href="/login"
            className="rounded-2xl border border-white/15 px-6 py-3.5 text-center text-sm font-semibold text-zinc-200 transition hover:border-white/30"
          >
            Ya tengo cuenta
          </Link>
        </div>
        <p className="mt-4 text-xs text-zinc-500">Sin conectar tu banco · Sin pedir tus claves · En español</p>
      </div>

      <HeroVisual />
    </section>
  );
}

// The signature: a calm, breathing Margen ring with the one number that matters.
function HeroVisual() {
  const size = 300;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = 0.62;
  return (
    <div className="relative mx-auto flex w-full max-w-sm items-center justify-center">
      <div className="kipu-breathe absolute inset-6 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="relative rounded-[2rem] border border-white/10 bg-gradient-to-b from-zinc-900 to-zinc-950 p-7 shadow-2xl">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">Tu Margen Kipu</p>
        <div className="relative mt-4 flex items-center justify-center" style={{ width: size - 56, height: size - 56 }}>
          <svg className="-rotate-90" width={size - 56} height={size - 56} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="#34d399"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${c * fraction} ${c}`}
              style={{ filter: "drop-shadow(0 0 14px rgba(52,211,153,0.45))" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-4xl font-black tracking-tight text-emerald-300">268$</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">esta semana</p>
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-zinc-400">≈ 67$ por día, sin tocar tus pagos ni tu meta.</p>
        <div className="mt-5 rounded-2xl bg-zinc-900/80 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">Kipu</p>
          <p className="mt-1 text-sm leading-6 text-zinc-300">
            “Almuerzo de 25$ anotado. Te quedan 243$ esta semana — vas bien.”
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Trust strip ──────────────────────────────────────────────────────────────
function TrustStrip() {
  const items = ["Privado por diseño", "Tú decides qué compartes", "Verdad del dinero, no a ojo", "Hecho para Latinoamérica"];
  return (
    <section className="border-y border-white/5 py-5">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-center">
        {items.map((t) => (
          <span key={t} className="text-xs font-medium text-zinc-500">{t}</span>
        ))}
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps: { n: string; title: string; body: string }[] = [
    { n: "1", title: "Haces tu setup", body: "Un setup rápido y guiado: tus cuentas, ingresos, gastos fijos y una meta. Paso a paso, con montos aproximados — se ajustan después." },
    { n: "2", title: "Le hablas normal", body: "“Gasté 20 en almuerzo”, “¿cuánto puedo gastar hoy?”, “cámbiame el sueldo”. Por chat en la web, o por Telegram (donde también le mandas foto, PDF o nota de voz)." },
    { n: "3", title: "Kipu hace las cuentas", body: "Tu Margen, tus deudas y tu flujo, calculados de verdad. Si no sabe algo, te lo dice — nunca inventa un número." },
  ];
  return (
    <Section eyebrow="Cómo funciona" title="Tres pasos y estás dentro.">
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-3xl border border-white/5 bg-zinc-900/60 p-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-400/15 text-sm font-black text-emerald-300">{s.n}</span>
            <h3 className="mt-4 text-lg font-bold text-zinc-50">{s.title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Features ─────────────────────────────────────────────────────────────────
function Features() {
  const features: { icon: ReactNode; title: string; body: string }[] = [
    { icon: <IconRing />, title: "Margen Kipu", body: "Cuánto puedes gastar tranquilo esta semana, ya descontado todo lo importante." },
    { icon: <IconPulse />, title: "Pulso", body: "El estado de tu semana financiera de un vistazo — sin tablas ni jerga." },
    { icon: <IconShield />, title: "Cuida tus deudas", body: "Te avisa de pagos antes de que venzan y te ayuda a decidir qué pagar primero. Sin sermones." },
    { icon: <IconTarget />, title: "Metas y mini-metas", body: "Llega a lo que quieres —un viaje, unos audífonos— sin dejar de vivir." },
    { icon: <IconCapture />, title: "Captura sin fricción", body: "Escríbele por chat en la web, o por Telegram mándale foto, PDF o nota de voz. Tú eliges cómo le cuentas." },
    { icon: <IconHome />, title: "Hogar compartido", body: "Divide gastos con tu pareja o roomies sin exponer tus cuentas personales." },
  ];
  return (
    <Section eyebrow="Lo que hace" title="Un coach, no una app de contabilidad.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-3xl border border-white/5 bg-zinc-900/60 p-6 transition hover:border-emerald-400/20">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-400/12 text-emerald-300">{f.icon}</span>
            <h3 className="mt-4 text-base font-bold text-zinc-50">{f.title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Philosophy band ──────────────────────────────────────────────────────────
function Philosophy() {
  return (
    <section className="my-6 rounded-[2rem] border border-emerald-400/15 bg-gradient-to-b from-emerald-950/40 to-zinc-950 px-6 py-12 text-center sm:px-12 lg:my-10 lg:py-16">
      <p className="mx-auto max-w-3xl text-2xl font-bold leading-snug text-emerald-50 sm:text-3xl">
        No es un tracker de gastos. No es una hoja de cálculo. No es un banco.
        <br className="hidden sm:block" /> Es un coach que conoce tu vida financiera y te habla simple.
      </p>
      <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-emerald-100/60">
        La verdad del dinero la calcula el motor —determinista, exacta—; la IA solo la traduce a tu idioma.
        Genio adentro, simple afuera.
      </p>
    </section>
  );
}

// ── Privacy (honest) ─────────────────────────────────────────────────────────
function Privacy() {
  return (
    <Section eyebrow="Privacidad" title="Tu plata es tuya. En serio.">
      <div className="grid gap-4 sm:grid-cols-3">
        <PrivacyCard title="Sin conectar tu banco" body="Kipu no se conecta a tu banco ni te pide claves bancarias. Tú le cuentas o le mandas tus movimientos." />
        <PrivacyCard title="Tú decides qué compartes" body="En un hogar, nadie ve tus cuentas, tu saldo ni tus deudas personales — solo lo que eliges compartir." />
        <PrivacyCard title="Reinicia cuando quieras" body="Puedes ajustar o reiniciar tus preferencias en cualquier momento. Sin letra chica rara." />
      </div>
    </Section>
  );
}

function PrivacyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-white/5 bg-zinc-900/60 p-6">
      <div className="flex items-center gap-2 text-emerald-300">
        <IconLock />
        <h3 className="text-sm font-bold text-zinc-50">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
    </div>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────
function Faq() {
  const qa: { q: string; a: string }[] = [
    { q: "¿Conecta mi banco?", a: "No. Tú le cuentas tus movimientos o le mandas una foto/PDF de tu estado de cuenta. Nunca te pedimos claves bancarias." },
    { q: "¿Necesito ser bueno con los números?", a: "Para nada — esa es la idea. Kipu hace las cuentas y te habla simple, una cosa a la vez." },
    { q: "¿En qué países funciona?", a: "Pensado para Latinoamérica, con varias monedas y las tasas de cambio que tú confirmas. Nunca inventa una." },
    { q: "¿Es seguro y privado?", a: "Sí. Tus datos son tuyos; controlas qué compartes, y en un hogar nadie ve tu información personal." },
    { q: "¿Cuánto cuesta?", a: "Hoy Kipu está en beta y es gratis. Creas tu cuenta y empiezas sin costo." },
  ];
  return (
    <Section eyebrow="Preguntas" title="Lo que la gente pregunta primero.">
      <div className="mx-auto max-w-3xl divide-y divide-white/5 overflow-hidden rounded-3xl border border-white/5 bg-zinc-900/40">
        {qa.map((item) => (
          <details key={item.q} className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-100">
              {item.q}
              <span aria-hidden className="ml-4 text-zinc-500 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

// ── Final CTA ────────────────────────────────────────────────────────────────
function FinalCta() {
  return (
    <section className="my-10 rounded-[2rem] border border-white/10 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 py-14 text-center lg:my-14">
      <h2 className="mx-auto max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
        Empieza a gastar con tranquilidad.
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-zinc-400">
        En una sola sesión de setup, Kipu ya conoce tu plata y te dice cuánto puedes gastar esta semana.
      </p>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/signup" className="rounded-2xl bg-emerald-400 px-7 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300">
          Crear mi cuenta
        </Link>
        <Link href="/login" className="rounded-2xl border border-white/15 px-7 py-3.5 text-sm font-semibold text-zinc-200 transition hover:border-white/30">
          Entrar
        </Link>
      </div>
      <p className="mt-4 text-xs text-zinc-600">Gratis en beta · sin tarjeta</p>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="flex flex-col items-center gap-4 border-t border-white/5 py-10 text-center">
      <Wordmark className="text-base" />
      <p className="text-sm text-zinc-500">Tu coach financiero de bolsillo.</p>
      <div className="flex items-center gap-5 text-xs font-semibold text-zinc-400">
        <Link href="/login" className="transition hover:text-white">Entrar</Link>
        <Link href="/signup" className="transition hover:text-white">Crear cuenta</Link>
        <span className="text-zinc-600">soykipu.com</span>
      </div>
      <p className="max-w-md text-[11px] leading-5 text-zinc-600">
        Kipu no conecta tu banco ni pide claves bancarias. Tú decides qué compartes.
      </p>
    </footer>
  );
}

// ── Layout helper ────────────────────────────────────────────────────────────
function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 lg:py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400/80">{eyebrow}</p>
      <h2 className="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}

// ── Icons (inline, lightweight) ──────────────────────────────────────────────
function Svg({ d }: { d: string }) {
  return (
    <svg aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const IconRing = () => <Svg d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />;
const IconPulse = () => <Svg d="M3 12h4l2-6 4 12 2-6h6" />;
const IconShield = () => <Svg d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />;
const IconTarget = () => <Svg d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z" />;
const IconCapture = () => <Svg d="M4 5h16v14H4zM4 9h16M9 5v4" />;
const IconHome = () => <Svg d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5" />;
const IconLock = () => <Svg d="M6 11V8a6 6 0 1 1 12 0v3M5 11h14v9H5z" />;
