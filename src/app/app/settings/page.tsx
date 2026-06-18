import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadPersonalityResult } from "@/lib/personality/personality-store";
import { signOutAction } from "../actions";

// Stage 20 PASS 2 (Micro-stage H) — a calm control hub so a founder/family beta
// tester can FIND everything without a developer next to them. Most actions are
// agent-native, so this links to the right surfaces and starts the right chat.

function HubLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="block rounded-2xl border border-white/5 bg-zinc-900 p-4 transition hover:border-white/15">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        <span aria-hidden className="text-zinc-600">→</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{body}</p>
    </Link>
  );
}

function chatHref(prompt: string) {
  // Reuses the chat's supported share-text entry (?share=) so the message is
  // pre-loaded into the conversation rather than relying on an unsupported param.
  return `/app/chat?share=${encodeURIComponent(prompt)}`;
}

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");
  const personality = await loadPersonalityResult(session.user.id);

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Ajustes</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Tu Kipu</h1>
        </div>
        <Link href="/app" className="text-xs font-semibold text-zinc-500 hover:text-zinc-300">
          ← Resumen
        </Link>
      </header>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Cómo te conozco</p>
        <div className="flex flex-col gap-3">
          <HubLink href="/app/kipu-fit" title={personality ? "Kipu Fit — adaptado a ti" : "Kipu Fit — hacer el test"} body={personality ? "Mira o rehaz el test para ajustar cómo te hablo y aconsejo." : "Un test corto para que me adapte a tu forma de ver el dinero."} />
          <HubLink href={chatHref("¿Qué cambió desde la última vez?")} title="¿Qué cambió?" body="Mira cómo evolucionan tu Margen, tu patrimonio y tu Pulso." />
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Compartido</p>
        <div className="flex flex-col gap-3">
          <HubLink href="/app/household" title="Hogar y dinero compartido" body="Coordina gastos compartidos, divisiones y reembolsos sin exponer tus cuentas." />
          <HubLink href={chatHref("¿Qué pueden ver los demás en mi hogar?")} title="¿Qué puede ver mi hogar?" body="El grupo solo ve lo compartido — nunca tus cuentas, tu Margen ni tus deudas." />
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Tus datos</p>
        <div className="flex flex-col gap-3">
          <HubLink href={chatHref("Quiero importar mi estado de cuenta")} title="Importar estado de cuenta" body="Sube un PDF o foto de tu estado y Kipu lo registra por ti." />
          <HubLink href={chatHref("Quiero guardar un tipo de cambio")} title="Tipo de cambio (monedas)" body="Guarda la tasa que tú usas; Kipu nunca inventa una." />
          <HubLink href={chatHref("Quiero vincular Telegram con Kipu")} title="Conectar Telegram" body="Habla con Kipu desde Telegram: texto, voz, fotos y PDFs." />
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Recordatorios y privacidad</p>
        <div className="flex flex-col gap-3">
          <HubLink href={chatHref("Ajusta cómo y cuándo me mandas recordatorios")} title="Recordatorios" body="Frecuencia, horario tranquilo y cuánto te empujo — tú decides." />
          <HubLink href={chatHref("Quiero empezar de cero / borrar mis datos")} title="Reiniciar / borrar datos" body="Pídele a Kipu reiniciar tus preferencias o borrar tu información." />
        </div>
      </section>

      <section className="mt-8">
        <form action={signOutAction}>
          <button type="submit" className="text-xs font-medium text-zinc-600 transition hover:text-zinc-300">
            Cerrar sesión
          </button>
        </form>
      </section>
    </div>
  );
}
