import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/setup-notice";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { SettingRow } from "@/components/admin/setting-row";
import { ZoneEditor } from "@/components/admin/zone-editor";
import { signOut } from "@/app/(auth)/actions";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Platform settings" };

export default async function AdminSettingsPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const [{ data: settings }, { data: zones }, { data: audit }] = await Promise.all([
    supabase.from("platform_settings").select("key, value, description, updated_at").order("key"),
    supabase.from("service_zones").select("id, name, city, is_active, base_fee_centavos, surge_multiplier, surge_until").order("name"),
    supabase
      .from("admin_audit_log")
      .select("id, action, entity_type, entity_id, note, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <>
      <ScreenHeader title="Platform" subtitle="Operational settings, zones and the audit trail" />

      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6">
        <section aria-labelledby="knobs">
          <h2 id="knobs" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Settings
          </h2>
          {/* These exist so dispatch mode, fees and caps change without a
              deploy. update_platform_setting() (0011) is the only path that
              can write this table - see SettingRow for why. */}
          <Card>
            <dl className="divide-y divide-line">
              {(settings ?? []).map((s) => (
                <SettingRow key={s.key} settingKey={s.key} value={s.value} description={s.description} />
              ))}
            </dl>
          </Card>
        </section>

        <section aria-labelledby="zones">
          <h2 id="zones" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Service zones
          </h2>
          {(zones ?? []).length === 0 ? (
            <p className="rounded-md border border-line bg-surface px-4 py-3 text-sm text-fg-muted">
              No zones defined — without one, nothing is deliverable; quote_delivery returns
              outside_service_area.
            </p>
          ) : (
            <div className="space-y-2">
              {zones!.map((z) => (
                <ZoneEditor key={z.id} zone={z} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="audit">
          <h2 id="audit" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
            Audit trail
          </h2>
          <DataTable
            columns={[
              { key: "when", label: "When" },
              { key: "action", label: "Action" },
              { key: "entity", label: "Entity", hideOnMobile: true },
              { key: "note", label: "Note", hideOnMobile: true },
            ]}
            rows={(audit ?? []).map((a) => ({
              when: formatRelative(a.created_at),
              action: a.action,
              entity: `${a.entity_type}${a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}`,
              note: a.note,
            }))}
            empty="Nothing logged yet"
            emptyDescription="Every privileged action lands here. The table has no update or delete policy for anyone."
          />
        </section>

        <form action={signOut}>
          <Button type="submit" variant="secondary" fullWidth>
            Sign out
          </Button>
        </form>
      </div>
    </>
  );
}
