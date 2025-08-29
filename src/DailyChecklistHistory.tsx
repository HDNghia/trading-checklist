import React, { useEffect, useMemo, useState } from "react";
import type { PropsWithChildren, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Download, SlidersHorizontal, RefreshCw, Plus, Trash2 } from "lucide-react";

// --- Minimal shadcn-like primitives (fallbacks) ---
type WithClassName = { className?: string };
const Button: React.FC<PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & WithClassName>> = ({ className = "", children, ...props }) => (
  <button className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl shadow-sm hover:shadow transition bg-white border border-gray-200 text-gray-800 ${className}`} {...props}>{children}</button>
);
const Card: React.FC<PropsWithChildren<HTMLAttributes<HTMLDivElement> & WithClassName>> = ({ className = "", children, ...rest }) => (
  <div {...rest} className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>{children}</div>
);
const CardHeader: React.FC<PropsWithChildren<HTMLAttributes<HTMLDivElement> & WithClassName>> = ({ className = "", children, ...rest }) => (
  <div {...rest} className={`p-3 border-b border-gray-100 ${className}`}>{children}</div>
);
const CardContent: React.FC<PropsWithChildren<HTMLAttributes<HTMLDivElement> & WithClassName>> = ({ className = "", children, ...rest }) => (
  <div {...rest} className={`p-3 ${className}`}>{children}</div>
);

// ========================= Types =========================
/** One rule's pass/fail with optional metrics */
export type RuleCheck = {
  key: string;                // e.g. "has_sl", "max_trades_per_day"
  title: string;              // label
  description?: string;       // detailed description
  pass: boolean;              // compliance
  level?: "info" | "warning" | "error"; // severity
  value?: number | string | null;         // measured value (e.g. 2.1%)
  limit?: number | string | null;         // threshold (e.g. 2%)
  notes?: string;
};

/** A day's checklist */
export type ChecklistDay = {
  date: string;               // ISO date (YYYY-MM-DD)
  trader: string;             // trader id/name
  equityOpen?: number;        // equity at day open
  equityClose?: number;       // equity at day close
  ddPercent?: number;         // max drawdown % during day
  journalUrl?: string | null; // link to daily journal
  rules: RuleCheck[];         // rule outcomes
  tradesCount: number;        // trades executed
  // extra telemetry for demo (so we can evaluate rules with custom settings)
  _telemetry?: { riskPerTradePct: number; allHaveSL: boolean };
};

export type RuleSession = { start: string; end: string; tz: string; label?: string };
export type RuleSettings = {
  maxRiskPercent: number;        // e.g. 5
  maxPositions: number;          // e.g. 5
  maxLotsPerTrade: number;       // e.g. 1 (placeholder in demo)
  maxSLPercent: number;          // e.g. 2
  maxDailyDDPercent: number;     // e.g. 5
  minRRAllowed: number;          // e.g. 1.5
  allowedSessions: RuleSession[];
  violateOutsideSession: boolean;
  maxSLTPChangePercent: number;  // e.g. 10
  requireFirstTradeGoal: boolean; // enforce pre-trade plan rule
};

export type PreTradePlan = {
  mood: string;
  plannedTrades: number;
  plannedWindows: { start: string; end: string; label?: string }[];
  expectedHighTime?: string; // HH:mm
  expectedLowTime?: string;  // HH:mm
  rrTarget: number;
  notes?: string;
  submittedAt: string; // ISO datetime
};

// ========================= Utilities =========================
function fmt(date: Date) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }

function badgeColor(pass: boolean, level?: RuleCheck["level"]) {
  if (pass) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (level === "error") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function pct(n: number) { return `${Math.round(n * 100)}%`; }

// ========================= API + Mock (single definitions) =========================
export type APIRule = { id: number; account_number: number; name: string; description?: string; condition: any; created_at?: string; updated_at?: string };

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function fetchRulesFromBackend(accountNumber: number): Promise<APIRule[]> {
  const res = await fetch(`/api/trade-rules?account_number=${accountNumber}`);
  if (!res.ok) throw new Error(`Fetch rules failed ${res.status}`);
  return await res.json();
}

function parseRulesToSettings(rules: APIRule[], base: RuleSettings): RuleSettings {
  const out: RuleSettings = { ...base };
  const byName = (needle: string) => rules.find(r => r.name.toLowerCase().includes(needle.toLowerCase()));
  const maxRisk = byName("Max Risk");
  if (maxRisk?.condition?.max_risk_percent != null) out.maxRiskPercent = Number(maxRisk.condition.max_risk_percent);
  const noOver = byName("No Overtrade");
  if (noOver?.condition?.max_positions != null) out.maxPositions = Number(noOver.condition.max_positions);
  if (noOver?.condition?.max_lots_per_trade != null) out.maxLotsPerTrade = Number(noOver.condition.max_lots_per_trade);
  const maxSL = byName("Max SL");
  if (maxSL?.condition?.max_sl_percent != null) out.maxSLPercent = Number(maxSL.condition.max_sl_percent);
  const maxDD = byName("Max Daily DD");
  if (maxDD?.condition?.max_dd_percent != null) out.maxDailyDDPercent = Number(maxDD.condition.max_dd_percent);
  const rr = byName("RR Target Declared");
  if (rr?.condition?.min_rr_allowed != null) out.minRRAllowed = Number(rr.condition.min_rr_allowed);
  const sessions = byName("Allowed Trading Sessions");
  if (sessions?.condition?.allowed_sessions) out.allowedSessions = sessions.condition.allowed_sessions as RuleSession[];
  if (sessions?.condition?.violate_outside_session != null) out.violateOutsideSession = !!sessions.condition.violate_outside_session;
  const first = byName("First Trade Must Have Goal");
  if (first?.condition?.require_first_trade_goal != null) out.requireFirstTradeGoal = !!first.condition.require_first_trade_goal;
  const change = byName("Max SL/TP Change");
  if (change?.condition?.max_sl_tp_change_percent != null) out.maxSLTPChangePercent = Number(change.condition.max_sl_tp_change_percent);
  return out;
}

async function saveSettingsToBackend( settings: RuleSettings, existing: APIRule[] | null) {
  if (!existing) throw new Error("No server rules loaded yet");
  const upd = (name: string, conditionPatch: any) => {
    const r = existing.find(x => x.name.toLowerCase().includes(name.toLowerCase()));
    if (!r) return Promise.resolve(undefined);
    return fetch(`/api/trade-rules/${r.id}`,{ method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ condition: { ...r.condition, ...conditionPatch } }) });
  };
  await Promise.all([
    upd("Max Risk", { max_risk_percent: settings.maxRiskPercent, apply_to: "all_trades" }),
    upd("No Overtrade", { max_positions: settings.maxPositions, max_lots_per_trade: settings.maxLotsPerTrade }),
    upd("Max SL", { max_sl_percent: settings.maxSLPercent, apply_to: "all_positions", enforce_strict: true }),
    upd("Max Daily DD", { max_dd_percent: settings.maxDailyDDPercent, window: "daily", apply_to: "account" }),
    upd("RR Target Declared", { min_rr_allowed: settings.minRRAllowed, require_rr_declared: true, apply_to: "all_trades" }),
    upd("Allowed Trading Sessions", { allowed_sessions: settings.allowedSessions, violate_outside_session: settings.violateOutsideSession, apply_to: "all_trades" }),
    upd("First Trade Must Have Goal", { require_first_trade_goal: settings.requireFirstTradeGoal, window: "daily", apply_to: "first_trade_of_day" }),
    upd("Max SL/TP Change", { max_sl_tp_change_percent: settings.maxSLTPChangePercent, apply_to: "all_positions" }),
  ]);
}

async function savePlanToBackend(accountNumber: number, dateISO: string, plan: PreTradePlan) {
  try {
    await fetch(`/api/pretrade-plans`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ account_number: accountNumber, date: dateISO, plan }) });
  } catch (e) { console.warn('Save plan failed', e); }
}

function rng(seed: number) {
  // simple xorshift rng for deterministic mock
  let x = seed || 123456789;
  return () => {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5; return (x >>> 0) / 4294967296;
  };
}

/** Build a fake day based on date + trader + settings for the demo */
function buildFakeDay(dateISO: string, trader: string, settings: RuleSettings): ChecklistDay {
  const base = parseInt(dateISO.replace(/-/g, ""), 10) + trader.length * 97;
  const r = rng(base);
  const trades = Math.floor(r() * 5); // 0..4
  const riskPerTrade = Math.round((r() * 3 + 0.2) * 10) / 10; // 0.2..3.2%
  const dd = Math.round((r() * 6) * 10) / 10; // 0..6%
  const hasJournal = r() > 0.3;
  const allHaveSL = r() > 0.15; // 85% chance compliant

  const rules: RuleCheck[] = [
    {
      key: "max_risk_percent",
      title: `Max Risk ${settings.maxRiskPercent}%`,
      description: "Risk per trade must not exceed % of total account",
      pass: riskPerTrade <= settings.maxRiskPercent,
      value: `${riskPerTrade}%`,
      limit: `${settings.maxRiskPercent}%`,
      level: riskPerTrade <= settings.maxRiskPercent ? "info" : "error",
      notes: riskPerTrade <= settings.maxRiskPercent ? "Within risk limit" : "Risk exceeded",
    },
    {
      key: "no_overtrade",
      title: "No Overtrade",
      description: "Must not open too many positions at once",
      pass: trades <= settings.maxPositions,
      value: trades,
      limit: settings.maxPositions,
      level: trades <= settings.maxPositions ? "info" : "warning",
      notes: trades <= settings.maxPositions ? "Position count OK" : `Too many positions: ${trades}`,
    },
    {
      key: "stop_loss_required",
      title: "Stop Loss Required",
      description: "Stop loss must be set for every trade",
      pass: allHaveSL,
      level: allHaveSL ? "info" : "error",
      notes: allHaveSL ? "All trades have SL" : "Some trades missing SL",
    },
    {
      key: "max_sl_percent",
      title: `Max SL ${settings.maxSLPercent}%`,
      description: "Stop loss must not exceed % of total account",
      pass: riskPerTrade <= settings.maxSLPercent,
      value: `${riskPerTrade}%`,
      limit: `${settings.maxSLPercent}%`,
      level: riskPerTrade <= settings.maxSLPercent ? "info" : "error",
      notes: riskPerTrade <= settings.maxSLPercent ? "SL within limit" : "SL exceeded",
    },
    {
      key: "max_daily_dd",
      title: `Max Daily DD ${settings.maxDailyDDPercent}%`,
      description: "Daily drawdown must not exceed % of opening equity",
      pass: (dd ?? 0) <= settings.maxDailyDDPercent,
      value: `${dd}%`,
      limit: `${settings.maxDailyDDPercent}%`,
      level: (dd ?? 0) <= settings.maxDailyDDPercent ? "info" : "error",
      notes: (dd ?? 0) <= settings.maxDailyDDPercent ? "DD within limit" : "DD exceeded",
    },
    // Placeholders (can't be evaluated without live order telemetry)
    {
      key: "session_allowed",
      title: "Allowed Trading Sessions",
      description: "Chỉ được phép giao dịch trong các khung giờ đã định",
      pass: true,
      level: "info",
      notes: settings.allowedSessions.map(s => `${s.label || ""} ${s.start}-${s.end} (${s.tz})`).join("; ") || "No sessions set",
    },
    {
      key: "max_sl_tp_change_percent",
      title: `Max SL/TP Change ${settings.maxSLTPChangePercent}%`,
      description: "SL/TP changes must not exceed % of initial distance",
      pass: true,
      level: "warning",
      notes: "Realtime check required",
    },
  ];

  const eqOpen = 10000 + Math.round(r() * 1000);
  const eqClose = eqOpen * (1 + (r() - 0.5) * 0.02);

  return {
    date: dateISO,
    trader,
    equityOpen: Math.round(eqOpen * 100) / 100,
    equityClose: Math.round(eqClose * 100) / 100,
    ddPercent: dd,
    journalUrl: hasJournal ? `https://journals.example/${trader}/${dateISO}` : null,
    rules,
    tradesCount: trades,
    _telemetry: { riskPerTradePct: riskPerTrade, allHaveSL },
  };
}

