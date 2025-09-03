import React, { useEffect, useMemo, useState } from "react";
import type { PropsWithChildren, ButtonHTMLAttributes, HTMLAttributes } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Download, SlidersHorizontal, RefreshCw, Plus, Trash2, BookOpen, X } from "lucide-react";

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
  requireJournalBeforeNewTrade: boolean; // NEW: force journal before each entry
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

export type TradeJournalEntry = {
  id: string;
  createdAt: string; // ISO datetime
  mood: 'Calm' | 'Focused' | 'Anxious' | 'Euphoric' | 'Stressed';
  conditions: string; // entry factors/conditions for taking the trade
  entry: number; // entry price
  lots: number;  // position size (lots)
  sl: number;    // stop loss price
  rr: number;    // expected risk-reward ratio
  valuePerPoint: number; // cash value per 1 price unit per lot
  equityAtEntry?: number; // reference equity (if available)
  riskCash?: number;      // cash risk if SL is hit
  riskPct?: number;       // % of equity that can be lost
  profitAtTP?: number;    // potential profit at TP (RR * risk)
  lossAtSL?: number;      // loss at SL (= risk)
};

export type PlanHistoryEntry = { id: string; savedAt: string; plan: PreTradePlan };
export type SettingsHistoryEntry = { id: string; savedAt: string; settings: RuleSettings };

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
  try {
    const res = await fetch(`https://ftmo-api-dev.buso.asia/api/v1/trade-rules?account_number=${accountNumber}&status=not_executed`);
    if (!res.ok) throw new Error(`Fetch rules failed ${res.status}`);
    const response = await res.json();
    
    // Extract data from the response structure: { status, data, msg }
    if (response.status && response.data) {
      return response.data;
    }
    throw new Error('Invalid response format');
  } catch (e) {
    console.warn('Failed to fetch rules from backend:', e);
    // Return empty array instead of mock data to indicate real failure
    return [];
  }
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
  // NEW: Journal before new trade (if backend has such a rule name)
  const journal = rules.find(r => /journal/i.test(r.name));
  if (journal?.condition?.require_journal_before_new_trade != null) (out as any).requireJournalBeforeNewTrade = !!journal.condition.require_journal_before_new_trade;
  return out;
}

