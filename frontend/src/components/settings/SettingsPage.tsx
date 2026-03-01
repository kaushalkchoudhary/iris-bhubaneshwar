import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Moon, Sun, Server, Shield, Bell, Palette, Database, FileText, Monitor } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTheme } from '@/contexts/ThemeContext';

// ---------- Toggle Switch ----------
function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${enabled ? 'bg-[var(--accent-color)]' : 'bg-muted'
        }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
      />
    </button>
  );
}

// ---------- General Tab ----------
function GeneralTab() {
  const [emailAlerts, setEmailAlerts] = useState(() => localStorage.getItem('iris_email_alerts') !== 'false');
  const [pushNotifs, setPushNotifs] = useState(() => localStorage.getItem('iris_push_notifs') !== 'false');
  const [soundAlerts, setSoundAlerts] = useState(() => localStorage.getItem('iris_sound_alerts') !== 'false');

  const persist = (key: string, val: boolean) => localStorage.setItem(key, String(val));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Platform Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Shield className="h-4 w-4 text-[var(--accent-color)]" />
            Platform Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-sm">Application</span>
            <span className="text-foreground text-sm font-medium">IRIS Command Center</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-sm">Version</span>
            <span className="text-foreground text-sm font-mono">2.0.0</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-sm">Build</span>
            <span className="text-foreground text-sm font-mono">2026.01.31-stable</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground text-sm">Environment</span>
            <span className="text-emerald-400 text-sm font-mono">Production</span>
          </div>
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Server className="h-4 w-4 text-[var(--accent-color)]" />
            Quick Links
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link
            to="/settings/workers"
            className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-accent/20 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Server className="h-4 w-4 text-muted-foreground group-hover:text-[var(--accent-color)] transition-colors" />
              <span className="text-foreground text-sm">Edge Workers</span>
            </div>
            <span className="text-muted-foreground text-xs">/settings/workers</span>
          </Link>
          <Link
            to="/dashboard"
            className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-accent/20 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-muted-foreground group-hover:text-[var(--accent-color)] transition-colors" />
              <span className="text-foreground text-sm">Analytics Reports</span>
            </div>
            <span className="text-muted-foreground text-xs">/dashboard</span>
          </Link>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Bell className="h-4 w-4 text-[var(--accent-color)]" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-foreground text-sm font-medium">Email Alerts</p>
                <p className="text-muted-foreground text-xs">Receive email notifications</p>
              </div>
              <Toggle
                enabled={emailAlerts}
                onToggle={() => {
                  const next = !emailAlerts;
                  setEmailAlerts(next);
                  persist('iris_email_alerts', next);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-foreground text-sm font-medium">Push Notifications</p>
                <p className="text-muted-foreground text-xs">Browser push alerts</p>
              </div>
              <Toggle
                enabled={pushNotifs}
                onToggle={() => {
                  const next = !pushNotifs;
                  setPushNotifs(next);
                  persist('iris_push_notifs', next);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-foreground text-sm font-medium">Sound Alerts</p>
                <p className="text-muted-foreground text-xs">Audible alert sounds</p>
              </div>
              <Toggle
                enabled={soundAlerts}
                onToggle={() => {
                  const next = !soundAlerts;
                  setSoundAlerts(next);
                  persist('iris_sound_alerts', next);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Appearance Tab ----------
const ACCENT_COLORS = [
  { name: 'Indigo', value: 'indigo', class: 'bg-indigo-500' },
  { name: 'Blue', value: 'blue', class: 'bg-blue-500' },
  { name: 'Emerald', value: 'emerald', class: 'bg-emerald-500' },
  { name: 'Amber', value: 'amber', class: 'bg-amber-500' },
  { name: 'Rose', value: 'rose', class: 'bg-rose-500' },
];

function AppearanceTab() {
  const { theme, toggleTheme } = useTheme();
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('iris_font_size') || 'medium');
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('iris_accent_color') || 'indigo');

  const applyFontSize = useCallback((size: string) => {
    setFontSize(size);
    localStorage.setItem('iris_font_size', size);

    // Apply font size to document root
    const root = document.documentElement;
    if (size === 'small') {
      root.style.fontSize = '14px';
    } else if (size === 'medium') {
      root.style.fontSize = '16px';
    } else if (size === 'large') {
      root.style.fontSize = '18px';
    }
  }, []);

  const applyAccent = useCallback((color: string) => {
    setAccentColor(color);
    localStorage.setItem('iris_accent_color', color);

    // Apply accent color as CSS custom property
    const root = document.documentElement;
    const colorMap: Record<string, string> = {
      indigo: '#6366f1',
      blue: '#3b82f6',
      emerald: '#10b981',
      amber: '#f59e0b',
      rose: '#f43f5e',
    };
    const hexColor = colorMap[color] || colorMap.indigo;

    // Force specific variables to update via JS
    root.style.setProperty('--accent-color', hexColor);
    root.style.setProperty('--primary', hexColor);
    root.style.setProperty('--ring', hexColor);
    root.style.setProperty('--sidebar-primary', hexColor);
    root.style.setProperty('--sidebar-ring', hexColor);
  }, []);

  // Initialize settings on component mount
  useEffect(() => {
    applyFontSize(fontSize);
    applyAccent(accentColor);
  }, [fontSize, accentColor, applyFontSize, applyAccent]);

  // Helper to set theme to a specific value
  const setThemeTo = (target: 'dark' | 'light') => {
    if (theme !== target) toggleTheme();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Palette className="h-4 w-4 text-[var(--accent-color)]" />
            Theme
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button
              variant={theme === 'dark' ? 'indigo' : 'ghost'}
              size="sm"
              onClick={() => setThemeTo('dark')}
              className="flex items-center gap-2"
            >
              <Moon className="h-4 w-4" />
              Dark
            </Button>
            <Button
              variant={theme === 'light' ? 'indigo' : 'ghost'}
              size="sm"
              onClick={() => setThemeTo('light')}
              className="flex items-center gap-2"
            >
              <Sun className="h-4 w-4" />
              Light
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center gap-2 opacity-50 cursor-not-allowed"
              disabled
            >
              <Monitor className="h-4 w-4" />
              System
            </Button>
          </div>
          <p className="text-muted-foreground text-xs mt-3">
            Current: <span className="text-foreground">{theme}</span>
          </p>
        </CardContent>
      </Card>

      {/* Font Size */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Settings className="h-4 w-4 text-[var(--accent-color)]" />
            Font Size
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {(['small', 'medium', 'large'] as const).map((size) => (
              <Button
                key={size}
                variant={fontSize === size ? 'indigo' : 'ghost'}
                size="sm"
                onClick={() => applyFontSize(size)}
                className="capitalize"
              >
                {size}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs mt-3">
            Current: <span className="text-foreground">{fontSize}</span>
          </p>
        </CardContent>
      </Card>

      {/* Accent Color */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Palette className="h-4 w-4 text-[var(--accent-color)]" />
            Accent Color
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            {ACCENT_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => applyAccent(c.value)}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg transition-colors ${accentColor === c.value ? 'bg-accent/10 ring-1 ring-ring/20' : 'hover:bg-accent/5'
                  }`}
              >
                <div className={`h-8 w-8 rounded-full ${c.class} ${accentColor === c.value ? 'ring-2 ring-background ring-offset-2 ring-offset-background' : ''
                  }`} />
                <span className="text-muted-foreground text-xs">{c.name}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- System Tab ----------
function SystemTab() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [storageUsage, setStorageUsage] = useState('');
  const [cacheCleared, setCacheCleared] = useState(false);

  const checkApiStatus = useCallback(async () => {
    setApiStatus('checking');
    try {
      const res = await fetch('/api/devices?limit=1');
      setApiStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setApiStatus('disconnected');
    }
  }, []);

  const calculateStorage = useCallback(() => {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        total += localStorage.getItem(key)?.length || 0;
      }
    }
    const kb = (total * 2) / 1024; // UTF-16 = 2 bytes per char
    setStorageUsage(kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`);
  }, []);

  useEffect(() => {
    checkApiStatus();
    calculateStorage();
  }, [checkApiStatus, calculateStorage]);

  const handleClearCache = () => {
    localStorage.clear();
    setCacheCleared(true);
    calculateStorage();
    setTimeout(() => setCacheCleared(false), 3000);
  };

  const statusColor =
    apiStatus === 'connected'
      ? 'text-emerald-400'
      : apiStatus === 'disconnected'
        ? 'text-red-400'
        : 'text-amber-400';

  const statusDot =
    apiStatus === 'connected'
      ? 'bg-emerald-400'
      : apiStatus === 'disconnected'
        ? 'bg-red-400'
        : 'bg-amber-400 animate-pulse';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* API Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Server className="h-4 w-4 text-indigo-400" />
            Api Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Connection</span>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${statusDot}`} />
              <span className={`text-sm font-mono ${statusColor}`}>
                {apiStatus}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Endpoint</span>
            <span className="text-foreground text-sm font-mono">/api/devices</span>
          </div>
          <Button variant="ghost" size="sm" onClick={checkApiStatus} className="w-full mt-2">
            Retry Connection
          </Button>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Database className="h-4 w-4 text-[var(--accent-color)]" />
            Storage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">LocalStorage Used</span>
            <span className="text-foreground text-sm font-mono">{storageUsage}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Keys Stored</span>
            <span className="text-foreground text-sm font-mono">{localStorage.length}</span>
          </div>
          <div className="w-full bg-muted/50 rounded-full h-1.5 mt-1">
            <div
              className="bg-[var(--accent-color)] h-1.5 rounded-full transition-all"
              style={{ width: `${Math.min((localStorage.length / 50) * 100, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Debug */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm tracking-wider">
            <Shield className="h-4 w-4 text-indigo-400" />
            Debug
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearCache}
            >
              {cacheCleared ? 'Cache Cleared!' : 'Clear Cache'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Open browser dev tools console - most browsers don't allow programmatic opening,
                // but we can log a message and use keyboard shortcut hint
                console.log('%c[IRIS DEVMODE] Console opened from Settings', 'color: #818cf8; font-size: 14px;');
                alert('Press F12 or Ctrl+Shift+I to open Developer Console');
              }}
            >
              Open Console
            </Button>
          </div>
          {cacheCleared && (
            <p className="text-emerald-400 text-xs mt-3 animate-pulse">
              All cached data has been cleared. Some settings may reset on reload.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Settings Page ----------
export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full overflow-y-auto p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="h-6 w-6 text-[var(--accent-color)]" />
          <h1 className="text-xl font-bold text-foreground">
            Settings
          </h1>
        </div>
        <p className="text-muted-foreground text-sm tracking-wide">
          Devmode // Configuration & Preferences
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>

        <TabsContent value="system">
          <SystemTab />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
