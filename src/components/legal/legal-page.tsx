import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/**
 * Shared chrome for the terms/privacy pages - the actual legal content is
 * plain semantic HTML written directly in each page (h2/p/ul), not driven
 * off a shared "sections" data shape. Two pages sharing a rendering layer
 * for that little content would be the abstraction, not a simplification.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** "September 23, 2026" - already formatted, not a raw ISO date. */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg">
          <ArrowLeft aria-hidden className="size-4" /> Back to FoodDash
        </Link>

        <Logo height={40} className="mt-6 mb-8" />

        <h1 className="text-2xl font-extrabold tracking-tight text-balance">{title}</h1>
        <p className="mt-1 text-sm text-fg-muted">Last updated {updated}</p>

        <div className="mt-8 space-y-8">{children}</div>
      </div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold tracking-tight">{heading}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}
