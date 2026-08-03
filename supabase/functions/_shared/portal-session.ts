// Sessão do portal do colaborador: token opaco assinado com HMAC-SHA256.
// O segredo nunca sai do servidor. Payload: { cpf, ids: [employee_id...], exp }.

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const pad = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return await crypto.subtle.importKey("raw", enc.encode("portal:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export type PortalClaims = { cpf: string; ids: string[]; exp: number };

export async function signSession(claims: Omit<PortalClaims, "exp">, ttlSeconds: number): Promise<string> {
  const payload: PortalClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

export async function verifySession(token: string | null | undefined): Promise<PortalClaims | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), b64urlDecode(sig), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as PortalClaims;
    if (!claims?.exp || claims.exp * 1000 < Date.now()) return null;
    if (!Array.isArray(claims.ids) || claims.ids.length === 0) return null;
    return claims;
  } catch { return null; }
}

export const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
