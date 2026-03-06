import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient, type FRSMatch } from '@/lib/api';
import {
  Bell, MapPin, Clock, Camera, ScanFace, RefreshCw,
  UserCheck, Search, AlertTriangle,
} from 'lucide-react';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

type MatchFilter = 'all' | 'known' | 'unknown';

function fmtAgo(dateString: string) {
  const diff = Math.max(0, Date.now() - new Date(dateString).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDateTime(dateString: string) {
  return new Date(dateString).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function threatVariant(level?: string): 'danger' | 'warning' | 'success' | 'default' {
  const l = (level || '').toLowerCase();
  if (l === 'high') return 'danger';
  if (l === 'medium') return 'warning';
  if (l === 'low') return 'success';
  return 'default';
}

function isKnown(det: FRSMatch): boolean {
  return !!(det.personId || (det.metadata as any)?.person_id || (det.metadata as any)?.is_known);
}

export function AlertsPage() {
  const [detections, setDetections] = useState<FRSMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MatchFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDetections = useCallback(async () => {
    try {
      // Fetch recent detections + known-only separately to ensure known matches appear
      const [recentRes, knownRes] = await Promise.allSettled([
        apiClient.getFRSDetections({ limit: 500 }),
        apiClient.getFRSDetections({ limit: 200, unknown: false }),
      ]);
      const recent = recentRes.status === 'fulfilled' ? recentRes.value : [];
      const known = knownRes.status === 'fulfilled' ? knownRes.value : [];
      // Merge, deduplicating by id (recent list first, known supplements it)
      const seenIds = new Set(recent.map(d => d.id));
      const merged = [...recent, ...known.filter(d => !seenIds.has(d.id))];
      setDetections(merged);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch FRS detections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDetections();
    const t = setInterval(fetchDetections, 15000);
    return () => clearInterval(t);
  }, [fetchDetections]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return detections
      .filter(d => {
        const known = isKnown(d);
        if (filter === 'known' && !known) return false;
        if (filter === 'unknown' && known) return false;
        if (q) {
          const hay = `${d.person?.name ?? ''} ${d.device?.name ?? ''} ${d.deviceId ?? ''} ${(d.metadata as any)?.person_name ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [detections, filter, query]);

  const selected = useMemo(
    () => filtered.find(d => d.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const counts = useMemo(() => ({
    total: detections.length,
    known: detections.filter(d => isKnown(d)).length,
    unknown: detections.filter(d => !isKnown(d)).length,
  }), [detections]);

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-3 p-4 overflow-hidden iris-dashboard-root">

      {/* ── Left panel: list ── */}
      <div className="w-full lg:w-[380px] shrink-0 flex flex-col gap-3 min-h-0">

        {/* Header card */}
        <div className="border border-border bg-card/70 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <ScanFace className="h-4 w-4 text-indigo-400 shrink-0" />
            <span className="text-sm font-bold text-foreground tracking-wide">FRS Alerts</span>
            <HudBadge variant="default" size="sm">{counts.total}</HudBadge>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-[10px] text-muted-foreground hidden sm:block">
                {fmtAgo(lastUpdated.toISOString())}
              </span>
            )}
            <Button variant="outline" size="sm" className="h-7 w-7 p-0"
              onClick={fetchDetections} disabled={loading}>
              <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Stat pills */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total', val: counts.total, color: 'text-foreground', bg: 'bg-muted/40', border: 'border-border' },
            { label: 'Known', val: counts.known, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
            { label: 'Unknown', val: counts.unknown, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} ${s.border} border rounded-lg px-3 py-2 shadow-sm`}>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">{s.label}</div>
              <div className={`text-lg font-mono font-bold ${s.color}`}>{s.val}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search name, camera…"
              className="w-full h-9 bg-background/50 border border-input rounded-md pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex gap-1.5">
            {(['all', 'known', 'unknown'] as MatchFilter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn(
                  'flex-1 h-8 text-[11px] font-medium rounded-md border transition-colors',
                  filter === f
                    ? f === 'known' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : f === 'unknown' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-primary/20 text-primary border-primary/30'
                    : 'bg-background/50 text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground'
                )}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground font-medium">{filtered.length} detection{filtered.length !== 1 ? 's' : ''}</div>
        </div>

        {/* Detection list */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
          ) : filtered.length === 0 ? (
            <Empty>
              <EmptyIcon><Bell /></EmptyIcon>
              <EmptyTitle>No detections</EmptyTitle>
              <EmptyDescription>No FRS detections match the current filters.</EmptyDescription>
            </Empty>
          ) : filtered.map(det => {
            const known = isKnown(det);
            const isSelected = selected?.id === det.id;
            return (
              <button key={det.id} onClick={() => setSelectedId(det.id)} className="w-full text-left">
                <div className={cn(
                  'flex gap-3 p-3 rounded-lg border transition-all',
                  'border-border bg-card/40 hover:bg-accent/40 shadow-sm',
                  isSelected && 'bg-accent/50 border-primary/40 ring-1 ring-primary/20',
                )}>
                  {/* Face thumb */}
                  <div className="w-12 h-12 rounded-md overflow-hidden bg-muted/50 shrink-0 border border-border">
                    {det.faceSnapshotUrl || det.fullSnapshotUrl
                      ? <img src={det.faceSnapshotUrl || det.fullSnapshotUrl} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><Camera className="w-4 h-4 text-muted-foreground" /></div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="text-sm font-semibold text-foreground truncate leading-tight">
                        {known ? (det.person?.name || 'Known Match') : 'Unknown Face'}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{fmtAgo(det.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <HudBadge variant={known ? 'success' : 'warning'} size="sm">
                        {known ? 'KNOWN' : 'UNKWN'}
                      </HudBadge>
                      {known && det.matchScore != null && (
                        <span className="text-xs font-mono text-emerald-500 dark:text-emerald-400">{(det.matchScore * 100).toFixed(0)}%</span>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                        <MapPin className="w-3 h-3" />
                        <span className="truncate max-w-[90px]">{det.device?.name || det.deviceId || '—'}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right panel: detail ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!selected ? (
          <div className="h-full border border-border bg-card/70 rounded-xl flex items-center justify-center shadow-sm">
            <Empty>
              <EmptyIcon><ScanFace /></EmptyIcon>
              <EmptyTitle>No detection selected</EmptyTitle>
              <EmptyDescription>Select a detection from the list to view details.</EmptyDescription>
            </Empty>
          </div>
        ) : (
          <div className="h-full border border-border bg-card/70 backdrop-blur-sm rounded-xl flex flex-col overflow-hidden shadow-sm">

            {/* Detail header */}
            <div className="px-6 py-5 border-b border-border bg-muted/20 shrink-0 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <HudBadge variant={selected.personId ? 'success' : 'warning'}>
                    {selected.personId ? 'IDENTIFIED' : 'UNKNOWN FACE'}
                  </HudBadge>
                  {selected.person?.threatLevel && (
                    <HudBadge variant={threatVariant(selected.person.threatLevel)}>
                      {selected.person.threatLevel.toUpperCase()} THREAT
                    </HudBadge>
                  )}
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3 leading-tight">
                  {selected.personId ? (selected.person?.name || 'Known Match') : 'Unknown Face Detected'}
                </h3>
                <div className="flex flex-wrap gap-4 text-[12px] text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Clock className="w-3.5 h-3.5" />{fmtDateTime(selected.timestamp)}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <MapPin className="w-3.5 h-3.5" />{selected.device?.name || selected.deviceId || 'Unknown'}
                  </span>
                  {selected.confidence != null && (
                    <span className="text-primary font-mono font-bold">Conf: {(selected.confidence * 100).toFixed(1)}%</span>
                  )}
                  {selected.matchScore != null && selected.personId && (
                    <span className="text-emerald-500 dark:text-emerald-400 font-mono font-bold">Match: {(selected.matchScore * 100).toFixed(1)}%</span>
                  )}
                </div>
              </div>

              {/* Face Crop in Header */}
              {selected.faceSnapshotUrl && (
                <div className="shrink-0 ml-6 hidden sm:block">
                  <div className="w-24 h-24 bg-muted/40 rounded-lg overflow-hidden border border-border shadow-sm">
                    <img src={selected.faceSnapshotUrl} alt="Face" className="w-full h-full object-cover" />
                  </div>
                  <div className="text-[10px] text-muted-foreground text-center mt-2 uppercase tracking-widest font-medium">
                    Face Crop
                  </div>
                </div>
              )}
            </div>

            {/* Detail body */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">

              {/* Images stack - Full Frame prioritized */}
              {(selected.faceSnapshotUrl || selected.fullSnapshotUrl) && (
                <div className="flex flex-col gap-4">
                  {/* Full Frame (Moved up, padded container) */}
                  {selected.fullSnapshotUrl && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Camera className="w-4 h-4" />Full Frame Context
                      </div>
                      <div className="bg-muted/30 rounded-xl border border-border p-4 min-h-[200px] flex items-center justify-center">
                        <img
                          src={selected.fullSnapshotUrl}
                          alt="Frame"
                          className="w-full max-h-[500px] object-contain rounded-md"
                        />
                      </div>
                    </div>
                  )}

                  {/* Face Crop (below on mobile/desktop, unless hidden by desktop header) */}
                  {selected.faceSnapshotUrl && (
                    <div className="sm:hidden">
                      <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                        <UserCheck className="w-4 h-4" />Face Crop Extraction
                      </div>
                      <div className="bg-muted/30 rounded-xl overflow-hidden border border-border flex items-center justify-center p-3">
                        <img src={selected.faceSnapshotUrl} alt="Face" className="max-h-48 object-contain rounded shadow-sm" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!selected.faceSnapshotUrl && !selected.fullSnapshotUrl && (
                <div className="bg-muted/30 rounded-xl border border-border min-h-[160px] flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground font-medium">No images available</p>
                  </div>
                </div>
              )}

              {/* Person profile for known matches */}
              {selected.person && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />Watchlist Profile
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['Name', selected.person.name],
                      ['Category', selected.person.category],
                      ['Threat', selected.person.threatLevel],
                      ['Person ID', selected.personId],
                    ].filter(([, v]) => v).map(([label, value]) => (
                      <div key={label} className="bg-muted/40 border border-border rounded-lg p-3">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
                        <div className="text-sm font-semibold text-foreground truncate mt-1">{String(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detection metadata */}
              {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">Detection Data</div>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(selected.metadata)
                      .filter(([k]) => !k.includes('embedding') && !k.includes('raw') && k !== 'images')
                      .slice(0, 8)
                      .map(([key, val]) => (
                        <div key={key} className="bg-muted/40 border border-border rounded-lg p-3">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{key}</div>
                          <div className="text-sm font-semibold text-foreground truncate mt-1">{String(val)}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
