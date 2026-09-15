import { cn } from "@/lib/utils";

/**
 * The FoodDash logo.
 *
 * Both artworks are always in the DOM and CSS decides which one is visible, so
 * the correct variant paints on the first frame. Choosing in JavaScript means
 * the wrong logo flashes on every load before hydration - a small thing that
 * makes a product feel unfinished.
 *
 * Swapping in the final artwork is a file replacement, not a code change:
 *   public/brand/fooddash-light.svg   full lockup on light grounds
 *   public/brand/fooddash-dark.svg    full lockup on dark grounds
 *   public/brand/fooddash-mark.svg    icon only, monochrome-safe both ways
 */

type LogoVariant = "full" | "mark";

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
  const aspect = variant === "full" ? 428 / 200 : 210 / 200;
  const width = Math.round(height * aspect);

  if (variant === "mark") {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src="/brand/fooddash-mark.svg"
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
        src="/brand/fooddash-light.svg"
        alt={alt}
        width={width}
        height={height}
        className="fd-logo-light block"
        style={{ height, width: "auto" }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/fooddash-dark.svg"
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
