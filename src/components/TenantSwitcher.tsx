import { useDemo } from "@/lib/demo-store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

export function TenantSwitcher() {
  const { tenants, activeTenantId, setActiveTenantId } = useDemo();
  return (
    <Select value={activeTenantId} onValueChange={setActiveTenantId}>
      <SelectTrigger className="h-9 w-[230px] bg-muted/30 border-border/60">
        <Building2 className="h-4 w-4 text-primary" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {tenants.map(t => (
          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
