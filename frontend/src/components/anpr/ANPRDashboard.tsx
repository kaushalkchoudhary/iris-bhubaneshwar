import { useState, useEffect } from 'react';
import { apiClient, type Vehicle, type VehicleType } from '@/lib/api';
import { Search, Filter, Loader2, Car, Eye, X } from 'lucide-react';
import { HudBadge } from '@/components/ui/hud-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { VehicleDetail } from './VehicleDetail';
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

const WATCHLIST_REASONS = [
  'Stolen Vehicle',
  'Crime Involved',
  'Suspicious Activity',
  'Wanted Person',
  'Traffic Violation History',
  'Other',
];

export function ANPRDashboard() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    vehicleType: '' as VehicleType | '',
  });
  const [offset, setOffset] = useState(0);
  const [showAddWatchlistDialog, setShowAddWatchlistDialog] = useState(false);
  const [watchlistPlate, setWatchlistPlate] = useState('');
  const [watchlistReason, setWatchlistReason] = useState('');

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.getVehicles({
        plateNumber: searchQuery || undefined,
        vehicleType: filters.vehicleType || undefined,
        limit: PAGE_SIZE,
        offset: offset,
        orderBy: 'last_seen',
        orderDir: 'desc',
      });
      setVehicles(result.vehicles);
      setTotal(result.total);
    } catch (err) {
      console.error('Failed to fetch vehicles:', err);
      setError('Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchVehicles();
    }, 400);
    return () => clearTimeout(timeout);
  }, [filters, searchQuery]);

  const getVehicleTypeVariant = (type: VehicleType): "info" | "success" | "warning" | "danger" | "default" | "secondary" => {
    const variants: Record<VehicleType, "info" | "success" | "warning" | "danger" | "default" | "secondary"> = {
      '2W': 'info',
      '4W': 'success',
      'AUTO': 'warning',
      'TRUCK': 'danger',
      'BUS': 'default',
      'UNKNOWN': 'secondary',
    };
    return variants[type] || 'secondary';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleAddToWatchlist = async () => {
    if (!watchlistPlate.trim() || !watchlistReason.trim()) {
      alert('Please provide plate number and reason');
      return;
    }

    try {
      await apiClient.createWatchlistByPlate({
        plateNumber: watchlistPlate.trim().toUpperCase(),
        reason: watchlistReason,
        addedBy: 'user', // TODO: Get from auth context
        alertOnDetection: true,
        alertOnViolation: true,
      });
      setShowAddWatchlistDialog(false);
      setWatchlistPlate('');
      setWatchlistReason('');
      fetchVehicles(); // Refresh to show updated watchlist status
    } catch (err: any) {
      console.error('Failed to add to watchlist:', err);
      alert(err.message || 'Failed to add to watchlist');
    }
  };

  if (loading && vehicles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full w-full relative">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-zinc-400">Loading vehicles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col lg:flex-row gap-3 p-3 relative text-white overflow-hidden">
      {/* Left Panel - Search and List */}
      <div className="w-full lg:w-96 flex-shrink-0 flex flex-col min-h-0 h-full">
        <Card className="border border-white/5 bg-zinc-900/30 rounded-xl p-3 flex flex-col min-h-0 h-full">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h2 className="text-xl font-semibold">ANPR System</h2>
            <HudBadge variant="secondary">{total} Vehicles</HudBadge>
          </div>

          {/* Search */}
          <div className="relative mb-4 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input
              placeholder="Search by plate number..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setOffset(0);
              }}
              className="pl-10"
            />
          </div>

          {/* Filters - Single row of types */}
          <div className="mb-4 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="w-4 h-4 text-zinc-500" />
              <span className="text-sm font-medium">Vehicle Type</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={filters.vehicleType === '' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setFilters({ vehicleType: '' });
                  setOffset(0);
                }}
                className="h-8"
              >
                All
              </Button>
              <Button
                variant={filters.vehicleType === '2W' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilters({ vehicleType: '2W' })}
                className="h-8"
              >
                2W
              </Button>
              <Button
                variant={filters.vehicleType === '4W' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setFilters({ vehicleType: '4W' });
                  setOffset(0);
                }}
                className="h-8"
              >
                4W
              </Button>
              <Button
                variant={filters.vehicleType === 'AUTO' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setFilters({ vehicleType: 'AUTO' });
                  setOffset(0);
                }}
                className="h-8"
              >
                Auto
              </Button>
              <Button
                variant={filters.vehicleType === 'TRUCK' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setFilters({ vehicleType: 'TRUCK' });
                  setOffset(0);
                }}
                className="h-8"
              >
                Truck
              </Button>
              <Button
                variant={filters.vehicleType === 'BUS' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setFilters({ vehicleType: 'BUS' });
                  setOffset(0);
                }}
                className="h-8"
              >
                Bus
              </Button>
            </div>
          </div>

          {/* Vehicle List */}
          <div className={cn(
            "flex-1 overflow-y-auto pr-1 min-h-0",
            selectedVehicle ? "space-y-2" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 auto-rows-max"
          )}>
            {vehicles.map((vehicle) => (
              <Card
                key={vehicle.id}
                className={cn(
                  "border border-white/5 bg-zinc-900/30 hover:bg-zinc-900/50 rounded-xl p-3 cursor-pointer transition-all",
                  selectedVehicle?.id === vehicle.id && "ring-2 ring-blue-500"
                )}
                onClick={() => setSelectedVehicle(vehicle)}
              >
                {(() => {
                  return (
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm font-mono text-white">
                            {vehicle.plateNumber || 'UNKNOWN'}
                          </span>
                          {vehicle.isWatchlisted && (
                            <Eye className="w-4 h-4 text-yellow-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          {vehicle.make && vehicle.model && (
                            <span className="text-xs text-zinc-400">
                              {vehicle.make} {vehicle.model}
                            </span>
                          )}
                          <HudBadge variant={getVehicleTypeVariant(vehicle.vehicleType)}>
                            {vehicle.vehicleType}
                          </HudBadge>
                        </div>
                        <div className="text-xs text-zinc-400">
                          {vehicle.detectionCount} detections • Last seen {formatDate(vehicle.lastSeen)}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </Card>
            ))}
            {vehicles.length === 0 && !loading && (
              <Empty>
                <EmptyIcon><Car /></EmptyIcon>
                <EmptyTitle>No vehicles found</EmptyTitle>
                <EmptyDescription>No vehicles match the current search or filters.</EmptyDescription>
              </Empty>
            )}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-zinc-500">
                {Math.min(offset + 1, total)}-{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="h-8 px-2"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="h-8 px-2"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Right Panel - Detail View */}
      <div className="flex-1 min-w-0">
        {selectedVehicle ? (
          <VehicleDetail
            vehicle={selectedVehicle}
            onClose={() => setSelectedVehicle(null)}
            onUpdate={fetchVehicles}
          />
        ) : (
          <Card className="border border-white/5 bg-zinc-900/20 rounded-xl h-full hidden lg:flex items-center justify-center">
            <div className="text-center text-zinc-400">
              <Car className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Select a vehicle to view details</p>
            </div>
          </Card>
        )}
      </div>

      {/* Add to Watchlist Dialog */}
      {showAddWatchlistDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <Card className="border border-white/5 bg-zinc-900/50 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Add to Watchlist</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddWatchlistDialog(false);
                  setWatchlistPlate('');
                  setWatchlistReason('');
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Plate Number *</label>
                <Input
                  value={watchlistPlate}
                  onChange={(e) => setWatchlistPlate(e.target.value.toUpperCase())}
                  placeholder="KA01AB1234"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Reason *</label>
                <select
                  value={watchlistReason}
                  onChange={(e) => setWatchlistReason(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a reason...</option>
                  {WATCHLIST_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddWatchlistDialog(false);
                    setWatchlistPlate('');
                    setWatchlistReason('');
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddToWatchlist}>
                  Add
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
