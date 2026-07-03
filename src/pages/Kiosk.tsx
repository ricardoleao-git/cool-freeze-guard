import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Snowflake, AlertCircle, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { ageSeconds, computeOffsetMs } from "@/lib/kiosk-age";
import { supabase } from "@/integrations/supabase/client";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kiosk-panel`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const POLL_MS = 60_000;
const BACKOFF_STEPS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

type Area = {
  id: string;
  name: string;
  exposure_limit_minutes: number | null;
  warning_yellow_minutes: number | null;
  warning_orange_minutes: number | null;
};
type Inside = {
  primeiro_nome: string;
  avatar: string | null;
  area_id: string | null;
  area_nome: string | null;
  inside_since: string | null;
};
type Payload = {
  tenant_id: string | null;
  tenant_nome: string | null;
  server_time: string;
  areas: Area[];
  inside: Inside[];
  summary: { total: number; ok: number; yellow: number; orange: number; red: number };
  daily_pride: { thermal_breaks_today: number; external_readings_today: number };
};

type Risk = "ok" | "yellow" | "orange" | "red";

function bucket(min: number, a?: Area): Risk {
  if (!a) return "ok";
  const lim = a.exposure_limit_minutes || 0;
  const ora = a.warning_orange_minutes || 0;
  const yel = a.warning_yellow_minutes || 0;
  if (lim > 0 && min >= lim) return "red";
  if (ora > 0 && min >= ora) return "orange";
  if (yel > 0 && min >= yel) return "yellow";
  return "ok";
}

function fmt(min: number): string {
  if (min < 60) {
    const s = Math.floor((min - Math.floor(min)) * 60);
    return `${Math.floor(min)}:${String(s).padStart(2, "0")}`;
  }
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function initials(name: string): string {
  const t = name.trim();
  if (!t) return "—";
  return t.slice(0, 2).toUpperCase();
}

function TokenForm({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="min-h-screen grid place-items-center bg-zinc-950 text-zinc-100 px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (v) onSubmit(v);
        }}
        className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <Snowflake className="h-7 w-7 text-sky-400" />
          <h1 className="text-2xl font-semibold">Painel Externo</h1>
        </div>
        <p className="text-sm text-zinc-400">
          Cole o token de acesso da TV/quiosque para iniciar o monitoramento.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Token do painel"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-zinc-100 outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-sky-500 px-4 py-3 text-base font-semibold text-white hover:bg-sky-400 transition"
        >
          Abrir painel
        </button>
        <p className="text-xs text-zinc-500">
          O painel exibe apenas o primeiro nome e a foto do colaborador, conforme política de minimização de dados (LGPD).
        </p>
      </form>
    </div>
  );
}

function InvalidScreen() {
  return (
    <div
      data-testid="kiosk-invalid"
      className="min-h-screen grid place-items-center bg-zinc-950 text-zinc-100 px-6 text-center"
    >
      <div className="max-w-lg">
        <AlertCircle className="mx-auto h-16 w-16 text-rose-500" />
        <h1 className="mt-6 text-3xl font-semibold">Token inválido ou revogado</h1>
        <p className="mt-3 text-zinc-400">
          O acesso deste quiosque foi negado pelo servidor. O token pode ter sido
          revogado, expirado ou nunca ter existido. Solicite um novo token ao
          administrador do sistema e recarregue a página.
        </p>
      </div>
    </div>
  );
}

function Tile({
  label,
  count,
  tone,
  pulse,
  testId,
}: {
  label: string;
  count: number;
  tone: "green" | "yellow" | "orange" | "red";
  pulse?: boolean;
  testId?: string;
}) {
  const map = {
    green: "bg-emerald-600/20 border-emerald-500/60 text-emerald-300",
    yellow: "bg-amber-500/20 border-amber-500/60 text-amber-200",
    orange: "bg-orange-600/25 border-orange-500/70 text-orange-200",
    red: "bg-rose-700/25 border-rose-500/80 text-rose-200",
  } as const;
  return (
    <div
      data-testid={testId}
      className={`rounded-2xl border-2 px-6 py-5 ${map[tone]} ${
        pulse ? "animate-pulse" : ""
      }`}
    >
      <div className="text-xs uppercase tracking-widest opacity-80">{label}</div>
      <div className="mt-1 text-6xl font-bold tabular-nums">{count}</div>
    </div>
  );
}

function PersonCard({
  person,
  area,
  minutes,
  risk,
}: {
  person: Inside;
  area?: Area;
  minutes: number;
  risk: Risk;
}) {
  const tone =
    risk === "red"
      ? "border-rose-500 bg-rose-900/30 animate-pulse"
      : risk === "orange"
      ? "border-orange-500 bg-orange-900/25"
      : risk === "yellow"
      ? "border-amber-400 bg-amber-900/20"
      : "border-emerald-500/60 bg-emerald-900/15";
  const timeTone =
    risk === "red"
      ? "text-rose-200"
      : risk === "orange"
      ? "text-orange-200"
      : risk === "yellow"
      ? "text-amber-200"
      : "text-emerald-200";
  return (
    <div
      data-testid="kiosk-person"
      data-risk={risk}
      data-name={person.primeiro_nome}
      className={`rounded-2xl border-2 p-5 flex items-center gap-5 ${tone}`}
    >
      {person.avatar ? (
        <img
          src={person.avatar}
          alt=""
          className="h-24 w-24 rounded-full object-cover border-2 border-zinc-700"
        />
      ) : (
        <div className="h-24 w-24 rounded-full bg-zinc-800 border-2 border-zinc-700 grid place-items-center text-3xl font-semibold text-zinc-300">
          {initials(person.primeiro_nome)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-3xl font-bold text-zinc-50 truncate">
          {person.primeiro_nome}
        </div>
        <div className="text-lg text-zinc-400 truncate">
          {person.area_nome ?? area?.name ?? "—"}
        </div>
      </div>
      <div className={`text-right ${timeTone}`}>
        <div className="text-5xl font-bold tabular-nums leading-none">
          {fmt(minutes)}
        </div>
        <div className="text-xs uppercase tracking-widest mt-1 opacity-80">
          tempo dentro
        </div>
      </div>
    </div>
  );
}

export default function Kiosk() {
  const [params] = useSearchParams();
  const initialToken = (params.get("token") || params.get("boot") || "").trim();
  const [token, setToken] = useState(initialToken);
  const [data, setData] = useState<Payload | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [now, setNow] = useState<number>(Date.now());
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const offsetRef = useRef(0); // serverTime - clientTime ms
  const lastServerTimeRef = useRef<number | null>(null);

  // ref to trigger an immediate refetch from outside the polling loop
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let inFlight = false;

    async function load() {
      if (inFlight) return;
      inFlight = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try {
        const res = await fetch(FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: ANON,
            Authorization: `Bearer ${ANON}`,
          },
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          setInvalid(true);
          setData(null);
          return; // stop polling
        }
        if (!res.ok) throw new Error(`http_${res.status}`);
        const json = (await res.json()) as Payload;
        if (cancelled) return;
        const serverMs = new Date(json.server_time).getTime();
        offsetRef.current = computeOffsetMs(json.server_time, Date.now());
        lastServerTimeRef.current = serverMs;
        setData(json);
        setInvalid(false);
        failures = 0;
        setConsecutiveFailures(0);
      } catch {
        failures += 1;
        setConsecutiveFailures(failures);
      } finally {
        inFlight = false;
        if (cancelled) return;
        const delay =
          failures === 0
            ? POLL_MS
            : BACKOFF_STEPS_MS[Math.min(failures - 1, BACKOFF_STEPS_MS.length - 1)];
        timer = setTimeout(load, delay);
      }
    }

    reloadRef.current = load;
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // Realtime: assim que sabemos o tenant_id, assinamos um canal de broadcast
  // "kiosk:<tenant>" — o simulador envia um "refresh" após cada mutação e o
  // painel dispara uma releitura imediata, sem esperar o poll de 60s.
  const tenantId = data?.tenant_id ?? null;
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`kiosk:${tenantId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "refresh" }, () => {
        reloadRef.current?.();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);


  const areasById = useMemo(() => {
    const m = new Map<string, Area>();
    for (const a of data?.areas ?? []) m.set(a.id, a);
    return m;
  }, [data]);

  const enrichedInside = useMemo(() => {
    if (!data) return [];
    const serverNow = now + offsetRef.current;
    return data.inside
      .map((p) => {
        const since = p.inside_since ? new Date(p.inside_since).getTime() : serverNow;
        const minutes = Math.max(0, (serverNow - since) / 60000);
        const area = p.area_id ? areasById.get(p.area_id) : undefined;
        return { person: p, area, minutes, risk: bucket(minutes, area) };
      })
      .sort((a, b) => {
        // Risk priority desc, then minutes desc, then name asc (stable, deterministic).
        const order: Record<Risk, number> = { red: 3, orange: 2, yellow: 1, ok: 0 };
        const dr = order[b.risk] - order[a.risk];
        if (dr !== 0) return dr;
        const dm = b.minutes - a.minutes;
        if (dm !== 0) return dm;
        return a.person.primeiro_nome.localeCompare(b.person.primeiro_nome, "pt-BR");
      });
  }, [data, now, areasById]);

  const liveSummary = useMemo(() => {
    const s = { total: 0, ok: 0, yellow: 0, orange: 0, red: 0 };
    for (const e of enrichedInside) {
      s.total += 1;
      s[e.risk] += 1;
    }
    return s;
  }, [enrichedInside]);

  if (!token) return <TokenForm onSubmit={setToken} />;
  if (invalid) return <InvalidScreen />;

  if (!data) {
    const reconnecting = consecutiveFailures > 0;
    return (
      <div
        data-testid="kiosk-loading"
        className="min-h-screen bg-zinc-950 text-zinc-100 p-8 flex flex-col gap-6"
        aria-busy="true"
        aria-live="polite"
      >
        <header className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Snowflake className="h-12 w-12 text-sky-400" />
            <div className="space-y-2">
              <div className="h-3 w-32 rounded bg-zinc-800 animate-pulse" />
              <div className="h-8 w-72 rounded bg-zinc-800 animate-pulse" />
            </div>
          </div>
          <div className="space-y-2 text-right">
            <div className="h-14 w-44 rounded bg-zinc-800 animate-pulse ml-auto" />
            <div className="h-3 w-32 rounded bg-zinc-800 animate-pulse ml-auto" />
          </div>
        </header>
        <section className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/40 px-6 py-5 h-28 animate-pulse" />
          ))}
        </section>
        <section className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border-2 border-zinc-800 bg-zinc-900/40 h-32 animate-pulse" />
          ))}
        </section>
        <footer
          className={`flex items-center justify-center gap-3 rounded-2xl border px-6 py-4 text-base ${
            reconnecting
              ? "border-amber-700/50 bg-amber-900/20 text-amber-200"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-400"
          }`}
        >
          {reconnecting && <WifiOff className="h-5 w-5" />}
          {reconnecting
            ? `Sem resposta do servidor — reconectando (tentativa ${consecutiveFailures})…`
            : "Carregando painel…"}
        </footer>
      </div>
    );
  }

  const serverNow = new Date(now + offsetRef.current);
  const clockTxt = serverNow.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateTxt = serverNow.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  const ageSec = ageSeconds(lastServerTimeRef.current, now, offsetRef.current);

  return (
    <div
      data-testid="kiosk-panel"
      className="min-h-screen bg-zinc-950 text-zinc-100 p-8 flex flex-col gap-6"
    >
      <header className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Snowflake className="h-12 w-12 text-sky-400" />
          <div>
            <div className="text-sm uppercase tracking-widest text-zinc-400">
              {data.tenant_nome ?? "—"}
            </div>
            <h1 className="text-4xl font-bold tracking-tight">
              Monitoramento de Câmaras Frias
            </h1>
          </div>
        </div>
        <div className="text-right">
          <div className="text-6xl font-bold tabular-nums leading-none">{clockTxt}</div>
          <div className="text-sm text-zinc-400 mt-2 capitalize">{dateTxt}</div>
        </div>
      </header>

      <section className="grid grid-cols-4 gap-4">
        <Tile testId="tile-ok" label="OK" count={liveSummary.ok} tone="green" />
        <Tile testId="tile-yellow" label="Atenção" count={liveSummary.yellow} tone="yellow" />
        <Tile testId="tile-orange" label="Alerta" count={liveSummary.orange} tone="orange" />
        <Tile
          testId="tile-red"
          label="Crítico"
          count={liveSummary.red}
          tone="red"
          pulse={liveSummary.red > 0}
        />
      </section>

      <section className="flex-1">
        {enrichedInside.length === 0 ? (
          <div className="h-full min-h-[40vh] grid place-items-center rounded-2xl border-2 border-dashed border-zinc-800 bg-zinc-900/40">
            <div className="text-center">
              <ShieldCheck className="mx-auto h-20 w-20 text-emerald-400" />
              <p className="mt-6 text-3xl font-semibold text-zinc-100">
                Nenhum colaborador em exposição agora
              </p>
              <p className="mt-2 text-zinc-400">Tudo tranquilo nas câmaras.</p>
            </div>
          </div>
        ) : (
          <div
            data-testid="kiosk-grid"
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            {enrichedInside.map((e, i) => (
              <PersonCard
                key={`${e.person.primeiro_nome}-${i}`}
                person={e.person}
                area={e.area}
                minutes={e.minutes}
                risk={e.risk}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-700/50 bg-emerald-900/20 px-6 py-4">
        <div className="flex items-center gap-3 text-emerald-200">
          <Sparkles className="h-6 w-6" />
          <div className="text-lg">
            Hoje:{" "}
            <span className="font-semibold tabular-nums">
              {data.daily_pride.thermal_breaks_today}
            </span>{" "}
            pausas térmicas cumpridas ·{" "}
            <span className="font-semibold tabular-nums">
              {data.daily_pride.external_readings_today}
            </span>{" "}
            leituras externas registradas
          </div>
        </div>
        <div
          data-testid="kiosk-age"
          className={`text-xs flex items-center gap-2 ${
            consecutiveFailures > 0 ? "text-amber-400" : "text-zinc-500"
          }`}
        >
          {consecutiveFailures > 0 && <WifiOff className="h-4 w-4" />}
          atualizado há {ageSec}s
          {consecutiveFailures > 0 && ` · reconectando (tentativa ${consecutiveFailures})`}
        </div>
      </footer>
    </div>
  );
}
