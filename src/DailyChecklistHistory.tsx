import React, { useEffect, useMemo, useState } from "react";
import type { PropsWithChildren, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Download, SlidersHorizontal, RefreshCw, ArrowLeftRight } from "lucide-react";

// --- Minimal shadcn-like primitives (fallbacks) ---
type WithClassName = { className?: string };
const Button: React.FC<PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & WithClassName>> = ({ className = "", children, ...props }) => (
  <button className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl shadow-sm hover:shadow transition bg-white border border-gray-200 text-gray-800 ${className}`} {...props}>{children}</button>
);
const Card: React.FC<PropsWithChildren<HTMLAttributes<HTMLDivElement> & WithClassName>> = ({ className = "", children, ...rest }) => (
  <div {...rest} className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>{children}</div>
);
const CardHeader: React.FC<PropsWithChildren<HTMLAttributes<HTMLDivElement> & WithClassName>> = ({ className = "", children, ...rest }) => (
  <div {...rest} className={`p-4 border-b border-gray-100 ${className}`}>{children}</div>
);
const CardContent: React.FC<PropsWithChildren<HTMLAttributes<HTMLDivElement> & WithClassName>> = ({ className = "", children, ...rest }) => (
  <div {...rest} className={`p-4 ${className}`}>{children}</div>
);

// ========================= Types =========================
/** One rule's pass/fail with optional metrics */
type RuleCheck = {
  key: string;                // e.g. "has_sl", "max_trades_per_day"
  title: string;              // label
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
      key: "has_sl",
      title: "100% orders have SL",
      pass: allHaveSL,
      notes: allHaveSL ? "All entries protected" : "Some orders missing SL",
    },
    {
      key: "max_trades",
      title: "≤ 3 trades/day",
      pass: trades <= 3,
      value: trades,
      limit: 3,
      notes: trades <= 3 ? "Ok" : `Exceeded by ${trades - 3}`,
      level: trades <= 3 ? "info" : "warning",
    },
    {
      key: "risk_per_trade",
      title: "≤ 2% risk per trade",
      pass: riskPerTrade <= 2,
      value: `${riskPerTrade}%`,
      limit: "2%",
      level: riskPerTrade <= 2 ? "info" : riskPerTrade <= 2.5 ? "warning" : "error",
    },
    {
      key: "journal",
      title: "End-of-day journal submitted",
      pass: hasJournal,
      notes: hasJournal ? "Submitted" : "Missing journal",
      level: hasJournal ? "info" : "warning",
    },
    {
      key: "dd_reset",
      title: "Reset if DD ≥ 3%",
      pass: dd < 3, // if ≥3% should reset -> not compliant
      value: `${dd}%` ,
      limit: "< 3%",
      level: dd < 3 ? "info" : "error",
      notes: dd >= 3 ? "DD exceeded reset threshold" : "Within limits",
    },
  ];

  const eqOpen = 10000 + Math.round(r()*1000);
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
  for(; d <= end; d = new Date(d.getTime() + 86400000)){
    const iso = d.toISOString().slice(0,10);
    days.push(iso);
  }
  return days.map(iso => buildFakeDay(iso, trader));
}

// ========================= Utilities =========================
function fmt(date: Date){
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function ymd(d: Date){ return d.toISOString().slice(0,10); }
function addDays(iso: string, n: number){ const d = new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return ymd(d); }

function badgeColor(pass: boolean, level?: RuleCheck["level"]) {
  if(pass) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if(level === "error") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function pct(n: number){ return `${Math.round(n*100)}%`; }

// Pure builder to help testing
function buildCsv(rows: any[]): string {
  if(!rows?.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v:any) => {
    const s = String(v ?? "");
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))];
  return lines.join("\n");
}

function exportCsv(rows: any[], filename = "checklists.csv"){
  if(!rows?.length) return;
  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
}

// ========================= Components =========================
const DayRuleRow: React.FC<{ rc: RuleCheck }> = ({ rc }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div className="min-w-0">
      <div className="font-medium text-gray-900 truncate">{rc.title}</div>
      {rc.notes && <div className="text-xs text-gray-500 mt-0.5">{rc.notes}</div>}
    </div>
    <div className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${badgeColor(rc.pass, rc.level)}`}>
      {rc.pass ? "PASS" : (rc.level === "error" ? "ERROR" : "WARN")}
      {rc.value!=null && <span className="ml-2 text-gray-700">{String(rc.value)}{rc.limit?` / ${rc.limit}`:``}</span>}
    </div>
  </div>
);

