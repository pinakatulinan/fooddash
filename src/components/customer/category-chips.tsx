"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky category jump bar for the store page. Tapping a chip scrolls its
 * section into view; an IntersectionObserver watching those same sections
 * keeps the chip in sync the other way, while scrolling freely.
 *
 * `scrollIntoView({behavior:"smooth"})` already respects prefers-reduced-
 * motion for free - globals.css forces `scroll-behavior: auto !important`
 * on every element under that media query, which browsers honour for a
 * smooth scrollIntoView call too, not just CSS-triggered scrolling.
 */
export function CategoryChips({ categories }: { categories: { id: string; name: string }[] }) {
  const [activeId, setActiveId] = React.useState(categories[0]?.id);

  React.useEffect(() => {
    const sections = categories
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el != null);
    if (sections.length === 0) return;

    // A section counts as "current" once it's crossed into the top ~30% of
    // the viewport (below the sticky chip bar) and hasn't yet scrolled past
    // the bottom 30% - roughly "the section your eye is actually reading."
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length > 0) {
          setActiveId(intersecting[0].target.id);
        }
      },
      { rootMargin: "-120px 0px -70% 0px", threshold: 0 },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [categories]);

  if (categories.length <= 1) return null;

  return (
    <div
      className="sticky top-0 z-20 -mx-5 flex gap-2 overflow-x-auto bg-bg-subtle px-5 py-3"
      role="tablist"
      aria-label="Jump to menu section"
    >
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={activeId === c.id}
          onClick={() => document.getElementById(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className={cn(
            "shrink-0 rounded-full px-4 py-2 text-[13px] transition-colors",
            activeId === c.id ? "bg-fg font-semibold text-white" : "bg-card font-medium",
          )}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
