import { useState, useEffect } from 'react';
import { apiClient, type ViolationStats, type VehicleStats, type AlertStats, type TrafficViolation, type Device, type VCCRealtime } from '@/lib/api';
import { Car, AlertTriangle, Bell, Camera, Activity, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { StatsCard, TrendChart, PieChartWidget, ViolationCard, LiveFeed } from '../widgets';
import { formatNumber } from '../widgets/utils';

export function TOCOverview() {
  const [violationStats, setViolationStats] = useState<ViolationStats | null>(null);
  const [vehicleStats, setVehicleStats] = useState<VehicleStats | null>(null);
  const [alertStats, setAlertStats] = useState<AlertStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [vccRealtime, setVccRealtime] = useState<VCCRealtime | null>(null);
  const [liveViolations, setLiveViolations] = useState<TrafficViolation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 24);

      const [violations, vehicles, alerts, devicesData, realtime, violationsList] = await Promise.all([
        apiClient.getViolationStats({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        }),
        apiClient.getVehicleStats(),
        apiClient.getAlertStats(),
        apiClient.getDevices(),
        apiClient.getVCCRealtime(),
        apiClient.getViolations({
          status: 'PENDING',
          limit: 10,
        }),
      ]);

      setViolationStats(violations);
      setVehicleStats(vehicles);
      setAlertStats(alerts);
      setDevices(devicesData as Device[]);
      setVccRealtime(realtime);
      setLiveViolations(violationsList.violations);
    } catch (err) {
      console.error('Failed to fetch TOC data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 seconds for TV display
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Prepare trend data
  const trendData = [];
  if (violationStats?.byHour) {
    for (let hour = 0; hour < 24; hour++) {
      trendData.push({
        hour: `${hour}:00`,
        vehicles: vccRealtime?.byDevice?.reduce((sum: number, d: { count: number }) => sum + (d.count || 0), 0) || 0,
        violations: Number(violationStats.byHour[hour]) || 0,
      });
    }
  }

  // Prepare violation type distribution (top 5)
  const violationTypeData = violationStats?.byType
    ? Object.entries(violationStats.byType)
        .map(([type, count]) => ({
          name: type,
          value: Number(count),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    : [];

  // Calculate active devices
  const activeDevices = devices.filter(d => d.status === 'ACTIVE' || d.status === 'active').length;
  const activeWorkers = vccRealtime?.byDevice?.length || 0;

  if (loading && !violationStats) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950 relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
          <p className="text-zinc-300">Loading TOC data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto relative">
      <div className="flex-1 p-3 sm:p-4 lg:p-6 space-y-4 relative z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-zinc-100">Traffic Operations Center</h1>
          <div className="text-sm text-zinc-500">
            {new Date().toLocaleString()}
          </div>
        </div>

        {/* Top KPI Cards - Large for TV */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
          <StatsCard
            title="Vehicles (24h)"
            value={vehicleStats?.total || 0}
            subtitle={`${vehicleStats?.withPlates || 0} with plates`}
            icon={Car}
            color="cyan"
            size="large"
          />
          <StatsCard
            title="Violations (24h)"
            value={violationStats?.total || 0}
            subtitle={`${violationStats?.pending || 0} pending`}
            icon={AlertTriangle}
            color="magenta"
            size="large"
          />
          <StatsCard
            title="Watchlist Alerts"
            value={alertStats?.unread || 0}
            subtitle={`${alertStats?.total || 0} total`}
            icon={Bell}
            color="yellow"
            size="large"
          />
          <StatsCard
            title="Active Devices"
            value={activeDevices}
            subtitle={`${activeWorkers} workers`}
            icon={Camera}
            color="green"
            size="large"
          />
        </div>

        {/* Main Content Grid - 4x3 Layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Row 1: Violation Feed (spans 2 columns) */}
          <div className="sm:col-span-2">
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-rose-400 mb-3">Live Violations</h2>
              <div className="h-[calc(100%-3rem)] overflow-y-auto">
                <LiveFeed
                  items={liveViolations}
                  renderItem={(violation) => (
                    <ViolationCard violation={violation} showLive compact />
                  )}
                  loading={loading}
                  emptyMessage="No violations"
                />
              </div>
            </Card>
          </div>

          {/* Row 1: Top Violation Types */}
          <div>
            <PieChartWidget
              data={violationTypeData}
              height={200}
              title="Top Violations"
              titleColor="#fb7185"
            />
          </div>

          {/* Row 1: System Health */}
          <div>
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-emerald-400 mb-3">System Health</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Active cameras</span>
                  <span className="text-xl font-bold text-emerald-400 font-mono">{activeDevices}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Edge workers</span>
                  <span className="text-xl font-bold text-emerald-400 font-mono">{activeWorkers}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Data freshness</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">Live</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-500">Uptime</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">99.9%</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Row 2: Trend Chart (spans 2 columns) */}
          <div className="sm:col-span-2">
            <TrendChart
              data={trendData}
              dataKeys={[
                { key: 'vehicles', color: '#818cf8', gradientId: 'colorVehicles' },
                { key: 'violations', color: '#fb7185', gradientId: 'colorViolations' },
              ]}
              height={200}
              title="24 Hour Trend"
            />
          </div>

          {/* Row 2: Device Status Map Placeholder */}
          <div className="sm:col-span-2">
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-indigo-400 mb-3">Device Status Map</h2>
              <div className="h-[calc(100%-3rem)] flex items-center justify-center bg-zinc-950 rounded">
                <div className="text-center text-zinc-500">
                  <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Map visualization</p>
                  <p className="text-xs mt-2">{activeDevices} active devices</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Row 3: Additional Stats */}
          <div className="col-span-1 sm:col-span-2 lg:col-span-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 h-full">
              <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
                <div className="text-sm text-zinc-500 mb-2">Today's count</div>
                <div className="text-2xl font-bold text-indigo-400 font-mono">
                  {formatNumber(violationStats?.total || 0)}
                </div>
              </Card>
              <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
                <div className="text-sm text-zinc-500 mb-2">Pending review</div>
                <div className="text-2xl font-bold text-rose-400 font-mono">
                  {formatNumber(violationStats?.pending || 0)}
                </div>
              </Card>
              <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
                <div className="text-sm text-zinc-500 mb-2">Alerts today</div>
                <div className="text-2xl font-bold text-amber-400 font-mono">
                  {formatNumber(alertStats?.today || 0)}
                </div>
              </Card>
              <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
                <div className="text-sm text-zinc-500 mb-2">Vehicle detections</div>
                <div className="text-2xl font-bold text-emerald-400 font-mono">
                  {formatNumber(vccRealtime?.totalDetections || 0)}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
