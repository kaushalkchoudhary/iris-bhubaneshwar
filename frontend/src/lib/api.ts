// API Client - Updated 2025-12-26
// Use relative path for API calls - Vite will proxy /api to backend
import { getCsrfToken } from './csrf';

const API_BASE_URL = '';

const WASENDER_API_URL = import.meta.env.VITE_WASENDER_API_URL ?? '/wasender/api/send-message';
const WASENDER_API_KEY = import.meta.env.VITE_WASENDER_API_KEY ?? '';
const OSINT_API_TOKEN = import.meta.env.VITE_OSINT_API_TOKEN ?? '';

export async function sendWhatsAppNotification(violation: TrafficViolation, ownerPhone?: string) {
  const plate = violation.plateNumber || 'UNKNOWN';
  const vType = violation.violationType.replace(/_/g, ' ');
  const date = new Date(violation.timestamp).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const fine = violation.fineAmount ? `₹${violation.fineAmount}` : 'As per MV Act';

  const violatorMsg = `⚠️ *MANGALORE CITY TRAFFIC POLICE* ⚠️
━━━━━━━━━━━━━━━━━━━━━━
*TRAFFIC VIOLATION NOTICE*
━━━━━━━━━━━━━━━━━━━━━━

*Ref No:* MNG/TV/${violation.id}
*Date:* ${date}
*Vehicle No:* ${plate}
*Violation:* ${vType}
*Fine Amount:* ${fine}
*Detection:* AI-Based Surveillance System

Dear Vehicle Owner,

A traffic violation has been recorded and verified against your vehicle *${plate}* by the Mangalore City Traffic Police AI Surveillance System.

You are hereby directed to pay the penalty amount at the nearest traffic police station or online within *15 days* from the date of this notice.

Failure to pay the fine may result in further legal action under the Motor Vehicles Act, 1988.

📍 *Office of the Commissioner of Police*
Mangalore City, Karnataka

📞 Helpline: 0824-2220500
🌐 Online Payment: https://ksp.karnataka.gov.in

_This is a system-generated message. Do not reply._
━━━━━━━━━━━━━━━━━━━━━━`;

  const sendMsg = (to: string, text: string) => {
    if (!WASENDER_API_KEY) {
      console.error('Missing VITE_WASENDER_API_KEY. WhatsApp notifications are disabled.');
      return Promise.resolve();
    }

    return fetch(WASENDER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WASENDER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, text }),
    }).catch((err) => console.error(`WhatsApp send error (${to}):`, err));
  };

  const ownerNumber = ownerPhone ? `+91${ownerPhone}` : '+917218289793';

  await Promise.all([
    sendMsg(ownerNumber, violatorMsg),
    sendMsg('+919448008639', violatorMsg),
    sendMsg('+918097476656', violatorMsg),
  ]);
}

// Re-export worker types from separate file
export type {
  WorkerStatus,
  Worker,
  WorkerWithCounts,
  WorkerPingStatus,
  WorkerLiveStat,
  WorkerResources,
  JetsonFleetStatus,
  WorkerToken,
  WorkerTokenWithStatus,
  WorkerApprovalRequest,
  WorkerCameraAssignment,
  CameraAssignment
} from './worker-types';

export type DeviceType = 'CAMERA' | 'DRONE' | 'SENSOR' | 'MAGICBOX';
export type DeviceStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'active' | 'inactive' | 'maintenance';

// Full device interface (for detail views)
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  lat: number;
  lng: number;
  status: DeviceStatus;
  zoneId?: string;
  rtspUrl?: string | null;
  metadata?: Record<string, any>;
  config?: Record<string, any>;
  events?: any[];
  workerId?: string | null;
  parentDeviceId?: string | null;
  lastSeen?: string | null;
  cameraStatus?: string | null;
  isOnline?: boolean;
  uptimePercent?: number | null;
  createdAt: string;
  updatedAt: string;
  latestEvent?: {
    id: string;
    eventType: string;
    data: Record<string, any>;
    timestamp: string;
  };
}

export interface DeviceHeartbeatPoint {
  timestamp: string;
  cameraStatus: string;
  metadata?: Record<string, unknown>;
}

// Minimal device interface for map view (reduces payload size)
export interface DeviceMapMarker {
  id: string;
  name: string;
  type: DeviceType;
  lat: number;
  lng: number;
  status: DeviceStatus;
}

// Hotspot interface for crowd visualization
export interface Hotspot {
  deviceId: string;
  name: string;
  lat: number;
  lng: number;
  type: DeviceType;
  status: DeviceStatus;
  zoneId?: string;
  hotspotSeverity: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  peopleCount: number | null;
  densityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  congestionLevel: number | null;
  lastUpdated: string | null;
}

