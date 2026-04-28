/**

- 90-Day Life Portfolio Tracker
- ─────────────────────────────
- A daily check-in app tracking 8 personal metrics across three pillars:
- Body, Mind, and Spirit. Scores are calculated against a personal baseline
- and displayed as a portfolio performance curve — no streaks, no chains.
- 
- Stack: React (hooks only), localStorage for persistence
- Upgrade path: swap localStorage calls in loadState/saveState for Supabase
- 
- File structure (single-file for artifact; split when deploying):
- - Constants & config
- - Scoring engine
- - Data persistence (load / save / export / import)
- - UI components (Icon, RingChart, Sparkline, StatusPill, DefModal)
- - Main App
    */

import { useState, useEffect, useRef } from “react”;

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// Matches Apple iOS system colors exactly.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
blue:       “#007AFF”,
blueLight:  “#EBF4FF”,
green:      “#34C759”,
orange:     “#FF9500”,
red:        “#FF3B30”,
purple:     “#5856D6”,
teal:       “#30B0C7”,
bg:         “#F2F2F7”,
card:       “#FFFFFF”,
text:       “#1C1C1E”,
text2:      “#8E8E93”,
text3:      “#C7C7CC”,
border:     “#E5E5EA”,
};

// ─────────────────────────────────────────────────────────────────────────────
// METRICS CONFIG
// Each metric defines its pillar, input type, scoring weight, personal
// baseline (used to calculate vs-baseline delta), and definition text.
//
// Weight rationale: Body metrics are 1.5x because that’s Eli’s primary
// anxiety pillar during a heavy travel/wedding season.
//
// To add a metric: add an entry here. Scoring engine handles it automatically.
// ─────────────────────────────────────────────────────────────────────────────
const METRICS = [
{
id: “sleep”,
label: “Sleep”,
sub: “Last night”,
pillar: “body”,
type: “number”,   // “number” | “bool”
unit: “hrs”,
weight: 1.5,
baseline: 7,      // average hours before this system
icon: “moon”,
definition: “Hours from lights out to alarm — log what happened last night. Target is 7.5hrs. The app tracks your 7-day rolling average, so one bad night doesn’t define the week.”,
},
{
id: “drinks”,
label: “Drinks”,
sub: “Today’s count”,
pillar: “body”,
type: “number”,
unit: “”,
weight: 1.5,
baseline: 2,      // average drinks per day before this system
icon: “drop”,
definition: “Total standard drinks today. Weekly budget is 10. You’ll see your running total live. A heavy wedding weekend is a drawdown — the question is how fast you recover.”,
},
{
id: “trained”,
label: “Trained”,
sub: “20+ min movement”,
pillar: “body”,
type: “bool”,
weight: 1.5,
baseline: 0.6,    // estimated completion rate before this system (0–1)
icon: “bolt”,
definition: “20+ minutes of intentional movement. Hotel gym counts. A 30-min ride counts. A walk does not, unless it was genuinely all you had.”,
},
{
id: “ate”,
label: “Ate Intentionally”,
sub: “2 protein-focused choices”,
pillar: “body”,
type: “bool”,
weight: 1.0,
baseline: 0.7,
icon: “leaf”,
definition: “You made at least two conscious food choices with protein in mind. Doesn’t require logging. Just: did you think about it, or did food just happen to you?”,
},
{
id: “focus”,
label: “Deep Focus”,
sub: “45+ min uninterrupted”,
pillar: “mind”,
type: “bool”,
weight: 1.0,
baseline: 0.65,
icon: “target”,
definition: “One uninterrupted block of 45+ minutes. Phone face-down, no Slack, working on something that actually matters. One block. That’s the whole ask.”,
},
{
id: “alarm”,
label: “First Alarm”,
sub: “No snooze”,
pillar: “spirit”,
type: “bool”,
weight: 1.0,
baseline: 0.55,
icon: “alarm”,
definition: “Up on the first alarm, no snooze. When this slips during a hectic stretch, the other discipline habits usually follow. It’s a leading indicator.”,
},
{
id: “tefillin”,
label: “Tefillin”,
sub: “Daily anchor”,
pillar: “spirit”,
type: “bool”,
weight: 1.0,
baseline: 0.75,
icon: “star”,
definition: “You know what this means. This is your identity anchor — the habit that, when you skip during a chaotic stretch, you feel the drift most.”,
},
{
id: “phone”,
label: “Phone Down”,
sub: “30 min before sleep”,
pillar: “spirit”,
type: “bool”,
weight: 1.0,
baseline: 0.5,
icon: “phone”,
definition: “Phone left your hand at least 30 minutes before you fell asleep. Plugged in across the room and reading counts. Scrolling in bed does not.”,
},
];

// Pillar display config
const PILLARS = {
body:   { label: “Body”,   color: C.blue },
mind:   { label: “Mind”,   color: C.teal },
spirit: { label: “Spirit”, color: C.purple },
};

const WEEKLY_DRINK_BUDGET = 10;
const STORAGE_KEY = “lp90_v3”;

