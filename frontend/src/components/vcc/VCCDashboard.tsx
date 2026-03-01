import { useState, useEffect } from 'react';
import { apiClient, type VCCStats, type VCCRealtime } from '@/lib/api';
import { TrendingUp, Car, Clock, BarChart3, Loader2, RefreshCw, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HudBadge } from '@/components/ui/hud-badge';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export function VCCDashboard() {
  const [stats, setStats] = useState<VCCStats | null>(null);
  const [realtime, setRealtime] = useState<VCCRealtime | null>(null);
  const [loading, setLoading] = useState(true);
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [groupBy, setGroupBy] = useState<'hour' | 'day'>('day');

  const fetchStats = async () => {
    try {
      setLoading(true);
      const endTime = new Date();
      const startTime = new Date();

      switch (timeRange) {
        case '24h':
          startTime.setHours(startTime.getHours() - 24);
          break;
        case '7d':
          startTime.setDate(startTime.getDate() - 7);
          break;
        case '30d':
          startTime.setDate(startTime.getDate() - 30);
          break;
      }

      const data = await apiClient.getVCCStats({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        groupBy: groupBy,
      });
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch VCC stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRealtime = async () => {
    try {
      setRealtimeLoading(true);
      const data = await apiClient.getVCCRealtime();
      setRealtime(data);
    } catch (err) {
      console.error('Failed to fetch realtime data:', err);
    } finally {
      setRealtimeLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchRealtime();

    // Refresh realtime every 30 seconds
    const interval = setInterval(() => {
      fetchRealtime();
    }, 30000);

    return () => clearInterval(interval);
  }, [timeRange, groupBy]);

  // Separate effect to refresh realtime independently
  useEffect(() => {
    const interval = setInterval(() => {
      fetchRealtime();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const getVehicleTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      '2W': 'bg-blue-500',
      '4W': 'bg-green-500',
      'AUTO': 'bg-yellow-500',
      'TRUCK': 'bg-red-500',
      'BUS': 'bg-purple-500',
      'UNKNOWN': 'bg-zinc-500',
    };
    return colors[type] || 'bg-zinc-500';
  };

  const getVehicleTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      '2W': '2 Wheeler',
      '4W': '4 Wheeler',
      'AUTO': 'Auto',
      'TRUCK': 'Truck',
      'BUS': 'Bus',
      'UNKNOWN': 'Unknown',
    };
    return labels[type] || type;
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-full w-full relative text-white">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-zinc-400">Loading VCC statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden p-3 md:p-4 relative text-white iris-dashboard-root">
      <div className="h-full space-y-2 flex flex-col overflow-hidden">
      {/* Header - Compact */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2 pb-1 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">Vehicle Classification & Counting</h2>
            <HudBadge variant="default" size="sm">Live</HudBadge>
          </div>
        </div>
        <div className="w-full xl:w-auto">
          <div className="flex flex-wrap xl:flex-nowrap items-center gap-2">
            <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as '24h' | '7d' | '30d')} className="shrink-0">
              <TabsList className="h-8 bg-black/30 border border-white/10">
                <TabsTrigger value="24h" className="text-[11px] px-2.5">24h</TabsTrigger>
                <TabsTrigger value="7d" className="text-[11px] px-2.5">7d</TabsTrigger>
                <TabsTrigger value="30d" className="text-[11px] px-2.5">30d</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as 'hour' | 'day')} className="shrink-0">
              <TabsList className="h-8 bg-black/30 border border-white/10">
                <TabsTrigger value="hour" className="text-[11px] px-2.5">Hour</TabsTrigger>
                <TabsTrigger value="day" className="text-[11px] px-2.5">Day</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={fetchStats} className="h-8 px-2.5 shrink-0">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 space-y-2 iris-scroll-area">
      {/* Real-time Stats - Compact */}
      <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-2.5">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-3.5 h-3.5 text-blue-500" />
          <h2 className="text-xs font-semibold">Real-time (Last 5 Minutes)</h2>
          {realtimeLoading && <Loader2 className="w-3 h-3 animate-spin" />}
        </div>
        {realtime ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <div className="text-[11px] text-zinc-400">Detections</div>
              <div className="text-lg font-semibold text-white">{realtime.totalDetections}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">Per Minute</div>
              <div className="text-lg font-semibold text-white">{realtime.perMinute.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">Active Devices</div>
              <div className="text-lg font-semibold text-white">{realtime.byDevice?.length || 0}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">Vehicle Types</div>
              <div className="text-lg font-semibold text-white">{Object.keys(realtime.byVehicleType || {}).length}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-400">Loading realtime data...</div>
        )}
      </Card>

      {/* Main Stats Cards */}
      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-zinc-400">Total Detections</div>
                <Car className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-xl font-semibold text-white">{stats.totalDetections.toLocaleString()}</div>
              <div className="text-xs text-zinc-400 mt-1">
                {stats.averagePerHour.toFixed(1)} per hour avg
              </div>
            </Card>

            <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-zinc-400">Unique Vehicles</div>
                <TrendingUp className="w-4 h-4 text-green-500" />
              </div>
              <div className="text-xl font-semibold text-white">{stats.uniqueVehicles.toLocaleString()}</div>
              <div className="text-xs text-zinc-400 mt-1">
                {stats.totalDetections > 0
                  ? ((stats.uniqueVehicles / stats.totalDetections) * 100).toFixed(1)
                  : '0'}% unique rate
              </div>
            </Card>

            <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-zinc-400">Peak Hour</div>
                <Clock className="w-4 h-4 text-yellow-500" />
              </div>
              <div className="text-xl font-semibold text-white">{stats.peakHour}:00</div>
              <div className="text-xs text-zinc-400 mt-1">
                Peak day: {stats.peakDay}
              </div>
            </Card>

            <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-zinc-400">Classification Rate</div>
                <BarChart3 className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-xl font-semibold text-white">
                {stats.totalDetections > 0
                  ? ((stats.classification.fullClassification / stats.totalDetections) * 100).toFixed(1)
                  : '0'}%
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                Full classification
              </div>
            </Card>
          </div>

          {/* Vehicle Type Distribution */}
          <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
            <h2 className="text-sm font-semibold mb-2">Vehicle Type Distribution</h2>
            {stats.byVehicleType && Object.keys(stats.byVehicleType).length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {Object.entries(stats.byVehicleType)
                  .sort(([, a], [, b]) => Number(b) - Number(a))
                  .map(([type, count]) => (
                    <div key={type} className="text-center">
                      <Badge className={cn("w-full justify-center mb-1 text-[11px]", getVehicleTypeColor(type))}>
                        {getVehicleTypeLabel(type)}
                      </Badge>
                      <div className="text-lg font-semibold">{Number(count).toLocaleString()}</div>
                      <div className="text-[11px] text-zinc-400">
                        {stats.totalDetections > 0
                          ? ((Number(count) / stats.totalDetections) * 100).toFixed(1)
                          : '0'}%
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <Empty>
                <EmptyIcon><Car /></EmptyIcon>
                <EmptyTitle>No vehicle type data</EmptyTitle>
                <EmptyDescription>No vehicle type data available for the selected time range.</EmptyDescription>
              </Empty>
            )}
          </Card>

          {/* Classification Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
              <h2 className="text-sm font-semibold mb-2">Plate Detection</h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs">With Plates</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 sm:w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500"
                        style={{
                          width: `${stats.totalDetections > 0
                            ? (stats.classification.withPlates / stats.totalDetections) * 100
                            : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-16 text-right">
                      {stats.classification.withPlates.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Without Plates</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 sm:w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500"
                        style={{
                          width: `${stats.totalDetections > 0
                            ? (stats.classification.withoutPlates / stats.totalDetections) * 100
                            : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-16 text-right">
                      {stats.classification.withoutPlates.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
              <h2 className="text-sm font-semibold mb-2">Classification Quality</h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs">Full Classification</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 sm:w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${stats.totalDetections > 0
                            ? (stats.classification.fullClassification / stats.totalDetections) * 100
                            : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-16 text-right">
                      {stats.classification.fullClassification.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Plate Only</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 sm:w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-500"
                        style={{
                          width: `${stats.totalDetections > 0
                            ? (stats.classification.plateOnly / stats.totalDetections) * 100
                            : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-16 text-right">
                      {stats.classification.plateOnly.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Charts and Devices - 2/3 and 1/3 layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 min-h-0">
            {/* Left Column - Charts (2/3) */}
            <div className="lg:col-span-2 space-y-2 min-h-0">
              {/* Time Series Chart */}
              <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
                <h2 className="text-sm font-semibold mb-2">Detections Over Time</h2>
                {stats.byTime && stats.byTime.length > 0 ? (
                  <div className="h-40 flex items-end gap-1 overflow-x-auto">
                    {stats.byTime.map((item, index) => {
                      const maxCount = Math.max(...stats.byTime.map((i) => Number(i.count) || 0), 1);
                      const count = Number(item.count) || 0;
                      // Use a multiplier to make bars taller (scale from 0-100% to 20-100%)
                      const normalizedHeight = (count / maxCount) * 100;
                      const height = Math.max(normalizedHeight * 0.8 + 20, 10); // Scale to 20-100% range, min 10%
                      const label = item.hour || item.day || item.week || item.month || '';
                      return (
                        <div key={index} className="flex-1 min-w-[28px] flex flex-col items-center">
                          <div
                            className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600 cursor-pointer"
                            style={{ height: `${height}%`, minHeight: '20px' }}
                            title={`${label}: ${count.toLocaleString()} vehicles`}
                          />
                          <div className="text-[10px] text-zinc-400 mt-1 truncate w-full text-center">
                            {label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty>
                    <EmptyIcon><BarChart3 /></EmptyIcon>
                    <EmptyTitle>No detection data</EmptyTitle>
                    <EmptyDescription>No data available for the selected time range.</EmptyDescription>
                  </Empty>
                )}
              </Card>

              {/* Hourly Distribution */}
              <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3">
                <h2 className="text-sm font-semibold mb-2">Hourly Distribution</h2>
                {stats.byHour && Object.keys(stats.byHour).length > 0 ? (
                  <div className="h-28 flex items-end gap-1">
                    {Array.from({ length: 24 }, (_, hour) => {
                      const count = Number(stats.byHour[hour.toString()]) || 0;
                      const maxCount = Math.max(...Object.values(stats.byHour).map(v => Number(v) || 0), 1);
                      // Use a multiplier to make bars taller (scale from 0-100% to 20-100%)
                      const normalizedHeight = (count / maxCount) * 100;
                      const height = Math.max(normalizedHeight * 0.8 + 20, 10); // Scale to 20-100% range, min 10%
                      return (
                        <div key={hour} className="flex-1 flex flex-col items-center min-w-[20px]">
                          <div
                            className={cn(
                              "w-full rounded-t transition-all hover:opacity-80 cursor-pointer",
                              hour === stats.peakHour ? "bg-yellow-500" : "bg-blue-500"
                            )}
                            style={{ height: `${height}%`, minHeight: '20px' }}
                            title={`${hour}:00 - ${count.toLocaleString()} vehicles`}
                          />
                          <div className="text-[10px] text-zinc-400 mt-1">
                            {hour % 4 === 0 ? hour : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty>
                    <EmptyIcon><Clock /></EmptyIcon>
                    <EmptyTitle>No hourly data</EmptyTitle>
                    <EmptyDescription>No hourly distribution data available.</EmptyDescription>
                  </Empty>
                )}
              </Card>
            </div>

            {/* Right Column - Top Devices Table (1/3) */}
            <div className="lg:col-span-1 min-h-0">
              <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3 h-full min-h-0">
                <h2 className="text-sm font-semibold mb-2">Top Locations</h2>
                <div className="overflow-x-auto overflow-y-auto max-h-[260px]">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-background/80 backdrop-blur">
                      <tr className="border-b border-white/10">
                        <th className="text-left p-1.5 text-[11px] font-medium">Device</th>
                        <th className="text-right p-1.5 text-[11px] font-medium">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byDevice.slice(0, 10).map((device, index) => (
                        <tr key={device.deviceId} className="border-b border-white/5 hover:bg-white/5">
                          <td className="p-1.5">
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px] px-1">#{index + 1}</Badge>
                              <span className="text-xs font-medium truncate">{device.deviceName || device.deviceId}</span>
                            </div>
                          </td>
                          <td className="p-1.5 text-right">
                            <div className="text-xs font-semibold">{device.count.toLocaleString()}</div>
                            <div className="text-[10px] text-zinc-400">
                              {stats.totalDetections > 0
                                ? ((device.count / stats.totalDetections) * 100).toFixed(1)
                                : '0'}%
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
      </div>
      </div>
    </div>
  );
}
