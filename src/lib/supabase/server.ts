import "server-only";

import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * Server client for Server Components, Route Handlers and Server Actions.
 *
 * Still the anon key, still subject to RLS - it simply reads the session from
 * cookies instead of localStorage. Reach for `createAdminClient` only when you
 * genuinely need to bypass policies.
 *
 * Must be created per request. Caching this across requests would serve one
 * user's session to another.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine and expected:
          // the middleware refreshes the session on every request, so the
          // tokens are already current by the time we get here.
        }
      },
    },
  });
}

/**
 * The signed-in user and their profile, or nulls.
 *
 * Always uses getUser(), never getSession(): getSession reads the cookie and
 * trusts it, while getUser revalidates the JWT with the auth server. On the
 * server, the difference is whether a forged cookie gets in.
 */
// Wrapped in React's cache() so a layout and a page that both need the
// signed-in user during the same request share one call instead of two -
// this function is not itself request-scoped-safe to memoise forever (it
// would leak across requests), but cache() only dedupes within a single
// render pass, which is exactly the lifetime this needs.
export const getCurrentUser = cache(async function getCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, phone, avatar_url, is_blocked")
    .eq("id", user.id)
    .single();

  return { user, profile };
});
