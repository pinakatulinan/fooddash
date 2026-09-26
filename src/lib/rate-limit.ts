import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether this attempt should be allowed to proceed - backed by
 * check_rate_limit (0022) in Postgres, not an in-memory counter (see that
 * migration's own comment for why).
 *
 * Fails open: if the check itself errors (network blip, a bad deploy), the
 * real action still goes through rather than locking every user out because
 * a secondary system had a bad moment. A rate limiter that can take the app
 * down harder than the abuse it's guarding against is a worse trade.
 */
export async function checkRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("[rate-limit] check failed, allowing request", error);
    return true;
  }
  return data === true;
}
