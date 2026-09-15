import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link / email-confirmation landing point.
 *
 * Exchanges the one-time code for a session and sets the cookies. Anything
 * other than a clean exchange goes to /login with a reason rather than to a
 * blank page, because this is the step users hit from an email client and it
 * fails in mundane ways: expired links, links opened twice, links opened in a
 * different browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=expired_link`);
  }

  // Only ever redirect to a path on this origin. Reflecting an absolute URL
  // from the query string is a textbook open redirect.
  const destination = next.startsWith("/") ? next : "/";
  return NextResponse.redirect(`${origin}${destination}`);
}
