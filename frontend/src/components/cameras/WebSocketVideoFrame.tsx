import { useEffect, useRef, useState, useCallback } from 'react';

interface Detection {
  type: string;
  confidence: number;
  bbox?: [number, number, number, number]; // x, y, width, height
  label?: string;
  color?: string;
}

interface WebSocketVideoFrameProps {
  workerId: string;
  cameraId: string;
  showOverlays?: boolean;
  enabledServices?: string[];
  serviceFilter?: string;
  className?: string;
  onConnectionChange?: (connected: boolean) => void;
  onMetrics?: (metrics: {
    connected: boolean;
    fps: number;
    detections: number;
    lastFrameAgeMs: number | null;
    reconnects: number;
    error: string | null;
  }) => void;
}

// Global WebSocket connection (shared across all video frames)
let globalWs: WebSocket | null = null;
let wsConnecting = false;
const wsSubscribers = new Map<string, Set<(data: ArrayBuffer | Detection[]) => void>>();
let reconnectTimeout: number | null = null;
let reconnectDelayMs = 800;
let wsReconnectCount = 0;
let wsManualClose = false;

function getWsUrl(): string {
  // Connect to backend WebSocket
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Backend is on port 3002
  return `${protocol}//${window.location.hostname}:3002/ws/feeds`;
}

function connectWebSocket() {
  if (globalWs?.readyState === WebSocket.OPEN || wsConnecting) {
    return;
  }

  wsConnecting = true;
  wsManualClose = false;
  const ws = new WebSocket(getWsUrl());
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log('📺 WebSocket connected to feed hub');
    globalWs = ws;
    wsConnecting = false;
    reconnectDelayMs = 800;

    // Re-subscribe to all cameras
    wsSubscribers.forEach((_, cameraKey) => {
      ws.send(JSON.stringify({ type: 'subscribe', camera: cameraKey }));
    });
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      // Binary frame message
      // Format: [1 byte type][1 byte key length][camera key][frame data]
      const data = new Uint8Array(event.data);
      if (data[0] !== 0x01) return; // Not a frame

      const keyLength = data[1];
      const cameraKey = new TextDecoder().decode(data.slice(2, 2 + keyLength));
      const frameData = data.slice(2 + keyLength);

      // Dispatch to subscribers
      const handlers = wsSubscribers.get(cameraKey);
      if (handlers) {
        handlers.forEach(handler => handler(frameData.buffer));
      }
    } else {
      // Text JSON message (detections, errors, etc.)
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'detection' && msg.camera) {
          const handlers = wsSubscribers.get(msg.camera);
          if (handlers) {
            handlers.forEach(handler => handler(msg.data));
          }
        } else if (msg.type === 'error') {
          console.error('Feed hub error:', msg.error);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    }
  };

  ws.onclose = () => {
    if (!wsManualClose) {
      console.log('📺 WebSocket disconnected');
    }
    globalWs = null;
    wsConnecting = false;
    wsReconnectCount += 1;

    // Reconnect after delay
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5000);
    reconnectTimeout = window.setTimeout(() => {
      if (wsSubscribers.size > 0) {
        connectWebSocket();
      }
    }, delay);
  };

  ws.onerror = (error) => {
    console.error('📺 WebSocket error:', error);
    wsConnecting = false;
  };
}

function subscribe(cameraKey: string, handler: (data: ArrayBuffer | Detection[]) => void) {
  if (!wsSubscribers.has(cameraKey)) {
    wsSubscribers.set(cameraKey, new Set());
  }
  wsSubscribers.get(cameraKey)!.add(handler);

  // Connect if not connected
  connectWebSocket();

  // Send subscribe message if connected
  if (globalWs?.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify({ type: 'subscribe', camera: cameraKey }));
  }
}

function unsubscribe(cameraKey: string, handler: (data: ArrayBuffer | Detection[]) => void) {
  const handlers = wsSubscribers.get(cameraKey);
  if (handlers) {
    handlers.delete(handler);
    if (handlers.size === 0) {
      wsSubscribers.delete(cameraKey);

      // Send unsubscribe message
      if (globalWs?.readyState === WebSocket.OPEN) {
        globalWs.send(JSON.stringify({ type: 'unsubscribe', camera: cameraKey }));
      }
    }
  }

  // Disconnect if no more subscribers
  if (wsSubscribers.size === 0 && globalWs) {
    wsManualClose = true;
    globalWs.close();
    globalWs = null;
  }
}

