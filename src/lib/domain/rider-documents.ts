import type { VehicleType } from "@/lib/types/domain";

export type RiderDocType = "drivers_license" | "or_cr" | "nbi_clearance" | "selfie_id";

export const DOC_INFO: Record<RiderDocType, { label: string; hint: string }> = {
  drivers_license: {
    label: "Driver's license",
    hint: "Front side, clear and uncropped. Must not be expired.",
  },
  or_cr: {
    label: "OR/CR",
    hint: "Your vehicle's official receipt and certificate of registration.",
  },
  nbi_clearance: {
    label: "NBI clearance",
    hint: "A current NBI clearance (valid for one year from issue).",
  },
  selfie_id: {
    label: "Selfie holding your ID",
    hint: "Your face and a government ID in the same photo, both readable.",
  },
};

/**
 * Mirrors public.rider_required_documents() (0015) for the form's checklist.
 * The SQL function is the authority - verify_rider() reads that one - so if
 * these ever disagree, ops sees "missing documents" while the rider's own
 * checklist says they are done.
 */
export function requiredDocuments(vehicle: VehicleType): RiderDocType[] {
  return vehicle === "motorcycle" || vehicle === "car"
    ? ["drivers_license", "or_cr", "nbi_clearance", "selfie_id"]
    : ["nbi_clearance", "selfie_id"];
}

export const needsPlate = (vehicle: VehicleType) => vehicle === "motorcycle" || vehicle === "car";

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  car: "Car",
  on_foot: "On foot",
};

export const PAYOUT_METHODS = [
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "bank", label: "Bank account" },
] as const;

export const ALLOWED_DOC_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
