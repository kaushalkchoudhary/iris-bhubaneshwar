import { useState, useEffect } from 'react';
import { apiClient, type WatchlistAlert, type AlertStats, type Watchlist } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HudBadge } from '@/components/ui/hud-badge';
import { ResponsiveContainer } from 'recharts';
import { StatsCard, TrendChart, formatTimeAgo } from '../widgets';
import { Eye, Bell, AlertCircle, BarChart3, Car, Loader2 } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { playSound } from '@/hooks/useSound';
import { cn } from '@/lib/utils';

export function WatchlistMonitoringWall() {
  const [watchlist, setWatchlist] = useState<Watchlist[]>([]);
  const [alerts, setAlerts] = useState<WatchlistAlert[]>([]);
  const [alertStats, setAlertStats] = useState<AlertStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      const [watchlistData, alertsData, statsData] = await Promise.all([
        apiClient.getWatchlist(),
        apiClient.getAlerts({
          startTime: oneHourAgo.toISOString(),
          limit: 50,
        }),
        apiClient.getAlertStats(),
      ]);

      const previousAlertCount = alerts.length;
      setWatchlist(watchlistData);
      setAlerts(alertsData.alerts);
      setAlertStats(statsData);
      if (alertsData.alerts.length > previousAlertCount && previousAlertCount > 0) {
        playSound('watchlist-alert');
      }
    } catch (err) {
      console.error('Failed to fetch watchlist monitoring data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 3 seconds for TV display
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Prepare alert frequency timeline (last 24 hours by hour)
  const alertTimeline = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now);
    hour.setHours(hour.getHours() - i);
    const hourStart = new Date(hour);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hour);
    hourEnd.setMinutes(59, 59, 999);

    const hourAlerts = alerts.filter((alert) => {
      const alertTime = new Date(alert.timestamp);
      return alertTime >= hourStart && alertTime <= hourEnd;
    });

    alertTimeline.push({
      hour: hourStart.getHours(),
      count: hourAlerts.length,
      label: `${hourStart.getHours()}:00`,
    });
  }

  // Top watchlisted vehicles by alert count
  const vehicleAlertCounts: Record<string, number> = {};
  alerts.forEach((alert) => {
    if (alert.vehicle?.plateNumber) {
      vehicleAlertCounts[alert.vehicle.plateNumber] = (vehicleAlertCounts[alert.vehicle.plateNumber] || 0) + 1;
    }
  });
  const topVehicles = Object.entries(vehicleAlertCounts)
    .map(([plate, count]) => ({ plate, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Alert type breakdown
  const detectionAlerts = alerts.filter((a) => a.alertType === 'DETECTION').length;
  const violationAlerts = alerts.filter((a) => a.alertType === 'VIOLATION').length;

  // Alert status distribution
  const readAlerts = alerts.filter((a) => a.isRead).length;
  const unreadAlerts = alerts.filter((a) => !a.isRead).length;

  if (loading && !alertStats) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950 relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-rose-400 mx-auto mb-2" />
          <p className="text-zinc-300">Loading watchlist data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto relative">
      <div className="flex-1 p-3 sm:p-4 lg:p-6 space-y-4 relative z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-zinc-100">Watchlist Monitoring</h1>
          <div className="text-sm text-zinc-500">
            {new Date().toLocaleString()}
          </div>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
          <StatsCard
            title="Active Watchlist"
            value={watchlist.length}
            subtitle={`${alerts.length} alerts (1h)`}
            icon={Eye}
            color="magenta"
            size="large"
          />
          <StatsCard
            title="Unread Alerts"
            value={unreadAlerts}
            subtitle={`${readAlerts} read`}
            icon={Bell}
            color="yellow"
            size="large"
          />
          <StatsCard
            title="Detections"
            value={detectionAlerts}
            subtitle="Last hour"
            icon={AlertCircle}
            color="cyan"
            size="large"
          />
          <StatsCard
            title="Violations"
            value={violationAlerts}
            subtitle="Last hour"
            icon={AlertCircle}
            color="green"
            size="large"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column - Recent Alerts */}
          <div>
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full overflow-y-auto">
              <h2 className="text-lg font-bold text-rose-400 mb-4">Recent Alerts (1h)</h2>
              <div className="space-y-3">
                {alerts.slice(0, 10).map((alert) => (
                  <div
                    key={alert.id}
                    className={cn(
                      "p-3 rounded border",
                      alert.isRead
                        ? "border-white/5 bg-zinc-900/30"
                        : "border-indigo-500/30 bg-zinc-900/50"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <HudBadge
                        variant={alert.alertType === 'DETECTION' ? 'success' : 'danger'}
                        size="sm"
                      >
                        {alert.alertType}
                      </HudBadge>
                      {!alert.isRead && (
                        <HudBadge variant="warning" size="sm">
                          NEW
                        </HudBadge>
                      )}
                    </div>
                    {alert.vehicle?.plateNumber && (
                      <div className="text-sm font-bold text-indigo-400 font-mono mb-1">
                        {alert.vehicle.plateNumber}
                      </div>
                    )}
                    <div className="text-xs text-zinc-300 mb-1 line-clamp-2">
                      {alert.message}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {formatTimeAgo(alert.timestamp)}
                    </div>
                  </div>
                ))}
                {alerts.length === 0 && (
                  <Empty className="min-h-0 py-8">
                    <EmptyIcon><Bell /></EmptyIcon>
                    <EmptyTitle>No alerts</EmptyTitle>
                  </Empty>
                )}
              </div>
            </Card>
          </div>

          {/* Middle Column - Alert Frequency Timeline */}
          <div>
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-indigo-400 mb-4">Alert Frequency (24h)</h2>
              {alertTimeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <TrendChart
                    data={alertTimeline}
                    dataKeys={[
                      { key: 'count', color: '#a78bfa', gradientId: 'colorAlerts' },
                    ]}
                    height={300}
                    xAxisKey="label"
                  />
                </ResponsiveContainer>
              ) : (
                <Empty className="min-h-0 h-[300px]">
                  <EmptyIcon><BarChart3 /></EmptyIcon>
                  <EmptyTitle>No data</EmptyTitle>
                </Empty>
              )}
            </Card>
          </div>

          {/* Right Column - Top Watchlisted Vehicles & Stats */}
          <div className="space-y-4">
            {/* Top Watchlisted Vehicles */}
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
              <h2 className="text-lg font-bold text-amber-400 mb-4">Top Watchlisted Vehicles</h2>
              <div className="space-y-2">
                {topVehicles.map((vehicle, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-zinc-900/50 rounded border border-white/5">
                    <div className="text-sm font-bold text-amber-400 font-mono">
                      {vehicle.plate}
                    </div>
                    <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs">
                      {vehicle.count} ALERTS
                    </Badge>
                  </div>
                ))}
                {topVehicles.length === 0 && (
                  <Empty className="min-h-0 py-4">
                    <EmptyIcon><Car /></EmptyIcon>
                    <EmptyTitle>No data</EmptyTitle>
                  </Empty>
                )}
              </div>
            </Card>

            {/* Alert Status Distribution */}
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
              <h2 className="text-lg font-bold text-emerald-400 mb-4">Alert Status</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Unread</span>
                  <span className="text-xl font-bold text-amber-400 font-mono">{unreadAlerts}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Read</span>
                  <span className="text-xl font-bold text-emerald-400 font-mono">{readAlerts}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Total</span>
                  <span className="text-xl font-bold text-zinc-100 font-mono">{alerts.length}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
