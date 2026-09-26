import type { NextConfig } from "next";

/**
 * The Supabase project URL is needed twice below (https for REST/RPC, wss
 * for Realtime) - read once here rather than typing the project ref itself
 * into the CSP, which would silently go stale against a different project.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^http/, "ws");

/**
 * script-src and style-src keep 'unsafe-inline' rather than a nonce-based
 * policy. A nonce needs to be minted per-request in middleware and threaded
 * through to every inline <script>/<style> Next.js itself emits for
 * hydration - the safer failure mode here is a CSP that under-protects
 * against inline-script XSS (a vulnerability class this codebase's plain
 * React rendering with no dangerouslySetInnerHTML already avoids) rather
 * than one that silently breaks hydration app-wide with no way to see the
 * blank page it produces from here.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://api.paymongo.com https://*.basemaps.cartocdn.com`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Forces every subresource to HTTPS - correct once this is actually
  // deployed behind TLS, but the dev server only ever speaks plain HTTP.
  // Chrome exempts `localhost` from the upgrade so this never showed up
  // testing there, but a phone hitting the LAN IP (a plain http:// origin
  // with no such exemption) had every CSS/JS chunk silently upgraded to an
  // https:// URL this dev server doesn't serve, breaking everything past
  // the initial HTML.
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
]
  .join("; ")
  .trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Belt-and-suspenders with frame-ancestors above for browsers that only
  // understand the older header.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Ignored over plain HTTP (local dev), applied once actually served over
  // HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Riders and the checkout address picker both use real geolocation;
  // everything else this app never touches (camera, microphone, USB, the
  // Payment Request API - unrelated to PayMongo, which is a redirect, not
  // that browser API).
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