export function WebSocketVideoFrame({
  workerId,
  cameraId,
  showOverlays = true,
  enabledServices = [],
  serviceFilter = 'all',
  className = '',
  onConnectionChange,
  onMetrics,
}: WebSocketVideoFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connected, setConnected] = useState(false);
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnects, setReconnects] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const detectionsRef = useRef<Detection[]>([]);
  const overlayConfigRef = useRef({
    showOverlays: true,
    enabledServices: [] as string[],
    serviceFilter: 'all',
  });

  // Pending-frame state: at most one frame queued while decode is in progress.
  // This ensures we always render the LATEST frame and never build a backlog.
  const decodingRef = useRef(false);
  const pendingFrameRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    overlayConfigRef.current = { showOverlays, enabledServices, serviceFilter };
  }, [showOverlays, enabledServices, serviceFilter]);

  const cameraKey = `${workerId}.${cameraId}`;

  // Decode the latest pending frame using createImageBitmap (faster than Image+URL).
  // Recursively processes the next pending frame after each decode completes.
  const processFrame = useCallback(() => {
    const buf = pendingFrameRef.current;
    if (!buf) {
      decodingRef.current = false;
      return;
    }
    pendingFrameRef.current = null;

    createImageBitmap(new Blob([buf], { type: 'image/jpeg' }))
      .then((bitmap) => {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            ctx.drawImage(bitmap, 0, 0);
            const cfg = overlayConfigRef.current;
            const filtered = filterDetections(detectionsRef.current, cfg.enabledServices, cfg.serviceFilter);
            if (cfg.showOverlays && filtered.length > 0) {
              drawDetections(ctx, filtered, bitmap.width, bitmap.height);
            }
          }
        }
        bitmap.close();

        setLastFrameTime(Date.now());
        setConnected(true);
        setError(null);

        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsUpdateRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsUpdateRef.current = now;
        }

        // Process the next queued frame (if a newer one arrived while decoding).
        processFrame();
      })
      .catch(() => {
        setError('Failed to decode frame');
        decodingRef.current = false;
      });
  }, []); // refs only — no stale-closure risk

  // Handle incoming data (frames or detections)
  const handleData = useCallback((data: ArrayBuffer | Detection[]) => {
    if (data instanceof ArrayBuffer) {
      // Always keep only the latest pending frame; skip if busy decoding.
      pendingFrameRef.current = data;
      if (!decodingRef.current) {
        decodingRef.current = true;
        processFrame();
      }
    } else {
      // Detection data - can be array or object with detections property
      if (Array.isArray(data)) {
        const next = data as Detection[];
        detectionsRef.current = next;
        setDetections(next);
      } else if (data && typeof data === 'object' && 'detections' in data) {
        // Handle YOLO worker format: { camera_id, timestamp, detections: [...] }
        const next = (data as { detections: Detection[] }).detections;
        detectionsRef.current = next;
        setDetections(next);
      }
    }
  }, [processFrame]);

  // Subscribe/unsubscribe on mount/unmount
  useEffect(() => {
    subscribe(cameraKey, handleData);

    return () => {
      unsubscribe(cameraKey, handleData);
    };
  }, [cameraKey, handleData]);

  // Check for stale connection
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastFrameTime && Date.now() - lastFrameTime > 5000) {
        setConnected(false);
        setError('No frames received');
      }
      setReconnects(wsReconnectCount);
    }, 1000);

    return () => clearInterval(interval);
  }, [lastFrameTime]);

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange?.(connected);
  }, [connected, onConnectionChange]);

  useEffect(() => {
    if (!onMetrics) return;
    const age = lastFrameTime ? Math.max(0, Date.now() - lastFrameTime) : null;
    onMetrics({
      connected,
      fps,
      detections: detections.length,
      lastFrameAgeMs: age,
      reconnects,
      error,
    });
  }, [connected, fps, detections.length, lastFrameTime, reconnects, error, onMetrics]);

  return (
    <div className={`relative w-full h-full bg-zinc-900 ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
      />

      {/* Overlays removed to allow parent-level custom HUDs */}
    </div>
  );
}

function detectionService(type: string): 'anpr_vcc' | 'crowd' | 'frs' {
  const t = (type || '').toLowerCase();
  if (
    t.includes('face') ||
    t.includes('watchlist') ||
    t.includes('person_match') ||
    t.includes('unknown_person')
  ) {
    return 'frs';
  }
  if (
    t.includes('vehicle') ||
    t.includes('car') ||
    t.includes('truck') ||
    t.includes('bus') ||
    t.includes('plate') ||
    t.includes('anpr') ||
    t.includes('vcc') ||
    t.includes('violation') ||
    t.includes('speed')
  ) {
    return 'anpr_vcc';
  }
  return 'crowd';
}

function filterDetections(detections: Detection[], enabledServices: string[], serviceFilter: string): Detection[] {
  if (!Array.isArray(detections) || detections.length === 0) return [];
  const enabled = enabledServices.length > 0 ? new Set(enabledServices) : null;
  return detections.filter((det) => {
    const svc = detectionService(det.type);
    if (enabled && !enabled.has(svc)) return false;
    if (serviceFilter && serviceFilter !== 'all' && serviceFilter !== svc) return false;
    return true;
  });
}

// Draw detection bounding boxes and labels
function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  _width: number,
  _height: number
) {
  detections.forEach((det) => {
    if (!det.bbox) return;

    const [x, y, w, h] = det.bbox;
    const color = det.color || getColorForType(det.type);

    // Draw box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Draw label background
    const label = det.label || `${det.type} ${Math.round(det.confidence * 100)}%`;
    ctx.font = '12px sans-serif';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 18, textWidth + 8, 18);

    // Draw label text
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 4, y - 5);
  });
}

// Get color for detection type
function getColorForType(type: string): string {
  const colors: Record<string, string> = {
    person: '#22c55e',
    vehicle: '#3b82f6',
    car: '#3b82f6',
    truck: '#8b5cf6',
    bus: '#f59e0b',
    motorcycle: '#ec4899',
    bicycle: '#14b8a6',
    plate: '#ef4444',
    face: '#f97316',
    default: '#6b7280',
  };
  return colors[type.toLowerCase()] || colors.default;
}

export default WebSocketVideoFrame;
