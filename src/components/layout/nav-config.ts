import {
  BadgePercent,
  Bike,
  ClipboardList,
  CookingPot,
  Home,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Map,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  Store,
  User,
  Users,
  Wallet,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. Keep to four or five per surface. */
  primary?: boolean;
}

/**
 * Navigation per surface.
 *
 * Each of the four surfaces gets its own information architecture because they
 * are genuinely different jobs: a customer browses, a merchant works a queue,
 * a rider follows one task at a time, ops watches everything at once. Sharing
 * one nav across all four is the usual shortcut and it makes every screen feel
 * like it belongs to somebody else.
 */
export const CUSTOMER_NAV: NavItem[] = [
  { href: "/", label: "Discover", icon: Home, primary: true },
  { href: "/search", label: "Search", icon: Search, primary: true },
  { href: "/orders", label: "Orders", icon: Receipt, primary: true },
  { href: "/account", label: "Account", icon: User, primary: true },
];

export const MERCHANT_NAV: NavItem[] = [
  { href: "/merchant", label: "Today", icon: LayoutDashboard, primary: true },
  { href: "/merchant/orders", label: "Orders", icon: CookingPot, primary: true },
  { href: "/merchant/menu", label: "Menu", icon: ClipboardList, primary: true },
  { href: "/merchant/earnings", label: "Earnings", icon: Wallet, primary: true },
  { href: "/merchant/promos", label: "Promos", icon: BadgePercent },
  // Also the only way to sign out on mobile: SideNav (which carries its own
  // sign-out control) is desktop-only, and BottomNav renders nothing but
  // `primary` items - a non-primary settings page is a dead end on a phone.
  { href: "/merchant/settings", label: "Store settings", icon: Settings, primary: true },
];

export const RIDER_NAV: NavItem[] = [
  { href: "/rider", label: "Jobs", icon: Bike, primary: true },
  { href: "/rider/active", label: "Active", icon: Map, primary: true },
  { href: "/rider/earnings", label: "Earnings", icon: Wallet, primary: true },
  { href: "/rider/account", label: "Account", icon: User, primary: true },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Live ops", icon: LayoutDashboard, primary: true },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag, primary: true },
  { href: "/admin/merchants", label: "Merchants", icon: Store, primary: true },
  { href: "/admin/riders", label: "Riders", icon: Bike, primary: true },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/finance", label: "Finance", icon: Wallet },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  // Also the only way to sign out on mobile - see the identical note on
  // MERCHANT_NAV's settings entry above.
  { href: "/admin/settings", label: "Platform", icon: Settings, primary: true },
];
