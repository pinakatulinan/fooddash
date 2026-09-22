import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureFixtures, anonClient, adminClient, customerClient, merchantClient, type Fixtures } from "./fixtures";

/**
 * Merchant approval (migration 0016). The regression describe covers the
 * same shape of hole 0015 closed for riders: merchant_documents_member was a
 * single `for all` policy whose with check only allowed a merchant member,
 * not an admin, so an admin's own raw update to approve a document would
 * have been rejected by RLS. Nobody had hit it because nothing ever wrote
 * merchant_documents.status - there was no submit-for-review step and no
 * approve/reject RPC. The lifecycle tests below walk a brand-new store from
 * create_merchant through to approved (and a second one through rejection).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let fx: Fixtures;
beforeAll(async () => {
  fx = await ensureFixtures();
}, 30_000);

describe("merchant documents cannot be self-approved", () => {
  it("cannot insert a document that is already approved", async () => {
    const merchant = await merchantClient();
    const { data, error } = await merchant
      .from("merchant_documents")
      .insert({ merchant_id: fx.merchantId, doc_type: "business_permit", storage_path: `${fx.merchantId}/probe`, status: "approved" })
      .select("id")
      .single();
    if (data) await svc.from("merchant_documents").delete().eq("id", data.id);
    expect(error).not.toBeNull();
  });

  it("cannot point a document at another store's storage folder", async () => {
    const merchant = await merchantClient();
    const { data, error } = await merchant
      .from("merchant_documents")
      .insert({ merchant_id: fx.merchantId, doc_type: "business_permit", storage_path: `${fx.customerId}/someone-elses.jpg` })
      .select("id")
      .single();
    if (data) await svc.from("merchant_documents").delete().eq("id", data.id);
    expect(error).not.toBeNull();
  });

  it("cannot flip their own pending document to approved", async () => {
    const merchant = await merchantClient();
    const { data: doc } = await merchant
      .from("merchant_documents")
      .insert({ merchant_id: fx.merchantId, doc_type: "sanitary_permit", storage_path: `${fx.merchantId}/sanitary-probe.jpg` })
      .select("id")
      .single();
    expect(doc).not.toBeNull();

    await merchant.from("merchant_documents").update({ status: "approved" }).eq("id", doc!.id);
    const { data: after } = await svc.from("merchant_documents").select("status").eq("id", doc!.id).single();
    await svc.from("merchant_documents").delete().eq("id", doc!.id);

    expect(after!.status).toBe("pending");
  });

  it("a non-admin cannot review a document, approve, or reject a store", async () => {
    const merchant = await merchantClient();
    const review = await merchant.rpc("review_merchant_document", { p_document_id: crypto.randomUUID(), p_approve: true });
    expect(review.error?.message).toMatch(/not_authorised/i);

    const approve = await merchant.rpc("approve_merchant", { p_merchant_id: fx.merchantId });
    expect(approve.error?.message).toMatch(/not_authorised/i);

    const reject = await merchant.rpc("reject_merchant", { p_merchant_id: fx.merchantId, p_reason: "no" });
    expect(reject.error?.message).toMatch(/not_authorised/i);

    const anon = anonClient();
    const anonApprove = await anon.rpc("approve_merchant", { p_merchant_id: fx.merchantId });
    expect(anonApprove.error).not.toBeNull();
  });

  it("a stranger cannot submit or edit someone else's store", async () => {
    const customer = await customerClient();
    const submit = await customer.rpc("submit_merchant_for_review", { p_merchant_id: fx.merchantId });
    expect(submit.error?.message).toMatch(/not_authorised/i);

    const address = await customer.rpc("update_merchant_address", {
      p_merchant_id: fx.merchantId,
      p_line1: "hijacked",
      p_barangay: null,
      p_city: "hijacked",
      p_province: null,
      p_postal_code: null,
      p_lat: 10.3,
      p_lng: 123.9,
    });
    expect(address.error?.message).toMatch(/not_authorised/i);
  });
});

async function freshOwner(tag: string) {
  const email = `qa.merchantonboard.${tag}.${Date.now()}@fooddash.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: "QaFixture123!",
    email_confirm: true,
    user_metadata: { full_name: `QA Onboarding Merchant ${tag}`, role: "customer" },
  });
  if (error) throw error;

  const me = anonClient();
  const { error: signInError } = await me.auth.signInWithPassword({ email, password: "QaFixture123!" });
  if (signInError) throw signInError;

  return { userId: data.user.id, me };
}

async function fillRequirements(me: SupabaseClient, merchantId: string) {
  const { error: addrError } = await me.rpc("update_merchant_address", {
    p_merchant_id: merchantId,
    p_line1: "1 Onboarding Street",
    p_barangay: "Lahug",
    p_city: "Cebu City",
    p_province: "Cebu",
    p_postal_code: "6000",
    p_lat: 10.31,
    p_lng: 123.9,
  });
  expect(addrError).toBeNull();

  const { error: hoursError } = await me
    .from("merchant_hours")
    .insert({ merchant_id: merchantId, day_of_week: 1, opens_at: "09:00", closes_at: "21:00" });
  expect(hoursError).toBeNull();

  for (const doc_type of ["business_permit", "bir_registration", "sanitary_permit"]) {
    const { error } = await me
      .from("merchant_documents")
      .insert({ merchant_id: merchantId, doc_type, storage_path: `${merchantId}/${doc_type}-test.jpg` });
    expect(error).toBeNull();
  }
}

describe("approval lifecycle", () => {
  describe("approve path", () => {
    let userId: string;
    let me: SupabaseClient;
    let merchantId: string;

    beforeAll(async () => {
      const owner = await freshOwner("approve");
      userId = owner.userId;
      me = owner.me;

      const { data, error } = await me.rpc("create_merchant", {
        p_name: "QA Onboarding Kitchen (approve)",
        p_phone: "+639171234567",
        p_city: "Cebu City",
      });
      if (error) throw error;
      merchantId = data as string;
    }, 30_000);

    afterAll(async () => {
      if (merchantId) await svc.from("merchants").delete().eq("id", merchantId);
      if (userId) await svc.auth.admin.deleteUser(userId);
    });

    it("starts as draft", async () => {
      const { data } = await me.from("merchants").select("status").eq("id", merchantId).single();
      expect(data!.status).toBe("draft");
    });

    it("refuses to submit without an address", async () => {
      const { error } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      expect(error?.message).toMatch(/address and location/i);
    });

    it("refuses to submit without opening hours once address is set", async () => {
      const { error: addrError } = await me.rpc("update_merchant_address", {
        p_merchant_id: merchantId,
        p_line1: "1 Onboarding Street",
        p_barangay: "Lahug",
        p_city: "Cebu City",
        p_province: "Cebu",
        p_postal_code: "6000",
        p_lat: 10.31,
        p_lng: 123.9,
      });
      expect(addrError).toBeNull();

      const { data: latlng } = (await me.rpc("merchant_location_latlng", { p_merchant_id: merchantId }).maybeSingle()) as unknown as {
        data: { lat: number; lng: number } | null;
      };
      expect(latlng?.lat).toBeCloseTo(10.31, 3);
      expect(latlng?.lng).toBeCloseTo(123.9, 3);

      const { error } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      expect(error?.message).toMatch(/opening hours/i);
    });

    it("refuses to submit without every required document", async () => {
      const { error: hoursError } = await me
        .from("merchant_hours")
        .insert({ merchant_id: merchantId, day_of_week: 1, opens_at: "09:00", closes_at: "21:00" });
      expect(hoursError).toBeNull();

      const { error } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      expect(error?.message).toMatch(/still need to upload/i);
    });

    it("submits once every document is uploaded", async () => {
      for (const doc_type of ["business_permit", "bir_registration", "sanitary_permit"]) {
        const { error } = await me
          .from("merchant_documents")
          .insert({ merchant_id: merchantId, doc_type, storage_path: `${merchantId}/${doc_type}-test.jpg` });
        expect(error).toBeNull();
      }

      const { error } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      expect(error).toBeNull();

      const { data } = await me.from("merchants").select("status").eq("id", merchantId).single();
      expect(data!.status).toBe("pending_review");
    });

    it("cannot be approved until every document is approved", async () => {
      const admin = await adminClient();

      const early = await admin.rpc("approve_merchant", { p_merchant_id: merchantId });
      expect(early.error?.message).toMatch(/missing approved documents/i);

      const { data: docs } = await admin.from("merchant_documents").select("id").eq("merchant_id", merchantId);
      expect(docs!.length).toBe(3);

      const noReason = await admin.rpc("review_merchant_document", { p_document_id: docs![0].id, p_approve: false });
      expect(noReason.error?.message).toMatch(/say why/i);

      for (const d of docs!) {
        const { error } = await admin.rpc("review_merchant_document", { p_document_id: d.id, p_approve: true });
        expect(error).toBeNull();
      }

      const { error } = await admin.rpc("approve_merchant", { p_merchant_id: merchantId });
      expect(error).toBeNull();

      const { data: merchant } = await me.from("merchants").select("status, approved_at").eq("id", merchantId).single();
      expect(merchant!.status).toBe("approved");
      expect(merchant!.approved_at).not.toBeNull();
    });

    it("refuses to re-submit once approved", async () => {
      const { error } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      expect(error?.message).toMatch(/already approved/i);
    });
  });

  describe("reject path", () => {
    let userId: string;
    let me: SupabaseClient;
    let merchantId: string;

    beforeAll(async () => {
      const owner = await freshOwner("reject");
      userId = owner.userId;
      me = owner.me;

      const { data, error } = await me.rpc("create_merchant", {
        p_name: "QA Onboarding Kitchen (reject)",
        p_phone: "+639171234567",
        p_city: "Cebu City",
      });
      if (error) throw error;
      merchantId = data as string;

      await fillRequirements(me, merchantId);
      const { error: submitError } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      if (submitError) throw submitError;
    }, 30_000);

    afterAll(async () => {
      if (merchantId) await svc.from("merchants").delete().eq("id", merchantId);
      if (userId) await svc.auth.admin.deleteUser(userId);
    });

    it("requires a reason to reject", async () => {
      const admin = await adminClient();
      const { error } = await admin.rpc("reject_merchant", { p_merchant_id: merchantId, p_reason: "" });
      expect(error?.message).toMatch(/say why/i);
    });

    it("rejects with a reason and records it", async () => {
      const admin = await adminClient();
      const { error } = await admin.rpc("reject_merchant", {
        p_merchant_id: merchantId,
        p_reason: "Sanitary permit photo is unreadable.",
      });
      expect(error).toBeNull();

      const { data } = await me.from("merchants").select("status, rejection_reason").eq("id", merchantId).single();
      expect(data!.status).toBe("rejected");
      expect(data!.rejection_reason).toMatch(/unreadable/i);
    });

    it("can be resubmitted after a rejection", async () => {
      const { error } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
      expect(error).toBeNull();

      const { data } = await me.from("merchants").select("status, rejection_reason").eq("id", merchantId).single();
      expect(data!.status).toBe("pending_review");
      expect(data!.rejection_reason).toBeNull();
    });
  });
});

describe("expiring documents (0017)", () => {
  let userId: string;
  let me: SupabaseClient;
  let merchantId: string;

  beforeAll(async () => {
    const owner = await freshOwner("expiry");
    userId = owner.userId;
    me = owner.me;

    const { data, error } = await me.rpc("create_merchant", {
      p_name: "QA Onboarding Kitchen (expiry)",
      p_phone: "+639171234567",
      p_city: "Cebu City",
    });
    if (error) throw error;
    merchantId = data as string;

    await fillRequirements(me, merchantId);
    const { error: submitError } = await me.rpc("submit_merchant_for_review", { p_merchant_id: merchantId });
    if (submitError) throw submitError;
  }, 30_000);

  afterAll(async () => {
    if (merchantId) await svc.from("merchants").delete().eq("id", merchantId);
    if (userId) await svc.auth.admin.deleteUser(userId);
  });

  it("is not internally callable - it only ever runs from pg_cron", async () => {
    const admin = await adminClient();
    const { error } = await admin.rpc("expire_stale_documents");
    expect(error).not.toBeNull();

    const anon = anonClient();
    const anonCall = await anon.rpc("expire_stale_documents");
    expect(anonCall.error).not.toBeNull();
  });

  it("approve_merchant refuses an approved document that has already expired", async () => {
    const admin = await adminClient();
    const { data: docs } = await admin.from("merchant_documents").select("id, doc_type").eq("merchant_id", merchantId);
    expect(docs!.length).toBe(3);

    // Back-date one required document past its expiry before approving it,
    // the same way a permit that lapsed between upload and review would look.
    const stale = docs!.find((d) => d.doc_type === "sanitary_permit")!;
    await svc.from("merchant_documents").update({ expires_at: "2000-01-01" }).eq("id", stale.id);

    for (const d of docs!) {
      const { error } = await admin.rpc("review_merchant_document", { p_document_id: d.id, p_approve: true });
      expect(error).toBeNull();
    }

    const { error } = await admin.rpc("approve_merchant", { p_merchant_id: merchantId });
    expect(error?.message).toMatch(/missing approved documents/i);
    expect(error?.message).toMatch(/sanitary_permit/);
  });
});
