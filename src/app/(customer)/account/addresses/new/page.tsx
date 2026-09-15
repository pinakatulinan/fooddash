import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { AddressForm } from "@/components/customer/address-form";

export const metadata: Metadata = { title: "Add address" };

export default async function NewAddressPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user } = await getCurrentUser();
  if (!user) redirect("/login?next=/account/addresses/new");

  const { next: rawNext } = await searchParams;
  // Only ever redirect back into the app. Reflecting an absolute URL from the
  // query string is a textbook open redirect - see auth/callback/route.ts.
  const next = rawNext?.startsWith("/") ? rawNext : "/account";

  const supabase = await createClient();
  const { count } = await supabase
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null);

  return (
    <>
      <ScreenHeader title="Add address" backHref={next} />
      <AddressForm userId={user.id} isFirstAddress={(count ?? 0) === 0} next={next} />
    </>
  );
}
