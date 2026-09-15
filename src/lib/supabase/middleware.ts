import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Refresh the auth session on every request and hand back both the user and a
 * response carrying any rotated cookies.
 *
 * The cookie dance below is fiddly but not optional: `createServerClient` may
 * write refreshed tokens during `getUser()`, and those writes have to land on
 * the response that is actually returned. Building a fresh NextResponse after
 * this point silently drops them and signs the user out every hour.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) {
    return { response, user: null, role: null as string | null };
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    // One extra round trip per request. Worth it while roles live in a table;
    // the upgrade path is a custom access-token hook that stamps the role into
    // the JWT, at which point this read disappears entirely.
    const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    role = data?.role ?? null;
  }

  return { response, user, role };
}
