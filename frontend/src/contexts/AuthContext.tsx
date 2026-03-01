import React, { createContext, useContext, useState, useEffect } from 'react';
import { playSound } from '@/hooks/useSound';
import { clearCsrfTokenCache } from '@/lib/csrf';

interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    sessionVersion: number;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (params: { email: string; password: string }) => Promise<void>;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Bump this version to force-logout all users
const SESSION_VERSION = 2;

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const checkSession = async () => {
        const token = localStorage.getItem('iris_token');
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const roleName = data.role === 'admin' ? 'Admin' : (data.role === 'operator' ? 'Operator' : data.email);
                // Map API response to User interface
                const userData: User = {
                    id: data.id,
                    name: roleName,
                    email: data.email,
                    role: data.role,
                    sessionVersion: SESSION_VERSION
                };
                setUser(userData);
            } else {
                // Invalid token
                localStorage.removeItem('iris_token');
                setUser(null);
            }
        } catch (error) {
            console.error('Session check failed:', error);
            localStorage.removeItem('iris_token');
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    const parseResponseBody = async (response: Response): Promise<{ json: any; text: string }> => {
        const raw = await response.text();
        if (!raw) return { json: null, text: '' };
        try {
            return { json: JSON.parse(raw), text: raw };
        } catch {
            return { json: null, text: raw };
        }
    };

    useEffect(() => {
        checkSession();
    }, []);

    useEffect(() => {
        const id = setInterval(() => {
            if (localStorage.getItem('iris_token')) {
                checkSession();
            }
        }, 5000);
        const onVisible = () => {
            if (!document.hidden && localStorage.getItem('iris_token')) {
                checkSession();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    const login = async (params: { email: string; password: string }) => {
        try {
            const { email, password } = params;

            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    email,
                    password,
                }),
            });

            if (!response.ok) {
                const parsed = await parseResponseBody(response);
                const errorData = parsed.json;
                const rawText = parsed.text.trim();
                const rawMsg = rawText && !rawText.startsWith("<") ? rawText : "";
                // Backend may return lockout metadata for operators.
                if (response.status === 423 && errorData?.lockoutUntil) {
                    const until = String(errorData.lockoutUntil);
                    const mins = errorData?.lockoutMinutes ? String(errorData.lockoutMinutes) : '10';
                    throw new Error(`${errorData.error || 'Account locked'} (until ${until}). Locked for ${mins} minutes. Contact admin to unlock early.`);
                }
                if (response.status === 403 && errorData?.code === 'password_reset_required') {
                    throw new Error('PASSWORD_RESET_REQUIRED');
                }
                if (response.status === 403 && errorData?.code === 'pending_admin_approval') {
                    throw new Error(errorData?.error || 'Access pending admin approval');
                }
                if (response.status === 401) throw new Error(errorData?.error || rawMsg || 'Invalid email or password');
                if (response.status === 403) throw new Error(errorData?.error || rawMsg || `Access denied (${response.status})`);
                if (response.status === 429) throw new Error(errorData?.error || rawMsg || 'Too many login attempts. Try again shortly.');
                throw new Error(errorData?.error || rawMsg || `Login failed (${response.status})`);
            }

            const parsed = await parseResponseBody(response);
            const data = parsed.json;
            if (!data?.token || !data?.user) {
                throw new Error('Login failed: invalid server response');
            }
            localStorage.setItem('iris_token', data.token);

            const roleName = data?.user?.role === 'admin' ? 'Admin' : (data?.user?.role === 'operator' ? 'Operator' : data?.user?.email);
            const userData: User = {
                id: data.user.id,
                name: roleName,
                email: data.user.email,
                role: data.user.role,
                sessionVersion: SESSION_VERSION
            };
            setUser(userData);
            playSound('success');
        } catch (error) {
            console.error('Login error:', error);
            playSound('error');
            throw error;
        }
    };

    const logout = () => {
        playSound('notification');
        setUser(null);
        localStorage.removeItem('iris_token');
        localStorage.removeItem('iris_user'); // Cleanup old session key if exists
        clearCsrfTokenCache();
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            login,
            logout,
            isAuthenticated: !!user
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
