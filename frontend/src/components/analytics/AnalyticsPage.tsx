import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie,
  ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceLine,
} from 'recharts';
import {
  Activity, BarChart3, RefreshCw, ScanFace, UserCheck, UserX, FileText,
  Clock, Target, TrendingUp, Zap, GitMerge,
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
    case '7d':   start = new Date(now.getTime() - 7 * 86400000); break;
    case '30d':  start = new Date(now.getTime() - 30 * 86400000); break;
  }
  return { startTime: start!.toISOString(), endTime: now.toISOString() };
}

function fmtN(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
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
    { range: '0–20%', min: 0,   max: 0.2,  known: 0, unknown: 0 },
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
  const known   = payload.find((p: any) => p.dataKey === 'known')?.value ?? 0;
  const unknown = payload.find((p: any) => p.dataKey === 'unknown')?.value ?? 0;
  const total   = known + unknown;
  const kPct = total > 0 ? `${((known   / total) * 100).toFixed(0)}%` : '—';
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
  const count  = payload.find((p: any) => p.dataKey === 'count')?.value ?? 0;
  const cumPct = payload.find((p: any) => p.dataKey === 'cumPct')?.value ?? 0;
  const pct    = payload.find((p: any) => p.dataKey === 'pct')?.value ?? 0;
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
    <Card className={`border border-white/5 bg-zinc-900/30 backdrop-blur-sm ${className ?? ''}`}>
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
  const grand = knownTotal + unknownTotal;
  if (!grand || !flows.length) return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-[11px] font-mono">
      No flow data — increase data limit to populate
    </div>
  );

  const H = 240;
  const NW = 10;           // node rect width
  const VGAP = 5;          // gap between camera bars
  const scale = (v: number) => (v / grand) * (H - VGAP * Math.max(flows.length - 1, 0));

  // Camera nodes (left column)
  let camOffsetY = 0;
  const cams = flows.map(f => {
    const h = Math.max(6, scale(f.known + f.unknown));
    const kH = scale(f.known);
    const uH = scale(f.unknown);
    const node = { ...f, y: camOffsetY, h, kH, uH };
    camOffsetY += h + VGAP;
    return node;
  });

  // Right nodes
  const kH_r = Math.max(8, scale(knownTotal));
  const uH_r = Math.max(8, scale(unknownTotal));
  const kY_r = 0;
  const uY_r = kH_r + VGAP;

  const VW = 500;
  const LX = 150;   // left node x (camera names sit left of this)
  const RX = 340;   // right node x
  const CP1X = LX + NW + (RX - LX - NW) * 0.45;
  const CP2X = RX - (RX - LX - NW) * 0.45;

  const paths: JSX.Element[] = [];
  let rkOff = kY_r;
  let ruOff = uY_r;

  for (const cam of cams) {
    if (cam.known > 0) {
      const lT = cam.y; const lB = cam.y + cam.kH;
      const rT = rkOff; const rB = rkOff + cam.kH;
      rkOff += cam.kH;
      paths.push(
        <path key={`k-${cam.name}`}
          d={`M${LX + NW},${lT} C${CP1X},${lT} ${CP2X},${rT} ${RX},${rT} L${RX},${rB} C${CP2X},${rB} ${CP1X},${lB} ${LX + NW},${lB} Z`}
          fill="#10b981" fillOpacity={0.15} stroke="#10b981" strokeOpacity={0.3} strokeWidth={0.5}
        />
      );
    }
    if (cam.unknown > 0) {
      const lT = cam.y + cam.kH; const lB = cam.y + cam.h;
      const rT = ruOff; const rB = ruOff + cam.uH;
      ruOff += cam.uH;
      paths.push(
        <path key={`u-${cam.name}`}
          d={`M${LX + NW},${lT} C${CP1X},${lT} ${CP2X},${rT} ${RX},${rT} L${RX},${rB} C${CP2X},${rB} ${CP1X},${lB} ${LX + NW},${lB} Z`}
          fill="#f59e0b" fillOpacity={0.15} stroke="#f59e0b" strokeOpacity={0.3} strokeWidth={0.5}
        />
      );
    }
  }

  const svgH = Math.max(camOffsetY - VGAP, uY_r + uH_r) + 16;

  return (
    <svg viewBox={`0 0 ${VW} ${svgH}`} className="w-full" style={{ maxHeight: H + 40 }} preserveAspectRatio="xMidYMid meet">
      {/* Paths */}
      {paths}

      {/* Camera nodes */}
      {cams.map((cam, i) => (
        <g key={cam.name}>
          <rect x={LX} y={cam.y} width={NW} height={Math.max(2, cam.h)} rx={2} fill={INDIGO_PALETTE[i % INDIGO_PALETTE.length]} />
          {/* Name label */}
          <text x={LX - 6} y={cam.y + cam.h / 2 + 3} fontSize={9} fill="#a1a1aa" textAnchor="end" fontFamily="monospace">
            {cam.name.length > 16 ? cam.name.slice(0, 15) + '…' : cam.name}
          </text>
          {/* Count label inside or below */}
          <text x={LX - 6} y={cam.y + cam.h / 2 + 12} fontSize={7.5} fill="#52525b" textAnchor="end" fontFamily="monospace">
            {fmtN(cam.known + cam.unknown)}
          </text>
        </g>
      ))}

      {/* Known node */}
      <rect x={RX} y={kY_r} width={NW} height={Math.max(2, kH_r)} rx={2} fill="#10b981" />
      <text x={RX + NW + 6} y={kY_r + kH_r / 2 + 3} fontSize={9} fill="#10b981" fontFamily="monospace" fontWeight="600">Known</text>
      <text x={RX + NW + 6} y={kY_r + kH_r / 2 + 13} fontSize={7.5} fill="#52525b" fontFamily="monospace">{fmtN(knownTotal)}</text>

      {/* Unknown node */}
      <rect x={RX} y={uY_r} width={NW} height={Math.max(2, uH_r)} rx={2} fill="#f59e0b" />
      <text x={RX + NW + 6} y={uY_r + uH_r / 2 + 3} fontSize={9} fill="#f59e0b" fontFamily="monospace" fontWeight="600">Unknown</text>
      <text x={RX + NW + 6} y={uY_r + uH_r / 2 + 13} fontSize={7.5} fill="#52525b" fontFamily="monospace">{fmtN(unknownTotal)}</text>

      {/* Header labels */}
      <text x={LX + NW / 2} y={svgH - 2} fontSize={8} fill="#3f3f46" textAnchor="middle" fontFamily="monospace">Cameras</text>
      <text x={RX + NW / 2} y={svgH - 2} fontSize={8} fill="#3f3f46" textAnchor="middle" fontFamily="monospace">Outcome</text>
    </svg>
  );
}

