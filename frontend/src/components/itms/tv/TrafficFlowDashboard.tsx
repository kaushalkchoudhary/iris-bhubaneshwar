import { useState, useEffect } from 'react';
import { apiClient, type VCCRealtime, type VCCStats, type VCCDeviceStats } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PieChartWidget, StatsCard, formatNumber } from '../widgets';
import { BarChart3, Loader2, TrendingUp } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';

export function TrafficFlowDashboard() {
  const [realtime, setRealtime] = useState<VCCRealtime | null>(null);
  const [vccStats, setVccStats] = useState<VCCStats | null>(null);
  const [_deviceStats, setDeviceStats] = useState<Record<string, VCCDeviceStats>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 24);

      const [realtimeData, statsData] = await Promise.all([
        apiClient.getVCCRealtime(),
        apiClient.getVCCStats({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          groupBy: 'hour',
        }),
      ]);

      setRealtime(realtimeData);
      setVccStats(statsData);

      // Fetch device-specific stats for top devices
      if (realtimeData.byDevice && realtimeData.byDevice.length > 0) {
        const topDevices = realtimeData.byDevice
          .sort((a: { count: number }, b: { count: number }) => (b.count || 0) - (a.count || 0))
          .slice(0, 10);

        const deviceStatsPromises = topDevices.map(async (device: { deviceId: string; count: number }) => {
          try {
            const stats = await apiClient.getVCCByDevice(device.deviceId, {
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
            });
            return { deviceId: device.deviceId, stats };
          } catch (err) {
            return { deviceId: device.deviceId, stats: null };
          }
        });

        const results = await Promise.all(deviceStatsPromises);
        const statsMap: Record<string, VCCDeviceStats> = {};
        results.forEach(({ deviceId, stats }: { deviceId: string; stats: VCCDeviceStats | null }) => {
          if (stats) statsMap[deviceId] = stats;
        });
        setDeviceStats(statsMap);
      }
    } catch (err) {
      console.error('Failed to fetch traffic flow data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 10 seconds for TV display
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Prepare vehicle type distribution
  const vehicleTypeData = vccStats?.byVehicleType
    ? Object.entries(vccStats.byVehicleType)
        .map(([type, count]) => ({
          name: type === '2W' ? '2 Wheeler' : type === '4W' ? '4 Wheeler' : type,
          value: Number(count),
        }))
        .sort((a, b) => b.value - a.value)
    : [];

  // Prepare device count data (top 10)
  const deviceCountData = realtime?.byDevice
    ? realtime.byDevice
        .sort((a: { count: number }, b: { count: number }) => (b.count || 0) - (a.count || 0))
        .slice(0, 10)
        .map((device: { deviceId: string; count: number }) => ({
          name: device.deviceId.length > 12 ? device.deviceId.substring(0, 12) + '...' : device.deviceId,
          count: device.count || 0,
        }))
    : [];

  // Prepare peak hours data (24-hour grid)
  const peakHoursData: Array<{ hour: string; count: number; intensity: string }> = [];
  if (vccStats?.byHour) {
    for (let hour = 0; hour < 24; hour++) {
      const count = Number(vccStats.byHour[hour.toString()]) || 0;
      peakHoursData.push({
        hour: `${hour}:00`,
        count,
        intensity: count > 100 ? 'HIGH' : count > 50 ? 'MEDIUM' : 'LOW',
      });
    }
  }

  // Calculate total vehicle count
  const totalVehicles = realtime?.totalDetections || 0;
  const activeDevices = realtime?.byDevice?.length || 0;
  const avgPerDevice = activeDevices > 0 ? Math.round(totalVehicles / activeDevices) : 0;

  if (loading && !realtime) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950 relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
          <p className="text-zinc-300">Loading traffic data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto relative">
      <div className="flex-1 p-3 sm:p-4 lg:p-6 space-y-4 relative z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-zinc-100">Traffic Flow Dashboard</h1>
          <div className="text-sm text-zinc-500">
            {new Date().toLocaleString()}
          </div>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
          <StatsCard
            title="Total Vehicles"
            value={totalVehicles}
            subtitle="Last 24 hours"
            icon={TrendingUp}
            color="cyan"
            size="large"
          />
          <StatsCard
            title="Active Devices"
            value={activeDevices}
            subtitle={`Avg ${avgPerDevice} per device`}
            color="green"
            size="large"
          />
          <StatsCard
            title="Peak Hour"
            value={peakHoursData.length > 0
              ? peakHoursData.reduce((max, item) => item.count > max.count ? item : max, peakHoursData[0]).hour
              : 'N/A'
            }
            subtitle="Highest traffic"
            color="yellow"
            size="large"
          />
          <StatsCard
            title="Vehicles/min"
            value={Math.round(totalVehicles / 1440)}
            subtitle="Average rate"
            color="magenta"
            size="large"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column - Vehicle Type Distribution */}
          <div>
            <PieChartWidget
              data={vehicleTypeData}
              height={300}
              title="Vehicle Type Distribution"
              titleColor="#34d399"
            />
          </div>

          {/* Middle Column - Device Counts */}
          <div>
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-indigo-400 mb-4">Live Vehicle Count by Device</h2>
              {deviceCountData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={deviceCountData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.5} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#a1a1aa', fontFamily: 'monospace' }} stroke="#3f3f46" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 10, fill: '#a1a1aa', fontFamily: 'monospace' }}
                      stroke="#3f3f46"
                      width={100}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#18181b',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        color: '#e4e4e7',
                        fontFamily: 'monospace',
                      }}
                    />
                    <Bar dataKey="count" fill="#818cf8" radius={[0, 4, 4, 0]}>
                      {deviceCountData.map((_entry: { name: string; count: number }, index: number) => (
                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#818cf8' : '#6366f1'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty className="min-h-0 h-[300px]">
                  <EmptyIcon><BarChart3 /></EmptyIcon>
                  <EmptyTitle>No data</EmptyTitle>
                </Empty>
              )}
            </Card>
          </div>

          {/* Right Column - Peak Hours Heatmap */}
          <div>
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-rose-400 mb-4">Peak Hours (24h)</h2>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 h-[300px] overflow-y-auto">
                {peakHoursData.map((item, index) => {
                  const maxCount = Math.max(...peakHoursData.map((i) => i.count), 1);
                  const intensity = item.count / maxCount;
                  const bgColor = intensity > 0.7 ? 'rgba(244,63,94,0.6)' : intensity > 0.4 ? 'rgba(244,63,94,0.3)' : 'rgba(244,63,94,0.1)';

                  return (
                    <div
                      key={index}
                      className="flex flex-col items-center justify-end p-2 rounded border border-white/5"
                      style={{
                        backgroundColor: bgColor,
                        opacity: Math.max(0.3, intensity),
                      }}
                    >
                      <div className="text-[10px] text-rose-400 font-mono font-bold mb-1">
                        {item.count}
                      </div>
                      <div className="text-[8px] text-zinc-500 font-mono">
                        {item.hour}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>

        {/* Bottom Row - Top 10 Busiest Locations */}
        <div className="mt-4">
          <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
            <h2 className="text-lg font-bold text-amber-400 mb-4">Top 10 Busiest Locations</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
              {deviceCountData.slice(0, 10).map((device: { name: string; count: number }, index: number) => (
                <div key={index} className="text-center">
                  <div className="text-2xl font-bold text-amber-400 font-mono mb-1">
                    {formatNumber(device.count)}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {device.name}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
