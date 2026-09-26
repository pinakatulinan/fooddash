import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * OAuth / magic-link / email-confirmation landing point.
 *
 * Exchanges the one-time code for a session and sets the cookies. Anything
 * other than a clean exchange goes to /login with a reason rather than to a
 * blank page, because this is the step users hit from an email client and it
 * fails in mundane ways: expired links, links opened twice, links opened in a
 * different browser.
 *
 * Deliberately not the shared lib/supabase/server.ts createClient() here.
 * That helper's setAll() silently swallows cookie-write failures - correct
 * for the Server Components it was written for (cookies() genuinely cannot
 * be set there, and middleware refreshes the session on the next request
 * regardless), wrong for this route: the one and only place those cookies
 * get set is right here, right now, so a swallowed failure means the whole
 * sign-in silently does nothing - a clean redirect to the right page with no
 * session ever reaching the browser. Building the response first and
 * writing cookies directly onto it (the same pattern middleware.ts already
 * uses for the same reason) removes any dependency on next/headers' cookies()
 * binding itself to a NextResponse.redirect() constructed after the fact.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // Only ever redirect to a path on this origin. Reflecting an absolute URL
  // from the query string is a textbook open redirect.
  const destination = next.startsWith("/") ? next : "/";
  const response = NextResponse.redirect(`${origin}${destination}`);

  const { url, anonKey } = requireSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=expired_link`);
  }

  return response;
}