// ── Nightingale Rose (polar coxcomb) ─────────────────────────────────────────

function NightingaleRose({ data }: { data: { hour: string; total: number; known: number; unknown: number }[] }) {
  const maxVal = Math.max(...data.map(d => d.total), 1);
  const N = data.length;
  const CX = 110, CY = 110, RMAX = 86, RMIN = 10;
  const step = (2 * Math.PI) / N;

  function sectorPath(innerR: number, outerR: number, idx: number) {
    if (outerR <= innerR + 0.5) return '';
    const a0 = idx * step - Math.PI / 2 - step / 2 + 0.03;
    const a1 = idx * step - Math.PI / 2 + step / 2 - 0.03;
    const x0i = CX + innerR * Math.cos(a0), y0i = CY + innerR * Math.sin(a0);
    const x1i = CX + innerR * Math.cos(a1), y1i = CY + innerR * Math.sin(a1);
    const x0o = CX + outerR * Math.cos(a0), y0o = CY + outerR * Math.sin(a0);
    const x1o = CX + outerR * Math.cos(a1), y1o = CY + outerR * Math.sin(a1);
    const lg = step > Math.PI ? 1 : 0;
    return `M${x0i},${y0i} L${x0o},${y0o} A${outerR},${outerR} 0 ${lg} 1 ${x1o},${y1o} L${x1i},${y1i} A${innerR},${innerR} 0 ${lg} 0 ${x0i},${y0i} Z`;
  }

  return (
    <svg viewBox="0 0 220 220" className="w-full" style={{ maxHeight: 210 }}>
      {[0.33, 0.66, 1].map(f => (
        <circle key={f} cx={CX} cy={CY} r={RMIN + (RMAX - RMIN) * f}
          fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
      ))}
      {data.map((d, i) => {
        const totalR = RMIN + (d.total / maxVal) * (RMAX - RMIN);
        const knownR = RMIN + (d.known / maxVal) * (RMAX - RMIN);
        const hour = parseInt(d.hour);
        const angle = i * step - Math.PI / 2;
        return (
          <g key={i}>
            <path d={sectorPath(RMIN, totalR, i)} fill="#f59e0b" fillOpacity={0.28} />
            {d.known > 0 && <path d={sectorPath(RMIN, knownR, i)} fill="#10b981" fillOpacity={0.65} />}
            {hour % 6 === 0 && (
              <text x={CX + (RMAX + 14) * Math.cos(angle)} y={CY + (RMAX + 14) * Math.sin(angle)}
                fontSize={8} fill="#52525b" textAnchor="middle" dominantBaseline="middle" fontFamily="monospace">
                {hour.toString().padStart(2, '0')}h
              </text>
            )}
          </g>
        );
      })}
      <circle cx={CX} cy={CY} r={RMIN} fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      <text x={CX} y={CY - 5} fontSize={9} fill="#71717a" textAnchor="middle" fontFamily="monospace">24h</text>
      <text x={CX} y={CY + 7} fontSize={7} fill="#52525b" textAnchor="middle" fontFamily="monospace">activity</text>
    </svg>
  );
}

