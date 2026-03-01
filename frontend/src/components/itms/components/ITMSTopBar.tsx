import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Car, TrendingUp, AlertTriangle, Eye, CheckSquare, HardDrive, Monitor } from 'lucide-react';

const ITMS_ROUTES = [
  { path: '/itms/anpr', label: 'ANPR', icon: Car },
  { path: '/itms/vcc', label: 'VCC', icon: TrendingUp },
  { path: '/itms/violations', label: 'Violations', icon: AlertTriangle },
  { path: '/itms/watchlist', label: 'Watchlist', icon: Eye },
  { path: '/itms/review', label: 'Review', icon: CheckSquare },
];

const TV_ROUTES = [
  { path: '/itms/tv/toc-overview', label: 'TOC', icon: Monitor },
  { path: '/itms/tv/violations-wall', label: 'Wall', icon: AlertTriangle },
  { path: '/itms/tv/traffic-flow', label: 'Flow', icon: TrendingUp },
  { path: '/itms/tv/watchlist-monitoring', label: 'Watchlist TV', icon: Eye },
  { path: '/itms/tv/device-status', label: 'Devices TV', icon: HardDrive },
];

function getHeading(pathname: string): string {
  if (pathname.startsWith('/itms/tv')) return 'ITMS TV Dashboards';
  if (pathname.startsWith('/itms/anpr')) return 'ITMS / ANPR';
  if (pathname.startsWith('/itms/vcc')) return 'ITMS / VCC';
  if (pathname.startsWith('/itms/violations')) return 'ITMS / Violations';
  if (pathname.startsWith('/itms/watchlist')) return 'ITMS / Watchlist';
  if (pathname.startsWith('/itms/review')) return 'ITMS / Review Center';
  return 'Intelligent Traffic Management';
}

export function ITMSTopBar() {
  const location = useLocation();
  const navigate = useNavigate();

  const pathname = location.pathname;

  const activeMain = useMemo(
    () => ITMS_ROUTES.find((r) => pathname === r.path || pathname.startsWith(r.path + '/'))?.path,
    [pathname]
  );

  const activeTv = useMemo(
    () => TV_ROUTES.find((r) => pathname === r.path)?.path,
    [pathname]
  );

  const heading = useMemo(() => getHeading(pathname), [pathname]);

  return (
    <div className="w-full h-14 flex items-center justify-between px-6 border-b border-border bg-background/95 backdrop-blur-sm">
      {/* Left: Heading */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">ITMS</span>
        <h1 className="text-sm md:text-lg font-semibold text-foreground ">
          {heading}
        </h1>
      </div>

      {/* Right: Submenu */}
      <div className="flex items-center gap-4">
        {/* Main views */}
        <div className="hidden lg:flex items-center gap-1 bg-muted/40 border border-border rounded-full px-1 py-1">
          {ITMS_ROUTES.map((route) => {
            const Icon = route.icon;
            const isActive = activeMain === route.path;
            return (
              <Button
                key={route.path}
                variant="ghost"
                size="sm"
                onClick={() => navigate(route.path)}
                className={cn(
                  'h-8 px-3 rounded-full text-[11px] flex items-center gap-1 border transition-all',
                  isActive
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground/80 hover:bg-muted/60'
                )}
              >
                <Icon className="w-3 h-3" />
                <span className="hidden xl:inline">{route.label}</span>
              </Button>
            );
          })}
        </div>

        {/* TV quick access */}
        <div className="flex items-center gap-1 bg-muted/40 border border-border rounded-full px-1 py-1">
          {TV_ROUTES.map((route) => {
            const Icon = route.icon;
            const isActive = activeTv === route.path;
            return (
              <Button
                key={route.path}
                variant="ghost"
                size="sm"
                onClick={() => navigate(route.path)}
                className={cn(
                  'h-8 px-2 rounded-full text-[10px] flex items-center gap-1 border transition-all',
                  isActive
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground/80 hover:bg-muted/60'
                )}
              >
                <Icon className="w-3 h-3" />
                <span className="hidden xl:inline">{route.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