// ─────────────────────────────────────────────────────────────────────────────
// SCORING ENGINE
// Converts a day’s entry into a 0–100 score.
//
// Bool metrics:    yes = 100pts, no = 0pts
// Sleep:           scored on a curve: 4.5hrs = 0, 7.5hrs = 100
// Drinks:          scored inversely: 0 drinks = 100, 6+ drinks = 0
//
// Each metric is weighted then normalized to 0–100.
// Body metrics weighted 1.5x (see METRICS config).
// ─────────────────────────────────────────────────────────────────────────────
function scoreEntry(entry) {
if (!entry) return null;
let total = 0, max = 0;

METRICS.forEach(m => {
max += m.weight * 100;
const val = entry[m.id];
if (val === undefined || val === null || val === “”) return;

```
if (m.type === "bool") {
  total += val ? m.weight * 100 : 0;
} else if (m.id === "drinks") {
  // 0 drinks → 100pts, 6 drinks → 0pts, linear
  total += Math.max(0, 100 - val * 16.67) * m.weight;
} else if (m.id === "sleep") {
  // 4.5hrs → 0pts, 7.5hrs → 100pts, capped
  total += Math.min(100, Math.max(0, ((val - 4.5) / 3) * 100)) * m.weight;
}
```

});

return max > 0 ? Math.round((total / max) * 100) : null;
}

/**

- BASELINE SCORE
- Calculated once from each metric’s `baseline` property.
- Represents “before this system” performance.
- All vs-baseline deltas are relative to this number.
  */
  const BASELINE = (() => {
  let total = 0, max = 0;
  METRICS.forEach(m => {
  max += m.weight * 100;
  if (m.type === “bool”) {
  total += m.baseline * m.weight * 100;
  } else if (m.id === “drinks”) {
  total += Math.max(0, 100 - m.baseline * 16.67) * m.weight;
  } else if (m.id === “sleep”) {
  total += Math.min(100, Math.max(0, ((m.baseline - 4.5) / 3) * 100)) * m.weight;
  }
  });
  return Math.round((total / max) * 100);
  })();

