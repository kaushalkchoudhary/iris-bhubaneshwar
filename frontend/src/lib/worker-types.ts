// Worker Types - Separate file to avoid import issues
import type { Device } from './api';

export interface WorkerResources {
  cpu_load_1m?: number;    // 1-min load average (0..num_cores)
  cpu_percent?: number;    // CPU % (some Jetsons send this instead)
  gpu_percent?: number;    // GPU utilisation %
  memory_percent?: number; // RAM used %
  memory_mb?: number;      // RAM used MB (alternative)
  temperature_c?: number;  // Board temperature °C
  disk_used_gb?: number;
  disk_total_gb?: number;
  [key: string]: number | undefined;
}

/** Combined live stat returned by GET /api/admin/workers/live-stats */
export interface WorkerLiveStat {
  workerId: string;
  name: string;
  ip: string;
  model: string;
  status: WorkerStatus;
  lastSeen: string;       // ISO timestamp
  lastSeenAgo: number;    // seconds since last heartbeat
  reachable: boolean;
  latencyMs: number;
  pingError?: string;
  cameraCount: number;
  resources: WorkerResources | null;
  configVersion: number;
  checkedAt: string;
}

export type WorkerStatus = 'pending' | 'approved' | 'active' | 'offline' | 'revoked';

export interface WorkerCameraAssignment {
  id: number;
  workerId: string;
  deviceId: string;
  device?: Device;
  analytics: string[];
  fps: number;
  resolution: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CameraAssignment {
  device_id: string;
  analytics: string[];
  fps?: number;
  resolution?: string;
}

export interface Worker {
  id: string;
  name: string;
  status: WorkerStatus;
  ip: string;
  mac: string;
  model: string;
  version?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  lastSeen: string;
  lastIp?: string | null;
  resources?: {
    cpu_percent?: number;
    gpu_percent?: number;
    memory_mb?: number;
    temperature_c?: number;
  } | null;
  config?: any;
  configVersion: number;
  metadata?: any;
  tags?: string[] | null;
  createdAt: string;
  updatedAt: string;
  cameraAssignments?: WorkerCameraAssignment[];
}

export interface WorkerWithCounts extends Worker {
  cameraCount: number;
}

export interface WorkerPingStatus {
  workerId: string;
  name: string;
  ip: string;
  status: WorkerStatus;
  lastSeen: string;
  reachable: boolean;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export interface JetsonFleetStatus {
  jetsonId: string;
  name: string;
  ip: string;
  connected: boolean;
  reachable: boolean;
  registered: boolean;
  workerId?: string;
  status?: WorkerStatus;
  lastSeen?: string;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export interface WorkerToken {
  id: string;
  token: string;
  name: string;
  usedBy?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null;
  isRevoked: boolean;
  createdBy: string;
  createdAt: string;
}

export interface WorkerTokenWithStatus extends WorkerToken {
  status: 'active' | 'used' | 'expired' | 'revoked';
}

export interface WorkerApprovalRequest {
  id: string;
  deviceName: string;
  ip: string;
  mac: string;
  model: string;
  status: 'pending' | 'approved' | 'rejected';
  workerId?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
  createdAt: string;
  updatedAt: string;
}
