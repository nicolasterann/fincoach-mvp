import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { loadInviteByToken } from "@/lib/household/household-store";
import { acceptInviteAction, declineInviteAction } from "../actions";

// Stage 20 PASS 2 (Micro-stage F) — accept a household invite by link. Gated by the
// /app auth layout (a guest is sent to /login first). Honest about invalid/expired
// invites; the user explicitly accepts (Kipu never auto-adds anyone).

export const dynamic = "force-dynamic";

const ERROR_MSG: Record<string, string> = {
  invitacion_expirada: "Esa invitación venció. Pide una nueva.",
  invitacion_no_es_tuya: "Esa invitación es para otra persona.",
  invitacion_no_valida: "Esa invitación ya no está disponible.",
  no_pude_unirte: "No pude unirte ahora. Intenta de nuevo en un momento.",
  no_disponible: "No disponible por ahora. Intenta más tarde.",
};

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const invite = await loadInviteByToken(token);
  const usable = invite && invite.status === "pending";
  const wrongUser = invite?.invitedUserId && invite.invitedUserId !== session.user.id;
  const errorMsg = error ? (ERROR_MSG[error] ?? "No pude procesar la invitación.") : null;

  return (
    <div className="mx-auto w-full max-w-md pb-28 pt-8 lg:pb-12">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Invitación a un hogar</p>

      {errorMsg && (
        <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{errorMsg}</div>
      )}

      {!invite ? (
        <Empty title="No encontré esa invitación" body="El enlace puede estar mal o ya no existe. Pídele a quien te invitó que genere uno nuevo." />
      ) : wrongUser ? (
        <Empty title="Esta invitación es para otra persona" body="Inicia sesión con la cuenta a la que se la enviaron, o pide una invitación nueva." />
      ) : !usable ? (
        <Empty
          title={invite.status === "expired" ? "La invitación venció" : invite.status === "accepted" ? "Ya aceptaste esta invitación" : "Esta invitación ya no está disponible"}
          body={invite.status === "expired" ? "Pídele a quien te invitó que genere un enlace nuevo." : "Si crees que es un error, pide una invitación nueva."}
        />
      ) : (
        <section className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-950/40 p-6">
          <p className="text-lg font-bold leading-7 text-emerald-50">Te invitaron a “{invite.householdName}”</p>
          <p className="mt-2 text-sm leading-6 text-emerald-100/70">
            Coordinarán dinero compartido sin exponer las cuentas personales de nadie. Tú mantienes tu privacidad; el grupo solo
            ve lo que comparten.
          </p>
          <form action={acceptInviteAction} className="mt-5 flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <input
              name="displayName"
              placeholder="¿Cómo quieres aparecer en el grupo? (opcional)"
              className="kipu-input rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <button type="submit" className="rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300">
              Unirme al grupo
            </button>
          </form>
          <form action={declineInviteAction} className="mt-2">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="w-full rounded-2xl px-5 py-2 text-xs font-semibold text-zinc-500 transition hover:text-zinc-300">
              No, gracias
            </button>
          </form>
        </section>
      )}

      <Link href="/app" className="mt-6 block text-center text-xs font-semibold text-zinc-500 hover:text-zinc-300">
        ← Volver a Kipu
      </Link>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-6 rounded-3xl border border-white/5 bg-zinc-900 p-6">
      <p className="text-lg font-bold text-zinc-50">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
    </section>
  );
}
