import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadPersonalityResult } from "@/lib/personality/personality-store";
import { telegramConnectDeepLink } from "@/lib/telegram/connect-link";
import { loadFxRates } from "@/lib/fx/fx-store";
import { TelegramCard } from "./telegram-card";
import { FxRatesCard } from "./fx-card";
import { DataCard } from "./data-card";
import { signOutAction } from "../actions";
import type { CurrencyCode } from "@/types/financial";

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

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ fx?: string }>;
}) {
  const { fx } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");
  const personality = await loadPersonalityResult(session.user.id);

  const { data: telegramLinks } = await supabase
    .from("telegram_user_links")
    .select("is_active")
    .eq("user_id", session.user.id)
    .eq("is_active", true)
    .limit(1);
  const telegramConnected = (telegramLinks?.length ?? 0) > 0;
  const telegramDeepLink = telegramConnectDeepLink(session.user.id);

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("base_currency")
    .eq("id", session.user.id)
    .maybeSingle();
  const baseCurrency = (profileRow?.base_currency || "USD") as CurrencyCode;
  const fxRates = await loadFxRates(session.user.id);
  const fxStatus = fx === "saved" || fx === "invalid" || fx === "error" ? fx : undefined;

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
          <DataCard userId={session.user.id} />
          <HubLink href={chatHref("Quiero importar mi estado de cuenta")} title="Importar estado de cuenta" body="Sube un PDF o foto de tu estado y Kipu lo registra por ti." />
          <FxRatesCard rates={fxRates} baseCurrency={baseCurrency} status={fxStatus} />
          <TelegramCard connected={telegramConnected} deepLink={telegramDeepLink} />
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Recordatorios y privacidad</p>
        <div className="flex flex-col gap-3">
          <HubLink href={chatHref("Ajusta cómo y cuándo me mandas recordatorios")} title="Recordatorios" body="Frecuencia, horario tranquilo y cuánto te empujo — tú decides." />
          <HubLink href={chatHref("Quiero reiniciar mis preferencias")} title="Reiniciar mis preferencias" body="Vuelve a empezar tu test, tu tono o tus recordatorios. Para borrar todos tus datos, escríbeme y te acompaño." />
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-600">Soporte</p>
        <div className="flex flex-col gap-3">
          <HubLink
            href={chatHref("Encontré un problema: ")}
            title="Ayuda y reportar un problema"
            body="Cuéntale a Kipu qué pasó — queda registrado y lo revisamos. Tus reportes hacen mejor a Kipu."
          />
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
