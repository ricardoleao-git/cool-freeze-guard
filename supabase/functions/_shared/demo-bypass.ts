// Shared helpers for the closure-* edge functions to handle the demo-tenant
// auth bypass safely and auditably.
//
//  - `isDemoBypassEnabled()` : returns true unless DEMO_BYPASS_ENABLED is
//    explicitly set to "false". Ops set it to "false" in production to hard-off
//    the bypass. Default true because Lovable Cloud always ships the public
//    /demo experience.
//  - `logDemoBypass()` : inserts an audit row for every bypass invocation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const DEMO_TENANT_ID = "demo-tenant";

export function isDemoBypassEnabled(): boolean {
  const v = (Deno.env.get("DEMO_BYPASS_ENABLED") ?? "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

export function isDemoBypassAllowed(tenantId: string): boolean {
  return tenantId === DEMO_TENANT_ID && isDemoBypassEnabled();
}

type AnyClient = ReturnType<typeof createClient>;

export async function logDemoBypass(
  supabase: AnyClient,
  params: {
    tenantId: string;
    functionName: string;
    req: Request;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const { tenantId, functionName, req, details } = params;
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || null;
    await supabase.from("demo_bypass_audit_log").insert({
      tenant_id: tenantId,
      function_name: functionName,
      ip_origin: ip,
      user_agent: ua,
      details: details ?? null,
    });
  } catch (e) {
    // Never fail the request because of audit logging.
    console.error("demo_bypass_audit_failed", (e as Error).message);
  }
}
