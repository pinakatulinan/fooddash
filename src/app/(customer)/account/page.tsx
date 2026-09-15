import type { Metadata } from "next";
import { MapPin, Plus, Star } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { Button, LinkButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { displayPhone } from "@/lib/format";
import { signOut } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user, profile } = await getCurrentUser();
  const supabase = await createClient();

  const { data: addresses } = await supabase
    .from("addresses")
    .select("id, label, line1, barangay, city, province, landmark, is_default")
    .is("archived_at", null)
    .order("is_default", { ascending: false });

  return (
    <>
      <ScreenHeader
        title={profile?.full_name ?? "Your account"}
        subtitle={user?.email ?? undefined}
        actions={profile?.role ? <Pill tone="neutral">{profile.role}</Pill> : undefined}
      />

      <div className="space-y-8 px-4 py-6">
        <section aria-labelledby="details">
          <h2 id="details" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Details
          </h2>
          <Card>
            <dl className="divide-y divide-line">
              <Row label="Name" value={profile?.full_name ?? "—"} />
              <Row label="Email" value={user?.email ?? "—"} />
              <Row label="Mobile" value={displayPhone(profile?.phone)} />
            </dl>
          </Card>
        </section>

        <section aria-labelledby="addresses">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="addresses" className="text-sm font-bold tracking-wide text-fg-muted uppercase">
              Delivery addresses
            </h2>
            {(addresses ?? []).length > 0 && (
              <LinkButton href="/account/addresses/new" size="sm" variant="secondary">
                <Plus aria-hidden className="size-3.5" /> Add
              </LinkButton>
            )}
          </div>

          {(addresses ?? []).length === 0 ? (
            <Card>
              <EmptyState
                icon={<MapPin className="size-6" />}
                title="No saved addresses"
                description="Add one to start ordering delivery."
                action={<LinkButton href="/account/addresses/new">Add an address</LinkButton>}
              />
            </Card>
          ) : (
            <ul className="space-y-2">
              {addresses!.map((a) => (
                <li key={a.id}>
                  <Card>
                    <div className="flex items-start gap-3 p-4">
                      <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-semibold">
                          {a.label}
                          {a.is_default && (
                            <Pill tone="success" showDot={false}>
                              <Star aria-hidden className="size-3 fill-current" />
                              Default
                            </Pill>
                          )}
                        </p>
                        <p className="mt-0.5 text-sm text-fg-muted">
                          {[a.line1, a.barangay, a.city, a.province].filter(Boolean).join(", ")}
                        </p>
                        {a.landmark && (
                          <p className="mt-1 text-sm text-fg-muted italic">“{a.landmark}”</p>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form action={signOut}>
          <Button type="submit" variant="secondary" fullWidth>
            Sign out
          </Button>
        </form>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold">{value}</dd>
    </div>
  );
}
