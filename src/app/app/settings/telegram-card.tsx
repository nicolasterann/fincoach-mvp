import { disconnectTelegramAction } from "./telegram-actions";

// Settings card for Telegram. Server-rendered (no client JS): when disconnected
// it shows a one-tap deep link to the bot that carries a signed, time-limited
// link token; when connected it shows the state + a disconnect button. The user
// never sees a chat id, a token, or a dev page.
export function TelegramCard({ connected, deepLink }: { connected: boolean; deepLink: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-100">Telegram</p>
        <span
          className={
            connected
              ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300"
              : "rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-400"
          }
        >
          {connected ? "Conectado" : "No conectado"}
        </span>
      </div>

      {connected ? (
        <>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Ya puedes escribirle a Kipu por Telegram: anota gastos por texto, voz, foto o PDF sin abrir
            la app.
          </p>
          <form action={disconnectTelegramAction} className="mt-3">
            <button
              type="submit"
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
            >
              Desconectar
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Habla con Kipu desde Telegram: anota gastos por texto, voz, foto o PDF — sin abrir la app.
          </p>
          <a
            href={deepLink}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Conectar Telegram
          </a>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Te lleva al bot de Kipu. Toca «Iniciar» y quedas conectado al instante.
          </p>
        </>
      )}
    </div>
  );
}
