import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Customers, stores and riders all sign in here — you land on the right screen
        automatically.
      </p>

      <LoginForm next={next ?? ""} />

      <p className="mt-6 text-center text-sm text-fg-muted">
        New to FoodDash?{" "}
        <Link href="/signup" className="font-semibold text-primary underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </>
  );
}
