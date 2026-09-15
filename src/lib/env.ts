/**
 * Environment access, in one place.
 *
 * The app is deliberately able to *boot* without Supabase credentials so a new
 * developer sees a setup screen instead of a stack trace. It is not able to
 * silently run against nothing: every data path calls `requireSupabaseEnv()`,
 * which throws with an actionable message.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}

/**
 * Service-role key. Bypasses every RLS policy in the database, so it may only
 * ever be read from server-side code. It is intentionally NOT prefixed with
 * NEXT_PUBLIC_, which is what keeps Next.js from inlining it into the bundle.
 */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing. It is required for admin actions, " +
        "payment webhooks and the dispatch loop.",
    );
  }
  return key;
}

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
