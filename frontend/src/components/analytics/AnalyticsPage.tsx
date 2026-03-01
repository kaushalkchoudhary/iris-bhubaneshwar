import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import {
  Activity, TrendingUp, BarChart3, RefreshCw, Bell, ScanFace, UserCheck, UserX, FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HudBadge } from '@/components/ui/hud-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { apiClient } from '@/lib/api';
import type { AlertStats, Person, FRSMatch } from '@/lib/api';
import { FRSReportModal } from './FRSReportModal';

type TimeRange = 'today' | '7d' | '30d';

interface AllStats {
  alerts: AlertStats | null;
  frsPersons: Person[] | null;
  frsDetections: FRSMatch[] | null;
}

const CHART_COLORS = [
  '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe',
  '#4f46e5', '#4338ca', '#3730a3', '#312e81',
  '#8b5cf6', '#7c3aed', '#10b981', '#f59e0b',
];

function getTimeRangeParams(range: TimeRange): { startTime?: string; endTime?: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;
  switch (range) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }
  return { startTime: start.toISOString(), endTime: end };
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-zinc-400 text-[11px] font-mono mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-zinc-100 text-xs font-mono">
          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: entry.color }} />
          {entry.name}: {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, badge, badgeVariant, loading,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: 'success' | 'warning' | 'danger' | 'info' | 'default';
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-7 w-20 mb-2" />
          <Skeleton className="h-4 w-16" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="group hover:border-indigo-500/20 transition-colors border border-white/5 bg-zinc-900/30 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-mono tracking-widest text-zinc-500">{label}</span>
          <Icon className="h-3.5 w-3.5 text-zinc-600" />
        </div>
        <div className="text-2xl font-mono font-bold text-zinc-100 mb-1">
          {typeof value === 'number' ? formatNumber(value) : value}
        </div>
        {badge && <HudBadge variant={badgeVariant || 'default'} size="sm">{badge}</HudBadge>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`border border-white/5 bg-zinc-900/30 backdrop-blur-sm ${className || ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono tracking-wider text-zinc-400">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [activeTab, setActiveTab] = useState('frs');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [stats, setStats] = useState<AllStats>({ alerts: null, frsPersons: null, frsDetections: null });

  const fetchData = useCallback(async () => {
    try {
      const [alerts, frsPersons, frsDetections] = await Promise.allSettled([
        apiClient.getAlertStats(),
        apiClient.getPersons(),
        apiClient.getFRSDetections({ limit: 1000 }),
      ]);
      setStats({
        alerts: alerts.status === 'fulfilled' ? alerts.value : null,
        frsPersons: frsPersons.status === 'fulfilled' ? frsPersons.value : null,
        frsDetections: frsDetections.status === 'fulfilled' ? frsDetections.value : null,
      });
    } catch (err) {
      console.error('Analytics fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // Derived FRS data
  const timeWindowStart = (() => {
    const p = getTimeRangeParams(timeRange);
    return p.startTime ? new Date(p.startTime).getTime() : 0;
  })();

  const frsWindowDetections = (stats.frsDetections || []).filter((d) => {
    const ts = new Date(d.timestamp).getTime();
    return Number.isFinite(ts) && ts >= timeWindowStart;
  });

  const frsKnownDetections = frsWindowDetections.filter((d) => Boolean(d.personId)).length;
  const frsUnknownDetections = frsWindowDetections.length - frsKnownDetections;
  const frsAverageConfidence = frsWindowDetections.length > 0
    ? frsWindowDetections.reduce((sum, d) => sum + (Number(d.confidence) || 0), 0) / frsWindowDetections.length
    : 0;

  const frsByDevice = Object.entries(
    frsWindowDetections.reduce((acc: Record<string, number>, d) => {
      const key = d.device?.name || d.deviceId || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const frsByThreat = Object.entries(
    (stats.frsPersons || []).reduce((acc: Record<string, number>, p) => {
      const level = (p.threatLevel || 'UNKNOWN').toUpperCase();
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="h-full overflow-hidden relative iris-dashboard-root">
      <div className="h-full p-4 md:p-6 lg:p-8 flex flex-col gap-6 overflow-hidden">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-indigo-400" />
            <h1 className="text-lg font-mono font-bold text-zinc-100">Analytics</h1>
            <HudBadge variant="default" size="sm">Live</HudBadge>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setReportModalOpen(true)} variant="outline" size="sm" className="h-8 text-xs font-mono text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/10">
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Export FRS Report
            </Button>
            <Button onClick={handleRefresh} disabled={refreshing} variant="outline" size="sm" className="h-8 w-8 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <div className="flex bg-white/5 rounded-lg border border-white/5 p-1">
              {(['today', '7d', '30d'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-2.5 py-1 text-[11px] font-mono tracking-wider rounded-md transition-colors btn-glass ${timeRange === range
                    ? 'btn-glass-indigo text-white shadow-sm'
                    : 'btn-glass-outline text-zinc-300 hover:text-zinc-100'
                    }`}
                >
                  {range === 'today' ? 'Today' : range}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="FRS Detections"
            value={frsWindowDetections.length}
            icon={ScanFace}
            badge={timeRange}
            badgeVariant="info"
            loading={loading}
          />
          <StatCard
            label="Known Matches"
            value={frsKnownDetections}
            icon={UserCheck}
            badge={
              frsWindowDetections.length > 0
                ? `${((frsKnownDetections / frsWindowDetections.length) * 100).toFixed(0)}% of total`
                : '0%'
            }
            badgeVariant="success"
            loading={loading}
          />
          <StatCard
            label="Unknown Faces"
            value={frsUnknownDetections}
            icon={UserX}
            badge={`${(frsAverageConfidence * 100).toFixed(0)}% Avg Conf`}
            badgeVariant="warning"
            loading={loading}
          />
          <StatCard
            label="Indexed Persons"
            value={stats.frsPersons?.length ?? 0}
            icon={Activity}
            badge="Watchlist"
            badgeVariant="default"
            loading={loading}
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 overflow-hidden">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger className="text-xs" value="frs">FRS Analytics</TabsTrigger>
            <TabsTrigger className="text-xs" value="alerts">Alerts Summary</TabsTrigger>
          </TabsList>

          {/* ── FRS Tab ────────────────────────────────────────────── */}
          <TabsContent value="frs" className="h-full overflow-y-auto pr-1">
            {loading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
                <Skeleton className="h-72 lg:col-span-2" />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <ChartCard title="FRS Overview">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div className="bg-white/[0.02] rounded-lg p-4 border border-white/5">
                      <span className="text-[10px] font-mono tracking-widest text-zinc-500">Indexed Persons</span>
                      <div className="text-xl font-mono font-bold mt-1 text-zinc-100">{formatNumber(stats.frsPersons?.length ?? 0)}</div>
                    </div>
                    <div className="bg-cyan-500/10 rounded-lg p-4 border border-cyan-500/20">
                      <span className="text-[10px] font-mono tracking-widest text-zinc-500">Detections ({timeRange})</span>
                      <div className="text-xl font-mono font-bold mt-1 text-cyan-300">{formatNumber(frsWindowDetections.length)}</div>
                    </div>
                    <div className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/20">
                      <span className="text-[10px] font-mono tracking-widest text-zinc-500">Known Matches</span>
                      <div className="text-xl font-mono font-bold mt-1 text-emerald-300">{formatNumber(frsKnownDetections)}</div>
                    </div>
                    <div className="bg-amber-500/10 rounded-lg p-4 border border-amber-500/20">
                      <span className="text-[10px] font-mono tracking-widest text-zinc-500">Unknown Faces</span>
                      <div className="text-xl font-mono font-bold mt-1 text-amber-300">{formatNumber(frsUnknownDetections)}</div>
                    </div>
                  </div>
                  <div className="mt-4 text-xs font-mono text-zinc-400 flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-zinc-600" />
                    Average Confidence: <span className="text-zinc-200">{(frsAverageConfidence * 100).toFixed(1)}%</span>
                  </div>
                </ChartCard>

                <ChartCard title="Watchlist by Threat Level">
                  {frsByThreat.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={frsByThreat}
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={88}
                            dataKey="value"
                            nameKey="name"
                            paddingAngle={2}
                            stroke="none"
                          >
                            {frsByThreat.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                          <Legend formatter={(value: string) => <span className="text-zinc-400 text-xs font-mono">{value}</span>} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty className="min-h-0 h-64">
                      <EmptyIcon><UserCheck /></EmptyIcon>
                      <EmptyTitle>No watchlist profiles</EmptyTitle>
                      <EmptyDescription>Enroll persons to see threat-level distribution.</EmptyDescription>
                    </Empty>
                  )}
                </ChartCard>

                <ChartCard title="Devices" className="lg:col-span-2">
                  {frsByDevice.length > 0 ? (
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={frsByDevice} margin={{ left: 0, right: 20, top: 10, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" height={55} />
                          <YAxis tick={{ fill: '#71717a', fontSize: 11, fontFamily: 'monospace' }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="value" name="Detections" radius={[4, 4, 0, 0]}>
                            {frsByDevice.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty className="min-h-0 h-72">
                      <EmptyIcon><UserX /></EmptyIcon>
                      <EmptyTitle>No FRS detections in range</EmptyTitle>
                      <EmptyDescription>Detections will appear here when FRS ingest is active for the selected period.</EmptyDescription>
                    </Empty>
                  )}
                </ChartCard>
              </div>
            )}
          </TabsContent>

          {/* ── Alerts Summary Tab ──────────────────────────────────── */}
          <TabsContent value="alerts" className="h-full overflow-y-auto pr-1">
            {loading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <ChartCard title="Alert Overview">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {[
                      { label: 'Total', value: stats.alerts?.total ?? 0, color: 'text-zinc-100', bg: 'bg-white/[0.02]' },
                      { label: 'Unread', value: stats.alerts?.unread ?? 0, color: 'text-red-400', bg: 'bg-red-500/10' },
                      { label: 'Read', value: stats.alerts?.read ?? 0, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                      { label: 'Today', value: stats.alerts?.today ?? 0, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                    ].map((s) => (
                      <div key={s.label} className={`${s.bg} rounded-lg p-4 border border-white/5`}>
                        <span className="text-[10px] font-mono tracking-widest text-zinc-500">{s.label}</span>
                        <div className={`text-xl font-mono font-bold mt-1 ${s.color}`}>{formatNumber(s.value)}</div>
                      </div>
                    ))}
                  </div>
                </ChartCard>

                <ChartCard title="Read vs Unread">
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-8 py-4">
                    <div className="h-48 w-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Unread', value: stats.alerts?.unread ?? 0 },
                              { name: 'Read', value: stats.alerts?.read ?? 0 },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={75}
                            dataKey="value"
                            nameKey="name"
                            paddingAngle={2}
                            stroke="none"
                          >
                            <Cell fill="#ef4444" />
                            <Cell fill="#10b981" />
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <span className="text-zinc-400 font-mono text-xs">Unread</span>
                        <span className="text-zinc-100 font-mono font-bold text-base ml-2">{formatNumber(stats.alerts?.unread ?? 0)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-emerald-500" />
                        <span className="text-zinc-400 font-mono text-xs">Read</span>
                        <span className="text-zinc-100 font-mono font-bold text-base ml-2">{formatNumber(stats.alerts?.read ?? 0)}</span>
                      </div>
                    </div>
                  </div>
                  {(stats.alerts?.unread ?? 0) === 0 && (stats.alerts?.read ?? 0) === 0 && (
                    <Empty className="min-h-0 py-4">
                      <EmptyIcon><Bell /></EmptyIcon>
                      <EmptyTitle>No alert data</EmptyTitle>
                      <EmptyDescription>Alert stats will appear once alerts are generated.</EmptyDescription>
                    </Empty>
                  )}
                </ChartCard>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <FRSReportModal
          open={reportModalOpen}
          onOpenChange={setReportModalOpen}
          persons={stats.frsPersons || []}
          detections={stats.frsDetections || []}
          timeRange={timeRange === 'today' ? 'Today' : timeRange === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
        />
      </div>
    </div>
  );
}
