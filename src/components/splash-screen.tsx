"use client";

import * as React from "react";

const SESSION_KEY = "fd-splash-shown";
const FADE_MS = 500;
// Backstop only - normally the video's own `onEnded` event drives the
// timing. Without this, a video that fails to fire `ended` (autoplay
// silently blocked, an unsupported codec that errors after decode starts
// rather than before) would leave the splash on screen forever. Set
// comfortably above the clip's own ~7.5s length - it must never fire during
// a normal, successful play-through.
const MAX_VISIBLE_MS = 12_000;

/**
 * A branded launch screen, not a loading gate - it never waits on data, it
 * just plays the logo animation once before the real app appears, the way a
 * native app's splash does. Rendered once per browser tab (sessionStorage),
 * not on every internal navigation - re-showing it on every Link tap would
 * turn a nice touch into an obstacle.
 */
export function SplashScreen() {
  const [phase, setPhase] = React.useState<"hidden" | "visible" | "leaving">("hidden");
  // startTransition rather than a bare setState call - see basket-bar.tsx
  // for the same escape hatch. It also happens to be exactly right here for
  // another reason: `phase` must start "hidden" on both the server render
  // and the client's first render (sessionStorage does not exist on the
  // server, and disagreeing between the two is a hydration mismatch), so
  // the flip to "visible" can only ever happen after mount, in an effect.
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
      // Private browsing / storage blocked - fail open by not showing at
      // all, rather than risk it getting stuck on screen with no way to
      // dismiss it if a later write also fails.
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
      className={`fixed inset-0 z-50 grid place-items-center bg-card transition-opacity duration-500 ease-out ${
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/*
        Back to the plain MP4 only. A WebM/VP9-alpha version was tried here,
        but alpha support in WebM is a mostly-Chrome feature - tested for
        real in Messenger's in-app browser (WebKit-based, like a lot of
        mobile in-app browsers) and it decoded the clip fine but ignored the
        alpha channel outright, showing the raw colour plane underneath -
        which export tools fill with a neutral grey in the "invisible" areas,
        since that colour is only ever meant to be seen through the alpha
        mask. Rendered without alpha, that fill becomes a visible grey box.
        Not safe to rely on for an audience that includes in-app browsers.

        So: plain MP4 (H.264 has no alpha channel at all), exported with a
        white background baked into every frame, and the backdrop below
        matched to that same white to make the "box" disappear by matching
        it rather than trying to mask it. White is also the one colour that
        does not fight either half of the two-tone wordmark - a coral ground
        washes out "Dash", a mint one would do the same to "Food".

        The clip is trimmed to just after the dash - the orange D has fully
        left frame and only its fading trail remains - rather than mid-flight,
        so the exit fade starts from an already-calm frame instead of one
        caught mid-motion, which read as the animation freezing.

        bg-transparent on the element itself: a <video> renders solid black
        until its first frame is actually decoded, so without this there's a
        brief black box visible in the instant between mount and playback
        starting, even though the clip's own content is white throughout.
      */}
      <video
        className="w-80 max-w-[80vw] bg-transparent"
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
