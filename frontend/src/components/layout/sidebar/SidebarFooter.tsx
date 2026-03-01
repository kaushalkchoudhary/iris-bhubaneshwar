import { LogOut, Shield, User } from 'lucide-react';
import { colors } from './constants';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { playSound } from '@/hooks/useSound';

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const role = (user?.role || '').toLowerCase();
  const roleLabel = role === 'admin' ? 'Admin' : (role === 'operator' ? 'Operator' : 'Guest');
  const roleIcon = role === 'admin' ? Shield : User;
  const roleColor = role === 'admin' ? '#22d3ee' : '#38bdf8';

  return (
    <div
      style={{
        padding: collapsed ? '12px 8px' : '12px',
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: collapsed ? '8px' : '10px',
          padding: collapsed ? '8px 8px' : '8px 10px',
          borderRadius: '0px',
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}cc`,
          justifyContent: collapsed ? 'center' : 'space-between',
          transition: 'all 0.15s ease',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '0px',
              flexShrink: 0,
              backgroundColor: 'color-mix(in srgb, var(--primary), transparent 85%)',
              border: `1px solid ${colors.border}`,
              color: roleColor,
              boxShadow: 'inset 0 0 10px rgba(0,0,0,0.2)',
            }}
          >
            {(() => {
              const Icon = roleIcon;
              return <Icon size={18} strokeWidth={1.85} />;
            })()}
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: colors.textPrimary,
                  lineHeight: 1.1,
                }}
              >
                {roleLabel}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: colors.textMuted,
                  letterSpacing: '0.02em',
                  textTransform: 'none',
                  marginTop: '3px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '158px',
                }}
              >
                {user?.email || 'No identity'}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            playSound('notification');
            logout();
            navigate('/login', { replace: true });
          }}
          aria-label="Logout"
          title={collapsed ? 'Logout' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '0px',
            border: `1px solid ${colors.border}`,
            backgroundColor: 'transparent',
            color: colors.textSecondary,
            cursor: 'pointer',
            flexShrink: 0,
            marginLeft: collapsed ? 0 : '2px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.16)';
            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.55)';
            e.currentTarget.style.color = '#fecaca';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textSecondary;
          }}
        >
          <LogOut size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