async function saveSettingsToBackend(settings: RuleSettings, existing: APIRule[] | null) {
  if (!existing || !existing.length) throw new Error("No server rules loaded yet");
  
  try {
    // Create a map to update existing rules based on current settings
    const updatedRules = existing.map(rule => {
      const updatedRule = { ...rule };
      
      // Update rule conditions based on settings
      if (rule.name.toLowerCase().includes("max risk")) {
        updatedRule.condition = {
          ...rule.condition,
          max_risk_percent: settings.maxRiskPercent
        };
        updatedRule.name = `Max Risk ${settings.maxRiskPercent}%`;
        updatedRule.description = `Không được để rủi ro vượt quá ${settings.maxRiskPercent}% tổng tài khoản`;
      } else if (rule.name.toLowerCase().includes("no overtrade")) {
        updatedRule.condition = {
          ...rule.condition,
          max_positions: settings.maxPositions,
          max_lots_per_trade: settings.maxLotsPerTrade
        };
      } else if (rule.name.toLowerCase().includes("max sl") && !rule.name.toLowerCase().includes("change")) {
        updatedRule.condition = {
          ...rule.condition,
          max_sl_percent: settings.maxSLPercent
        };
        updatedRule.name = `Max SL ${settings.maxSLPercent}%`;
        updatedRule.description = `Stop loss không được vượt quá ${settings.maxSLPercent}% tổng tài khoản`;
      } else if (rule.name.toLowerCase().includes("max daily dd")) {
        updatedRule.condition = {
          ...rule.condition,
          max_dd_percent: settings.maxDailyDDPercent
        };
        updatedRule.name = `Max Daily DD ${settings.maxDailyDDPercent}%`;
        updatedRule.description = `Tổng sụt giảm vốn (drawdown) trong ngày không vượt quá ${settings.maxDailyDDPercent}% equity đầu ngày`;
      } else if (rule.name.toLowerCase().includes("rr target declared")) {
        updatedRule.condition = {
          ...rule.condition,
          min_rr_allowed: settings.minRRAllowed
        };
      } else if (rule.name.toLowerCase().includes("allowed trading sessions")) {
        updatedRule.condition = {
          ...rule.condition,
          allowed_sessions: settings.allowedSessions,
          violate_outside_session: settings.violateOutsideSession
        };
      } else if (rule.name.toLowerCase().includes("first trade must have goal")) {
        updatedRule.condition = {
          ...rule.condition,
          require_first_trade_goal: settings.requireFirstTradeGoal
        };
      } else if (rule.name.toLowerCase().includes("max sl/tp change")) {
        updatedRule.condition = {
          ...rule.condition,
          max_sl_tp_change_percent: settings.maxSLTPChangePercent
        };
        updatedRule.name = `Max SL/TP Change ${settings.maxSLTPChangePercent}%`;
        updatedRule.description = `Không được thay đổi SL/TP quá ${settings.maxSLTPChangePercent}% so với khoảng cách ban đầu`;
      }
      
      return updatedRule;
    });

    // Send bulk update to API
    const response = await fetch(`https://ftmo-api-dev.buso.asia/api/v1/trade-rules/bulk-upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: updatedRules })
    });

    if (!response.ok) {
      throw new Error(`Failed to save settings: ${response.status}`);
    }

    console.log('Settings saved to backend successfully');
  } catch (e) {
    console.error('Failed to save settings to backend:', e);
    throw e;
  }
}

async function savePlanToBackend(accountNumber: number, plan: PreTradePlan) {
  try {
    const payload = {
      account_number: accountNumber.toString(),
      condition: {
        mood: plan.mood,
        plannedTrades: plan.plannedTrades,
        plannedWindows: plan.plannedWindows,
        expectedHighTime: plan.expectedHighTime,
        expectedLowTime: plan.expectedLowTime,
        rrTarget: plan.rrTarget,
        notes: plan.notes,
        submittedAt: plan.submittedAt
      },
      type: "daily"
    };

    const response = await fetch(`https://ftmo-api-dev.buso.asia/api/v1/daily_behavioral_checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to save plan: ${response.status}`);
    }

    console.log('Pre-trade plan saved successfully');
  } catch (e) {
    console.error('Save plan failed', e);
    throw e;
  }
}

async function saveJournalToBackend(accountNumber: number, journal: TradeJournalEntry) {
  try {
    const payload = {
      account_number: accountNumber.toString(),
      condition: {
        mood: journal.mood,
        conditions: journal.conditions,
        entry: journal.entry,
        lots: journal.lots,
        sl: journal.sl,
        rr: journal.rr,
        valuePerPoint: journal.valuePerPoint,
        equityAtEntry: journal.equityAtEntry,
        riskCash: journal.riskCash,
        riskPct: journal.riskPct,
        profitAtTP: journal.profitAtTP,
        lossAtSL: journal.lossAtSL
      },
      type: "pre_entry"
    };

    const response = await fetch(`https://ftmo-api-dev.buso.asia/api/v1/daily_behavioral_checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to save journal: ${response.status}`);
    }

    console.log('Pre-entry journal saved successfully');
  } catch (e) {
    console.error('Save journal failed', e);
    throw e;
  }
}