// ── Marimekko chart ───────────────────────────────────────────────────────────

function MarimekkoChart({ data }: { data: { name: string; known: number; unknown: number; total: number }[] }) {
  const totalAll = data.reduce((s, d) => s + d.total, 0);
  if (!totalAll || !data.length) return (
    <div className="flex items-center justify-center h-full text-zinc-600 text-[11px] font-mono">No data</div>
  );
  const VW = 500, VH = 185, LBL_H = 22;
  const chartH = VH - LBL_H;
  const GAP = 2;
  const availW = VW - GAP * (data.length - 1);
  let xOff = 0;
  const rects = data.map(d => {
    const w = (d.total / totalAll) * availW;
    const knownH = d.total > 0 ? (d.known / d.total) * chartH : 0;
    const r = { ...d, x: xOff, w, knownH, unknownH: chartH - knownH };
    xOff += w + GAP;
    return r;
  });
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ maxHeight: VH }}>
      {[0.25, 0.5, 0.75].map(f => (
        <g key={f}>
          <line x1={0} y1={chartH * f} x2={VW} y2={chartH * f}
            stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} strokeDasharray="3 3" />
          <text x={VW} y={chartH * f - 2} fontSize={6} fill="#3f3f46" textAnchor="end" fontFamily="monospace">
            {((1 - f) * 100).toFixed(0)}% known
          </text>
        </g>
      ))}
      {rects.map(r => {
        const knownPct = r.total > 0 ? ((r.known / r.total) * 100).toFixed(0) : '0';
        const sharePct = ((r.total / totalAll) * 100).toFixed(0);
        const shortName = r.name.length > 9 ? r.name.slice(0, 8) + '…' : r.name;
        return (
          <g key={r.name}>
            <rect x={r.x} y={0} width={Math.max(0, r.w)} height={r.unknownH} fill="#f59e0b" fillOpacity={0.38} />
            <rect x={r.x} y={r.unknownH} width={Math.max(0, r.w)} height={r.knownH} fill="#10b981" fillOpacity={0.52} />
            <rect x={r.x} y={0} width={Math.max(0, r.w)} height={chartH} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
            {r.knownH > 14 && r.w > 28 && (
              <text x={r.x + r.w / 2} y={r.unknownH + r.knownH / 2 + 3}
                fontSize={7} fill="#10b981" textAnchor="middle" fontFamily="monospace" opacity={0.9}>
                {knownPct}%
              </text>
            )}
            {r.w > 22 && (
              <text x={r.x + r.w / 2} y={9} fontSize={6.5} fill="#a1a1aa" textAnchor="middle" fontFamily="monospace">
                {sharePct}%
              </text>
            )}
            <text x={r.x + r.w / 2} y={VH - 5} fontSize={6.5} fill="#71717a" textAnchor="middle" fontFamily="monospace">
              {r.w > 28 ? shortName : r.w > 14 ? r.name.slice(0, 3) : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Stream graph tooltip ──────────────────────────────────────────────────────

function StreamTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const known   = payload.find((p: any) => p.dataKey === 'known')?.value ?? 0;
  const unknown = payload.find((p: any) => p.dataKey === 'unknown')?.value ?? 0;
  const total   = known + unknown;
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
  const [timeRange,  setTimeRange]  = useState<TimeRange>('7d');
  const [dataLimit,  setDataLimit]  = useState<DataLimit>(5000);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [loading,    setLoading]    = useState(true);
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
        frsStats:      frsStats.status      === 'fulfilled' ? frsStats.value      : null,
        frsPersons:    frsPersons.status    === 'fulfilled' ? frsPersons.value    : null,
        frsDetections: frsDetections.status === 'fulfilled' ? frsDetections.value : null,
        frsTimeline:   frsTimeline.status   === 'fulfilled' ? frsTimeline.value   : null,
      });
    } catch (e) { console.error('Analytics fetch error:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [timeRange, dataLimit, granularity]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  // ── Derived values ──
  const dets      = stats.frsDetections ?? [];
  const frsStats  = stats.frsStats;
  const totalDet  = frsStats?.totalDetections ?? 0;
  const knownDet  = frsStats?.knownDetections ?? 0;
  const unknownDet = frsStats?.unknownDetections ?? 0;
  const avgConf   = frsStats?.avgConfidence ?? 0;
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
      const id   = det.deviceId ?? 'unknown';
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

  const timelineData   = useMemo(() => buildTimelineFromBuckets(stats.frsTimeline ?? [], granularity), [stats.frsTimeline, granularity]);
  const hourlyData     = useMemo(() => buildHourlyPattern(dets), [dets]);
  const confidenceDist = useMemo(() => buildConfidenceDist(dets), [dets]);

  const tlInterval = (() => {
    const n = timelineData.length;
    if (granularity === 'hour') return n <= 24 ? 'preserveStartEnd' : Math.max(1, Math.floor(n / 12));
    return n <= 14 ? 'preserveStartEnd' : Math.max(1, Math.floor(n / 10));
  })();

  // Pareto 80% cross point
  const cam80idx = cameraPareto.findIndex(d => d.cumPct >= 80);
  const cam80name = cam80idx >= 0 ? cameraPareto[cam80idx]?.name : null;

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
          <KPICard label="Total Detections" value={totalDet} sub={rangeLabel}
            icon={ScanFace} accent="text-zinc-100" loading={loading} />
          <KPICard label="Known Matches" value={knownDet} sub={`of ${fmtN(totalDet)} total`}
            icon={UserCheck} accent="text-emerald-400"
            gaugePct={matchRate} gaugeColor="#10b981" loading={loading} />
          <KPICard label="Unknown Faces" value={unknownDet} sub={`${(100 - matchRate).toFixed(0)}% of detections`}
            icon={UserX} accent="text-amber-400"
            gaugePct={totalDet > 0 ? (unknownDet / totalDet) * 100 : 0} gaugeColor="#f59e0b" loading={loading} />
          <KPICard label="Avg Confidence" value={`${(avgConf * 100).toFixed(1)}%`} sub="recognition quality"
            icon={Target} accent="text-indigo-400"
            gaugePct={avgConf * 100} gaugeColor="#6366f1" loading={loading} />
          <KPICard label="Enrolled" value={enrolledCount} sub="watchlist persons"
            icon={Activity} accent="text-zinc-100" loading={loading} />
          <KPICard label="Active Cameras" value={frsStats?.byDevice?.length ?? 0} sub="with detections"
            icon={Zap} accent="text-sky-400" loading={loading} />
        </div>

        {/* ── Detection Timeline ── */}
        {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : (
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
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gUnknown" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.28} />
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
                    <Area type="monotone" dataKey="known"   name="Known"   stackId="1"
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
        )}

        {/* ── Pareto: Camera Detections ── */}
        {loading ? <Skeleton className="h-72 w-full rounded-xl" /> : cameraPareto.length > 0 && (
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
        )}

        {/* ── Stacked: Camera Known vs Unknown ── */}
        {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : cameraStackData.length > 0 && (
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
                  <Bar dataKey="known"   name="Known"   stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="unknown" name="Unknown" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {/* ── Activity + Confidence ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-52" /><Skeleton className="h-52" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

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
                      <Bar dataKey="known"   name="Known"   stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="unknown" name="Unknown" stackId="a" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty className="min-h-0 h-44"><EmptyIcon><Clock /></EmptyIcon><EmptyTitle>No data</EmptyTitle></Empty>
              )}
            </ChartCard>

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
                      <Bar dataKey="known"   name="Known"   stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="unknown" name="Unknown" stackId="a" fill="#a78bfa" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty className="min-h-0 h-44"><EmptyIcon><Target /></EmptyIcon><EmptyTitle>No data</EmptyTitle></Empty>
              )}
            </ChartCard>
          </div>
        )}

        {/* ── Row: Sankey + Nightingale Rose ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-64" /><Skeleton className="h-64" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard
              title="Camera Detection Flow"
              subtitle="Ribbons trace each camera's detections (left) into known (green) or unknown (amber) outcomes on the right. Thicker ribbons mean a greater share of that camera's traffic flows to that outcome."
              action={
                <ColorLegend items={[
                  { label: 'Cameras', color: '#6366f1' },
                  { label: 'Known', color: '#10b981' },
                  { label: 'Unknown', color: '#f59e0b' },
                ]} />
              }
            >
              <div className="flex items-center gap-2 mb-2">
                <GitMerge className="w-3 h-3 text-zinc-600" />
                <span className="text-[10px] font-mono text-zinc-600">
                  {cameraFlows.length > 0
                    ? `${cameraFlows.length} cameras · ${fmtN(dets.length)} sampled`
                    : 'Increase data rows to see flows'}
                </span>
              </div>
              <div className="h-52 flex items-center">
                <SankeyChart
                  flows={cameraFlows}
                  knownTotal={cameraFlows.reduce((s, f) => s + f.known, 0)}
                  unknownTotal={cameraFlows.reduce((s, f) => s + f.unknown, 0)}
                />
              </div>
            </ChartCard>

            <ChartCard
              title="Hourly Activity Rose"
              subtitle="Each petal represents one hour of the day — petal length shows total detections, green fill shows the known-match portion. Longer petals indicate peak hours; fully green petals mean high watchlist match rates."
              action={<ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />}
            >
              <div className="flex justify-center">
                <NightingaleRose data={hourlyData} />
              </div>
            </ChartCard>
          </div>
        )}

        {/* ── Row: Stream Graph + Marimekko ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-52" /><Skeleton className="h-52" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard
              title="Detection Stream"
              subtitle="A fluid stream chart showing known (green) and unknown (amber) detection volumes flowing over time. The wave shape reveals rhythm and spikes in activity — wide sections mean high-volume periods."
              action={<ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />}
            >
              {timelineData.some(d => d.total > 0) ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} stackOffset="wiggle"
                      margin={{ left: 0, right: 4, top: 6, bottom: 18 }}>
                      <defs>
                        <linearGradient id="sgKnown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#10b981" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.15} />
                        </linearGradient>
                        <linearGradient id="sgUnknown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                      <XAxis dataKey="label"
                        tick={{ fill: '#52525b', fontSize: 8.5, fontFamily: 'monospace' }}
                        axisLine={false} tickLine={false}
                        interval={Math.max(1, Math.floor(timelineData.length / 8))}
                        label={{ value: 'Time', position: 'insideBottomRight', offset: -4, fill: '#3f3f46', fontSize: 8 }}
                      />
                      <YAxis hide />
                      <Tooltip content={<StreamTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="unknown" name="Unknown" stackId="1"
                        stroke="#f59e0b" strokeWidth={1} fill="url(#sgUnknown)" dot={false} activeDot={{ r: 3, fill: '#f59e0b' }} />
                      <Area type="monotone" dataKey="known" name="Known" stackId="1"
                        stroke="#10b981" strokeWidth={1} fill="url(#sgKnown)" dot={false} activeDot={{ r: 3, fill: '#10b981' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty className="min-h-0 h-44">
                  <EmptyIcon><Activity /></EmptyIcon>
                  <EmptyTitle>No timeline data</EmptyTitle>
                </Empty>
              )}
            </ChartCard>

            <ChartCard
              title="Camera Composition"
              subtitle="Column width shows each camera's share of total detections; column height splits known (green, bottom) from unknown (amber, top). Wide columns are high-volume; tall green sections mean strong watchlist match rates."
              action={<ColorLegend items={[{ label: 'Known', color: '#10b981' }, { label: 'Unknown', color: '#f59e0b' }]} />}
            >
              {cameraStackData.length > 0 ? (
                <div className="h-44 flex items-center">
                  <MarimekkoChart data={cameraStackData} />
                </div>
              ) : (
                <Empty className="min-h-0 h-44">
                  <EmptyIcon><BarChart3 /></EmptyIcon>
                  <EmptyTitle>No camera data</EmptyTitle>
                </Empty>
              )}
            </ChartCard>
          </div>
        )}

        {/* ── Pareto: Top Persons ── */}
        {loading ? <Skeleton className="h-64 w-full rounded-xl" /> : personPareto.length > 0 && (
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
                      <Cell key={i} fill={['#6366f1','#8b5cf6','#4f46e5','#7c3aed','#a78bfa'][i % 5]} />
                    ))}
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="cumPct" name="Cumulative %"
                    stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: '#f59e0b' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {/* ── Watchlist Summary ── */}
        {loading ? <Skeleton className="h-52 w-full rounded-xl" /> : personsList.length > 0 && (
          <ChartCard
            title="Watchlist Detection Summary"
            subtitle="Each row is a watchlist person showing their detection count and last seen date for the selected period. The horizontal bar compares each person's frequency relative to the most-matched person."
            action={
              <span className="text-[10px] font-mono text-zinc-600">
                {personsList.filter(p => p.count > 0).length}/{personsList.length} matched · {rangeLabel}
              </span>
            }
          >
            <div className="max-h-52 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {personsList.map(ps => {
                  const accent =
                    ps.threatLevel?.toLowerCase() === 'high'   ? 'border-l-red-500' :
                    ps.threatLevel?.toLowerCase() === 'medium' ? 'border-l-amber-500' :
                    ps.threatLevel?.toLowerCase() === 'low'    ? 'border-l-emerald-500' : 'border-l-zinc-700';
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
        )}

        {/* ── Match Breakdown + Threat Levels ── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Skeleton className="h-52" /><Skeleton className="h-52" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

            <ChartCard title="Match Breakdown" subtitle="The donut splits all detections into watchlist matches (green) and unidentified faces (amber). The bars show the exact percentages — a higher green share means your cameras are seeing more enrolled persons.">
              <div className="flex flex-col sm:flex-row items-center gap-4 pt-1">
                <div className="h-36 w-36 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[{ name: 'Known', value: knownDet }, { name: 'Unknown', value: unknownDet }]}
                        cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                        dataKey="value" paddingAngle={3} stroke="none">
                        <Cell fill="#10b981" /><Cell fill="#f59e0b" />
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full space-y-2">
                  {[
                    { label: 'Known',   val: knownDet,   pct: matchRate,        color: 'bg-emerald-500', text: 'text-emerald-400' },
                    { label: 'Unknown', val: unknownDet,  pct: 100 - matchRate,  color: 'bg-amber-500',   text: 'text-amber-400' },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                          <span className={`w-2 h-2 rounded-full ${r.color}`} />{r.label}
                        </span>
                        <span className={`text-xs font-mono font-bold ${r.text}`}>
                          {fmtN(r.val)} <span className="text-zinc-600 font-normal">({r.pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full ${r.color} rounded-full transition-all duration-700`}
                          style={{ width: `${Math.min(100, r.pct)}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="text-[10px] font-mono text-zinc-600 pt-1.5 border-t border-white/5 flex gap-3 flex-wrap">
                    <span>Match rate: <span className="text-indigo-400 font-semibold">{matchRate.toFixed(1)}%</span></span>
                    <span>Avg conf: <span className="text-indigo-400 font-semibold">{(avgConf * 100).toFixed(1)}%</span></span>
                  </div>
                </div>
              </div>
            </ChartCard>

            <ChartCard title="Watchlist Threat Levels" subtitle="Donut segments show how many enrolled persons fall into each threat tier. Use this to understand your watchlist composition and ensure high-threat subjects are adequately monitored.">
              {frsByThreat.length > 0 ? (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={frsByThreat} cx="50%" cy="50%" innerRadius={38} outerRadius={62}
                        dataKey="value" nameKey="name" paddingAngle={3} stroke="none">
                        {frsByThreat.map((e, i) => <Cell key={i} fill={THREAT_COLORS[e.name] ?? '#6366f1'} />)}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                      <Legend
                        formatter={(v: string) => (
                          <span className="text-zinc-400 text-[10px] font-mono">
                            {v} ({frsByThreat.find(f => f.name === v)?.value ?? 0})
                          </span>
                        )}
                        iconType="circle" iconSize={8}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty className="min-h-0 h-48">
                  <EmptyIcon><UserCheck /></EmptyIcon>
                  <EmptyTitle>No profiles enrolled</EmptyTitle>
                </Empty>
              )}
            </ChartCard>
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