const DayChecklistCard: React.FC<{ day: ChecklistDay, onBack?: ()=>void }> = ({ day, onBack }) => {
  const passed = day.rules.filter(r=>r.pass).length;
  const rate = passed / day.rules.length;
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500">{day.trader}</div>
            <h2 className="text-xl font-semibold">Checklist — {fmt(new Date(day.date+"T00:00:00Z"))}</h2>
          </div>
          <div className="flex items-center gap-2">
            {onBack && <Button onClick={onBack}><ArrowLeftRight className="w-4 h-4 rotate-180"/>Back</Button>}
            {day.journalUrl && <a className="text-sm text-indigo-600 hover:text-indigo-700" href={day.journalUrl} target="_blank" rel="noreferrer">Open Journal →</a>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Card className="p-4">
            <div className="text-xs text-gray-500">Compliance</div>
            <div className="text-2xl font-semibold">{pct(rate)}</div>
            <div className="text-xs text-gray-500 mt-1">{passed}/{day.rules.length} rules passed</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-gray-500">Trades</div>
            <div className="text-2xl font-semibold">{day.tradesCount}</div>
            <div className="text-xs text-gray-500 mt-1">Today</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-gray-500">Max Drawdown (day)</div>
            <div className={`text-2xl font-semibold ${day.ddPercent && day.ddPercent>=3? 'text-rose-600' : 'text-gray-900'}`}>{day.ddPercent?.toFixed(1)}%</div>
            <div className="text-xs text-gray-500 mt-1">Reset threshold 3%</div>
          </Card>
        </div>
        <div className="divide-y">
          {day.rules.map(r=> <DayRuleRow key={r.key} rc={r}/>) }
        </div>
      </CardContent>
    </Card>
  );
};

