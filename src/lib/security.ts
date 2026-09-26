import crypto from "node:crypto";

/**
 * Constant-time comparison for a caller-supplied secret (a header, typically)
 * against the real one. A plain `===` leaks how many leading bytes matched
 * through response timing - a small signal, but one nobody needs to give
 * away on an endpoint that exists specifically to gate a privileged action.
 */
export function timingSafeEqualString(a: string | null, b: string): boolean {
  if (a === null) return false;

  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  // timingSafeEqual throws on a length mismatch rather than returning false,
  // and comparing against a wrong-length buffer would itself leak length via
  // the exception - pad to equal length so every mismatch takes the same path.
  if (aBuffer.length !== bBuffer.length) {
    crypto.timingSafeEqual(aBuffer, aBuffer);
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Origin check for a cookie-authenticated Route Handler. `SameSite=Lax` on
 * the Supabase session cookie (the @supabase/ssr default) already stops a
 * plain cross-site form POST from carrying it, but this is the same defence
 * request.formData()-based Server Actions get built in - a Route Handler
 * doesn't get that for free, and this one moves money (create-checkout), so
 * it gets it explicitly.
 *
 * Compared against the request's own Host header, not a configured site
 * URL: this app is routinely opened from more than one origin for the same
 * running server - localhost during desktop dev, a LAN IP from a phone on
 * the same Wi-Fi, or a tunnel URL while testing a webhook - and every one
 * of those is legitimately "same origin" relative to itself. A request with
 * no Origin header at all is refused: every same-origin fetch() this app
 * makes to its own POST routes sends one, so a missing header only happens
 * for a request this endpoint never expects in the first place.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
