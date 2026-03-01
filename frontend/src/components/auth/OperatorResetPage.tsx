import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api';

export function OperatorResetPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const seedEmail = useMemo(() => {
    const v = (location.state as any)?.email;
    return typeof v === 'string' ? v : '';
  }, [location.state]);

  const [email, setEmail] = useState(seedEmail);
  const [tempPassword, setTempPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !tempPassword || !newPassword || !confirmNewPassword) {
      setError('All fields are required');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await apiClient.operatorResetPassword({ email, tempPassword, newPassword });
      setDone(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020408] text-cyan-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md border border-cyan-500/30 bg-[#03101a]/80 backdrop-blur p-6">
        <div className="flex items-center gap-2 mb-4 text-cyan-300">
          <KeyRound size={18} />
          <h1 className="text-sm tracking-[0.18em] uppercase font-semibold">Operator Password Reset</h1>
        </div>

        {!done ? (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-cyan-200/70">
              Use the temporary password provided by admin, then set your new password.
            </p>
            <input
              className="w-full bg-transparent border border-cyan-700/60 px-3 py-2 text-sm outline-none focus:border-cyan-400"
              type="email"
              placeholder="Operator email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full bg-transparent border border-cyan-700/60 px-3 py-2 text-sm outline-none focus:border-cyan-400"
              type="password"
              placeholder="Temporary password"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
            />
            <input
              className="w-full bg-transparent border border-cyan-700/60 px-3 py-2 text-sm outline-none focus:border-cyan-400"
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="w-full bg-transparent border border-cyan-700/60 px-3 py-2 text-sm outline-none focus:border-cyan-400"
              type="password"
              placeholder="Confirm new password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
            />
            {error && <div className="text-xs text-red-300">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-500/20 border border-cyan-400/60 py-2 text-sm tracking-wide disabled:opacity-60"
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-300">
              <ShieldCheck size={16} />
              <span className="text-sm">Password updated</span>
            </div>
            <p className="text-xs text-cyan-200/75">
              Your account is now pending admin approval. You can log in after admin approves your operator access.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full bg-cyan-500/20 border border-cyan-400/60 py-2 text-sm tracking-wide"
            >
              Back to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
