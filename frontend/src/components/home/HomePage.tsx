import { useState, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Map, Camera, Users,
  BarChart3, Bell, Settings, Monitor, Shield,
  FileText, Cog, Server, ChevronRight, Zap, ArrowRight, UserCircle2, X, LogOut, Radar
} from 'lucide-react';
import { MapBackground } from './MapBackground';
import { playSound, playSoundName } from '@/hooks/useSound';
import './HomePage.css';
import { IrisEyeMark } from '@/components/brand/IrisEyeMark';
import { apiClient, type WatchlistAlert } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface SubMenuItem {
  id: string;
  icon: typeof Map;
  label: string;
  desc: string;
  path: string;
}

interface ModuleInfo {
  brief: string;
  color: string;
  stats: { val: string; label: string }[];
  features: string[];
  status: string;
  highlights: string[];
}

interface MainModule {
  id: string;
  icon: typeof Map;
  label: string;
  sub: string;
  side: 'left' | 'right';
  subItems: SubMenuItem[];
  info: ModuleInfo;
}

const mainModules: MainModule[] = [
  {
    id: 'vms', icon: Monitor, label: 'VMS', sub: 'Video Management', side: 'left',
    subItems: [
      { id: 'live-feed', icon: Camera, label: 'Live Feed', desc: 'Real-time surveillance feeds', path: '/live-feed' },
    ],
    info: {
      brief: 'Centralized camera management with RTSP feed configuration and multi-grid live views.',
      color: '#00F0FF',
      status: 'Video Management System',
      stats: [
        { val: '0', label: 'Cameras' },
        { val: 'RTSP', label: 'Protocol' },
        { val: 'Live', label: 'Status' },
      ],
      features: ['Multi-grid layouts', 'RTSP config', 'Drag & drop'],
      highlights: [
        'Add and configure RTSP cameras with zone and location metadata',
        'Drag-and-drop multi-grid live feed with per-slot fullscreen',
      ],
    },
  },
  {
    id: 'crowd', icon: Users, label: 'PUBLIC SAFETY', sub: 'Face Recognition', side: 'left',
    subItems: [
      // TEMP DISABLED: Crowd Analytics
      // { id: 'crowd-analytics', icon: Users, label: 'Crowd Analytics', desc: 'Density and flow monitoring', path: '/crowd-analytics' },
      { id: 'frs', icon: Shield, label: 'Face Recognition', desc: 'Watchlist and unknown faces', path: '/frs/live' },
      { id: 'gods-eye', icon: Radar, label: "God's Eye", desc: 'Promptable live object detection', path: '/public-safety/gods-eye' },
    ],
    info: {
      brief: 'Face recognition and multimodal inference system with watchlist management, real-time alerts, and promptable edge intelligence.',
      color: '#FFB700',
      status: 'Active Monitoring',
      stats: [
        { val: '6', label: 'Watchlist' },
        { val: 'YOLO', label: 'Engine' },
        { val: '6', label: 'Devices' },
      ],
      features: ['Watchlist management', 'Promptable detection', 'Real-time alerts', 'Visual matching'],
      highlights: [
        'Real-time face detection and identification across nodes',
        'God\'s Eye prompt engine for custom object detection',
        'Automated watchlist alerts and unknown face logging',
      ],
    },
  },
  // TEMP DISABLED: ITMS/Traffic Management
  // {
  //   id: 'itms', icon: Compass, label: 'ITMS', sub: 'Traffic Management', side: 'left',
  //   subItems: [
  //     { id: 'anpr', icon: Car, label: 'ANPR', desc: 'Plate recognition system', path: '/itms/anpr' },
  //     { id: 'vcc', icon: TrendingUp, label: 'VCC', desc: 'Vehicle classification', path: '/itms/vcc' },
  //     { id: 'watchlist', icon: AlertTriangle, label: 'Watchlist', desc: 'Monitored vehicles', path: '/itms/watchlist' },
  //   ],
  //   info: {
  //     brief: 'Intelligent traffic management with ANPR, vehicle classification, speed detection, and automated violation processing across corridors.',
  //     color: '#00F0FF',
  //     status: '12 Junctions Active',
  //     stats: [
  //       { val: '12', label: 'Junctions' },
  //       { val: '98.2%', label: 'ANPR Acc.' },
  //       { val: '142', label: 'Violations' },
  //     ],
  //     features: ['Plate recognition', 'Speed profiling', 'Red-light detection', 'Vehicle counting'],
  //     highlights: [
  //       'ANPR with 98.2% accuracy across day/night conditions',
  //       '14-class vehicle classification with speed profiling',
  //       'Automated challan generation for red-light and speed violations',
  //     ],
  //   },
  // },
  {
    id: 'analytics', icon: BarChart3, label: 'ANALYTICS', sub: 'Data Insights', side: 'right',
    subItems: [
      { id: 'dashboard', icon: BarChart3, label: 'Dashboard', desc: 'Aggregated analytics', path: '/dashboard' },
      { id: 'reports', icon: FileText, label: 'Reports', desc: 'Generated reports', path: '/reports' },
    ],
    info: {
      brief: 'Aggregated data intelligence from all modules. Custom dashboards, trend analysis, exportable reports, and predictive insights.',
      color: '#00F0FF',
      status: '1.2M Data Points',
      stats: [
        { val: '24', label: 'Reports' },
        { val: '1.2M', label: 'Data Pts' },
        { val: '6', label: 'Sources' },
      ],
      features: ['Custom dashboards', 'Trend analysis', 'PDF/CSV export', 'Scheduled reports'],
      highlights: [
        'Cross-module aggregation from VMS, ITMS, and Crowd data',
        'Scheduled PDF/CSV report generation with email delivery',
        'Historical trend analysis with comparative time-range views',
      ],
    },
  },
  {
    id: 'alerts', icon: Bell, label: 'ALERTS', sub: 'Active Notifications', side: 'right',
    subItems: [
      { id: 'notifications', icon: Bell, label: 'Alert Center', desc: 'Active notifications', path: '/alerts' },
    ],
    info: {
      brief: 'Unified alert management with configurable rules, escalation chains, and multi-channel notifications for all system events.',
      color: '#FF2A2A',
      status: '3 Active Alerts',
      stats: [
        { val: '3', label: 'Active' },
        { val: '18', label: 'Rules' },
        { val: '99.9%', label: 'Delivery' },
      ],
      features: ['Rule engine', 'Escalation chains', 'SMS/Email/Push', 'Alert correlation'],
      highlights: [
        'Multi-condition rule engine with AND/OR logic builders',
        'Tiered escalation chains with configurable timeouts',
        'Cross-module alert correlation to reduce false positives',
      ],
    },
  },
  {
    id: 'settings', icon: Settings, label: 'SETTINGS', sub: 'Configuration', side: 'right',
    subItems: [
      { id: 'system', icon: Cog, label: 'System', desc: 'Global configuration', path: '/settings' },
      { id: 'workers', icon: Server, label: 'Edge Workers', desc: 'Processing nodes', path: '/settings/workers' },
      { id: 'operator-access', icon: Shield, label: 'Operator Access', desc: 'Operator approvals & sessions', path: '/settings/operators' },
    ],
    info: {
      brief: 'System configuration and infrastructure management. Edge workers, device provisioning, user roles, and global system parameters.',
      color: '#00B8D4',
      status: 'System Healthy',
      stats: [
        { val: '4', label: 'Workers' },
        { val: '22', label: 'Devices' },
        { val: '3', label: 'Users' },
      ],
      features: ['Edge compute', 'Device CRUD', 'Role management', 'System health'],
      highlights: [
        'Edge worker orchestration with auto-scaling and health checks',
        'Zero-downtime device provisioning and firmware updates',
        'Role-based access control with audit logging',
      ],
    },
  },
];

