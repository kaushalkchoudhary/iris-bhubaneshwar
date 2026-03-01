import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { useEffect, useState, useMemo, useRef } from 'react';
import { apiClient, type DeviceMapMarker, type Device, type Hotspot } from '@/lib/api';
import { Camera as CameraIcon, Activity, Plane, Radio, Users, AlertTriangle, Layers } from 'lucide-react';
import { useDeviceFilter } from '@/contexts/DeviceFilterContext';
import { useLayerVisibility } from '@/contexts/LayerVisibilityContext';
import { useMapType } from '@/contexts/MapTypeContext';
import { DeviceSidebar } from './DeviceSidebar';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    google: any;
  }
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';

// TrafficLayer component
function TrafficLayer({ visible }: { visible: boolean }) {
  const map = useMap();
  const trafficLayerRef = useRef<any>(null);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    if (!trafficLayerRef.current) {
      trafficLayerRef.current = new window.google.maps.TrafficLayer();
    }

    const trafficLayer = trafficLayerRef.current;
    
    if (visible) {
      trafficLayer.setMap(map);
    } else {
      trafficLayer.setMap(null);
    }

    return () => {
      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null);
      }
    };
  }, [map, visible]);

  return null;
}

// MapTypeControl component to switch between satellite and roadmap
function MapTypeControl({ mapType }: { mapType: 'satellite' | 'roadmap' }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    const mapTypeId = mapType === 'satellite' 
      ? window.google.maps.MapTypeId.SATELLITE 
      : window.google.maps.MapTypeId.ROADMAP;
    
    map.setMapTypeId(mapTypeId);
  }, [map, mapType]);

  return null;
}

// MapStyles component to hide POIs
function MapStyles() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const styles: any[] = [
      {
        featureType: 'poi',
        elementType: 'labels',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'poi',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'poi.business',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'poi.attraction',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'poi.place_of_worship',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'poi.school',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'poi.sports_complex',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'transit',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'transit.station',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'road',
        elementType: 'labels.icon',
        stylers: [{ visibility: 'off' }],
      },
    ];

    map.setOptions({ styles });
  }, [map]);

  return null;
}

// HeatmapLayer component using native Google Maps API
function HeatmapLayer({ data, visible }: { data: Array<{ lat: number; lng: number; weight: number }>; visible: boolean }) {
  const map = useMap();
  const heatmapRef = useRef<any>(null);

  useEffect(() => {
    if (!map || !window.google?.maps?.visualization) return;

    if (!heatmapRef.current) {
      heatmapRef.current = new window.google.maps.visualization.HeatmapLayer({
        data: [],
        map: null,
        radius: 50,
        opacity: 0.7,
        gradient: [
          'rgba(59, 130, 246, 0)',     // Blue (transparent) - Low
          'rgba(59, 130, 246, 0.5)',   // Blue - Low
          'rgba(234, 179, 8, 0.7)',    // Yellow - Medium
          'rgba(249, 115, 22, 0.85)',  // Orange - High
          'rgba(239, 68, 68, 1)',      // Red - Critical
        ],
      });
    }

    const heatmap = heatmapRef.current;
    
    if (visible && data.length > 0) {
      const heatmapData = data.map((point) => ({
        location: new window.google.maps.LatLng(point.lat, point.lng),
        weight: point.weight,
      }));
      heatmap.setData(heatmapData);
      heatmap.setMap(map);
    } else {
      heatmap.setMap(null);
    }

    return () => {
      if (heatmapRef.current) {
        heatmapRef.current.setMap(null);
      }
    };
  }, [map, data, visible]);

  return null;
}

