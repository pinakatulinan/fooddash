/**
 * Hand-written mirrors of the database enums and the row shapes the UI reads.
 *
 * Run `npm run db:types` once a Supabase project exists and this file is
 * superseded by generated types in src/lib/types/database.ts. Until then these
 * are the contract, and they are kept deliberately narrow: only the columns
 * the UI actually renders, so a schema change that matters shows up as a type
 * error rather than as undefined on a screen.
 */

export type UserRole = "customer" | "merchant" | "rider" | "support" | "admin";

export type MerchantStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "suspended"
  | "rejected";

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "placed"
  | "accepted"
  | "preparing"
  | "ready_for_pickup"
  | "picked_up"
  | "arrived"
  | "delivered"
  | "cancelled"
  | "failed";

export type OrderType = "delivery" | "pickup";
export type PaymentMethod = "cod" | "gcash" | "maya" | "card";
export type PaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded";

export type RiderStatus =
  | "offline"
  | "online_idle"
  | "on_offer"
  | "en_route_to_store"
  | "at_store"
  | "en_route_to_customer"
  | "unavailable";

export type AssignmentStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled"
  | "completed";

export type VehicleType = "motorcycle" | "bicycle" | "car" | "on_foot";

/** Row shape returned by the `nearby_merchants` RPC. */
export interface MerchantCard {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  cover_url: string | null;
  city: string | null;
  rating_avg: number;
  rating_count: number;
  prep_time_minutes: number;
  min_order_centavos: number;
  distance_m: number;
  is_open: boolean;
}

export interface MenuOption {
  id: string;
  name: string;
  price_delta_centavos: number;
  is_available: boolean;
  is_default: boolean;
}

export interface MenuOptionGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price_centavos: number;
  is_available: boolean;
  is_popular: boolean;
  option_groups?: MenuOptionGroup[];
}

/** Shape of the jsonb returned by `price_cart`. */
export interface CartQuote {
  cart_id: string;
  merchant_id: string;
  merchant_name: string;
  order_type: OrderType;
  lines: QuoteLine[];
  subtotal_centavos: number;
  delivery_fee_centavos: number;
  service_fee_centavos: number;
  discount_centavos: number;
  tip_centavos: number;
  total_centavos: number;
  promo_id: string | null;
  promo_code: string | null;
  zone_id: string | null;
  distance_m: number | null;
  eta_minutes: number | null;
  errors: { code: string; message: string; cart_item_id?: string }[];
  is_valid: boolean;
}

export interface QuoteLine {
  cart_item_id: string;
  menu_item_id: string;
  name: string;
  image_url: string | null;
  quantity: number;
  unit_price_centavos: number;
  line_total_centavos: number;
  notes: string | null;
  options: {
    option_id: string;
    group_name: string;
    name: string;
    price_delta_centavos: number;
  }[];
}

/** Shape of the jsonb returned by `order_tracking`. */
export interface OrderTracking {
  order_id: string;
  code: string;
  status: OrderStatus;
  type: OrderType;
  placed_at: string | null;
  promised_at: string | null;
  eta_minutes: number | null;
  total_centavos: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  pod_code: string | null;
  merchant: {
    id: string;
    name: string;
    logo_url: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
  };
  dropoff: {
    address: Record<string, string> | null;
    lat: number | null;
    lng: number | null;
  };
  rider: {
    rider_id: string;
    first_name: string;
    avatar_url: string | null;
    phone: string | null;
    vehicle: VehicleType;
    plate_number: string | null;
    rating_avg: number;
    lat: number | null;
    lng: number | null;
    last_ping_at: string | null;
  } | null;
  timeline: { status: OrderStatus; at: string; note: string | null }[];
}
