import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Escribir cookies desde un Server Component está prohibido en Next,
          // así que este write falla por diseño y el fallo es esperable. La
          // renovación de sesión ocurre en `src/proxy.ts`, que sí puede
          // escribirlas — y que EXISTE (antes este comentario prometía un
          // middleware que nunca se escribió; N1, Causa B).
        }
      },
    },
  });
}
