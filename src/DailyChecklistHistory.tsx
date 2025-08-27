import React, { useEffect, useMemo, useState } from "react";
import type { PropsWithChildren, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Download, SlidersHorizontal, RefreshCw } from "lucide-react";

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
type RuleCheck = {
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
type ChecklistDay = {
  date: string;               // ISO date (YYYY-MM-DD)
  trader: string;             // trader id/name
  equityOpen?: number;        // equity at day open
  equityClose?: number;       // equity at day close
  ddPercent?: number;         // max drawdown % during day
  journalUrl?: string | null; // link to daily journal
  rules: RuleCheck[];         // rule outcomes
  tradesCount: number;        // trades executed
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

// ========================= Mock API (replace with real calls) =========================
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

function rng(seed: number) {
  // simple xorshift rng for deterministic mock
  let x = seed || 123456789;
  return () => {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5; return (x >>> 0) / 4294967296;
  };
}

/** Build a fake day based on date + trader for the demo */
function buildFakeDay(dateISO: string, trader: string): ChecklistDay {
  const base = parseInt(dateISO.replace(/-/g, ""), 10) + trader.length * 97;
  const r = rng(base);
  const trades = Math.floor(r() * 5); // 0..4
  const riskPerTrade = Math.round((r() * 3 + 0.2) * 10) / 10; // 0.2..3.2%
  const dd = Math.round((r() * 6) * 10) / 10; // 0..6%
  const hasJournal = r() > 0.3;
  const allHaveSL = r() > 0.15; // 85% chance compliant

  const rules: RuleCheck[] = [
    {
      key: "max_risk_2_percent",
      title: "Max Risk 2%",
      description: "Không được để rủi ro vượt quá 2% tổng tài khoản",
      pass: riskPerTrade <= 2,
      value: `${riskPerTrade}%`,
      limit: "2%",
      level: riskPerTrade <= 2 ? "info" : "error",
      notes: riskPerTrade <= 2 ? "Within risk limit" : "Risk exceeded 2% threshold",
    },
    {
      key: "no_overtrade",
      title: "No Overtrade",
      description: "Không được mở quá nhiều vị thế cùng lúc",
      pass: trades <= 3,
      value: trades,
      limit: 3,
      level: trades <= 3 ? "info" : "warning",
      notes: trades <= 3 ? "Position count OK" : `Too many positions: ${trades}`,
    },
    {
      key: "stop_loss_required",
      title: "Stop Loss Required",
      description: "Bắt buộc phải đặt stop loss cho mọi giao dịch",
      pass: allHaveSL,
      level: allHaveSL ? "info" : "error",
      notes: allHaveSL ? "All trades have SL" : "Some trades missing SL",
    },
    {
      key: "max_sl_0_5_percent",
      title: "Max SL 0.5%",
      description: "Stop loss không được vượt quá 0.5% tổng tài khoản",
      pass: riskPerTrade <= 0.5,
      value: `${riskPerTrade}%`,
      limit: "0.5%",
      level: riskPerTrade <= 0.5 ? "info" : "error",
      notes: riskPerTrade <= 0.5 ? "SL within limit" : "SL exceeded 0.5%",
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
  };
}

async function loadChecklistDay(trader: string, dateISO: string): Promise<ChecklistDay> {
  // Replace with: GET /api/checklists?trader=...&date=YYYY-MM-DD
  await delay(150);
  return buildFakeDay(dateISO, trader);
}

async function loadChecklistRange(trader: string, startISO: string, endISO: string): Promise<ChecklistDay[]> {
  // Replace with: GET /api/checklists/range?trader=...&start=YYYY-MM-DD&end=YYYY-MM-DD
  await delay(200);
  const days: string[] = [];
  let d = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  for (; d <= end; d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    days.push(iso);
  }
  return days.map(iso => buildFakeDay(iso, trader));
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
 * LUMIR – Behavioral Performance Hub (Wireframe Prototype)
 * Self‑contained React + Tailwind component (no external libs)
 * - Header (overview)
 * - Left: Past (Checklist, Rule Breakdown, History)
 * - Right: Present (Realtime Alerts, Mindset, Consistency)
 * - Bottom: Future (Actions, Recovery, Learning, Roadmap, Benchmark, Predictive)
 */

export default function DailyChecklistHistory() {
  // ---- State for enhanced interface ----
  const [trader, setTrader] = useState("trader_01");
  const [focusDate, setFocusDate] = useState(ymd(new Date()));
  const [rangeDays, setRangeDays] = useState(7); // last 7 days by default
  const [list, setList] = useState<ChecklistDay[]>([]);
  // Compare panel removed
  const [loading, setLoading] = useState(false);

  const startISO = addDays(focusDate, -(rangeDays - 1));
  const endISO = focusDate;

  // ---- Mock data for legacy interface ----
  const user = { name: "Alex Nguyen", level: "Disciplined" };
  const today = new Date().toISOString().slice(0, 10);
  const passRate7 = [62, 71, 78, 74, 81, 68, 72];
  const dd7 = [2.1, 1.3, 3.2, 2.6, 1.9, 2.4, 1.6];

  const daily = {
    compliance: 0.72,
    trades: 8,
    maxDD: 0.025,
  };

  const rules = [
    { rule: "Max Risk ≤ 2%/trade", status: "PASS", impact: "High", fix: "—" },
    { rule: "Stop Loss Required", status: "ERROR", impact: "High", fix: "Enable SL template on order" },
    { rule: "No Overtrade (>10 trades/day)", status: "PASS", impact: "Med", fix: "—" },
    { rule: "RRR ≥ 1.5", status: "WARNING", impact: "Med", fix: "Adjust TP/SL to reach 1:1.5" },
  ];

  const alerts = [
    { stage: "pre", sev: "alert", msg: "Checklist chưa hoàn tất. Hoàn tất trước khi mở lệnh.", time: "09:12" },
    { stage: "in", sev: "watch", msg: "Bạn vừa nới SL 12%. Giữ kỷ luật nhé.", time: "10:43" },
    { stage: "post", sev: "info", msg: "Lệnh lỗ nhưng đúng quy trình – Good loss.", time: "15:20" },
  ];

  const roadmap = [
    { key: "7d", label: "7 days", progress: 80 },
    { key: "30d", label: "30 days", progress: 20 },
    { key: "13w", label: "13 weeks", progress: 0 },
  ];

  // ---- Enhanced interface logic ----
  useEffect(() => {
    setLoading(true);
    loadChecklistRange(trader, startISO, endISO)
      .then(setList)
      .finally(() => setLoading(false));
  }, [trader, startISO, endISO]);

  // compare loaders removed

  const currentDay = useMemo(() => list.find(d => d.date === focusDate) || null, [list, focusDate]);

  // Aggregate compliance in range
  const summary = useMemo(() => {
    if (!list.length) return { passRate: 0, days: 0 };
    const rates = list.map(d => d.rules.filter(r => r.pass).length / d.rules.length);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    return { passRate: avg, days: list.length };
  }, [list]);

  const exportRows = useMemo(() => {
    return list.map(d => ({
      date: d.date,
      trader: d.trader,
      trades: d.tradesCount,
      ddPercent: d.ddPercent,
      passRate: Math.round(100 * (d.rules.filter(r => r.pass).length / d.rules.length))
    }));
  }, [list]);

  // ========== Lightweight runtime tests (never block UI) ==========
  useEffect(() => {
    try {
      const csv = buildCsv([
        { a: "plain", b: "x" },
        { a: "has,comma", b: "multi\nline" },
        { a: 'quote "q"', b: "ok" },
      ]);
      console.assert(csv.split("\n").length === 4, "CSV should have header + 3 rows");
      console.assert(csv.includes('"has,comma"'), "Comma field must be quoted");
      console.assert(csv.includes('"quote ""q"""'), "Quotes must be doubled when quoted");
    } catch (e) {
      console.warn("CSV self-test failed", e);
    }
  }, []);

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
            {/* Compare toggle removed */}
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

      {/* BOTTOM – Future */}
      <section className="grid grid-cols-2 gap-4">
        <LegacyCard title="Rule Breakdown">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2">Rule</th>
                <th className="py-2">Status</th>
                <th className="py-2">Impact</th>
                <th className="py-2">Next action</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i} className="border-t text-gray-800">
                  <td className="py-2 pr-2">{r.rule}</td>
                  <td className="py-2 pr-2">
                    {r.status === "PASS" && <Badge tone="success">PASS</Badge>}
                    {r.status === "WARNING" && <Badge tone="warning">WARNING</Badge>}
                    {r.status === "ERROR" && <Badge tone="danger">ERROR</Badge>}
                  </td>
                  <td className="py-2 pr-2 text-gray-600">{r.impact}</td>
                  <td className="py-2 text-gray-700">{r.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LegacyCard>
        <LegacyCard title="Realtime Alerts (Present – Awareness)">
          <div className="space-y-2">
            {alerts.map((a, idx) => (
              <div key={idx} className="flex items-start gap-3 rounded-lg border p-3">
                <StagePill stage={a.stage} />
                <SeverityDot sev={a.sev} />
                <div className="flex-1 text-sm text-gray-800">{a.msg}</div>
                <span className="text-xs text-gray-500">{a.time}</span>
                <button className="ml-2 text-xs text-indigo-600 hover:underline">Resolve</button>
              </div>
            ))}
          </div>
        </LegacyCard>

        <LegacyCard title="Roadmap & Milestones">
          <div className="space-y-3">
            {roadmap.map((m) => (
              <div key={m.key} className="flex items-center gap-3">
                <div className="w-24 text-sm text-gray-700">{m.label}</div>
                <Progress value={m.progress} />
                <button className="ml-auto text-xs rounded-md border px-2 py-1 hover:bg-gray-50">Open</button>
              </div>
            ))}
          </div>
        </LegacyCard>

        <LegacyCard title="Consistency Score (This week)">
          <div className="flex items-center gap-4">
            <Radial value={78} label="Score" />
            <div className="text-sm text-gray-700">
              <p>Weekly discipline badge: <Badge tone="success">Disciplined</Badge></p>
              <p className="mt-1">Compared to personal baseline: <span className="text-emerald-600 font-medium">+6%</span></p>
            </div>
          </div>
        </LegacyCard>

        <LegacyCard title="Mindset Log">
          <MindsetForm />
        </LegacyCard>

        <LegacyCard title="Action Tracker (Future – Guidance)">
          <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>Enable SL template on order <Badge tone="neutral">To‑do</Badge></li>
            <li>Reduce size 20% after win‑streak <Badge tone="neutral">To‑do</Badge></li>
            <li>Lock daily loss at 3% <Badge tone="success">Done</Badge></li>
          </ul>
        </LegacyCard>
        <LegacyCard title="Learning Module Suggestions">
          <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1">
            <li>Overtrade: 5‑minute checklist before entry</li>
            <li>R/R Tuning: set TP/SL for ≥1:1.5 on your setup</li>
            <li>Emotional reset: 10‑minute cooldown routine</li>
          </ul>
        </LegacyCard>

        <LegacyCard title="Community Benchmark">
          <div className="text-sm text-gray-700">Your pass rate: <span className="font-semibold">71%</span> • Community median: <span className="font-semibold">65%</span> • Percentile: <span className="font-semibold">78th</span></div>
        </LegacyCard>
      </section>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT – Enhanced Interface */}
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
      <div className="space-y-3">
        
        {currentDay ? (
          <DayChecklistCard day={currentDay} />
        ) : (
          <Card><CardContent>No data for {fmt(new Date(focusDate + "T00:00:00Z"))}</CardContent></Card>
        )}
      </div>

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
                  <th className="py-2 pr-4">Max Risk 2%</th>
                  <th className="py-2 pr-4">No Overtrade</th>
                  <th className="py-2 pr-4">SL Required</th>
                  <th className="py-2 pr-4">Max SL 0.5%</th>
                </tr>
              </thead>
              <tbody>
                {list.map(d => {
                  const passRate = Math.round(100 * (d.rules.filter(r => r.pass).length / d.rules.length));
                  const get = (k: string) => d.rules.find(x => x.key === k);
                  return (
                    <tr key={d.date} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setFocusDate(d.date)}>
                      <td className="py-2 pr-4">{fmt(new Date(d.date + "T00:00:00Z"))}</td>
                      <td className="py-2 pr-4">{d.tradesCount}</td>
                      <td className="py-2 pr-4 font-medium">{passRate}%</td>
                      <td className={`py-2 pr-4 ${d.ddPercent && d.ddPercent >= 3 ? 'text-rose-600 font-medium' : 'text-gray-700'}`}>{d.ddPercent?.toFixed(1)}%</td>
                      <td className="py-2 pr-4">{get("max_risk_2_percent")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("no_overtrade")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("stop_loss_required")?.pass ? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("max_sl_0_5_percent")?.pass ? "✓" : "✗"}</td>
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

// ========================= New Components =========================
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

/* ---------------- UI Pieces ---------------- */
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

// Removed unused Metric component

function StagePill({ stage }: { stage: string }) {
  const map: Record<string, string> = { pre: "bg-sky-100 text-sky-700", in: "bg-amber-100 text-amber-700", post: "bg-fuchsia-100 text-fuchsia-700" };
  return <span className={`text-xs px-2 py-0.5 rounded-md ${map[stage] || "bg-gray-100 text-gray-700"}`}>{stage.toUpperCase()}</span>;
}

function SeverityDot({ sev }: { sev: string }) {
  const map: Record<string, string> = { info: "bg-sky-500", watch: "bg-amber-500", alert: "bg-orange-500", critical: "bg-red-500" };
  return <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${map[sev] || "bg-gray-400"}`} />;
}

function Progress({ value }: { value: number }) {
  return (
    <div className="flex-1 h-2 rounded-full bg-gray-100">
      <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function MindsetForm() {
  const [pre, setPre] = useState("Calm");
  const [post, setPost] = useState("Focused");
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-gray-700">Pre‑trade mood</span>
        <select className="rounded-md border border-gray-300 px-3 py-2" value={pre} onChange={(e) => setPre(e.target.value)}>
          {['Calm', 'Focused', 'Anxious', 'Euphoric', 'Stressed'].map(m => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-gray-700">Post‑trade mood</span>
        <select className="rounded-md border border-gray-300 px-3 py-2" value={post} onChange={(e) => setPost(e.target.value)}>
          {['Calm', 'Focused', 'Anxious', 'Euphoric', 'Stressed'].map(m => <option key={m}>{m}</option>)}
        </select>
      </label>
      <div className="md:col-span-2">
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-white font-semibold hover:bg-indigo-700">Save mood log</button>
      </div>
    </div>
  );
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

function Radial({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circ;
  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} className="fill-none stroke-gray-200" strokeWidth={8} />
        <circle cx="36" cy="36" r={radius} className="fill-none stroke-indigo-500" strokeWidth={8} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 36 36)" />
        <text x="36" y="40" textAnchor="middle" className="fill-gray-900 text-sm font-semibold">{clamped}%</text>
      </svg>
      {label && <div className="text-xs text-gray-500">{label}</div>}
    </div>
  );
}
