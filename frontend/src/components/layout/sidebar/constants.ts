import {
  ScanFace, Monitor,
  BarChart3, Settings, Shield, Server, FileText, Bell, Radar,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface MenuItem {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  description: string;
  badge?: number;
  allowedRoles?: string[];
}

export interface MenuSection {
  id: string;
  label: string;
  items: MenuItem[];
}

export const menuSections: MenuSection[] = [
  {
    id: 'vms',
    label: 'VMS',
    items: [
      { id: 'live-feed', path: '/live-feed', label: 'Live Feed', icon: Monitor, description: 'Real-time surveillance feed' },
    ],
  },
  // TEMP DISABLED: Traffic Management
  // {
  //   id: 'traffic',
  //   label: 'Traffic Management',
  //   items: [
  //     { id: 'anpr', path: '/itms/anpr', label: 'ANPR', icon: Car, description: 'License plate recognition' },
  //     { id: 'vcc', path: '/itms/vcc', label: 'VCC', icon: TrendingUp, description: 'Vehicle counting' },
  //     { id: 'watchlist', path: '/itms/watchlist', label: 'Watchlist', icon: Eye, description: 'Monitored vehicles' },
  //   ],
  // },
  {
    id: 'crowd',
    label: 'Public Safety',
    items: [
      // TEMP DISABLED: Crowd Analytics
      // { id: 'crowd-analytics', path: '/crowd-analytics', label: 'Crowd Analytics', icon: Activity, description: 'Crowd density and movement intelligence' },
      { id: 'frs', path: '/frs', label: 'FRS (Face Recognition)', icon: ScanFace, description: 'Face recognition watchlist and detections' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    items: [
      { id: 'analytics-dashboard', path: '/dashboard', label: 'Dashboard', icon: BarChart3, description: 'Global analytics dashboard' },
      { id: 'gods-eye', path: '/gods-eye', label: "God's Eye (YOLOE)", icon: Radar, description: 'Promptable YOLOE live inference cockpit' },
      { id: 'alerts', path: '/analytics/alerts', label: 'Alerts', icon: Bell, description: 'Unread and historical alert activity' },
      { id: 'reports-page', path: '/reports', label: 'Reports', icon: FileText, description: 'Internal reports sitemap' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'settings', path: '/settings', label: 'Settings', icon: Settings, description: 'System configuration' },
      { id: 'operator-access', path: '/settings/operators', label: 'Operator Access', icon: Shield, description: 'Unlock/reset operators', allowedRoles: ['admin'] },
      { id: 'workers', path: '/settings/workers', label: 'Edge Workers', icon: Server, description: 'Worker management', allowedRoles: ['admin'] },
    ],
  },
];

export const colors = {
  bg: 'var(--background)',
  surface: 'var(--card)',
  surfaceHover: 'var(--accent)',
  surfaceActive: 'var(--accent)',
  border: 'var(--border)',
  borderHover: 'var(--ring)',
  textPrimary: 'var(--foreground)',
  textSecondary: 'var(--muted-foreground)',
  textMuted: 'var(--muted-foreground)',
  accent: 'var(--primary)',
  accentDim: 'color-mix(in srgb, var(--primary), transparent 85%)',
  accentPink: '#f472b6', // Keep specialized colors if needed, or map to charts
  accentPinkDim: 'rgba(244, 114, 182, 0.15)',
};


// export const userData = { name: 'Operator', role: 'Admin', initials: 'OP' };
