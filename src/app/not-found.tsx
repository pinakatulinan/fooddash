import { Logo } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/button";

/**
 * Branded 404. Next's default is an unstyled white page that reads as "the
 * app is broken" rather than "that address does not exist".
 */
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-6 py-16">
      <div className="w-full max-w-md text-center">
        <Logo height={32} className="mx-auto mb-10" />

        <p className="font-mono text-sm font-bold tracking-[0.2em] text-fg-muted uppercase">
          404
        </p>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-balance">
          We could not find that page
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          The link may be out of date, or the address may have a typo in it.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton href="/">Back to browsing</LinkButton>
          <LinkButton href="/orders" variant="secondary">Your orders</LinkButton>
        </div>
      </div>
    </div>
  );
}
