import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureFixtures, anonClient, adminClient, customerClient, riderClient, type Fixtures } from "./fixtures";

/**
 * Rider onboarding (migration 0015). The first two describes are regressions
 * for holes that were open before the flow existed: any signed-in account
 * could insert its own already-verified riders row, and a rider could mark
 * their own documents approved. The lifecycle test then walks a brand-new
 * rider from signup to verified through the real RPCs.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let fx: Fixtures;
beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

describe("a rider row cannot be self-created", () => {
  it("a plain customer cannot insert a pre-verified riders row", async () => {
    const customer = await customerClient();
    const { error } = await customer
      .from("riders")
      .insert({ id: fx.customerId, vehicle: "motorcycle", is_verified: true, verified_at: new Date().toISOString() });

    // If this ever succeeds, clean up so the fixture customer is not left
    // half-promoted, then fail the test.
    if (!error) await svc.from("riders").delete().eq("id", fx.customerId);
    expect(error).not.toBeNull();
  });

  it("a customer cannot apply through submit_rider_application either", async () => {
    const customer = await customerClient();
    const { error } = await customer.rpc("submit_rider_application", validApplication(fx.zoneId));
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only rider accounts/i);
  });
});

describe("rider documents cannot be self-approved", () => {
  it("cannot insert a document that is already approved", async () => {
    const rider = await riderClient();
    const { data, error } = await rider
      .from("rider_documents")
      .insert({ rider_id: fx.riderUserId, doc_type: "nbi_clearance", storage_path: `${fx.riderUserId}/probe`, status: "approved" })
      .select("id")
      .single();
    if (data) await svc.from("rider_documents").delete().eq("id", data.id);
    expect(error).not.toBeNull();
  });

  it("cannot point a document at another user's storage folder", async () => {
    const rider = await riderClient();
    const { data, error } = await rider
      .from("rider_documents")
      .insert({ rider_id: fx.riderUserId, doc_type: "nbi_clearance", storage_path: `${fx.customerId}/someone-elses.jpg` })
      .select("id")
      .single();
    if (data) await svc.from("rider_documents").delete().eq("id", data.id);
    expect(error).not.toBeNull();
  });

  it("cannot flip their own pending document to approved", async () => {
    const rider = await riderClient();
    const { data: doc } = await rider
      .from("rider_documents")
      .insert({ rider_id: fx.riderUserId, doc_type: "selfie_id", storage_path: `${fx.riderUserId}/selfie-probe.jpg` })
      .select("id")
      .single();
    expect(doc).not.toBeNull();

    await rider.from("rider_documents").update({ status: "approved" }).eq("id", doc!.id);
    const { data: after } = await svc.from("rider_documents").select("status").eq("id", doc!.id).single();
    await svc.from("rider_documents").delete().eq("id", doc!.id);

    expect(after!.status).toBe("pending");
  });

  it("a non-admin cannot review a document or verify a rider", async () => {
    const rider = await riderClient();
    const review = await rider.rpc("review_rider_document", { p_document_id: crypto.randomUUID(), p_approve: true });
    expect(review.error?.message).toMatch(/not_authorised/i);

    const verify = await rider.rpc("verify_rider", { p_rider_id: fx.riderUserId });
    expect(verify.error?.message).toMatch(/not_authorised/i);

    const anon = anonClient();
    const anonVerify = await anon.rpc("verify_rider", { p_rider_id: fx.riderUserId });
    expect(anonVerify.error).not.toBeNull();
  });
});

describe("onboarding lifecycle", () => {
  let userId: string;
  let me: SupabaseClient;

  beforeAll(async () => {
    const email = `qa.onboard.${Date.now()}@fooddash.test`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: "QaFixture123!",
      email_confirm: true,
      user_metadata: { full_name: "QA Onboarding Rider", role: "rider", phone: randomPhone() },
    });
    if (error) throw error;
    userId = data.user.id;

    me = anonClient();
    const { error: signInError } = await me.auth.signInWithPassword({ email, password: "QaFixture123!" });
    if (signInError) throw signInError;
  }, 30_000);

  afterAll(async () => {
    // Cascades through profiles -> riders -> applications and documents.
    if (userId) await svc.auth.admin.deleteUser(userId);
  });

  it("has no riders row until they apply", async () => {
    const { data } = await me.from("riders").select("id").eq("id", userId).maybeSingle();
    expect(data).toBeNull();
  });

  it("rejects an under-18 applicant", async () => {
    const tenYearsAgo = `${new Date().getFullYear() - 10}-01-01`;
    const { error } = await me.rpc("submit_rider_application", { ...validApplication(fx.zoneId), p_date_of_birth: tenYearsAgo });
    expect(error?.message).toMatch(/at least 18/i);
  });

  it("requires a plate for a motorcycle but not for a bicycle", async () => {
    const noPlate = await me.rpc("submit_rider_application", { ...validApplication(fx.zoneId), p_plate_number: "" });
    expect(noPlate.error?.message).toMatch(/enter your vehicle plate/i);
  });

  it("rejects an emergency contact that is the rider's own number", async () => {
    const { data: profile } = await me.from("profiles").select("phone").eq("id", userId).single();
    const { error } = await me.rpc("submit_rider_application", {
      ...validApplication(fx.zoneId),
      p_emergency_contact_phone: profile!.phone,
    });
    expect(error?.message).toMatch(/different number/i);
  });

  it("creates an unverified rider from a valid application", async () => {
    const { error } = await me.rpc("submit_rider_application", validApplication(fx.zoneId));
    expect(error).toBeNull();

    const { data: rider } = await me.from("riders").select("is_verified, vehicle, plate_number").eq("id", userId).single();
    expect(rider!.is_verified).toBe(false);
    expect(rider!.plate_number).toBe("NCR 1234");

    const { data: application } = await me.from("rider_applications").select("payout_method").eq("rider_id", userId).single();
    expect(application!.payout_method).toBe("gcash");
  });

  it("cannot go online while unverified", async () => {
    const { error } = await me.rpc("set_rider_availability", { p_online: true });
    expect(error?.message).toMatch(/still being verified/i);
  });

  it("is not verified until every required document is approved", async () => {
    const admin = await adminClient();

    const early = await admin.rpc("verify_rider", { p_rider_id: userId });
    expect(early.error?.message).toMatch(/missing approved documents/i);

    // A motorcycle rider needs all four.
    const types = ["drivers_license", "or_cr", "nbi_clearance", "selfie_id"];
    const ids: string[] = [];
    for (const doc_type of types) {
      const { data, error } = await me
        .from("rider_documents")
        .insert({
          rider_id: userId,
          doc_type,
          storage_path: `${userId}/${doc_type}-test.jpg`,
          expires_at: doc_type === "drivers_license" ? "2099-01-01" : null,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      ids.push(data!.id);
    }

    // Uploaded but unreviewed is still not enough.
    const unreviewed = await admin.rpc("verify_rider", { p_rider_id: userId });
    expect(unreviewed.error?.message).toMatch(/missing approved documents/i);

    // A rejection must say why.
    const noReason = await admin.rpc("review_rider_document", { p_document_id: ids[0], p_approve: false });
    expect(noReason.error?.message).toMatch(/say why/i);

    for (const id of ids) {
      const { error } = await admin.rpc("review_rider_document", { p_document_id: id, p_approve: true });
      expect(error).toBeNull();
    }

    const verified = await admin.rpc("verify_rider", { p_rider_id: userId });
    expect(verified.error).toBeNull();

    const { data: rider } = await me.from("riders").select("is_verified").eq("id", userId).single();
    expect(rider!.is_verified).toBe(true);
  });

  it("refuses to re-apply once verified", async () => {
    const { error } = await me.rpc("submit_rider_application", { ...validApplication(fx.zoneId), p_vehicle: "car" });
    expect(error?.message).toMatch(/already verified/i);
  });
});

function randomPhone(): string {
  return `+639${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
}

function validApplication(zoneId: string) {
  return {
    p_vehicle: "motorcycle",
    p_plate_number: "ncr 1234",
    p_home_zone_id: zoneId,
    p_date_of_birth: "1995-06-15",
    p_address_line1: "12 Test Street",
    p_barangay: "Lahug",
    p_city: "Cebu City",
    p_emergency_contact_name: "QA Emergency Contact",
    p_emergency_contact_phone: randomPhone(),
    p_payout_method: "gcash",
    p_payout_account_name: "QA Onboarding Rider",
    p_payout_account_number: "0917 123 4567",
    p_accepted_terms: true,
  };
}
