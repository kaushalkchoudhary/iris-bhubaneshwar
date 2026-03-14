import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { motion } from 'framer-motion';
import type { ReactElement } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie,
  ComposedChart, Line, RadialBarChart, RadialBar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceLine,
} from 'recharts';
import {
  Activity, BarChart3, RefreshCw, ScanFace, UserCheck, UserX, FileText,
  Clock, Target, TrendingUp, Zap,
} from 'lucide-react';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HudBadge } from '@/components/ui/hud-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { apiClient } from '@/lib/api';
import type { Person, FRSStats, FRSMatch, FRSTimelineBucket } from '@/lib/api';
import { FRSReportModal } from './FRSReportModal';

type TimeRange = 'today' | '7d' | '30d' | 'all';
type DataLimit = 1000 | 5000 | 10000;
type Granularity = 'day' | 'hour';

interface AllStats {
  frsStats: FRSStats | null;
  frsPersons: Person[] | null;
  frsDetections: FRSMatch[] | null;
  frsTimeline: FRSTimelineBucket[] | null;
}

const THREAT_COLORS: Record<string, string> = {
  HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#10b981', UNKNOWN: '#6366f1',
};
const INDIGO_PALETTE = ['#6366f1', '#818cf8', '#4f46e5', '#8b5cf6', '#7c3aed', '#a78bfa', '#6366f1', '#818cf8'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isKnown(det: FRSMatch): boolean {
  return !!(det.personId || (det.metadata as any)?.person_id || (det.metadata as any)?.is_known);
}

function getTimeRangeParams(range: TimeRange): { startTime?: string; endTime?: string } {
  if (range === 'all') return {};
  const now = new Date();
  let start: Date;
  switch (range) {
    case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case '7d': start = new Date(now.getTime() - 7 * 86400000); break;
    case '30d': start = new Date(now.getTime() - 30 * 86400000); break;
  }
  return { startTime: start!.toISOString(), endTime: now.toISOString() };
}

function fmtN(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Chart data builders ───────────────────────────────────────────────────────

function buildTimelineFromBuckets(buckets: FRSTimelineBucket[], granularity: Granularity) {
  return buckets.map(b => {
    const d = new Date(b.period);
    const label = granularity === 'hour'
      ? `${d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} ${d.getHours().toString().padStart(2, '0')}:00`
      : d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return { label, known: b.known, unknown: b.unknown, total: b.total };
  });
}

function buildTimelineFromDetections(detections: FRSMatch[], granularity: Granularity): FRSTimelineBucket[] {
  const map = new Map<string, FRSTimelineBucket>();
  for (const det of detections) {
    const ts = new Date(det.timestamp);
    const key = granularity === 'hour'
      ? new Date(ts.getFullYear(), ts.getMonth(), ts.getDate(), ts.getHours(), 0, 0, 0).toISOString()
      : new Date(ts.getFullYear(), ts.getMonth(), ts.getDate(), 0, 0, 0, 0).toISOString();

    const cur = map.get(key) ?? { period: key, total: 0, known: 0, unknown: 0 };
    cur.total += 1;
    if (isKnown(det)) cur.known += 1; else cur.unknown += 1;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
}

function deriveStatsFromDetections(detections: FRSMatch[]): FRSStats {
  const byDevice = new Map<string, { deviceId: string; deviceName: string; count: number }>();
  const byPerson = new Map<string, {
    personId: string; personName: string; faceImageUrl: string; count: number; lastSeen: string; confSum: number;
  }>();

  let totalDetections = 0;
  let knownDetections = 0;
  let unknownDetections = 0;
  let confSum = 0;

  for (const det of detections) {
    totalDetections += 1;
    const conf = det.confidence ?? det.matchScore ?? 0;
    confSum += conf;

    if (isKnown(det)) knownDetections += 1; else unknownDetections += 1;

    const deviceId = det.deviceId ?? 'unknown';
    const deviceName = (det.device as any)?.name ?? deviceId;
    const d = byDevice.get(deviceId) ?? { deviceId, deviceName, count: 0 };
    d.count += 1;
    byDevice.set(deviceId, d);

    const personId = det.personId ?? (det.metadata as any)?.person_id;
    if (personId) {
      const personName = det.person?.name ?? (det.metadata as any)?.person_name ?? personId;
      const faceImageUrl = det.person?.faceImageUrl ?? (det.metadata as any)?.person_face_url ?? '';
      const p = byPerson.get(personId) ?? {
        personId,
        personName,
        faceImageUrl,
        count: 0,
        lastSeen: det.timestamp,
        confSum: 0,
      };
      p.count += 1;
      p.confSum += conf;
      if (new Date(det.timestamp).getTime() > new Date(p.lastSeen).getTime()) {
        p.lastSeen = det.timestamp;
      }
      byPerson.set(personId, p);
    }
  }

  const byDeviceArr = Array.from(byDevice.values()).sort((a, b) => b.count - a.count);
  const byPersonArr = Array.from(byPerson.values())
    .map((p) => ({
      personId: p.personId,
      personName: p.personName,
      faceImageUrl: p.faceImageUrl,
      count: p.count,
      lastSeen: p.lastSeen,
      avgConfidence: p.count > 0 ? p.confSum / p.count : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDetections,
    knownDetections,
    unknownDetections,
    avgConfidence: totalDetections > 0 ? confSum / totalDetections : 0,
    byDevice: byDeviceArr,
    byPerson: byPersonArr,
  };
}

function buildHourlyPattern(detections: FRSMatch[]) {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h.toString().padStart(2, '0')}h`, known: 0, unknown: 0, total: 0,
  }));
  for (const det of detections) {
    const h = new Date(det.timestamp).getHours();
    if (isKnown(det)) hours[h].known++; else hours[h].unknown++;
    hours[h].total++;
  }
  return hours;
}

function buildConfidenceDist(detections: FRSMatch[]) {
  const buckets = [
    { range: '0–20%', min: 0, max: 0.2, known: 0, unknown: 0 },
    { range: '20–40%', min: 0.2, max: 0.4, known: 0, unknown: 0 },
    { range: '40–60%', min: 0.4, max: 0.6, known: 0, unknown: 0 },
    { range: '60–80%', min: 0.6, max: 0.8, known: 0, unknown: 0 },
    { range: '80–100%', min: 0.8, max: 1.01, known: 0, unknown: 0 },
  ];
  for (const det of detections) {
    const conf = det.confidence ?? det.matchScore ?? 0;
    const b = buckets.find(b => conf >= b.min && conf < b.max);
    if (b) { if (isKnown(det)) b.known++; else b.unknown++; }
  }
  return buckets.map(({ range, known, unknown }) => ({ range, known, unknown, total: known + unknown }));
}

// ── Tooltip primitives ────────────────────────────────────────────────────────

const TT = 'bg-zinc-950/96 border border-white/10 rounded-lg shadow-2xl backdrop-blur-sm';
const TTLabel = 'text-zinc-400 text-[10px] font-mono pb-1.5 mb-1.5 border-b border-white/5';
const TTRow = 'flex items-center justify-between gap-4';
const TTKey = 'text-zinc-500 text-[10px] font-mono';
const TTVal = 'text-zinc-200 text-xs font-mono font-bold';

function AreaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const known = payload.find((p: any) => p.dataKey === 'known')?.value ?? 0;
  const unknown = payload.find((p: any) => p.dataKey === 'unknown')?.value ?? 0;
  const total = known + unknown;
  const kPct = total > 0 ? `${((known / total) * 100).toFixed(0)}%` : '—';
  const uPct = total > 0 ? `${((unknown / total) * 100).toFixed(0)}%` : '—';
  return (
    <div className={`${TT} p-3 min-w-[175px]`}>
      <p className={TTLabel}>{label}</p>
      <div className="space-y-1.5">
        <div className={TTRow}>
          <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />Known
          </span>
          <span className="text-emerald-400 text-xs font-mono font-bold">
            {fmtN(known)} <span className="text-zinc-600 font-normal text-[10px]">({kPct})</span>
          </span>
        </div>
        <div className={TTRow}>
          <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />Unknown
          </span>
          <span className="text-amber-400 text-xs font-mono font-bold">
            {fmtN(unknown)} <span className="text-zinc-600 font-normal text-[10px]">({uPct})</span>
          </span>
        </div>
        {total > 0 && (
          <div className={`${TTRow} pt-1 border-t border-white/5`}>
            <span className={TTKey}>Total</span>
            <span className={TTVal}>{fmtN(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StackedBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const kEntry = payload.find((p: any) => p.dataKey === 'known');
  const uEntry = payload.find((p: any) => p.dataKey === 'unknown');
  const kv = kEntry?.value ?? 0; const uv = uEntry?.value ?? 0; const total = kv + uv;
  const kc = kEntry?.fill ?? '#10b981'; const uc = uEntry?.fill ?? '#f59e0b';
  return (
    <div className={`${TT} px-3 py-2.5 min-w-[155px]`}>
      <p className={TTLabel}>{label}</p>
      <div className="space-y-1">
        {[{ label: 'Known', v: kv, c: kc }, { label: 'Unknown', v: uv, c: uc }].map(r => (
          <div key={r.label} className={TTRow}>
            <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.c }} />{r.label}
            </span>
            <span className="text-xs font-mono font-bold" style={{ color: r.c }}>
              {r.v}{total > 0 && <span className="text-zinc-600 font-normal"> · {((r.v / total) * 100).toFixed(0)}%</span>}
            </span>
          </div>
        ))}
        {total > 0 && (
          <div className={`${TTRow} pt-1 border-t border-white/5`}>
            <span className={TTKey}>Total</span><span className={TTVal}>{total}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ParetoTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const count = payload.find((p: any) => p.dataKey === 'count')?.value ?? 0;
  const cumPct = payload.find((p: any) => p.dataKey === 'cumPct')?.value ?? 0;
  const pct = payload.find((p: any) => p.dataKey === 'pct')?.value ?? 0;
  return (
    <div className={`${TT} px-3 py-2.5 min-w-[170px]`}>
      <p className="text-zinc-200 text-[11px] font-mono font-semibold pb-1.5 mb-1.5 border-b border-white/5 truncate">{label}</p>
      <div className="space-y-1">
        <div className={TTRow}><span className={TTKey}>Detections</span><span className={TTVal}>{fmtN(count)}</span></div>
        <div className={TTRow}><span className={TTKey}>Share</span><span className="text-indigo-400 text-xs font-mono font-bold">{pct.toFixed(1)}%</span></div>
        <div className={`${TTRow} pt-1 border-t border-white/5`}>
          <span className={TTKey}>Cumulative</span>
          <span className={`text-xs font-mono font-bold ${cumPct >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{cumPct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function PersonTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className={`${TT} px-3 py-2.5 min-w-[165px]`}>
      <p className="text-zinc-200 text-[11px] font-mono font-semibold pb-1.5 mb-1.5 border-b border-white/5 truncate">{d.name}</p>
      <div className="space-y-1">
        <div className={TTRow}><span className={TTKey}>Detections</span><span className={TTVal}>{fmtN(d.count)}</span></div>
        {d.avgConf > 0 && (
          <div className={TTRow}><span className={TTKey}>Avg Conf</span><span className="text-indigo-400 text-xs font-mono font-bold">{(d.avgConf * 100).toFixed(1)}%</span></div>
        )}
        {d.cumPct != null && (
          <div className={TTRow}><span className={TTKey}>Cumulative</span><span className="text-amber-400 text-xs font-mono font-bold">{d.cumPct.toFixed(1)}%</span></div>
        )}
        {d.lastSeen && (
          <div className={`${TTRow} pt-1 border-t border-white/5`}>
            <span className={TTKey}>Last Seen</span>
            <span className="text-zinc-400 text-[10px] font-mono">{new Date(d.lastSeen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const e = payload[0];
  return (
    <div className={`${TT} px-3 py-2.5`}>
      <div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-white/5">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.fill ?? e.color }} />
        <span className="text-zinc-200 text-xs font-mono font-semibold">{e.name}</span>
      </div>
      <div className="space-y-0.5">
        <div className={TTRow}><span className={TTKey}>Count</span><span className={TTVal}>{fmtN(e.value)}</span></div>
        {e.percent != null && (
          <div className={TTRow}><span className={TTKey}>Share</span><span className="text-indigo-400 text-xs font-mono font-bold">{(e.percent * 100).toFixed(1)}%</span></div>
        )}
      </div>
    </div>
  );
}

function BumpTooltip({ hov, mousePos, data, labels }: any) {
  if (hov === null) return null;
  const d = data[hov];
  return (
    <div className={`${TT} p-3 min-w-[150px] absolute z-50 pointer-events-none`}
      style={{ left: mousePos.x + 15, top: mousePos.y - 40 }}>
      <p className={TTLabel}>{d.name}</p>
      <div className="space-y-1">
        {d.ranks.map((r: any, i: number) => r && (
          <div key={i} className={TTRow}>
            <span className={TTKey}>{labels?.[i] || `P${i + 1}`}</span>
            <span className="text-xs font-mono font-bold text-indigo-400">Rank #{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function JoyTooltip({ hov, mousePos, data }: any) {
  if (hov === null) return null;
  const d = data[hov];
  const max = Math.max(...d.values);
  return (
    <div className={`${TT} p-3 min-w-[140px] absolute z-50 pointer-events-none`}
      style={{ left: mousePos.x + 15, top: mousePos.y - 40 }}>
      <p className={TTLabel}>{d.name}</p>
      <div className={TTRow}>
        <span className={TTKey}>Max Intensity</span>
        <span className="text-xs font-mono font-bold text-indigo-400">{max}</span>
      </div>
      <div className={TTRow}>
        <span className={TTKey}>Avg Activity</span>
        <span className="text-xs font-mono font-bold text-zinc-300">{(d.values.reduce((a: any, b: any) => a + b, 0) / 24).toFixed(1)}/h</span>
      </div>
    </div>
  );
}


// ── KPI building blocks ───────────────────────────────────────────────────────

function RingGauge({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 100)) * circ;
  return (
    <svg width={size} height={size} className="shrink-0" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
    </svg>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden w-full mt-2">
      <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

interface KPICardProps {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  gaugePct?: number;
  gaugeColor?: string;
  loading?: boolean;
}

function KPICard({ label, value, sub, icon: Icon, accent, gaugePct, gaugeColor, loading }: KPICardProps) {
  if (loading) return (
    <Card className="border border-white/5 bg-zinc-900/30">
      <CardContent className="p-4">
        <Skeleton className="h-3 w-16 mb-3" />
        <Skeleton className="h-8 w-20 mb-2" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
  return (
    <Card className="border border-white/5 bg-zinc-900/30 backdrop-blur-sm hover:border-indigo-500/20 transition-all duration-200">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase mb-2">{label}</div>
            <div className={`text-3xl font-mono font-bold leading-none ${accent}`}>
              {typeof value === 'number' ? fmtN(value) : value}
            </div>
            <div className="text-[10px] font-mono text-zinc-600 mt-1.5">{sub}</div>
          </div>
          {gaugePct != null && gaugeColor ? (
            <div className="relative shrink-0">
              <RingGauge pct={gaugePct} color={gaugeColor} size={64} />
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold"
                style={{ color: gaugeColor }}>{gaugePct.toFixed(0)}%</span>
            </div>
          ) : (
            <Icon className="h-4 w-4 text-zinc-700 shrink-0 mt-0.5" />
          )}
        </div>
        {gaugePct != null && gaugeColor && <ProgressBar pct={gaugePct} color={gaugeColor} />}
      </CardContent>
    </Card>
  );
}

// ── ChartCard wrapper ─────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children, className, action }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  return (
    <Card className={`border border-white/5 bg-zinc-900/30 backdrop-blur-sm h-full ${className ?? ''}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-3 min-w-0 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-[11px] font-mono tracking-wider text-zinc-400 uppercase">{title}</CardTitle>
            {subtitle && <p className="text-[10px] font-mono text-zinc-600 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

// ── Legend helper ─────────────────────────────────────────────────────────────

function ColorLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {items.map(({ label, color }) => (
        <span key={label} className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />{label}
        </span>
      ))}
    </div>
  );
}

// ── PillGroup ─────────────────────────────────────────────────────────────────

function PillGroup<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T; onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mr-1">{label}</span>}
      <div className="flex bg-white/5 rounded-md border border-white/5 p-0.5">
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${value === o.value ? 'bg-indigo-500/30 text-indigo-300' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Sankey chart (custom SVG) ─────────────────────────────────────────────────

interface CamFlow { name: string; known: number; unknown: number }

function SankeyChart({ flows, knownTotal, unknownTotal }: {
  flows: CamFlow[]; knownTotal: number; unknownTotal: number;
}) {
  const [hovCam, setHovCam] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const grand = knownTotal + unknownTotal;
  if (!grand || !flows.length) return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-[11px] font-mono">No flow data</div>
  );

  const VW = 460;
  const NW = 16;
  const VGAP = 5;
  const TOPY = 8;
  const availH = Math.max(200, flows.length * 24);
  const scale = (v: number) => (v / grand) * (availH - VGAP * Math.max(flows.length - 1, 0));

  let camOffsetY = TOPY;
  const cams = flows.map(f => {
    const h = Math.max(10, scale(f.known + f.unknown));
    const kH = scale(f.known);
    const uH = scale(f.unknown);
    const node = { ...f, y: camOffsetY, h, kH, uH };
    camOffsetY += h + VGAP;
    return node;
  });

  // Right side: stack known on top, unknown below, centered against cameras
  const totalCamH = camOffsetY - VGAP - TOPY;
  const kH_r = Math.max(16, scale(knownTotal));
  const uH_r = Math.max(16, scale(unknownTotal));
  const rightGap = 8;
  const rightTotalH = kH_r + rightGap + uH_r;
  const rightStartY = TOPY + Math.max(0, (totalCamH - rightTotalH) / 2);
  const kY_r = rightStartY;
  const uY_r = rightStartY + kH_r + rightGap;

  const LX = 100;
  const RX = 330;
  const CP1X = LX + NW + (RX - LX - NW) * 0.4;
  const CP2X = RX - (RX - LX - NW) * 0.4;

  // Build ribbon paths per camera
  const ribbonData: { cam: typeof cams[0]; kPath?: string; uPath?: string }[] = [];
  let rkOff = kY_r;
  let ruOff = uY_r;
  for (const cam of cams) {
    const entry: typeof ribbonData[0] = { cam };
    if (cam.known > 0) {
      const lT = cam.y, lB = cam.y + cam.kH;
      const rT = rkOff, rB = rkOff + cam.kH;
      rkOff += cam.kH;
      entry.kPath = `M${LX + NW},${lT} C${CP1X},${lT} ${CP2X},${rT} ${RX},${rT} L${RX},${rB} C${CP2X},${rB} ${CP1X},${lB} ${LX + NW},${lB} Z`;
    }
    if (cam.unknown > 0) {
      const lT = cam.y + cam.kH, lB = cam.y + cam.h;
      const rT = ruOff, rB = ruOff + cam.uH;
      ruOff += cam.uH;
      entry.uPath = `M${LX + NW},${lT} C${CP1X},${lT} ${CP2X},${rT} ${RX},${rT} L${RX},${rB} C${CP2X},${rB} ${CP1X},${lB} ${LX + NW},${lB} Z`;
    }
    ribbonData.push(entry);
  }

  const svgH = Math.max(camOffsetY, uY_r + uH_r) + 8;
  const hovData = cams.find(c => c.name === hovCam);

  return (
    <div ref={containerRef} className="relative w-full h-full"
      onMouseMove={e => {
        const r = containerRef.current?.getBoundingClientRect();
        if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setHovCam(null)}>
      <svg viewBox={`0 0 ${VW} ${svgH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">

        {/* Ribbons + invisible hover zones per camera */}
        {ribbonData.map(({ cam, kPath, uPath }, i) => {
          const isHov = hovCam === null || hovCam === cam.name;
          return (
            <g key={cam.name}
              onMouseEnter={() => setHovCam(cam.name)}
              className="cursor-pointer">
              {/* Invisible wide hit area spanning full row */}
              <rect x={0} y={cam.y - 2} width={VW} height={cam.h + 4} fill="transparent" />
              {kPath && (
                <path d={kPath}
                  fill="#10b981" fillOpacity={isHov ? 0.3 : 0.06}
                  stroke="#10b981" strokeOpacity={isHov ? 0.6 : 0.12} strokeWidth={0.5}
                  className="transition-all duration-200" />
              )}
              {uPath && (
                <path d={uPath}
                  fill="#f59e0b" fillOpacity={isHov ? 0.3 : 0.06}
                  stroke="#f59e0b" strokeOpacity={isHov ? 0.6 : 0.12} strokeWidth={0.5}
                  className="transition-all duration-200" />
              )}
              {/* Left bar */}
              <rect x={LX} y={cam.y} width={NW} height={Math.max(6, cam.h)} rx={4}
                fill={INDIGO_PALETTE[i % INDIGO_PALETTE.length]}
                opacity={isHov ? 1 : 0.3}
                className="transition-opacity duration-200" />
              {hovCam === cam.name && (
                <rect x={LX - 1} y={cam.y - 1} width={NW + 2} height={cam.h + 2} rx={5}
                  fill="none" stroke={INDIGO_PALETTE[i % INDIGO_PALETTE.length]} strokeWidth={1.5} strokeOpacity={0.6} />
              )}
              {/* Camera label */}
              <text x={LX - 8} y={cam.y + cam.h / 2 + 3.5} fontSize={10}
                fill={hovCam === cam.name ? '#f4f4f5' : isHov ? '#a1a1aa' : '#52525b'}
                textAnchor="end" fontFamily="monospace" fontWeight={hovCam === cam.name ? '600' : '400'}
                className="transition-all duration-200">
                {cam.name}
              </text>
            </g>
          );
        })}

        {/* Right nodes */}
        <rect x={RX} y={kY_r} width={NW} height={Math.max(6, kH_r)} rx={4} fill="#10b981" />
        <text x={RX + NW + 8} y={kY_r + kH_r / 2 - 1} fontSize={11} fill="#10b981" fontFamily="monospace" fontWeight="700">Known</text>
        <text x={RX + NW + 8} y={kY_r + kH_r / 2 + 12} fontSize={9} fill="#71717a" fontFamily="monospace">{fmtN(knownTotal)}</text>

        <rect x={RX} y={uY_r} width={NW} height={Math.max(6, uH_r)} rx={4} fill="#f59e0b" />
        <text x={RX + NW + 8} y={uY_r + uH_r / 2 - 1} fontSize={11} fill="#f59e0b" fontFamily="monospace" fontWeight="700">Unknown</text>
        <text x={RX + NW + 8} y={uY_r + uH_r / 2 + 12} fontSize={9} fill="#71717a" fontFamily="monospace">{fmtN(unknownTotal)}</text>
      </svg>

      {/* Tooltip */}
      {hovData && (
        <div className="pointer-events-none absolute z-50 transition-all duration-100"
          style={{
            left: Math.min(mousePos.x + 14, (containerRef.current?.clientWidth ?? 400) - 180),
            top: Math.max(mousePos.y - 80, 4),
          }}>
          <div className="bg-zinc-900/95 border border-white/10 backdrop-blur-md rounded-lg px-3 py-2.5 shadow-2xl min-w-[160px]">
            <p className="text-[11px] font-mono font-semibold text-zinc-200 mb-2">{hovData.name}</p>
            <div className="space-y-1.5">
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />Known
                </span>
                <span className="text-emerald-400 text-xs font-mono font-bold">{fmtN(hovData.known)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />Unknown
                </span>
                <span className="text-amber-400 text-xs font-mono font-bold">{fmtN(hovData.unknown)}</span>
              </div>
              <div className="flex justify-between gap-4 pt-1.5 border-t border-white/5">
                <span className="text-zinc-500 text-[10px] font-mono">Total</span>
                <span className="text-zinc-300 text-xs font-mono font-bold">{fmtN(hovData.known + hovData.unknown)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500 text-[10px] font-mono">Share</span>
                <span className="text-zinc-300 text-xs font-mono font-bold">{((hovData.known + hovData.unknown) / grand * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BumpChart (Rank Trace) ──────────────────────────────────────────────────

function BumpChart({ data, colors, labels }: { data: { name: string; ranks: (number | null)[] }[]; colors: string[]; labels?: string[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [animProg, setAnimProg] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const dur = 1000;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      setAnimProg(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const VW = 500, VH = 220, PADL = 36, PADR = 20, PADT = 20, PADB = 28;
  if (!data.length || !data[0].ranks.length) return <div className="h-full flex items-center justify-center text-zinc-600 text-[11px] font-mono">Insufficient data for trace</div>;

  const steps = data[0].ranks.length;
  const maxRank = Math.max(...data.flatMap(d => d.ranks.filter(r => r !== null) as number[]), 1);
  const dx = (VW - PADL - PADR) / (steps - 1 || 1);
  const dy = (VH - PADT - PADB) / (maxRank - 1 || 1);

  return (
    <div ref={containerRef} className="relative w-full h-full"
      onMouseMove={e => {
        const r = containerRef.current?.getBoundingClientRect();
        if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setHov(null)}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full">
        <defs>
          {data.map((_, i) => (
            <filter key={i} id={`glow-bump-${i}`}>
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          ))}
        </defs>

        {/* Rank labels + grid */}
        {Array.from({ length: maxRank }).map((_, i) => (
          <g key={i}>
            <line x1={PADL} y1={PADT + i * dy} x2={VW - PADR} y2={PADT + i * dy}
              stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} strokeDasharray="4 4" />
            <text x={PADL - 6} y={PADT + i * dy + 3.5} fontSize={8} fill="#52525b" textAnchor="end" fontFamily="monospace">
              #{i + 1}
            </text>
          </g>
        ))}

        {/* Lines */}
        {data.map((series, i) => {
          const pts = series.ranks.map((r, idx) => r === null ? null : {
            x: PADL + idx * dx,
            y: PADT + (r - 1) * dy
          }).filter(p => p !== null) as { x: number; y: number }[];

          if (pts.length < 2) return null;

          const pathD = pts.reduce((acc, p, idx) => {
            if (idx === 0) return `M ${p.x} ${p.y}`;
            const prev = pts[idx - 1];
            const mx = (prev.x + p.x) / 2;
            return `${acc} C ${mx} ${prev.y} ${mx} ${p.y} ${p.x} ${p.y}`;
          }, '');

          const isActive = hov === null || hov === i;
          const col = colors[i % colors.length];
          // Clip path length by animation progress
          const totalLen = pts.length * dx;

          return (
            <g key={series.name} onMouseEnter={() => setHov(i)} className="cursor-pointer">
              {/* Glow shadow */}
              {hov === i && (
                <path d={pathD} fill="none" stroke={col} strokeWidth={8}
                  strokeLinecap="round" strokeOpacity={0.15} filter={`url(#glow-bump-${i})`} />
              )}
              {/* Main line */}
              <path d={pathD} fill="none" stroke={col}
                strokeWidth={hov === i ? 3.5 : 2}
                strokeLinecap="round" strokeOpacity={isActive ? 0.85 : 0.1}
                strokeDasharray={totalLen} strokeDashoffset={totalLen * (1 - animProg)}
                className="transition-[stroke-width,stroke-opacity] duration-300" />
              {/* Dots */}
              {pts.map((p, pidx) => {
                const dotProg = Math.max(0, Math.min(1, (animProg * pts.length - pidx) * 2));
                return (
                  <g key={pidx}>
                    {hov === i && <circle cx={p.x} cy={p.y} r={8} fill={col} fillOpacity={0.1} />}
                    <circle cx={p.x} cy={p.y} r={(hov === i ? 5 : 3.5) * dotProg}
                      fill={col} fillOpacity={isActive ? 1 : 0.15}
                      stroke="#09090b" strokeWidth={1.5}
                      className="transition-all duration-300" />
                  </g>
                );
              })}
              {/* End label */}
              {animProg > 0.8 && pts.length > 0 && (
                <text x={pts[pts.length - 1].x + 6} y={pts[pts.length - 1].y + 3}
                  fontSize={8} fill={isActive ? col : '#3f3f46'} fontFamily="monospace" fontWeight="600"
                  className="transition-all duration-300">
                  {series.name.length > 10 ? series.name.slice(0, 9) + '..' : series.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <BumpTooltip hov={hov} mousePos={mousePos} data={data} labels={labels} />
    </div>
  );
}


// ── Ridgeline (Joy Plot) ─────────────────────────────────────────────────────

function RidgelineChart({ data, colors }: { data: { name: string; values: number[] }[]; colors: string[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const VW = 500, VH = 220, PAD = 20;
  if (!data.length) return <div className="h-full flex items-center justify-center text-zinc-600 text-[11px] font-mono">No density data</div>;

  const N = data.length;
  const overlap = 0.6;
  const rowH = (VH - PAD * 2) / (N * (1 - overlap) + overlap);
  const maxVal = Math.max(...data.flatMap(d => d.values), 1);

  return (
    <div ref={containerRef} className="relative w-full h-full"
      onMouseMove={e => {
        const r = containerRef.current?.getBoundingClientRect();
        if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setHov(null)}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full">
        {data.map((series, i) => {
          const yBase = PAD + i * rowH * (1 - overlap) + rowH;
          const points = series.values.map((v, idx) => ({
            x: PAD + (idx / (series.values.length - 1)) * (VW - PAD * 2),
            y: yBase - (v / maxVal) * rowH,
          }));

          // Build smooth cubic bezier curve through points
          let curvePath = `M ${points[0].x},${yBase} L ${points[0].x},${points[0].y}`;
          for (let j = 0; j < points.length - 1; j++) {
            const p0 = points[j];
            const p1 = points[j + 1];
            const mx = (p0.x + p1.x) / 2;
            curvePath += ` C ${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
          }
          curvePath += ` L ${points[points.length - 1].x},${yBase} Z`;

          const color = colors[i % colors.length];
          const isHov = hov === i;

          return (
            <g key={series.name} onMouseEnter={() => setHov(i)}>
              <path d={curvePath} fill={color} fillOpacity={hov === null ? 0.3 : (isHov ? 0.6 : 0.05)}
                stroke={color} strokeWidth={isHov ? 2 : 1} strokeOpacity={hov === null || isHov ? 1 : 0.2}
                className="transition-all duration-300 cursor-pointer" />
              <text x={PAD - 4} y={yBase - 4} fontSize={8} fill={color} textAnchor="end" fontFamily="monospace"
                opacity={hov === null || isHov ? 0.8 : 0.2}>{series.name}</text>
            </g>
          );
        })}
      </svg>
      <JoyTooltip hov={hov} mousePos={mousePos} data={data} />
    </div>
  );
}

// ── ChordDiagram (Circular Camera-to-Period Flow) ──────────────────────────
const ChordDiagram = memo(function ChordDiagram({ matrix, labels, colors }: { matrix: number[][]; labels: string[]; colors: string[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  if (!matrix.length || !matrix[0].length) return <div className="flex items-center justify-center h-full text-zinc-600 text-[11px] font-mono">No flow data</div>;

  const VW = 400, VH = 400;
  const outerRadius = Math.min(VW, VH) * 0.5 - 40;
  const innerRadius = outerRadius - 12;

  const n = matrix.length;
  const totals = matrix.map(row => row.reduce((s, v) => s + v, 0));
  const grandTotal = totals.reduce((s, v) => s + v, 0) || 1;
  const padAngle = 0.04;
  const availAngle = 2 * Math.PI - (padAngle * n);

  let startAngle = 0;
  const groups = totals.map((t, i) => {
    const angle = (t / grandTotal) * availAngle;
    const g = { index: i, startAngle, endAngle: startAngle + angle, value: t };
    startAngle += angle + padAngle;
    return g;
  });

  const polarToCartesian = (angle: number, radius: number) => ({
    x: VW / 2 + radius * Math.cos(angle - Math.PI / 2),
    y: VH / 2 + radius * Math.sin(angle - Math.PI / 2)
  });

  return (
    <div className="relative w-full h-full flex items-center justify-center"
      onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
      onMouseLeave={() => setHov(null)}
    >
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-[300px] h-[300px]">
        <g>
          {groups.map((g, i) => {
            const isHov = hov === i;
            const largeArc = g.endAngle - g.startAngle > Math.PI ? 1 : 0;
            const p0 = polarToCartesian(g.startAngle, innerRadius);
            const p1 = polarToCartesian(g.endAngle, innerRadius);
            const p2 = polarToCartesian(g.endAngle, outerRadius);
            const p3 = polarToCartesian(g.startAngle, outerRadius);

            const d = `M ${p0.x} ${p0.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${p3.x} ${p3.y} Z`;

            return (
              <path key={i} d={d} fill={colors[i % colors.length]} fillOpacity={hov === null || isHov ? 0.8 : 0.2}
                onMouseEnter={() => setHov(i)} className="transition-all duration-300 cursor-pointer" />
            );
          })}
          {matrix.map((row, i) => row.map((val, j) => {
            if (val <= 0 || i >= j) return null;
            const isHov = hov === i || hov === j;
            const g1 = groups[i];
            const g2 = groups[j];
            const p1 = polarToCartesian((g1.startAngle + g1.endAngle) / 2, innerRadius);
            const p2 = polarToCartesian((g2.startAngle + g2.endAngle) / 2, innerRadius);
            return (
              <path key={`${i}-${j}`}
                d={`M ${p1.x} ${p1.y} Q ${VW / 2} ${VH / 2} ${p2.x} ${p2.y}`}
                fill="none" stroke={colors[i % colors.length]} strokeWidth={Math.log10(val + 1) * 3}
                strokeOpacity={hov === null ? 0.15 : (isHov ? 0.5 : 0.02)}
                className="transition-all duration-300 pointer-events-none"
              />
            );
          }))}
        </g>
      </svg>
      {hov !== null && (
        <div className={`${TT} p-3 min-w-[140px] absolute z-50 pointer-events-none`}
          style={{ left: mousePos.x + 18, top: mousePos.y - 45 }}>
          <p className={TTLabel}>{labels[hov]}</p>
          <div className={TTRow}><span className={TTKey}>Total Flow</span><span className={TTVal}>{fmtN(totals[hov])}</span></div>
        </div>
      )}
    </div>
  );
});


// ── Marimekko chart ───────────────────────────────────────────────────────────

function MarimekkoChart({ data }: { data: { name: string; known: number; unknown: number; total: number }[] }) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [animProgress, setAnimProgress] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const dur = 800;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      // ease-out cubic
      setAnimProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const totalAll = data.reduce((s, d) => s + d.total, 0);
  if (!totalAll || !data.length) return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-[11px] font-mono">No data</div>
  );
  const VW = 500, VH = 185, LBL_H = 24;
  const chartH = VH - LBL_H;
  const GAP = 2;
  const availW = VW - GAP * (data.length - 1);
  let xOff = 0;
  const rects = data.map((d, i) => {
    const w = (d.total / totalAll) * availW;
    const knownH = d.total > 0 ? (d.known / d.total) * chartH : 0;
    const r = { ...d, idx: i, x: xOff, w, knownH, unknownH: chartH - knownH };
    xOff += w + GAP;
    return r;
  });

  const hov = hovIdx !== null ? rects[hovIdx] : null;

  return (
    <div ref={containerRef} className="relative w-full h-full"
      onMouseMove={e => {
        const r = containerRef.current?.getBoundingClientRect();
        if (r) setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setHovIdx(null)}>
      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHovIdx(null)}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(f => (
          <g key={f}>
            <line x1={0} y1={chartH * f} x2={VW} y2={chartH * f}
              stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} strokeDasharray="3 3" />
            <text x={VW - 2} y={chartH * f - 3} fontSize={6.5} fill="#3f3f46" textAnchor="end" fontFamily="monospace">
              {((1 - f) * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* Bars */}
        {rects.map(r => {
          const isActive = hovIdx === null || hovIdx === r.idx;
          const knownPct = r.total > 0 ? ((r.known / r.total) * 100).toFixed(0) : '0';
          const shortName = r.name.length > 9 ? r.name.slice(0, 8) + '...' : r.name;
          // Animate: bars grow from bottom
          const animH = chartH * animProgress;
          const aUnknownH = r.unknownH * animProgress;
          const aKnownH = r.knownH * animProgress;
          const yStart = chartH - animH;
          return (
            <g key={r.name} onMouseEnter={() => setHovIdx(r.idx)} className="cursor-pointer">
              {/* Unknown (top) */}
              <rect x={r.x} y={yStart} width={Math.max(0, r.w)} height={aUnknownH}
                rx={r.w > 6 ? 2 : 0}
                fill="#f59e0b" fillOpacity={isActive ? 0.45 : 0.12}
                className="transition-all duration-200" />
              {/* Known (bottom) */}
              <rect x={r.x} y={yStart + aUnknownH} width={Math.max(0, r.w)} height={aKnownH}
                rx={r.w > 6 ? 2 : 0}
                fill="#10b981" fillOpacity={isActive ? 0.6 : 0.15}
                className="transition-all duration-200" />
              {/* Hover highlight border */}
              {hovIdx === r.idx && (
                <rect x={r.x - 0.5} y={yStart - 0.5} width={Math.max(0, r.w + 1)} height={animH + 1}
                  rx={r.w > 6 ? 2 : 0}
                  fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
              )}
              {/* Known % inside bar */}
              {animProgress > 0.8 && r.knownH > 16 && r.w > 30 && (
                <text x={r.x + r.w / 2} y={yStart + aUnknownH + aKnownH / 2 + 3}
                  fontSize={8} fill="#10b981" textAnchor="middle" fontFamily="monospace" fontWeight="600"
                  opacity={isActive ? 0.9 : 0.3} className="transition-opacity duration-200">
                  {knownPct}%
                </text>
              )}
              {/* Camera name label */}
              {animProgress > 0.5 && (
                <text x={r.x + r.w / 2} y={VH - 5} fontSize={7} textAnchor="middle" fontFamily="monospace"
                  fill={hovIdx === r.idx ? '#e4e4e7' : '#71717a'} className="transition-all duration-200">
                  {r.w > 30 ? shortName : r.w > 16 ? r.name.slice(0, 4) : ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating tooltip */}
      {hov && (
        <div className="pointer-events-none absolute z-50 transition-opacity duration-150"
          style={{
            left: Math.min(mousePos.x + 12, (containerRef.current?.clientWidth ?? 400) - 170),
            top: Math.max(mousePos.y - 70, 4),
          }}>
          <div className="bg-zinc-900/95 border border-white/10 backdrop-blur-md rounded-lg px-3 py-2.5 shadow-xl min-w-[150px]">
            <p className="text-[11px] font-mono font-semibold text-zinc-200 mb-1.5">{hov.name}</p>
            <div className="space-y-1">
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />Known
                </span>
                <span className="text-emerald-400 text-xs font-mono font-bold">{fmtN(hov.known)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />Unknown
                </span>
                <span className="text-amber-400 text-xs font-mono font-bold">{fmtN(hov.unknown)}</span>
              </div>
              <div className="flex justify-between gap-4 pt-1 border-t border-white/5">
                <span className="text-zinc-500 text-[10px] font-mono">Total</span>
                <span className="text-zinc-300 text-xs font-mono font-bold">{fmtN(hov.total)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500 text-[10px] font-mono">Share</span>
                <span className="text-zinc-300 text-xs font-mono font-bold">{((hov.total / totalAll) * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stream graph tooltip ──────────────────────────────────────────────────────

function StreamTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const known = payload.find((p: any) => p.dataKey === 'known')?.value ?? 0;
  const unknown = payload.find((p: any) => p.dataKey === 'unknown')?.value ?? 0;
  const total = known + unknown;
  return (
    <div className={`${TT} p-3 min-w-[155px]`}>
      <p className={TTLabel}>{label}</p>
      <div className="space-y-1.5">
        <div className={TTRow}>
          <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />Known
          </span>
          <span className="text-emerald-400 text-xs font-mono font-bold">{fmtN(known)}</span>
        </div>
        <div className={TTRow}>
          <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />Unknown
          </span>
          <span className="text-amber-400 text-xs font-mono font-bold">{fmtN(unknown)}</span>
        </div>
        {total > 0 && (
          <div className={`${TTRow} pt-1 border-t border-white/5`}>
            <span className={TTKey}>Total</span>
            <span className={TTVal}>{fmtN(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [dataLimit, setDataLimit] = useState<DataLimit>(5000);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [stats, setStats] = useState<AllStats>({
    frsStats: null, frsPersons: null, frsDetections: null, frsTimeline: null,
  });

  const fetchData = useCallback(async () => {
    try {
      const tp = getTimeRangeParams(timeRange);
      const [frsStats, frsPersons, frsDetections, frsTimeline] = await Promise.allSettled([
        apiClient.getFRSStats(tp),
        apiClient.getPersons(),
        apiClient.getFRSDetections({ limit: dataLimit, ...tp }),
        apiClient.getFRSTimeline({ ...tp, granularity }),
      ]);
      setStats({
        frsStats: frsStats.status === 'fulfilled' ? frsStats.value : null,
        frsPersons: frsPersons.status === 'fulfilled' ? frsPersons.value : null,
        frsDetections: frsDetections.status === 'fulfilled' ? frsDetections.value : null,
        frsTimeline: frsTimeline.status === 'fulfilled' ? frsTimeline.value : null,
      });
    } catch (e) { console.error('Analytics fetch error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [timeRange, dataLimit, granularity]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  // ── Derived values ──
  const dets = stats.frsDetections ?? [];
  const frsStats = useMemo(() => stats.frsStats ?? deriveStatsFromDetections(dets), [stats.frsStats, dets]);
  const totalDet = frsStats?.totalDetections ?? 0;
  const knownDet = frsStats?.knownDetections ?? 0;
  const unknownDet = frsStats?.unknownDetections ?? 0;
  const avgConf = frsStats?.avgConfidence ?? 0;
  const matchRate = totalDet > 0 ? (knownDet / totalDet) * 100 : 0;
  const enrolledCount = stats.frsPersons?.length ?? 0;
  const rangeLabel = { today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All time' }[timeRange];

  const frsByThreat = useMemo(() =>
    Object.entries(
      (stats.frsPersons ?? []).reduce<Record<string, number>>((acc, p) => {
        const l = (p.threatLevel || 'UNKNOWN').toUpperCase();
        acc[l] = (acc[l] || 0) + 1; return acc;
      }, {})
    ).map(([name, value]) => ({ name, value })),
    [stats.frsPersons]);

  const topPersonsData = useMemo(() =>
    (frsStats?.byPerson ?? []).slice(0, 10).map(ps => ({
      name: ps.personName || ps.personId,
      count: ps.count, avgConf: ps.avgConfidence, lastSeen: ps.lastSeen,
    })),
    [frsStats]);

  const personsList = useMemo(() =>
    (stats.frsPersons ?? []).map(person => {
      const det = frsStats?.byPerson?.find(ps => ps.personId === person.id);
      return {
        id: person.id, name: person.name,
        faceImageUrl: person.faceImageUrl ?? '',
        count: det?.count ?? 0, lastSeen: det?.lastSeen ?? '',
        avgConf: det?.avgConfidence ?? 0,
        category: person.category ?? null, threatLevel: person.threatLevel ?? null,
      };
    }).sort((a, b) => b.count - a.count),
    [stats.frsPersons, frsStats]);

  // Pareto: cameras sorted desc with cumulative %
  const cameraPareto = useMemo(() => {
    const sorted = [...(frsStats?.byDevice ?? [])].sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, d) => s + d.count, 0);
    let cum = 0;
    return sorted.map(d => {
      cum += d.count;
      return {
        name: d.deviceName,
        count: d.count,
        pct: total > 0 ? (d.count / total) * 100 : 0,
        cumPct: total > 0 ? (cum / total) * 100 : 0,
      };
    });
  }, [frsStats]);

  // Pareto: persons by detection count
  const personPareto = useMemo(() => {
    const sorted = [...topPersonsData].sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, d) => s + d.count, 0);
    let cum = 0;
    return sorted.map(p => {
      cum += p.count;
      return { ...p, cumPct: total > 0 ? (cum / total) * 100 : 0 };
    });
  }, [topPersonsData]);

  // Camera flows from raw detections (for Sankey)
  const cameraFlows = useMemo((): CamFlow[] => {
    const map: Record<string, CamFlow> = {};
    for (const det of dets) {
      const id = det.deviceId ?? 'unknown';
      const name = (det.device as any)?.name ?? det.deviceId ?? 'Camera';
      if (!map[id]) map[id] = { name, known: 0, unknown: 0 };
      if (isKnown(det)) map[id].known++; else map[id].unknown++;
    }
    return Object.values(map)
      .sort((a, b) => (b.known + b.unknown) - (a.known + a.unknown))
      .slice(0, 10);
  }, [dets]);

  // Stacked camera data (accurate totals + known/unknown from flow sample)
  const cameraStackData = useMemo(() => {
    const byDev = frsStats?.byDevice ?? [];
    const flowMap = new Map(cameraFlows.map(f => [f.name, f]));
    return [...byDev].sort((a, b) => b.count - a.count).map(d => {
      const flow = flowMap.get(d.deviceName);
      const total = d.count;
      if (flow) {
        const sampleTotal = flow.known + flow.unknown;
        const knownRatio = sampleTotal > 0 ? flow.known / sampleTotal : 0;
        return { name: d.deviceName, known: Math.round(total * knownRatio), unknown: Math.round(total * (1 - knownRatio)), total };
      }
      return { name: d.deviceName, known: 0, unknown: total, total };
    });
  }, [frsStats, cameraFlows]);

  const timelineData = useMemo(() => {
    const buckets = (stats.frsTimeline && stats.frsTimeline.length > 0)
      ? stats.frsTimeline
      : buildTimelineFromDetections(dets, granularity);
    return buildTimelineFromBuckets(buckets, granularity);
  }, [stats.frsTimeline, dets, granularity]);

  // Per-camera stream data for the multi-layer stream graph
  const STREAM_BLUES = ['#0c2d48', '#145680', '#1a74a8', '#2b8cc4', '#4da6d8', '#7dc0e6', '#aed8f0'];
  const streamCamData = useMemo(() => {
    const topCams = cameraFlows.slice(0, 7).map(f => f.name);
    if (!topCams.length || !dets.length) return { labels: [] as string[], cameras: [] as string[], rows: [] as Record<string, number>[] };
    const buckets = (stats.frsTimeline && stats.frsTimeline.length > 0)
      ? stats.frsTimeline
      : buildTimelineFromDetections(dets, granularity);
    const periods = buckets.map(b => {
      const d = new Date(b.period);
      return granularity === 'hour'
        ? `${d.getHours().toString().padStart(2, '0')}:00`
        : d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    });
    // Count per camera per period
    const periodKeys = buckets.map(b => new Date(b.period).getTime());
    const camCounts: Record<string, number[]> = {};
    for (const name of topCams) camCounts[name] = Array(periodKeys.length).fill(0);
    for (const det of dets) {
      const camName = (det.device as any)?.name ?? det.deviceId ?? 'Camera';
      if (!camCounts[camName]) continue;
      const ts = new Date(det.timestamp).getTime();
      let pIdx = periodKeys.length - 1;
      for (let i = 0; i < periodKeys.length - 1; i++) {
        if (ts >= periodKeys[i] && ts < periodKeys[i + 1]) { pIdx = i; break; }
      }
      camCounts[camName][pIdx]++;
    }
    const rows = periodKeys.map((_, idx) => {
      const row: Record<string, number> = { label: periods[idx] as any };
      for (const cam of topCams) row[cam] = camCounts[cam][idx];
      return row;
    });
    return { labels: periods, cameras: topCams, rows };
  }, [cameraFlows, dets, stats.frsTimeline, granularity]);

  const hourlyData = useMemo(() => buildHourlyPattern(dets), [dets]);
  const confidenceDist = useMemo(() => buildConfidenceDist(dets), [dets]);

  const tlInterval = (() => {
    const n = timelineData.length;
    if (granularity === 'hour') return n <= 24 ? 'preserveStartEnd' : Math.max(1, Math.floor(n / 12));
    return n <= 14 ? 'preserveStartEnd' : Math.max(1, Math.floor(n / 10));
  })();

  // Pareto 80% cross point
  const cam80idx = cameraPareto.findIndex(d => d.cumPct >= 80);
  const cam80name = cam80idx >= 0 ? cameraPareto[cam80idx]?.name : null;

  // ── Advanced Chart Data Derivations ──

  const chordData = useMemo(() => {
    const topCams = cameraPareto.slice(0, 6).map(c => c.name);
    const timeSlots = ['Morning', 'Afternoon', 'Evening', 'Night'];
    const labels = [...topCams, ...timeSlots];
    const matrix = Array.from({ length: labels.length }, () => Array(labels.length).fill(0));
    const n = topCams.length;

    for (const det of dets) {
      const camName = (det.device as any)?.name ?? det.deviceId ?? 'Camera';
      const camIdx = topCams.indexOf(camName);
      if (camIdx === -1) continue;

      const hour = new Date(det.timestamp).getHours();
      let slotOffset: number;
      if (hour >= 6 && hour < 12) slotOffset = 0; // morning
      else if (hour >= 12 && hour < 17) slotOffset = 1; // afternoon
      else if (hour >= 17 && hour < 21) slotOffset = 2; // evening
      else slotOffset = 3; // night
      const slot = n + slotOffset;

      matrix[camIdx][slot]++;
      matrix[slot][camIdx]++;
    }
    return { matrix, labels, colors: INDIGO_PALETTE };
  }, [dets, cameraPareto]);

  const joyData = useMemo(() => {
    const topCams = cameraPareto.slice(0, 5);
    return topCams.map(tc => {
      const hours = Array(24).fill(0);
      dets.filter(d => ((d.device as any)?.name ?? d.deviceId) === tc.name).forEach(d => {
        const h = new Date(d.timestamp).getHours();
        hours[h]++;
      });
      return { name: tc.name, values: hours };
    });
  }, [dets, cameraPareto]);

  const bumpData = useMemo(() => {
    const topCams = cameraPareto.slice(0, 5).map(c => c.name);
    const timeline = stats.frsTimeline;
    if (!topCams.length || !dets.length || !timeline?.length || timeline.length < 2) return [];

    // Build count per camera per time period from raw detections
    const periods = timeline.map(b => new Date(b.period).getTime());
    const camCounts: Record<string, number[]> = {};
    for (const name of topCams) camCounts[name] = Array(periods.length).fill(0);

    for (const det of dets) {
      const camName = (det.device as any)?.name ?? det.deviceId ?? 'Camera';
      if (!camCounts[camName]) continue;
      const ts = new Date(det.timestamp).getTime();
      let pIdx = periods.length - 1;
      for (let i = 0; i < periods.length - 1; i++) {
        if (ts >= periods[i] && ts < periods[i + 1]) { pIdx = i; break; }
      }
      camCounts[camName][pIdx]++;
    }

    return topCams.map(name => ({
      name,
      ranks: periods.map((_, pIdx) => {
        const myCount = camCounts[name][pIdx];
        if (myCount === 0) return null;
        const sorted = topCams.map(c => camCounts[c][pIdx]).sort((a, b) => b - a);
        return sorted.indexOf(myCount) + 1;
      }),
    }));
  }, [stats.frsTimeline, cameraPareto, dets]);


  return (
    <div className="h-full overflow-hidden relative iris-dashboard-root">
      <div className="h-full p-4 md:p-6 flex flex-col gap-4 overflow-y-auto">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            <h1 className="text-base font-mono font-bold text-zinc-100 tracking-wide">Analytics</h1>
            <HudBadge variant="default" size="sm">FRS</HudBadge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => setReportOpen(true)} variant="outline" size="sm"
              className="h-8 text-xs font-mono text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/10 px-3">
              <FileText className="w-3.5 h-3.5 mr-1.5" />Export
            </Button>
            <Button onClick={() => { setRefreshing(true); fetchData(); }} disabled={refreshing}
              variant="outline" size="sm" className="h-8 w-8 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <div className="flex bg-white/5 rounded-lg border border-white/5 p-0.5">
              {(['today', '7d', '30d', 'all'] as TimeRange[]).map(r => (
                <button key={r} onClick={() => setTimeRange(r)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-md transition-colors ${timeRange === r ? 'bg-indigo-500/30 text-indigo-300' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  {r === 'today' ? 'Today' : r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 shrink-0">
          {[
            { label: "Total Detections", value: totalDet, sub: rangeLabel, icon: ScanFace, accent: "text-zinc-100" },
            { label: "Known Matches", value: knownDet, sub: `of ${fmtN(totalDet)} total`, icon: UserCheck, accent: "text-emerald-400", gaugePct: matchRate, gaugeColor: "#10b981" },
            { label: "Unknown Faces", value: unknownDet, sub: `${(100 - matchRate).toFixed(0)}% of detections`, icon: UserX, accent: "text-amber-400", gaugePct: totalDet > 0 ? (unknownDet / totalDet) * 100 : 0, gaugeColor: "#f59e0b" },
            { label: "Avg Confidence", value: `${(avgConf * 100).toFixed(1)}%`, sub: "recognition quality", icon: Target, accent: "text-indigo-400", gaugePct: avgConf * 100, gaugeColor: "#6366f1" },
            { label: "Enrolled", value: enrolledCount, sub: "watchlist persons", icon: Activity, accent: "text-zinc-100" },
            { label: "Active Cameras", value: frsStats?.byDevice?.length ?? 0, sub: "with detections", icon: Zap, accent: "text-sky-400" }
          ].map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <KPICard {...kpi} loading={loading} />
            </motion.div>
          ))}
        </div>

        {/* ── Detection Timeline ── */}
        {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <ChartCard
              title="Detection Timeline"
              subtitle="Each point shows total face detections for that day or hour, stacked into known watchlist matches (green) and unidentified faces (amber). Hover any point to see the exact breakdown and percentage split."
              action={
                <div className="flex items-center gap-2 flex-wrap">
                  <PillGroup label="rows"
                    options={[{ value: 1000, label: '1k' }, { value: 5000, label: '5k' }, { value: 10000, label: '10k' }]}
                    value={dataLimit as any} onChange={(v) => setDataLimit(Number(v) as DataLimit)} />
                  <PillGroup<Granularity>
                    options={[{ value: 'day', label: 'Day' }, { value: 'hour', label: 'Hour' }]}
                    value={granularity} onChange={setGranularity} />
                </div>
              }
            >
              <div className="mb-2">
                <ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />
              </div>
              {timelineData.some(d => d.total > 0) ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ left: 0, right: 4, top: 6, bottom: granularity === 'hour' && timeRange !== 'today' ? 34 : 6 }}>
                      <defs>
                        <linearGradient id="gKnown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gUnknown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="label"
                        tick={{ fill: '#52525b', fontSize: 9.5, fontFamily: 'monospace' }}
                        axisLine={false} tickLine={false}
                        interval={tlInterval as any}
                        angle={granularity === 'hour' && timeRange !== 'today' ? -30 : 0}
                        textAnchor={granularity === 'hour' && timeRange !== 'today' ? 'end' : 'middle'}
                        height={granularity === 'hour' && timeRange !== 'today' ? 40 : 18}
                        label={{ value: 'Time', position: 'insideBottomRight', offset: -4, fill: '#3f3f46', fontSize: 9 }}
                      />
                      <YAxis tick={{ fill: '#52525b', fontSize: 9.5, fontFamily: 'monospace' }}
                        axisLine={false} tickLine={false} allowDecimals={false} width={32}
                        label={{ value: 'Detections', angle: -90, position: 'insideLeft', offset: 8, fill: '#3f3f46', fontSize: 9 }}
                      />
                      <Tooltip content={<AreaTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.07)', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="unknown" name="Unknown" stackId="1"
                        stroke="#f59e0b" strokeWidth={1.5} fill="url(#gUnknown)" dot={false} activeDot={{ r: 3, fill: '#f59e0b' }} />
                      <Area type="monotone" dataKey="known" name="Known" stackId="1"
                        stroke="#10b981" strokeWidth={1.5} fill="url(#gKnown)" dot={false} activeDot={{ r: 3, fill: '#10b981' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty className="min-h-0 h-56">
                  <EmptyIcon><Activity /></EmptyIcon>
                  <EmptyTitle>No detection data in range</EmptyTitle>
                  <EmptyDescription>Events populate once FRS is active.</EmptyDescription>
                </Empty>
              )}
            </ChartCard>
          </motion.div>
        )}

        {/* ── Pareto: Camera Detections ── */}
        {loading ? <Skeleton className="h-72 w-full rounded-xl" /> : cameraPareto.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}>
            <ChartCard
              title="Detections by Camera"
              subtitle={cam80name ? `Top ${cam80idx + 1} camera${cam80idx > 0 ? 's' : ''} account for 80% of all detections — cameras to the left of the red line are your highest-volume sources.` : 'Bars rank cameras from most to fewest detections; the amber line shows cumulative coverage as you add more cameras.'}
              action={<span className="text-[10px] font-mono text-zinc-600">{rangeLabel}</span>}
            >
              <div className="mb-2 flex items-center gap-4 flex-wrap">
                <ColorLegend items={[
                  { label: 'Detections', color: '#6366f1' },
                  { label: 'Cumulative %', color: '#f59e0b' },
                ]} />
                <span className="text-[10px] font-mono text-zinc-600 flex items-center gap-1">
                  <span className="w-6 border-t border-dashed border-red-500/60 inline-block" />80% threshold
                </span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={cameraPareto} margin={{ left: 4, right: 40, top: 6, bottom: cameraPareto.length > 8 ? 56 : 36 }}
                    barSize={Math.max(18, Math.min(52, Math.floor(650 / Math.max(cameraPareto.length, 1)) - 8))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="name"
                      tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false}
                      angle={cameraPareto.length > 6 ? -35 : 0}
                      textAnchor={cameraPareto.length > 6 ? 'end' : 'middle'}
                      height={cameraPareto.length > 6 ? 58 : 28}
                      interval={0}
                      label={{ value: 'Camera', position: 'insideBottomRight', offset: -4, fill: '#3f3f46', fontSize: 9 }}
                    />
                    <YAxis yAxisId="left" tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} allowDecimals={false} width={36}
                      label={{ value: 'Detections', angle: -90, position: 'insideLeft', offset: 8, fill: '#3f3f46', fontSize: 9 }}
                    />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} width={32}
                      label={{ value: 'Cumulative %', angle: 90, position: 'insideRight', offset: 8, fill: '#3f3f46', fontSize: 9 }}
                    />
                    <Tooltip content={<ParetoTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                    <ReferenceLine yAxisId="right" y={80} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.5} strokeWidth={1.5}
                      label={{ value: '80%', position: 'insideTopRight', fill: '#ef4444', fontSize: 9 }}
                    />
                    <Bar yAxisId="left" dataKey="count" name="Detections" radius={[4, 4, 0, 0]}>
                      {cameraPareto.map((_, i) => (
                        <Cell key={i} fill={INDIGO_PALETTE[i % INDIGO_PALETTE.length]} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="cumPct" name="Cumulative %"
                      stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 4, fill: '#f59e0b' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </motion.div>
        )}

        {/* ── Stacked: Camera Known vs Unknown ── */}
        {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : cameraStackData.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.5 }}>
            <ChartCard
              title="Known vs Unknown by Camera"
              subtitle="Each bar represents one camera's total detections split into watchlist matches (green) and unidentified faces (amber). Taller bars mean higher-volume cameras; the green-to-amber ratio shows how much watchlist activity each camera drives."
              action={<span className="text-[10px] font-mono text-zinc-600">{rangeLabel}</span>}
            >
              <div className="mb-2">
                <ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cameraStackData}
                    margin={{ left: 4, right: 4, top: 6, bottom: cameraStackData.length > 6 ? 56 : 36 }}
                    barSize={Math.max(20, Math.min(64, Math.floor(700 / Math.max(cameraStackData.length, 1)) - 8))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="name"
                      tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false}
                      angle={cameraStackData.length > 6 ? -35 : 0}
                      textAnchor={cameraStackData.length > 6 ? 'end' : 'middle'}
                      height={cameraStackData.length > 6 ? 58 : 28}
                      interval={0}
                    />
                    <YAxis tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} allowDecimals={false} width={36}
                      label={{ value: 'Detections', angle: -90, position: 'insideLeft', offset: 8, fill: '#3f3f46', fontSize: 9 }}
                    />
                    <Tooltip content={<StackedBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                    <Bar dataKey="known" name="Known" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="unknown" name="Unknown" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </motion.div>
        )}

        {/* ── Activity + Confidence ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-52" /><Skeleton className="h-52" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.6 }}>
              <ChartCard title="Activity by Hour of Day" subtitle="Bars show how many detections happened at each hour of the day across the selected period. Peak columns reveal when your cameras are busiest — use this to optimise staffing or alert thresholds.">
                <div className="mb-2">
                  <ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />
                </div>
                {hourlyData.some(h => h.total > 0) ? (
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourlyData} margin={{ left: 0, right: 4, top: 4, bottom: 18 }} barSize={6}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="hour" tick={{ fill: '#52525b', fontSize: 8, fontFamily: 'monospace' }}
                          axisLine={false} tickLine={false} interval={3}
                          label={{ value: 'Hour (24h)', position: 'insideBottomRight', offset: -4, fill: '#3f3f46', fontSize: 8 }}
                        />
                        <YAxis tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                          axisLine={false} tickLine={false} allowDecimals={false} width={24}
                          label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: 6, fill: '#3f3f46', fontSize: 8 }}
                        />
                        <Tooltip content={<StackedBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.08)' }} />
                        <Bar dataKey="known" name="Known" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="unknown" name="Unknown" stackId="a" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-44"><EmptyIcon><Clock /></EmptyIcon><EmptyTitle>No data</EmptyTitle></Empty>
                )}
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.7 }}>
              <ChartCard title="Confidence Distribution" subtitle="Detections are grouped into five confidence bands showing how certain the model was about each face. A cluster in the 80–100% band is ideal; a spike in lower bands suggests challenging lighting or camera angle conditions.">
                <div className="mb-2">
                  <ColorLegend items={[{ label: 'Known', color: '#6366f1' }, { label: 'Unknown', color: '#a78bfa' }]} />
                </div>
                {confidenceDist.some(b => b.total > 0) ? (
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={confidenceDist} margin={{ left: 0, right: 4, top: 4, bottom: 18 }} barSize={32}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="range" tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'monospace' }}
                          axisLine={false} tickLine={false}
                          label={{ value: 'Confidence Band', position: 'insideBottomRight', offset: -4, fill: '#3f3f46', fontSize: 8 }}
                        />
                        <YAxis tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                          axisLine={false} tickLine={false} allowDecimals={false} width={24}
                          label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: 6, fill: '#3f3f46', fontSize: 8 }}
                        />
                        <Tooltip content={<StackedBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.08)' }} />
                        <Bar dataKey="known" name="Known" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="unknown" name="Unknown" stackId="a" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-44"><EmptyIcon><Target /></EmptyIcon><EmptyTitle>No data</EmptyTitle></Empty>
                )}
              </ChartCard>
            </motion.div>
          </div>
        )}

        {/* ── Row: Trace + Density ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-64" /><Skeleton className="h-64" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.8 }}>
              <ChartCard
                title="Camera Rank Trace"
                subtitle="Shows how cameras shift in relative importance over the selected period. A rising line means that camera is becoming a dominant detection source."
              >
                <div className="h-52">
                  <BumpChart data={bumpData} colors={INDIGO_PALETTE} />
                </div>
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.8 }}>
              <ChartCard
                title="Activity Density"
                subtitle="Joy plot showing detection intensity per hour for top cameras. Overlapping waves reveal common patterns and unique 'rush hours' for specific locations."
              >
                <div className="h-52">
                  <RidgelineChart data={joyData} colors={INDIGO_PALETTE} />
                </div>
              </ChartCard>
            </motion.div>
          </div>
        )}

        {/* ── Row: Sankey + Chord ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-64" /><Skeleton className="h-64" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <motion.div className="h-full" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.9 }}>
              <ChartCard
                title="Camera Detection Flow"
                subtitle="Ribbons trace each camera's detections (left) into known (green) or unknown (amber) outcomes on the right."
                action={
                  <ColorLegend items={[
                    { label: 'Cameras', color: '#6366f1' },
                    { label: 'Known', color: '#10b981' },
                    { label: 'Unknown', color: '#f59e0b' },
                  ]} />
                }
              >
                <div className="h-[340px] w-full flex items-center">
                  <SankeyChart
                    flows={cameraFlows}
                    knownTotal={cameraFlows.reduce((s, f) => s + f.known, 0)}
                    unknownTotal={cameraFlows.reduce((s, f) => s + f.unknown, 0)}
                  />
                </div>
              </ChartCard>
            </motion.div>

            <motion.div className="h-full" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 1.0 }}>
              <ChartCard
                title="Camera Cross-Detection"
                subtitle="Circular flow showing the relationship between cameras and detection time slots. Click or hover segments to isolate specific camera paths."
              >
                <div className="flex justify-center h-[340px]">
                  <ChordDiagram
                    matrix={chordData.matrix}
                    labels={chordData.labels}
                    colors={chordData.colors.length ? chordData.colors : INDIGO_PALETTE}
                  />
                </div>
              </ChartCard>
            </motion.div>
          </div>
        )}


        {/* ── Row: Stream Graph + Marimekko ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-52" /><Skeleton className="h-52" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 1.1 }}>
              <ChartCard
                title="Detection Stream"
                subtitle="Multi-layer stream showing per-camera detection volume over time. Each layer is one camera — wider bands mean higher activity."
                action={<ColorLegend items={streamCamData.cameras.slice(0, 5).map((c, i) => ({ label: c, color: STREAM_BLUES[i % STREAM_BLUES.length] }))} />}
              >
                {streamCamData.rows.length > 0 && streamCamData.cameras.length > 0 ? (
                  <motion.div className="h-56"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: 0.8 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={streamCamData.rows} stackOffset="silhouette"
                        margin={{ left: 0, right: 0, top: 4, bottom: 20 }}>
                        <XAxis dataKey="label"
                          tick={{ fill: '#52525b', fontSize: 8, fontFamily: 'monospace' }}
                          axisLine={false} tickLine={false}
                          interval={Math.max(1, Math.floor(streamCamData.rows.length / 10))}
                        />
                        <YAxis hide />
                        <Tooltip
                          content={({ active, payload, label }: any) => {
                            if (!active || !payload?.length) return null;
                            const total = payload.reduce((s: number, p: any) => s + (Math.abs(p.value) || 0), 0);
                            return (
                              <div className="bg-zinc-900/95 border border-white/10 backdrop-blur-md rounded-lg px-3 py-2.5 shadow-2xl min-w-[165px]">
                                <p className="text-[11px] font-mono font-semibold text-zinc-200 mb-1.5">{label}</p>
                                <div className="space-y-1">
                                  {[...payload].reverse().filter((p: any) => Math.abs(p.value) > 0).map((p: any, i: number) => (
                                    <div key={i} className="flex justify-between gap-3">
                                      <span className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-mono">
                                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.fill || p.color || p.stroke }} />{p.name}
                                      </span>
                                      <span className="text-zinc-200 text-xs font-mono font-bold">{fmtN(Math.abs(p.value))}</span>
                                    </div>
                                  ))}
                                  <div className="flex justify-between gap-3 pt-1.5 border-t border-white/5">
                                    <span className="text-zinc-500 text-[10px] font-mono">Total</span>
                                    <span className="text-zinc-100 text-xs font-mono font-bold">{fmtN(total)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }}
                          cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, strokeDasharray: '4 2' }}
                        />
                        {streamCamData.cameras.map((cam, i) => (
                          <Area key={cam} type="natural" dataKey={cam} name={cam} stackId="1"
                            stroke="none" strokeWidth={0}
                            fill={STREAM_BLUES[i % STREAM_BLUES.length]} fillOpacity={1}
                            dot={false}
                            activeDot={{ r: 3, fill: '#fff', stroke: STREAM_BLUES[i % STREAM_BLUES.length], strokeWidth: 2 }}
                            isAnimationActive animationDuration={1800} animationEasing="ease-out"
                            animationBegin={i * 60} />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </motion.div>
                ) : (
                  <Empty className="min-h-0 h-52">
                    <EmptyIcon><Activity /></EmptyIcon>
                    <EmptyTitle>No stream data</EmptyTitle>
                  </Empty>
                )}
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 1.2 }}>
              <ChartCard
                title="Camera Composition"
                subtitle="Column width shows each camera's share of total detections; column height splits known (green, bottom) from unknown (amber, top). Wide columns are high-volume; tall green sections mean strong watchlist match rates."
                action={<ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />}
              >
                {cameraStackData.length > 0 ? (
                  <div className="h-48 flex items-center">
                    <MarimekkoChart data={cameraStackData} />
                  </div>
                ) : (
                  <Empty className="min-h-0 h-44">
                    <EmptyIcon><BarChart3 /></EmptyIcon>
                    <EmptyTitle>No camera data</EmptyTitle>
                  </Empty>
                )}
              </ChartCard>
            </motion.div>
          </div>
        )}

        {/* ── Radial Activity Chart ── */}
        {!loading && frsStats.byDevice.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 1.25 }}>
            <ChartCard
              title="Camera Activity Radial"
              subtitle="Each arc represents one camera's detection share relative to the busiest camera. Longer arcs indicate higher-volume sources."
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%" cy="55%"
                    innerRadius="15%" outerRadius="90%"
                    data={frsStats.byDevice.slice(0, 8).map((d, i) => ({
                      name: d.deviceName,
                      value: d.count,
                      fill: INDIGO_PALETTE[i % INDIGO_PALETTE.length],
                    }))}
                    startAngle={90} endAngle={-270}
                  >
                    <RadialBar
                      dataKey="value"
                      cornerRadius={4}
                      label={{ position: 'insideStart', fill: '#71717a', fontSize: 8, fontFamily: 'monospace' }}
                    />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        const total = frsStats.byDevice.reduce((s, x) => s + x.count, 0);
                        return (
                          <div className={`${TT} px-3 py-2.5`}>
                            <p className="text-zinc-200 text-[11px] font-mono font-semibold pb-1 mb-1 border-b border-white/5 truncate">{d.name}</p>
                            <div className={TTRow}><span className={TTKey}>Detections</span><span className={TTVal}>{fmtN(d.value)}</span></div>
                            <div className={TTRow}><span className={TTKey}>Share</span><span className="text-indigo-400 text-xs font-mono font-bold">{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</span></div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      iconSize={8} iconType="circle"
                      formatter={(v: string) => <span className="text-zinc-500 text-[9px] font-mono truncate max-w-[80px] inline-block">{v}</span>}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </motion.div>
        )}

        {/* ── Pareto: Top Persons ── */}
        {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : personPareto.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 1.3 }}>
            <ChartCard
              title="Top Detected Persons"
              subtitle="Bars show how many times each enrolled person was detected, sorted from most to least. The amber line tracks cumulative coverage — persons on the far left dominate match counts, highlighting who drives the most watchlist activity."
              action={<span className="text-[10px] font-mono text-zinc-600">{rangeLabel}</span>}
            >
              <div className="mb-2 flex items-center gap-4 flex-wrap">
                <ColorLegend items={[
                  { label: 'Detections', color: '#8b5cf6' },
                  { label: 'Cumulative %', color: '#f59e0b' },
                ]} />
                <span className="text-[10px] font-mono text-zinc-600 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-indigo-500" />vital few principle
                </span>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={personPareto} margin={{ left: 4, right: 40, top: 6, bottom: 44 }}
                    barSize={Math.max(20, Math.min(52, Math.floor(600 / Math.max(personPareto.length, 1)) - 10))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} angle={-30} textAnchor="end" height={46} interval={0}
                      label={{ value: 'Person', position: 'insideBottomRight', offset: -4, fill: '#3f3f46', fontSize: 9 }}
                    />
                    <YAxis yAxisId="left" tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} allowDecimals={false} width={32}
                      label={{ value: 'Detections', angle: -90, position: 'insideLeft', offset: 8, fill: '#3f3f46', fontSize: 9 }}
                    />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false} width={32}
                    />
                    <Tooltip content={<PersonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.08)' }} />
                    <ReferenceLine yAxisId="right" y={80} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.4} strokeWidth={1}
                      label={{ value: '80%', position: 'insideTopRight', fill: '#ef4444', fontSize: 9 }}
                    />
                    <Bar yAxisId="left" dataKey="count" name="Detections" radius={[4, 4, 0, 0]}>
                      {personPareto.map((_, i) => (
                        <Cell key={i} fill={['#6366f1', '#8b5cf6', '#4f46e5', '#7c3aed', '#a78bfa'][i % 5]} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="cumPct" name="Cumulative %"
                      stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 4, fill: '#f59e0b' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </motion.div>
        )}

        {/* ── Watchlist Summary ── */}
        {loading ? <Skeleton className="h-52 w-full rounded-xl" /> : personsList.length > 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 1.4 }}>
            <ChartCard
              title="Watchlist Detection Summary"
              subtitle="Each row is a watchlist person showing their detection count and last seen date for the selected period. The horizontal bar compares each person's frequency relative to the most-matched person."
              action={
                <span className="text-[10px] font-mono text-zinc-600">
                  {personsList.filter(p => p.count > 0).length}/{personsList.length} matched · {rangeLabel}
                </span>
              }
            >
              <div className="max-h-80 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {personsList.map(ps => {
                    const accent =
                      ps.threatLevel?.toLowerCase() === 'high' ? 'border-l-red-500' :
                        ps.threatLevel?.toLowerCase() === 'medium' ? 'border-l-amber-500' :
                          ps.threatLevel?.toLowerCase() === 'low' ? 'border-l-emerald-500' : 'border-l-zinc-700';
                    const maxCount = personsList[0]?.count || 1;
                    return (
                      <div key={ps.id} className={`flex items-center gap-3 p-2.5 rounded-lg border border-white/5 bg-white/[0.015] border-l-2 ${accent}`}>
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-800 shrink-0">
                          {ps.faceImageUrl
                            ? <img src={ps.faceImageUrl} className="w-full h-full object-cover" alt="" />
                            : <div className="w-full h-full flex items-center justify-center"><UserCheck className="w-3.5 h-3.5 text-zinc-600" /></div>
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-zinc-200 truncate">{ps.name}</div>
                          <div className="text-[10px] text-zinc-500 truncate">{ps.category ?? '—'} · {ps.lastSeen ? new Date(ps.lastSeen).toLocaleDateString() : 'not seen'}</div>
                          {/* Mini relative bar */}
                          <div className="h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full bg-indigo-500/50 rounded-full transition-all"
                              style={{ width: `${Math.min(100, (ps.count / maxCount) * 100)}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-mono font-bold ${ps.count > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>{ps.count}×</div>
                          {ps.avgConf > 0 && <div className="text-[10px] text-zinc-500">{(ps.avgConf * 100).toFixed(0)}%</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ChartCard>
          </motion.div>
        )}

        {/* ── Match Breakdown + Threat Levels ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-52" /><Skeleton className="h-52" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <motion.div initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 1.5 }}>
              <ChartCard title="Match Breakdown" subtitle="Watchlist matches vs unidentified faces with match rate and average confidence.">
                <div className="flex flex-col sm:flex-row items-center gap-5 pt-1">
                  <motion.div className="h-40 w-40 shrink-0 relative"
                    initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <defs>
                          <filter id="donut-glow">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                          </filter>
                        </defs>
                        <Pie data={[{ name: 'Known', value: knownDet }, { name: 'Unknown', value: unknownDet }]}
                          cx="50%" cy="50%" innerRadius={42} outerRadius={65}
                          dataKey="value" paddingAngle={4} stroke="none" cornerRadius={4}
                          isAnimationActive animationDuration={1000} animationEasing="ease-out">
                          <Cell fill="#10b981" /><Cell fill="#f59e0b" />
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-lg font-mono font-bold text-zinc-100">{matchRate.toFixed(0)}%</span>
                      <span className="text-[9px] font-mono text-zinc-500">match</span>
                    </div>
                  </motion.div>
                  <div className="w-full space-y-3">
                    {[
                      { label: 'Known', val: knownDet, pct: matchRate, color: 'bg-emerald-500', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
                      { label: 'Unknown', val: unknownDet, pct: 100 - matchRate, color: 'bg-amber-500', text: 'text-amber-400', ring: 'ring-amber-500/20' },
                    ].map((r, idx) => (
                      <motion.div key={r.label}
                        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 + idx * 0.15 }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
                            <span className={`w-2.5 h-2.5 rounded-full ${r.color} ring-2 ${r.ring}`} />{r.label}
                          </span>
                          <span className={`text-sm font-mono font-bold ${r.text}`}>
                            {fmtN(r.val)} <span className="text-zinc-600 font-normal text-xs">({r.pct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                          <motion.div className={`h-full ${r.color} rounded-full`}
                            initial={{ width: 0 }} animate={{ width: `${Math.min(100, r.pct)}%` }}
                            transition={{ duration: 0.8, delay: 0.5 + idx * 0.15, ease: [0.16, 1, 0.3, 1] }} />
                        </div>
                      </motion.div>
                    ))}
                    <motion.div className="text-[10px] font-mono text-zinc-500 pt-2 border-t border-white/5 flex gap-4 flex-wrap"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
                      <span>Match rate: <span className="text-indigo-400 font-semibold">{matchRate.toFixed(1)}%</span></span>
                      <span>Avg conf: <span className="text-indigo-400 font-semibold">{(avgConf * 100).toFixed(1)}%</span></span>
                      <span>Total: <span className="text-zinc-300 font-semibold">{fmtN(totalDet)}</span></span>
                    </motion.div>
                  </div>
                </div>
              </ChartCard>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 1.6 }}>
              <ChartCard title="Watchlist Threat Levels" subtitle="Enrolled persons by threat tier.">
                {frsByThreat.length > 0 ? (
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <motion.div className="h-40 w-40 shrink-0 relative"
                      initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.6 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={frsByThreat} cx="50%" cy="50%" innerRadius={42} outerRadius={65}
                            dataKey="value" nameKey="name" paddingAngle={4} stroke="none" cornerRadius={4}
                            isAnimationActive animationDuration={1000} animationEasing="ease-out">
                            {frsByThreat.map((e, i) => <Cell key={i} fill={THREAT_COLORS[e.name] ?? '#6366f1'} />)}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-lg font-mono font-bold text-zinc-100">{frsByThreat.reduce((s, t) => s + t.value, 0)}</span>
                        <span className="text-[9px] font-mono text-zinc-500">enrolled</span>
                      </div>
                    </motion.div>
                    <div className="w-full space-y-2.5">
                      {frsByThreat.map((t, idx) => {
                        const total = frsByThreat.reduce((s, x) => s + x.value, 0);
                        const pct = total > 0 ? (t.value / total) * 100 : 0;
                        const col = THREAT_COLORS[t.name] ?? '#6366f1';
                        return (
                          <motion.div key={t.name}
                            initial={{ opacity: 0, x: 15 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: 0.3 + idx * 0.1 }}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col }} />{t.name}
                              </span>
                              <span className="text-sm font-mono font-bold" style={{ color: col }}>
                                {t.value} <span className="text-zinc-600 font-normal text-xs">({pct.toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <motion.div className="h-full rounded-full"
                                style={{ background: col }}
                                initial={{ width: 0 }} animate={{ width: `${Math.min(100, pct)}%` }}
                                transition={{ duration: 0.7, delay: 0.4 + idx * 0.1 }} />
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <Empty className="min-h-0 h-48">
                    <EmptyIcon><UserCheck /></EmptyIcon>
                    <EmptyTitle>No profiles enrolled</EmptyTitle>
                  </Empty>
                )}
              </ChartCard>
            </motion.div>
          </div>
        )}

        <div className="h-2 shrink-0" />
      </div>

      <FRSReportModal open={reportOpen} onOpenChange={setReportOpen}
        persons={stats.frsPersons || []} detections={stats.frsDetections || []}
        timeRange={rangeLabel} />
    </div>
  );
}
