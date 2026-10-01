import type { Metadata } from "next";
import Link from "next/link";
import { Bell, ChevronRight, Heart, LifeBuoy, LogOut, MapPin, Receipt, Shield } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { signOut } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Account" };

const SUPPORT_EMAIL = "support@fooddash.test";

/** "Jamie Dela Cruz" -> "JD". Falls back to an email's first letter, then a
    generic mark - an avatar needs something to show even for a profile row
    that somehow has neither (shouldn't happen, but signup order is not
    enforced at the type level). */
function initials(name: string | null | undefined, email: string | null | undefined): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

export default async function AccountPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const { user, profile } = await getCurrentUser();
  const supabase = await createClient();

  const [{ count: addressCount }, { count: orderCount }, { count: favoriteCount }] = await Promise.all([
    supabase.from("addresses").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase.from("favorites").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-5 px-5 pt-3 pb-6">
      <h1 className="text-[26px] font-extrabold tracking-[-0.01em]">Account</h1>

      <div className="flex items-center gap-3.5 rounded-3xl bg-card p-4.5 shadow-tile">
        <span className="grid size-15 shrink-0 place-items-center rounded-pill bg-coral-pastel text-[22px] font-extrabold text-hero-brown">
          {initials(profile?.full_name, user?.email)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold">{profile?.full_name ?? "Your account"}</p>
          <p className="truncate text-[13px] text-fg-muted">{user?.email ?? "—"}</p>
        </div>
        <ChevronRight aria-hidden className="size-4.5 shrink-0 text-fg-muted" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/orders" className="rounded-[18px] bg-primary p-3.5 text-primary-fg">
          <Receipt aria-hidden className="size-5" />
          <p className="mt-2.5 text-xl font-extrabold tabular-nums">{orderCount ?? 0}</p>
          <p className="text-[12px] text-primary-fg/85">orders placed</p>
        </Link>
        <Link href="/favorites" className="rounded-[18px] bg-mint-tint p-3.5 text-accent-fg">
          <Heart aria-hidden className="size-5" />
          <p className="mt-2.5 text-xl font-extrabold tabular-nums">{favoriteCount ?? 0}</p>
          <p className="text-[12px] text-accent-fg/75">favorite kitchens</p>
        </Link>
      </div>

      <div className="rounded-3xl bg-card py-1.5 shadow-card">
        <MenuRow
          href="/account/addresses"
          icon={<MapPin aria-hidden className="size-4.5" />}
          label="Saved addresses"
          meta={addressCount ? `${addressCount}` : undefined}
        />
        <Divider />
        <MenuRow icon={<Bell aria-hidden className="size-4.5" />} label="Notifications" />
        <Divider />
        <MenuRow
          href={`mailto:${SUPPORT_EMAIL}`}
          icon={<LifeBuoy aria-hidden className="size-4.5" />}
          label="Help & support"
        />
        <Divider />
        <MenuRow href="/privacy" icon={<Shield aria-hidden className="size-4.5" />} label="Privacy & terms" />
      </div>

      <form action={signOut} className="rounded-3xl bg-card shadow-card">
        <button
          type="submit"
          className="flex w-full items-center gap-3.5 px-4.5 py-3.5 text-left text-[14px] font-semibold text-danger"
        >
          <span className="grid size-9.5 shrink-0 place-items-center rounded-[12px] bg-danger-tint">
            <LogOut aria-hidden className="size-4.5" />
          </span>
          Sign out
        </button>
      </form>
    </div>
  );
}

function Divider() {
  return <div role="separator" className="mx-4.5 h-px bg-[#F7EFEA]" />;
}

function MenuRow({
  href,
  icon,
  label,
  meta,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  meta?: string;
}) {
  const content = (
    <>
      <span className="grid size-9.5 shrink-0 place-items-center rounded-[12px] bg-coral-tint text-primary">
        {icon}
      </span>
      <span className="flex-1 text-[14px] font-semibold">{label}</span>
      {meta && <span className="text-sm text-fg-muted tabular-nums">{meta}</span>}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
    </>
  );

  const className = "flex items-center gap-3.5 px-4.5 py-3";

  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}