async function loadChecklistRange(trader: string, startISO: string, endISO: string, settings: RuleSettings): Promise<ChecklistDay[]> {
  // Replace with: GET /api/checklists/range?trader=...&start=YYYY-MM-DD&end=YYYY-MM-DD
  await delay(200);
  const days: string[] = [];
  let d = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  for (; d <= end; d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    days.push(iso);
  }
  return days.map(iso => buildFakeDay(iso, trader, settings));
}

// Pure builder to help testing
function buildCsv(rows: any[]): string {
  if (!rows?.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))];
  return lines.join("\n");
}

function exportCsv(rows: any[], filename = "checklists.csv") {
  if (!rows?.length) return;
  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * LUMIR – Behavioral Performance Hub (Prototype with Pre‑trade Plan + Rule Settings)
 * Self‑contained React + Tailwind component (no external libs)
 */

export default function DailyChecklistHistory() {
  // ---- State for enhanced interface ----
  const [trader, setTrader] = useState("trader_01");
  const [focusDate, setFocusDate] = useState(ymd(new Date()));
  const [rangeDays, setRangeDays] = useState(7); // last 7 days by default
  const [list, setList] = useState<ChecklistDay[]>([]);
  const [loading, setLoading] = useState(false);

  // Pre‑trade plan map by date
  const [plans, setPlans] = useState<Record<string, PreTradePlan | undefined>>({});

  // Rule settings (defaults reflect your JSON rules)
  const [settings, setSettings] = useState<RuleSettings>({
    maxRiskPercent: 5,
    maxPositions: 5,
    maxLotsPerTrade: 1,
    maxSLPercent: 2,
    maxDailyDDPercent: 5,
    minRRAllowed: 1.5,
    allowedSessions: [
      { start: "07:00", end: "11:00", tz: "Asia/Ho_Chi_Minh", label: "VN" },
      { start: "19:00", end: "23:00", tz: "Asia/Ho_Chi_Minh", label: "VN" },
    ],
    violateOutsideSession: true,
    maxSLTPChangePercent: 10,
    requireFirstTradeGoal: true,
  });

  // NEW: tie to backend rules
  const accountNumber = 5440722; // from your dataset
  const [serverRules, setServerRules] = useState<APIRule[] | null>(null);
  async function handleLoadRules() {
    try {
      const rules = await fetchRulesFromBackend(accountNumber);
      setServerRules(rules);
      setSettings(prev => parseRulesToSettings(rules, prev));
    } catch (e) { console.warn(e); }
  }
  async function handleSaveSettings() {
    try { await saveSettingsToBackend(settings, serverRules); }
    catch (e) { console.warn(e); }
  }

  const startISO = addDays(focusDate, -(rangeDays - 1));
  const endISO = focusDate;

  // ---- Mock header data (kept from original) ----
  const user = { name: "Alex Nguyen", level: "Disciplined" };
  const today = new Date().toISOString().slice(0, 10);
  const passRate7 = [62, 71, 78, 74, 81, 68, 72];
  const dd7 = [2.1, 1.3, 3.2, 2.6, 1.9, 2.4, 1.6];
  const daily = { compliance: 0.72, trades: 8, maxDD: 0.025 };

  // ---- Load data whenever period/settings changes ----
  useEffect(() => {
    setLoading(true);
    loadChecklistRange(trader, startISO, endISO, settings)
      .then(setList)
      .finally(() => setLoading(false));
  }, [trader, startISO, endISO, settings]);

  // Compute list with extra "RR Target Declared" rule based on plan + settings
  const listWithExtras = useMemo(() => {
    return list.map((d) => {
      const plan = plans[d.date];
      const rrOk = !!plan && plan.rrTarget >= settings.minRRAllowed && !!plan.mood && plan.plannedTrades > 0 && plan.plannedWindows.length > 0 && !!plan.expectedHighTime && !!plan.expectedLowTime;
      const rrRule: RuleCheck = {
        key: "rr_target_declared",
        title: `RR Target Declared (≥ ${settings.minRRAllowed})`,
        description: "Must declare RR target/plan for first trade of the day",
        pass: settings.requireFirstTradeGoal ? rrOk : true,
        value: plan ? `RR ${plan.rrTarget}` : null,
        limit: settings.minRRAllowed,
        level: rrOk ? "info" : "warning",
        notes: plan ? `${plan.plannedTrades} trades • ${plan.mood}` : "RR target/plan not declared",
      };
      return { ...d, rules: [...d.rules, rrRule] };
    });
  }, [list, plans, settings.minRRAllowed, settings.requireFirstTradeGoal]);

  const currentDay = useMemo(() => listWithExtras.find(d => d.date === focusDate) || null, [listWithExtras, focusDate]);

  // Aggregate compliance in range
  const summary = useMemo(() => {
    if (!listWithExtras.length) return { passRate: 0, days: 0 };
    const rates = listWithExtras.map(d => d.rules.filter(r => r.pass).length / d.rules.length);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    return { passRate: avg, days: listWithExtras.length };
  }, [listWithExtras]);

  const exportRows = useMemo(() => {
    return listWithExtras.map(d => ({
      date: d.date,
      trader: d.trader,
      trades: d.tradesCount,
      ddPercent: d.ddPercent,
      passRate: Math.round(100 * (d.rules.filter(r => r.pass).length / d.rules.length))
    }));
  }, [listWithExtras]);

  // ========== Lightweight runtime tests (never block UI) ==========
  useEffect(() => {
    try {
      // Existing tests
      const csv = buildCsv([
        { a: "plain", b: "x" },
        { a: "has,comma", b: "multi\nline" },
        { a: 'quote "q"', b: "ok" },
      ]);
      console.assert(csv.split("\n").length === 4, "CSV should have header + 3 rows");
      console.assert(csv.includes('"has,comma"'), "Comma field must be quoted");
      console.assert(csv.includes('"quote ""q"""'), "Quotes must be doubled when quoted");

      // Added tests
      console.assert(buildCsv([]) === "", "Empty rows should return empty string");
      const one = buildCsv([{ x: 1, y: "a" }]);
      console.assert(one === "x,y\n1,a", "Single simple row serialization");
    } catch (e) {
      console.warn("CSV self-test failed", e);
    }
  }, []);

  const planForFocus = plans[focusDate];

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-4 bg-white">
      {/* HEADER */}
      <header className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Behavioral Performance Hub</h1>
            <p className="text-gray-600 text-sm">Trader: <span className="font-medium">{user.name}</span> • Date: {today}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="success">Level: {user.level}</Badge>
            <Badge tone="neutral">Compliance Today: {(daily.compliance * 100).toFixed(0)}%</Badge>
            <Button onClick={() => exportCsv(exportRows)}><Download className="w-4 h-4" />Export CSV</Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <HeaderStat label="Pass rate (7d)">
            <div className="flex items-end gap-3">
              <span className="text-emerald-600 font-medium">{passRate7[passRate7.length - 1]}%</span>
              <Sparkline data={passRate7} height={36} />
            </div>
          </HeaderStat>
          <HeaderStat label="Max DD% (7d)">
            <div className="flex items-end gap-3">
              <span className="text-gray-800 font-medium">{dd7[dd7.length - 1]}%</span>
              <Sparkline data={dd7} height={36} strokeClass="stroke-red-500" />
            </div>
          </HeaderStat>
          <HeaderStat label="Trades today">
            <span className="text-gray-800 font-medium">{daily.trades}</span>
          </HeaderStat>
        </div>
      </header>

      {/* PRE‑TRADE PLAN + SETTINGS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LegacyCard title="Pre‑Trade Plan (First trade – required if enabled)">
          <PreTradePlanForm
            settings={settings}
            value={planForFocus}
            onSave={(p) => { setPlans(prev => ({ ...prev, [focusDate]: p })); savePlanToBackend(accountNumber, focusDate, p).catch(console.error); }}
          />
        </LegacyCard>

        <LegacyCard title="Rule Settings (editable)">
          <RuleSettingsForm
            value={settings}
            onChange={setSettings}
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={handleLoadRules}>Load Data</Button>
            <Button className="bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" onClick={handleSaveSettings}>Save to Backend</Button>
          </div>
        </LegacyCard>
      </section>

      {/* MAIN CONTROLS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="text-xs text-gray-500">Trader</label>
                <div className="mt-1 flex gap-2">
                  <input value={trader} onChange={e => setTrader((e.target as HTMLInputElement).value)} placeholder="trader id" className="w-full px-3 py-2 rounded-xl border border-gray-200" />
                </div>
              </div>
              <div className="col-span-1">
                <label className="text-xs text-gray-500">Focus date</label>
                <div className="mt-1 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                  <input type="date" className="px-3 py-2 rounded-xl border border-gray-200" value={focusDate} onChange={e => setFocusDate((e.target as HTMLInputElement).value)} />
                </div>
              </div>
              <div className="col-span-1">
                <label className="text-xs text-gray-500">Range</label>
                <select value={rangeDays} onChange={e => setRangeDays(parseInt((e.target as HTMLSelectElement).value))} className="mt-1 px-3 py-2 rounded-xl border border-gray-200">
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-gray-600 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" />
                {loading ? "Loading…" : `${summary.days} days, avg pass rate ${Math.round(summary.passRate * 100)}%`}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setFocusDate(addDays(focusDate, -1))}><ChevronLeft className="w-4 h-4" />Prev</Button>
                <Button onClick={() => setFocusDate(addDays(focusDate, +1))}><ChevronRight className="w-4 h-4" />Next</Button>
                <Button onClick={() => setFocusDate(ymd(new Date()))}><RefreshCw className="w-4 h-4" />Today</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="font-medium">{fmt(new Date(startISO + "T00:00:00Z"))} → {fmt(new Date(endISO + "T00:00:00Z"))}</div>
              <div className="text-sm text-gray-500">Pick a day to inspect</div>
            </div>
          </CardHeader>
          <CardContent>
            <CalendarStrip startISO={startISO} endISO={endISO} selectedISO={focusDate} onPick={iso => setFocusDate(iso)} />
          </CardContent>
        </Card>
      </div>

      {/* CURRENT DAY */}
      <div className="space-y-3">
        {settings.requireFirstTradeGoal && !planForFocus && (
          <Card>
            <CardContent>
              <div className="text-sm text-amber-700">⚠️ You haven't declared RR target/plan for {fmt(new Date(focusDate + "T00:00:00Z"))}. Complete the form above before your first trade.</div>
            </CardContent>
          </Card>
        )}

        {currentDay ? (
          <DayChecklistCard day={currentDay} />
        ) : (
          <Card><CardContent>No data for {fmt(new Date(focusDate + "T00:00:00Z"))}</CardContent></Card>
        )}
      </div>

      {/* OVERVIEW TABLE */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="font-medium">Overview (last {rangeDays} days)</div>
            <div className="text-sm text-gray-500">Click a row to open</div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Trades</th>
                  <th className="py-2 pr-4">Pass rate</th>
                  <th className="py-2 pr-4">DD%</th>
                  <th className="py-2 pr-4">Max Risk</th>
                  <th className="py-2 pr-4">No Overtrade</th>
                  <th className="py-2 pr-4">SL Required</th>
                  <th className="py-2 pr-4">Max SL</th>
                  <th className="py-2 pr-4">RR Declared</th>
                </tr>
              </thead>
              <tbody>
                {listWithExtras.map(d => {
                  const passRate = Math.round(100 * (d.rules.filter(r => r.pass).length / d.rules.length));
                  const get = (k: string) => d.rules.find(x => x.key === k);
                  return (
                    <tr key={d.date} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setFocusDate(d.date)}>
                      <td className="py-2 pr-4">{fmt(new Date(d.date + "T00:00:00Z"))}</td>
                      <td className="py-2 pr-4">{d.tradesCount}</td>
                      <td className="py-2 pr-4 font-medium">{passRate}%</td>
                      <td className={`py-2 pr-4 ${d.ddPercent && d.ddPercent >= 3 ? 'text-rose-600 font-medium' : 'text-gray-700'}`}>{d.ddPercent?.toFixed(1)}%</td>
                      <td className="py-2 pr-4">{get("max_risk_percent")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("no_overtrade")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("stop_loss_required")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("max_sl_percent")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("rr_target_declared")?.pass ? "✓" : "✗"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-gray-500">Tip: Replace mock loaders with your backend endpoints. See comments in code.</div>
    </div>
  );
}

// ========================= Components =========================
const DayRuleRow: React.FC<{ rc: RuleCheck }> = ({ rc }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <div className="min-w-0">
      <div className="font-medium text-gray-900 truncate">{rc.title}</div>
      {rc.notes && <div className="text-xs text-gray-500 mt-0.5">{rc.notes}</div>}
    </div>
    <div className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${badgeColor(rc.pass, rc.level)}`}>
      {rc.pass ? "PASS" : (rc.level === "error" ? "ERROR" : "WARN")}
      {rc.value != null && <span className="ml-2 text-gray-700">{String(rc.value)}{rc.limit ? ` / ${rc.limit}` : ``}</span>}
    </div>
  </div>
);

const DayChecklistCard: React.FC<{ day: ChecklistDay }> = ({ day }) => {
  const passed = day.rules.filter(r => r.pass).length;
  const rate = passed / day.rules.length;
  return (
    <Card className="w-full">
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <Card className="p-3">
            <div className="text-xs text-gray-500">Compliance</div>
            <div className="text-xl font-semibold">{pct(rate)}</div>
            <div className="text-xs text-gray-500 mt-1">{passed}/{day.rules.length} rules passed</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-gray-500">Trades</div>
            <div className="text-xl font-semibold">{day.tradesCount}</div>
            <div className="text-xs text-gray-500 mt-1">Today</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-gray-500">Max Drawdown (day)</div>
            <div className={`text-xl font-semibold ${day.ddPercent && day.ddPercent >= 3 ? 'text-rose-600' : 'text-gray-900'}`}>{day.ddPercent?.toFixed(1)}%</div>
            <div className="text-xs text-gray-500 mt-1">Reset threshold 3%</div>
          </Card>
        </div>
        <div className="divide-y">
          {day.rules.map(r => <DayRuleRow key={r.key} rc={r} />)}
        </div>
      </CardContent>
    </Card>
  );
};

const CalendarStrip: React.FC<{ startISO: string, endISO: string, selectedISO: string, onPick: (iso: string) => void }>
  = ({ startISO, endISO, selectedISO, onPick }) => {
    // render days between start and end as small pills
    const days = useMemo(() => {
      const items: string[] = [];
      let d = new Date(startISO + "T00:00:00Z");
      const e = new Date(endISO + "T00:00:00Z");
      for (; d <= e; d = new Date(d.getTime() + 86400000)) items.push(d.toISOString().slice(0, 10));
      return items;
    }, [startISO, endISO]);
    return (
      <div className="flex flex-wrap gap-2">
        {days.map(iso => {
          const active = iso === selectedISO;
          return (
            <button key={iso} onClick={() => onPick(iso)}
              className={`px-3 py-1 rounded-full border text-sm ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}>
              {new Date(iso + "T00:00:00Z").getUTCDate()}
            </button>
          );
        })}
      </div>
    );
  };

function LegacyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900 mb-3">{title}</h3>
      {children}
    </section>
  );
}

function HeaderStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const map: Record<string, string> = {
    neutral: "bg-gray-100 text-gray-700 border-gray-200",
    success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    warning: "bg-amber-100 text-amber-700 border-amber-200",
    danger: "bg-red-100 text-red-700 border-red-200",
  };
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${map[tone]}`}>{children}</span>;
}

function Sparkline({ data, width = 120, height = 40, strokeClass = "stroke-emerald-500" }: { data: number[]; width?: number; height?: number; strokeClass?: string }) {
  const path = useMemo(() => {
    if (!data || data.length === 0) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const norm = (v: number) => (max - min === 0 ? 0.5 : (v - min) / (max - min));
    return data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - norm(v) * height;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data, width, height]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} className={`${strokeClass} fill-none`} strokeWidth={2} />
    </svg>
  );
}

// ---------------- Forms -----------------
function PreTradePlanForm({ settings, value, onSave }: { settings: RuleSettings; value?: PreTradePlan; onSave: (p: PreTradePlan) => void }) {
  const [mood, setMood] = useState(value?.mood || "Calm");
  const [plannedTrades, setPlannedTrades] = useState<number>(value?.plannedTrades ?? 1);
  const [rrTarget, setRrTarget] = useState<number>(value?.rrTarget ?? settings.minRRAllowed);
  const [expectedHighTime, setExpectedHighTime] = useState<string>(value?.expectedHighTime || "");
  const [expectedLowTime, setExpectedLowTime] = useState<string>(value?.expectedLowTime || "");
  const [plannedWindows, setPlannedWindows] = useState<{ start: string; end: string; label?: string }[]>(value?.plannedWindows?.length ? value.plannedWindows : [{ start: "09:00", end: "10:00", label: "Setup A" }]);
  const [notes, setNotes] = useState<string>(value?.notes || "");

  const addWindow = () => setPlannedWindows(ws => [...ws, { start: "", end: "", label: "" }]);
  const removeWindow = (idx: number) => setPlannedWindows(ws => ws.filter((_, i) => i !== idx));
  const save = () => {
    const plan: PreTradePlan = { mood, plannedTrades: Math.max(0, plannedTrades), plannedWindows: plannedWindows.filter(w => w.start && w.end), expectedHighTime, expectedLowTime, rrTarget: Math.max(0, rrTarget), notes, submittedAt: new Date().toISOString() };
    onSave(plan);
  };

  return (
    <div className="grid grid-cols-1 gap-3 text-sm">
      <div className="grid md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Today's Mood</span>
          <select className="rounded-md border border-gray-300 px-3 py-2" value={mood} onChange={e => setMood(e.target.value)}>
            {['Calm','Focused','Anxious','Euphoric','Stressed'].map(m => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Expected Trades Today</span>
          <input type="number" className="rounded-md border border-gray-300 px-3 py-2" min={0} value={plannedTrades} onChange={e => setPlannedTrades(parseInt(e.target.value || '0'))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Minimum RR Target</span>
          <input type="number" step="0.1" className="rounded-md border border-gray-300 px-3 py-2" value={rrTarget} onChange={e => setRrTarget(parseFloat(e.target.value || '0'))} />
                     <span className="text-xs text-gray-500">Requires ≥ {settings.minRRAllowed}</span>
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Expected HIGH Time of Day</span>
          <input type="time" className="rounded-md border border-gray-300 px-3 py-2" value={expectedHighTime} onChange={e => setExpectedHighTime(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Expected LOW Time of Day</span>
          <input type="time" className="rounded-md border border-gray-300 px-3 py-2" value={expectedLowTime} onChange={e => setExpectedLowTime(e.target.value)} />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-700">Expected Market Entry Times</span>
                      <Button onClick={addWindow}><Plus className="w-4 h-4"/>Add Window</Button>
        </div>
        <div className="space-y-2">
          {plannedWindows.map((w, idx) => (
            <div key={idx} className="grid md:grid-cols-4 gap-2">
              <input placeholder="Label" className="rounded-md border border-gray-300 px-3 py-2" value={w.label || ''} onChange={e => setPlannedWindows(ws => ws.map((it,i)=> i===idx?{...it,label:e.target.value}:it))} />
              <input type="time" className="rounded-md border border-gray-300 px-3 py-2" value={w.start} onChange={e => setPlannedWindows(ws => ws.map((it,i)=> i===idx?{...it,start:e.target.value}:it))} />
              <input type="time" className="rounded-md border border-gray-300 px-3 py-2" value={w.end} onChange={e => setPlannedWindows(ws => ws.map((it,i)=> i===idx?{...it,end:e.target.value}:it))} />
              <Button className="justify-center" onClick={() => removeWindow(idx)}><Trash2 className="w-4 h-4"/>Remove</Button>
            </div>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1">
                  <span className="text-gray-700">Notes</span>
        <textarea className="rounded-md border border-gray-300 px-3 py-2" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
      </label>

      <div className="flex items-center gap-3">
        <Button className="bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" onClick={save}>Save Pre‑trade Plan</Button>
        {value && <span className="text-xs text-gray-500">Saved at {new Date(value.submittedAt).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

function RuleSettingsForm({ value, onChange }: { value: RuleSettings; onChange: (v: RuleSettings) => void }) {
  const v = value;
  const set = (patch: Partial<RuleSettings>) => onChange({ ...v, ...patch });
  const updateSession = (idx: number, patch: Partial<RuleSession>) => {
    const arr = v.allowedSessions.slice();
    arr[idx] = { ...arr[idx], ...patch };
    set({ allowedSessions: arr });
  };
  const addSession = () => set({ allowedSessions: [...v.allowedSessions, { start: "", end: "", tz: "Asia/Ho_Chi_Minh", label: "" }] });
  const removeSession = (idx: number) => set({ allowedSessions: v.allowedSessions.filter((_, i) => i !== idx) });

  return (
    <div className="grid grid-cols-1 gap-3 text-sm">
      <div className="grid md:grid-cols-3 gap-3">
        <NumberField label="Max risk %/trade" value={v.maxRiskPercent} step={0.1} onChange={(n) => set({ maxRiskPercent: n })} />
        <NumberField label="Max positions" value={v.maxPositions} step={1} onChange={(n) => set({ maxPositions: Math.max(0, Math.round(n)) })} />
        <NumberField label="Max lots/trade" value={v.maxLotsPerTrade} step={0.01} onChange={(n) => set({ maxLotsPerTrade: Math.max(0, n) })} />
        <NumberField label="Max SL %" value={v.maxSLPercent} step={0.1} onChange={(n) => set({ maxSLPercent: n })} />
        <NumberField label="Max daily DD %" value={v.maxDailyDDPercent} step={0.1} onChange={(n) => set({ maxDailyDDPercent: n })} />
        <NumberField label="Min RR allowed" value={v.minRRAllowed} step={0.1} onChange={(n) => set({ minRRAllowed: n })} />
        <NumberField label="Max SL/TP change %" value={v.maxSLTPChangePercent} step={1} onChange={(n) => set({ maxSLTPChangePercent: n })} />
        <label className="flex items-center gap-2 mt-2">
          <input type="checkbox" className="rounded border-gray-300" checked={v.requireFirstTradeGoal} onChange={e => set({ requireFirstTradeGoal: e.target.checked })} />
          <span>Require RR target declaration for first trade</span>
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-700">Allowed sessions</span>
          <Button onClick={addSession}><Plus className="w-4 h-4"/>Add session</Button>
        </div>
        <div className="space-y-2">
          {v.allowedSessions.map((s, idx) => (
            <div key={idx} className="grid md:grid-cols-5 gap-2">
              <input placeholder="Label" className="rounded-md border border-gray-300 px-3 py-2" value={s.label || ''} onChange={e => updateSession(idx, { label: e.target.value })} />
              <input type="time" className="rounded-md border border-gray-300 px-3 py-2" value={s.start} onChange={e => updateSession(idx, { start: e.target.value })} />
              <input type="time" className="rounded-md border border-gray-300 px-3 py-2" value={s.end} onChange={e => updateSession(idx, { end: e.target.value })} />
              <input placeholder="Time zone" className="rounded-md border border-gray-300 px-3 py-2" value={s.tz} onChange={e => updateSession(idx, { tz: e.target.value })} />
              <Button className="justify-center" onClick={() => removeSession(idx)}><Trash2 className="w-4 h-4"/>Remove</Button>
            </div>
          ))}
        </div>
      </div>

              <div className="text-xs text-gray-500">Changes are applied immediately to rule evaluation in the table below.</div>
    </div>
  );
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-700">{label}</span>
      <input type="number" step={step} className="rounded-md border border-gray-300 px-3 py-2" value={value} onChange={(e) => onChange(parseFloat(e.target.value || '0'))} />
    </label>
  );
}