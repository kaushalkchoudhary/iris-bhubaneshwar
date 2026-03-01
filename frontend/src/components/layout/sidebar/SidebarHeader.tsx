import { useNavigate } from 'react-router-dom';
import { colors } from './constants';
import { IrisEyeMark } from '@/components/brand/IrisEyeMark';

interface SidebarHeaderProps {
  collapsed: boolean;
}

export function SidebarHeader({ collapsed }: SidebarHeaderProps) {
  const navigate = useNavigate();

  return (
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
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: `1px solid ${colors.border}`,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '38px',
          height: '38px',
          flexShrink: 0,
          borderRadius: '0',
          backgroundColor: colors.accentDim,
          transition: 'transform 0.2s ease',
        }}
      >
        <IrisEyeMark size={20} accent="var(--primary)" />
      </div>

      {!collapsed && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontSize: '16px',
              fontWeight: 700,
              color: colors.textPrimary,
              letterSpacing: '-0.02em',
            }}
          >
            IRIS
          </span>
          <span
            style={{
              fontSize: '10px',
              color: colors.textMuted,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginTop: '1px',
            }}
          >
            Command Center
          </span>
        </div>
      )}
    </div>
  );
}
