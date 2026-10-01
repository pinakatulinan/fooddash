# Handoff: FoodDash mobile refresh

## Overview
A visual refresh of the FoodDash mobile surfaces (customer, rider, merchant). Same brand — coral + mint, Poppins, existing logo — but the solid coral header bands are replaced by a warm cream ground, white rounded cards, soft warm shadows, photo-led layouts, and a floating bottom nav with a raised cart button. No data model, route, or business-logic changes are required; every element maps onto data the app already fetches.

## About the design files
`FoodDash Redesign.dc.html` is a **design reference built in HTML** — static mockups showing intended look, not production code. Recreate it inside the existing Next.js 15 + Tailwind v4 + lucide-react codebase (`fooddash/`) using its patterns: semantic tokens in `src/app/globals.css`, components in `src/components/**`. Open the HTML in a browser to view; screens are labelled 1a–1l.

## Fidelity
**High-fidelity.** Colors, type sizes, radii, shadows and spacing below are final. Copy/data in the mocks (names, prices, codes) is sample content — use real data.

---

## Design tokens

### Colors (add to `:root` in globals.css)
| Token | Hex | Use |
| --- | --- | --- |
| `--cream` (new) | `#FFF6F1` | App background for every mobile screen |
| `--line-warm` (new) | `#F0E4DD` | Borders, dividers, inactive progress segments |
| `--muted-warm` (new) | `#6B625E` | Secondary text (≈5.6:1 on cream — passes AA) |
| `--seg-bg` (new) | `#F7EFEA` | Segmented-control track, list dividers |
| `--neutral-chip` (new) | `#F4F0EE` | Inactive icon chip fill |
| `--hero-brown` | `#7A3A1F` (= existing `--coral-text`) | Discover hero card ground |
| `--star` | `#E0A44A` (= existing dark-mode `--warning`) | Star rating icon |
| existing `--primary` | `#C24F29` | All CTAs, active nav, active icon |
| existing `--coral-pastel` | `#FFD9C9` | "Popular"/"On the way"/"New order" pills, avatar fill |
| existing `--coral-tint` | `#FFF1EA` | Tinted icon chips, Reorder button, stepper minus |
| existing `--mint-pastel` | `#CFF0E8` | Open/Delivered pills, success fills |
| existing `--teal-text` | `#1F5F4F` | Text on mint; rider header ground; cart badge |
| existing `--mint-mark` | `#5CC9AB` | Completed progress segments, online dot/toggle |
| existing `--danger` / `--danger-tint` | `#B3261E` / `#FDECEA` | Cancelled pill, Decline, Sign out |
| existing `--warning` | `#8F5708` | "Remit at the hub" |
| ink | `#1A1A1A` | Text; dark basket bar; active category chip; selected tip; phone bezel |

Remap aliases: `--bg-subtle: var(--cream)`, `--line: var(--line-warm)`, `--fg-muted: var(--muted-warm)`. Expose `--color-cream`, `--color-line-warm`, `--color-seg` in `@theme inline`. Set `themeColor: "#FFF6F1"` in `src/app/layout.tsx`.

### Radii
| Use | px |
| --- | --- |
| Small chips, steppers, small buttons | 10–12 |
| Icon buttons (squircle), inputs (inner) | 14 |
| Inputs, payment/address cards, search | 16 |
| Primary button | 18 |
| List cards (menu, cart, order rows) | 20 |
| Store tiles | 22 |
| Info card, hero, account card | 24 |
| Floating bottom nav | 26 |
| Bottom sheets / sticky footers (top corners) | 28–32 |
| Pills, avatars | 999 / 50% |

Suggest: `--radius-sm: .75rem; --radius: 1.25rem; --radius-lg: 1.5rem; --radius-xl: 2rem;`

### Shadows (all warm-tinted, `rgb(122 58 31 / a)`)
- `--shadow-card`: `0 4px 14px rgb(122 58 31 / .06)` — list cards, search, stat tiles
- `--shadow-icon`: `0 4px 14px rgb(122 58 31 / .08)` — squircle icon buttons, round filter chips
- `--shadow-tile`: `0 6px 20px rgb(122 58 31 / .08)` — store tiles, account card
- `--shadow-pop`: `0 10px 30px rgb(122 58 31 / .14)` — floating nav, overlap info card, sheets
- `--shadow-cta`: `0 10px 24px rgb(194 79 41 / .30)` — primary button
- `--shadow-fab`: `0 8px 20px rgb(194 79 41 / .35)` — raised cart button

