/**
 * Formatting helpers.
 *
 * Money is integer centavos everywhere - in the database, over the wire, and
 * in component props. It becomes a decimal string exactly once, here, at the
 * moment it is rendered. Nothing in this codebase does arithmetic on pesos.
 */

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

/** 12000 -> "₱120.00" */
export function formatCentavos(centavos: number | null | undefined): string {
  return peso.format((centavos ?? 0) / 100);
}

/** 12000 -> "₱120" when whole, "₱120.50" when not. For dense lists. */
export function formatCentavosCompact(centavos: number | null | undefined): string {
  const value = (centavos ?? 0) / 100;
  return Number.isInteger(value)
    ? `₱${value.toLocaleString("en-PH")}`
    : peso.format(value);
}

/** Signed, for option price deltas: "+₱30.00", "−₱15.00", or "" for zero. */
export function formatDelta(centavos: number): string {
  if (centavos === 0) return "";
  const sign = centavos > 0 ? "+" : "−";
  return `${sign}${formatCentavos(Math.abs(centavos))}`;
}

/** 1450 -> "1.5 km", 320 -> "320 m" */
export function formatDistance(metres: number | null | undefined): string {
  if (metres == null) return "—";
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** Minutes as a delivery promise: always a range, never a false precision. */
export function formatEta(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const low = Math.max(5, Math.round(minutes / 5) * 5 - 5);
  return `${low}–${low + 10} min`;
}

/** "2 min ago", "in 12 min", "now" - for order timelines and offer countdowns. */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const deltaSeconds = Math.round((then.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(deltaSeconds);

  if (absolute < 45) return "now";

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, seconds] of units) {
    if (absolute >= seconds) return rtf.format(Math.round(deltaSeconds / seconds), unit);
  }
  return rtf.format(deltaSeconds, "second");
}

/** Today's calendar date in Manila as YYYY-MM-DD, for date inputs' min/max. */
export function manilaTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

/** The latest birthdate that is still 18 or older today (YYYY-MM-DD). */
export function latestAdultBirthdateISO(): string {
  const [y, m, d] = manilaTodayISO().split("-");
  // A Feb 29 today has no Feb 29 eighteen years back.
  const day = m === "02" && d === "29" ? "28" : d;
  return `${Number(y) - 18}-${m}-${day}`;
}

/** Wall-clock time in Manila, regardless of where the viewer is. */
export function formatManilaTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function formatManilaDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(date);
}

/**
 * PH mobile numbers arrive as 09171234567, 639171234567, +63 917 123 4567.
 * The database stores exactly one shape (+639171234567); this is the funnel.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return null;
}

/** +639171234567 -> "0917 123 4567", which is how Filipinos read it back. */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const local = e164.replace(/^\+63/, "0");
  return local.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3");
}
