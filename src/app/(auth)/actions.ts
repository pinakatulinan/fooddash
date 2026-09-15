"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/lib/format";

export interface AuthState {
  error: string | null;
  notice?: string | null;
}

/** Where a role lands after signing in. Mirrors HOME_FOR_ROLE in middleware.ts. */
const HOME_FOR_ROLE: Record<string, string> = {
  merchant: "/merchant",
  rider: "/rider",
  admin: "/admin",
  support: "/admin",
  customer: "/",
};

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately vague. Distinguishing "no such account" from "wrong
    // password" turns the login form into an account-enumeration oracle.
    return { error: "That email and password do not match an account." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_blocked")
    .eq("id", data.user.id)
    .single();

  if (profile?.is_blocked) {
    await supabase.auth.signOut();
    return { error: "This account has been suspended. Contact support." };
  }

  revalidatePath("/", "layout");
  redirect(next || HOME_FOR_ROLE[profile?.role ?? "customer"] || "/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "customer");

  if (!fullName) return { error: "Enter your name." };
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };

  const phone = rawPhone ? normalisePhone(rawPhone) : null;
  if (rawPhone && !phone) {
    return { error: "That does not look like a Philippine mobile number." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // handle_new_user() reads this metadata to build the profile row. It
      // honours only customer/merchant/rider - asking for 'admin' here does
      // nothing, by design.
      data: { full_name: fullName, phone, role },
    },
  });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return {
    error: null,
    notice: "Account created. Check your email to confirm, then sign in.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
