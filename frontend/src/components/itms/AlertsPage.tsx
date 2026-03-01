import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient, type FRSMatch } from '@/lib/api';
import { Bell, Loader2, MapPin, Clock, Camera, ScanFace, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';

type MatchFilter = 'all' | 'known' | 'unknown';

export function AlertsPage() {
  const [detections, setDetections] = useState<FRSMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDetections = useCallback(async () => {
    try {
      const res = await apiClient.getFRSDetections({ limit: 200 });
      setDetections(res);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch FRS detections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDetections();
    const interval = setInterval(fetchDetections, 15000);
    return () => clearInterval(interval);
  }, [fetchDetections]);

  const filtered = useMemo(() => {
    return detections
      .filter((d) => {
        if (matchFilter === 'known' && !d.personId) return false;
        if (matchFilter === 'unknown' && d.personId) return false;
        if (query.trim()) {
          const q = query.toLowerCase();
          const name = d.person?.name || '';
          const device = d.device?.name || d.deviceId || '';
          if (!`${name} ${device} ${d.personId || ''}`.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [detections, matchFilter, query]);

  const selected = useMemo(
    () => filtered.find((d) => d.id === selectedId) || filtered[0] || null,
    [filtered, selectedId]
  );

  useEffect(() => {
    if (!selected && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selected]);

  const counts = useMemo(() => ({
    total: detections.length,
    known: detections.filter((d) => !!d.personId).length,
    unknown: detections.filter((d) => !d.personId).length,
  }), [detections]);

  const formatAgo = (dateString: string) => {
    const ts = new Date(dateString).getTime();
    if (!Number.isFinite(ts)) return 'N/A';
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (loading && detections.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
          <p className="text-foreground/80">Loading FRS detections…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-4 p-4 overflow-hidden min-h-0">

      {/* Left: list panel */}
      <div className="w-full lg:w-[420px] flex flex-col gap-3 min-h-0">
        <Card className="border border-border bg-card/70 rounded-xl p-4 flex-1 flex flex-col min-h-0">

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                <ScanFace className="w-5 h-5 text-fuchsia-400" />
                FRS Alerts
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Face recognition detections</p>
            </div>
            <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={fetchDetections} disabled={loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Total</div>
              <div className="text-sm font-bold text-zinc-100 font-mono">{counts.total}</div>
            </div>
            <div className="bg-emerald-500/10 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Known</div>
              <div className="text-sm font-bold text-emerald-300 font-mono">{counts.known}</div>
            </div>
            <div className="bg-amber-500/10 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Unknown</div>
              <div className="text-sm font-bold text-amber-300 font-mono">{counts.unknown}</div>
            </div>
          </div>

          {/* Search */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, camera…"
            className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50 mb-3"
          />

          {/* Filter buttons */}
          <div className="flex gap-1 mb-3">
            {(['all', 'known', 'unknown'] as MatchFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setMatchFilter(f)}
                className={cn(
                  'flex-1 py-1.5 text-xs font-mono rounded-lg border transition-colors',
                  matchFilter === f
                    ? f === 'known'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : f === 'unknown'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground'
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-muted-foreground mb-2">
            {lastUpdated ? `Updated ${formatAgo(lastUpdated.toISOString())}` : 'Not yet fetched'} · {filtered.length} shown
          </div>

          {/* Detection list */}
          <div className="space-y-2 flex-1 overflow-y-auto min-h-0 p-0.5 -m-0.5">
            {filtered.map((det) => {
              const isKnown = !!det.personId;
              return (
                <Card
                  key={det.id}
                  className={cn(
                    'border border-border bg-muted/40 hover:bg-muted/60 rounded-xl p-3 cursor-pointer transition-all border-l-4',
                    isKnown ? 'border-l-emerald-500' : 'border-l-amber-400',
                    selected?.id === det.id && 'ring-2 ring-indigo-500'
                  )}
                  onClick={() => setSelectedId(det.id)}
                >
                  <div className="flex gap-3">
                    {/* Face thumbnail */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                      {det.faceSnapshotUrl || det.fullSnapshotUrl ? (
                        <img src={det.faceSnapshotUrl || det.fullSnapshotUrl} alt="face" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Camera className="w-5 h-5 text-zinc-600" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-bold text-foreground truncate">
                          {isKnown ? (det.person?.name || 'Known Match') : 'Unknown Face'}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 flex-shrink-0">{formatAgo(det.timestamp)}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <HudBadge variant={isKnown ? 'success' : 'warning'} size="sm">
                          {isKnown ? 'KNOWN' : 'UNKNOWN'}
                        </HudBadge>
                        {isKnown && det.matchScore != null && (
                          <span className="text-[10px] font-mono text-zinc-400">
                            {(Number(det.matchScore) * 100).toFixed(0)}% match
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <MapPin className="w-2.5 h-2.5" />
                        <span className="truncate">{det.device?.name || det.deviceId || 'Unknown camera'}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
            {filtered.length === 0 && (
              <Empty>
                <EmptyIcon><Bell /></EmptyIcon>
                <EmptyTitle>No detections found</EmptyTitle>
                <EmptyDescription>No FRS detections match the current filters.</EmptyDescription>
              </Empty>
            )}
          </div>
        </Card>
      </div>

      {/* Right: detail panel */}
      <div className="flex-1 min-h-0">
        {selected ? (
          <Card className="border border-border bg-card/70 rounded-xl h-full flex flex-col overflow-hidden">

            {/* Detail header */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <HudBadge variant={selected.personId ? 'success' : 'warning'}>
                  {selected.personId ? 'KNOWN MATCH' : 'UNKNOWN FACE'}
                </HudBadge>
                {selected.personId && selected.person?.threatLevel && (
                  <HudBadge variant={selected.person.threatLevel === 'HIGH' ? 'danger' : selected.person.threatLevel === 'MEDIUM' ? 'warning' : 'default'}>
                    {selected.person.threatLevel}
                  </HudBadge>
                )}
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">
                {selected.personId ? (selected.person?.name || 'Known Match') : 'Unknown Face Detected'}
              </h3>
              <div className="flex flex-wrap gap-3 text-xs text-foreground/70">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(selected.timestamp)}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {selected.device?.name || selected.deviceId || 'Unknown'}
                </span>
                {selected.confidence != null && (
                  <span className="font-mono">
                    Conf: {(Number(selected.confidence) * 100).toFixed(1)}%
                  </span>
                )}
                {selected.matchScore != null && selected.personId && (
                  <span className="font-mono">
                    Match: {(Number(selected.matchScore) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* Detail body */}
            <div className="flex-1 p-4 overflow-auto flex flex-col gap-4">

              {/* Face crop */}
              {selected.faceSnapshotUrl && (
                <div>
                  <div className="text-xs font-semibold text-foreground/60 mb-2 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" />
                    Face Snapshot
                  </div>
                  <div className="flex justify-center bg-zinc-950 rounded-xl overflow-hidden p-2">
                    <img
                      src={selected.faceSnapshotUrl}
                      alt="Face crop"
                      className="max-h-48 object-contain rounded-lg"
                    />
                  </div>
                </div>
              )}

              {/* Full frame */}
              {selected.fullSnapshotUrl && (
                <div>
                  <div className="text-xs font-semibold text-foreground/60 mb-2 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5" />
                    Full Frame
                  </div>
                  <div className="bg-zinc-950 rounded-xl overflow-hidden">
                    <img
                      src={selected.fullSnapshotUrl}
                      alt="Full frame"
                      className="w-full object-contain"
                    />
                  </div>
                </div>
              )}

              {/* No images fallback */}
              {!selected.faceSnapshotUrl && !selected.fullSnapshotUrl && (
                <div className="flex items-center justify-center bg-zinc-950 rounded-xl min-h-[200px]">
                  <div className="text-center">
                    <Camera className="w-12 h-12 text-zinc-700 mx-auto mb-2" />
                    <p className="text-xs text-zinc-600">No image available</p>
                  </div>
                </div>
              )}

              {/* Metadata */}
              {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-foreground/60 mb-2">Detection Metadata</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(selected.metadata)
                      .filter(([k]) => !k.includes('embedding') && !k.includes('raw'))
                      .map(([key, val]) => (
                        <div key={key} className="bg-zinc-900/60 rounded-lg p-2 border border-white/5">
                          <div className="text-[10px] text-zinc-500 font-mono">{key}</div>
                          <div className="text-xs text-zinc-200 font-mono truncate">{String(val)}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Person details for known matches */}
              {selected.person && (
                <div>
                  <div className="text-xs font-semibold text-foreground/60 mb-2 flex items-center gap-1.5">
                    <UserX className="w-3.5 h-3.5" />
                    Watchlist Profile
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Name', selected.person.name],
                      ['Category', selected.person.category],
                      ['Threat Level', selected.person.threatLevel],
                      ['Person ID', selected.personId],
                    ].filter(([, v]) => v).map(([label, value]) => (
                      <div key={label} className="bg-zinc-900/60 rounded-lg p-2 border border-white/5">
                        <div className="text-[10px] text-zinc-500 font-mono">{label}</div>
                        <div className="text-xs text-zinc-200 font-mono truncate">{String(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card className="border border-border bg-card/60 rounded-xl h-full">
            <Empty>
              <EmptyIcon><ScanFace /></EmptyIcon>
              <EmptyTitle>No detection selected</EmptyTitle>
              <EmptyDescription>Select a detection from the list to view details.</EmptyDescription>
            </Empty>
          </Card>
        )}
      </div>
    </div>
  );
}