const CalendarStrip: React.FC<{ startISO: string, endISO: string, selectedISO: string, onPick: (iso:string)=>void }>
 = ({ startISO, endISO, selectedISO, onPick }) => {
  // render days between start and end as small pills
  const days = useMemo(()=>{
    const items: string[] = [];
    let d = new Date(startISO+"T00:00:00Z");
    const e = new Date(endISO+"T00:00:00Z");
    for(; d<=e; d = new Date(d.getTime()+86400000)) items.push(d.toISOString().slice(0,10));
    return items;
  }, [startISO, endISO]);
  return (
    <div className="flex flex-wrap gap-2">
      {days.map(iso=>{
        const active = iso===selectedISO;
        return (
          <button key={iso} onClick={()=>onPick(iso)}
            className={`px-3 py-1 rounded-full border text-sm ${active? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}>
            {new Date(iso+"T00:00:00Z").getUTCDate()}
          </button>
        );
      })}
    </div>
  );
};

// ========================= Main Component =========================
export default function DailyChecklistHistory() {
  const [trader, setTrader] = useState("trader_01");
  const [focusDate, setFocusDate] = useState(ymd(new Date()));
  const [rangeDays, setRangeDays] = useState(7); // last 7 days by default
  const [list, setList] = useState<ChecklistDay[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [compareDate, setCompareDate] = useState(addDays(ymd(new Date()), -1));
  const [compareDay, setCompareDay] = useState<ChecklistDay | null>(null);
  const [loading, setLoading] = useState(false);

  const startISO = addDays(focusDate, -(rangeDays-1));
  const endISO   = focusDate;

  useEffect(()=>{
    setLoading(true);
    loadChecklistRange(trader, startISO, endISO)
      .then(setList)
      .finally(()=> setLoading(false));
  }, [trader, startISO, endISO]);

  useEffect(()=>{
    if(compareMode){
      loadChecklistDay(trader, compareDate).then(setCompareDay);
    }
  }, [compareMode, compareDate, trader]);

  const currentDay = useMemo(()=> list.find(d => d.date===focusDate) || null, [list, focusDate]);

  // Aggregate compliance in range
  const summary = useMemo(()=>{
    if(!list.length) return { passRate: 0, days: 0 };
    const rates = list.map(d => d.rules.filter(r=>r.pass).length / d.rules.length);
    const avg = rates.reduce((a,b)=>a+b,0) / rates.length;
    return { passRate: avg, days: list.length };
  }, [list]);

  const exportRows = useMemo(()=>{
    return list.map(d => ({
      date: d.date,
      trader: d.trader,
      trades: d.tradesCount,
      ddPercent: d.ddPercent,
      passRate: Math.round(100*(d.rules.filter(r=>r.pass).length/d.rules.length))
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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Daily Behavioral Checklist — History</h1>
          <p className="text-sm text-gray-500">Review & compare past days for each trader.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={()=> setFocusDate(addDays(focusDate, -1))}><ChevronLeft className="w-4 h-4"/>Prev</Button>
          <Button onClick={()=> setFocusDate(addDays(focusDate, +1))}><ChevronRight className="w-4 h-4"/>Next</Button>
          <Button onClick={()=> setFocusDate(ymd(new Date()))}><RefreshCw className="w-4 h-4"/>Today</Button>
        </div>
      </div>

      {/* Controls */}
      <Card>
        <CardContent>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Trader</label>
              <div className="mt-1 flex gap-2">
                <input value={trader} onChange={e=>setTrader((e.target as HTMLInputElement).value)} placeholder="trader id" className="w-full px-3 py-2 rounded-xl border border-gray-200"/>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Focus date</label>
              <div className="mt-1 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-gray-500"/>
                <input type="date" value={focusDate} onChange={e=> setFocusDate((e.target as HTMLInputElement).value)} className="px-3 py-2 rounded-xl border border-gray-200 w-full"/>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Range</label>
              <select value={rangeDays} onChange={e=> setRangeDays(parseInt((e.target as HTMLSelectElement).value))} className="mt-1 px-3 py-2 rounded-xl border border-gray-200 w-full">
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-600 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4"/>
              {loading? "Loading…" : `${summary.days} days, avg pass rate ${Math.round(summary.passRate*100)}%`}
            </div>
            <div className="flex gap-2">
              <Button onClick={()=> exportCsv(exportRows)}><Download className="w-4 h-4"/>Export CSV</Button>
              <Button onClick={()=> setCompareMode(v=>!v)} className={compareMode?"bg-indigo-600 text-white border-indigo-600":""}>
                <ArrowLeftRight className="w-4 h-4"/>
                {compareMode? "Compare On" : "Compare"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Strip */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="font-medium">{fmt(new Date(startISO+"T00:00:00Z"))} → {fmt(new Date(endISO+"T00:00:00Z"))}</div>
            <div className="text-sm text-gray-500">Pick a day to inspect</div>
          </div>
        </CardHeader>
        <CardContent>
          <CalendarStrip startISO={startISO} endISO={endISO} selectedISO={focusDate} onPick={iso=> setFocusDate(iso)} />
        </CardContent>
      </Card>

      {/* Detail + Compare */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          {currentDay ? (
            <DayChecklistCard day={currentDay} />
          ) : (
            <Card><CardContent>No data for {fmt(new Date(focusDate+"T00:00:00Z"))}</CardContent></Card>
          )}
        </div>
        <div className="space-y-4">
          {compareMode && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="font-medium">Compare with…</div>
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-gray-500"/>
                    <input type="date" value={compareDate} onChange={e=> setCompareDate((e.target as HTMLInputElement).value)} className="px-3 py-2 rounded-xl border border-gray-200"/>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {compareDay ? (
                  <DayChecklistCard day={compareDay} />
                ) : (
                  <div className="text-sm text-gray-500">Pick a date to compare</div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Table overview */}
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
                  <th className="py-2 pr-4">SL 100%</th>
                  <th className="py-2 pr-4">≤3/day</th>
                  <th className="py-2 pr-4">≤2%/trade</th>
                  <th className="py-2 pr-4">Journal</th>
                  <th className="py-2 pr-4">Reset DD</th>
                </tr>
              </thead>
              <tbody>
                {list.map(d => {
                  const passRate = Math.round(100*(d.rules.filter(r=>r.pass).length/d.rules.length));
                  const get = (k:string) => d.rules.find(x=>x.key===k);
                  return (
                    <tr key={d.date} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={()=> setFocusDate(d.date)}>
                      <td className="py-2 pr-4">{fmt(new Date(d.date+"T00:00:00Z"))}</td>
                      <td className="py-2 pr-4">{d.tradesCount}</td>
                      <td className="py-2 pr-4 font-medium">{passRate}%</td>
                      <td className={`py-2 pr-4 ${d.ddPercent && d.ddPercent>=3? 'text-rose-600 font-medium':'text-gray-700'}`}>{d.ddPercent?.toFixed(1)}%</td>
                      <td className="py-2 pr-4">{get("has_sl")?.pass? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("max_trades")?.pass? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("risk_per_trade")?.pass? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("journal")?.pass? "✓" : "✗"}</td>
                      <td className="py-2 pr-4">{get("dd_reset")?.pass? "✓" : "✗"}</td>
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


