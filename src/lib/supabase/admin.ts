import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireServiceRoleKey, requireSupabaseEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES EVERY RLS POLICY.
 *
 * Legitimate uses, and they are a short list:
 *   - payment webhooks, which arrive with no user session at all
 *   - the dispatch loop and offer-expiry sweep
 *   - ops actions that write columns the merchant/rider grants withhold:
 *     approving a store, verifying a rider, adjusting the ledger
 *   - payout runs
 *
 * Every call site must do its own authorisation check first and write an
 * admin_audit_log row after. If you are reaching for this to make a query
 * "just work", the RLS policy is wrong - fix the policy.
 *
 * `import "server-only"` above makes importing this from a Client Component a
 * build error rather than a production incident.
 */
export function createAdminClient() {
  const { url } = requireSupabaseEnv();

  return createSupabaseClient(url, requireServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/** Record a privileged action. Call this after every admin mutation. */
export async function writeAuditLog(entry: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    note: entry.note ?? null,
  });

  // An unwritten audit entry is a real problem, but failing the user's action
  // because logging failed is worse. Surface it loudly instead.
  if (error) console.error("[audit] failed to write audit log", error, entry);
}
