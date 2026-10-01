"use client";

import * as React from "react";

const SIZE = 56;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Purely cosmetic - ticks its own clock to redraw the arc and the mm:ss
 * label, but never decides anything. `respond_to_assignment` re-checks the
 * offer's expiry server-side regardless, so a client clock running a second
 * fast or slow never lets a stale offer through.
 */
export function OfferCountdownRing({ offeredAt, expiresAt }: { offeredAt: string; expiresAt: string }) {
  const total = Math.max(1, new Date(expiresAt).getTime() - new Date(offeredAt).getTime());
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  const fraction = Math.min(1, remainingMs / total);
  const mm = Math.floor(remainingMs / 60000);
  const ss = Math.floor((remainingMs % 60000) / 1000);

  return (
    <div className="relative grid size-14 shrink-0 place-items-center">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--line-warm)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <span className="text-[13px] font-bold tabular-nums">
        {mm}:{String(ss).padStart(2, "0")}
      </span>
    </div>
  );
}
