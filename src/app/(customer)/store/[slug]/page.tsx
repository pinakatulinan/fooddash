import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Star, UtensilsCrossed } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { AddToCartControl } from "@/components/customer/add-to-cart";
import { StoreHeaderActions } from "@/components/customer/store-header-actions";
import { CategoryChips } from "@/components/customer/category-chips";
import { formatCentavos, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MenuOptionGroup } from "@/lib/types/domain";

const UNCATEGORISED_ID = "more";

/**
 * The store page.
 *
 * One query pulls the whole menu tree - categories, items, option groups,
 * options - through PostgREST's embedded resource syntax. RLS filters it: an
 * unapproved store or an archived item simply is not in the response, so there
 * is no visibility logic to get wrong here.
 */
export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { slug } = await params;
  const supabase = await createClient();

  const { data: merchant } = await supabase
    .from("merchants")
    .select(
      `id, name, tagline, description, logo_url, cover_url, city, barangay,
       rating_avg, rating_count, prep_time_minutes, min_order_centavos,
       menu_categories(id, name, sort_order, is_active),
       menu_items(id, category_id, name, description, image_url, base_price_centavos,
                  is_available, is_popular, sort_order,
                  option_groups(id, name, min_select, max_select,
                                options(id, name, price_delta_centavos, is_available, is_default)))`,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!merchant) notFound();

  const { user } = await getCurrentUser();

  const [{ data: isOpen }, { data: reviews }, { data: favorite }, { data: cart }] = await Promise.all([
    supabase.rpc("is_merchant_open", { p_merchant_id: merchant.id }),
    // No reviewer name here on purpose - profiles has no cross-user read
    // policy (order_tracking's own comment explains why), and a review does
    // not need one to be useful.
    supabase
      .from("reviews")
      .select("id, merchant_rating, comment, created_at")
      .eq("merchant_id", merchant.id)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(10),
    user
      ? supabase
          .from("favorites")
          .select("id")
          .eq("customer_id", user.id)
          .eq("merchant_id", merchant.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // carts has a unique (user_id, merchant_id) - RLS already scopes this to
    // the caller's own row, the merchant_id filter just narrows to this store.
    user
      ? supabase.from("carts").select("id").eq("merchant_id", merchant.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Keyed by menu_item_id so a simple item's AddToCartControl can flip
  // straight from "+" to a quantity stepper without a second round trip -
  // see that component's `cartLine` prop for why this only matters for the
  // ungrouped case.
  const cartLines = new Map<string, { id: string; quantity: number }>();
  if (cart) {
    const { data: items } = await supabase
      .from("cart_items")
      .select("id, menu_item_id, quantity")
      .eq("cart_id", cart.id);
    for (const it of items ?? []) cartLines.set(it.menu_item_id, { id: it.id, quantity: it.quantity });
  }

  type Item = (typeof merchant.menu_items)[number];
  const categories = [...(merchant.menu_categories ?? [])]
    .filter((c) => c.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const itemsFor = (categoryId: string | null): Item[] =>
    (merchant.menu_items ?? [])
      .filter((i) => i.category_id === categoryId)
      .sort((a, b) => a.sort_order - b.sort_order);

  const uncategorised = itemsFor(null);
  const chipSections = [
    ...categories.map((c) => ({ id: c.id, name: c.name })),
    ...(uncategorised.length > 0 ? [{ id: UNCATEGORISED_ID, name: "More" }] : []),
  ];

  return (
    <>
      <div className="relative h-62.5 overflow-hidden bg-hero-brown">
        {merchant.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={merchant.cover_url} alt="" className="size-full object-cover" />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(0,0,0,.35), transparent 40%)" }}
        />
        <div className="absolute inset-x-0 top-0 flex items-center gap-2.5 px-5 py-2.5">
          <Link
            href="/"
            aria-label="Back to Discover"
            className="grid size-10.5 shrink-0 place-items-center rounded-full bg-card text-fg shadow-card"
          >
            <ChevronLeft aria-hidden className="size-5" />
          </Link>
          <div className="flex-1" />
          <StoreHeaderActions
            merchantId={merchant.id}
            merchantName={merchant.name}
            initialFavorited={favorite != null}
          />
        </div>
      </div>

      <div className="relative -mt-17.5 mx-4 rounded-3xl bg-card p-4.5 shadow-pop">
        <div className="flex items-start gap-3">
          {merchant.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={merchant.logo_url} alt="" className="size-13.5 shrink-0 rounded-pill border border-line object-cover" />
          ) : (
            <div className="grid size-13.5 shrink-0 place-items-center rounded-pill bg-coral-tint">
              <UtensilsCrossed aria-hidden className="size-5 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-[-0.01em]">{merchant.name}</h1>
            {merchant.tagline && <p className="mt-0.5 truncate text-[13px] text-fg-muted">{merchant.tagline}</p>}
          </div>
          <Pill tone={isOpen ? "success" : "danger"}>{isOpen ? "Open" : "Closed"}</Pill>
        </div>

        <div className="mt-3.5 grid grid-cols-3 divide-x divide-line rounded-2xl bg-cream py-2.5 text-center">
          <div>
            <p className="text-sm font-bold tabular-nums">
              {merchant.rating_count > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Star aria-hidden className="size-3.5 fill-current text-star" />
                  {Number(merchant.rating_avg).toFixed(1)}
                </span>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              {merchant.rating_count > 0 ? `${merchant.rating_count} ratings` : "No ratings yet"}
            </p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{merchant.prep_time_minutes} min</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">prep time</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{formatCentavos(merchant.min_order_centavos)}</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">minimum</p>
          </div>
        </div>
      </div>

      {merchant.description && (
        <p className="mx-5 mt-4 max-w-prose text-[13px] text-fg-muted">{merchant.description}</p>
      )}

      <div className="mt-2 px-5">
        <CategoryChips categories={chipSections} />
      </div>

      <div className="space-y-7 px-5 pt-2 pb-6">
        {(merchant.menu_items ?? []).length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed className="size-6" />}
            title="This store has not added its menu yet"
            description="Check back shortly — new stores usually fill in their menu within a day of joining."
          />
        ) : (
          <>
            {categories.map((category) => (
              <MenuSection
                key={category.id}
                id={category.id}
                title={category.name}
                items={itemsFor(category.id)}
                cartLines={cartLines}
              />
            ))}
            {uncategorised.length > 0 && (
              <MenuSection id={UNCATEGORISED_ID} title="More" items={uncategorised} cartLines={cartLines} />
            )}
          </>
        )}

        {reviews && reviews.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Reviews</h2>
            <ul className="space-y-2">
              {reviews.map((r) => (
                <li key={r.id}>
                  <Card>
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 text-sm font-semibold">
                          <Star aria-hidden className="size-3.5 fill-current text-primary" />
                          {r.merchant_rating}/5
                        </span>
                        <span className="text-xs text-fg-muted">{formatRelative(r.created_at)}</span>
                      </div>
                      <p className="mt-1.5 text-sm">{r.comment}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function MenuSection({
  id,
  title,
  items,
  cartLines,
}: {
  id: string;
  title: string;
  items: {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    base_price_centavos: number;
    is_available: boolean;
    is_popular: boolean;
    option_groups: MenuOptionGroup[];
  }[];
  cartLines: Map<string, { id: string; quantity: number }>;
}) {
  if (items.length === 0) return null;

  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="mb-3 text-[15px] font-bold">{title}</h2>
      <ul className="space-y-2.5">
        {items.map((item) => {
          const hasGroups = item.option_groups.length > 0;
          return (
            <li key={item.id}>
              <Card
                className={cn("rounded-[20px] shadow-card", !item.is_available && "opacity-55")}
              >
                <div className="flex gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.is_popular && (
                        <span className="rounded-pill bg-coral-pastel px-2 py-0.5 text-[10px] font-bold text-hero-brown uppercase">
                          Popular
                        </span>
                      )}
                      {!item.is_available && (
                        <Pill tone="neutral" showDot={false}>
                          Sold out
                        </Pill>
                      )}
                    </div>
                    <h3 className="mt-1 text-[15px] font-bold">{item.name}</h3>
                    {item.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-[1.4] text-fg-muted">{item.description}</p>
                    )}
                    <p className="mt-2 text-base font-extrabold tabular-nums">
                      {formatCentavos(item.base_price_centavos)}
                    </p>
                  </div>

                  {/* Image on the right, with the add control riding its
                      corner for a simple item - the description column on
                      the left is what your eye actually reads first. */}
                  <div className="relative shrink-0">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt="" className="size-26 rounded-2xl object-cover" />
                    ) : (
                      <div className="size-26 rounded-2xl bg-surface-raised" />
                    )}
                    {item.is_available && !hasGroups && (
                      <div className="absolute -right-1 -bottom-1">
                        <AddToCartControl item={item} compact cartLine={cartLines.get(item.id) ?? null} />
                      </div>
                    )}
                  </div>
                </div>
                {item.is_available && hasGroups && (
                  <div className="px-3 pb-3">
                    <AddToCartControl item={item} />
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
