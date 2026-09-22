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
      <LoginForm next={next ?? ""} />

      <p className="mt-6 text-center text-sm text-fg-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-semibold text-primary underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </>
  );
}
