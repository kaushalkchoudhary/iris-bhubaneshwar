import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient, type WatchlistAlert, type CrowdAlert, type FRSMatch, type AlertStats } from '@/lib/api';
import { Bell, Loader2, MapPin, Clock, Camera, CheckCircle2, XCircle, ScanFace, Users, Car, RefreshCw, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { playSound } from '@/hooks/useSound';

type ServiceFilter = 'all' | 'itms' | 'crowd' | 'frs';
type StatusFilter = 'all' | 'new' | 'read' | 'resolved';

type UnifiedAlert = {
  id: string;
  source: ServiceFilter;
  kind: string;
  title: string;
  message: string;
  timestamp: string;
  deviceId?: string;
  deviceName?: string;
  status: Exclude<StatusFilter, 'all'>;
  severity: 'success' | 'warning' | 'danger' | 'info' | 'default';
  canMarkRead?: boolean;
  canDismiss?: boolean;
  canResolve?: boolean;
  imageUrl?: string;
  raw: WatchlistAlert | CrowdAlert | FRSMatch;
};

function toUnifiedWatchlist(alert: WatchlistAlert): UnifiedAlert {
  return {
    id: `itms:${alert.id}`,
    source: 'itms',
    kind: alert.alertType,
    title: alert.vehicle?.plateNumber || 'ITMS Alert',
    message: alert.message,
    timestamp: alert.timestamp,
    deviceId: alert.deviceId,
    deviceName: alert.device?.name || alert.deviceId,
    status: alert.isRead ? 'read' : 'new',
    severity: alert.alertType === 'VIOLATION' ? 'danger' : 'warning',
    canMarkRead: !alert.isRead,
    canDismiss: true,
    imageUrl: alert.detection?.vehicleImageUrl || alert.detection?.plateImageUrl || alert.metadata?.fullImageUrl || alert.metadata?.plateImageUrl,
    raw: alert,
  };
}

function toUnifiedCrowd(alert: CrowdAlert): UnifiedAlert {
  const sev = String(alert.severity || '').toUpperCase();
  const severity: UnifiedAlert['severity'] =
    sev === 'RED' ? 'danger' :
      sev === 'ORANGE' || sev === 'YELLOW' ? 'warning' :
        sev === 'GREEN' ? 'success' : 'info';

  return {
    id: `crowd:${alert.id}`,
    source: 'crowd',
    kind: alert.alertType || 'CROWD',
    title: alert.title || 'Crowd Alert',
    message: alert.description || `People: ${alert.peopleCount ?? 'N/A'} | Density: ${alert.densityLevel || 'N/A'}`,
    timestamp: alert.timestamp,
    deviceId: alert.deviceId,
    deviceName: alert.device?.name || alert.deviceId,
    status: alert.isResolved ? 'resolved' : 'new',
    severity,
    canResolve: !alert.isResolved,
    imageUrl: alert.frameSnapshot || undefined,
    raw: alert,
  };
}

function toUnifiedFrs(match: FRSMatch): UnifiedAlert {
  const threat = String(match.person?.threatLevel || '').toLowerCase();
  const isKnown = !!match.personId;
  const severity: UnifiedAlert['severity'] =
    !isKnown ? 'warning' :
      threat === 'high' ? 'danger' :
        threat === 'medium' ? 'warning' : 'info';

  return {
    id: `frs:${match.id}`,
    source: 'frs',
    kind: isKnown ? 'KNOWN_MATCH' : 'UNKNOWN_FACE',
    title: isKnown ? (match.person?.name || 'Known Match') : 'Unknown Face Detected',
    message: `Match ${(Number(match.matchScore || 0) * 100).toFixed(1)}% | Confidence ${(Number(match.confidence || 0) * 100).toFixed(1)}%`,
    timestamp: match.timestamp,
    deviceId: match.deviceId,
    deviceName: match.device?.name || match.deviceId,
    status: 'new',
    severity,
    imageUrl: match.fullSnapshotUrl || match.faceSnapshotUrl,
    raw: match,
  };
}

export function AlertsPage() {
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [watchlistAlerts, setWatchlistAlerts] = useState<WatchlistAlert[]>([]);
  const [crowdAlerts, setCrowdAlerts] = useState<CrowdAlert[]>([]);
  const [frsDetections, setFrsDetections] = useState<FRSMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAllAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const [itmsRes, statsRes, crowdRes, frsRes] = await Promise.allSettled([
        apiClient.getAlerts({ limit: 200 }),
        apiClient.getAlertStats(),
        apiClient.getCrowdAlerts({ limit: 200 }),
        apiClient.getFRSDetections({ limit: 200 }),
      ]);

      setWatchlistAlerts(itmsRes.status === 'fulfilled' ? itmsRes.value.alerts : []);
      setStats(statsRes.status === 'fulfilled' ? statsRes.value : null);
      setCrowdAlerts(crowdRes.status === 'fulfilled' ? crowdRes.value : []);
      setFrsDetections(frsRes.status === 'fulfilled' ? frsRes.value : []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch centralized alerts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllAlerts();
    const interval = setInterval(fetchAllAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchAllAlerts]);

  const allAlerts = useMemo<UnifiedAlert[]>(() => {
    const merged = [
      ...watchlistAlerts.map(toUnifiedWatchlist),
      ...crowdAlerts.map(toUnifiedCrowd),
      ...frsDetections.map(toUnifiedFrs),
    ];
    return merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [watchlistAlerts, crowdAlerts, frsDetections]);

  const filteredAlerts = useMemo(() => {
    return allAlerts.filter((a) => {
      if (serviceFilter !== 'all' && a.source !== serviceFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const haystack = `${a.title} ${a.message} ${a.kind} ${a.deviceName || ''} ${a.source}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allAlerts, serviceFilter, statusFilter, query]);

  const selectedAlert = useMemo(
    () => filteredAlerts.find((a) => a.id === selectedAlertId) || filteredAlerts[0] || null,
    [filteredAlerts, selectedAlertId]
  );

  useEffect(() => {
    if (!selectedAlert && filteredAlerts.length > 0) setSelectedAlertId(filteredAlerts[0].id);
  }, [filteredAlerts, selectedAlert]);

  const counts = useMemo(() => {
    return {
      total: allAlerts.length,
      itms: allAlerts.filter((a) => a.source === 'itms').length,
      crowd: allAlerts.filter((a) => a.source === 'crowd').length,
      frs: allAlerts.filter((a) => a.source === 'frs').length,
      newCount: allAlerts.filter((a) => a.status === 'new').length,
      read: allAlerts.filter((a) => a.status === 'read').length,
      resolved: allAlerts.filter((a) => a.status === 'resolved').length,
    };
  }, [allAlerts]);

  const handleMarkRead = async (alert: UnifiedAlert) => {
    if (!alert.canMarkRead || alert.source !== 'itms') return;
    const raw = alert.raw as WatchlistAlert;
    try {
      await apiClient.markAlertRead(raw.id);
      playSound('notification');
      await fetchAllAlerts();
    } catch (err) {
      console.error('Failed to mark alert as read:', err);
    }
  };

  const handleDismiss = async (alert: UnifiedAlert) => {
    if (!alert.canDismiss || alert.source !== 'itms') return;
    const raw = alert.raw as WatchlistAlert;
    try {
      await apiClient.dismissAlert(raw.id);
      playSound('success');
      setSelectedAlertId(null);
      await fetchAllAlerts();
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  };

  const handleResolve = async (alert: UnifiedAlert) => {
    if (!alert.canResolve || alert.source !== 'crowd') return;
    const raw = alert.raw as CrowdAlert;
    try {
      await apiClient.resolveCrowdAlert(String(raw.id), { resolvedBy: 'operator' });
      playSound('success');
      await fetchAllAlerts();
    } catch (err) {
      console.error('Failed to resolve crowd alert:', err);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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

  const sourceBadgeVariant = (source: ServiceFilter): 'info' | 'warning' | 'default' => (
    source === 'itms' ? 'info' : source === 'crowd' ? 'warning' : 'default'
  );

  const sourceIcon = (source: ServiceFilter) => {
    if (source === 'itms') return <Car className="w-3.5 h-3.5" />;
    if (source === 'crowd') return <Users className="w-3.5 h-3.5" />;
    return <ScanFace className="w-3.5 h-3.5" />;
  };

  const severityAccent = (severity: UnifiedAlert['severity']) => {
    if (severity === 'danger') return 'border-l-rose-500';
    if (severity === 'warning') return 'border-l-amber-400';
    if (severity === 'success') return 'border-l-emerald-400';
    if (severity === 'info') return 'border-l-cyan-400';
    return 'border-l-zinc-500';
  };

  if (loading && allAlerts.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
          <p className="text-foreground/80">Loading centralized alerts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-4 p-4 relative overflow-hidden min-h-0">
      <div className="w-full lg:w-[460px] flex flex-col gap-4 relative z-10 min-h-0">
        <Card className="border border-border bg-card/70 rounded-xl p-4 flex-1 flex flex-col min-h-0">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <h2 className="text-xl font-bold text-foreground">Centralized Alerts</h2>
              <p className="text-xs text-muted-foreground mt-1">Unified stream across ITMS, Crowd, and FRS</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20">{filteredAlerts.length}</Badge>
              <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={fetchAllAlerts} disabled={loading}>
                <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Total</div>
              <div className="text-sm font-bold text-zinc-100 font-mono">{counts.total}</div>
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">ITMS</div>
              <div className="text-sm font-bold text-cyan-300 font-mono">{counts.itms}</div>
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Crowd</div>
              <div className="text-sm font-bold text-amber-300 font-mono">{counts.crowd}</div>
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">FRS</div>
              <div className="text-sm font-bold text-fuchsia-300 font-mono">{counts.frs}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">New</div>
              <div className="text-sm font-bold text-rose-300 font-mono">{counts.newCount}</div>
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Read</div>
              <div className="text-sm font-bold text-emerald-300 font-mono">{counts.read}</div>
            </div>
            <div className="bg-muted/40 p-2 rounded-lg">
              <div className="text-[10px] text-muted-foreground">Resolved</div>
              <div className="text-sm font-bold text-indigo-300 font-mono">{counts.resolved}</div>
            </div>
          </div>

          <div className="mb-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, message, camera..."
              className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <div className="text-[11px] text-muted-foreground mb-2">
            Last refresh: {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Not yet'}
          </div>
          <div className="text-[11px] text-muted-foreground mb-2">
            ITMS unread: {stats?.unread ?? 0}
          </div>

          <Tabs value={serviceFilter} onValueChange={(v) => setServiceFilter(v as ServiceFilter)}>
            <TabsList className="grid w-full grid-cols-4 mb-2 bg-muted/40 border-0 rounded-lg">
              <TabsTrigger value="all" className={cn('text-xs', serviceFilter === 'all' ? 'bg-indigo-500/10 text-indigo-400' : 'text-muted-foreground')}>All</TabsTrigger>
              <TabsTrigger value="itms" className={cn('text-xs', serviceFilter === 'itms' ? 'bg-cyan-500/10 text-cyan-400' : 'text-muted-foreground')}>ITMS</TabsTrigger>
              <TabsTrigger value="crowd" className={cn('text-xs', serviceFilter === 'crowd' ? 'bg-amber-500/10 text-amber-400' : 'text-muted-foreground')}>Crowd</TabsTrigger>
              <TabsTrigger value="frs" className={cn('text-xs', serviceFilter === 'frs' ? 'bg-fuchsia-500/10 text-fuchsia-400' : 'text-muted-foreground')}>FRS</TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <TabsList className="grid w-full grid-cols-4 mb-4 bg-muted/40 border-0 rounded-lg">
              <TabsTrigger value="all" className={cn('text-xs', statusFilter === 'all' ? 'bg-zinc-500/10 text-zinc-200' : 'text-muted-foreground')}>All</TabsTrigger>
              <TabsTrigger value="new" className={cn('text-xs', statusFilter === 'new' ? 'bg-rose-500/10 text-rose-400' : 'text-muted-foreground')}>New</TabsTrigger>
              <TabsTrigger value="read" className={cn('text-xs', statusFilter === 'read' ? 'bg-emerald-500/10 text-emerald-400' : 'text-muted-foreground')}>Read</TabsTrigger>
              <TabsTrigger value="resolved" className={cn('text-xs', statusFilter === 'resolved' ? 'bg-indigo-500/10 text-indigo-400' : 'text-muted-foreground')}>Resolved</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2 flex-1 overflow-y-auto min-h-0 p-0.5 -m-0.5">
            {filteredAlerts.map((alert) => (
              <Card
                key={alert.id}
                className={cn(
                  'border border-border bg-muted/40 hover:bg-muted/60 rounded-xl p-3 cursor-pointer transition-all border-l-4',
                  severityAccent(alert.severity),
                  alert.status === 'new' && 'border-indigo-500/20',
                  selectedAlert?.id === alert.id && 'ring-2 ring-indigo-500'
                )}
                onClick={() => setSelectedAlertId(alert.id)}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-start gap-2 flex-wrap">
                    <HudBadge variant={alert.severity} size="sm">{alert.kind}</HudBadge>
                    <HudBadge variant={sourceBadgeVariant(alert.source)} size="sm">
                      <span className="inline-flex items-center gap-1">
                        {sourceIcon(alert.source)}
                        {alert.source.toUpperCase()}
                      </span>
                    </HudBadge>
                    {alert.status === 'new' && <HudBadge variant="warning" size="sm">NEW</HudBadge>}
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">{formatAgo(alert.timestamp)}</span>
                </div>
                <div className="text-sm font-bold text-foreground mb-1 flex items-center gap-1.5">
                  {alert.severity === 'danger' && <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                  {alert.title}
                </div>
                <div className="text-xs text-foreground/80 mb-2 line-clamp-2">{alert.message}</div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{formatDateTime(alert.timestamp)}</span>
                  {alert.deviceName && (
                    <>
                      <MapPin className="w-3 h-3 ml-2" />
                      <span className="truncate">{alert.deviceName}</span>
                    </>
                  )}
                </div>
              </Card>
            ))}
            {filteredAlerts.length === 0 && (
              <Empty>
                <EmptyIcon><Bell /></EmptyIcon>
                <EmptyTitle>No alerts found</EmptyTitle>
                <EmptyDescription>No alerts match the selected filters.</EmptyDescription>
              </Empty>
            )}
          </div>
        </Card>
      </div>

      <div className="flex-1 relative z-10 min-h-0">
        {selectedAlert ? (
          <Card className="border border-border bg-card/70 rounded-xl h-full flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <HudBadge variant={selectedAlert.severity}>{selectedAlert.kind}</HudBadge>
                    <HudBadge variant={sourceBadgeVariant(selectedAlert.source)}>
                      <span className="inline-flex items-center gap-1">
                        {sourceIcon(selectedAlert.source)}
                        {selectedAlert.source.toUpperCase()}
                      </span>
                    </HudBadge>
                    <HudBadge variant={selectedAlert.status === 'new' ? 'warning' : selectedAlert.status === 'resolved' ? 'success' : 'secondary'}>
                      {selectedAlert.status.toUpperCase()}
                    </HudBadge>
                  </div>
                  <h3 className="text-lg font-bold text-foreground">{selectedAlert.title}</h3>
                  <p className="text-sm text-foreground/80 mt-1">{selectedAlert.message}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {selectedAlert.canMarkRead && (
                    <Button size="sm" variant="outline" onClick={() => handleMarkRead(selectedAlert)} className="border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Mark Read
                    </Button>
                  )}
                  {selectedAlert.canResolve && (
                    <Button size="sm" variant="outline" onClick={() => handleResolve(selectedAlert)} className="border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/10">
                      <Users className="w-3 h-3 mr-1" />
                      Resolve
                    </Button>
                  )}
                  {selectedAlert.canDismiss && (
                    <Button size="sm" variant="outline" onClick={() => handleDismiss(selectedAlert)} className="border-rose-500/20 text-rose-400 hover:bg-rose-500/10">
                      <XCircle className="w-3 h-3 mr-1" />
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="flex items-center gap-2 text-foreground/80">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(selectedAlert.timestamp)}
                </div>
                <div className="flex items-center gap-2 text-foreground/80">
                  <MapPin className="w-3 h-3" />
                  {selectedAlert.deviceName || selectedAlert.deviceId || 'Unknown device'}
                </div>
                <div className="flex items-center gap-2 text-foreground/80">
                  {sourceIcon(selectedAlert.source)}
                  {selectedAlert.source.toUpperCase()}
                </div>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-auto">
              <div className="text-xs font-bold text-foreground/80 mb-2">Evidence</div>
              <Card className="border border-border bg-muted/40 rounded-xl p-0 overflow-hidden min-h-[320px] mb-4">
                <div className="relative w-full h-full bg-black">
                  {selectedAlert.imageUrl ? (
                    <img src={selectedAlert.imageUrl} alt="Alert evidence" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-16 h-16 text-muted-foreground/20" />
                    </div>
                  )}
                </div>
              </Card>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs font-semibold text-zinc-300 mb-2">Raw Alert Snapshot</div>
                <pre className="text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-words max-h-64 overflow-auto">
                  {JSON.stringify(selectedAlert.raw, null, 2)}
                </pre>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="border border-border bg-card/60 rounded-xl h-full">
            <Empty>
              <EmptyIcon><Bell /></EmptyIcon>
              <EmptyTitle>No alert selected</EmptyTitle>
              <EmptyDescription>Select an alert to inspect details and actions.</EmptyDescription>
            </Empty>
          </Card>
        )}
      </div>
    </div>
  );
}
