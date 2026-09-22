import { cn } from "@/lib/utils";

/**
 * The FoodDash logo.
 *
 * Both artworks are always in the DOM and CSS decides which one is visible, so
 * the correct variant paints on the first frame. Choosing in JavaScript means
 * the wrong logo flashes on every load before hydration - a small thing that
 * makes a product feel unfinished.
 *
 * Swapping in updated artwork is a file replacement, not a code change:
 *   public/brand/fooddash-light.png   full lockup on light grounds
 *   public/brand/fooddash-dark.png    full lockup on dark grounds
 *   public/brand/fooddash-mark.png    icon only, square canvas
 * The light/dark PNGs ship with their original flat background chroma-keyed
 * out to transparency (they came in as flat-background exports, not
 * transparent assets) - a new drop-in should be transparent PNG or SVG
 * already, no further processing needed.
 */

type LogoVariant = "full" | "mark";

/** Must match the actual pixel aspect ratio of fooddash-light.png /
 * fooddash-dark.png - it is how the rendered width is derived from a given
 * height. */
const LOGO_ASPECT = 2138 / 1000;
const MARK_ASPECT = 1; // fooddash-mark.png is a square canvas.

interface LogoProps {
  variant?: LogoVariant;
  /** Rendered height in pixels. Width follows the artwork's aspect ratio. */
  height?: number;
  className?: string;
  /** Set on a decorative logo that sits next to a visible "FoodDash" heading. */
  decorative?: boolean;
}

export function Logo({
  variant = "full",
  height = 32,
  className,
  decorative = false,
}: LogoProps) {
  const alt = decorative ? "" : "FoodDash";
  const aspect = variant === "full" ? LOGO_ASPECT : MARK_ASPECT;
  const width = Math.round(height * aspect);

  if (variant === "mark") {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src="/brand/fooddash-mark.png"
        alt={alt}
        width={width}
        height={height}
        className={cn("block", className)}
        style={{ height, width: "auto" }}
      />
    );
  }

  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fooddash-light.png"
        alt={alt}
        width={width}
        height={height}
        className="fd-logo-light block"
        style={{ height, width: "auto" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fooddash-dark.png"
        alt={decorative ? "" : alt}
        aria-hidden={decorative ? true : undefined}
        width={width}
        height={height}
        className="fd-logo-dark block"
        style={{ height, width: "auto" }}
      />
    </span>
  );
}
