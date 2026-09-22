import { Logo } from "@/components/brand/logo";

/**
 * Shown instead of data when Supabase credentials are missing.
 *
 * A new developer cloning this repo hits this screen rather than a stack
 * trace, and it tells them exactly which four commands to run. Worth the
 * fifty lines.
 */
export function SetupNotice() {
  const steps = [
    ["Create a project", "supabase.com/dashboard — pick the Singapore region for PH latency."],
    ["Copy the env file", "cp .env.example .env.local, then paste in your project URL and keys."],
    ["Push the schema", "npm run db:push (hosted) or npm run db:start && npm run db:reset (local)."],
    ["Generate types", "npm run db:types — replaces the hand-written types in src/lib/types."],
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <Logo height={65} className="mb-8" />
      <h1 className="text-2xl font-extrabold tracking-tight">Connect a Supabase project</h1>
      <p className="mt-2 text-sm text-fg-muted">
        The app is running, but it has nowhere to read data from yet. Four steps and it will
        be live.
      </p>

      <ol className="mt-8 space-y-5">
        {steps.map(([title, detail], index) => (
          <li key={title} className="flex gap-4">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-pill bg-header text-sm font-bold text-header-fg"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{title}</p>
              <p className="mt-0.5 font-mono text-xs break-words text-fg-muted">{detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-10 rounded-md border border-line bg-surface px-4 py-3 text-xs text-fg-muted">
        Full walkthrough in <span className="font-semibold text-fg">docs/SETUP.md</span>. The
        schema, RLS policies and seed data are already written — nothing here needs to be
        designed, only pointed at a database.
      </p>
    </div>
  );
}
