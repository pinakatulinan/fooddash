import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Text input and its label/error scaffolding.
 *
 * The error is wired with aria-describedby and aria-invalid rather than being
 * red text that happens to sit underneath - on a phone, the field is often
 * scrolled out of view by the keyboard, and a screen reader user gets nothing
 * from proximity.
 *
 * Font size is 16px on purpose: iOS Safari zooms the whole viewport when a
 * focused input is smaller, and the page never zooms back out.
 */

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined }) => React.ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
        {required && (
          <span className="text-danger ml-0.5" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {children({ id, describedBy })}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "w-full h-11 px-3.5 text-base bg-card text-fg",
      "border border-line rounded-md",
      "placeholder:text-fg-muted",
      "disabled:opacity-60 disabled:bg-surface",
      invalid && "border-danger",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "w-full min-h-24 px-3.5 py-2.5 text-base bg-card text-fg",
      "border border-line rounded-md resize-y",
      "placeholder:text-fg-muted",
      invalid && "border-danger",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
