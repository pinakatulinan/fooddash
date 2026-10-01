"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: { order_id?: string; ticket_id?: string };
  read_at: string | null;
  created_at: string;
}

/**
 * Self-contained: fetches its own notifications on mount and each time the
 * panel opens, rather than threading data through every layout that mounts
 * it - and subscribes to Realtime for its own user_id so the badge (and an
 * open panel's list) updates the moment a trigger writes a new row, not on
 * the next reopen.
 */
export function NotificationBell({
  className,
  buttonClassName,
  surface = "customer",
}: {
  /** Applied to the outer (relative-positioned) wrapper - use this for
      layout (margins, shrink-0), not appearance. */
  className?: string;
  /** Applied to the bell button itself, merged over (and able to override)
      its default pill - e.g. Discover's squircle treatment. */
  buttonClassName?: string;
  /**
   * can_view_order (0009) actually lets a merchant member or an assigned
   * rider load /orders/[id]'s data - but that page is styled and chromed for
   * the customer surface (its header, its bottom nav), so landing there from
   * another role would be structurally wrong even though the data loads.
   * Surface decides where a click actually goes instead.
   */
  surface?: "customer" | "merchant";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationRow[] | null>(null);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [userId, setUserId] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  const refreshUnreadCount = React.useCallback(async () => {
    const supabase = createClient();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    setUnreadCount(count ?? 0);
  }, []);

  const refreshList = React.useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, data, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as unknown as NotificationRow[]);
  }, []);

  React.useEffect(() => {
    // Deferred, not called directly - matches checkout-form's price_cart
    // effect: the fetch's setState has to land in a callback, not the
    // effect's own synchronous body, or a mount-time cascade follows.
    const timer = window.setTimeout(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      await refreshUnreadCount();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshUnreadCount]);

  React.useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function connect() {
      // Same fix, same reason as RealtimeRefresh (layout/realtime-refresh.tsx):
      // a cookie-loaded session does not automatically authenticate this
      // socket, so a subscribe() before this resolves silently receives
      // nothing - it reports SUBSCRIBED and then never delivers a row.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`notification-bell:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          () => {
            refreshUnreadCount();
            // Only bother refetching the visible list while the panel is
            // open - no point keeping a closed dropdown's data fresh nobody
            // can see.
            if (openRef.current) refreshList();
          },
        )
        .subscribe();
    }

    connect();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, refreshUnreadCount, refreshList]);

  React.useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next) await refreshList();
  }

  async function handleSelect(n: NotificationRow) {
    setOpen(false);
    if (!n.read_at) {
      const supabase = createClient();
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    // Every notification type carries an order_id (ticket ones too, since a
    // ticket is always raised against one) - there is no standalone ticket
    // page, the thread lives on the order page itself (see /orders/[id]).
    // A merchant has no per-order detail page of their own, only the queue.
    if (surface === "merchant") {
      router.push("/merchant/orders");
    } else if (n.data?.order_id) {
      router.push(`/orders/${n.data.order_id}`);
    }
  }

  async function markAllRead() {
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    setItems((prev) => prev?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null);
    setUnreadCount(0);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={togglePanel}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className={cn("relative grid size-10 place-items-center rounded-pill hover:bg-surface-raised", buttonClassName)}
      >
        <Bell aria-hidden className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-pill bg-danger text-[0.625rem] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-md border border-line bg-card shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-bold">Notifications</p>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-semibold text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-fg-muted">Loading...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-fg-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(n)}
                      className={cn(
                        "w-full px-4 py-3 text-left hover:bg-surface-raised",
                        !n.read_at && "bg-coral-tint/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{n.title}</p>
                        {!n.read_at && <span aria-hidden className="mt-1 size-2 shrink-0 rounded-pill bg-primary" />}
                      </div>
                      {n.body && <p className="mt-0.5 text-xs text-fg-muted">{n.body}</p>}
                      <p className="mt-1 text-xs text-fg-muted">{formatRelative(n.created_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
