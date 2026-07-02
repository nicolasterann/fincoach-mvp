// Humanized, Spanish, judgment-free copy for every auth state. Both /login and
// /signup map raw Supabase error strings (and our own sentinels) through here so
// a user NEVER sees raw provider text, codes, or "Supabase". Substring matching
// keeps it resilient to minor wording changes; anything unmatched falls back to
// a calm generic line.
export type AuthNotice = { tone: "error" | "info" | "success"; text: string };

export function authNotice(raw: string | undefined | null): AuthNotice | null {
  if (!raw) return null;
  const m = raw.toLowerCase();

  // Our own sentinels (set by the auth actions / confirm route).
  if (raw === "missing-fields") {
    return { tone: "error", text: "Escribe tu email y tu contraseña." };
  }
  if (raw === "already-registered") {
    return { tone: "info", text: "Ya hay una cuenta con ese email. " };
  }
  if (raw === "link-expired") {
    return {
      tone: "error",
      text: "Ese enlace ya no sirve (caducó o ya se usó). Inicia sesión, o crea tu cuenta de nuevo para recibir otro.",
    };
  }
  if (raw === "confirmed") {
    return { tone: "success", text: "¡Tu correo quedó confirmado! Ya puedes entrar." };
  }
  if (raw === "check-email") {
    return { tone: "info", text: "Te enviamos un correo para confirmar tu cuenta. Ábrelo para continuar." };
  }

  // Raw Supabase auth errors.
  if (m.includes("invalid login") || m.includes("invalid credentials")) {
    return { tone: "error", text: "Email o contraseña incorrectos. Prueba de nuevo." };
  }
  if (m.includes("email not confirmed") || (m.includes("confirm") && m.includes("email"))) {
    return {
      tone: "info",
      text: "Falta confirmar tu correo. Abre el enlace que te enviamos por email y vuelve a entrar.",
    };
  }
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already")) {
    return { tone: "info", text: "Ya hay una cuenta con ese email. " };
  }
  if (m.includes("password") && (m.includes("least") || m.includes("short") || m.includes("6"))) {
    return { tone: "error", text: "La contraseña necesita al menos 6 caracteres." };
  }
  if (m.includes("password") && m.includes("weak")) {
    return { tone: "error", text: "Esa contraseña es muy fácil de adivinar. Probá una un poco más larga." };
  }
  if (m.includes("email") && m.includes("valid")) {
    return { tone: "error", text: "Revisa el email, parece tener un error." };
  }
  if (m.includes("rate") || m.includes("too many") || m.includes("seconds")) {
    return { tone: "error", text: "Demasiados intentos seguidos. Espera un momento y vuelve a probar." };
  }
  if (m.includes("network") || m.includes("fetch") || m.includes("timeout")) {
    return { tone: "error", text: "Hubo un problema de conexión. Prueba de nuevo en un momento." };
  }

  return { tone: "error", text: "No pude continuar. Prueba de nuevo en un momento." };
}
