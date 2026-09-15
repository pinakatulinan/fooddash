import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      {/* The coral band gives the auth screens the same first impression as the
          rest of the app, without putting text on a pastel that cannot carry it. */}
      <div className="bg-header">
        <div className="mx-auto flex max-w-md items-center justify-between px-6 py-6">
          <Link href="/" aria-label="FoodDash home">
            <Logo height={28} />
          </Link>
        </div>
      </div>

      <main id="main" className="mx-auto w-full max-w-md px-6 py-10">
        {children}
      </main>
    </div>
  );
}
