import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, PanelLeftClose, PanelLeft } from 'lucide-react';
import { colors, menuSections } from './constants';
import { SidebarHeader } from './SidebarHeader';
import { SidebarFooter } from './SidebarFooter';
import { useAuth } from '@/contexts/AuthContext';
import type { MenuItem as MenuItemType } from './constants';
import { apiClient } from '@/lib/api';

interface MenuItemProps {
  item: MenuItemType;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function MenuItem({ item, isActive, collapsed, onClick }: MenuItemProps) {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: collapsed ? '0' : '10px',
        width: '100%',
        padding: collapsed ? '8px 6px' : '6px 12px',
        borderRadius: '0',
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        justifyContent: collapsed ? 'center' : 'flex-start',
        backgroundColor: isActive ? colors.surfaceActive : 'transparent',
        color: isActive ? colors.textPrimary : colors.textSecondary,
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = colors.surfaceHover;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {!collapsed && isActive && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: '3px',
            height: '20px',
            borderRadius: '0 4px 4px 0',
            backgroundColor: colors.accent,
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          flexShrink: 0,
          borderRadius: '6px',
          backgroundColor: isActive ? colors.accentDim : 'transparent',
          transition: 'all 0.15s ease',
          position: 'relative',
        }}
      >
        <Icon
          size={collapsed ? 16 : 18}
          strokeWidth={1.5}
          style={{
            color: isActive ? colors.accent : colors.textMuted,
            transition: 'color 0.15s ease',
          }}
        />
        {item.badge && collapsed && (
          <div
            style={{
              position: 'absolute',
              top: '0px',
              right: '0px',
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: colors.accentPink,
              border: `2px solid ${colors.bg}`,
            }}
          />
        )}
      </div>

      <span
        style={{
          display: collapsed ? 'none' : 'block',
          fontSize: collapsed ? '9px' : '13px',
          fontWeight: isActive ? 500 : 400,
          letterSpacing: collapsed ? '0.02em' : '-0.01em',
          textAlign: collapsed ? 'center' : 'left',
          lineHeight: collapsed ? '1.1' : '1.4',
          maxWidth: collapsed ? '56px' : 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: collapsed ? 'nowrap' : 'normal',
          transition: 'color 0.15s ease',
        }}
      >
        {item.label}
      </span>

      {item.badge && !collapsed && (
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '20px',
            height: '20px',
            padding: '0 6px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            backgroundColor: colors.accentPinkDim,
            color: colors.accentPink,
            border: `1px solid rgba(244, 114, 182, 0.2)`,
            borderRadius: '6px',
          }}
        >
          {item.badge}
        </span>
      )}
    </button>
  );
}

interface SectionProps {
  section: typeof menuSections[number];
  collapsed: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  activeItemPath: string;
  onNavigate: (path: string) => void;
}