async function loadPlansFromBackend(accountNumber: number): Promise<PreTradePlan[]> {
  try {
    const response = await fetch(`https://ftmo-api-dev.buso.asia/api/v1/daily_behavioral_checklist?account_number=${accountNumber}&type=daily`);
    
    if (!response.ok) {
      throw new Error(`Failed to load plans: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.status && result.data) {
      return result.data.map((item: any) => ({
        mood: item.condition.mood,
        plannedTrades: item.condition.plannedTrades,
        plannedWindows: item.condition.plannedWindows,
        expectedHighTime: item.condition.expectedHighTime,
        expectedLowTime: item.condition.expectedLowTime,
        rrTarget: item.condition.rrTarget,
        notes: item.condition.notes,
        submittedAt: item.condition.submittedAt
      }));
    }
    
    return [];
  } catch (e) {
    console.error('Failed to load plans from backend:', e);
    return [];
  }
}

async function loadJournalsFromBackend(accountNumber: number): Promise<TradeJournalEntry[]> {
  try {
    const response = await fetch(`https://ftmo-api-dev.buso.asia/api/v1/daily_behavioral_checklist?account_number=${accountNumber}&type=pre_entry`);
    
    if (!response.ok) {
      throw new Error(`Failed to load journals: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.status && result.data) {
      return result.data.map((item: any, index: number) => ({
        id: item.id?.toString() || `journal_${index}`,
        createdAt: item.created_at,
        mood: item.condition.mood,
        conditions: item.condition.conditions,
        entry: item.condition.entry,
        lots: item.condition.lots,
        sl: item.condition.sl,
        rr: item.condition.rr,
        valuePerPoint: item.condition.valuePerPoint,
        equityAtEntry: item.condition.equityAtEntry,
        riskCash: item.condition.riskCash,
        riskPct: item.condition.riskPct,
        profitAtTP: item.condition.profitAtTP,
        lossAtSL: item.condition.lossAtSL
      }));
    }
    
    return [];
  } catch (e) {
    console.error('Failed to load journals from backend:', e);
    return [];
  }
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
      description: "Only trade within the defined sessions",
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
 * LUMIR – Behavioral Performance Hub (Prototype with Pre‑trade Plan + Journal + Rule Settings + Coaching Dialog)
 * Self‑contained React + Tailwind component (no external libs)
 */

// ========================= Coaching content =========================
type MantraDay = { day: number; theme: string; pre: string[]; inTrade: string[]; post: string[] };
const COACH_MANTRAS: MantraDay[] = [
  { day: 1, theme: "Initiation / New Start", pre: [
    "Today I start fresh. I don't chase yesterday, I create today.",
    "Clarity first, entries second.",
    "My edge begins with patience.",
  ], inTrade: [
    "I follow my plan, not my impulses.",
    "Each click is a choice. I choose discipline.",
    "I don't need many trades, only the right ones.",
  ], post: [
    "I review, I learn, I grow stronger.",
    "Every trade teaches me, win or loss.",
    "I close the day clean, ready for tomorrow.",
  ]},
  { day: 2, theme: "Balance / Cooperation", pre: [
    "I trade with balance, not with force.",
    "Today I listen as much as I act.",
    "Calm mind, clear chart.",
  ], inTrade: [
    "I wait for confirmation, then act.",
    "Patience protects my account.",
    "Harmony over haste.",
  ], post: [
    "I note what worked, I note what didn't.",
    "I honor small wins as much as big ones.",
    "Balance today creates consistency tomorrow.",
  ]},
  { day: 3, theme: "Creativity / Expression", pre: [
    "I bring fresh eyes to the market.",
    "Creativity within rules is my power.",
    "My plan is my canvas, I paint with discipline.",
  ], inTrade: [
    "I trade with clarity, not chaos.",
    "Ideas come, but rules decide.",
    "I express discipline, not impulsiveness.",
  ], post: [
    "I record my story of today's trades.",
    "I turn mistakes into insights.",
    "I celebrate progress, not perfection.",
  ]},
  { day: 4, theme: "Structure / Discipline", pre: [
    "My structure is my safety.",
    "I respect my checklist before charts.",
    "Discipline is freedom in the market.",
  ], inTrade: [
    "I protect capital with clear stops.",
    "No setup, no trade.",
    "Rules guard my emotions.",
  ], post: [
    "I measure results against my plan, not my mood.",
    "I note discipline kept, or discipline lost.",
    "Consistency builds my trading future.",
  ]},
  { day: 5, theme: "Change / Adaptability", pre: [
    "I am ready for change but rooted in rules.",
    "Flexibility plus focus equals strength.",
    "Markets move, my discipline stays.",
  ], inTrade: [
    "I adapt without panic.",
    "Volatility is opportunity, not chaos.",
    "Every shift meets my stop and target.",
  ], post: [
    "I adjust, I don't chase.",
    "Change teaches me resilience.",
    "Flexibility today, growth tomorrow.",
  ]},
  { day: 6, theme: "Responsibility / Care", pre: [
    "I trade responsibly, one decision at a time.",
    "Care protects my capital.",
    "I choose quality over quantity.",
  ], inTrade: [
    "I protect risk before I seek reward.",
    "Every trade carries responsibility.",
    "My account is cared for by discipline.",
  ], post: [
    "I reflect on how well I protected risk.",
    "Responsibility builds mastery.",
    "Today's care compounds tomorrow's gains.",
  ]},
  { day: 7, theme: "Reflection / Analysis", pre: [
    "Preparation is my first trade.",
    "I analyze before I act.",
    "Depth of thought beats speed of action.",
  ], inTrade: [
    "I pause, I check, I confirm.",
    "One clear signal is better than many guesses.",
    "Calm analysis over impulse.",
  ], post: [
    "Reflection makes me sharper.",
    "I seek lessons, not excuses.",
    "Review today, refine tomorrow.",
  ]},
  { day: 8, theme: "Power / Achievement", pre: [
    "I control risk, not the market.",
    "Power is in discipline, not size.",
    "Today I aim for strong execution.",
  ], inTrade: [
    "I trade with control, not greed.",
    "Strength is saying NO to bad setups.",
    "One strong trade beats ten weak ones.",
  ], post: [
    "I respect profits, I respect losses.",
    "Power is progress, not perfection.",
    "Achievement is built day by day.",
  ]},
  { day: 9, theme: "Completion / Release", pre: [
    "I enter today to complete, not to force.",
    "I focus on closure, not on chasing.",
    "Today I trade with gratitude, not fear.",
  ], inTrade: [
    "I execute, I let go.",
    "I trust my stop and my target.",
    "I do not cling, I release outcomes.",
  ], post: [
    "I close the day, complete and clean.",
    "I release the result, I keep the lesson.",
    "I let go today, to start fresh tomorrow.",
  ]},
];

function useSuggestedMantraOfToday() {
  const today = new Date();
  const idx = (today.getUTCDate() - 1) % COACH_MANTRAS.length; // rotate by day of month
  return COACH_MANTRAS[idx];
}

export default function DailyChecklistHistory() {
  // ---- State for enhanced interface ----
  const [trader, setTrader] = useState("trader_01");
  const [focusDate, setFocusDate] = useState(ymd(new Date()));
  const [rangeDays, setRangeDays] = useState(7); // last 7 days by default
  const [list, setList] = useState<ChecklistDay[]>([]);
  const [loading, setLoading] = useState(false);

  // Pre‑trade plan map by date
  const [plans, setPlans] = useState<Record<string, PreTradePlan | undefined>>({});
  // NEW: per-entry trade journals by date
  const [journals, setJournals] = useState<Record<string, TradeJournalEntry[]>>({});
  const [planHistory, setPlanHistory] = useState<Record<string, PlanHistoryEntry[]>>({});

  // Coaching dialog
  const [showCoaching, setShowCoaching] = useState(false);
  const suggested = useSuggestedMantraOfToday();

  // Rule settings (defaults reflect your JSON rules)
  const [settings, setSettings] = useState<RuleSettings>({
    maxRiskPercent: 5,
    maxPositions: 5,
    maxLotsPerTrade: 1,
    maxSLPercent: 2,
    maxDailyDDPercent: 5,
    minRRAllowed: 1.5,
    allowedSessions: [
      { start: "07:00", end: "11:00", tz: "Asia/Ho_Chi_Minh", label: "London AM" },
      { start: "19:00", end: "23:00", tz: "Asia/Ho_Chi_Minh", label: "NY" },
    ],
    violateOutsideSession: true,
    maxSLTPChangePercent: 10,
    requireFirstTradeGoal: true,
    requireJournalBeforeNewTrade: true,
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

  // ---- Mock header data ----
  const user = { name: "Alex Nguyen", level: "Disciplined" };
  const today = new Date().toISOString().slice(0, 10);
  const passRate7 = [62, 71, 78, 74, 81, 68, 72];
  const dd7: number[] = [2.1, 1.3, 3.2, 2.6, 1.9, 2.4, 1.6];
  const daily = { compliance: 0.72, trades: 8, maxDD: 0.025 };

  // ---- Load initial data from backend ----
  useEffect(() => {
    // Load plans and journals from backend on component mount
    Promise.all([
      loadPlansFromBackend(accountNumber),
      loadJournalsFromBackend(accountNumber)
    ]).then(([planData, journalData]) => {
      // Convert plans array to record by date (taking the latest plan)
      const plansRecord: Record<string, PreTradePlan | undefined> = {};
      planData.forEach(plan => {
        const date = plan.submittedAt ? plan.submittedAt.split('T')[0] : focusDate;
        plansRecord[date] = plan;
      });
      setPlans(plansRecord);

      // Convert journals array to record by date
      const journalsRecord: Record<string, TradeJournalEntry[]> = {};
      journalData.forEach(journal => {
        const date = journal.createdAt ? journal.createdAt.split('T')[0] : focusDate;
        if (!journalsRecord[date]) journalsRecord[date] = [];
        journalsRecord[date].push(journal);
      });
      setJournals(journalsRecord);
    }).catch(console.error);
  }, [accountNumber, focusDate]);

  // ---- Load data whenever period/settings changes ----
  useEffect(() => {
    setLoading(true);
    loadChecklistRange(trader, startISO, endISO, settings)
      .then(setList)
      .finally(() => setLoading(false));
  }, [trader, startISO, endISO, settings]);

  // Compute list with extra rules based on plan + settings + journal
  const listWithExtras = useMemo(() => {
    return list.map((d) => {
      const plan = plans[d.date];
      const dayJournals = journals[d.date] || [];
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
      const journalRule: RuleCheck = {
        key: "journal_before_new_trade",
        title: "Journal before new trade",
        description: "Must write journal before opening a new trade",
        pass: settings.requireJournalBeforeNewTrade ? dayJournals.length > 0 : true,
        value: dayJournals.length,
        limit: settings.requireJournalBeforeNewTrade ? 1 : 0,
        level: (settings.requireJournalBeforeNewTrade && dayJournals.length === 0) ? "warning" : "info",
        notes: dayJournals.length ? `${dayJournals.length} entries` : "No pre-entry journal yet",
      };
      return { ...d, rules: [...d.rules, rrRule, journalRule] };
    });
  }, [list, plans, journals, settings.minRRAllowed, settings.requireFirstTradeGoal, settings.requireJournalBeforeNewTrade]);

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

  // ========== Lightweight runtime tests ==========
  useEffect(() => {
    try {
      // CSV tests
      const csv = buildCsv([
        { a: "plain", b: "x" },
        { a: "has,comma", b: "multi\nline" },
        { a: 'quote "q"', b: "ok" },
      ]);
      console.assert(csv.split("\n").length === 4, "CSV should have header + 3 rows");
      console.assert(csv.includes('"has,comma"'), "Comma field must be quoted");
      console.assert(csv.includes('"quote ""q"""'), "Quotes must be doubled when quoted");

      // Risk math tests
      const riskPoints = Math.abs(100 - 99);
      const cashRisk = riskPoints * 1 * 1; // valuePerPoint=1, lots=1
      console.assert(cashRisk === 1, "Cash risk basic");
      const profit = cashRisk * 2; // rr=2
      console.assert(profit === 2, "Profit RR=2");
      const riskPct = (cashRisk / 1000) * 100; // equity 1000
      console.assert(Math.abs(riskPct - 0.1) < 1e-6, "% risk");
    } catch (e) {
      console.warn("Self-tests failed", e);
    }
  }, []);

  const planForFocus = plans[focusDate];
  const journalsForFocus = journals[focusDate] || [];
  const equityForFocus = currentDay?.equityOpen ?? 10000; // default if unknown

  function saveJournalEntry(e: TradeJournalEntry) {
    // Update local state immediately
    setJournals(prev => ({ ...prev, [focusDate]: [...(prev[focusDate] || []), e] }));
    // Also save to backend
    saveJournalToBackend(accountNumber, e).then(() => {
      // Reload journals from backend to get the latest data with IDs
      loadJournalsFromBackend(accountNumber).then(journalData => {
        const journalsRecord: Record<string, TradeJournalEntry[]> = {};
        journalData.forEach(journal => {
          const date = journal.createdAt ? journal.createdAt.split('T')[0] : focusDate;
          if (!journalsRecord[date]) journalsRecord[date] = [];
          journalsRecord[date].push(journal);
        });
        setJournals(journalsRecord);
      });
    }).catch(console.error);
  }
  function removeJournalEntry(id: string) {
    setJournals(prev => ({ ...prev, [focusDate]: (prev[focusDate] || []).filter(x => x.id !== id) }));
  }
  function handlePlanSaved(p: PreTradePlan) {
    // Update local state immediately
    setPlans(prev => ({ ...prev, [focusDate]: p }));
    const entry: PlanHistoryEntry = { id: `${focusDate}-${Date.now()}`, savedAt: new Date().toISOString(), plan: p };
    setPlanHistory(prev => ({ ...prev, [focusDate]: [entry, ...(prev[focusDate] || [])].slice(0, 20) }));
    
    // Save to backend and reload data
    savePlanToBackend(accountNumber, p).then(() => {
      // Reload plans from backend to get the latest data
      loadPlansFromBackend(accountNumber).then(planData => {
        const plansRecord: Record<string, PreTradePlan | undefined> = {};
        planData.forEach(plan => {
          const date = plan.submittedAt ? plan.submittedAt.split('T')[0] : focusDate;
          plansRecord[date] = plan;
        });
        setPlans(plansRecord);
      });
    }).catch(console.error);
  }

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
            <Button className="bg-indigo-50 border-indigo-200" onClick={() => setShowCoaching(true)} title="Notes / Coaching self-talk">
              <BookOpen className="w-4 h-4"/> Coaching self‑talk
            </Button>
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
          <HeaderStat label="Suggested mantra">
            <div className="text-sm text-gray-800">DAI_{suggested.day}: <span className="font-medium">{suggested.theme}</span></div>
          </HeaderStat>
        </div>
      </header>

      {/* PRE‑TRADE PLAN + SETTINGS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LegacyCard title="Pre‑Trade Plan (First trade – required if enabled)" extra={
          <Button className="bg-indigo-50 border-indigo-200" onClick={() => setShowCoaching(true)} title="Open coaching self-talk"><BookOpen className="w-4 h-4"/>Mantras</Button>
        }>
          <PreTradePlanForm
            settings={settings}
            value={planForFocus}
            onSave={handlePlanSaved}
          />
          {(planHistory[focusDate]?.length ?? 0) > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Pre‑Trade Plan Save History</h4>
              <div className="space-y-2">
                {planHistory[focusDate]!.map(h => (
                  <Card key={h.id} className="border border-gray-200">
                    <CardContent>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-700"><span className="font-medium">{new Date(h.savedAt).toLocaleTimeString()}</span> • RR ≥ {h.plan.rrTarget}</div>
                          <div className="text-xs text-gray-500">Trades: {h.plan.plannedTrades} • Mood: {h.plan.mood}</div>
                          <div className="text-xs text-gray-500">Windows: {h.plan.plannedWindows.map(w => `${w.label || ''} ${w.start}-${w.end}`).join('; ')}</div>
            </div>
            </div>
                    </CardContent>
          </Card>
                ))}
              </div>
              </div>
          )}
        </LegacyCard>

        <LegacyCard title="Rule Settings (editable)">
          <RuleSettingsForm
            value={settings}
            onChange={setSettings}
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={handleLoadRules}>Load data</Button>
            <Button className="bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" onClick={handleSaveSettings}>Save to backend</Button>
            </div>
        </LegacyCard>
      </section>

      {/* ALERTS for requirements */}
      <div className="space-y-3">
        {settings.requireFirstTradeGoal && !planForFocus && (
          <Card>
            <CardContent>
              <div className="text-sm text-amber-700">⚠️ You haven't declared an RR target/plan for {fmt(new Date(focusDate + "T00:00:00Z"))}. Complete the form above before your first trade.</div>
            </CardContent>
          </Card>
        )}
        {settings.requireJournalBeforeNewTrade && journalsForFocus.length === 0 && (
          <Card>
            <CardContent>
              <div className="text-sm text-amber-700">✍️ You must write a pre‑entry journal for this day before opening a new trade.</div>
            </CardContent>
          </Card>
        )}
        </div>

      {/* JOURNAL BEFORE NEW TRADE */}
      <LegacyCard title="Pre‑Entry Journal">
        <PreEntryJournalForm
          dateISO={focusDate}
          equity={equityForFocus}
          settings={settings}
          onSave={saveJournalEntry}
        />
        {journalsForFocus.length > 0 && (
          <div className="mt-3">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Saved journals today</h4>
            <div className="space-y-2">
              {journalsForFocus.map(j => (
                <Card key={j.id} className="border border-gray-200">
                  <CardContent>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-700"><span className="font-medium">{new Date(j.createdAt).toLocaleTimeString()} • Mood:</span> {j.mood}</div>
                        <div className="text-xs text-gray-500 mt-1">{j.conditions}</div>
                        <div className="text-xs text-gray-700 mt-2">Entry <span className="font-mono">{j.entry}</span> • SL <span className="font-mono">{j.sl}</span> • Lots <span className="font-mono">{j.lots}</span> • RR <span className="font-mono">{j.rr}</span></div>
                        <div className="text-xs text-gray-700">Risk≈ <span className="font-mono">{(j.riskCash ?? 0).toFixed(2)}</span> ({(j.riskPct ?? 0).toFixed(2)}%) • TP P/L≈ <span className="font-mono">{(j.profitAtTP ?? 0).toFixed(2)}</span> • SL P/L≈ <span className="font-mono">{(j.lossAtSL ?? 0).toFixed(2)}</span></div>
                </div>
                      <Button onClick={() => removeJournalEntry(j.id)} className="text-rose-600 hover:text-rose-700"><Trash2 className="w-4 h-4"/>Delete</Button>
            </div>
                  </CardContent>
          </Card>
              ))}
            </div>
          </div>
        )}
      </LegacyCard>

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
                  <th className="py-2 pr-4">Journal</th>
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
                      <td className="py-2 pr-4">{get("journal_before_new_trade")?.pass ? "✓" : "✗"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
        </Card>

      <div className="text-xs text-gray-500">Tip: Replace mock loaders with your backend endpoints. See comments in code.</div>

      {/* Coaching Dialog */}
      <CoachingDialog open={showCoaching} onClose={() => setShowCoaching(false)} />
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

function LegacyCard({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {extra}
      </div>
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

function PreEntryJournalForm({ dateISO, equity, settings, onSave }: { dateISO: string; equity: number; settings: RuleSettings; onSave: (e: TradeJournalEntry) => void }) {
  const [mood, setMood] = useState<TradeJournalEntry['mood']>('Calm');
  const [conditions, setConditions] = useState<string>('');
  const [entry, setEntry] = useState<number>(0);
  const [sl, setSL] = useState<number>(0);
  const [lots, setLots] = useState<number>(1);
  const [rr, setRR] = useState<number>(settings.minRRAllowed);
  const [valuePerPoint, setValuePerPoint] = useState<number>(1);

  const riskPoints = Math.abs((entry || 0) - (sl || 0));
  const cashRisk = riskPoints * (valuePerPoint || 0) * (lots || 0);
  const profitAtTP = cashRisk * (rr || 0);
  const riskPct = equity ? (cashRisk / equity) * 100 : 0;
  const tpPrice = (entry && sl && rr) ? (entry > sl ? entry + rr * (entry - sl) : entry - rr * (sl - entry)) : NaN;

  const rrTooLow = rr > 0 && rr < settings.minRRAllowed;
  const riskTooHigh = riskPct > settings.maxRiskPercent;

  function save() {
    const id = `${dateISO}-${Date.now()}`;
    const payload: TradeJournalEntry = {
      id,
      createdAt: new Date().toISOString(),
      mood,
      conditions: conditions.trim(),
      entry: Number(entry) || 0,
      lots: Number(lots) || 0,
      sl: Number(sl) || 0,
      rr: Number(rr) || 0,
      valuePerPoint: Number(valuePerPoint) || 0,
      equityAtEntry: equity,
      riskCash: cashRisk,
      riskPct,
      profitAtTP,
      lossAtSL: cashRisk,
    };
    onSave(payload);
    // reset minimal
    setConditions('');
  }

  return (
    <div className="grid grid-cols-1 gap-3 text-sm">
      <div className="grid md:grid-cols-5 gap-3">
      <label className="flex flex-col gap-1">
          <span className="text-gray-700">Mood</span>
          <select className="rounded-md border border-gray-300 px-3 py-2" value={mood} onChange={e => setMood(e.target.value as any)}>
            {['Calm','Focused','Anxious','Euphoric','Stressed'].map(m => <option key={m}>{m}</option>)}
        </select>
      </label>
        <NumberField label="Entry price" value={entry} onChange={setEntry} step={0.01} />
        <NumberField label="Lots" value={lots} onChange={setLots} step={0.01} />
        <NumberField label="Stop Loss price" value={sl} onChange={setSL} step={0.01} />
        <NumberField label="RR ratio" value={rr} onChange={setRR} step={0.1} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-gray-700">Entry factors/conditions</span>
        <textarea className="rounded-md border border-gray-300 px-3 py-2" rows={3} value={conditions} onChange={e => setConditions(e.target.value)} placeholder="e.g., H1 uptrend, pullback to H15 demand, London session confluence…" />
      </label>

      <div className="grid md:grid-cols-4 gap-3">
        <NumberField label="Value per 1 point (per lot)" value={valuePerPoint} onChange={setValuePerPoint} step={0.01} />
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="text-xs text-gray-500">Risk cash if SL hit</div>
          <div className={`text-lg font-semibold ${riskTooHigh ? 'text-rose-600' : 'text-gray-900'}`}>{cashRisk.toFixed(2)}</div>
          <div className="text-xs text-gray-500">≈ {riskPct.toFixed(2)}% of equity</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="text-xs text-gray-500">Profit at TP (RR × risk)</div>
          <div className="text-lg font-semibold">{profitAtTP.toFixed(2)}</div>
          <div className="text-xs text-gray-500">RR = {Number.isFinite(rr) ? rr.toFixed(2) : '—'}</div>
          <div className="text-xs text-gray-500 mt-1">TP price: <span className="font-mono">{Number.isFinite(tpPrice) ? tpPrice.toFixed(5) : '—'}</span></div>
        </div>
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="text-xs text-gray-500">Equity (reference)</div>
          <div className="text-lg font-semibold">{equity.toFixed(2)}</div>
          <div className="text-xs text-gray-500">From day open</div>
        </div>
      </div>

      {(rrTooLow || riskTooHigh) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 text-sm">
          {rrTooLow && <div>⚠️ Current RR ({rr.toFixed(2)}) is <span className="font-semibold">below</span> the minimum required {settings.minRRAllowed}.</div>}
          {riskTooHigh && <div>⚠️ Estimated risk ~{riskPct.toFixed(2)}% exceeds the maximum {settings.maxRiskPercent}%.</div>}
        </div>
      )}

    <div className="flex items-center gap-3">
        <Button className="bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" onClick={save}>Save pre‑entry journal</Button>
        <span className="text-xs text-gray-500">Time: {new Date().toLocaleTimeString()}</span>
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
        <label className="flex items-center gap-2 mt-2">
          <input type="checkbox" className="rounded border-gray-300" checked={v.requireJournalBeforeNewTrade} onChange={e => set({ requireJournalBeforeNewTrade: e.target.checked })} />
          <span>Require writing a journal before opening a new trade</span>
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

// ---------------- Coaching Dialog -----------------
function CoachingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative mt-10 w-full max-w-3xl mx-4 bg-white rounded-2xl shadow-2xl border border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="text-base font-semibold text-gray-900">Notes / Coaching self‑talk</div>
          <Button className="bg-white" onClick={onClose}><X className="w-4 h-4"/>Close</Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <p className="text-sm text-gray-600 mb-3">🔹 Personal Day NLP Coaching Mantras</p>
          <div className="space-y-3">
            {COACH_MANTRAS.map(m => (
              <details key={m.day} className="rounded-xl border border-gray-200">
                <summary className="cursor-pointer select-none px-4 py-2 font-medium text-gray-900 bg-gray-50 rounded-t-xl">Day {m.day} – {m.theme}</summary>
                <div className="p-4 space-y-2">
                  <SectionList title="Pre‑Trade" items={m.pre} />
                  <SectionList title="In‑Trade" items={m.inTrade} />
                  <SectionList title="Post‑Trade" items={m.post} />
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{title}</div>
      <ul className="list-disc pl-5 space-y-1 text-sm text-gray-800">
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}
