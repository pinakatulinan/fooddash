"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { ChevronsRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A "slide to confirm" submit control.
 *
 * It is still a real `<button type="submit">` underneath - a plain tap or
 * Enter key submits exactly like any other button, so a keyboard user or
 * screen reader loses nothing. The drag is a bonus interaction layered on
 * top, not the only way in: dragging the handle past ~70% of the track
 * calls `form.requestSubmit()` directly, since the browser suppresses the
 * native click event once the pointer has moved this far between down and
 * up - that is what stops a completed drag from also firing a second,
 * native submit.
 */
export function SwipeButton({
  label,
  pendingLabel = "Please wait…",
  className,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const trackRef = React.useRef<HTMLButtonElement>(null);
  const [dragX, setDragX] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const startXRef = React.useRef(0);
  const maxDragRef = React.useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (pending) return;
    const track = trackRef.current;
    if (!track) return;
    maxDragRef.current = track.getBoundingClientRect().width - 48 - 8; // handle size + track padding
    startXRef.current = e.clientX - dragX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = Math.min(Math.max(0, e.clientX - startXRef.current), maxDragRef.current);
    setDragX(next);
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (maxDragRef.current > 0 && dragX >= maxDragRef.current * 0.7) {
      setDragX(maxDragRef.current);
      trackRef.current?.closest("form")?.requestSubmit();
    } else {
      setDragX(0);
    }
  }

  return (
    <button
      ref={trackRef}
      type="submit"
      disabled={pending}
      className={cn(
        "relative h-14 w-full rounded-pill bg-primary p-1 text-primary-fg",
        "disabled:opacity-70",
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-0 grid place-items-center text-base font-bold">
        {pending ? pendingLabel : label}
      </span>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
        }}
        className="relative grid size-12 shrink-0 touch-none place-items-center rounded-pill bg-card text-primary shadow-card"
      >
        {pending ? (
          <Loader2 aria-hidden className="size-5 animate-spin" />
        ) : (
          <ChevronsRight aria-hidden className="size-5" />
        )}
      </div>
    </button>
  );
}
