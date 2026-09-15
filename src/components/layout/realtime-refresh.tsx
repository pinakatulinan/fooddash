"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Renders nothing. Subscribes to one Postgres table (optionally narrowed by
 * a `column=eq.value`-style filter) and calls router.refresh() whenever a
 * matching row changes, so a Server Component page picks up someone else's
 * write without the viewer doing anything.
 *
 * This is the missing half of migration 0010: four tables (later seven) were
 * published to Realtime specifically for "the rider's incoming-offer alert,"
 * "the customer tracking screen," "the merchant board," but nothing ever
 * subscribed - every page only ever refreshed itself after the *viewer's
 * own* action. A rider waiting for an offer, or a customer waiting for
 * "picked up," saw nothing until they manually reloaded.
 *
 * Realtime enforces RLS itself (0010's own comment), so `filter` here is an
 * optimisation - narrowing which changes even reach the browser - not the
 * access boundary; a subscriber never receives a row their policies already
 * would not let them select.
 *
 * One instance per (table, filter) pair. A page that needs to watch two
 * tables mounts two of these rather than one instance juggling both, so
 * each stays a single subscription with a single job.
 */
export function RealtimeRefresh({ table, filter }: { table: string; filter?: string }) {
  const router = useRouter();

  React.useEffect(() => {
    const supabase = createClient();
    const debounce = { timer: 0 };
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function connect() {
      // @supabase/ssr loads an existing cookie session without the
      // interactive sign-in flow that normally drives Realtime's own auth
      // wiring, so this socket can still be authenticated as the anon key
      // the first time anything subscribes on it. Setting the token is
      // normally handled once, client-wide (see lib/supabase/client.ts) -
      // awaiting it again here, synchronously before this specific
      // subscribe(), closes the startup race where a page's first mount
      // calls subscribe() before that client-wide fix has finished
      // resolving its own getSession() call.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`refresh:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter },
          () => {
            window.clearTimeout(debounce.timer);
            // A burst of related writes (an order update plus the
            // order_event it triggers) should cost one refresh, not one per
            // row.
            debounce.timer = window.setTimeout(() => router.refresh(), 300);
          },
        )
        .subscribe();
    }

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(debounce.timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [table, filter, router]);

  return null;
}
