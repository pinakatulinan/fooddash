import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MapPin, Plus, Star } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Saved addresses" };

/**
 * The address book, lifted out of the Account page into its own screen -
 * both the account menu's "Saved addresses" row and the cart's address card
 * now point here instead of each carrying its own inline copy of the list.
 * Editing an existing address isn't a feature the app has yet (AddressForm
 * only ever creates), so a row is informational, not a link to anywhere.
 */
export default async function AddressesPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user } = await getCurrentUser();
  if (!user) redirect("/login?next=/account/addresses");

  const supabase = await createClient();
  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, label, line1, barangay, city, province, landmark, is_default")
    .is("archived_at", null)
    .order("is_default", { ascending: false });

  return (
    <>
      <ScreenHeader
        title="Saved addresses"
        backHref="/account"
        actions={
          (addresses ?? []).length > 0 ? (
            <LinkButton href="/account/addresses/new?next=/account/addresses" size="sm" variant="secondary">
              <Plus aria-hidden className="size-3.5" /> Add
            </LinkButton>
          ) : undefined
        }
      />

      <div className="space-y-2.5 px-5 pb-6">
        {(addresses ?? []).length === 0 ? (
          <EmptyState
            icon={<MapPin className="size-6" />}
            title="No saved addresses"
            description="Add one to start ordering delivery."
            action={<LinkButton href="/account/addresses/new?next=/account/addresses">Add an address</LinkButton>}
          />
        ) : (
          addresses!.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-[20px] bg-card p-3.5 shadow-card">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-coral-tint text-primary">
                <MapPin aria-hidden className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-bold">
                  {a.label}
                  {a.is_default && (
                    <Pill tone="success" showDot={false}>
                      <Star aria-hidden className="size-3 fill-current" />
                      Default
                    </Pill>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {[a.line1, a.barangay, a.city, a.province].filter(Boolean).join(", ")}
                </p>
                {a.landmark && <p className="mt-1 text-xs text-fg-muted italic">“{a.landmark}”</p>}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
