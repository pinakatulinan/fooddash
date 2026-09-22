import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureFixtures, anonClient, adminClient, customerClient, riderClient, type Fixtures } from "./fixtures";

/**
 * suspend_merchant/reactivate_merchant and suspend_rider/unsuspend_rider
 * (migration 0018). Enforcement already existed everywhere it mattered -
 * is_merchant_open() has refused a non-'approved' store since 0003, and
 * set_rider_availability/dispatch have refused a suspended rider since 0008 -
 * these four RPCs are only the switch that was missing. The permission and
 * validation checks below run against the shared fixtures (they error out
 * before touching a row, so they cannot disturb tests running in other
 * files against the same fixtures); the lifecycle tests spin up throwaway
 * merchants/riders instead, the same way merchant-approval.test.ts and
 * rider-onboarding.test.ts do, so nothing here can leave a shared fixture
 * suspended mid-suite.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let fx: Fixtures;
beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

describe("permission and validation checks (no state changes)", () => {
  it("only an admin can suspend or reactivate a store", async () => {
    const merchant = await customerClient();
    const suspend = await merchant.rpc("suspend_merchant", { p_merchant_id: fx.merchantId, p_reason: "no" });
    expect(suspend.error?.message).toMatch(/not_authorised/i);

    const reactivate = await merchant.rpc("reactivate_merchant", { p_merchant_id: fx.merchantId });
    expect(reactivate.error?.message).toMatch(/not_authorised/i);

    const anon = anonClient();
    const anonSuspend = await anon.rpc("suspend_merchant", { p_merchant_id: fx.merchantId, p_reason: "no" });
    expect(anonSuspend.error).not.toBeNull();
  });

  it("suspending a store requires a reason", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("suspend_merchant", { p_merchant_id: fx.merchantId, p_reason: "" });
    expect(error?.message).toMatch(/say why/i);

    // Never actually suspended - confirm the shared fixture is untouched.
    const { data } = await svc.from("merchants").select("status").eq("id", fx.merchantId).single();
    expect(data!.status).toBe("approved");
  });

  it("only an admin can suspend or unsuspend a rider", async () => {
    const rider = await riderClient();
    const suspend = await rider.rpc("suspend_rider", { p_rider_id: fx.riderUserId, p_reason: "no" });
    expect(suspend.error?.message).toMatch(/not_authorised/i);

    const unsuspend = await rider.rpc("unsuspend_rider", { p_rider_id: fx.riderUserId });
    expect(unsuspend.error?.message).toMatch(/not_authorised/i);

    const anon = anonClient();
    const anonSuspend = await anon.rpc("suspend_rider", { p_rider_id: fx.riderUserId, p_reason: "no" });
    expect(anonSuspend.error).not.toBeNull();
  });

  it("suspending a rider requires a reason", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("suspend_rider", { p_rider_id: fx.riderUserId, p_reason: "  " });
    expect(error?.message).toMatch(/say why/i);

    const { data } = await svc.from("riders").select("is_suspended").eq("id", fx.riderUserId).single();
    expect(data!.is_suspended).toBe(false);
  });
});

describe("merchant suspend/reactivate lifecycle", () => {
  let userId: string;
  let me: SupabaseClient;
  let merchantId: string;

  beforeAll(async () => {
    const email = `qa.suspend.merchant.${Date.now()}@fooddash.test`;
    const { data: user, error: userError } = await svc.auth.admin.createUser({
      email,
      password: "QaFixture123!",
      email_confirm: true,
      user_metadata: { full_name: "QA Suspend Merchant", role: "customer" },
    });
    if (userError) throw userError;
    userId = user.user.id;

    me = anonClient();
    const { error: signInError } = await me.auth.signInWithPassword({ email, password: "QaFixture123!" });
    if (signInError) throw signInError;

    const { data: id, error: createError } = await me.rpc("create_merchant", {
      p_name: "QA Suspend Kitchen",
      p_phone: "+639171234567",
      p_city: "Cebu City",
    });
    if (createError) throw createError;
    merchantId = id as string;

    const { error: addrError } = await me.rpc("update_merchant_address", {
      p_merchant_id: merchantId,
      p_line1: "1 Suspend Street",
      p_barangay: "Lahug",
      p_city: "Cebu City",
      p_province: "Cebu",
      p_postal_code: "6000",
      p_lat: 10.31,
      p_lng: 123.9,
    });
    if (addrError) throw addrError;

    const { error: hoursError } = await me
      .from("merchant_hours")
      .insert({ merchant_id: merchantId, day_of_week: 1, opens_at: "09:00", closes_at: "21:00" });
    if (hoursError) throw hoursError;

    const admin = await adminClient();
    for (const doc_type of ["business_permit", "bir_registration", "sanitary_permit"]) {
      const { data: doc, error: docError } = await me
        .from("merchant_documents")
        .insert({ merchant_id: merchantId, doc_type, storage_path: `${merchantId}/${doc_type}-test.jpg` })
        .select("id")
        .single();
      if (docError) throw docError;
      const { error: reviewError } = await admin.rpc("review_merchant_document", { p_document_id: doc!.id, p_approve: true });
      if (reviewError) throw reviewError;
    }

    const { error: submitError } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
    if (submitError) throw submitError;
    const { error: approveError } = await admin.rpc("approve_merchant", { p_merchant_id: merchantId });
    if (approveError) throw approveError;
  }, 30_000);

  afterAll(async () => {
    if (merchantId) await svc.from("merchants").delete().eq("id", merchantId);
    if (userId) await svc.auth.admin.deleteUser(userId);
  });

  it("starts approved and open", async () => {
    const { data } = await me.from("merchants").select("status").eq("id", merchantId).single();
    expect(data!.status).toBe("approved");
  });

  it("is no longer open for orders once suspended, and cannot be suspended again", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("suspend_merchant", { p_merchant_id: merchantId, p_reason: "probe" });
    expect(error).toBeNull();

    const { data: closed } = await admin.rpc("is_merchant_open", { p_merchant_id: merchantId });
    expect(closed).toBe(false);

    const { data: statusRow } = await me.from("merchants").select("status, rejection_reason").eq("id", merchantId).single();
    expect(statusRow!.status).toBe("suspended");
    expect(statusRow!.rejection_reason).toMatch(/probe/i);

    const twice = await admin.rpc("suspend_merchant", { p_merchant_id: merchantId, p_reason: "probe again" });
    expect(twice.error?.message).toMatch(/live store/i);
  });

  it("reactivating brings it back to approved", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("reactivate_merchant", { p_merchant_id: merchantId });
    expect(error).toBeNull();

    const { data: reopened } = await me.from("merchants").select("status, rejection_reason").eq("id", merchantId).single();
    expect(reopened!.status).toBe("approved");
    expect(reopened!.rejection_reason).toBeNull();
  });

  it("refuses to reactivate a store whose permit has since expired", async () => {
    const admin = await adminClient();
    const { error: suspendError } = await admin.rpc("suspend_merchant", { p_merchant_id: merchantId, p_reason: "routine check" });
    expect(suspendError).toBeNull();

    await svc.from("merchant_documents").update({ expires_at: "2000-01-01" }).eq("merchant_id", merchantId).eq("doc_type", "business_permit");

    const { error } = await admin.rpc("reactivate_merchant", { p_merchant_id: merchantId });
    expect(error?.message).toMatch(/missing approved documents/i);
    expect(error?.message).toMatch(/business_permit/);
  });
});

describe("rider suspend/unsuspend lifecycle", () => {
  let userId: string;
  let me: SupabaseClient;

  beforeAll(async () => {
    const email = `qa.suspend.rider.${Date.now()}@fooddash.test`;
    const { data: user, error: userError } = await svc.auth.admin.createUser({
      email,
      password: "QaFixture123!",
      email_confirm: true,
      user_metadata: { full_name: "QA Suspend Rider", role: "rider", phone: randomPhone() },
    });
    if (userError) throw userError;
    userId = user.user.id;

    me = anonClient();
    const { error: signInError } = await me.auth.signInWithPassword({ email, password: "QaFixture123!" });
    if (signInError) throw signInError;

    // Bicycle needs only nbi_clearance + selfie_id (rider_required_documents, 0015).
    const { error: applyError } = await me.rpc("submit_rider_application", {
      p_vehicle: "bicycle",
      p_plate_number: "",
      p_home_zone_id: fx.zoneId,
      p_date_of_birth: "1995-06-15",
      p_address_line1: "1 Suspend Street",
      p_barangay: "Lahug",
      p_city: "Cebu City",
      p_emergency_contact_name: "QA Emergency Contact",
      p_emergency_contact_phone: randomPhone(),
      p_payout_method: "gcash",
      p_payout_account_name: "QA Suspend Rider",
      p_payout_account_number: "0917 000 0000",
      p_accepted_terms: true,
    });
    if (applyError) throw applyError;

    const admin = await adminClient();
    for (const doc_type of ["nbi_clearance", "selfie_id"]) {
      const { data: doc, error: docError } = await me
        .from("rider_documents")
        .insert({ rider_id: userId, doc_type, storage_path: `${userId}/${doc_type}-test.jpg` })
        .select("id")
        .single();
      if (docError) throw docError;
      const { error: reviewError } = await admin.rpc("review_rider_document", { p_document_id: doc!.id, p_approve: true });
      if (reviewError) throw reviewError;
    }
    const { error: verifyError } = await admin.rpc("verify_rider", { p_rider_id: userId });
    if (verifyError) throw verifyError;
  }, 30_000);

  afterAll(async () => {
    if (userId) await svc.auth.admin.deleteUser(userId);
  });

  it("can go online once verified", async () => {
    const { error } = await me.rpc("set_rider_availability", { p_online: true, p_zone_id: fx.zoneId });
    expect(error).toBeNull();
  });

  it("is pulled offline immediately when suspended, and cannot go back online", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("suspend_rider", { p_rider_id: userId, p_reason: "safety complaint" });
    expect(error).toBeNull();

    const { data } = await svc.from("riders").select("status, is_suspended").eq("id", userId).single();
    expect(data!.is_suspended).toBe(true);
    expect(data!.status).toBe("offline");

    const online = await me.rpc("set_rider_availability", { p_online: true, p_zone_id: fx.zoneId });
    expect(online.error?.message).toMatch(/suspended/i);
  });

  it("cannot be suspended twice", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("suspend_rider", { p_rider_id: userId, p_reason: "again" });
    expect(error?.message).toMatch(/already suspended/i);
  });

  it("can go back online once unsuspended", async () => {
    const admin = await adminClient();
    const { error: unsuspendError } = await admin.rpc("unsuspend_rider", { p_rider_id: userId });
    expect(unsuspendError).toBeNull();

    const { error } = await me.rpc("set_rider_availability", { p_online: true, p_zone_id: fx.zoneId });
    expect(error).toBeNull();

    // Leave it offline - a fixture rider still "online" would otherwise be a
    // candidate for dispatch in other tests running against the same DB.
    await me.rpc("set_rider_availability", { p_online: false });
  });
});

function randomPhone(): string {
  return `+639${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
}