function playModuleSound(moduleId: string, action: 'expand' | 'collapse') {
  // Prefer module-specific sounds when available (expand-itms.mp3, collapse-vms.mp3, etc).
  // Fall back to the generic expand/collapse if the file doesn't exist.
  playSoundName(`${action}-${moduleId}`);
  playSound(action);
}

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hrs = String(time.getHours()).padStart(2, '0');
  const mins = String(time.getMinutes()).padStart(2, '0');
  return (
    <div className="nx-clock">
      <span>{hrs}</span>
      <span className="nx-clock-sep">:</span>
      <span>{mins}</span>
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [selectedModule, setSelectedModule] = useState<MainModule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [alertItems, setAlertItems] = useState<WatchlistAlert[]>([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [alertUnread, setAlertUnread] = useState(0);
  const [alertToday, setAlertToday] = useState(0);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [onlineCount, setOnlineCount] = useState<number>(15);
  const [perfLite, setPerfLite] = useState(false);
  const [frsPersons, setFrsPersons] = useState(0);
  const [frsDetections, setFrsDetections] = useState(0);
  const [liveModuleStats, setLiveModuleStats] = useState<{
    vmsTotal: number;
    vmsOnline: number;
    crowdHotspots: number;
    crowdCritical: number;
    itmsWatchlisted: number;
    itmsDetectionsToday: number;
    itmsUniqueVehicles: number;
    analyticsSources: number;
    workers: number;
  }>({
    vmsTotal: 0,
    vmsOnline: 0,
    crowdHotspots: 0,
    crowdCritical: 0,
    itmsWatchlisted: 0,
    itmsDetectionsToday: 0,
    itmsUniqueVehicles: 0,
    analyticsSources: 0,
    workers: 0,
  });
  const centerOrbRef = useRef<HTMLDivElement | null>(null);

  const modulesWithLiveCounts = useMemo(() => {
    return mainModules.map((mod) => {
      if (mod.id === 'vms') {
        const total = liveModuleStats.vmsTotal;
        const online = liveModuleStats.vmsOnline;
        const subText = total === 0 ? 'No Cameras' : `${online}/${total} Online`;
        const statusText = total === 0 ? 'No cameras configured' : `${online}/${total} Cameras Active`;
        return {
          ...mod,
          sub: subText,
          info: {
            ...mod.info,
            status: statusText,
            stats: [
              { val: String(total), label: 'Cameras' },
              { val: String(online), label: 'Active' },
              { val: 'RTSP', label: 'Protocol' },
            ],
          },
        };
      }
      if (mod.id === 'crowd') {
        return {
          ...mod,
          sub: `${frsPersons} Watchlist • ${frsDetections} Detections`,
          info: {
            ...mod.info,
            status: `${frsPersons} Persons Watchlisted`,
            stats: [
              { val: String(frsPersons), label: 'Watchlist' },
              { val: String(frsDetections), label: 'Detections' },
              { val: String(liveModuleStats.workers), label: 'Devices' },
            ],
          },
        };
      }
      if (mod.id === 'itms') {
        return {
          ...mod,
          sub: `${liveModuleStats.itmsDetectionsToday} Detections Today`,
          info: {
            ...mod.info,
            status: `${liveModuleStats.itmsUniqueVehicles} Unique Vehicles`,
            stats: [
              { val: String(liveModuleStats.itmsDetectionsToday), label: 'Today' },
              { val: String(liveModuleStats.itmsUniqueVehicles), label: 'Unique' },
              { val: String(liveModuleStats.itmsWatchlisted), label: 'Watchlisted' },
            ],
          },
        };
      }
      if (mod.id === 'analytics') {
        return {
          ...mod,
          sub: `${liveModuleStats.workers} Active Devices`,
          info: {
            ...mod.info,
            status: `${liveModuleStats.vmsTotal} Cameras Connected`,
            stats: [
              { val: String(liveModuleStats.workers), label: 'Devices' },
              { val: String(liveModuleStats.vmsTotal), label: 'Cameras' },
              { val: String(frsPersons), label: 'FRS' },
            ],
          },
        };
      }
      if (mod.id === 'alerts') {
        return {
          ...mod,
          sub: alertUnread > 0 ? `${alertUnread} Active` : (frsDetections > 0 ? `${frsDetections} FRS Events` : 'No Active Alerts'),
          info: {
            ...mod.info,
            status: alertUnread > 0 ? `${alertUnread} Active Alerts` : (frsDetections > 0 ? `${frsDetections} FRS Detections Today` : 'No Active Alerts'),
            stats: [
              { val: String(alertUnread), label: 'Unread' },
              { val: String(alertTotal), label: 'Total' },
              { val: String(frsDetections), label: 'FRS' },
            ],
          },
        };
      }
      if (mod.id === 'settings') {
        return {
          ...mod,
          sub: `${liveModuleStats.workers} Workers`,
          info: {
            ...mod.info,
            status: `${liveModuleStats.workers} Edge Workers Active`,
            stats: [
              { val: String(liveModuleStats.workers), label: 'Workers' },
              { val: String(liveModuleStats.vmsTotal), label: 'Cameras' },
              { val: String(liveModuleStats.vmsOnline), label: 'Active' },
            ],
          },
        };
      }
      return mod;
    });
  }, [alertUnread, alertToday, alertTotal, liveModuleStats]);

  const leftModules = modulesWithLiveCounts.filter(m => m.side === 'left');
  const rightModules = modulesWithLiveCounts.filter(m => m.side === 'right');
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const roleLabel = (user?.role || 'user').toUpperCase();
  const displayName = useMemo(() => {
    const rawName = String(user?.name || '').trim();
    if (rawName && rawName.toUpperCase() !== roleLabel) return rawName;
    const email = String(user?.email || '').trim();
    if (!email) return 'Operator';
    const local = email.split('@')[0] || email;
    return local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }, [user?.name, user?.email, roleLabel]);

  useEffect(() => {
    let p = 0;
    const id = setInterval(() => {
      p += Math.random() * 15;
      if (p >= 100) { p = 100; clearInterval(id); setTimeout(() => setLoaded(true), 300); }
      setLoadProgress(p);
    }, 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedModule(null);
        setShowAccountMenu(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowCpu = (navigator.hardwareConcurrency || 8) <= 4;
    const lowMemory = ((navigator as any).deviceMemory || 8) <= 4;
    setPerfLite(prefersReducedMotion || lowCpu || lowMemory);
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchAlerts = async () => {
      try {
        const [alertsRes, statsRes] = await Promise.all([
          apiClient.getAlerts({ limit: 8, offset: 0 }),
          apiClient.getAlertStats(),
        ]);
        if (!mounted) return;
        setAlertItems(alertsRes.alerts ?? []);
        setAlertTotal(statsRes.total ?? 0);
        setAlertUnread(statsRes.unread ?? 0);
        setAlertToday(statsRes.today ?? 0);
        setLiveModuleStats((prev) => ({
          ...prev,
          analyticsSources: Object.keys(statsRes.byType || {}).length,
        }));
      } catch {
        if (!mounted) return;
        setAlertItems([]);
      }
    };

    const fetchModuleStats = async () => {
      try {
        const [camerasRes, hotspotsRes, vehicleStatsRes, vccStatsRes, workersRes, frsPersonsRes, frsDetectionsRes] = await Promise.allSettled([
          apiClient.getDevices({ type: 'CAMERA' }),
          apiClient.getHotspots(),
          apiClient.getVehicleStats(),
          apiClient.getVCCStats(),
          apiClient.getWorkers(),
          apiClient.getPersons(),
          apiClient.getFRSDetections({ limit: 1 }),
        ]);
        const workerPingRes = await apiClient.getWorkersPingStatus().catch(() => null);
        if (!mounted) return;

        const cameras = camerasRes.status === 'fulfilled' ? (camerasRes.value as Array<{ status?: string }>) : [];
        const cameraTotal = cameras.length;
        const cameraOnline = cameras.filter((d) => {
          const s = String(d.status || '').toUpperCase();
          return s === 'ONLINE' || s === 'ACTIVE';
        }).length;
        const workerTotal = workerPingRes?.summary?.total
          ?? (workersRes.status === 'fulfilled' ? workersRes.value.length : 0);
        const workerOnline = workerPingRes?.summary?.online
          ?? (workersRes.status === 'fulfilled'
            ? workersRes.value.filter((w) => String(w.status).toLowerCase() === 'active').length
            : 0);
        setOnlineCount(workerOnline);

        const hotspots = hotspotsRes.status === 'fulfilled' ? hotspotsRes.value : [];
        const crowdCritical = hotspots.filter((h) => h.hotspotSeverity === 'RED').length;

        const vehicleStats = vehicleStatsRes.status === 'fulfilled' ? vehicleStatsRes.value : null;
        const vccStats = vccStatsRes.status === 'fulfilled' ? vccStatsRes.value : null;
        const workers = workerTotal;

        const frsPersonsCount = frsPersonsRes.status === 'fulfilled' ? frsPersonsRes.value.length : 0;
        const frsDetectionsCount = frsDetectionsRes.status === 'fulfilled'
          ? (frsDetectionsRes.value as unknown as { total?: number })?.total ?? (frsDetectionsRes.value as unknown as Array<unknown>).length ?? 0
          : 0;
        setFrsPersons(frsPersonsCount);
        setFrsDetections(frsDetectionsCount);

        setLiveModuleStats((prev) => ({
          ...prev,
          vmsTotal: cameraTotal,
          vmsOnline: cameraOnline,
          crowdHotspots: hotspots.length,
          crowdCritical,
          itmsWatchlisted: vehicleStats?.watchlisted ?? 0,
          itmsDetectionsToday: vehicleStats?.detectionsToday ?? 0,
          itmsUniqueVehicles: vccStats?.uniqueVehicles ?? 0,
          workers,
        }));
      } catch {
        if (!mounted) return;
        setOnlineCount(0);
      }
    };

    fetchAlerts();
    fetchModuleStats();
    const alertId = setInterval(fetchAlerts, 30000);
    const moduleId = setInterval(fetchModuleStats, 45000);
    return () => {
      mounted = false;
      clearInterval(alertId);
      clearInterval(moduleId);
    };
  }, []);

  const feedItems = useMemo(() => {
    return alertItems
      .filter((a) => !dismissedAlertIds.has(a.id))
      .slice(0, 6)
      .map((a) => {
        const ts = new Date(a.timestamp || a.createdAt);
        const mins = Math.max(1, Math.floor((Date.now() - ts.getTime()) / 60000));
        return {
          id: a.id,
          tag: a.alertType === 'VIOLATION' ? 'ITMS' : 'ANPR',
          msg: a.message || (a.alertType === 'VIOLATION' ? 'Violation event detected' : 'Watchlist detection event'),
          time: mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`,
          cam: a.device?.name || a.deviceId || 'NODE',
          tone: a.alertType === 'VIOLATION' ? 'itms' : 'anpr',
          source: 'api' as const,
        };
      });
  }, [alertItems, dismissedAlertIds]);

  const dismissFeedItem = async (item: { id: string; source: 'api' | 'fallback' }) => {
    playSound('notification');
    setDismissedAlertIds((prev) => new Set(prev).add(item.id));
    if (item.source === 'api') {
      try {
        await apiClient.dismissAlert(item.id);
        setAlertItems((prev) => prev.filter((a) => a.id !== item.id));
      } catch {
        // Keep client-side dismiss even if backend dismiss fails.
      }
    }
  };

  const handleCenterMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = centerOrbRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const cx = clamp(nx);
    const cy = clamp(ny);

    el.style.setProperty('--orb-x-soft', `${(cx * 8).toFixed(2)}px`);
    el.style.setProperty('--orb-y-soft', `${(cy * 8).toFixed(2)}px`);
    el.style.setProperty('--orb-x-hard', `${(cx * 14).toFixed(2)}px`);
    el.style.setProperty('--orb-y-hard', `${(cy * 14).toFixed(2)}px`);
    el.style.setProperty('--orb-rx', `${(-cy * 4.2).toFixed(2)}deg`);
    el.style.setProperty('--orb-ry', `${(cx * 4.2).toFixed(2)}deg`);
  };

  const handleCenterMouseLeave = () => {
    const el = centerOrbRef.current;
    if (!el) return;
    el.style.setProperty('--orb-x-soft', '0px');
    el.style.setProperty('--orb-y-soft', '0px');
    el.style.setProperty('--orb-x-hard', '0px');
    el.style.setProperty('--orb-y-hard', '0px');
    el.style.setProperty('--orb-rx', '0deg');
    el.style.setProperty('--orb-ry', '0deg');
  };

  if (!loaded) {
    return (
      <div className="nx-loader">
        <div className="nx-loader-logo">
          <IrisEyeMark size={42} accent="#00F0FF" />
          <span>IRIS</span>
        </div>
        <div className="nx-loader-bar">
          <div className="nx-loader-progress" style={{ width: `${loadProgress}%` }} />
        </div>
        <div className="nx-loader-text">Initializing</div>
      </div>
    );
  }

  const renderModuleCard = (mod: MainModule, index: number, side: 'left' | 'right') => {
    const Icon = mod.icon;
    const isSelected = selectedModule?.id === mod.id;
    const isOtherSelected = selectedModule && selectedModule.id !== mod.id;

    return (
      <div
        key={mod.id}
        className={`nx-module ${isSelected ? 'nx-selected' : ''} ${isOtherSelected ? 'nx-dimmed' : ''}`}
        style={{
          animationDelay: `${0.3 + index * 0.08}s`,
          ['--mod-accent' as any]: mod.info.color,
        }}
      >
        {/* Main Card */}
        <div
          className={`nx-mcard ${side === 'right' ? 'nx-mcard-right' : ''}`}
          title={`Open ${mod.label} modules`}
          onClick={() => {
            if (isSelected) {
              playModuleSound(mod.id, 'collapse');
              setSelectedModule(null);
            } else {
              playModuleSound(mod.id, 'expand');
              setSelectedModule(mod);
            }
          }}
        >
          <div className="nx-mcard-glow" />
          <div className="nx-mcard-icon">
            <Icon size={20} />
          </div>
          <div className={`nx-mcard-text ${side === 'right' ? 'nx-text-right' : ''}`}>
            <span className="nx-mcard-label">{mod.label}</span>
            <span className="nx-mcard-sub">{mod.sub}</span>
          </div>
          <ChevronRight size={14} className={`nx-mcard-chevron ${isSelected ? 'nx-rotated' : ''}`} />
        </div>

        {/* Expanded Panel */}
        {isSelected && (
          <div className={`nx-xpanel ${side === 'right' ? 'nx-xpanel-right' : ''}`}>
            {/* Top scanner */}
            <div className="nx-xpanel-scanner" />

            {/* Header */}
            <div className="nx-xpanel-head">
              <Zap size={10} className="nx-xpanel-zap" />
              <span className="nx-xpanel-sys">{mod.label}</span>
              <span className="nx-xpanel-sep">//</span>
              <span className="nx-xpanel-sysname">SUBSYSTEMS</span>
              <span className="nx-xpanel-cnt">{mod.subItems.length}</span>
            </div>

            {/* Divider */}
            <div className="nx-xpanel-div">
              <div className="nx-xpanel-div-line" />
              <div className="nx-xpanel-div-dot" />
            </div>

            {/* Items */}
            <div className="nx-xpanel-items">
              {mod.subItems.map((item, j) => {
                const SubIcon = item.icon;
                return (
                  <div
                    key={item.id}
                    className="nx-xitem"
                    title={`Open ${item.label}`}
                    style={{ animationDelay: `${0.1 + j * 0.07}s` }}
                    onClick={() => navigate(item.path)}
                  >
                    {/* Left glow bar */}
                    <div className="nx-xitem-bar" />

                    <div className="nx-xitem-icon">
                      <SubIcon size={16} />
                    </div>

                    <div className="nx-xitem-body">
                      <span className="nx-xitem-name">{item.label}</span>
                      <span className="nx-xitem-desc">{item.desc}</span>
                    </div>

                    <div className="nx-xitem-go">
                      <ArrowRight size={14} />
                    </div>

                    {/* Hover scan effect */}
                    <div className="nx-xitem-hover-scan" />
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="nx-xpanel-foot">
              <div className="nx-xpanel-foot-line" />
              <span className="nx-xpanel-foot-text">SYS.OK</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`nx-root ${perfLite ? 'nx-perf-lite' : ''}`}>
      <div className="nx-scene">
        <MapBackground color="#00F0FF" lite={perfLite} />
      </div>

      <div className="nx-film-grain" />
      <div className="nx-vignette" />
      <div className="nx-color-wash" />

      {/* Header */}
      <header className="nx-header nx-fadein">
        <div className="nx-logo">
          <div className="nx-logo-icon">
            <IrisEyeMark size={24} accent="#00F0FF" />
          </div>
          <div className="nx-logo-copy">
            <span className="nx-logo-text">IRIS</span>
          </div>
        </div>

        <div className="nx-status-center">
          <button className="nx-status-pill" title="Open Alerts" onClick={() => { playSound('notification'); navigate('/alerts'); }}>
            <div className="nx-status-dot nx-warn" />
            <span className="nx-status-label">Alerts</span>
            <span className="nx-status-val">{alertUnread}</span>
          </button>
          <Clock />
          <button className="nx-status-pill" title="Open Map View" onClick={() => { playSound('notification'); navigate('/map'); }}>
            <div className="nx-status-dot nx-ok" />
            <span className="nx-status-label">Online</span>
            <span className="nx-status-val">{onlineCount}</span>
          </button>
        </div>

        <div className="nx-header-actions">
          <button className="nx-action-btn" title="Alerts" style={{ position: 'relative' }} onClick={() => { playSound('notification'); navigate('/alerts'); }}>
            <Bell size={16} />
            {alertUnread > 0 && <span className="nx-badge">{alertUnread}</span>}
          </button>
          <button className="nx-action-btn" title="Settings" onClick={() => { playSound('notification'); navigate('/settings'); }}>
            <Settings size={16} />
          </button>
          <div className="nx-account-wrap">
            <button className="nx-action-btn" title="Account" onClick={() => {
              setShowAccountMenu((v) => {
                const next = !v;
                playSoundName(next ? 'expand' : 'collapse', 0.35);
                return next;
              });
            }}>
              <UserCircle2 size={16} />
            </button>
            {showAccountMenu && (
              <div className="nx-account-menu">
                <div className="nx-account-id">
                  <div className="nx-account-identity">
                    <div className="nx-account-avatar" aria-hidden="true">
                      {isAdmin ? <Shield size={13} /> : <Users size={13} />}
                    </div>
                    <div>
                      <div className="nx-account-name">{displayName}</div>
                      <div className="nx-account-role">{roleLabel}</div>
                    </div>
                  </div>
                </div>
                <button className="nx-account-item" title="Operator Access" onClick={() => { playSound('notification'); setShowAccountMenu(false); navigate('/settings/operators'); }}>
                  <Users size={14} />
                  <span>Operator Access</span>
                </button>
                <button className="nx-account-item" title="System Settings" onClick={() => { playSound('notification'); setShowAccountMenu(false); navigate('/settings'); }}>
                  <Settings size={14} />
                  <span>System Settings</span>
                </button>
                <button className="nx-account-item nx-account-logout" title="Logout" onClick={() => { playSound('success'); setShowAccountMenu(false); logout(); navigate('/login'); }}>
                  <LogOut size={14} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Layout: Left Column | Center Hub | Right Column */}
      <div className="nx-layout">
        {/* Left Column */}
        <div className="nx-col nx-col-left">
          {leftModules.map((mod, i) => renderModuleCard(mod, i, 'left'))}
        </div>

        {/* Center — Dynamic Info */}
        <div
          className="nx-center"
          onMouseMove={perfLite ? undefined : handleCenterMouseMove}
          onMouseLeave={perfLite ? undefined : handleCenterMouseLeave}
        >
          <div
            ref={centerOrbRef}
            className={`nx-product-info ${selectedModule ? 'nx-product-active' : ''}`}
            key={selectedModule?.id ?? 'iris'}
            style={{ '--card-accent': selectedModule?.info.color ?? '#00F0FF' } as React.CSSProperties}
          >
            {/* Orbits behind */}
            <div className="nx-orbit-layer">
              <div className="nx-orbit nx-orbit-1"><div className="nx-orbit-dot" style={selectedModule ? { background: selectedModule.info.color, boxShadow: `0 0 8px ${selectedModule.info.color}` } : undefined} /></div>
              <div className="nx-orbit nx-orbit-2" />
              <div className="nx-orbit nx-orbit-3" />
            </div>
            <div className="nx-inner-layer">
              <div className="nx-inner-orbit nx-inner-orbit-1" />
              <div className="nx-inner-orbit nx-inner-orbit-2" />
              <div className="nx-inner-sat nx-inner-sat-1" />
              <div className="nx-inner-sat nx-inner-sat-2" />
            </div>

            {selectedModule ? (() => {
              const info = selectedModule.info;
              return (
                <>
                  {/* Status badge */}
                  <div className="nx-product-status nx-center-reveal" style={{ color: info.color }}>
                    <div className="nx-product-status-dot" style={{ background: info.color, boxShadow: `0 0 6px ${info.color}` }} />
                    <span>{info.status}</span>
                  </div>

                  {/* Module Icon + Name */}
                  <div className="nx-product-brand nx-center-reveal" style={{ '--mod-accent': info.color, animationDelay: '0.05s' } as React.CSSProperties}>
                    <div className="nx-product-logo" style={{ color: info.color }}>
                      <div className="nx-product-logo-glow" style={{ background: `radial-gradient(circle, ${info.color}22, transparent 70%)` }} />
                      <IrisEyeMark size={36} accent={info.color} />
                    </div>
                    <span className="nx-product-name" style={{ color: info.color }}>{selectedModule.label}</span>
                    <span className="nx-product-tagline">{selectedModule.sub}</span>
                  </div>

                  {/* Brief */}
                  <div className="nx-product-brief nx-center-reveal" style={{ animationDelay: '0.1s' }}>
                    <p className="nx-product-desc">{info.brief}</p>
                  </div>

                  {/* Features */}
                  <div className="nx-product-features nx-center-reveal" style={{ animationDelay: '0.15s', '--mod-accent': info.color } as React.CSSProperties}>
                    {info.features.map((f, i) => (
                      <span key={i} className="nx-product-feature">{f}</span>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="nx-product-stats nx-center-reveal" style={{ animationDelay: '0.2s', borderColor: `${info.color}15` }}>
                    {info.stats.map((s, i) => (
                      <div key={i} className="nx-product-stat" style={{ display: 'contents' }}>
                        {i > 0 && <div className="nx-product-stat-sep" />}
                        <div className="nx-product-stat">
                          <span className="nx-product-stat-val" style={{ color: info.color }}>{s.val}</span>
                          <span className="nx-product-stat-label">{s.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })() : (
              <>
                {/* IRIS Default */}
                <div className="nx-product-brand nx-center-reveal">
                  <div className="nx-product-logo">
                    <div className="nx-product-logo-glow" />
                    <IrisEyeMark size={36} accent="#00F0FF" />
                  </div>
                  <span className="nx-product-name">IRIS</span>
                  <span className="nx-product-tagline">Intelligent Response & Integrated Surveillance</span>
                </div>

                <div className="nx-product-brief nx-center-reveal" style={{ animationDelay: '0.08s' }}>
                  <p className="nx-product-desc">
                    Unified command center for real-time video management, traffic intelligence, crowd analytics, and automated threat detection.
                  </p>
                </div>

                <div className="nx-product-stats nx-center-reveal" style={{ animationDelay: '0.16s' }}>
                  <div className="nx-product-stat">
                    <span className="nx-product-stat-val">6</span>
                    <span className="nx-product-stat-label">Modules</span>
                  </div>
                  <div className="nx-product-stat-sep" />
                  <div className="nx-product-stat">
                    <span className="nx-product-stat-val">15</span>
                    <span className="nx-product-stat-label">Devices</span>
                  </div>
                  <div className="nx-product-stat-sep" />
                  <div className="nx-product-stat">
                    <span className="nx-product-stat-val">24/7</span>
                    <span className="nx-product-stat-label">Uptime</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="nx-col nx-col-right">
          {rightModules.map((mod, i) => renderModuleCard(mod, i, 'right'))}
        </div>
      </div>

      {/* Event Feed */}
      {feedItems.length > 0 && (
        <div className="nx-feed nx-fadein" style={{ animationDelay: '0.6s' }}>
          <div className="nx-feed-head">
            <div className="nx-feed-dot" />
            <span className="nx-feed-title">Live Alerts</span>
          </div>
          <div className="nx-feed-list">
            {feedItems.map((item) => (
              <div key={item.id} className={`nx-feed-item nx-feed-${item.tone}`}>
                <div className="nx-feed-thumb">
                  <div className="nx-feed-thumb-overlay" />
                  <span className="nx-feed-thumb-label">{item.cam}</span>
                </div>
                <div className="nx-feed-content">
                  <div className="nx-feed-top">
                    <span className="nx-feed-tag">{item.tag}</span>
                    <span className="nx-feed-time">{item.time}</span>
                  </div>
                  <span className="nx-feed-msg">{item.msg}</span>
                </div>
                <button
                  className="nx-feed-dismiss"
                  aria-label="Dismiss alert"
                  title="Dismiss"
                  onClick={() => dismissFeedItem(item)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="nx-statusbar nx-fadein-up">
        <div className="nx-statusbar-item">
          <div className="nx-statusbar-dot" />
          <span className="nx-statusbar-text">
            {selectedModule ? `${selectedModule.label} Module` : `IRIS Command Center • ${alertTotal} Total Alerts`}
          </span>
        </div>
      </div>

    </div>
  );
}