### Typography — Poppins (already loaded via next/font)
| Role | Size / weight / tracking |
| --- | --- |
| Page title (Orders, Account) | 26 / 800 / -0.02em |
| Screen title (Cart, Checkout, Favorites) | 22 / 800 / -0.01em |
| Store name (store page) | 20 / 800 / -0.01em |
| Hero headline | 25 / 800 / lh 1.08 / -0.02em |
| ETA number | 34 / 800 / -0.02em |
| Section heading ("Open now", "Payment") | 18 or 15 / 700 — sentence case, **not** uppercase |
| Card title | 15 / 700 |
| Price | 15–16 / 800 |
| Body / meta | 13–14 / 400–500, `--muted-warm` |
| Small meta / nav label | 11–12 / 500–600 |
| Kicker | 11–12 / 600 / 0.04–0.08em / uppercase |
| Order codes | ui-monospace 13–14 / 700 |

Inputs stay ≥16px (iOS zoom rule from DESIGN.md).

### Spacing
Screen gutter 20px (was 16). Card padding 12–18px. Gap between stacked cards 12px. Section gap 18–22px.

---

## Global changes (do these first — ~70% of the look)

### 1. `src/app/globals.css` — tokens above.

### 2. `src/components/ui/screen-header.tsx`
- Remove `bg-header text-header-fg`; header sits on cream: `bg-transparent text-fg`.
- Container `px-5 pt-3 pb-3`, row `items-center gap-3`.
- Back link → 44×44 white squircle: `grid size-11 place-items-center rounded-[14px] bg-card shadow-icon`, `ChevronLeft size-5`.
- Title `text-[22px] font-extrabold tracking-[-0.01em]`; subtitle `text-[13px] text-fg-muted` (no opacity).
- `actions` and `children` slots unchanged.

### 3. `src/components/layout/app-nav.tsx` — `BottomNav`
- Floating bar: `fixed inset-x-4 bottom-6 z-40 h-[68px] rounded-[26px] bg-card shadow-pop flex items-center px-1.5` (keep `mb-[env(safe-area-inset-bottom)]`). Drop `border-t`.
- Item: `flex-1 flex flex-col items-center gap-[3px] text-[11px]`, icon `size-[22px]`; active `text-primary font-semibold`, inactive `text-[#7A6A63] font-medium`.
- **Customer only:** insert a center slot between item 2 and 3 → `<Link href="/cart">` 62×62 circle, `-mt-[34px] rounded-full bg-primary text-primary-fg border-[5px] border-cream shadow-fab`, `ShoppingBag size-6`. Badge (item count): absolute `-top-0.5 -right-0.5 min-w-5 h-5 rounded-[10px] bg-[#1F5F4F] text-white text-[11px] font-bold`. Count from the same source `BasketBar` uses (`cart-events.ts`).
- Rider nav: active color `#1F5F4F` instead of primary. Merchant: 5 items, icon 21px.
- Remove the cart icon from `customer-top-bar.tsx` and from the hero in `(customer)/page.tsx`.
- `(customer)/layout.tsx` main: `pb-20` → `pb-28`.

### 4. `src/components/ui/card.tsx`
`rounded-[20px] bg-card shadow-card border-0` (drop the 1px border on cream).

### 5. `src/components/ui/button.tsx`
- primary `lg`: `h-14 rounded-[18px] text-base font-bold shadow-cta`.
- secondary: `bg-coral-tint text-primary rounded-xl`.
- danger-soft: `bg-danger-tint text-danger`.
- Keep the 44px minimum height.

### 6. Segmented control (Log In/Sign Up, Active/Past)
Track `rounded-2xl bg-[#F7EFEA] p-1`; option `flex-1 py-2.5 text-sm`; selected `rounded-xl bg-card font-bold shadow-[0_2px_8px_rgb(122_58_31/.1)]`; unselected `font-semibold text-fg-muted`.