// Maps a score to a semantic color
function scoreColor(s) {
if (s === null) return C.text3;
if (s >= BASELINE + 10) return C.green;
if (s >= BASELINE)      return C.blue;
if (s >= BASELINE - 15) return C.orange;
return C.red;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function todayKey() {
return new Date().toISOString().slice(0, 10); // “YYYY-MM-DD”
}

/** Returns ISO date strings for the past 7 days, oldest first */
function last7Keys() {
return Array.from({ length: 7 }, (_, i) => {
const d = new Date();
d.setDate(d.getDate() - (6 - i));
return d.toISOString().slice(0, 10);
});
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA PERSISTENCE
// Currently uses localStorage. To upgrade to Supabase:
//   1. npm install @supabase/supabase-js
//   2. Replace loadState / saveState with async Supabase calls
//   3. Add useEffect to load on mount, debounced save on state change
// ─────────────────────────────────────────────────────────────────────────────

/** Load app state from localStorage, returning a fresh state if none exists */
function loadState() {
try {
const raw = localStorage.getItem(STORAGE_KEY);
if (raw) return JSON.parse(raw);
} catch (e) {
console.warn(“Failed to load state from localStorage”, e);
}
return {
entries: {},                          // { “YYYY-MM-DD”: { …metricValues } }
startDate: new Date().toISOString(),  // used to calculate Day X of 90
};
}

/**

- Export all app data as a downloadable JSON file.
- User saves this file to restore data after cache clears or device changes.
  */
  function exportData(state) {
  const payload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  …state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: “application/json” });
  const url = URL.createObjectURL(blob);
  const a = document.createElement(“a”);
  a.href = url;
  a.download = `life-portfolio-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  }

/**

- Import data from a previously exported JSON file.
- Validates basic structure before overwriting current state.
- Returns { success, state, error }.
  */
  function parseImportFile(file) {
  return new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = (e) => {
  try {
  const parsed = JSON.parse(e.target.result);
  if (!parsed.entries || !parsed.startDate) {
  resolve({ success: false, error: “Invalid file format — missing entries or startDate.” });
  return;
  }
  resolve({ success: true, state: { entries: parsed.entries, startDate: parsed.startDate } });
  } catch {
  resolve({ success: false, error: “Could not parse file. Make sure it’s a valid JSON export.” });
  }
  };
  reader.readAsText(file);
  });
  }

// ─────────────────────────────────────────────────────────────────────────────
// SVG ICON LIBRARY
// Inline SVGs — no external icon dependency needed.
// ─────────────────────────────────────────────────────────────────────────────
const ICON_PATHS = {
moon:    ({ c }) => <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
drop:    ({ c }) => <path d="M12 2C12 2 5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13z" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
bolt:    ({ c }) => <path d="M13 2L4.5 13.5H12L11 22L19.5 10.5H12L13 2Z" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
leaf:    ({ c }) => <><path d="M17 8C8 10 5.9 16.17 3.82 19.34L5.71 21c4-3 8-5 14-7-1-3-2-5-2.71-6z" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/><path d="M3.82 19.34C5 17 6 15 9 14" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/></>,
target:  ({ c }) => <><circle cx="12" cy="12" r="10" stroke={c} strokeWidth="1.8" fill="none"/><circle cx="12" cy="12" r="6" stroke={c} strokeWidth="1.8" fill="none"/><circle cx="12" cy="12" r="2" stroke={c} strokeWidth="1.8" fill="none"/></>,
alarm:   ({ c }) => <><circle cx="12" cy="13" r="8" stroke={c} strokeWidth="1.8" fill="none"/><path d="M12 9v4l2.5 2.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/><path d="M5 3L2 6M22 6l-3-3" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/></>,
star:    ({ c }) => <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
phone:   ({ c }) => <><rect x="7" y="2" width="10" height="20" rx="2" stroke={c} strokeWidth="1.8" fill="none"/><circle cx="12" cy="18" r="1" fill={c}/></>,
check:   ({ c }) => <path d="M20 6L9 17l-5-5" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
close:   ({ c }) => <path d="M18 6L6 18M6 6l12 12" stroke={c} strokeWidth="2" strokeLinecap="round" fill="none"/>,
info:    ({ c }) => <><circle cx="12" cy="12" r="10" stroke={c} strokeWidth="1.8" fill="none"/><path d="M12 8v4M12 16h.01" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/></>,
upload:  ({ c }) => <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/><polyline points="17 8 12 3 7 8" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="12" y1="3" x2="12" y2="15" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/></>,
download:({ c }) => <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/><polyline points="7 10 12 15 17 10" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/><line x1="12" y1="15" x2="12" y2="3" stroke={c} strokeWidth="1.8" strokeLinecap="round" fill="none"/></>,
warning: ({ c }) => <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke={c} strokeWidth="1.8" fill="none"/><line x1="12" y1="9" x2="12" y2="13" stroke={c} strokeWidth="1.8" strokeLinecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></>,
};

function Icon({ name, size = 20, color = C.text2 }) {
const Path = ICON_PATHS[name];
if (!Path) return null;
return (
<svg width={size} height={size} viewBox="0 0 24 24">
<Path c={color} />
</svg>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// RING CHART (Whoop-inspired)
// Draws your score as a filled arc. A ghost arc shows baseline underneath
// so you can always see the gap at a glance.
// ─────────────────────────────────────────────────────────────────────────────
function RingChart({ score, size = 80 }) {
const r = (size - 10) / 2;
const circ = 2 * Math.PI * r;
const scoreOffset    = score !== null ? circ - (score / 100) * circ : circ;
const baselineOffset = circ - (BASELINE / 100) * circ;
const color = scoreColor(score);

return (
<svg width={size} height={size} style={{ transform: “rotate(-90deg)” }}>
{/* Track */}
<circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={6} />
{/* Baseline ghost arc */}
<circle cx={size/2} cy={size/2} r={r} fill=“none” stroke={`${C.blue}30`}
strokeWidth={6} strokeDasharray={circ} strokeDashoffset={baselineOffset} strokeLinecap=“round” />
{/* Score arc */}
{score !== null && (
<circle cx={size/2} cy={size/2} r={r} fill=“none” stroke={color}
strokeWidth={6} strokeDasharray={circ} strokeDashoffset={scoreOffset}
strokeLinecap=“round”
style={{ transition: “stroke-dashoffset 0.6s cubic-bezier(0.34,1.56,0.64,1)” }} />
)}
</svg>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPARKLINE
// 7-day score trend with gradient fill and baseline dashed line.
// ─────────────────────────────────────────────────────────────────────────────
function Sparkline({ scores, width = 300 }) {
const h = 44, pad = 4;
const valid = scores.filter(s => s !== null);
if (valid.length < 2) return <div style={{ height: h }} />;

const allVals = […valid, BASELINE];
const min = Math.min(…allVals) - 8;
const max = Math.max(…allVals) + 8;
const range = max - min;

const pts = scores.map((s, i) => ({
x: pad + (i / (scores.length - 1)) * (width - pad * 2),
y: s !== null ? h - pad - ((s - min) / range) * (h - pad * 2) : null,
s,
}));

const baseY   = h - pad - ((BASELINE - min) / range) * (h - pad * 2);
const linePts = pts.filter(p => p.y !== null);
const path    = linePts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(” “);
const area    = `${path} L${linePts[linePts.length - 1].x},${h} L${linePts[0].x},${h} Z`;

return (
<svg width={width} height={h}>
<defs>
<linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%"   stopColor={C.blue} stopOpacity="0.15" />
<stop offset="100%" stopColor={C.blue} stopOpacity="0" />
</linearGradient>
</defs>
{/* Baseline reference line */}
<line x1={pad} y1={baseY} x2={width - pad} y2={baseY}
stroke={C.border} strokeWidth={1} strokeDasharray=“3,3” />
{/* Area fill */}
<path d={area} fill="url(#sparkGrad)" />
{/* Line */}
<path d={path} fill="none" stroke={C.blue} strokeWidth={2}
strokeLinecap="round" strokeLinejoin="round" />
{/* Dots */}
{pts.map((p, i) => p.y !== null && (
<circle key={i} cx={p.x} cy={p.y} r={3}
fill={p.s >= BASELINE ? C.blue : C.orange}
stroke=“white” strokeWidth={1.5} />
))}
</svg>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS PILL
// Translates vs-baseline delta into a human-readable label with color.
// ─────────────────────────────────────────────────────────────────────────────
function StatusPill({ vs }) {
if (vs === null) return null;
const cfg =
vs >= 15  ? { label: “Outperforming”, bg: “#E8FAF0”, color: C.green }  :
vs >= 5   ? { label: “Above baseline”, bg: C.blueLight, color: C.blue } :
vs >= -5  ? { label: “On track”,       bg: “#FFF5E6”, color: C.orange } :
vs >= -15 ? { label: “Minor drawdown”, bg: “#FFF0EE”, color: C.red }    :
{ label: “Recovering”,     bg: “#FFF0EE”, color: C.red };

return (
<span style={{ background: cfg.bg, color: cfg.color, fontSize: 11,
fontWeight: 600, padding: “3px 8px”, borderRadius: 20, letterSpacing: 0.2 }}>
{cfg.label}
</span>
);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFINITION MODAL
// Bottom sheet showing the agreed-upon definition for any metric.
// Tap the ⓘ icon on any metric row to open.
// ─────────────────────────────────────────────────────────────────────────────
function DefModal({ metric, onClose }) {
return (
<div onClick={onClose}
style={{ position: “fixed”, inset: 0, background: “rgba(0,0,0,0.3)”,
zIndex: 200, display: “flex”, alignItems: “flex-end” }}>
<div onClick={e => e.stopPropagation()}
style={{ background: C.card, borderRadius: “20px 20px 0 0”,
padding: “20px 24px 44px”, width: “100%”, maxWidth: 480,
margin: “0 auto”, boxShadow: “0 -4px 40px rgba(0,0,0,0.12)” }}>

```
    {/* Drag handle */}
    <div style={{ width: 36, height: 4, background: C.border,
      borderRadius: 2, margin: "0 auto 20px" }} />

    {/* Header */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10,
        background: C.blueLight, display: "flex",
        alignItems: "center", justifyContent: "center" }}>
        <Icon name={metric.icon} size={18} color={C.blue} />
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{metric.label}</div>
        <div style={{ fontSize: 12, color: C.text2 }}>{metric.sub}</div>
      </div>
      <button onClick={onClose}
        style={{ marginLeft: "auto", background: `${C.text2}18`, border: "none",
          borderRadius: 20, width: 28, height: 28, display: "flex",
          alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <Icon name="close" size={14} color={C.text2} />
      </button>
    </div>

    <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.65, margin: 0 }}>
      {metric.definition}
    </p>
  </div>
