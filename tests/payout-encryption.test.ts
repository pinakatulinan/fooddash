import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureFixtures, anonClient, adminClient, riderClient, type Fixtures } from "./fixtures";

/**
 * Payout account numbers are encrypted at rest (migration 0023) via
 * pgp_sym_encrypt, with the key held in Supabase Vault rather than a table
 * anyone with read access to `public` could select from. This checks both
 * ends: the raw column genuinely isn't plaintext, and decrypt_rider_payout_
 * account only ever answers for the rider it belongs to or an admin - the
 * same owner-or-admin shape as every other sensitive read in this codebase.
 */

const svc: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let fx: Fixtures;
beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

function randomPhone(): string {
  return `+639${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
}

describe("payout account encryption", () => {
  let userId: string;
  let me: SupabaseClient;
  const accountNumber = "0917123" + Math.floor(1000 + Math.random() * 8999);

  beforeAll(async () => {
    const email = `qa.payout.${Date.now()}@fooddash.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: "QaFixture123!",
      email_confirm: true,
      user_metadata: { full_name: "QA Payout Rider", role: "rider", phone: randomPhone() },
    });
    if (error) throw error;
    userId = data.user.id;

    me = anonClient();
    const { error: signInError } = await me.auth.signInWithPassword({ email, password: "QaFixture123!" });
    if (signInError) throw signInError;

    const { error: applyError } = await me.rpc("submit_rider_application", {
      p_vehicle: "bicycle",
      p_plate_number: "",
      p_home_zone_id: fx.zoneId,
      p_date_of_birth: "1995-06-15",
      p_address_line1: "1 Encryption Test Street",
      p_barangay: "Lahug",
      p_city: "Cebu City",
      p_emergency_contact_name: "QA Emergency Contact",
      p_emergency_contact_phone: randomPhone(),
      p_payout_method: "gcash",
      p_payout_account_name: "QA Payout Rider",
      p_payout_account_number: accountNumber,
      p_accepted_terms: true,
    });
    if (applyError) throw applyError;
  }, 30_000);

  afterAll(async () => {
    if (userId) await svc.auth.admin.deleteUser(userId);
  });

  it("never stores the account number as plaintext", async () => {
    const { data } = await svc.from("rider_applications").select("payout_account_number").eq("rider_id", userId).single();
    // pg's bytea comes back through PostgREST as a "\x..."-prefixed hex
    // string - either way, it must not contain the real digits anywhere.
    const raw = JSON.stringify(data!.payout_account_number);
    expect(raw).not.toContain(accountNumber);
  });

  it("the rider can decrypt their own number", async () => {
    const { data, error } = await me.rpc("decrypt_rider_payout_account", { p_rider_id: userId });
    expect(error).toBeNull();
    expect(data).toBe(accountNumber);
  });

  it("an admin can decrypt it too", async () => {
    const admin = await adminClient();
    const { data, error } = await admin.rpc("decrypt_rider_payout_account", { p_rider_id: userId });
    expect(error).toBeNull();
    expect(data).toBe(accountNumber);
  });

  it("a different rider cannot decrypt someone else's number", async () => {
    const rider = await riderClient();
    const { error } = await rider.rpc("decrypt_rider_payout_account", { p_rider_id: userId });
    expect(error?.message).toMatch(/not_authorised/i);
  });

  it("anon cannot decrypt anything", async () => {
    // Checked against the specific error, not just "some error" - the
    // original bug (0024) was auth.uid() being null for a plain anon
    // caller, which made the owner check `p_rider_id <> auth.uid()`
    // evaluate to NULL and silently let the call through with no error at
    // all, which not.toBeNull() alone would have kept missing.
    const anon = anonClient();
    const { error } = await anon.rpc("decrypt_rider_payout_account", { p_rider_id: userId });
    expect(error?.message).toMatch(/not_authorised|permission denied/i);
  });
});
