import { BottomNav } from "@/components/layout/app-nav";
import { RiderLocationTracker } from "@/components/rider/location-tracker";

/**
 * The rider surface is mobile-only by design - it is used on a phone mounted
 * on a handlebar or held at a gate, never on a desktop. So there is no
 * sidebar, and the content column is capped at phone width even on a laptop
 * so testing on a big screen shows the real thing.
 */
export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-subtle">
      <RiderLocationTracker />
      <main id="main" className="mx-auto w-full max-w-lg pb-24">
        {children}
      </main>
      <BottomNav surface="rider" />
    </div>
  );
}