</div>
```

);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA MANAGEMENT MODAL
// Export / import / reset — lives in History tab.
// ─────────────────────────────────────────────────────────────────────────────
function DataModal({ state, onImport, onReset, onClose }) {
const fileRef = useRef();
const [importStatus, setImportStatus] = useState(null); // null | “success” | “error”
const [importMsg, setImportMsg]       = useState(””);

const handleFile = async (e) => {
const file = e.target.files?.[0];
if (!file) return;
const result = await parseImportFile(file);
if (result.success) {
onImport(result.state);
setImportStatus(“success”);
setImportMsg(`Imported ${Object.keys(result.state.entries).length} days of data.`);
} else {
setImportStatus(“error”);
setImportMsg(result.error);
}
};

return (
<div onClick={onClose}
style={{ position: “fixed”, inset: 0, background: “rgba(0,0,0,0.3)”,
zIndex: 200, display: “flex”, alignItems: “flex-end” }}>
<div onClick={e => e.stopPropagation()}
style={{ background: C.card, borderRadius: “20px 20px 0 0”,
padding: “20px 24px 44px”, width: “100%”, maxWidth: 480,
margin: “0 auto”, boxShadow: “0 -4px 40px rgba(0,0,0,0.12)” }}>

```
    <div style={{ width: 36, height: 4, background: C.border,
      borderRadius: 2, margin: "0 auto 20px" }} />

    <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>
      Data Management
    </div>
    <div style={{ fontSize: 13, color: C.text2, marginBottom: 24, lineHeight: 1.5 }}>
      Export your data as a JSON backup before clearing cache or moving devices.
      Import to restore a previous backup.
    </div>

    {/* Export */}
    <button onClick={() => exportData(state)}
      style={actionBtn(C.blue)}>
      <Icon name="download" size={18} color="#fff" />
      Export data as JSON
    </button>

    {/* Import */}
    <button onClick={() => fileRef.current?.click()}
      style={actionBtn(C.text2)}>
      <Icon name="upload" size={18} color="#fff" />
      Import from backup
    </button>
    <input ref={fileRef} type="file" accept=".json"
      onChange={handleFile} style={{ display: "none" }} />

    {/* Import feedback */}
    {importStatus && (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start",
        padding: "10px 14px", borderRadius: 10, marginBottom: 12,
        background: importStatus === "success" ? `${C.green}15` : `${C.red}10`,
        color: importStatus === "success" ? C.green : C.red,
        fontSize: 13, fontWeight: 500 }}>
        <Icon name={importStatus === "success" ? "check" : "warning"}
          size={16} color={importStatus === "success" ? C.green : C.red} />
        {importMsg}
      </div>
    )}

    {/* Reset */}
    <div style={{ height: 1, background: C.border, margin: "8px 0 16px" }} />
    <button onClick={() => {
      if (window.confirm("This will permanently delete all your data. Are you sure?")) {
        onReset();
        onClose();
      }
    }} style={{ ...actionBtn(C.red), background: `${C.red}10`,
      color: C.red, border: `1px solid ${C.red}30` }}>
      <Icon name="warning" size={18} color={C.red} />
      Reset all data
    </button>
  </div>