---

## Screens

### 1a → 1b · Discover — `src/app/(customer)/page.tsx`
1a is the current screen (reference only). 1b layout, top to bottom on cream:
1. **Address row** (`px-5 pt-3.5 flex items-center gap-3`): left column — "Delivering to" 12/500 muted; below, `MapPin` (primary, 16) + "{label} · {barangay}" 16/700 + `ChevronDown` 16 muted. Right: two 44px white squircles (`Heart` → /favorites, `NotificationBell`). Bell unread dot: 8px `bg-primary` circle with a 2px white ring at top 9 / right 10. Signed-out: replace the squircles with the `Sign in` secondary button.
2. **Search** (`px-5 pt-4`): `h-[50px] rounded-2xl bg-card shadow-card pl-4 gap-2.5`, `Search` 19px ink, placeholder "Search stores or dishes" muted 15px. No coral border. Same `<form action="/search">`.
3. **Hero card** (`mx-5 mt-[18px] h-[178px] rounded-3xl overflow-hidden bg-[#7A3A1F] relative`): cover image of the first open merchant positioned right, 62% width, full height, object-cover; overlay `linear-gradient(90deg,#7A3A1F 38%, transparent 70%)`. Content `p-5 max-w-[200px] text-white`: kicker "{open.length} kitchens open now" 11/600 uppercase 0.08em `text-[#FFD9C9]`; headline "Where food finds you." 25/800; pill button (white, `text-[#7A3A1F]`, 13/700, `py-2 pl-4 pr-2`, trailing 22px primary circle with `ArrowRight`) "Order now" → scrolls to the list.
4. **Filters** (`discovery-filters.tsx`), `px-5 pt-5 flex gap-3.5`: each item is a 66px column — 60px circle + 12px label. Items: **All** (`UtensilsCrossed`, clears filters), **Top rated** (`Star`), **Under 30m** (`Timer`), **Nearby** (`Navigation`). Active: `bg-primary text-white shadow-[0_6px_16px_rgb(194_79_41/.3)]`, label `text-primary font-bold`. Inactive: `bg-card text-primary shadow-icon`, label ink 500. Same `toggle()` logic, `aria-pressed`.
5. **Section header** `px-5 pt-[22px] pb-3`: "Open now" 18/700 + right "See all →" 13/600 primary.
6. **Merchant row** (`merchant-grid.tsx`): drop the bordered `<section>` wrapper. `flex gap-3.5 overflow-x-auto snap-x px-5`. Tile (`MerchantTile`): `w-[232px] flex-none rounded-[22px] bg-card shadow-tile overflow-hidden`. Image `h-[118px]`; top-left optional pill "Top rated" (mint, when rating ≥4.5); top-right 32px white circle with `FavoriteButton`. Body `px-3.5 pt-3 pb-3.5`: name 15/700; meta row 12/500 `#5E5450` gap-2.5: `Star`(#E0A44A) rating · `Clock` "{prep} min" · distance.
   "Currently closed" uses the same row with images `grayscale opacity-70` and a "Closed" white pill bottom-left.

### 1c · Log in — `src/components/auth/auth-shell.tsx`
- Ground cream. `auth-hero.png` absolute top, full width, `h-[330px] object-cover object-top`.
- Mark: 104px white squircle (`rounded-[30px] shadow-[0_12px_30px_rgb(122_58_31/.18)]`) holding the 80px logo mark, `pt-[60px]`, centered.
- Sheet starts at y=268: `rounded-t-[32px] bg-card px-6 pt-7 shadow-[0_-10px_30px_rgb(122_58_31/.08)]`.
- Title "Welcome back" 26/800; sub "Log in to order from kitchens near you." 14 muted (signup: "Create your account").
- Segmented Log In / Sign Up (global #6), `mt-5`.
- Fields (`auth-field.tsx`): `h-[54px] rounded-2xl bg-[#FBF7F5] border-[1.5px] border-line-warm px-4 gap-3`, leading icon 19px (`Mail`, `Lock`), trailing `Eye` toggle on the password field. Focus: `border-primary`, icon primary. Labels can become visually hidden (keep for a11y).
- "Forgot password?" right-aligned 13/600 primary.
- Primary button "Log in" full width (global #5).
- Divider "or continue with" 12px muted between 1px `line-warm` rules.
- `social-buttons.tsx`: two equal `h-[50px] rounded-2xl border-[1.5px] border-line-warm` buttons "Google", "Facebook" 14/600.

### 1d · Store + menu — `src/app/(customer)/store/[slug]/page.tsx`
- Cover `h-[250px]` full-bleed behind the status bar, top fade `linear-gradient(180deg,rgba(0,0,0,.35),transparent 40%)`.
- Over it, `px-5 py-2.5 flex gap-2.5`: back 42px white circle (left), spacer, `StoreHeaderActions` as 42px white circles (MapPin, Heart in primary).
- **Info card** overlaps: `relative -mt-[70px] mx-4 rounded-3xl bg-card p-[18px] shadow-pop`. Row: logo 54px circle, name 20/800 + tagline 13 muted, Open/Closed pill (mint/danger, with dot). Below `mt-3.5`: 3-col stat strip `rounded-2xl bg-cream py-2.5 text-center`, cells split by 1px `line-warm`: rating (★ 4.8 / "312 ratings"), "{prep} min / prep time", "₱{min} / minimum". Value 14/700, label 11 muted.
- Description (if any) below the card, 13 muted.
- **Category chips** (one per `menu_categories`, sticky `top-0` on scroll): `rounded-full px-4 py-2 text-[13px]`; active `bg-fg text-white font-semibold`, rest `bg-card font-medium`. Tap scrolls to the section.
- **Menu item** (`MenuSection`): `rounded-[20px] bg-card p-3 flex gap-3 shadow-card`. Left: optional "POPULAR" pill (`bg-coral-pastel text-[#7A3A1F] 10/700 uppercase`), name 15/700, description 12/1.4 muted, price 16/800 `mt-2`. Right: image 104×104 `rounded-2xl`. `AddToCartControl compact` sits at `-right-1 -bottom-1`: 36px primary circle with `Plus` and a 3px white border; once in the cart it becomes a pill stepper (white, 1.5px line-warm border, minus on coral-tint, plus on primary, qty 14/700).
- Sold out: card `opacity-55` + neutral pill (unchanged).
- **`basket-bar.tsx`**: floating `inset-x-4 bottom-6 h-[62px] rounded-[22px] bg-fg text-white pl-[18px] pr-2 gap-3 shadow-[0_12px_30px_rgb(26_26_26/.25)]`: 30px primary square (`rounded-[10px]`) with item count, "View cart" 14/600 flex-1, total in a `bg-primary rounded-2xl px-4 py-3 15/700` chip. On store pages it replaces the bottom nav; on other pages hide it (the nav's cart button carries the count).

### 1e · Cart — `src/app/(customer)/cart/page.tsx`
- ScreenHeader (global #2) "Your cart" / "From {store}".
- Line card: `rounded-[20px] bg-card p-3 flex gap-3 items-center`; thumb 72px `rounded-[14px]` (menu item image); name 15/700, options 12 muted, notes italic; line total 15/800. Right: vertical stepper (`CartItemQuantity`) `rounded-[14px] bg-cream p-1 gap-1.5`: + (28px primary, `rounded-[10px]`), qty 14/700, − (28px white) — shows `Trash2` when qty = 1 (merges `RemoveCartItemButton`).
- "+ Add more items" 13/600 primary link → store.
- Address card: 40px mint chip `MapPin`, label 14/700, address 12 muted (truncate), `ChevronRight` → /account/addresses.
- Totals card `px-4 py-1.5`: rows 14px muted label / ink 600 value, dashed `line-warm` separators; Total row solid separator, "Total" 15/700, amount 20/800. Discount value `text-accent-fg`.
- Sticky footer: `fixed bottom-0 inset-x-0 rounded-t-[28px] bg-card px-5 pt-4 pb-[30px] shadow-[0_-8px_24px_rgb(122_58_31/.08)]`. Button content split: "Checkout" left, "₱{total} →" right. Disabled when `!quote.is_valid`. The bottom nav is hidden on this route.
- Keep the warning/error alerts (`rounded-2xl`).

### 1f · Checkout — `src/components/customer/checkout-form.tsx`
- Section headings 15/700 sentence case, `mb-2.5`.
- **Deliver to**: horizontal 2-up (scroll if >2) address cards `rounded-[18px] bg-card p-3 border-2`; selected `border-primary` + 18px primary check circle top-right; unselected `border-transparent`. "+ Add" 13/600 primary right of the heading.
- **Payment**: `grid-cols-2 gap-2.5`. Card `rounded-2xl bg-card p-3 border-2 flex gap-2.5 items-center 13/600`; 32px chip `rounded-[10px]` — selected `bg-coral-tint text-primary`, else `bg-[#F4F0EE]`. Icons: Cash on delivery `Banknote`, GCash/Maya `Smartphone`, Card `CreditCard`.
- **Tip**: 4 equal chips `rounded-[14px] py-2.5 14/600`; selected `bg-fg text-white`, else `bg-card`. Labels: None, ₱20, ₱30, ₱50 (`TIP_PRESETS_CENTAVOS`).
- **Promo**: `h-[52px] rounded-2xl bg-card pl-3.5 pr-1.5` with `Ticket` primary icon, input 14/600 tracking 0.05em; when valid, trailing mint chip "−₱{discount} applied"; invalid → danger text below.
- Notes textarea (unchanged logic) in the same input style.
- Sticky footer like Cart: "Total incl. ₱{tip} tip" 13 muted + amount 22/800, then "Place order" primary.

### 1g · Order tracking — `src/app/(customer)/orders/[id]/page.tsx`
- `OrderTrackingMap` fills the top 430px (behind the status bar). Over it: back squircle left, order code chip right (`h-11 rounded-[14px] bg-card px-3.5`, mono 13/600).
- **Bottom sheet** from y≈380: `rounded-t-[32px] bg-card px-5 pt-3 shadow-[0_-10px_30px_rgb(122_58_31/.12)]`, 40×4 grabber `bg-line-warm`.
  - Row: kicker "Arriving in" 12/600 primary uppercase; ETA "{min} min" 34/800 (from `promised_at − now`). Right: `OrderStatusPill`.
  - Sub: `ORDER_STATUS[status].customer` + " · due {time}" 14 muted.
  - **Progress**: one 6px segment per step in `DELIVERY_TIMELINE`/`PICKUP_TIMELINE`, `gap-1 rounded-[3px]`; reached `#5CC9AB`, current = primary (optionally a 60% fill), future `line-warm`. Labels below 11/500 muted (current ink 700): Placed · Preparing · On the way · Delivered.
  - **Rider card** `mt-5 rounded-[20px] bg-cream p-3.5 gap-3`: 48px mint circle `Bike`, name 15/700, "{vehicle} · {plate}" 12 muted, 44px white squircle `MessageCircle` (opens `OrderChat`), 44px primary squircle `Phone` (tel:).
  - Store row: logo 40px, name 14/600, "{n} items · ₱{total} · {payment}" 12 muted, "Details" 13/600 primary → expands the existing Order details / items / totals sections (keep them below, restyled as cards).
- Non-live orders (delivered/cancelled): no map; show the existing details on cream with the new card style. Keep rate/report/cancel/retry blocks.

### 1h · Orders — `src/app/(customer)/orders/page.tsx` (+ `history`)
- Title "Orders" 26/800 (no header band), segmented "Active · {n}" / "Past".
- **Active order card**: `rounded-[22px] bg-fg text-white p-4`: logo 44px, store 15/700, "{code} · {n} items" 12 at 75% opacity, right ETA 20/800 + " min" 12/600. Mini progress (5px; done mint, current primary, rest `#3A3A3A`). Status line 13/500.
- Group label "Earlier this week" 13/700 muted.
- **Past row** (`order-history-card.tsx`): `rounded-[20px] bg-card p-3.5 gap-3`: logo 44px, store 14/700, "{date} · ₱{total}" 12 muted, status pill (Delivered mint / Cancelled danger, with dot); right "Reorder" `bg-coral-tint text-primary rounded-xl px-3 py-2 12/700`.

### 1i · Favorites — `src/app/(customer)/favorites/page.tsx`
- ScreenHeader "Favorites" / "{n} saved kitchens".
- Grid `grid-cols-2 gap-3 px-5`. First item spans 2 columns: image 150px, filled-heart 34px primary circle top-right, name 15/700 + meta, Open pill right. Others: image 110px, heart 30px, name 14/700, "{prep} min · {distance}" 12/500.
- Closed stores: image `grayscale opacity-70` + white pill "Opens {time}" bottom-left.

### 1j · Account — `src/app/(customer)/account/page.tsx`
- Title "Account" 26/800.
- Profile card `rounded-3xl bg-card p-[18px] shadow-tile`: 60px coral-pastel avatar with initials 22/800 `#7A3A1F`, name 17/700, email 13 muted, chevron.
- 2 stat tiles `grid-cols-2 gap-3`: primary tile (white text, `Receipt`, count 22/800, "orders placed"), mint tile (teal text, `Heart`, "favorite kitchens") → /favorites.
- Menu card `rounded-3xl py-1.5`: rows `px-[18px] py-3 gap-3.5`, 38px coral-tint squircle icon (`MapPin` Saved addresses + count, `Bell` Notifications, `LifeBuoy` Help & support, `Shield` Privacy & terms), label 14/600, chevron; dividers `#F7EFEA`.
- Separate "Sign out" card, danger text, 38px danger-tint icon `LogOut`.

### 1k · Rider · Jobs — `src/app/(rider)/rider/page.tsx` (lighter pass)
- Header block `bg-[#1F5F4F] text-white rounded-b-[32px] pb-[22px]` (rider surface identity = teal; customer = coral): "Hi, {first}" 24/800, "{n} deliveries completed" 13 `#CFF0E8`, bell squircle `bg-white/12`.
- `AvailabilityToggle` inside: `rounded-[20px] bg-white/10 pl-4 pr-1.5 py-1.5`: 10px mint dot with a 4px `rgba(92,201,171,.25)` ring, "You're online" 15/700, 58×34 switch (on = `#5CC9AB`).
- 2 stat tiles: Today (earnings + trips), Cash on hand (+ "Remit at the hub" in warning). Uppercase 11/600 kicker, value 22/800.
- **Offer card** `rounded-3xl bg-card p-[18px] border-2 border-primary shadow-pop`: code mono 13/700, payout 32/800 primary, "payout" 12 muted; right 56px countdown ring (4px `line-warm`, primary arc = time remaining, mm:ss 14/700). Rows with 28px chips: store (coral-tint `Store`) + "{distance} to the store"; cash (mint `Banknote`) "Cash order · collect ₱{total}".
- `OfferActions` → `ui/swipe-button.tsx`: `h-[58px] rounded-[29px] bg-primary`, 48px white knob with `ChevronsRight`, label "Swipe to accept" 15/700; "Decline" text button 13/600 muted below.
- Nav: Jobs / Active / Earnings / Account, active teal.

### 1l · Merchant · Today — `src/app/(merchant)/merchant/page.tsx` (lighter pass)
- Header row: logo 48px, store name 19/800, "Last 7 days" 12 muted, bell squircle with dot.
- `PauseStoreControl` banner: `rounded-[18px] bg-mint-pastel text-teal p-2.5 pl-4`: dot, "Accepting orders" 14/700, white "Pause" chip 12/700. Paused state: danger-tint / danger, button "Resume".
- `Stat` 2×2 `gap-2.5`: `rounded-[18px] bg-card px-3.5 py-3`, label 12 muted, value 22/800, trend 11 muted with icon (keep neutral-grey trend logic). Drop the icon chips.
- "Live queue" 16/700 + count in primary.
- `LiveQueueList` item `rounded-[20px] bg-card p-3.5`: code mono 14/700 + `OrderStatusPill audience="merchant"`; meta "{n} items · ₱{total} · {type} · {relative}" 12 muted. For `placed`: actions row — Accept (flex-2, primary, 44px, `rounded-[14px]`) + Decline (flex-1, danger-tint/danger). Other statuses: single compact row with the next action (`merchantActionsFor`) as a dark `bg-fg` button, e.g. "Mark ready".
- Nav: Today / Orders / Menu / Earnings / Settings (5 items, 21px icons).

---

## Interactions & behavior
- Pressed state on all tappables: `active:scale-[0.97] transition-transform duration-150` (already used on filter chips).
- Hover (desktop): cards `hover:shadow-tile`, squircles `hover:bg-coral-tint`.
- Focus: keep the global `:focus-visible` ring from globals.css.
- Category chips on the store page: IntersectionObserver highlights the chip for the section in view; tapping smooth-scrolls (respect `prefers-reduced-motion`).
- Tracking sheet: static height is fine; optional drag to expand into the full details.
- Bottom nav is hidden on `/cart`, `/checkout` and `/store/*` (the sticky footer / basket bar takes its place). Keep the `CustomerTopBar` `HIDDEN_ON` logic in step.
- Skeletons (`fd-skeleton`) use the new radii.

## State
No new server state. Client additions:
- Cart item count for the nav badge — subscribe via `cart-events.ts` (same as `BasketBar`).
- Store page: `activeCategoryId` (scroll-spy).
- Orders page: `tab: "active" | "past"` (or keep `/orders` vs `/orders/history` routes behind the segmented control).
- Tracking ETA: derived from `promised_at`; refreshes with the existing `RealtimeRefresh`.

## Accessibility (keeps DESIGN.md rules)
- `--muted-warm #6B625E` on `#FFF6F1` ≈ 5.6:1; on white ≈ 6:1.
- White on `#C24F29` = 4.73:1 (the AA fix already applied in `--primary`).
- `#FFD9C9` text on `#7A3A1F` hero ≈ 6.5:1.
- Status still carries dot + word, never colour alone.
- Hit targets ≥ 44px (icon squircles 44, stepper buttons 28 inside a 36px+ control — enlarge the hit area with padding if needed).

## Assets
All already in the repo:
- `public/brand/fooddash-mark.png`, `fooddash-light.png`, `auth-hero.png`
- Store covers/logos come from `merchants.cover_url` / `logo_url` (mocks used `images/dashboard pic/*` and `images/*logo.jpg`).
- Icons: lucide-react — MapPin, ChevronDown, ChevronLeft, ChevronRight, Heart, Bell, Search, UtensilsCrossed, Star, Timer, Navigation, Clock, ArrowRight, House (Discover), Receipt, User, ShoppingBag, Plus, Minus, Trash2, Banknote, Smartphone, CreditCard, Ticket, Check, Bike, MessageCircle, Phone, LifeBuoy, Shield, LogOut, Mail, Lock, Eye, Store, ChevronsRight, Map, Wallet, LayoutDashboard, CookingPot, ClipboardList, Settings, TrendingUp, Minus.
- The tracking map in the mock is a placeholder — use the existing `OrderTrackingMap`.

## Files in this bundle
- `FoodDash Redesign.dc.html` — all mockups (open in a browser; needs `support.js` next to it). Screens: 1a current Discover, 1b new Discover, 1c Log in, 1d Store, 1e Cart, 1f Checkout, 1g Tracking, 1h Orders, 1i Favorites, 1j Account, 1k Rider Jobs, 1l Merchant Today.
- `assets/` — images referenced by the mockups.
- `screenshots/` — one PNG per screen (403×850), named by screen id: `1a-discover-current`, `1b-discover`, `1c-login`, `1d-store-menu`, `1e-cart`, `1f-checkout`, `1g-order-tracking`, `1h-orders`, `1i-favorites`, `1j-account`, `1k-rider-jobs`, `1l-merchant-today`.

## Suggested implementation order
1. Tokens (globals.css + layout.tsx themeColor)
2. ScreenHeader, Card, Button, segmented control
3. BottomNav (floating + cart FAB), remove header cart icons
4. Discover (page, discovery-filters, merchant-grid)
5. Store page + basket bar
6. Cart → Checkout → Tracking → Orders
7. Favorites, Account, Auth shell
8. Rider and merchant passes
