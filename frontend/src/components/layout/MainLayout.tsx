import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { ChevronRight, Bell, Sun, Moon } from 'lucide-react';
import { IRISSidebar } from './sidebar/IRISSidebar';
import { menuSections, colors } from './sidebar/constants';
import type { MenuItem } from './sidebar/constants';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { IrisEyeMark } from '@/components/brand/IrisEyeMark';



// Build a flat lookup: path → MenuItem
const allItems = menuSections.flatMap((s) => s.items);
const itemByPath = new Map(allItems.map((item) => [item.path, item]));

// Section default paths — the first logical route in each section
const SECTION_DEFAULT: Record<string, string> = {
  vms: '/live-feed',
  traffic: '/itms/anpr',
  crowd: '/public-safety/frs',
  analytics: '/dashboard',
  system: '/settings',
};

interface Crumb {
  label: string;
  path?: string;
  icon?: LucideIcon;
  isCurrent: boolean;
}

function buildBreadcrumbs(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [];

  // 1. Find the active section
  const activeSection = menuSections.find((s) =>
    s.items.some((i) => pathname === i.path || pathname.startsWith(i.path + '/'))
  );

  // 2. Find the exact active item (most specific match)
  let activeItem: MenuItem | undefined;
  let bestLen = 0;
  for (const item of allItems) {
    if (pathname === item.path || pathname.startsWith(item.path + '/')) {
      if (item.path.length > bestLen) {
        bestLen = item.path.length;
        activeItem = item;
      }
    }
  }

  // 3. Section crumb (links to section default page)
  const suppressSectionFor = new Set(['/itms/anpr']);

  if (activeSection && !suppressSectionFor.has(activeItem?.path || '')) {
    const sectionTarget = SECTION_DEFAULT[activeSection.id];
    // Only show section crumb if active item is not the section default itself
    if (sectionTarget && sectionTarget !== activeItem?.path) {
      crumbs.push({
        label: activeSection.label,
        path: sectionTarget,
        isCurrent: false,
      });
    } else if (!sectionTarget) {
      crumbs.push({ label: activeSection.label, isCurrent: false });
    }
  }

  // 4. For nested paths, find intermediate items
  // e.g. /itms/watchlist/rules → show Watchlist crumb before Watchlist Rules
  if (activeItem) {
    const parts = activeItem.path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const prefix = '/' + parts.slice(0, i).join('/');
      const parentItem = itemByPath.get(prefix);
      if (parentItem && parentItem.path !== activeItem.path) {
        // Avoid duplicate if it's the section default we already added
        const sectionTarget = activeSection ? SECTION_DEFAULT[activeSection.id] : undefined;
        if (parentItem.path !== sectionTarget) {
          crumbs.push({
            label: parentItem.label,
            path: parentItem.path,
            icon: parentItem.icon,
            isCurrent: false,
          });
        }
      }
    }

    // 5. Current page (no link)
    crumbs.push({
      label: activeItem.label,
      icon: activeItem.icon,
      isCurrent: true,
    });
  }

  return crumbs;
}

const crumbBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 10px',
  borderRadius: '0',
  border: 'none',
  backgroundColor: 'transparent',
  color: colors.textMuted,
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  transition: 'all 0.15s ease',
  fontFamily: "var(--font-ui)",
};

function ContentHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const crumbs = buildBreadcrumbs(location.pathname);

  return (
    <nav
      aria-label="breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        height: '64px',
        minHeight: '64px',
        maxHeight: '64px',
        borderBottom: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        position: 'sticky',
        top: 0,
        zIndex: 50,
        fontFamily: "var(--font-display)",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* IRIS root */}
        <button
          onClick={() => navigate('/')}
          style={crumbBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colors.surfaceHover;
            e.currentTarget.style.color = colors.textSecondary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          <IrisEyeMark size={16} accent="#00DCEF" />
          <span>IRIS</span>
        </button>

        {crumbs.map((crumb, idx) => {
          const CrumbIcon = crumb.icon;
          return (
            <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ChevronRight size={14} style={{ color: colors.textMuted }} />
              {crumb.isCurrent ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '0',
                    backgroundColor: colors.accentDim,
                    color: colors.accent,
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {CrumbIcon && <CrumbIcon size={14} strokeWidth={1.5} />}
                  <span>{crumb.label}</span>
                </div>
              ) : (
                <button
                  onClick={() => crumb.path && navigate(crumb.path)}
                  style={{
                    ...crumbBtnStyle,
                    cursor: crumb.path ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => {
                    if (crumb.path) {
                      e.currentTarget.style.backgroundColor = colors.surfaceHover;
                      e.currentTarget.style.color = colors.textSecondary;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = colors.textMuted;
                  }}
                >
                  {CrumbIcon && <CrumbIcon size={14} strokeWidth={1.5} />}
                  <span>{crumb.label}</span>
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          aria-label="Notifications"
          onClick={() => navigate('/analytics/alerts')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '0',
            border: `1px solid ${colors.border}`,
            backgroundColor: 'transparent',
            color: colors.textMuted,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colors.surfaceHover;
            e.currentTarget.style.borderColor = colors.borderHover;
            e.currentTarget.style.color = colors.textSecondary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          <Bell size={18} strokeWidth={1.5} />
        </button>

        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '0',
            border: `1px solid ${colors.border}`,
            backgroundColor: 'transparent',
            color: colors.textMuted,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colors.surfaceHover;
            e.currentTarget.style.borderColor = colors.borderHover;
            e.currentTarget.style.color = colors.textSecondary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.5} /> : <Moon size={18} strokeWidth={1.5} />}
        </button>
      </div>
    </nav>
  );
}

export function MainLayout() {
  const location = useLocation();
  const isHomePage = location.pathname === '/';
  const isLoginPage = location.pathname === '/login';

  if (isHomePage || isLoginPage) {
    return <Outlet />;
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: colors.bg,
        overflow: 'hidden',
      }}
    >
      <IRISSidebar />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
        className="app-shell-bg"
      >
        <ContentHeader />
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, scrollbarGutter: 'stable' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