</div>
```

);
}

// Shared button style for DataModal actions
const actionBtn = (color) => ({
width: “100%”, padding: “13px 16px”, borderRadius: 12, border: “none”,
background: color === C.text2 ? C.bg : color,
color: color === C.text2 ? C.text : “#fff”,
fontSize: 15, fontWeight: 600, cursor: “pointer”,
display: “flex”, alignItems: “center”, gap: 10,
marginBottom: 10, textAlign: “left”,
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
const [state,      setState]      = useState(loadState);
const [view,       setView]       = useState(“today”);     // “today” | “portfolio” | “history”
const [defMetric,  setDefMetric]  = useState(null);        // metric object | null
const [showData,   setShowData]   = useState(false);       // data management modal
const [justSaved,  setJustSaved]  = useState(false);       // post-save animation

const today = todayKey();
const entry = state.entries[today] || {};

// Day counter
const daysElapsed = Math.min(90, Math.max(1,
Math.floor((Date.now() - new Date(state.startDate)) / 86400000) + 1));
const daysLeft = Math.max(0, 91 - daysElapsed);

// Persist to localStorage on every state change
useEffect(() => {
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
catch (e) { console.warn(“localStorage write failed”, e); }
}, [state]);

// ── Field setter ──────────────────────────────────────────────────────────
const setField = (id, val) => {
setJustSaved(false);
setState(s => ({
…s,
entries: { …s.entries, [today]: { …s.entries[today], [id]: val } },
}));
};

// ── Save today’s entry ────────────────────────────────────────────────────
const saveEntry = () => {
setState(s => ({
…s,
entries: { …s.entries, [today]: { …s.entries[today], _saved: true } },
}));
setJustSaved(true);
setTimeout(() => { setView(“portfolio”); setJustSaved(false); }, 800);
};

// ── Derived data ──────────────────────────────────────────────────────────
const keys7      = last7Keys();
const scores7    = keys7.map(k => scoreEntry(state.entries[k]));
const valid7     = scores7.filter(s => s !== null);
const avg7       = valid7.length > 0
? Math.round(valid7.reduce((a, b) => a + b, 0) / valid7.length) : null;
const vsBaseline = avg7 !== null ? avg7 - BASELINE : null;
const todayScore = scoreEntry(entry);

const weekDrinks = keys7.reduce((sum, k) =>
sum + (state.entries[k]?.drinks ? Number(state.entries[k].drinks) : 0), 0);

const allEntries     = Object.entries(state.entries).sort(([a], [b]) => b.localeCompare(a));
const fieldsAnswered = METRICS.filter(m =>
entry[m.id] !== undefined && entry[m.id] !== null && entry[m.id] !== “”).length;

const DAY_LABELS = [“Su”, “Mo”, “Tu”, “We”, “Th”, “Fr”, “Sa”];

// ── Pillar avg helper ─────────────────────────────────────────────────────
const pillarAvg = (pillarKey) => {
const pMetrics = METRICS.filter(m => m.pillar === pillarKey);
let t = 0, c = 0;
keys7.forEach(k => {
const e = state.entries[k]; if (!e) return;
pMetrics.forEach(m => {
const v = e[m.id];
if (v === undefined || v === null || v === “”) return;
if (m.type === “bool”) { t += v ? 100 : 0; c++; }
else if (m.id === “drinks”) { t += Math.max(0, 100 - v * 16.67); c++; }
else if (m.id === “sleep”)  { t += Math.min(100, Math.max(0, ((v - 4.5) / 3) * 100)); c++; }
});
});
return c > 0 ? Math.round(t / c) : null;
};

// ─────────────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────────────
return (
<div style={{ background: C.bg, minHeight: “100vh”, maxWidth: 480,
margin: “0 auto”, fontFamily: “-apple-system, ‘SF Pro Display’, ‘SF Pro Text’, sans-serif”,
color: C.text, paddingBottom: 90 }}>

```
  <style>{`
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    ::-webkit-scrollbar { display: none; }
    input[type=number] { -moz-appearance: textfield; }
    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
    @keyframes pop { 0%{transform:scale(1)} 40%{transform:scale(1.08)} 100%{transform:scale(1)} }
    .pop { animation: pop 0.25s ease; }
    @keyframes slideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    .slide-up { animation: slideUp 0.3s ease forwards; }
  `}</style>

  {/* Modals */}
  {defMetric && <DefModal metric={defMetric} onClose={() => setDefMetric(null)} />}
  {showData  && (
    <DataModal
      state={state}
      onImport={(imported) => { setState(imported); setShowData(false); }}
      onReset={() => setState({ entries: {}, startDate: new Date().toISOString() })}
      onClose={() => setShowData(false)}
    />
  )}

  {/* ── HEADER ── */}
  <div style={{ background: C.card, paddingTop: 56, borderBottom: `1px solid ${C.border}` }}>
    <div style={{ padding: "0 20px 16px" }}>

      {/* Score + days left */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 13, color: C.text2, fontWeight: 500, marginBottom: 2 }}>
            Day {daysElapsed} of 90
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}>
            {avg7 !== null
              ? <><span style={{ color: scoreColor(avg7) }}>{avg7}</span>
                  <span style={{ fontSize: 16, color: C.text3, fontWeight: 400 }}> / 100</span></>
              : <span style={{ color: C.text3 }}>—</span>}
          </div>
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 8 }}>
            <StatusPill vs={vsBaseline} />
            {vsBaseline !== null && (
              <span style={{ fontSize: 12, fontWeight: 600,
                color: vsBaseline >= 0 ? C.blue : C.orange }}>
                {vsBaseline > 0 ? "+" : ""}{vsBaseline} vs baseline
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "center", background: C.blueLight,
          borderRadius: 16, padding: "10px 16px" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.blue, lineHeight: 1 }}>{daysLeft}</div>
          <div style={{ fontSize: 10, color: C.blue, fontWeight: 600,
            letterSpacing: 0.5, marginTop: 1 }}>DAYS LEFT</div>
        </div>
      </div>

      {/* Sparkline + day labels */}
      <div style={{ marginTop: 14 }}>
        <Sparkline scores={scores7} width={320} />
        <div style={{ display: "flex", justifyContent: "space-between",
          width: 320, marginTop: 2 }}>
          {keys7.map((k, i) => (
            <span key={k} style={{ fontSize: 10, width: 40, textAlign: "center",
              color: k === today ? C.blue : C.text3,
              fontWeight: k === today ? 600 : 400 }}>
              {DAY_LABELS[new Date(k + "T12:00:00").getDay()]}
            </span>
          ))}
        </div>
      </div>
    </div>

    {/* Tab bar */}
    <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
      {[["today", "Log"], ["portfolio", "Portfolio"], ["history", "History"]].map(([v, l]) => (
        <button key={v} onClick={() => setView(v)}
          style={{ flex: 1, background: "none", border: "none", cursor: "pointer",
            padding: "12px 0 10px",
            borderBottom: view === v ? `2px solid ${C.blue}` : "2px solid transparent",
            color: view === v ? C.blue : C.text2,
            fontSize: 13, fontWeight: view === v ? 600 : 400,
            transition: "all 0.15s" }}>
          {l}
        </button>
      ))}
    </div>
  </div>

  {/* ── VIEWS ── */}
  <div style={{ padding: "20px 16px 0" }}>

    {/* ── LOG TODAY ── */}
    {view === "today" && (
      <div className="slide-up">
        <div style={{ fontSize: 12, color: C.text2, fontWeight: 500,
          marginBottom: 12, letterSpacing: 0.2 }}>
          {new Date().toLocaleDateString("en-US",
            { weekday: "long", month: "long", day: "numeric" })}
          {" · "}{fieldsAnswered}/{METRICS.length} logged
        </div>

        {/* Completion progress bar */}
        <div style={{ height: 3, background: C.border, borderRadius: 2,
          marginBottom: 20, overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 2, background: C.blue,
            width: `${(fieldsAnswered / METRICS.length) * 100}%`,
            transition: "width 0.3s ease" }} />
        </div>

        {/* Metrics grouped by pillar */}
        {Object.entries(PILLARS).map(([pillarKey, pillar]) => (
          <div key={pillarKey} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: pillar.color,
              letterSpacing: 0.5, marginBottom: 10, textTransform: "uppercase" }}>
              {pillar.label}
            </div>

            <div style={{ background: C.card, borderRadius: 16, overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              {METRICS.filter(m => m.pillar === pillarKey).map((m, idx, arr) => {
                const val      = entry[m.id];
                const answered = val !== undefined && val !== null && val !== "";

                return (
                  <div key={m.id}
                    style={{ borderBottom: idx < arr.length - 1
                      ? `1px solid ${C.border}` : "none" }}>

                    {/* Metric row header */}
                    <div style={{ display: "flex", alignItems: "center",
                      padding: "14px 16px 8px", gap: 12 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                        background: answered ? C.blueLight : `${C.text3}20`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.2s" }}>
                        <Icon name={m.icon} size={16} color={answered ? C.blue : C.text3} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
                          {m.label}
                        </div>
                        <div style={{ fontSize: 12, color: C.text2 }}>{m.sub}</div>
                      </div>
                      {/* Definition info button */}
                      <button onClick={() => setDefMetric(m)}
                        style={{ background: "none", border: "none",
                          cursor: "pointer", padding: 4,
                          display: "flex", alignItems: "center" }}>
                        <Icon name="info" size={16} color={`${C.blue}80`} />
                      </button>
                    </div>

                    {/* Input area */}
                    <div style={{ padding: "0 16px 14px 60px" }}>

                      {/* Bool: Yes / No */}
                      {m.type === "bool" && (
                        <div style={{ display: "flex", gap: 8 }}>
                          {[true, false].map(opt => {
                            const active = val === opt;
                            return (
                              <button key={String(opt)} className={active ? "pop" : ""}
                                onClick={() => setField(m.id, opt)}
                                style={{ flex: 1, padding: "9px 0", borderRadius: 10, cursor: "pointer",
                                  fontSize: 14, fontWeight: 600, transition: "all 0.15s",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                  border: `1.5px solid ${active ? (opt ? C.green : C.red) : C.border}`,
                                  background: active ? (opt ? `${C.green}15` : `${C.red}10`) : C.card,
                                  color: active ? (opt ? C.green : C.red) : C.text2 }}>
                                {active && opt && <Icon name="check" size={14} color={C.green} />}
                                {opt ? "Yes" : "No"}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Number: stepper + text input */}
                      {m.type === "number" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center",
                            background: C.bg, borderRadius: 10, overflow: "hidden",
                            border: `1.5px solid ${answered ? C.blue : C.border}`,
                            transition: "border-color 0.15s" }}>
                            <button onClick={() => setField(m.id,
                              Math.max(0, Number(val || 0) - (m.id === "sleep" ? 0.5 : 1)))}
                              style={{ background: "none", border: "none", width: 40, height: 40,
                                fontSize: 20, color: C.text2, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center" }}>−
                            </button>
                            <input type="number" value={val ?? ""} placeholder="—"
                              onChange={e => setField(m.id,
                                e.target.value === "" ? "" : Number(e.target.value))}
                              style={{ width: 52, height: 40, textAlign: "center",
                                border: "none", background: "transparent",
                                fontSize: 17, fontWeight: 600, color: C.text, outline: "none" }} />
                            <button onClick={() => setField(m.id,
                              Number(val || 0) + (m.id === "sleep" ? 0.5 : 1))}
                              style={{ background: "none", border: "none", width: 40, height: 40,
                                fontSize: 20, color: C.text2, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center" }}>+
                            </button>
                          </div>
                          <span style={{ fontSize: 13, color: C.text2 }}>{m.unit}</span>

                          {/* Contextual inline status */}
                          {m.id === "sleep" && answered && (
                            <span style={{ fontSize: 12, fontWeight: 600, marginLeft: "auto",
                              color: val >= 7.5 ? C.green : val >= 6 ? C.orange : C.red }}>
                              {val >= 7.5 ? "On target" : val >= 6 ? "Below target" : "Low"}
                            </span>
                          )}
                          {m.id === "drinks" && answered && val > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 600, marginLeft: "auto",
                              color: weekDrinks > WEEKLY_DRINK_BUDGET ? C.red
                                   : weekDrinks > 7 ? C.orange : C.text2 }}>
                              {weekDrinks}/{WEEKLY_DRINK_BUDGET} this week
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Today's score preview */}
        {todayScore !== null && (
          <div style={{ background: C.card, borderRadius: 16, padding: "14px 16px",
            marginBottom: 16, display: "flex", justifyContent: "space-between",
            alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 14, color: C.text2 }}>Today's score</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor(todayScore) }}>
                {todayScore}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600,
                color: todayScore >= BASELINE ? C.blue : C.orange }}>
                {todayScore >= BASELINE ? "+" : ""}{todayScore - BASELINE} vs baseline
              </span>
            </div>
          </div>
        )}

        {/* Save button */}
        <button onClick={saveEntry}
          style={{ width: "100%", padding: "15px", borderRadius: 14, border: "none",
            background: justSaved ? C.green : C.blue, color: "#fff",
            fontSize: 16, fontWeight: 700, cursor: "pointer",
            letterSpacing: 0.2, marginBottom: 8, transition: "background 0.3s",
            boxShadow: `0 4px 16px ${justSaved ? C.green : C.blue}40` }}>
          {justSaved ? "✓ Logged"
            : fieldsAnswered === METRICS.length ? "Log Today"
            : `Log Today (${fieldsAnswered}/${METRICS.length})`}
        </button>
        <div style={{ fontSize: 12, color: C.text3, textAlign: "center", paddingBottom: 8 }}>
          You can log partial and return later
        </div>
      </div>
    )}

    {/* ── PORTFOLIO ── */}
    {view === "portfolio" && (
      <div className="slide-up">

        {/* Hero: ring + score */}
        <div style={{ background: C.card, borderRadius: 20, padding: "20px",
          marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 12, color: C.text2, fontWeight: 500, marginBottom: 14 }}>
            7-Day Performance
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ position: "relative", width: 80, height: 80, flexShrink: 0 }}>
              <RingChart score={avg7} size={80} />
              <div style={{ position: "absolute", inset: 0, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 700,
                  color: scoreColor(avg7), lineHeight: 1 }}>{avg7 ?? "—"}</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1,
                color: vsBaseline !== null
                  ? (vsBaseline >= 0 ? C.blue : C.orange) : C.text3 }}>
                {vsBaseline !== null
                  ? `${vsBaseline > 0 ? "+" : ""}${vsBaseline}` : "—"}
              </div>
              <div style={{ fontSize: 12, color: C.text2, marginTop: 2 }}>vs your baseline</div>
              <div style={{ marginTop: 8 }}><StatusPill vs={vsBaseline} /></div>
            </div>
          </div>
        </div>

        {/* Weekly drinks budget */}
        <div style={{ background: C.card, borderRadius: 20, padding: "16px 20px",
          marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Weekly Drinks</div>
            <div style={{ fontSize: 14, fontWeight: 700,
              color: weekDrinks > WEEKLY_DRINK_BUDGET ? C.red
                   : weekDrinks > 7 ? C.orange : C.green }}>
              {weekDrinks}
              <span style={{ fontSize: 12, color: C.text2, fontWeight: 400 }}>
                {" "}/ {WEEKLY_DRINK_BUDGET}
              </span>
            </div>
          </div>
          <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, transition: "width 0.4s",
              width: `${Math.min(100, (weekDrinks / WEEKLY_DRINK_BUDGET) * 100)}%`,
              background: weekDrinks > WEEKLY_DRINK_BUDGET ? C.red
                         : weekDrinks > 7 ? C.orange : C.green }} />
          </div>
          <div style={{ fontSize: 12, color: C.text2, marginTop: 6 }}>
            {WEEKLY_DRINK_BUDGET - weekDrinks > 0
              ? `${WEEKLY_DRINK_BUDGET - weekDrinks} remaining this week`
              : "Over weekly budget — recovery week"}
          </div>
        </div>

        {/* Daily scores */}
        <div style={{ background: C.card, borderRadius: 20, padding: "16px 20px",
          marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Daily Scores</div>
          {keys7.map((k, i) => {
            const s       = scores7[i];
            const isToday = k === today;
            const label   = new Date(k + "T12:00:00")
              .toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
            return (
              <div key={k} style={{ display: "flex", alignItems: "center",
                gap: 10, marginBottom: i < 6 ? 10 : 0 }}>
                <span style={{ fontSize: 12, width: 68, flexShrink: 0,
                  color: isToday ? C.blue : C.text2,
                  fontWeight: isToday ? 600 : 400 }}>{label}</span>
                <div style={{ flex: 1, height: 4, background: C.bg,
                  borderRadius: 2, overflow: "hidden" }}>
                  {s !== null && (
                    <div style={{ height: "100%", width: `${s}%`,
                      background: scoreColor(s), borderRadius: 2,
                      transition: "width 0.4s" }} />
                  )}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, width: 24,
                  textAlign: "right",
                  color: s !== null ? scoreColor(s) : C.text3 }}>{s ?? "—"}</span>
              </div>
            );
          })}
        </div>

        {/* Pillar breakdown */}
        <div style={{ background: C.card, borderRadius: 20, padding: "16px 20px",
          marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
            Pillar Breakdown
          </div>
          {Object.entries(PILLARS).map(([key, pillar]) => {
            const avg = pillarAvg(key);
            return (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: pillar.color }}>
                    {pillar.label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600,
                    color: avg !== null ? scoreColor(avg) : C.text3 }}>
                    {avg ?? "—"}
                  </span>
                </div>
                <div style={{ height: 5, background: C.bg, borderRadius: 3,
                  overflow: "hidden" }}>
                  {avg !== null && (
                    <div style={{ height: "100%", width: `${avg}%`,
                      background: pillar.color, borderRadius: 3,
                      opacity: 0.85, transition: "width 0.4s" }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* ── HISTORY ── */}
    {view === "history" && (
      <div className="slide-up">
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: C.text2, fontWeight: 500 }}>
            {allEntries.length} days logged
          </div>
          {/* Data management button */}
          <button onClick={() => setShowData(true)}
            style={{ display: "flex", alignItems: "center", gap: 6,
              background: C.blueLight, border: "none", borderRadius: 20,
              padding: "6px 12px", color: C.blue, fontSize: 12,
              fontWeight: 600, cursor: "pointer" }}>
            <Icon name="download" size={14} color={C.blue} />
            Backup / Restore
          </button>
        </div>

        {allEntries.length === 0 ? (
          <div style={{ background: C.card, borderRadius: 20, padding: "40px 20px",
            textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 15, color: C.text2 }}>
              No entries yet — log your first day to get started.
            </div>
          </div>
        ) : (
          allEntries.map(([k, e]) => {
            const s       = scoreEntry(e);
            const isToday = k === today;
            const label   = new Date(k + "T12:00:00")
              .toLocaleDateString("en-US",
                { weekday: "short", month: "short", day: "numeric" });
            return (
              <div key={k}
                style={{ background: C.card, borderRadius: 14, padding: "14px 16px",
                  marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600,
                    color: isToday ? C.blue : C.text }}>
                    {label}{isToday ? " · Today" : ""}
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                    {METRICS.map(m => {
                      const v = e[m.id];
                      if (v === undefined || v === null || v === "") return null;
                      const good = m.type === "bool" ? v
                        : m.id === "sleep" ? v >= 7 : v <= 2;
                      return (
                        <span key={m.id}
                          style={{ fontSize: 11, fontWeight: 500,
                            padding: "2px 7px", borderRadius: 20,
                            color: good ? C.green : C.orange,
                            background: good ? `${C.green}12` : `${C.orange}12` }}>
                          {m.label.split(" ")[0]}: {m.type === "bool"
                            ? (v ? "✓" : "✗") : `${v}${m.unit}`}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div style={{ textAlign: "center", flexShrink: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 700,
                    color: s !== null ? scoreColor(s) : C.text3 }}>{s ?? "—"}</div>
                  <div style={{ fontSize: 10, color: C.text3, fontWeight: 500 }}>score</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    )}
  </div>

  {/* ── BOTTOM TAB BAR ── */}
  <div style={{ position: "fixed", bottom: 0, left: "50%",
    transform: "translateX(-50%)", width: "100%", maxWidth: 480,
    background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
    borderTop: `1px solid ${C.border}`, display: "flex", paddingBottom: 8 }}>
    {[["today", "Log"], ["portfolio", "Portfolio"], ["history", "History"]].map(([v, l]) => (
      <button key={v} onClick={() => setView(v)}
        style={{ flex: 1, background: "none", border: "none", cursor: "pointer",
          padding: "10px 0 4px", display: "flex",
          flexDirection: "column", alignItems: "center", gap: 3 }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%",
          background: view === v ? C.blue : "transparent",
          transition: "background 0.15s" }} />
        <span style={{ fontSize: 11, letterSpacing: 0.2,
          fontWeight: view === v ? 600 : 400,
          color: view === v ? C.blue : C.text2 }}>{l}</span>
      </button>
    ))}
  </div>
</div>
```

);
}
