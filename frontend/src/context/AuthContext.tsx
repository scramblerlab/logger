import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface AuthContextValue {
  isEditor: boolean;
  isLoading: boolean;
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isEditor: false,
  isLoading: true,
  email: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isEditor, setIsEditor] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/verify', { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.email) {
          setIsEditor(true);
          setEmail(data.email);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (loginEmail: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Invalid credentials');
    const data = await res.json();
    setIsEditor(true);
    setEmail(data.email);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setIsEditor(false);
    setEmail(null);
  };

  return (
    <AuthContext.Provider value={{ isEditor, isLoading, email, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
