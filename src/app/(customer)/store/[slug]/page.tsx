import { notFound } from "next/navigation";
import { Clock, MapPin, ShoppingBag, Star, UtensilsCrossed } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { AddToCartControl } from "@/components/customer/add-to-cart";
import { StoreHeaderActions } from "@/components/customer/store-header-actions";
import { formatCentavos, formatCentavosCompact, formatRelative } from "@/lib/format";
import type { MenuOptionGroup } from "@/lib/types/domain";

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

  const [{ data: isOpen }, { data: reviews }, { data: favorite }] = await Promise.all([
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
  ]);

  type Item = (typeof merchant.menu_items)[number];
  const categories = [...(merchant.menu_categories ?? [])]
    .filter((c) => c.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const itemsFor = (categoryId: string | null): Item[] =>
    (merchant.menu_items ?? [])
      .filter((i) => i.category_id === categoryId)
      .sort((a, b) => a.sort_order - b.sort_order);

  const uncategorised = itemsFor(null);

  return (
    <>
      <header className="bg-header px-4 pt-3 pb-6 text-header-fg">
        <div className="flex justify-end">
          <StoreHeaderActions
            merchantId={merchant.id}
            merchantName={merchant.name}
            initialFavorited={favorite != null}
          />
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {merchant.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merchant.logo_url}
                alt=""
                className="size-12 shrink-0 rounded-pill border border-white/20 object-cover"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-balance">{merchant.name}</h1>
              {merchant.tagline && <p className="mt-1 text-sm opacity-85">{merchant.tagline}</p>}
            </div>
          </div>
          <Pill tone={isOpen ? "success" : "danger"}>{isOpen ? "Open" : "Closed"}</Pill>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm opacity-85">
          {merchant.rating_count > 0 && (
            <span className="flex items-center gap-1.5">
              <Star aria-hidden className="size-3.5 fill-current" />
              {Number(merchant.rating_avg).toFixed(1)} ({merchant.rating_count})
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" />
            {merchant.prep_time_minutes} min prep
          </span>
          {merchant.min_order_centavos > 0 && (
            <span className="flex items-center gap-1.5">
              <ShoppingBag aria-hidden className="size-3.5" />
              Min {formatCentavosCompact(merchant.min_order_centavos)}
            </span>
          )}
          {(merchant.barangay || merchant.city) && (
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden className="size-3.5" />
              {[merchant.barangay, merchant.city].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
      </header>

      <div className="space-y-8 px-4 py-6">
        {merchant.description && (
          <p className="max-w-prose text-sm text-fg-muted">{merchant.description}</p>
        )}

        {(merchant.menu_items ?? []).length === 0 ? (
          <EmptyState
            icon={<UtensilsCrossed className="size-6" />}
            title="This store has not added its menu yet"
            description="Check back shortly — new stores usually fill in their menu within a day of joining."
          />
        ) : (
          <>
            {categories.map((category) => (
              <MenuSection key={category.id} title={category.name} items={itemsFor(category.id)} />
            ))}
            {uncategorised.length > 0 && <MenuSection title="More" items={uncategorised} />}
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
  title,
  items,
}: {
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
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">{title}</h2>
      <ul className="space-y-2">
        {items.map((item) => {
          const hasGroups = item.option_groups.length > 0;
          return (
            <li key={item.id}>
              <Card className={item.is_available ? undefined : "opacity-55"}>
                <div className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{item.name}</h3>
                        {item.is_popular && (
                          <Pill tone="active" showDot={false}>
                            Popular
                          </Pill>
                        )}
                        {!item.is_available && (
                          <Pill tone="neutral" showDot={false}>
                            Sold out
                          </Pill>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-1 text-sm text-fg-muted">{item.description}</p>
                      )}
                      <p className="mt-2 font-bold tabular-nums">
                        {formatCentavos(item.base_price_centavos)}
                      </p>
                    </div>

                    {/* Image on the right, with the add control riding its
                        corner for a simple item - the description column on
                        the left is what your eye actually reads first. */}
                    <div className="relative shrink-0">
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.image_url}
                          alt=""
                          className="size-24 rounded-md border border-line object-cover"
                        />
                      ) : (
                        <div className="size-24 rounded-md border border-line bg-surface-raised" />
                      )}
                      {item.is_available && !hasGroups && (
                        <div className="absolute -right-2 -bottom-2">
                          <AddToCartControl item={item} compact />
                        </div>
                      )}
                    </div>
                  </div>
                  {item.is_available && hasGroups && (
                    <div className="mt-3">
                      <AddToCartControl item={item} />
                    </div>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