export function MapView() {
  const [allDevices, setAllDevices] = useState<DeviceMapMarker[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedTypes } = useDeviceFilter();
  const { showCameras, showHotspots, showTraffic } = useLayerVisibility();
  const { mapType } = useMapType();

  // Default center: Bangalore
  const defaultCenter = { lat: 12.9716, lng: 77.5946 };

  // Filter devices by selected types
  const filteredDevices = useMemo(() => {
    if (selectedTypes.length === 0 || !showCameras) {
      return [];
    }
    return allDevices.filter((device) => selectedTypes.includes(device.type));
  }, [allDevices, selectedTypes, showCameras]);

  // Prepare heatmap data from hotspots
  const heatmapData = useMemo(() => {
    if (!showHotspots) return [];
    
    return hotspots
      .filter((hotspot) => {
        // Filter by device types if cameras are filtered
        if (selectedTypes.length > 0 && !selectedTypes.includes(hotspot.type)) {
          return false;
        }
        // Include hotspots with valid coordinates (including GREEN)
        return (
          hotspot.lat !== 0 &&
          hotspot.lng !== 0 &&
          hotspot.peopleCount !== null &&
          hotspot.peopleCount >= 0
        );
      })
      .map((hotspot) => {
        // Weight based on severity and people count
        let weight = hotspot.peopleCount || 1;
        switch (hotspot.hotspotSeverity) {
          case 'RED':
            weight *= 3;
            break;
          case 'ORANGE':
            weight *= 2;
            break;
          case 'YELLOW':
            weight *= 1.5;
            break;
          case 'GREEN':
            weight *= 0.5; // Lower weight for green/low density
            break;
          default:
            weight *= 1;
        }
        return {
          lat: hotspot.lat,
          lng: hotspot.lng,
          weight: Math.max(0.1, Math.min(weight, 100)), // Min 0.1 to ensure visibility, cap at 100
        };
      });
  }, [hotspots, showHotspots, selectedTypes]);

  // Fetch devices independently
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        setLoading(true);
        const devicesData = await apiClient.getDevicesForMap();
        setAllDevices(devicesData);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch devices:', err);
        setError('Failed to load devices');
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
    // Refresh devices every 30 seconds
    const interval = setInterval(fetchDevices, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch hotspots independently
  useEffect(() => {
    const fetchHotspots = async () => {
      try {
        const hotspotsData = await apiClient.getHotspots();
        setHotspots(hotspotsData);
      } catch (err) {
        console.error('Failed to fetch hotspots:', err);
      }
    };

    fetchHotspots();
    // Refresh hotspots every 10 seconds (more frequent for real-time updates)
    const interval = setInterval(fetchHotspots, 10000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (status: string) => {
    return status?.toUpperCase() === 'ACTIVE';
  };

  const getMarkerColor = (device: DeviceMapMarker) => {
    // If device is inactive, show gray
    if (!isActive(device.status)) {
      return { bg: '#9ca3af', border: '#6b7280', icon: '#fff' }; // Inactive gray
    }

    // Use device type color
      switch (device.type) {
        case 'CAMERA':
        return { bg: '#3b82f6', border: '#1e40af', icon: '#fff' }; // Blue
        case 'DRONE':
        return { bg: '#10b981', border: '#059669', icon: '#fff' }; // Green
        case 'SENSOR':
        return { bg: '#f59e0b', border: '#d97706', icon: '#fff' }; // Amber
        default:
        return { bg: '#6b7280', border: '#4b5563', icon: '#fff' }; // Gray
      }
  };

  const getDeviceIcon = (device: DeviceMapMarker) => {
    switch (device.type) {
      case 'CAMERA':
        return CameraIcon;
      case 'DRONE':
        return Plane;
      case 'SENSOR':
        return Radio;
      default:
        return CameraIcon;
    }
  };

  return (
    <div className="relative w-full h-full">
      <div className={cn(
        "absolute inset-0 transition-all",
        selectedDevice && "mr-96"
      )}>
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['visualization']}>
        <Map
          defaultCenter={defaultCenter}
          defaultZoom={13}
          mapId="iris-map"
          disableDefaultUI={true}
          gestureHandling="greedy"
          className="w-full h-full"
        >
          {/* Map Type Control */}
          <MapTypeControl mapType={mapType} />
          
          {/* Apply map styles to hide POIs */}
          <MapStyles />
          
          {/* Traffic Layer */}
          <TrafficLayer visible={showTraffic} />
          
          {/* Heatmap Layer for Hotspots */}
          <HeatmapLayer data={heatmapData} visible={showHotspots} />

          {/* Device Markers */}
          {filteredDevices
            .filter((device) => {
              // Filter out devices with invalid coordinates
              const lat = typeof device.lat === 'number' ? device.lat : Number(device.lat);
              const lng = typeof device.lng === 'number' ? device.lng : Number(device.lng);
              return (
                !isNaN(lat) &&
                !isNaN(lng) &&
                isFinite(lat) &&
                isFinite(lng) &&
                lat >= -90 &&
                lat <= 90 &&
                lng >= -180 &&
                lng <= 180 &&
                !(lat === 0 && lng === 0) // Exclude devices at 0,0 (invalid coordinates)
              );
            })
            .map((device) => {
            const colors = getMarkerColor(device);
              const IconComponent = getDeviceIcon(device);
              // Ensure coordinates are numbers
              const lat = typeof device.lat === 'number' ? device.lat : Number(device.lat);
              const lng = typeof device.lng === 'number' ? device.lng : Number(device.lng);
              
              // Find matching hotspot for this device
              const deviceHotspot = hotspots.find((h) => h.deviceId === device.id);
              
            return (
              <AdvancedMarker
                key={device.id}
                  position={{ lat, lng }}
                  onClick={async () => {
                    // Set hotspot data if available
                    if (deviceHotspot) {
                      setSelectedHotspot(deviceHotspot);
                    }
                    // Fetch full device details when clicked
                    try {
                      const fullDevice = await apiClient.getDevice(device.id);
                      setSelectedDevice(fullDevice);
                    } catch (err) {
                      console.error('Failed to fetch device details:', err);
                      // Fallback to marker data if detail fetch fails
                      setSelectedDevice(device as any);
                    }
                  }}
              >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: colors.bg,
                      border: `3px solid ${colors.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <IconComponent
                      size={20}
                      color={colors.icon}
                      strokeWidth={2.5}
                />
                  </div>
              </AdvancedMarker>
            );
          })}
        </Map>
      </APIProvider>

      {/* Loading State */}
      {loading && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 shadow-lg">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 animate-pulse text-blue-500" />
            <span className="text-sm text-zinc-300">Loading devices...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 shadow-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Map Legend */}
      <div className="absolute bottom-6 right-6 glass rounded-xl p-4 shadow-2xl border border-white/20 dark:border-white/10 min-w-[220px]">
        <h3 className="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Map Legend
        </h3>
        
        {/* Device Types */}
        {showCameras && (
          <div className="mb-4">
            <div className="text-xs font-medium text-zinc-400 mb-2">Device Types</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-blue-600" />
                <span className="text-xs text-zinc-300">Cameras</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-green-600" />
                <span className="text-xs text-zinc-300">Drones</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-amber-500 border-2 border-amber-600" />
                <span className="text-xs text-zinc-300">Sensors</span>
              </div>
            </div>
          </div>
        )}

        {/* Hotspot Severity */}
        {showHotspots && (
          <div className="mb-4">
            <div className="text-xs font-medium text-zinc-400 mb-2">Hotspot Severity</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-red-600" />
                <span className="text-xs text-zinc-300">Red - Critical</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-orange-500 border-2 border-orange-600" />
                <span className="text-xs text-zinc-300">Orange - High</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-yellow-500 border-2 border-yellow-600" />
                <span className="text-xs text-zinc-300">Yellow - Medium</span>
              </div>
          <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-green-600" />
                <span className="text-xs text-zinc-300">Green - Low</span>
              </div>
            </div>
          </div>
        )}

        {/* Heatmap Info */}
        {showHotspots && (
          <div className="border-t border-white/10 dark:border-white/5 pt-3">
            <div className="text-xs font-medium text-zinc-400 mb-2">Heatmap</div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-full h-3 rounded-full bg-gradient-to-r from-blue-500 via-yellow-500 via-orange-500 to-red-600" />
            </div>
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Low</span>
              <span>High</span>
            </div>
            <p className="text-xs text-zinc-400 mt-2">
              Intensity indicates crowd density
            </p>
        </div>
      )}

        {/* Stats */}
        <div className="border-t border-white/10 dark:border-white/5 pt-3 mt-3">
          {showCameras && (
            <div className="text-xs text-zinc-400 mb-1">
              <span className="font-medium">{filteredDevices.length}</span> {filteredDevices.length === 1 ? 'Device' : 'Devices'}
            </div>
          )}
          {showHotspots && heatmapData.length > 0 && (
            <div className="text-xs text-zinc-400">
              <span className="font-medium">{heatmapData.length}</span> {heatmapData.length === 1 ? 'Hotspot' : 'Hotspots'}
            </div>
          )}
        </div>
      </div>

      {/* Hotspot Info Overlay (keep for hotspots) */}
      {selectedHotspot && !selectedDevice && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 glass rounded-2xl p-5 shadow-2xl min-w-[350px] max-w-[400px] border border-white/20 dark:border-white/10">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${
                selectedHotspot.type === 'CAMERA' ? 'bg-blue-500/10' :
                selectedHotspot.type === 'DRONE' ? 'bg-green-500/10' :
                'bg-amber-500/10'
              }`}>
                {(() => {
                  const IconComponent = getDeviceIcon(selectedHotspot as any);
                  return (
                    <IconComponent className={`w-5 h-5 ${
                      selectedHotspot.type === 'CAMERA' ? 'text-blue-500' :
                      selectedHotspot.type === 'DRONE' ? 'text-green-500' :
                      'text-amber-500'
                    }`} />
                  );
                })()}
              </div>
              <div>
                <h3 className="font-semibold text-zinc-100">
                  {selectedHotspot.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {selectedHotspot.type} • ID: {selectedHotspot.deviceId.slice(0, 8)}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedHotspot(null);
              }}
            >
              ✕
            </Button>
          </div>
          
          <div className="space-y-2">
            <div className="py-2 border-t border-white/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-zinc-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Hotspot Severity
                </span>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  selectedHotspot.hotspotSeverity === 'RED' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                  selectedHotspot.hotspotSeverity === 'ORANGE' ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' :
                  selectedHotspot.hotspotSeverity === 'YELLOW' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                  'bg-green-500/20 text-green-600 dark:text-green-400'
                }`}>
                  {selectedHotspot.hotspotSeverity}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {selectedHotspot.peopleCount !== null && (
                  <div className="bg-zinc-800 rounded-lg p-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Users className="w-3.5 h-3.5 text-zinc-500" />
                      <span className="text-xs text-zinc-400">People</span>
                    </div>
                    <span className="text-lg font-bold text-zinc-100">
                      {selectedHotspot.peopleCount}
                    </span>
                  </div>
                )}
                <div className="bg-zinc-800 rounded-lg p-2">
                  <div className="text-xs text-zinc-400 mb-1">Density</div>
                  <span className="text-lg font-bold text-zinc-100">
                    {selectedHotspot.densityLevel}
                  </span>
                </div>
                {selectedHotspot.congestionLevel !== null && (
                  <div className="bg-zinc-800 rounded-lg p-2">
                    <div className="text-xs text-zinc-400 mb-1">Congestion</div>
                    <span className="text-lg font-bold text-zinc-100">
                      {selectedHotspot.congestionLevel}/10
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Device Sidebar */}
      {selectedDevice && (
        <DeviceSidebar
          device={selectedDevice}
          onClose={() => setSelectedDevice(null)}
        />
      )}
      </div>
    </div>
  );
}

