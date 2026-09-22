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

/** PayMongo secret key. Server-side only - it can create real charges. */
export function requirePaymongoSecretKey(): string {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) {
    throw new Error("PAYMONGO_SECRET_KEY is missing. Online payments cannot be created without it.");
  }
  return key;
}

/** Signing secret for the PayMongo webhook endpoint. */
export function requirePaymongoWebhookSecret(): string {
  const key = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!key) {
    throw new Error("PAYMONGO_WEBHOOK_SECRET is missing. Webhook events cannot be verified without it.");
  }
  return key;
}

/**
 * Shared secret for the payment-reconciliation sweep
 * (/api/payments/reconcile). Not a Supabase or PayMongo credential - this
 * one is made up locally and just needs to match whatever calls the route
 * (a scheduler once deployed; a local loop during dev), so nobody else can
 * trigger a sweep of every pending order.
 */
export function requireReconcileSecret(): string {
  const key = process.env.PAYMENT_RECONCILE_SECRET;
  if (!key) {
    throw new Error("PAYMENT_RECONCILE_SECRET is missing. Set any random string for it in .env.local.");
  }
  return key;
}