// Crowd Analysis interface
export interface CrowdAnalysis {
  id: string;
  deviceId: string;
  timestamp: string;
  peopleCount: number | null;
  cumulativeCount?: number | null;
  crowdLevel: number; // 0-100 percentage relative to min/max in response
  densityValue: number | null;
  densityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  movementType: 'STATIC' | 'MOVING' | 'FLOWING' | 'CHAOTIC';
  flowRate: number | null;
  velocity: number | null;
  freeSpace: number | null;
  congestionLevel: number | null;
  occupancyRate: number | null;
  hotspotSeverity: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  hotspotZones?: Array<{ x: number; y: number; radius: number; severity: string }>;
  maxDensityPoint?: { x: number; y: number; density: number };
  demographics?: {
    gender?: { male: number; female: number };
    ageGroups?: { adults: number; seniors: number; children: number };
  };
  behavior?: string | null;
  anomalies?: string[];
  heatmapData?: any;
  heatmapImageUrl?: string | null;
  frameId?: string | null;
  frameUrl?: string | null;
  modelType?: string | null;
  confidence?: number | null;
  device: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    type: DeviceType;
  };
}

export interface CrowdAlert {
  id: string;
  deviceId: string;
  alertType: string;
  severity: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  priority: number;
  peopleCount: number | null;
  densityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  congestionLevel: number | null;
  title: string;
  description: string | null;
  isResolved: boolean;
  timestamp: string;
  frameSnapshot?: string | null;
  device: { id: string; name: string; lat: number; lng: number; type: string };
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface FRSDistributedPlanCamera {
  device_id: string;
  name: string;
  assigned_worker_id?: string;
  assigned_analytics?: string[];
}

export interface FRSDistributedPlanResponse {
  cameras?: FRSDistributedPlanCamera[];
}

// Import worker types for use in ApiClient methods
import type {
  WorkerStatus,
  Worker,
  WorkerWithCounts,
  WorkerPingStatus,
  WorkerLiveStat,
  JetsonFleetStatus,
  WorkerToken,
  WorkerTokenWithStatus,
  WorkerApprovalRequest,
  WorkerCameraAssignment,
  CameraAssignment
} from './worker-types';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const token = localStorage.getItem('iris_token');
    const method = String(options?.method ?? 'GET').toUpperCase();
    const isUnsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
    const baseHeaders: HeadersInit = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    };

    const headers: HeadersInit = { ...baseHeaders };
    if (token) {
      // @ts-ignore - HeadersInit type is complex, but this is valid
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (isUnsafeMethod) {
      const csrf = await getCsrfToken();
      if (csrf) {
        // @ts-ignore - HeadersInit type is complex, but this is valid
        headers['X-CSRF-Token'] = csrf;
      }
    }

    let response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
      cache: options?.cache ?? 'no-store',
      credentials: 'same-origin',
    });

    // Retry once on CSRF mismatch/expiry for unsafe methods.
    if (isUnsafeMethod && response.status === 403) {
      const fresh = await getCsrfToken(true);
      if (fresh) {
        const retryHeaders: HeadersInit = { ...baseHeaders };
        if (token) {
          // @ts-ignore - HeadersInit type is complex, but this is valid
          retryHeaders['Authorization'] = `Bearer ${token}`;
        }
        // @ts-ignore - HeadersInit type is complex, but this is valid
        retryHeaders['X-CSRF-Token'] = fresh;
        response = await fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          headers: retryHeaders,
          cache: options?.cache ?? 'no-store',
          credentials: 'same-origin',
        });
      }
    }

    if (!response.ok) {
      // Prefer server-provided error message when available.
      let msg = `API Error: ${response.status} ${response.statusText}`;
      const ct = response.headers.get('content-type') || '';
      try {
        if (ct.includes('application/json')) {
          const data = await response.json();
          if (data?.error) msg = String(data.error);
        } else {
          const text = await response.text();
          if (text) msg = text.slice(0, 300);
        }
      } catch {
        // ignore parse errors
      }
      throw new Error(msg);
    }

    return response.json();
  }

  // Device endpoints
  async getDevices(options?: {
    type?: DeviceType;
    minimal?: boolean; // Return only essential fields for map view
  }): Promise<Device[] | DeviceMapMarker[]> {
    const params = new URLSearchParams();
    if (options?.type) {
      params.append('type', options.type);
    }
    if (options?.minimal) {
      params.append('minimal', 'true');
    }
    const query = params.toString();
    return this.request<Device[] | DeviceMapMarker[]>(
      `/api/devices${query ? `?${query}` : ''}`
    );
  }

  // Get devices by type (optimized for map view)
  async getDevicesByType(type: DeviceType): Promise<DeviceMapMarker[]> {
    return this.getDevices({ type, minimal: true }) as Promise<DeviceMapMarker[]>;
  }

  // Get all devices for map (fetches by type in parallel)
  async getDevicesForMap(): Promise<DeviceMapMarker[]> {
    const [cameras, drones, sensors] = await Promise.all([
      this.getDevicesByType('CAMERA'),
      this.getDevicesByType('DRONE'),
      this.getDevicesByType('SENSOR'),
    ]);
    return [...cameras, ...drones, ...sensors];
  }

  async getDevice(id: string): Promise<Device> {
    return this.request<Device>(`/api/devices/by-id?deviceId=${encodeURIComponent(id)}`);
  }

  async getDeviceCameras(deviceId: string): Promise<Device[]> {
    return this.request<Device[]>(`/api/devices/cameras?deviceId=${encodeURIComponent(deviceId)}`);
  }

  async getDeviceHeartbeats(
    deviceId: string,
    params?: { last?: '24h' | '7d'; from?: string; to?: string }
  ): Promise<DeviceHeartbeatPoint[]> {
    const p = new URLSearchParams();
    p.set('deviceId', deviceId);
    if (params?.from && params?.to) {
      p.set('from', params.from);
      p.set('to', params.to);
    } else {
      p.set('last', params?.last ?? '24h');
    }
    return this.request<DeviceHeartbeatPoint[]>(`/api/devices/heartbeats?${p}`);
  }

  async createDevice(device: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>): Promise<Device> {
    return this.request<Device>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(device),
    });
  }

  async updateDevice(id: string, updates: Partial<Device>): Promise<Device> {
    return this.request<Device>(`/api/devices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteDevice(id: string): Promise<void> {
    return this.request<void>(`/api/devices/by-id?deviceId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Crowd endpoints
  async getHotspots(): Promise<Hotspot[]> {
    return this.request<Hotspot[]>('/api/crowd/hotspots');
  }

  async getCrowdAnalysis(options?: {
    deviceId?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    severity?: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  }): Promise<CrowdAnalysis[]> {
    const params = new URLSearchParams();
    if (options?.deviceId) {
      params.append('deviceId', options.deviceId);
    }
    if (options?.startTime) {
      params.append('startTime', options.startTime);
    }
    if (options?.endTime) {
      params.append('endTime', options.endTime);
    }
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options?.severity) {
      params.append('severity', options.severity);
    }
    const query = params.toString();
    return this.request<CrowdAnalysis[]>(`/api/crowd/analysis${query ? `?${query}` : ''}`);
  }

  async getLatestCrowdAnalysis(deviceIds?: string[]): Promise<CrowdAnalysis[]> {
    const params = new URLSearchParams();
    if (deviceIds && deviceIds.length > 0) {
      params.append('deviceIds', deviceIds.join(','));
    }
    const query = params.toString();
    return this.request<CrowdAnalysis[]>(`/api/crowd/analysis/latest${query ? `?${query}` : ''}`);
  }

  async getCrowdAlerts(options?: {
    isResolved?: boolean;
    severity?: string;
    limit?: number;
  }): Promise<CrowdAlert[]> {
    const params = new URLSearchParams();
    if (options?.isResolved !== undefined) params.append('isResolved', options.isResolved.toString());
    if (options?.severity) params.append('severity', options.severity);
    if (options?.limit) params.append('limit', options.limit.toString());
    const query = params.toString();
    return this.request<CrowdAlert[]>(`/api/crowd/alerts${query ? `?${query}` : ''}`);
  }

  async resolveCrowdAlert(id: string, data?: { resolvedBy?: string; resolutionNote?: string }): Promise<void> {
    return this.request<void>(`/api/crowd/alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify(data || {}),
    });
  }

  async getAllLiveFrames(): Promise<Record<string, string>> {
    return this.request<Record<string, string>>('/api/crowd/live-frames');
  }

  // FRS (Face Recognition System) endpoints
  async getPersons(): Promise<Person[]> {
    return this.request<Person[]>('/api/frs/persons');
  }

  async createPerson(formData: FormData): Promise<Person> {
    return this.request<Person>('/api/frs/persons', {
      method: 'POST',
      body: formData,
      // No Content-Type header needed for FormData; the browser sets it with the boundary
    });
  }

  async updatePerson(id: string, formData: FormData): Promise<Person> {
    return this.request<Person>(`/api/frs/persons/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: formData,
    });
  }

  async deletePerson(id: string): Promise<void> {
    return this.request<void>(`/api/frs/persons/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async addPersonEmbeddings(id: string, formData: FormData): Promise<{ person: Person; newEmbeddingsCount: number; totalEmbeddings: number }> {
    return this.request<{ person: Person; newEmbeddingsCount: number; totalEmbeddings: number }>(
      `/api/frs/persons/${encodeURIComponent(id)}/embeddings`,
      {
        method: 'POST',
        body: formData,
      }
    );
  }

  async getFRSDetections(options?: {
    limit?: number;
    personId?: string;
    deviceId?: string;
    globalIdentityId?: string;
    startTime?: string;
    endTime?: string;
    unknown?: boolean;
  }): Promise<FRSMatch[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.personId) params.append('personId', options.personId);
    if (options?.deviceId) params.append('deviceId', options.deviceId);
    if (options?.globalIdentityId) params.append('globalIdentityId', options.globalIdentityId);
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.unknown !== undefined) params.append('unknown', options.unknown.toString());
    const query = params.toString();
    return this.request<FRSMatch[]>(`/api/frs/detections${query ? `?${query}` : ''}`);
  }

  async getFRSStats(options?: { startTime?: string; endTime?: string }): Promise<FRSStats> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    const query = params.toString();
    return this.request<FRSStats>(`/api/frs/stats${query ? `?${query}` : ''}`);
  }

  async getFRSTimeline(options?: { startTime?: string; endTime?: string; granularity?: 'day' | 'hour' }): Promise<FRSTimelineBucket[]> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.granularity) params.append('granularity', options.granularity);
    const query = params.toString();
    return this.request<FRSTimelineBucket[]>(`/api/frs/timeline${query ? `?${query}` : ''}`);
  }

  async generateFRSReport(params: URLSearchParams): Promise<Blob> {
    const token = localStorage.getItem('iris_token');
    const headers: HeadersInit = {
      'Accept': 'application/pdf',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/frs/report?${params.toString()}`, {
      method: 'GET',
      headers,
      credentials: 'same-origin',
    });

    if (!response.ok) {
      let msg = `Report Error: ${response.status} ${response.statusText}`;
      try {
        const data = await response.json();
        if (data?.error) msg = String(data.error);
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    return response.blob();
  }

  async getFRSGlobalIdentities(options?: {
    limit?: number;
    known?: boolean;
    riskLevel?: string;
    since?: string;
  }): Promise<FRSGlobalIdentity[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.known !== undefined) params.append('known', String(options.known));
    if (options?.riskLevel) params.append('riskLevel', options.riskLevel);
    if (options?.since) params.append('since', options.since);
    const query = params.toString();
    return this.request<FRSGlobalIdentity[]>(`/api/frs/global-identities${query ? `?${query}` : ''}`);
  }

  async getFRSGlobalIdentityDetections(globalIdentityId: string, limit = 200): Promise<FRSMatch[]> {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    return this.request<FRSMatch[]>(
      `/api/frs/global-identities/${encodeURIComponent(globalIdentityId)}/detections?${params.toString()}`
    );
  }

  // Event endpoints
  async ingestEvent(event: {
    deviceId: string;
    eventType: string;
    data: Record<string, any>;
    timestamp?: string;
  }): Promise<void> {
    return this.request<void>('/api/ingest', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  // Violation endpoints (ITMS)
  async getViolations(options?: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FINED';
    violationType?: 'SPEED' | 'HELMET' | 'WRONG_SIDE' | 'RED_LIGHT' | 'NO_SEATBELT' | 'OVERLOADING' | 'ILLEGAL_PARKING' | 'TRIPLE_RIDING' | 'WRONG_LANE' | 'OTHER';
    deviceId?: string;
    plateNumber?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ violations: TrafficViolation[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    if (options?.status) params.append('status', options.status);
    if (options?.violationType) {
      // Transform NO_SEATBELT to NO SEATBELT for API filter parameter
      const violationType = options.violationType === 'NO_SEATBELT' ? 'NO SEATBELT' : options.violationType;
      params.append('violationType', violationType);
    }
    if (options?.deviceId) params.append('deviceId', options.deviceId);
    if (options?.plateNumber) params.append('plateNumber', options.plateNumber);
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    const query = params.toString();
    return this.request<{ violations: TrafficViolation[]; total: number; limit: number; offset: number }>(
      `/api/violations${query ? `?${query}` : ''}`
    );
  }

  async getViolation(id: string): Promise<TrafficViolation> {
    return this.request<TrafficViolation>(`/api/violations/${id}`);
  }

  async approveViolation(id: string, data?: { reviewNote?: string; reviewedBy?: string }): Promise<TrafficViolation> {
    return this.request<TrafficViolation>(`/api/violations/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify(data || {}),
    });
  }

  async rejectViolation(id: string, data: { rejectionReason: string; reviewedBy?: string }): Promise<TrafficViolation> {
    return this.request<TrafficViolation>(`/api/violations/${id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async fetchRCDetails(rcNumber: string): Promise<RCDetails | null> {
    try {
      if (!OSINT_API_TOKEN) {
        console.error('Missing VITE_OSINT_API_TOKEN. RC details lookup is disabled.');
        return null;
      }
      const res = await fetch('https://iris.wiredleap.com/api/osint/rc-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OSINT_API_TOKEN}`,
        },
        body: JSON.stringify({
          rc_number: rcNumber.replace(/[\s-]/g, ''),
          org: 'CCPS division',
          firNo: `FIR/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`,
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.data) {
        return json.data.data as RCDetails;
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch RC details:', err);
      return null;
    }
  }

  async fetchRCToMobile(rcNumber: string): Promise<string | null> {
    try {
      if (!OSINT_API_TOKEN) {
        console.error('Missing VITE_OSINT_API_TOKEN. RC mobile lookup is disabled.');
        return null;
      }
      const res = await fetch('https://iris.wiredleap.com/api/osint/rc-to-mobile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OSINT_API_TOKEN}`,
        },
        body: JSON.stringify({
          rc_number: rcNumber.replace(/[\s-]/g, ''),
          org: 'CCPS division',
          firNo: `FIR/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`,
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.mobile_number) {
        return json.data.mobile_number as string;
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch RC to mobile:', err);
      return null;
    }
  }

  async updateViolationPlate(id: string, plateNumber: string): Promise<TrafficViolation> {
    return this.request<TrafficViolation>(`/api/violations/${id}/plate`, {
      method: 'PATCH',
      body: JSON.stringify({ plateNumber }),
    });
  }

  async getViolationStats(options?: {
    startTime?: string;
    endTime?: string;
  }): Promise<ViolationStats> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    const query = params.toString();
    return this.request<ViolationStats>(`/api/violations/stats${query ? `?${query}` : ''}`);
  }

  // Vehicle endpoints (ANPR/VCC)
  async detectVehicle(detection: {
    deviceId: string;
    plateNumber?: string;
    plateConfidence?: number;
    make?: string;
    model?: string;
    vehicleType: VehicleType;
    color?: string;
    confidence?: number;
    fullImageUrl?: string;
    plateImageUrl?: string;
    vehicleImageUrl?: string;
    frameId?: string;
    direction?: string;
    lane?: number;
    metadata?: any;
    timestamp?: string;
  }): Promise<{ success: boolean; detectionId: string; vehicleId?: string }> {
    return this.request<{ success: boolean; detectionId: string; vehicleId?: string }>('/api/vehicles/detect', {
      method: 'POST',
      body: JSON.stringify(detection),
    });
  }

  async getVehicles(options?: {
    plateNumber?: string;
    vehicleType?: VehicleType;
    make?: string;
    model?: string;
    color?: string;
    watchlisted?: boolean;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
  }): Promise<{ vehicles: Vehicle[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    if (options?.plateNumber) params.append('plateNumber', options.plateNumber);
    if (options?.vehicleType) params.append('vehicleType', options.vehicleType);
    if (options?.make) params.append('make', options.make);
    if (options?.model) params.append('model', options.model);
    if (options?.color) params.append('color', options.color);
    if (options?.watchlisted !== undefined) params.append('watchlisted', options.watchlisted.toString());
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    if (options?.orderBy) params.append('orderBy', options.orderBy);
    if (options?.orderDir) params.append('orderDir', options.orderDir);
    const query = params.toString();
    return this.request<{ vehicles: Vehicle[]; total: number; limit: number; offset: number }>(
      `/api/vehicles${query ? `?${query}` : ''}`
    );
  }

  async getVehicle(id: string): Promise<Vehicle> {
    return this.request<Vehicle>(`/api/vehicles/${id}`);
  }

  async updateVehicle(id: string, updates: {
    plateNumber?: string;
    make?: string;
    model?: string;
    vehicleType?: VehicleType;
    color?: string;
    metadata?: any;
  }): Promise<Vehicle> {
    return this.request<Vehicle>(`/api/vehicles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async getVehicleDetections(id: string, options?: {
    deviceId?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
  }): Promise<VehicleDetection[]> {
    const params = new URLSearchParams();
    if (options?.deviceId) params.append('deviceId', options.deviceId);
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.limit) params.append('limit', options.limit.toString());
    const query = params.toString();
    return this.request<VehicleDetection[]>(`/api/vehicles/${id}/detections${query ? `?${query}` : ''}`);
  }

  async getVehicleViolations(id: string, options?: {
    status?: ViolationStatus;
    limit?: number;
  }): Promise<TrafficViolation[]> {
    const params = new URLSearchParams();
    if (options?.status) params.append('status', options.status);
    if (options?.limit) params.append('limit', options.limit.toString());
    const query = params.toString();
    return this.request<TrafficViolation[]>(`/api/vehicles/${id}/violations${query ? `?${query}` : ''}`);
  }

  async addToWatchlist(id: string, data: {
    reason: string;
    addedBy: string;
    alertOnDetection?: boolean;
    alertOnViolation?: boolean;
    notes?: string;
  }): Promise<Watchlist> {
    return this.request<Watchlist>(`/api/vehicles/${id}/watchlist`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async removeFromWatchlist(id: string): Promise<void> {
    return this.request<void>(`/api/vehicles/${id}/watchlist`, {
      method: 'DELETE',
    });
  }

  async getWatchlist(): Promise<Watchlist[]> {
    return this.request<Watchlist[]>('/api/watchlist');
  }

  async createWatchlistByPlate(data: {
    plateNumber: string;
    reason: string;
    addedBy: string;
    alertOnDetection?: boolean;
    alertOnViolation?: boolean;
    notes?: string;
  }): Promise<Watchlist> {
    return this.request<Watchlist>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAlerts(options?: {
    isRead?: boolean;
    alertType?: 'DETECTION' | 'VIOLATION';
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ alerts: WatchlistAlert[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams();
    if (options?.isRead !== undefined) params.append('isRead', options.isRead.toString());
    if (options?.alertType) params.append('alertType', options.alertType);
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    const query = params.toString();
    return this.request<{ alerts: WatchlistAlert[]; total: number; limit: number; offset: number }>(`/api/alerts${query ? `?${query}` : ''}`);
  }

  async markAlertRead(id: string): Promise<void> {
    return this.request<void>(`/api/alerts/${id}/read`, {
      method: 'PATCH',
    });
  }

  async dismissAlert(id: string): Promise<void> {
    return this.request<void>(`/api/alerts/${id}`, {
      method: 'DELETE',
    });
  }

  async getAlertStats(): Promise<AlertStats> {
    return this.request<AlertStats>('/api/alerts/stats');
  }

  async getVehicleStats(): Promise<VehicleStats> {
    return this.request<VehicleStats>('/api/vehicles/stats');
  }

  // VCC (Vehicle Classification and Counting) endpoints
  async getVCCStats(options?: {
    startTime?: string;
    endTime?: string;
    groupBy?: 'hour' | 'day' | 'week' | 'month';
  }): Promise<VCCStats> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    if (options?.groupBy) params.append('groupBy', options.groupBy);
    const query = params.toString();
    return this.request<VCCStats>(`/api/vcc/stats${query ? `?${query}` : ''}`);
  }

  async getVCCByDevice(deviceId: string, options?: {
    startTime?: string;
    endTime?: string;
  }): Promise<VCCDeviceStats> {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime);
    if (options?.endTime) params.append('endTime', options.endTime);
    const query = params.toString();
    return this.request<VCCDeviceStats>(`/api/vcc/device/${deviceId}${query ? `?${query}` : ''}`);
  }

  async getVCCRealtime(): Promise<VCCRealtime> {
    return this.request<VCCRealtime>('/api/vcc/realtime');
  }

  // ==================== Worker Management ====================

  // Admin: Get all workers
  async getWorkers(status?: WorkerStatus): Promise<WorkerWithCounts[]> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    const query = params.toString();
    return this.request<WorkerWithCounts[]>(`/api/admin/workers${query ? `?${query}` : ''}`);
  }

  // Admin: Create a worker manually (no registration token needed)
  async createWorker(data: { name: string; ip?: string; mac?: string; model?: string }): Promise<Worker> {
    return this.request<Worker>('/api/admin/workers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Admin: Live stats - combined ping + resources in one call (replaces separate ping-status)
  async getWorkerLiveStats(): Promise<{
    workers: WorkerLiveStat[];
    summary: { total: number; online: number; offline: number };
    checkedAt: string;
  }> {
    return this.request<{
      workers: WorkerLiveStat[];
      summary: { total: number; online: number; offline: number };
      checkedAt: string;
    }>('/api/workers/live-stats');
  }

  async getWorkersPingStatus(): Promise<{
    workers: WorkerPingStatus[];
    summary: { total: number; online: number; offline: number };
  }> {
    return this.request<{
      workers: WorkerPingStatus[];
      summary: { total: number; online: number; offline: number };
    }>('/api/workers/ping-status');
  }

  async getJetsonFleetStatus(): Promise<{
    jetsons: JetsonFleetStatus[];
    summary: { total: number; connected: number; disconnected: number };
    configPath: string;
  }> {
    return this.request<{
      jetsons: JetsonFleetStatus[];
      summary: { total: number; connected: number; disconnected: number };
      configPath: string;
    }>('/api/workers/fleet-status');
  }

  // Admin: Get single worker
  async getWorker(id: string): Promise<Worker> {
    return this.request<Worker>(`/api/admin/workers/${id}`);
  }

  // Admin: Update worker
  async updateWorker(
    id: string,
    updates: {
      name?: string;
      ip?: string;
      mac?: string;
      model?: string;
      status?: WorkerStatus;
      tags?: string[];
    }
  ): Promise<Worker> {
    return this.request<Worker>(`/api/admin/workers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  // Admin: Revoke worker
  async revokeWorker(id: string): Promise<void> {
    return this.request<void>(`/api/admin/workers/${id}/revoke`, {
      method: 'POST',
    });
  }

  // Admin: Delete worker
  async deleteWorker(id: string): Promise<void> {
    return this.request<void>(`/api/admin/workers/${id}`, {
      method: 'DELETE',
    });
  }

  // Admin: Get pending approval requests
  async getApprovalRequests(status?: string): Promise<WorkerApprovalRequest[]> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    const query = params.toString();
    return this.request<WorkerApprovalRequest[]>(`/api/admin/workers/approval-requests${query ? `?${query}` : ''}`);
  }

  // Admin: Approve worker request
  async approveWorkerRequest(id: string): Promise<{ message: string; worker_id: string }> {
    return this.request<{ message: string; worker_id: string }>(`/api/admin/workers/approval-requests/${id}/approve`, {
      method: 'POST',
    });
  }

  // Admin: Reject worker request
  async rejectWorkerRequest(id: string, reason?: string): Promise<void> {
    return this.request<void>(`/api/admin/workers/approval-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Admin: Assign cameras to worker
  async assignCamerasToWorker(workerId: string, assignments: CameraAssignment[]): Promise<Worker> {
    return this.request<Worker>(`/api/admin/workers/${workerId}/cameras`, {
      method: 'POST',
      body: JSON.stringify({ assignments }),
    });
  }

  // Admin: Get worker cameras
  async getWorkerCameras(workerId: string): Promise<WorkerCameraAssignment[]> {
    return this.request<WorkerCameraAssignment[]>(`/api/admin/workers/${workerId}/cameras`);
  }

  async getFRSDistributedPlan(): Promise<FRSDistributedPlanResponse> {
    return this.request<FRSDistributedPlanResponse>('/api/frs/distributed/plan');
  }

  // Admin: Unassign camera from worker
  async unassignCameraFromWorker(workerId: string, deviceId: string): Promise<void> {
    return this.request<void>(`/api/admin/workers/${workerId}/cameras/${deviceId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Worker Tokens ====================

  // Admin: Create worker token
  async createWorkerToken(data: { name: string; expires_in?: number; created_by?: string }): Promise<WorkerToken> {
    return this.request<WorkerToken>('/api/admin/worker-tokens', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Admin: Get all tokens
  async getWorkerTokens(options?: { show_used?: boolean; show_revoked?: boolean }): Promise<WorkerTokenWithStatus[]> {
    const params = new URLSearchParams();
    if (options?.show_used) params.append('show_used', 'true');
    if (options?.show_revoked) params.append('show_revoked', 'true');
    const query = params.toString();
    return this.request<WorkerTokenWithStatus[]>(`/api/admin/worker-tokens${query ? `?${query}` : ''}`);
  }

  // Admin: Revoke token
  async revokeWorkerToken(id: string): Promise<void> {
    return this.request<void>(`/api/admin/worker-tokens/${id}/revoke`, {
      method: 'POST',
    });
  }

  // Admin: Delete token
  async deleteWorkerToken(id: string): Promise<void> {
    return this.request<void>(`/api/admin/worker-tokens/${id}`, {
      method: 'DELETE',
    });
  }

  // Admin: Bulk create tokens
  async bulkCreateWorkerTokens(data: { count: number; prefix?: string; expires_in?: number }): Promise<{ tokens: WorkerToken[] }> {
    return this.request<{ tokens: WorkerToken[] }>('/api/admin/worker-tokens/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==================== Admin: Operator Access ====================
  async getOperatorAccounts(): Promise<{ operators: any[]; pendingApprovals: number }> {
    return this.request<{ operators: any[]; pendingApprovals: number }>('/api/admin/auth/operators');
  }

  async unlockOperatorAccount(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/admin/auth/operators/${encodeURIComponent(id)}/unlock`, {
      method: 'POST',
    });
  }

  async resetOperatorPassword(id: string, password?: string): Promise<{ message: string; password: string }> {
    return this.request<{ message: string; password: string }>(`/api/admin/auth/operators/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  async approveOperatorAccess(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/admin/auth/operators/${encodeURIComponent(id)}/approve-access`, {
      method: 'POST',
    });
  }

  async getOperatorLoginEvents(limit = 200): Promise<{ events: any[] }> {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    return this.request<{ events: any[] }>(`/api/admin/auth/operators/logins?${q.toString()}`);
  }

  async getOperatorActivityEvents(id: string, limit = 200): Promise<{ events: any[] }> {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    return this.request<{ events: any[] }>(`/api/admin/auth/operators/${encodeURIComponent(id)}/activity?${q.toString()}`);
  }

  async forceLogoutOperatorAccount(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/api/admin/auth/operators/${encodeURIComponent(id)}/force-logout`, {
      method: 'POST',
    });
  }

  async operatorResetPassword(data: { email: string; tempPassword: string; newPassword: string }): Promise<{ message: string }> {
    return this.request<{ message: string }>('/api/auth/operator/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getGodsEyePrompts(): Promise<{ mode: string; classes: string[]; referImage: string; visualPrompts: unknown[]; updatedAt: string }> {
    return this.request('/api/gods-eye/prompts');
  }

  async setGodsEyePrompts(data: { mode: string; classes: string[]; referImage: string; visualPrompts: unknown[] }): Promise<{ ok: boolean }> {
    return this.request('/api/gods-eye/prompts', { method: 'PUT', body: JSON.stringify(data) });
  }

  async getGodsEyeDetections(): Promise<Record<string, { ts: number; track_id: number; class: string; confidence: number }[]>> {
    return this.request('/api/gods-eye/detections');
  }
}

export const apiClient = new ApiClient(API_BASE_URL);

// Violation Types
export type ViolationType = 'SPEED' | 'HELMET' | 'WRONG_SIDE' | 'RED_LIGHT' | 'NO_SEATBELT' | 'OVERLOADING' | 'ILLEGAL_PARKING' | 'TRIPLE_RIDING' | 'WRONG_LANE' | 'OTHER';
export type ViolationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FINED';
export type DetectionMethod = 'RADAR' | 'CAMERA' | 'AI_VISION' | 'MANUAL';

export interface TrafficViolation {
  id: string;
  deviceId: string;
  device?: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    type: DeviceType;
  };
  timestamp: string;
  violationType: ViolationType;
  status: ViolationStatus;
  detectionMethod: DetectionMethod;
  plateNumber?: string | null;
  plateConfidence?: number | null;
  plateImageUrl?: string | null;
  fullSnapshotUrl?: string | null;
  video?: string | null;
  frameId?: string | null;
  detectedSpeed?: number | null;
  speedLimit2W?: number | null;
  speedLimit4W?: number | null;
  speedOverLimit?: number | null;
  confidence?: number | null;
  metadata?: any;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  rejectionReason?: string | null;
  fineAmount?: number | null;
  fineIssuedAt?: string | null;
  fineReference?: string | null;
}

export interface RCDetails {
  rc_number: string;
  registration_date: string;
  owner_name: string;
  owner_number: string | null;
  maker_description: string;
  maker_model: string;
  body_type: string;
  color: string;
  fuel_type: string;
  vehicle_category: string;
  vehicle_category_description: string;
  vehicle_chasi_number: string;
  vehicle_engine_number: string | null;
  vehicle_class: string | null;
  vehicle_gross_weight: string;
  unladen_weight: string;
  fit_up_to: string;
  insurance_upto: string;
  pucc_upto: string | null;
  rc_status: string;
  norms_type: string;
  financed: boolean;
  blacklist_status: string;
  permit_number: string;
  permit_issue_date: string | null;
  permit_valid_from: string | null;
  national_permit_number: string;
  national_permit_upto: string | null;
}

export interface ViolationStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  fined: number;
  byType: Record<string, number>;
  byDevice: Record<string, number>;
  byHour?: Record<number, number>; // 0-23 hour distribution
  byTime?: Array<{ hour: number; count: number }>; // For trendline visualization
}

// Vehicle Types
export type VehicleType = '2W' | '4W' | 'AUTO' | 'TRUCK' | 'BUS' | 'UNKNOWN';

export interface Vehicle {
  id: string;
  plateNumber?: string | null;
  make?: string | null;
  model?: string | null;
  vehicleType: VehicleType;
  color?: string | null;
  firstSeen: string;
  lastSeen: string;
  detectionCount: number;
  isWatchlisted: boolean;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
  watchlist?: Watchlist;
  detections?: VehicleDetection[];
}

export interface VehicleDetection {
  id: string;
  vehicleId?: string | null;
  vehicle?: Vehicle;
  deviceId: string;
  device?: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    type: DeviceType;
  };
  timestamp: string;
  plateNumber?: string | null;
  plateConfidence?: number | null;
  make?: string | null;
  model?: string | null;
  vehicleType: VehicleType;
  color?: string | null;
  confidence?: number | null;
  plateDetected: boolean;
  makeModelDetected: boolean;
  fullImageUrl?: string | null;
  plateImageUrl?: string | null;
  vehicleImageUrl?: string | null;
  frameId?: string | null;
  direction?: string | null;
  lane?: number | null;
  metadata?: any;
}

export interface Watchlist {
  id: string;
  vehicleId: string;
  vehicle?: Vehicle;
  reason: string;
  addedBy: string;
  addedAt: string;
  isActive: boolean;
  alertOnDetection: boolean;
  alertOnViolation: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistAlert {
  id: string;
  watchlistId: string;
  watchlist?: Watchlist;
  vehicleId?: string;
  vehicle?: Vehicle;
  detectionId?: string;
  detection?: VehicleDetection;
  alertType: 'DETECTION' | 'VIOLATION';
  message: string;
  isRead: boolean;
  readAt?: string;
  deviceId: string;
  device?: Device;
  timestamp: string;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
  age: number;
  gender: string;
  status: string;
  height: string;
  aliases: string;
  category: string;
  threatLevel: string;
  notes: string;
  faceImageUrl: string;
  embedding: any;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface FRSMatch {
  id: number;
  globalIdentityId?: string;
  personId: string;
  person?: Person;
  globalIdentity?: FRSGlobalIdentity;
  deviceId: string;
  device?: Device;
  timestamp: string;
  confidence: number;
  matchScore: number;
  faceSnapshotUrl: string;
  fullSnapshotUrl: string;
  frameId: string;
  bbox: any;
  metadata?: any;
}

export interface FRSGlobalIdentity {
  globalIdentityId: string;
  firstSeenTimestamp: string;
  lastSeenTimestamp: string;
  associatedPersonId?: string;
  associatedPerson?: Person;
  clusterEmbeddingCentroid?: number[];
  riskLevel?: string;
  metadata?: any;
}

export interface AlertStats {
  total: number;
  unread: number;
  read: number;
  today: number;
  byType: Record<string, number>;
}

export interface FRSDeviceStat {
  deviceId: string;
  deviceName: string;
  count: number;
}

export interface FRSPersonStat {
  personId: string;
  personName: string;
  faceImageUrl: string;
  count: number;
  lastSeen: string;
  avgConfidence: number;
}

export interface FRSStats {
  totalDetections: number;
  knownDetections: number;
  unknownDetections: number;
  avgConfidence: number;
  byDevice: FRSDeviceStat[];
  byPerson: FRSPersonStat[];
}

export interface FRSTimelineBucket {
  period: string;
  total: number;
  known: number;
  unknown: number;
}

export interface VehicleStats {
  total: number;
  withPlates: number;
  withoutPlates: number;
  watchlisted: number;
  byType: Record<string, number>;
  byMake: Record<string, number>;
  detectionsToday: number;
}

// VCC (Vehicle Classification and Counting) Types
export interface VCCStats {
  totalDetections: number;
  uniqueVehicles: number;
  byVehicleType: Record<string, number>;
  byTime: Array<{ hour?: string; day?: string; week?: string; month?: string; count: number }>;
  byDevice: Array<{ deviceId: string; deviceName: string; count: number }>;
  byHour: Record<string, number>; // 0-23
  byDayOfWeek: Record<string, number>;
  peakHour: number;
  peakDay: string;
  averagePerHour: number;
  classification: {
    withPlates: number;
    withoutPlates: number;
    withMakeModel: number;
    plateOnly: number;
    fullClassification: number;
  };
}

export interface VCCDeviceStats {
  deviceId: string;
  deviceName: string;
  totalDetections: number;
  uniqueVehicles: number;
  byVehicleType: Record<string, number>;
  byHour: Record<string, number>;
  peakHour: number;
  averagePerHour: number;
  classification: {
    withPlates: number;
    withoutPlates: number;
    withMakeModel: number;
    plateOnly: number;
    fullClassification: number;
  };
}

export interface VCCRealtime {
  totalDetections: number;
  byVehicleType: Record<string, number>;
  byDevice: Array<{ deviceId: string; deviceName: string; count: number }>;
  perMinute: number;
}
