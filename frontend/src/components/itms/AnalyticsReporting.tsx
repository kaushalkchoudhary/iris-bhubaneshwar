import { useState, useEffect } from 'react';
import { apiClient, type VCCStats, type VehicleStats, type Device } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TrendChart, PieChartWidget, StatsCard, formatNumber } from './widgets';
import { ITMSLayout } from './components/ITMSLayout';
import { HudBadge } from '@/components/ui/hud-badge';
import { Download, Loader2, Camera, Radio, Cpu, Monitor } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { exportToCSV } from '@/lib/utils';

export function AnalyticsReporting() {
  const [vccStats, setVccStats] = useState<VCCStats | null>(null);
  const [vehicleStats, setVehicleStats] = useState<VehicleStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [activeTab, setActiveTab] = useState('trends');

  const fetchData = async () => {
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

      const [vcc, vehicles, deviceList] = await Promise.all([
        apiClient.getVCCStats({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          groupBy: timeRange === '24h' ? 'hour' : 'day',
        }),
        apiClient.getVehicleStats(),
        apiClient.getDevices(),
      ]);

      setVccStats(vcc);
      setVehicleStats(vehicles);
      setDevices(deviceList as Device[]);
    } catch (err) {
      console.error('Failed to fetch analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (activeTab === 'vehicles' && vccStats?.byVehicleType) {
      const data = Object.entries(vccStats.byVehicleType).map(([type, count]) => ({ type, count }));
      exportToCSV(data, `vehicles-export-${new Date().toISOString().split('T')[0]}.csv`);
    } else if (activeTab === 'devices' && devices.length > 0) {
      const data = devices.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        isOnline: d.isOnline,
        uptime: d.uptimePercent
      }));
      exportToCSV(data, `devices-export-${new Date().toISOString().split('T')[0]}.csv`);
    } else if (trendData.length > 0) {
      exportToCSV(trendData, `analytics-trends-${new Date().toISOString().split('T')[0]}.csv`);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  // Prepare trend data
  const trendData: Array<{ time: string; vehicles: number }> = [];
  if (vccStats?.byTime) {
    vccStats.byTime.forEach((item: any) => {
      trendData.push({
        time: item.hour || item.day || '',
        vehicles: Number(item.count) || 0,
      });
    });
  }

  // Vehicle type distribution
  const vehicleTypeData = vccStats?.byVehicleType
    ? Object.entries(vccStats.byVehicleType)
      .map(([type, count]) => ({
        name: type === '2W' ? '2 Wheeler' : type === '4W' ? '4 Wheeler' : type,
        value: Number(count),
      }))
      .sort((a, b) => b.value - a.value)
    : [];

  if (loading && !vccStats) {
    return (
      <div className="flex items-center justify-center h-full relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
          <p className="text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <ITMSLayout>
      <div className="h-full w-full p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-bold text-foreground">Analytics & Reporting</h2>
          <div className="flex items-center gap-2">
            <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
              <TabsList className="bg-muted/40 border border-border">
                <TabsTrigger value="24h" className="text-xs">24H</TabsTrigger>
                <TabsTrigger value="7d" className="text-xs">7D</TabsTrigger>
                <TabsTrigger value="30d" className="text-xs">30D</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="secondary" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <StatsCard
            title="Total Vehicles"
            value={vehicleStats?.total || 0}
            subtitle={`${vehicleStats?.withPlates || 0} with plates`}
            color="cyan"
            size="large"
          />
          <StatsCard
            title="Detections"
            value={vccStats?.totalDetections || 0}
            subtitle="Total count"
            color="green"
            size="large"
          />
          <StatsCard
            title="Vehicle Types"
            value={vehicleTypeData.length}
            subtitle="Classified categories"
            color="yellow"
            size="large"
          />
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4 bg-muted/40 border border-border">
            <TabsTrigger value="trends" className="text-xs">Trends</TabsTrigger>
            <TabsTrigger value="vehicles" className="text-xs">Vehicles</TabsTrigger>
            <TabsTrigger value="devices" className="text-xs">Devices</TabsTrigger>
          </TabsList>

          <TabsContent value="trends" className="space-y-4">
            <TrendChart
              data={trendData}
              dataKeys={[
                { key: 'vehicles', color: '#6366f1', gradientId: 'colorVehicles' },
              ]}
              height={400}
              title="Vehicle Detection Trends"
              xAxisKey="time"
            />
          </TabsContent>

          <TabsContent value="vehicles" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PieChartWidget
                data={vehicleTypeData}
                height={400}
                title="Vehicle Type Distribution"
              />
              <Card className="bg-card/70 border border-border p-4">
                <h3 className="text-lg font-bold text-foreground mb-4">Top Vehicle Types</h3>
                <div className="space-y-2">
                  {vehicleTypeData.slice(0, 5).map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-muted/40 rounded-lg">
                      <span className="text-sm text-foreground/80">{item.name}</span>
                      <span className="text-sm font-bold text-foreground">{formatNumber(item.value)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="devices" className="space-y-4">
            {/* Device Summary Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="bg-card/70 border border-border p-4">
                <p className="text-xs text-muted-foreground tracking-wider mb-1">Total Devices</p>
                <p className="text-2xl font-mono font-bold text-foreground">{devices.length}</p>
              </Card>
              <Card className="bg-card/70 border border-border p-4">
                <p className="text-xs text-muted-foreground tracking-wider mb-1">Online</p>
                <p className="text-2xl font-mono font-bold text-emerald-400">{devices.filter(d => d.isOnline).length}</p>
              </Card>
              <Card className="bg-card/70 border border-border p-4">
                <p className="text-xs text-muted-foreground tracking-wider mb-1">Offline</p>
                <p className="text-2xl font-mono font-bold text-red-400">{devices.filter(d => !d.isOnline).length}</p>
              </Card>
              <Card className="bg-card/70 border border-border p-4">
                <p className="text-xs text-muted-foreground tracking-wider mb-1">Avg Uptime</p>
                <p className="text-2xl font-mono font-bold text-foreground">
                  {devices.length > 0
                    ? (devices.reduce((sum, d) => sum + (d.uptimePercent ?? 0), 0) / devices.length).toFixed(1)
                    : 0}%
                </p>
              </Card>
            </div>

            {/* Device Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {devices.map((device) => {
                const DeviceIcon = device.type === 'CAMERA' ? Camera
                  : device.type === 'SENSOR' ? Radio
                    : device.type === 'DRONE' ? Monitor
                      : Cpu;
                const uptime = device.uptimePercent ?? 0;

                return (
                  <Card key={device.id} className="bg-card/70 border border-border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DeviceIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground truncate">{device.name}</span>
                      </div>
                      <HudBadge variant={device.isOnline ? 'success' : 'danger'} size="sm">
                        {device.isOnline ? 'Online' : 'Offline'}
                      </HudBadge>
                    </div>

                    <div className="text-xs text-muted-foreground tracking-wider">{device.type}</div>

                    {/* Uptime Bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Uptime</span>
                        <span className="text-xs font-mono text-foreground/80">{uptime.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${uptime >= 90 ? 'bg-emerald-500' : uptime >= 70 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                          style={{ width: `${Math.min(uptime, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Last Seen */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Last Seen</span>
                      <span className="font-mono text-foreground/80">
                        {device.lastSeen
                          ? new Date(device.lastSeen).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })
                          : 'N/A'}
                      </span>
                    </div>

                    {/* Latest Event */}
                    {device.latestEvent && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Latest Event</span>
                        <span className="font-mono text-foreground/80">{device.latestEvent.eventType}</span>
                      </div>
                    )}
                  </Card>
                );
              })}

              {devices.length === 0 && (
                <div className="col-span-full">
                  <Empty>
                    <EmptyIcon><Cpu /></EmptyIcon>
                    <EmptyTitle>No devices found</EmptyTitle>
                    <EmptyDescription>No devices are currently registered in the system.</EmptyDescription>
                  </Empty>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ITMSLayout>
  );
}
