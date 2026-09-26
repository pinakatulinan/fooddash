"use client";

import * as React from "react";
import { ArrowLeft, Search } from "lucide-react";

/**
 * The search page's own search bar: an icon-led pill with no separate submit
 * button - Enter (or the keyboard's own search action) submits the
 * surrounding GET form the same as before.
 *
 * Focusing the input reveals a leading back arrow whose only job is to blur
 * the input and drop the on-screen keyboard - it does not navigate anywhere,
 * so it is a button, not a link. The mousedown handler is the load-bearing
 * part: without preventDefault() there, the browser blurs the input (and
 * this component hides the arrow) before the click on it is ever registered.
 */
export function SearchBar({ defaultValue }: { defaultValue: string }) {
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <form action="/search" method="get" className="flex items-center gap-1">
      {focused && (
        <button
          type="button"
          aria-label="Dismiss keyboard"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.blur()}
          className="grid size-10 shrink-0 place-items-center rounded-pill hover:bg-white/15"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
      )}

      <label htmlFor="q" className="sr-only">
        Search for a store or a dish
      </label>
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-fg-muted"
        />
        <input
          ref={inputRef}
          id="q"
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder="Try “adobo”, “coffee”, “silog”"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-12 w-full rounded-pill border border-line bg-card pl-11 pr-4 text-base text-fg placeholder:text-fg-muted focus-visible:border-primary"
        />
      </div>
    </form>
  );
}
