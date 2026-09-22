import crypto from "node:crypto";

/**
 * PayMongo signs each webhook delivery via the Paymongo-Signature header as
 * `t=<unix-timestamp>,te=<test-secret-hmac>,li=<live-secret-hmac>`, each an
 * HMAC-SHA256 over `${timestamp}.${rawBody}`. Only one of te/li verifies
 * against any given endpoint's signing secret, depending on whether that
 * secret is a test or live key - both are checked here and either match is
 * accepted, so this works unmodified whichever mode PAYMONGO_WEBHOOK_SECRET
 * is for.
 *
 * No `server-only` guard: unlike createCheckoutSession (paymongo.ts), this
 * takes the secret as a parameter rather than reading it from the
 * environment, so it carries nothing that must not reach a client bundle -
 * keeping it in its own file just means it can also be imported straight
 * into a test.
 */
export function verifyPaymongoSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;

  const parts = new Map<string, string>();
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) parts.set(key.trim(), value.trim());
  }

  const timestamp = parts.get("t");
  const candidates = [parts.get("te"), parts.get("li")].filter((v): v is string => Boolean(v));
  if (!timestamp || candidates.length === 0) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return candidates.some((candidate) => {
    let candidateBuffer: Buffer;
    try {
      candidateBuffer = Buffer.from(candidate, "hex");
    } catch {
      return false;
    }
    return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}
