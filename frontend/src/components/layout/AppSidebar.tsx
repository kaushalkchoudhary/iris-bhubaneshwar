import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Camera, BarChart3, Settings,
  ChevronDown, Hexagon, Sun, Moon, PanelLeftClose, PanelLeft, ScanFace, FileText, Radar
} from 'lucide-react';
import {
  Sidebar,
  useSidebar,
} from '@/components/ui/sidebar';
import { useTheme } from '@/contexts/ThemeContext';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<any>;
  badge?: number;
}

interface NavModule {
  id: string;
  label: string;
  displayLabel?: string;
  icon: React.ComponentType<any>;
  items: NavItem[];
  subGroups?: {
    id: string;
    label: string;
    icon: React.ComponentType<any>;
    items: NavItem[];
  }[];
}

const modules: NavModule[] = [
  {
    id: 'vms',
    label: 'VMS',
    icon: Camera,
    items: [
      { path: '/live-feed', label: 'Live Feed', icon: Camera },
    ],
  },
  {
    id: 'public-safety',
    label: 'Public Safety',
    icon: ScanFace,
    items: [
      { path: '/public-safety/frs', label: 'Face Recognition', icon: ScanFace },
      { path: '/public-safety/gods-eye', label: "God's Eye", icon: Radar },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      { path: '/settings', label: 'General', icon: Settings },
    ],
  },
];

// Flatten modules into visual sections (ITMS splits into Traffic Management + TV Dashboards)
interface SidebarSection {
  id: string;
  label: string;
  expandKey: string;
  items: NavItem[];
}

const sections: SidebarSection[] = modules.flatMap(mod => {
  const result: SidebarSection[] = [
    { id: mod.id, label: mod.displayLabel || mod.label, expandKey: mod.id, items: mod.items }
  ];
  if (mod.subGroups) {
    for (const sg of mod.subGroups) {
      result.push({
        id: `${mod.id}-${sg.id}`,
        label: sg.label,
        expandKey: `${mod.id}-${sg.id}`,
        items: sg.items,
      });
    }
  }
  return result;
});

