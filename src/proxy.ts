import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Session refresh plus role-based routing.
 *
 * This is UX, not security. It sends people to the right place and keeps the
 * wrong surface from flashing on screen. The actual boundary is RLS: if this
 * file were deleted entirely, a rider still could not read another rider's
 * assignments, because the database would not return the rows.
 */

/** Which platform roles may enter which section. */
const AREA_ROLES: Record<string, readonly string[]> = {
  "/merchant": ["merchant", "admin", "support"],
  "/rider": ["rider", "admin", "support"],
  "/admin": ["admin", "support"],
};

/** Signed-in routes that any role may use. */
const AUTHED_PREFIXES = ["/account", "/cart", "/checkout", "/orders", "/reset-password", "/mfa-challenge"];

/** Where each role belongs when they land somewhere they should not be. */
const HOME_FOR_ROLE: Record<string, string> = {
  merchant: "/merchant",
  rider: "/rider",
  admin: "/admin",
  support: "/admin",
  customer: "/",
};

export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  const area = Object.keys(AREA_ROLES).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const needsAuth =
    Boolean(area) || AUTHED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (needsAuth && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Round-trip the destination so signing in resumes what they were doing,
    // rather than dumping everyone on the home page.
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(login);
  }

  if (area && user && !AREA_ROLES[area].includes(role ?? "")) {
    const home = request.nextUrl.clone();
    home.pathname = HOME_FOR_ROLE[role ?? "customer"] ?? "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  // Already signed in? The login screen has nothing to offer.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const home = request.nextUrl.clone();
    home.pathname = HOME_FOR_ROLE[role ?? "customer"] ?? "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The session refresh has
     * to run on real navigations, not on every icon request.
     */
    "/((?!_next/static|_next/image|favicon.ico|brand/|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
