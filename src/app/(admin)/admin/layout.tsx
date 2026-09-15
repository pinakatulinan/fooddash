import { BottomNav, SideNav } from "@/components/layout/app-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-bg-subtle">
      <SideNav surface="admin" title="Ops console" />
      <main id="main" className="min-w-0 flex-1 pb-20 md:pb-0">
        {children}
      </main>
      <BottomNav surface="admin" />
    </div>
  );
}
