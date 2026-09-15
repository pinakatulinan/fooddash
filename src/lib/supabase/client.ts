"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * Browser client. Carries the signed-in user's JWT, so every query it makes is
 * evaluated against the RLS policies in migration 0009 - which is the point.
 * There is nothing this client can read that the policies do not already allow,
 * so the anon key being public is not a leak.
 *
 * Memoised: @supabase/ssr expects one browser client per document, and creating
 * a second one opens a second realtime socket.
 */
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (!browserClient) {
    const { url, anonKey } = requireSupabaseEnv();
    const client = createBrowserClient(url, anonKey);
    browserClient = client;

    // @supabase/ssr loads an existing cookie-based session on mount without
    // going through the interactive sign-in flow that normally drives
    // Realtime's own auth wiring - so this socket can stay authenticated as
    // the anon key even though every other request on this client carries
    // the real user's JWT. Realtime enforces RLS per-connection (0010), so an
    // un-set token means every row-level check it runs silently evaluates
    // auth.uid() as null: a subscription connects and reports SUBSCRIBED
    // normally, and then never delivers a single row it was not already
    // entitled to see as anon. Set the token explicitly once now, and again
    // on every refresh, sign-in or sign-out.
    client.auth.getSession().then(({ data: { session } }) => {
      client.realtime.setAuth(session?.access_token ?? anonKey);
    });
    client.auth.onAuthStateChange((_event, session) => {
      client.realtime.setAuth(session?.access_token ?? anonKey);
    });
  }
  return browserClient;
}
