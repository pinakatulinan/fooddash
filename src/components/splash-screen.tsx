"use client";

import * as React from "react";

const SESSION_KEY = "fd-splash-shown";
const FADE_MS = 500;
const MAX_VISIBLE_MS = 12_000;
// Sampled directly from the baked-in background of /brand/logo-animation.mp4
// (averaged across ~1,400 background pixels, first/mid/last frame). It is
// NOT pure white - #F4F3EF, a warm off-white. Any other value here,
// including a "looks white" semantic token like bg-card, will show a
// visible seam around the video's rectangle (confirmed: pure white showed
// the video's own box as a visible grey rectangle).
const SPLASH_BG = "#F4F3EF";

export function SplashScreen() {
  const [phase, setPhase] = React.useState<"hidden" | "visible" | "leaving">(
    "hidden",
  );
  const [, startTransition] = React.useTransition();

  const leave = React.useCallback(() => {
    setPhase((p) => (p === "visible" ? "leaving" : p));
    window.setTimeout(() => setPhase("hidden"), FADE_MS);
  }, []);

  React.useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      return;
    }

    startTransition(() => setPhase("visible"));

    const maxTimer = window.setTimeout(leave, MAX_VISIBLE_MS);
    return () => window.clearTimeout(maxTimer);
  }, [startTransition, leave]);

  if (phase === "hidden") return null;

  return (
    <div
      aria-hidden
      style={{ backgroundColor: SPLASH_BG }}
      className={`fixed inset-0 z-50 grid place-items-center transition-opacity duration-500 ease-out ${
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <video
        className="w-80 max-w-[80vw]"
        style={{ backgroundColor: SPLASH_BG }}
        src="/brand/logo-animation.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={leave}
        onError={leave}
      />
    </div>
  );
}
