import { useState, useEffect } from 'react';
import { apiClient, type ViolationStats, type TrafficViolation, type VCCStats } from '@/lib/api';
import { AlertTriangle, BarChart3, Loader2, Camera, Car, Bike, Truck } from 'lucide-react';
import { Empty, EmptyIcon, EmptyTitle } from '@/components/ui/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImageModal } from '@/components/ui/image-modal';
import { cn } from '@/lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useCountUp } from '@/hooks/useCountUp';
import { playSound } from '@/hooks/useSound';

export function ITMSDashboard() {
  const [violationStats, setViolationStats] = useState<ViolationStats | null>(null);
  const [_todayViolationStats, setTodayViolationStats] = useState<ViolationStats | null>(null);
  const [liveViolations, setLiveViolations] = useState<TrafficViolation[]>([]);
  const [vccStats, setVccStats] = useState<VCCStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [_violationsLoading, setViolationsLoading] = useState(false);
  const [showOnlyPending] = useState(true);
  const [selectedViolationId, setSelectedViolationId] = useState<string | null>(null);
  const [modalImage, setModalImage] = useState<{ url: string; metadata: any } | null>(null);
  const [lastViolationsUpdate, setLastViolationsUpdate] = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentViolationIndex, setCurrentViolationIndex] = useState(0);
  const [isAutoCycling, setIsAutoCycling] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 24);

      // Get today's start time (00:00:00)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Fetch violations stats (24 hours), today's stats, and VCC stats (for device names) in parallel
      const [violations, todayViolations, vcc] = await Promise.all([
        apiClient.getViolationStats({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        }),
        apiClient.getViolationStats({
          startTime: todayStart.toISOString(),
          endTime: endTime.toISOString(),
        }),
        apiClient.getVCCStats({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          groupBy: 'hour',
        }),
      ]);

      setViolationStats(violations);
      setTodayViolationStats(todayViolations);
      setVccStats(vcc);

      // Debug logging
      if (import.meta.env.DEV) {
        console.log('Violation Stats Received:', {
          violations,
          byType: violations?.byType,
          byTypeKeys: violations?.byType ? Object.keys(violations.byType) : [],
          byTypeEntries: violations?.byType ? Object.entries(violations.byType) : [],
        });
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveViolations = async () => {
    try {
      setViolationsLoading(true);
      const result = await apiClient.getViolations({
        status: 'APPROVED',
        limit: 50,
      });

      // Check if current selected violation still exists in new list
      const currentSelectedStillExists = result.violations.some(v => v.id === selectedViolationId);

      // Store previous violations to detect if we have new ones
      const previousViolationIds = new Set(liveViolations.map(v => v.id));
      const hasNewViolations = result.violations.some(v => !previousViolationIds.has(v.id));

      setLiveViolations(result.violations);
      setLastViolationsUpdate(new Date());

      if (hasNewViolations && previousViolationIds.size > 0) {
        playSound('violation-alert');
      }

      // Handle cycling logic when new data arrives
      if (result.violations.length > 0) {
        if (isAutoCycling) {
          if (hasNewViolations && currentSelectedStillExists) {
            // New violations added, but current still exists - continue from current position
            const index = result.violations.findIndex(v => v.id === selectedViolationId);
            if (index >= 0) {
              setCurrentViolationIndex(index);
              // Keep the same selected violation
            }
          } else if (hasNewViolations && !currentSelectedStillExists) {
            // New violations added, but current is gone - start from beginning
            setCurrentViolationIndex(0);
            setSelectedViolationId(result.violations[0].id);
          } else if (!hasNewViolations && currentSelectedStillExists) {
            // No new violations, current still exists - continue from current position
            const index = result.violations.findIndex(v => v.id === selectedViolationId);
            if (index >= 0) {
              setCurrentViolationIndex(index);
            }
          } else {
            // No new violations, current doesn't exist - reset to start
            setCurrentViolationIndex(0);
            setSelectedViolationId(result.violations[0].id);
          }
        } else {
          // Not auto-cycling - try to maintain selection
          if (currentSelectedStillExists) {
            const index = result.violations.findIndex(v => v.id === selectedViolationId);
            if (index >= 0) {
              setCurrentViolationIndex(index);
            }
          } else {
            // Current selection no longer exists, select first one but don't auto-cycle
            setCurrentViolationIndex(0);
            setSelectedViolationId(result.violations[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch live violations:', err);
    } finally {
      setViolationsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchLiveViolations();

    // Refresh stats every 30 seconds for more frequent updates
    const statsInterval = setInterval(() => {
      fetchStats();
    }, 30000);

    // Refresh violations every 30 seconds
    const violationsInterval = setInterval(() => {
      fetchLiveViolations();
    }, 30000);

    return () => {
      clearInterval(statsInterval);
      clearInterval(violationsInterval);
    };
  }, [showOnlyPending]);

  // Initialize selected violation when violations first load
  useEffect(() => {
    if (liveViolations.length > 0 && !selectedViolationId) {
      setCurrentViolationIndex(0);
      setSelectedViolationId(liveViolations[0].id);
      setIsAutoCycling(true);
    }
  }, [liveViolations.length, selectedViolationId]);

  // Update current time every second for "X seconds ago" display
  useEffect(() => {
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timeInterval);
  }, []);

  // Auto-cycle through violations every 1 second
  useEffect(() => {
    if (!isAutoCycling || liveViolations.length === 0) {
      return;
    }

    const cycleInterval = setInterval(() => {
      setCurrentViolationIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % liveViolations.length;
        // Update selected violation ID to match the current index
        if (liveViolations[nextIndex]) {
          setSelectedViolationId(liveViolations[nextIndex].id);
        }
        return nextIndex;
      });
    }, 5000);

    return () => clearInterval(cycleInterval);
  }, [isAutoCycling, liveViolations, selectedViolationId]);

  const getViolationTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      SPEED: 'bg-red-500/10 text-red-400',
      HELMET: 'bg-orange-500/10 text-orange-400',
      WRONG_SIDE: 'bg-amber-500/10 text-amber-400',
      RED_LIGHT: 'bg-purple-500/10 text-purple-400',
      NO_SEATBELT: 'bg-pink-500/10 text-pink-400',
      OVERLOADING: 'bg-indigo-500/10 text-indigo-400',
      ILLEGAL_PARKING: 'bg-zinc-500/10 text-zinc-400',
      OTHER: 'bg-blue-500/10 text-blue-400',
    };
    return colors[type] || 'bg-zinc-500/10 text-zinc-400';
  };

  const getViolationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      SPEED: 'Speed',
      HELMET: 'Helmet',
      WRONG_SIDE: 'Wrong Side',
      RED_LIGHT: 'Red Light',
      NO_SEATBELT: 'No Seatbelt',
      OVERLOADING: 'Overloading',
      ILLEGAL_PARKING: 'Parking',
      OTHER: 'Other',
    };
    return labels[type] || type;
  };


  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatTimeAgo = (date: Date | null): string => {
    if (!date) return '';
    const diffMs = currentTime.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 1) return 'Just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDeviceName = (name: string | undefined | null): string => {
    if (!name) return '';
    let cleaned = name;

    // Normalize case for checks but preserve original characters where possible
    const lower = cleaned.toLowerCase();

    // Remove "camera_" prefix (e.g. camera_nippani)
    if (lower.startsWith('camera_')) {
      cleaned = cleaned.slice(7);
    }

    // Remove "camera " prefix (e.g. Camera NIPPANI...)
    if (cleaned.toLowerCase().startsWith('camera ')) {
      cleaned = cleaned.slice(7);
    }

    // Remove "_camera" suffix (e.g. nippani_camera)
    if (cleaned.toLowerCase().endsWith('_camera')) {
      cleaned = cleaned.slice(0, -7);
    }

    // Remove " camera" suffix (e.g. ...ROAD CAMERA)
    if (cleaned.toLowerCase().endsWith(' camera')) {
      cleaned = cleaned.slice(0, -7);
    }

    // Remove any standalone "camera" tokens in the middle
    cleaned = cleaned
      .split(/[\s_]+/)
      .filter((part) => part.toLowerCase() !== 'camera')
      .join(' ');

    return cleaned.trim();
  };

  // Prepare trend data for chart (both VCC and violations)
  // Convert UTC hours to IST (UTC+5:30) for display
  const convertUTCToIST = (utcHour: number): number => {
    const istHour = (utcHour + 5.5) % 24;
    return Math.floor(istHour);
  };

  const formatHour = (hour: number): string => {
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  // Parse hour from time string (e.g., "2026-01-19 10:00" -> 10)
  const parseHourFromTimeString = (timeStr: string): number => {
    if (!timeStr) return 0;
    // Try to extract hour from "YYYY-MM-DD HH:MM" format
    const match = timeStr.match(/\s(\d{1,2}):/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 0;
  };

  // Build a map of all hours (0-23) for both datasets
  const hourMap = new Map<number, { violations: number; vcc: number; hour: string }>();

  // Initialize all hours to 0
  for (let hour = 0; hour < 24; hour++) {
    const istHour = convertUTCToIST(hour);
    hourMap.set(istHour, {
      violations: 0,
      vcc: 0,
      hour: formatHour(istHour),
    });
  }

  // Add violations data
  if (violationStats?.byTime && Array.isArray(violationStats.byTime)) {
    violationStats.byTime.forEach((item) => {
      const utcHour = typeof item.hour === 'number' ? item.hour : parseHourFromTimeString(String(item.hour ?? ''));
      const istHour = convertUTCToIST(utcHour);
      const existing = hourMap.get(istHour);
      if (existing) {
        existing.violations = Number(item.count) || 0;
      }
    });
  } else if (violationStats?.byHour) {
    const byHour = violationStats.byHour as Record<string | number, number>;
    for (let hour = 0; hour < 24; hour++) {
      const count = byHour[hour] ?? byHour[hour.toString()] ?? 0;
      const istHour = convertUTCToIST(hour);
      const existing = hourMap.get(istHour);
      if (existing) {
        existing.violations = Number(count) || 0;
      }
    }
  }

  // Add VCC data
  if (vccStats?.byTime && Array.isArray(vccStats.byTime)) {
    vccStats.byTime.forEach((item) => {
      const hourStr = item.hour?.toString() || '';
      const utcHour = parseHourFromTimeString(hourStr);
      const istHour = convertUTCToIST(utcHour);
      const existing = hourMap.get(istHour);
      if (existing) {
        existing.vcc = Number(item.count) || 0;
      }
    });
  } else if (vccStats?.byHour) {
    const byHour = vccStats.byHour as Record<string | number, number>;
    for (let hour = 0; hour < 24; hour++) {
      const count = byHour[hour] ?? byHour[hour.toString()] ?? 0;
      const istHour = convertUTCToIST(hour);
      const existing = hourMap.get(istHour);
      if (existing) {
        existing.vcc = Number(count) || 0;
      }
    }
  }

  // Convert map to array and sort by hour
  const trendData = Array.from(hourMap.values())
    .map(({ hour, ...rest }) => {
      // Parse hour back to number for sorting
      const hourNum = parseInt(hour.split(':')[0], 10);
      return { hour, hourValue: hourNum, ...rest };
    })
    .sort((a, b) => a.hourValue - b.hourValue)
    .map(({ hourValue, ...rest }) => rest); // Remove hourValue from final data

  // Prepare violation type distribution data
  const violationTypeData = violationStats?.byType
    ? Object.entries(violationStats.byType)
      .map(([type, count]) => ({
        name: getViolationTypeLabel(type),
        value: Number(count),
      }))
      .filter(item => item.value > 0) // Filter out zero counts
      .sort((a, b) => b.value - a.value)
    : [];

  // Debug logging
  if (import.meta.env.DEV) {
    console.log('Violation Type Data:', {
      violationStats,
      byType: violationStats?.byType,
      byTypeKeys: violationStats?.byType ? Object.keys(violationStats.byType) : [],
      byTypeEntries: violationStats?.byType ? Object.entries(violationStats.byType) : [],
      violationTypeData,
      violationTypeDataLength: violationTypeData.length,
    });
  }

  // Prepare top locations data from violations byDevice
  // Use VCC stats to get device names (VCC stats includes device names in byDevice array)
  const vccDeviceNameMap = new Map<string, string>();
  if (vccStats?.byDevice && Array.isArray(vccStats.byDevice)) {
    vccStats.byDevice.forEach(device => {
      if (device.deviceId && device.deviceName) {
        vccDeviceNameMap.set(device.deviceId, device.deviceName);
      }
    });
  }

  // Build top locations from violation stats byDevice
  // If violation stats don't have device data, fall back to VCC stats
  let topLocationsData: Array<{ deviceId: string; deviceName: string; count: number }> = [];

  // First try violation stats byDevice
  if (violationStats?.byDevice && typeof violationStats.byDevice === 'object') {
    const entries = Object.entries(violationStats.byDevice);
    if (entries.length > 0) {
      topLocationsData = entries
        .map(([deviceId, count]) => {
          const numCount = Number(count);
          // Skip if count is invalid or zero
          if (isNaN(numCount) || numCount <= 0) {
            return null;
          }

          // Try to get device name from VCC stats, otherwise use deviceId and format it
          let deviceName = vccDeviceNameMap.get(deviceId);
          if (!deviceName) {
            // Try case-insensitive match
            const lowerDeviceId = deviceId.toLowerCase();
            for (const [vccId, vccName] of vccDeviceNameMap.entries()) {
              if (vccId.toLowerCase() === lowerDeviceId) {
                deviceName = vccName;
                break;
              }
            }
          }

          // If still no name, format the deviceId
          if (!deviceName) {
            deviceName = formatDeviceName(deviceId) || deviceId;
          } else {
            // Format the device name from VCC stats too
            deviceName = formatDeviceName(deviceName) || deviceName;
          }

          return {
            deviceId,
            deviceName,
            count: numCount,
          };
        })
        .filter((item): item is { deviceId: string; deviceName: string; count: number } => item !== null)
        .sort((a, b) => b.count - a.count);
    }
  }

  // Fallback: If no violation device data, use VCC stats byDevice (shows detection locations)
  if (topLocationsData.length === 0 && vccStats?.byDevice && Array.isArray(vccStats.byDevice) && vccStats.byDevice.length > 0) {
    topLocationsData = vccStats.byDevice
      .map(device => ({
        deviceId: device.deviceId,
        deviceName: formatDeviceName(device.deviceName || device.deviceId) || device.deviceName || device.deviceId,
        count: Number(device.count) || 0,
      }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  // Debug logging (remove in production)
  if (import.meta.env.DEV) {
    const violationDeviceEntries = violationStats?.byDevice ? Object.entries(violationStats.byDevice) : [];
    const vccDeviceIds = vccStats?.byDevice ? vccStats.byDevice.map(d => d.deviceId) : [];
    console.log('Top Locations Debug:', {
      violationStatsByDevice: violationStats?.byDevice,
      violationStatsByDeviceKeys: violationStats?.byDevice ? Object.keys(violationStats.byDevice) : [],
      violationDeviceEntries,
      violationDeviceEntriesLength: violationDeviceEntries.length,
      vccStatsByDevice: vccStats?.byDevice,
      vccDeviceIds,
      vccDeviceNameMap: Array.from(vccDeviceNameMap.entries()),
      topLocationsData,
      topLocationsDataLength: topLocationsData.length,
    });
  }

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4'];

  // Count-up animations for VCC stats - quick 1.5s ease-out so numbers settle fast
  const totalDetectionsCount = useCountUp(vccStats?.totalDetections || 0, { duration: 1500 });
  const uniqueVehiclesCount = useCountUp(vccStats?.uniqueVehicles || 0, { duration: 1500 });
  const twoWCount = useCountUp(vccStats?.byVehicleType?.['2W'] || 0, { duration: 1500 });
  const fourWCount = useCountUp(vccStats?.byVehicleType?.['4W'] || 0, { duration: 1500 });
  const autoBusTruckCount = useCountUp(
    vccStats?.byVehicleType
      ? ((vccStats.byVehicleType['AUTO'] || 0) + (vccStats.byVehicleType['BUS'] || 0) + (vccStats.byVehicleType['TRUCK'] || 0))
      : 0,
    { duration: 1500 }
  );

  // Currently focused violation for main TV and details
  // Use currentViolationIndex if auto-cycling, otherwise use selectedViolationId
  const primaryViolation: TrafficViolation | null =
    liveViolations.length === 0
      ? null
      : isAutoCycling
        ? liveViolations[currentViolationIndex] || liveViolations[0]
        : selectedViolationId
          ? liveViolations.find((v) => v.id === selectedViolationId) || liveViolations[0]
          : liveViolations[0];


  if (loading && !violationStats) {
    return (
      <div className="flex items-center justify-center h-full relative overflow-hidden">
        <div className="text-center relative z-10">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-2" />
          <p className="text-zinc-400 text-sm">Loading surveillance data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full text-white relative">
      {/* Main Content Area - Command Center Layout */}
      <div className="relative z-10 w-full p-4">
        {/* Top Stats Bar - Vehicles Movement, Violations, and Vehicle Types */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
          {/* Vehicles Movement */}
          <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3 hover:bg-zinc-900/50 transition-all">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-zinc-500">Vehicles movement</div>
              <Car className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-semibold text-zinc-100">
              {totalDetectionsCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              {vccStats?.uniqueVehicles ? `${uniqueVehiclesCount.toLocaleString()} unique` : 'Last 24 hours'}
            </div>
          </div>

          {/* Violations Count with Pending/Approved */}
          <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3 hover:bg-zinc-900/50 transition-all">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-zinc-500">Violations count</div>
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-2xl font-semibold text-zinc-100">
              {violationStats?.total.toLocaleString() || '0'}
            </div>
            <div className="text-[10px] text-zinc-500">
              {violationStats ? `Pending: ${violationStats.pending || 0} | Approved: ${violationStats.approved || 0}` : 'Last 24 hours'}
            </div>
          </div>

          {/* 2W Vehicle Type */}
          <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3 hover:bg-zinc-900/50 transition-all">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-zinc-500">2W</div>
              <Bike className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-semibold text-zinc-100">
              {twoWCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              {vccStats?.totalDetections && vccStats.byVehicleType?.['2W']
                ? `${((vccStats.byVehicleType['2W'] / vccStats.totalDetections) * 100).toFixed(1)}% of total`
                : 'Vehicles'}
            </div>
          </div>

          {/* 4W Vehicle Type */}
          <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3 hover:bg-zinc-900/50 transition-all">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-zinc-500">4W</div>
              <Car className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-semibold text-zinc-100">
              {fourWCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              {vccStats?.totalDetections && vccStats.byVehicleType?.['4W']
                ? `${((vccStats.byVehicleType['4W'] / vccStats.totalDetections) * 100).toFixed(1)}% of total`
                : 'Vehicles'}
            </div>
          </div>

          {/* AUTO/BUS/TRUCK Combined */}
          <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3 hover:bg-zinc-900/50 transition-all">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-zinc-500">Auto/Bus/Truck</div>
              <Truck className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-2xl font-semibold text-zinc-100">
              {autoBusTruckCount.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500">
              {vccStats?.totalDetections && vccStats.byVehicleType
                ? `${((((vccStats.byVehicleType['AUTO'] || 0) + (vccStats.byVehicleType['BUS'] || 0) + (vccStats.byVehicleType['TRUCK'] || 0)) / vccStats.totalDetections) * 100).toFixed(1)}% of total`
                : 'Vehicles'}
            </div>
          </div>

        </div>

        {/* Violation Thumbnails Strip - Single Row, Horizontal Scroll */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-zinc-400 ">Live Violations</h2>
            {lastViolationsUpdate && (
              <span className="text-[10px] text-zinc-500">
                Updated {formatTimeAgo(lastViolationsUpdate)}
              </span>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {liveViolations.slice(0, 16).map((violation) => {
              const isSelected = selectedViolationId === violation.id;
              return (
                <div
                  key={violation.id}
                  className={cn(
                    "relative aspect-[9/16] w-20 sm:w-24 md:w-28 lg:w-32 flex-shrink-0 bg-black overflow-hidden cursor-pointer rounded-lg transition-all",
                    isSelected
                      ? "ring-2 ring-indigo-500"
                      : "hover:ring-1 hover:ring-white/20"
                  )}
                  onClick={() => {
                    const clickedIndex = liveViolations.findIndex(v => v.id === violation.id);
                    // When user manually selects, pause auto-cycling
                    if (isSelected && isAutoCycling) {
                      // If clicking the currently selected one while cycling, do nothing (keep cycling)
                      return;
                    } else if (isSelected && !isAutoCycling) {
                      // If clicking the selected one while paused, resume cycling
                      setIsAutoCycling(true);
                      setCurrentViolationIndex(clickedIndex);
                    } else {
                      // Clicking a different violation - pause cycling and select it
                      setIsAutoCycling(false);
                      setSelectedViolationId(violation.id);
                      setCurrentViolationIndex(clickedIndex);
                    }
                  }}
                >
                  {(violation.fullSnapshotUrl || violation.plateImageUrl) ? (
                    <>
                      <img
                        src={violation.fullSnapshotUrl || violation.plateImageUrl || ''}
                        alt="Violation"
                        className="w-full h-full object-cover cursor-pointer"
                      />
                      {/* Top Overlay - Violation Type and LIVE */}
                      <div className="absolute top-1 left-1 right-1 flex items-center justify-between pointer-events-none">
                        <Badge className={cn("text-[10px] px-1.5 py-0.5", getViolationTypeColor(violation.violationType))}>
                          {getViolationTypeLabel(violation.violationType)}
                        </Badge>
                        <span className="text-[10px] text-indigo-400 bg-zinc-900/90 px-1.5 py-0.5 rounded border border-indigo-500/30">
                          {isSelected ? 'Selected' : 'Live'}
                        </span>
                      </div>
                      {/* Bottom Overlay - Plate Number and Timestamp */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-900/95 via-zinc-900/80 to-transparent p-2 pointer-events-none">
                        {violation.plateNumber && (
                          <div className="text-xs font-bold text-zinc-100 mb-1">
                            {violation.plateNumber}
                          </div>
                        )}
                        <div className="text-[10px] text-zinc-400">
                          {formatTime(violation.timestamp)}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-black">
                      <Camera className="w-8 h-8 text-zinc-700" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 2 Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column - Violations Section */}
          <div className="col-span-1 lg:col-span-6 space-y-2">
            {/* Main Violation Image and Details - Side by Side */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              {/* Main Violation Image */}
              <div className="col-span-1 sm:col-span-6">
                {primaryViolation ? (
                  <div className="relative w-full aspect-[9/16] max-h-[50vh] bg-black overflow-hidden rounded-lg">
                    {(primaryViolation.video || primaryViolation.fullSnapshotUrl || primaryViolation.plateImageUrl) ? (
                      <>
                        {primaryViolation.video ? (
                          <video
                            src={primaryViolation.video}
                            controls
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={primaryViolation.fullSnapshotUrl || primaryViolation.plateImageUrl || ''}
                            alt="Main Violation"
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => {
                              setModalImage({
                                url: primaryViolation.fullSnapshotUrl || primaryViolation.plateImageUrl || '',
                                metadata: {
                                  title: formatDeviceName(primaryViolation.device?.name || primaryViolation.deviceId) || 'Violation',
                                  plateNumber: primaryViolation.plateNumber,
                                  timestamp: primaryViolation.timestamp,
                                  violationType: primaryViolation.violationType,
                                  device: primaryViolation.device,
                                  status: primaryViolation.status,
                                  detectedSpeed: primaryViolation.detectedSpeed,
                                },
                              });
                            }}
                          />
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-black">
                        <Camera className="w-16 h-16 text-zinc-800" />
                      </div>
                    )}
                  </div>
                ) : (
                  <Empty className="w-full aspect-[9/16] max-h-[50vh] bg-zinc-900/30 border border-white/5 rounded-lg min-h-0">
                    <EmptyIcon><AlertTriangle /></EmptyIcon>
                    <EmptyTitle>No violations</EmptyTitle>
                  </Empty>
                )}
              </div>

              {/* Detailed Information Panel */}
              <div className="col-span-1 sm:col-span-6">
                {primaryViolation ? (
                  <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-4 h-full">
                    <>
                      {/* Header - Number Plate Style + Back to Live */}
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center bg-zinc-100 text-zinc-900 px-3 py-1.5 rounded-md border-2 border-zinc-900">
                          <div className="text-xl font-black tracking-[0.3em] font-mono">
                            {primaryViolation.plateNumber || 'UNKNOWN'}
                          </div>
                        </div>

                        {selectedViolationId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setIsAutoCycling(true);
                              setCurrentViolationIndex(0);
                              if (liveViolations.length > 0) {
                                setSelectedViolationId(liveViolations[0].id);
                              } else {
                                setSelectedViolationId(null);
                              }
                            }}
                            className="text-zinc-400 hover:text-zinc-100 h-7 w-7 rounded-full flex items-center justify-center"
                            aria-label="Back to live"
                          >
                            ×
                          </Button>
                        )}
                      </div>

                      {/* Violation Details */}
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-zinc-500 mb-1">
                            VIOLATION TYPE
                          </div>
                          <Badge
                            className={cn(
                              "text-xs px-2 py-1",
                              getViolationTypeColor(primaryViolation.violationType)
                            )}
                          >
                            {getViolationTypeLabel(primaryViolation.violationType)}
                          </Badge>
                        </div>

                        {primaryViolation.detectedSpeed && (
                          <div>
                            <div className="text-xs text-zinc-500 mb-1">
                              SPEED
                            </div>
                            <div className="text-lg text-amber-400 font-semibold">
                              {primaryViolation.detectedSpeed} km/h
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="text-xs text-zinc-500 mb-1">
                            DETECTION TIME
                          </div>
                          <div className="text-sm text-zinc-300">
                            {formatTime(primaryViolation.timestamp)}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-zinc-500 mb-1">
                            LOCATION
                          </div>
                          <div className="text-sm text-zinc-300">
                            {formatDeviceName(primaryViolation.device?.name || primaryViolation.deviceId) || 'Unknown'}
                          </div>
                        </div>

                        {primaryViolation.confidence && (
                          <div>
                            <div className="text-xs text-zinc-500 mb-1">
                              CONFIDENCE
                            </div>
                            <div className="text-lg text-emerald-400 font-semibold">
                              {Math.round(primaryViolation.confidence * 100)}%
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  </div>
                ) : (
                  <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3 h-full flex items-center justify-center">
                    <div className="text-center text-zinc-500 text-xs">
                      No violation selected
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - All Widgets */}
          <div className="col-span-1 lg:col-span-6 space-y-3">
            {/* Trends Chart */}
            <div className="bg-zinc-900/30 border border-white/5 rounded-lg">
              <h2 className="text-sm font-medium px-3 pt-3 pb-2 text-zinc-200 tracking-wide">24 Hour Trend Analysis</h2>
              {trendData.length > 0 ? (
                <div className="px-1 pb-1">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="colorViolations" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorVCC" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.5} />
                      <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 10, fill: '#71717a' }}
                        interval={1}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                        stroke="#3f3f46"
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10, fill: '#71717a' }}
                        stroke="#3f3f46"
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: '#71717a' }}
                        stroke="#3f3f46"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#18181b',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#fafafa',
                        }}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="violations"
                        stroke="#ef4444"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorViolations)"
                        name="Violations"
                      />
                      <Area
                        yAxisId="right"
                        type="monotone"
                        dataKey="vcc"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorVCC)"
                        name="Vehicles"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty className="min-h-0 h-[150px]">
                  <EmptyIcon><BarChart3 /></EmptyIcon>
                  <EmptyTitle>No data</EmptyTitle>
                </Empty>
              )}
            </div>

            {/* Top Locations and Violation Types - 2 Column Grid */}
            <div className="grid grid-cols-1 gap-3">
              {/* Violation Types */}
              <div className="bg-zinc-900/30 border border-white/5 rounded-lg p-3">
                <h2 className="text-sm font-medium mb-3 text-zinc-200 tracking-wide">Violation Types</h2>
                {violationTypeData.length > 0 ? (
                  <div className="space-y-2">
                    {violationTypeData.slice(0, 10).map((item, index) => {
                      const maxCount = Math.max(...violationTypeData.slice(0, 10).map(d => d.value));
                      const percentage = maxCount > 0 ? (item.value / maxCount) * 100 : 0;
                      return (
                        <div key={item.name} className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-6 text-xs text-zinc-500 shrink-0">
                              #{index + 1}
                            </div>
                            <div className="text-xs text-zinc-400 truncate min-w-0">
                              {item.name}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-1 ml-2">
                            <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${percentage}%`,
                                  backgroundColor: COLORS[index % COLORS.length],
                                }}
                              />
                            </div>
                            <span className="text-sm font-semibold w-16 text-right text-zinc-300 shrink-0">
                              {item.value.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center text-zinc-500 text-xs py-4">
                    No violation data
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      <ImageModal
        isOpen={!!modalImage}
        onClose={() => setModalImage(null)}
        imageUrl={modalImage?.url || ''}
        metadata={modalImage?.metadata || {}}
        getViolationTypeColor={getViolationTypeColor}
        getViolationTypeLabel={getViolationTypeLabel}
      />
    </div>
  );
}
