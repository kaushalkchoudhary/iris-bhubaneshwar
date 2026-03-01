import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Hexagon, Lock, ShieldAlert, Activity, Globe, Zap, Fingerprint, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { playSound } from '@/hooks/useSound';

// --- HUD Components ---
const RotatingRing = ({ delay, duration, reverse, scale, border }: { delay: number, duration: number, reverse?: boolean, scale: number, border: string }) => (
    <motion.div
        initial={{ rotate: 0, scale }}
        animate={{ rotate: reverse ? -360 : 360 }}
        transition={{ duration, repeat: Infinity, ease: "linear", delay }}
        className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-t border-b border-l-0 border-r-0",
            border
        )}
        style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}
    />
);

const DecorativeGrid = () => (
    <div className="absolute inset-0 pointer-events-none opacity-20"
        style={{
            backgroundImage: `linear-gradient(rgba(0, 243, 255, 0.1) 1px, transparent 1px), 
                        linear-gradient(90deg, rgba(0, 243, 255, 0.1) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)'
        }}
    />
);



export function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [time, setTime] = useState(new Date());

    const from = (location.state as any)?.from?.pathname || '/';

    const [coords, setCoords] = useState<{ latText: string, lngText: string } | null>(null);
    const [nodeId, setNodeId] = useState('INITIALIZING...');

    useEffect(() => {
        // Clock
        const timer = setInterval(() => setTime(new Date()), 1000);

        // Node ID based on Timezone
        const region = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/')[0].toUpperCase();
        const city = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/')[1]?.toUpperCase() || 'UNK';
        setNodeId(`${region}-${city}-SEC-01`);

        // Real Geolocation (UI-only; not used for audit or operator access controls)
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude.toFixed(4);
                    const lng = position.coords.longitude.toFixed(4);
                    const latDir = position.coords.latitude >= 0 ? 'N' : 'S';
                    const lngDir = position.coords.longitude >= 0 ? 'E' : 'W';
                    setCoords({
                        latText: `${Math.abs(Number(lat))}° ${latDir}`,
                        lngText: `${Math.abs(Number(lng))}° ${lngDir}`,
                    });
                },
                (err) => {
                    // Permission denial is expected on many browsers; keep console noise low.
                    if (err?.code !== 1) {
                        console.warn("Geo Error", err);
                    }
                    // Don't use hardcoded locations.
                    setCoords(null);
                }
            );
        } else {
            setCoords(null);
        }

        return () => clearInterval(timer);
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password) {
            setError('AUTHORIZATION REQUIRED');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Simulate "System Access" delay for effect
            await new Promise(resolve => setTimeout(resolve, 1500));
            await login({ email, password });
            navigate(from, { replace: true });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === 'PASSWORD_RESET_REQUIRED') {
                playSound('notification');
                navigate('/operator-reset', { state: { email } });
                return;
            }
            playSound('error');
            setError(msg || 'ACCESS DENIED');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full bg-[#020408] overflow-hidden text-cyan-50 font-mono selection:bg-cyan-500/30">

            {/* --- Background Layers --- */}
            <div className="absolute inset-0 bg-radial-gradient from-[#0f172a] to-[#020408]" />
            <DecorativeGrid />

            {/* Rotating Radar Scan */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150vmax] h-[150vmax] opacity-10 animate-[spin_20s_linear_infinite] pointer-events-none">
                <div className="w-full h-full bg-gradient-to-r from-transparent via-cyan-500/10 to-transparent rotate-45 transform origin-center" />
            </div>

            {/* --- Corner HUD Elements --- */}
            <div className="absolute top-8 left-8 flex flex-col gap-2 pointer-events-none opacity-60">
                <div className="flex items-center gap-2 text-cyan-400">
                    <Globe size={16} />
                    <span className="text-xs tracking-[0.2em] font-bold">NETWORK: SECURE</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                    <Activity size={16} />
                    <span className="text-xs tracking-[0.2em] font-bold">SYSTEM: ONLINE</span>
                </div>
            </div>

            <div className="absolute top-8 right-8 text-right pointer-events-none">
                <div className="text-4xl font-bold text-cyan-500/90 tracking-widest">{time.toLocaleTimeString('en-US', { hour12: false })}</div>
                <div className="text-xs text-cyan-500/60 tracking-[0.3em] mt-1">{time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase()}</div>
            </div>

            <div className="absolute bottom-8 left-8 pointer-events-none">
                <div className="flex items-end gap-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-cyan-500/50 tracking-widest">COORDINATES</span>
                        <span className="text-xs font-mono text-cyan-400">
                            {coords ? `${coords.latText}, ${coords.lngText}` : 'CALCULATING...'}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-cyan-500/50 tracking-widest">NODE</span>
                        <span className="text-xs font-mono text-cyan-400">{nodeId}</span>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-8 right-8 pointer-events-none animate-pulse">
                <ShieldAlert className="text-orange-500 w-8 h-8 opacity-80" />
            </div>


            {/* --- Main Login Interface --- */}
            <div className="relative z-10 flex items-center justify-center min-h-screen">

                {/* Animated HUD Rings behind the form */}
                <div className="absolute w-[600px] h-[600px] pointer-events-none">
                    <RotatingRing delay={0} duration={30} scale={1} border="border-cyan-500/10" />
                    <RotatingRing delay={0} duration={20} reverse scale={0.8} border="border-cyan-500/20 border-dashed" />
                    <RotatingRing delay={0} duration={15} scale={0.6} border="border-cyan-400/10" />
                </div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="relative w-full max-w-[400px] p-10 bg-[#000]/40 backdrop-blur-md border border-cyan-500/30 clip-path-polygon"
                    style={{ clipPath: "polygon(10% 0, 100% 0, 100% 90%, 90% 100%, 0 100%, 0 10%)" }}
                >
                    {/* Holographic Header */}
                    <div className="flex flex-col items-center mb-10 space-y-4">
                        <div className="relative">
                            <div className="absolute inset-0 bg-cyan-500/20 blur-xl rounded-full" />
                            <Hexagon className="w-16 h-16 text-cyan-400 relative z-10 animate-pulse" strokeWidth={1} />
                            <div className="absolute inset-0 border border-cyan-500/50 rotate-45" />
                        </div>
                        <div className="text-center">
                            <h1 className="text-3xl font-bold tracking-[0.2em] text-white text-shadow-cyan">IRIS</h1>
                            <p className="text-[10px] text-cyan-400/80 tracking-[0.3em] uppercase mt-2">Command Center Access</p>
                        </div>
                    </div>

                    {/* Login Form */}
                    <form onSubmit={handleLogin} className="space-y-8 relative">

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="absolute -top-12 left-0 right-0 bg-red-500/10 border border-red-500/40 text-red-500 text-[10px] p-2 text-center tracking-widest font-bold"
                            >
                                {error}
                            </motion.div>
                        )}

                        <div className="space-y-6">
                            <div className="relative group">
                                <label className="text-[10px] text-cyan-600 tracking-widest uppercase mb-1 block group-focus-within:text-cyan-400 transition-colors">Identity Code</label>
                                <div className="flex items-center border-b border-cyan-900 group-focus-within:border-cyan-400 transition-colors pb-2">
                                    <Fingerprint className="w-4 h-4 text-cyan-700 group-focus-within:text-cyan-400 mr-3 transition-colors" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="bg-transparent border-none outline-none text-sm w-full text-cyan-100 placeholder-cyan-900 font-mono tracking-wider focus:ring-0"
                                        placeholder="USR-ID-0000"
                                    />
                                    <div className="w-2 h-2 bg-cyan-500/0 group-focus-within:bg-cyan-500/100 transition-all rounded-full" />
                                </div>
                            </div>

                            <div className="relative group">
                                <label className="text-[10px] text-cyan-600 tracking-widest uppercase mb-1 block group-focus-within:text-cyan-400 transition-colors">Security Key</label>
                                <div className="flex items-center border-b border-cyan-900 group-focus-within:border-cyan-400 transition-colors pb-2">
                                    <Lock className="w-4 h-4 text-cyan-700 group-focus-within:text-cyan-400 mr-3 transition-colors" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="bg-transparent border-none outline-none text-sm w-full text-cyan-100 placeholder-cyan-900 font-mono tracking-wider focus:ring-0"
                                        placeholder="••••••••"
                                    />
                                    <div className="w-2 h-2 bg-cyan-500/0 group-focus-within:bg-cyan-500/100 transition-all rounded-full" />
                                </div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full relative group overflow-hidden bg-cyan-950/30 hover:bg-cyan-900/40 border border-cyan-900/50 hover:border-cyan-500/50 transition-all duration-300 p-4"
                        >
                            <div className="absolute inset-0 bg-cyan-500/5 group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
                            <div className="flex items-center justify-between relative z-10">
                                <span className="text-xs tracking-[0.2em] font-bold text-cyan-400 group-hover:text-cyan-200 uppercase">
                                    {loading ? 'Authenticating...' : 'Initialize Session'}
                                </span>
                                {loading ? (
                                    <div className="animate-spin w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
                                ) : (
                                    <ChevronRight className="w-4 h-4 text-cyan-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
                                )}
                            </div>
                        </button>
                    </form>

                    <div className="mt-8 pt-4 border-t border-cyan-500/10 flex justify-between items-center text-[10px] text-cyan-800 tracking-wider">
                        <span>V 2.5.0-RC</span>
                        <span className="flex items-center gap-2">
                            <Zap size={10} className="text-yellow-600" />
                            POWER: 98%
                        </span>
                    </div>

                    {/* Decorative Corner Brackets */}
                    <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-cyan-500/50" />
                    <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-cyan-500/50" />
                    <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-cyan-500/50" />
                    <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-cyan-500/50" />
                </motion.div>
            </div>

        </div>
    );
}