const colors = {
  bg: '#141414',
  surface: '#1e1e1e',
  surfaceHover: '#262626',
  surfaceActive: '#2a2a2a',
  border: 'rgba(255,255,255,0.06)',
  borderHover: 'rgba(255,255,255,0.1)',
  textPrimary: '#f5f5f5',
  textSecondary: '#a1a1a1',
  textMuted: '#5c5c5c',
  accent: '#4ade80',
  accentDim: 'rgba(74, 222, 128, 0.15)',
  accentPink: '#f472b6',
  accentPinkDim: 'rgba(244, 114, 182, 0.15)',
};

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const { theme, toggleTheme } = useTheme();

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const mod of modules) {
      if (mod.items.some(i => pathname === i.path || pathname.startsWith(i.path + '/'))) {
        initial[mod.id] = true;
      }
      mod.subGroups?.forEach(sg => {
        if (sg.items.some(i => pathname === i.path || pathname.startsWith(i.path + '/'))) {
          initial[`${mod.id}-${sg.id}`] = true;
        }
      });
    }
    if (Object.keys(initial).length === 0) {
      initial['public-safety'] = true;
    }
    return initial;
  });

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isActive = (path: string) => {
    if (path === '/itms') return pathname === '/itms';
    if (path === '/settings') return pathname === '/settings';
    return pathname === path || pathname.startsWith(path + '/');
  };

  return (
    <Sidebar collapsible="icon">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .iris-menu-item:hover {
          background-color: ${colors.surfaceHover} !important;
        }
        .iris-menu-item:hover .iris-menu-label {
          color: ${colors.textPrimary} !important;
        }
        .iris-menu-item:hover .iris-menu-icon svg {
          color: ${colors.textSecondary} !important;
        }
        .iris-menu-item.iris-active:hover {
          background-color: ${colors.surfaceActive} !important;
        }
        .iris-collapse-toggle:hover {
          background-color: ${colors.accent} !important;
          color: ${colors.bg} !important;
          border-color: ${colors.accent} !important;
        }
        .iris-theme-toggle:hover {
          background-color: ${colors.surfaceHover} !important;
        }
        .iris-section-header:hover {
          background-color: ${colors.surfaceHover};
        }
        [data-sidebar="sidebar"] nav::-webkit-scrollbar {
          display: none;
        }
        [data-sidebar="sidebar"] nav {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Header */}
      <div
        onClick={() => navigate('/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '0 16px',
          height: '64px',
          minHeight: '64px',
          maxHeight: '64px',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          borderBottom: `1px solid ${colors.border}`,
          cursor: 'pointer',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '38px',
          height: '38px',
          borderRadius: '12px',
          backgroundColor: colors.accentDim,
          transition: 'transform 0.2s ease',
          flexShrink: 0,
        }}>
          <Hexagon size={20} strokeWidth={1.5} style={{ color: colors.accent }} />
        </div>

        {!isCollapsed && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            whiteSpace: 'nowrap',
          }}>
            <span style={{
              fontSize: '16px',
              fontWeight: 700,
              color: colors.textPrimary,
              letterSpacing: '-0.02em',
            }}>
              IRIS
            </span>
            <span style={{
              fontSize: '10px',
              color: colors.textMuted,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginTop: '1px',
            }}>
              Command Center
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: isCollapsed ? '8px 4px' : '12px 8px',
      }}>
        {isCollapsed ? (
          /* Collapsed mode: show only module-level icons */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {modules.map((mod) => {
              const ModIcon = mod.icon;
              const modActive = mod.items.some(i => isActive(i.path)) ||
                mod.subGroups?.some(sg => sg.items.some(i => isActive(i.path)));
              const firstPath = mod.items[0]?.path || '/';

              return (
                <button
                  key={mod.id}
                  onClick={() => navigate(firstPath)}
                  className={`iris-menu-item ${modActive ? 'iris-active' : ''}`}
                  title={mod.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    padding: '8px 4px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    backgroundColor: modActive ? colors.surfaceActive : 'transparent',
                  }}
                >
                  <div className="iris-menu-icon" style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '30px',
                    height: '30px',
                    borderRadius: '8px',
                    backgroundColor: modActive ? colors.accentDim : 'transparent',
                    transition: 'all 0.15s ease',
                  }}>
                    <ModIcon
                      size={18}
                      strokeWidth={1.5}
                      style={{
                        color: modActive ? colors.accent : colors.textMuted,
                        transition: 'color 0.15s ease',
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Expanded mode: show full sections with items */
          sections.map((section, sIdx) => {
            const isExpanded = expandedGroups[section.expandKey];

            return (
              <div key={section.id} style={{ marginBottom: '4px' }}>
                {/* Separator between sections */}
                {sIdx > 0 && (
                  <div style={{
                    height: '1px',
                    margin: '8px 8px',
                    background: `linear-gradient(90deg, transparent, ${colors.border}, transparent)`,
                  }} />
                )}

                {/* Section header */}
                <button
                  onClick={() => toggleGroup(section.expandKey)}
                  className="iris-section-header"
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
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      backgroundColor: colors.accent,
                      opacity: 0.6,
                    }} />
                    <span style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontWeight: 500,
                      color: colors.textMuted,
                      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
                    }}>
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

                {/* Items container with collapse animation */}
                <div style={{
                  overflow: 'hidden',
                  transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                  maxHeight: !isExpanded ? 0 : '800px',
                  opacity: !isExpanded ? 0 : 1,
                  paddingLeft: '4px',
                  paddingRight: '4px',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {section.items.map((item, idx) => {
                      const active = isActive(item.path);
                      const Icon = item.icon;

                      return (
                        <div
                          key={item.path}
                          style={{
                            animation: isExpanded ? `slideIn 0.3s ease forwards` : 'none',
                            animationDelay: `${idx * 0.02}s`,
                            opacity: 0,
                          }}
                        >
                          <button
                            onClick={() => navigate(item.path)}
                            className={`iris-menu-item ${active ? 'iris-active' : ''}`}
                            style={{
                              position: 'relative',
                              display: 'flex',
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: '10px',
                              width: '100%',
                              padding: '6px 12px',
                              borderRadius: '8px',
                              border: 'none',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              justifyContent: 'flex-start',
                              backgroundColor: active ? colors.surfaceActive : 'transparent',
                              color: active ? colors.textPrimary : colors.textSecondary,
                            }}
                          >
                            {/* Active indicator line */}
                            {active && (
                              <div style={{
                                position: 'absolute',
                                left: 0,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: '3px',
                                height: '20px',
                                borderRadius: '0 4px 4px 0',
                                backgroundColor: colors.accent,
                              }} />
                            )}

                            {/* Icon container */}
                            <div className="iris-menu-icon" style={{
                              position: 'relative',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              backgroundColor: active ? colors.accentDim : 'transparent',
                              transition: 'all 0.15s ease',
                              flexShrink: 0,
                            }}>
                              <Icon
                                size={18}
                                strokeWidth={1.5}
                                style={{
                                  color: active ? colors.accent : colors.textMuted,
                                  transition: 'color 0.15s ease',
                                }}
                              />
                              {item.badge && (
                                <div style={{
                                  position: 'absolute',
                                  top: '0px',
                                  right: '0px',
                                  width: '7px',
                                  height: '7px',
                                  borderRadius: '50%',
                                  backgroundColor: colors.accentPink,
                                  border: `2px solid ${colors.bg}`,
                                }} />
                              )}
                            </div>

                            {/* Label */}
                            <span className="iris-menu-label" style={{
                              fontSize: '13px',
                              fontWeight: active ? 500 : 400,
                              letterSpacing: '-0.01em',
                              textAlign: 'left',
                              lineHeight: 1.4,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'normal',
                              transition: 'color 0.15s ease',
                            }}>
                              {item.label}
                            </span>

                            {/* Badge */}
                            {item.badge && (
                              <span style={{
                                marginLeft: 'auto',
                                padding: '2px 8px',
                                fontSize: '10px',
                                fontWeight: 600,
                                borderRadius: '6px',
                                backgroundColor: colors.accentPinkDim,
                                color: colors.accentPink,
                              }}>
                                {item.badge}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </nav>

      {/* Footer */}
      <div style={{
        padding: isCollapsed ? '8px 4px' : '12px',
        borderTop: `1px solid ${colors.border}`,
      }}>
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="iris-theme-toggle"
          title={isCollapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            padding: isCollapsed ? '6px' : '10px 12px',
            borderRadius: isCollapsed ? '8px' : '10px',
            border: 'none',
            backgroundColor: 'transparent',
            color: colors.textSecondary,
            cursor: 'pointer',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: isCollapsed ? '28px' : '32px',
            height: isCollapsed ? '28px' : '32px',
            borderRadius: '8px',
            backgroundColor: colors.surface,
            flexShrink: 0,
          }}>
            {theme === 'dark' ? <Sun size={isCollapsed ? 14 : 16} strokeWidth={1.5} /> : <Moon size={isCollapsed ? 14 : 16} strokeWidth={1.5} />}
          </div>
          {!isCollapsed && (
            <span style={{ fontSize: '13px', fontWeight: 500 }}>
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </span>
          )}
        </button>

        {/* User Profile */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: isCollapsed ? '6px' : '10px 12px',
            marginTop: isCollapsed ? '4px' : '6px',
            borderRadius: isCollapsed ? '8px' : '12px',
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: isCollapsed ? '28px' : '34px',
              height: isCollapsed ? '28px' : '34px',
              borderRadius: isCollapsed ? '8px' : '10px',
              background: `linear-gradient(135deg, ${colors.accent}35 0%, ${colors.accent}15 100%)`,
            }}>
              <span style={{
                fontSize: isCollapsed ? '10px' : '12px',
                fontWeight: 700,
                color: colors.accent,
              }}>
                OP
              </span>
            </div>
            <div style={{
              position: 'absolute',
              bottom: '-2px',
              right: '-2px',
              width: isCollapsed ? '8px' : '10px',
              height: isCollapsed ? '8px' : '10px',
              borderRadius: '50%',
              backgroundColor: colors.accent,
              border: `2px solid ${colors.bg}`,
              boxShadow: `0 0 6px ${colors.accent}60`,
            }} />
          </div>

          {!isCollapsed && (
            <div style={{
              flex: 1,
              minWidth: 0,
            }}>
              <div style={{
                fontSize: '13px',
                fontWeight: 600,
                color: colors.textPrimary,
              }}>
                Operator
              </div>
              <div style={{
                fontSize: '10px',
                color: colors.textMuted,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                marginTop: '1px',
              }}>
                Admin
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={toggleSidebar}
        className="iris-collapse-toggle"
        style={{
          position: 'absolute',
          top: '50%',
          right: '-17px',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
          color: colors.textMuted,
          cursor: 'pointer',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 100,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        {isCollapsed ? (
          <PanelLeft size={16} strokeWidth={1.5} />
        ) : (
          <PanelLeftClose size={16} strokeWidth={1.5} />
        )}
      </button>
    </Sidebar>
  );
}
