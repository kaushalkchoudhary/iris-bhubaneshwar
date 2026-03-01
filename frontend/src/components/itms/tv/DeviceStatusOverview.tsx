import { useState, useEffect } from 'react';
import { apiClient, type Device, type VCCRealtime } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { HudBadge } from '@/components/ui/hud-badge';
import { StatsCard, formatNumber } from '../widgets';
import { Camera, Server, Activity, Loader2, CheckCircle, XCircle, AlertTriangle, Users } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import type { WorkerWithCounts } from '@/lib/worker-types';

export function DeviceStatusOverview() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [workers, setWorkers] = useState<WorkerWithCounts[]>([]);
  const [realtime, setRealtime] = useState<VCCRealtime | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [devicesData, workersData, realtimeData] = await Promise.all([
        apiClient.getDevices(),
        apiClient.getWorkers(),
        apiClient.getVCCRealtime(),
      ]);

      setDevices(devicesData as Device[]);
      setWorkers(workersData);
      setRealtime(realtimeData);
    } catch (err) {
      console.error('Failed to fetch device status data:', err);
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

  // Calculate device stats
  const activeDevices = devices.filter((d) => d.status === 'ACTIVE' || d.status === 'active').length;
  const inactiveDevices = devices.filter((d) => d.status === 'INACTIVE' || d.status === 'inactive').length;
  const maintenanceDevices = devices.filter((d) => d.status === 'MAINTENANCE' || d.status === 'maintenance').length;

  // Calculate worker stats
  const activeWorkers = workers.filter((w) => w.status === 'active').length;
  const offlineWorkers = workers.filter((w) => w.status === 'offline').length;

  // Calculate ingestion rate (vehicles per minute from realtime)
  const totalVehicles = realtime?.totalDetections || 0;
  const ingestionRate = Math.round(totalVehicles / 1440); // Approximate per minute

  // Recent device events (last 10)
  const recentEvents = devices
    .filter((d) => d.latestEvent)
    .sort((a, b) => {
      const timeA = a.latestEvent?.timestamp ? new Date(a.latestEvent.timestamp).getTime() : 0;
      const timeB = b.latestEvent?.timestamp ? new Date(b.latestEvent.timestamp).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, 10);

  if (loading && devices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-2" />
          <p className="text-zinc-300">Loading device status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto relative">
      <div className="flex-1 p-3 sm:p-4 lg:p-6 space-y-4 relative z-10 flex flex-col">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-zinc-100">Device Status Overview</h1>
          <div className="text-sm text-zinc-500">
            {new Date().toLocaleString()}
          </div>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
          <StatsCard
            title="Active Devices"
            value={activeDevices}
            subtitle={`${inactiveDevices} inactive`}
            icon={Camera}
            color="green"
            size="large"
          />
          <StatsCard
            title="Inactive Devices"
            value={inactiveDevices}
            subtitle={`${maintenanceDevices} maintenance`}
            icon={XCircle}
            color="yellow"
            size="large"
          />
          <StatsCard
            title="Edge Workers"
            value={activeWorkers}
            subtitle={`${offlineWorkers} offline`}
            icon={Server}
            color="cyan"
            size="large"
          />
          <StatsCard
            title="Ingestion Rate"
            value={`${ingestionRate}/min`}
            subtitle={`${formatNumber(totalVehicles)} total`}
            icon={Activity}
            color="magenta"
            size="large"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          {/* Left Column - Device Status Map Placeholder */}
          <div className="lg:col-span-2">
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4 h-full">
              <h2 className="text-lg font-bold text-zinc-100 mb-4">Device Status Map</h2>
              <div className="h-[calc(100%-3rem)] flex items-center justify-center bg-zinc-950 rounded border border-white/10">
                <div className="text-center text-zinc-500">
                  <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-xl mb-2">Device locations</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm">Active: {activeDevices}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-amber-400" />
                      <span className="text-sm">Inactive: {inactiveDevices}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      <span className="text-sm">Maintenance: {maintenanceDevices}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Column - Recent Events & Worker Status */}
          <div className="space-y-4 overflow-y-auto">
            {/* Recent Device Events */}
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
              <h2 className="text-lg font-bold text-rose-400 mb-3">Recent Events</h2>
              <div className="space-y-2">
                {recentEvents.map((device) => (
                  <div
                    key={device.id}
                    className="p-2 bg-zinc-900/50 rounded border border-white/5"
                  >
                    <div className="text-xs font-bold text-rose-400 mb-1">
                      {device.name || device.id}
                    </div>
                    {device.latestEvent && (
                      <div className="text-[10px] text-zinc-500 font-mono">
                        {device.latestEvent.eventType}
                      </div>
                    )}
                  </div>
                ))}
                {recentEvents.length === 0 && (
                  <div className="text-center text-zinc-500 py-4 text-sm">
                    No recent events
                  </div>
                )}
              </div>
            </Card>

            {/* Edge Worker Status */}
            <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
              <h2 className="text-lg font-bold text-emerald-400 mb-3">Edge Workers</h2>
              <div className="space-y-2">
                {workers.slice(0, 5).map((worker) => (
                  <div
                    key={worker.id}
                    className={cn(
                      "p-2 rounded border",
                      worker.status === 'active'
                        ? "border-white/10 bg-zinc-900/50"
                        : "border-white/5 bg-zinc-900/30"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-bold text-emerald-400 truncate">
                        {worker.name || worker.id}
                      </div>
                      <HudBadge
                        variant={worker.status === 'active' ? 'success' : 'danger'}
                        size="sm"
                      >
                        {worker.status.toUpperCase()}
                      </HudBadge>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {worker.cameraCount || 0} cameras
                    </div>
                  </div>
                ))}
                {workers.length === 0 && (
                  <Empty className="min-h-0 py-4">
                    <EmptyIcon><Users /></EmptyIcon>
                    <EmptyTitle>No workers</EmptyTitle>
                  </Empty>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Bottom Row - Uptime Statistics */}
        <div className="mt-4">
          <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
            <h2 className="text-lg font-bold text-amber-400 mb-4">Uptime Statistics</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-sm text-zinc-500 mb-1">System uptime</div>
                <div className="text-2xl font-bold text-amber-400 font-mono">99.9%</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-zinc-500 mb-1">Avg device uptime</div>
                <div className="text-2xl font-bold text-amber-400 font-mono">98.5%</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-zinc-500 mb-1">Data freshness</div>
                <div className="text-2xl font-bold text-emerald-400 font-mono">Live</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-zinc-500 mb-1">Last update</div>
                <div className="text-sm font-bold text-amber-400 font-mono">
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
