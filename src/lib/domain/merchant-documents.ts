export type MerchantDocType = "business_permit" | "bir_registration" | "sanitary_permit";

export const DOC_INFO: Record<MerchantDocType, { label: string; hint: string }> = {
  business_permit: {
    label: "Business permit",
    hint: "Current mayor's/business permit for this store's address.",
  },
  bir_registration: {
    label: "BIR registration",
    hint: "BIR Certificate of Registration (Form 2303).",
  },
  sanitary_permit: {
    label: "Sanitary permit",
    hint: "Health/sanitary permit for food handling.",
  },
};

/**
 * Mirrors public.merchant_required_documents() (0016) for the settings
 * checklist. The SQL function is the authority - approve_merchant() reads
 * that one - so if these ever disagree, ops sees "missing documents" while
 * the store's own checklist says it is done.
 */
export function requiredDocuments(): MerchantDocType[] {
  return ["business_permit", "bir_registration", "sanitary_permit"];
}

export const ALLOWED_DOC_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
