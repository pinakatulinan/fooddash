import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-fg-muted">
        One account, three ways to use FoodDash.
      </p>

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
