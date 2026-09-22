import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <ForgotPasswordForm />

      <p className="mt-6 text-center text-sm text-fg-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-primary underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
