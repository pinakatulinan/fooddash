import { BottomNav } from "@/components/layout/app-nav";
import { CustomerTopBar } from "@/components/layout/customer-top-bar";
import { BasketBar } from "@/components/customer/basket-bar";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Browsing is public by design - discovery, search and store pages all work
  // signed out. The header is where that state actually becomes visible: a
  // signed-out visitor gets "Sign in" instead of a cart icon that would only
  // fail later, on the first thing that actually needs an account.
  const { user } = isSupabaseConfigured
    ? await getCurrentUser()
    : { user: null };

  return (
    <div className="min-h-dvh bg-bg-subtle">
      <CustomerTopBar user={user} />

      {/* pb-20 clears the bottom tab bar on mobile; it is a fixed element and
          would otherwise sit on top of the last card in every list. */}
      <main id="main" className="mx-auto w-full max-w-5xl pb-20 md:pb-10">
        {children}
      </main>

      {user && <BasketBar />}

      <BottomNav surface="customer" />
    </div>
  );
}
