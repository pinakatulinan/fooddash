"use client";

import * as React from "react";
import { MapPinOff } from "lucide-react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

const PING_INTERVAL_MS = 10_000;

/**
 * Renders nothing but a permission warning when needed. Mounted once in the
 * rider layout, so it stays alive across every rider page.
 *
 * This is the missing half of `record_rider_ping` (0008): the RPC existed,
 * but nothing ever called it, so `riders.last_ping_at` only ever moved when
 * someone wrote it by hand. `dispatch_candidates` (0008) treats any rider
 * quiet for more than two minutes as not really online, so without this a
 * rider can be "online_idle" and still never receive a single offer - auto
 * or manual - no matter where they physically are.
 *
 * Only pings while `riders.status` is not 'offline' - tracked live via
 * Realtime rather than a prop, since `AvailabilityToggle` lives on a
 * different page and the two never share React state. Deliberately polls on
 * a fixed interval rather than `watchPosition`, which fires far more often
 * than dispatch needs (multiple times a second while driving on some
 * devices) for a value that is only ever read on a ~15-second cron sweep.
 */
export function RiderLocationTracker() {
  const [online, setOnline] = React.useState(false);
  const [permissionDenied, setPermissionDenied] = React.useState(false);

  React.useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function connect() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      const { data: rider } = await supabase.from("riders").select("status").eq("id", user.id).maybeSingle();
      if (cancelled) return;
      setOnline((rider?.status ?? "offline") !== "offline");

      // Same startup-race fix as RealtimeRefresh: set the socket's auth
      // explicitly before subscribing, rather than relying on the client-wide
      // getSession() call to have already finished.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`rider-own-status:${user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "riders", filter: `id=eq.${user.id}` },
          (payload: RealtimePostgresChangesPayload<{ status: string }>) =>
            setOnline((payload.new as { status: string }).status !== "offline"),
        )
        .subscribe();
    }

    connect();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  React.useEffect(() => {
    if (!online || typeof navigator === "undefined" || !navigator.geolocation) return;

    const supabase = createClient();
    let cancelled = false;

    async function ping() {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;

          // Re-read on every tick rather than caching it: a rider can accept
          // a new delivery at any point in this interval, and rider_pings'
          // trail (and the customer's live tracking map) both key off which
          // order a ping belongs to.
          const { data: assignment } = await supabase
            .from("delivery_assignments")
            .select("order_id")
            .eq("status", "accepted")
            .order("offered_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cancelled) return;

          const { error } = await supabase.rpc("record_rider_ping", {
            p_lat: pos.coords.latitude,
            p_lng: pos.coords.longitude,
            p_order_id: assignment?.order_id ?? null,
            p_heading: pos.coords.heading,
            p_speed_kph: pos.coords.speed != null ? pos.coords.speed * 3.6 : null,
            p_accuracy_m: pos.coords.accuracy,
          });
          if (!cancelled && !error) setPermissionDenied(false);
        },
        (err) => {
          if (!cancelled && err.code === err.PERMISSION_DENIED) setPermissionDenied(true);
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
      );
    }

    ping();
    const interval = window.setInterval(ping, PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [online]);

  if (!online || !permissionDenied) return null;

  return (
    <div role="alert" className="mx-4 mt-4 flex items-start gap-2 rounded-md border border-warning bg-warning-tint px-4 py-3">
      <MapPinOff aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-sm text-warning">
        Location access is blocked, so dispatch cannot see you. Enable location for this site in your browser
        settings to receive offers.
      </p>
    </div>
  );
}
