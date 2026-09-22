import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <SignupForm />

      <p className="mt-6 text-center text-sm text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </>
  );
}