function Section({ section, collapsed, isExpanded, onToggle, activeItemPath, onNavigate }: SectionProps) {
  const isItemActive = (item: MenuItemType) => {
    if (item.path === '/itms') return activeItemPath === '/itms';
    if (item.path === '/settings') return activeItemPath === '/settings';
    return activeItemPath === item.path || activeItemPath.startsWith(item.path + '/');
  };

  return (
    <div style={{ marginBottom: '4px' }}>
      {!collapsed && (
        <button
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '8px 12px',
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            borderRadius: '8px',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = colors.surfaceHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: colors.accent,
                opacity: 0.6,
              }}
            />
            <span
              style={{
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 500,
                color: colors.textMuted,
                fontFamily: "var(--font-mono)",
              }}
            >
              {section.label}
            </span>
          </div>
          <ChevronDown
            size={14}
            style={{
              color: colors.textMuted,
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        </button>
      )}

      {collapsed && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
          <div
            style={{
              width: '20px',
              height: '2px',
              borderRadius: '2px',
              backgroundColor: colors.border,
            }}
          />
        </div>
      )}

      <div
        style={{
          overflow: 'hidden',
          transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          maxHeight: !collapsed && !isExpanded ? 0 : '800px',
          opacity: !collapsed && !isExpanded ? 0 : 1,
          paddingLeft: collapsed ? 0 : '4px',
          paddingRight: collapsed ? 0 : '4px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {section.items.map((item) => (
            <MenuItem
              key={item.id}
              item={item}
              isActive={isItemActive(item)}
              collapsed={collapsed}
              onClick={() => onNavigate(item.path)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function IRISSidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  const [collapsed, setCollapsed] = useState(false);
  const [liveBadges, setLiveBadges] = useState<{ violations?: number; alerts?: number }>({});
  // const [darkMode, setDarkMode] = useState(true); // Removed local state

  useEffect(() => {
    let cancelled = false;

    const loadBadges = async () => {
      try {
        const [violationStats, alertStats] = await Promise.all([
          apiClient.getViolationStats(),
          apiClient.getAlertStats(),
        ]);

        if (!cancelled) {
          setLiveBadges({
            violations: violationStats.total > 0 ? violationStats.total : undefined,
            alerts: alertStats.unread > 0 ? alertStats.unread : undefined,
          });
        }
      } catch {
        if (!cancelled) {
          // Hide badges if stats cannot be loaded instead of showing stale/fake values.
          setLiveBadges({});
        }
      }
    };

    void loadBadges();
    const timer = window.setInterval(() => {
      void loadBadges();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const sectionsWithLiveBadges = useMemo(() => {
    return menuSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.id === 'violations') {
          return { ...item, badge: liveBadges.violations };
        }
        if (item.id === 'alerts') {
          return { ...item, badge: liveBadges.alerts };
        }
        return item;
      }),
    }));
  }, [liveBadges]);

  // Filter menu sections based on user role
  const filteredSections = useMemo(() => (
    sectionsWithLiveBadges.map(section => ({
      ...section,
      items: section.items.filter(item => {
        if (!item.allowedRoles) return true;
        // If allowedRoles is defined, user must exist and have the role
        // Note: Admin role usually has access to everything, but here we strictly follow allowedRoles if present
        // If we want admins to see everything by default, we can add: if (user?.role === 'admin') return true;
        return user && item.allowedRoles.includes(user.role);
      })
    })).filter(section => section.items.length > 0)
  ), [sectionsWithLiveBadges, user]);
  const [expandedSections, setExpandedSections] = useState<string[]>(() => {
    // Auto-expand sections that contain the active route
    const active: string[] = [];
    for (const section of sectionsWithLiveBadges) {
      const hasMatch = section.items.some(
        (item) => pathname === item.path || pathname.startsWith(item.path + '/')
      );
      if (hasMatch) active.push(section.id);
    }
    return active.length > 0 ? active : ['traffic'];
  });

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]
    );
  };

  useEffect(() => {
    const activeSectionIds = filteredSections
      .filter((section) =>
        section.items.some((item) => pathname === item.path || pathname.startsWith(item.path + '/'))
      )
      .map((section) => section.id);

    if (activeSectionIds.length === 0) return;

    setExpandedSections((prev) => {
      const merged = new Set([...prev, ...activeSectionIds]);
      const next = Array.from(merged);
      if (next.length === prev.length && next.every((id) => prev.includes(id))) {
        return prev;
      }
      return next;
    });
  }, [pathname, filteredSections]);

  return (
    <aside
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: collapsed ? '104px' : '280px',
        minWidth: collapsed ? '104px' : '280px',
        backgroundColor: colors.bg,
        borderRight: `1px solid ${colors.border}`,
        transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        fontFamily: "var(--font-ui)",
        overflow: 'hidden',
      }}
    >
      <SidebarHeader collapsed={collapsed} />

      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 8px',
        }}
      >
        {filteredSections.map((section, idx) => (
          <React.Fragment key={section.id}>
            {idx > 0 && !collapsed && (
              <div
                style={{
                  height: '1px',
                  margin: '8px 8px',
                  background: `linear-gradient(90deg, transparent, ${colors.border}, transparent)`,
                }}
              />
            )}
            <Section
              section={section}
              collapsed={collapsed}
              isExpanded={expandedSections.includes(section.id)}
              onToggle={() => toggleSection(section.id)}
              activeItemPath={pathname}
              onNavigate={(path) => navigate(path)}
            />
          </React.Fragment>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
        style={{
          position: 'absolute',
          top: '50%',
          right: '-17px',
          transform: 'translateY(-50%)',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
          color: colors.textMuted,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.accent;
          e.currentTarget.style.color = colors.bg;
          e.currentTarget.style.borderColor = colors.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = colors.surface;
          e.currentTarget.style.color = colors.textMuted;
          e.currentTarget.style.borderColor = colors.border;
        }}
      >
        {collapsed ? <PanelLeft size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
      </button>

      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
