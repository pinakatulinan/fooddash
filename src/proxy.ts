import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Session refresh plus role-based routing.
 *
 * This is UX, not security. It sends people to the right place and keeps the
 * wrong surface from flashing on screen. The actual boundary is RLS: if this
 * file were deleted entirely, a rider still could not read another rider's
 * assignments, because the database would not return the rows.
 *
 * Default-deny, not default-allow: PUBLIC_PREFIXES is the exception list, not
 * AUTHED_PREFIXES - a route nobody remembers to add here lands as protected,
 * not as a silent gap. (An earlier version of this file inverted that: a new
 * route added to the app but forgotten here defaulted to public. RLS still
 * would have blocked any real data access, but the page chrome itself would
 * have rendered for a signed-out visitor with no redirect at all.)
 */

/** Which platform roles may enter which section. */
const AREA_ROLES: Record<string, readonly string[]> = {
  "/merchant": ["merchant", "admin", "support"],
  "/rider": ["rider", "admin", "support"],
  "/admin": ["admin", "support"],
};

/** Everything reachable signed out. Exact "/" only matches the home page
    itself, not every path (every path starts with "/"), so it is checked
    separately rather than folded into the prefix list below. */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/search",
  "/store",
  "/privacy",
  "/terms",
  "/auth", // /auth/callback - the OAuth/magic-link landing point, hit signed out by definition
  // The favorites page handles its own signed-out state (a "sign in to save
  // favorites" prompt) rather than being redirect-gated, same as Discover.
  "/favorites",
];

/** Where each role belongs when they land somewhere they should not be. */
const HOME_FOR_ROLE: Record<string, string> = {
  merchant: "/merchant",
  rider: "/rider",
  admin: "/admin",
  support: "/admin",
  customer: "/",
};

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { response, user, role } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // API routes answer with JSON and already check their own auth
  // (getUser()/a shared secret/a webhook signature, per route) - redirecting
  // one to the HTML /login page instead of a 401 would break every caller
  // expecting JSON back. Session refresh above still runs for them; only the
  // page-routing logic below is skipped.
  if (pathname.startsWith("/api/")) {
    return response;
  }

  const area = Object.keys(AREA_ROLES).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const needsAuth = !isPublicPath(pathname);

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
