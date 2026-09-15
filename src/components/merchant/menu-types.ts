/** Merchant-only menu shapes - the customer-facing MenuItem in lib/types/domain
 * omits fields (sort_order, prep_time_minutes) a shopper never needs. */

export interface EditableOption {
  id: string;
  name: string;
  price_delta_centavos: number;
  is_available: boolean;
}

export interface EditableOptionGroup {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  options: EditableOption[];
}

export interface EditableMenuItem {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price_centavos: number;
  is_available: boolean;
  is_popular: boolean;
  prep_time_minutes: number | null;
  sort_order: number;
  option_groups: EditableOptionGroup[];
}

export interface EditableCategory {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}
