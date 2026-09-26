import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { anonClient, adminClient } from "./fixtures";

/**
 * check_rate_limit (migration 0022). Cron-function-shaped, like
 * expire_stale_offers/expire_stale_documents: callable only by the service
 * role, since it is invoked from inside the (auth) server actions before a
 * session exists, never by the browser directly.
 */

const svc: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe("check_rate_limit access control", () => {
  it("is not reachable through a user session, only the service role", async () => {
    // Checked against the actual PostgREST permission-denied shape, not
    // just "some error" - see 0024 for why a bare not.toBeNull() is not
    // trustworthy for this class of check.
    const admin = await adminClient();
    const { error } = await admin.rpc("check_rate_limit", { p_key: "probe", p_max_attempts: 10, p_window_seconds: 60 });
    expect(error?.message).toMatch(/permission denied/i);

    const anon = anonClient();
    const { error: anonError } = await anon.rpc("check_rate_limit", { p_key: "probe", p_max_attempts: 10, p_window_seconds: 60 });
    expect(anonError?.message).toMatch(/permission denied/i);
  });
});

describe("check_rate_limit threshold behaviour", () => {
  it("allows up to the limit within a window, then refuses", async () => {
    const key = `test:${crypto.randomUUID()}`;

    for (let i = 0; i < 3; i++) {
      const { data, error } = await svc.rpc("check_rate_limit", { p_key: key, p_max_attempts: 3, p_window_seconds: 60 });
      expect(error).toBeNull();
      expect(data).toBe(true);
    }

    const { data: fourth, error } = await svc.rpc("check_rate_limit", { p_key: key, p_max_attempts: 3, p_window_seconds: 60 });
    expect(error).toBeNull();
    expect(fourth).toBe(false);
  });

  it("keeps separate keys independent", async () => {
    const keyA = `test:${crypto.randomUUID()}`;
    const keyB = `test:${crypto.randomUUID()}`;

    await svc.rpc("check_rate_limit", { p_key: keyA, p_max_attempts: 1, p_window_seconds: 60 });
    const { data: aSecond } = await svc.rpc("check_rate_limit", { p_key: keyA, p_max_attempts: 1, p_window_seconds: 60 });
    expect(aSecond).toBe(false);

    const { data: bFirst } = await svc.rpc("check_rate_limit", { p_key: keyB, p_max_attempts: 1, p_window_seconds: 60 });
    expect(bFirst).toBe(true);
  });
});
