// End-to-end integration tests against a live GuardIA-API instance.
// Skipped unless GUARDIA_TEST_BASE_URL + GUARDIA_TEST_TOKEN are set.
// Run: deno test -A supabase/functions/_tests/guardia-e2e.test.ts
//
// Validates contract against published OpenAPI 1.0.0:
//   POST   /guardiaapi/person/{remoteid}        — create
//   PUT    /guardiaapi/person/{remoteid}        — update
//   DELETE /guardiaapi/person/{remoteid}        — remove
//   POST   /guardiaapi/qrcode                   — create QR
//   POST   /guardiaapi/facevalidation           — validate face image
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = Deno.env.get("GUARDIA_TEST_BASE_URL");
const TOKEN = Deno.env.get("GUARDIA_TEST_TOKEN");
const HEADER = Deno.env.get("GUARDIA_TEST_HEADER") ?? "X-GuardIA-Token";
const SCHEME = (Deno.env.get("GUARDIA_TEST_SCHEME") ?? "header").toLowerCase();

function skipIfNoEnv(): boolean {
  if (!BASE || !TOKEN) { console.warn("[skip] GUARDIA_TEST_BASE_URL/GUARDIA_TEST_TOKEN não definidos"); return true; }
  return false;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (SCHEME === "bearer") h.Authorization = `Bearer ${TOKEN}`;
  else h[HEADER] = TOKEN!;
  return h;
}
const url = (p: string) => `${BASE!.replace(/\/+$/, "")}/guardiaapi${p}`;

// 1x1 transparent PNG (Base64) used by facevalidation contract test.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

Deno.test("GuardIA · person CRUD lifecycle", async () => {
  if (skipIfNoEnv()) return;
  const remoteid = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  const base = { person_name: "E2E Test", document: remoteid, statusid: 1, persontypeidintegration: 2 };

  const create = await fetch(url(`/person/${remoteid}`), { method: "POST", headers: headers(), body: JSON.stringify(base) });
  assert(create.ok || create.status === 201, `POST person → ${create.status}`);

  const update = await fetch(url(`/person/${remoteid}`), {
    method: "PUT", headers: headers(),
    body: JSON.stringify({ ...base, person_name: "E2E Test Updated", statusid: 2 }),
  });
  assert(update.ok, `PUT person → ${update.status}`);

  const del = await fetch(url(`/person/${remoteid}`), { method: "DELETE", headers: headers() });
  assert(del.ok || del.status === 204, `DELETE person → ${del.status}`);
});

Deno.test("GuardIA · QRCode create", async () => {
  if (skipIfNoEnv()) return;
  const resp = await fetch(url(`/qrcode`), {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      remoteid: `qr-${crypto.randomUUID().slice(0, 8)}`,
      validfrom: new Date().toISOString(),
      validto: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      singleuse: false, qtyaccess: 5,
    }),
  });
  assert(resp.ok || resp.status === 201, `POST qrcode → ${resp.status}`);
});

Deno.test("GuardIA · facevalidation contract", async () => {
  if (skipIfNoEnv()) return;
  const resp = await fetch(url(`/facevalidation`), {
    method: "POST", headers: headers(),
    body: JSON.stringify({ photo: TINY_PNG_B64 }),
  });
  // A 1x1 image will likely fail validation; we assert the endpoint *responds* per spec,
  // not that the picture is valid. 200/400/422 are all acceptable — 404/5xx mean the contract is broken.
  assert([200, 400, 422].includes(resp.status), `facevalidation status inesperado: ${resp.status}`);
  const ct = resp.headers.get("content-type") || "";
  assert(ct.includes("application/json"), `facevalidation content-type: ${ct}`);
});

Deno.test("GuardIA · auth header rejection", async () => {
  if (skipIfNoEnv()) return;
  const bad = { ...headers(), [HEADER]: "invalid-token-xyz" };
  if (SCHEME === "bearer") bad.Authorization = "Bearer invalid-token-xyz";
  const resp = await fetch(url(`/person/nonexistent-e2e`), { method: "DELETE", headers: bad });
  assertEquals([401, 403].includes(resp.status), true, `esperado 401/403, recebeu ${resp.status}`);
});
