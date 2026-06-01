import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface AiJobState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: string;
  currentTitle: string;
  updated: number;
  total: number;
  failed: number;
}

interface AiJobContextValue extends AiJobState {
  startJob: () => Promise<void>;
  setOnComplete: (fn: () => void) => void;
}

const defaultState: AiJobState = {
  status: 'idle',
  progress: '',
  currentTitle: '',
  updated: 0,
  total: 0,
  failed: 0,
};

const AiJobContext = createContext<AiJobContextValue>({
  ...defaultState,
  startJob: async () => {},
  setOnComplete: () => {},
});

export function AiJobProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AiJobState>(defaultState);
  const onCompleteRef = useRef<(() => void) | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks last-seen server status to detect transitions; prevents re-firing onComplete
  // on every poll after we've already handled a 'done' result and reset to idle locally.
  const prevServerStatusRef = useRef<AiJobState['status']>('idle');

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const pollStatus = async () => {
    try {
      const res = await fetch('/api/articles/ai-categorize/status');
      if (!res.ok) return;
      const data = await res.json();
      const prevServerStatus = prevServerStatusRef.current;

      // Ignore stale 'done' from server after we've already handled it and reset locally.
      // Without this guard, the 8s idle poll keeps re-triggering onComplete (→ loadArticles).
      if (data.status === 'done' && prevServerStatus === 'idle') return;

      prevServerStatusRef.current = data.status;
      setState({
        status: data.status,
        progress: data.progress ?? '',
        currentTitle: data.current_title ?? '',
        updated: data.updated ?? 0,
        total: data.total ?? 0,
        failed: data.failed ?? 0,
      });
      if (data.status === 'done') {
        onCompleteRef.current?.();
        // Auto-reset to idle after 5s so badge disappears
        setTimeout(() => {
          prevServerStatusRef.current = 'idle';
          setState((s) => s.status === 'done' ? defaultState : s);
        }, 5000);
      }
    } catch { /* ignore network errors */ }
  };

  // Re-create the polling interval whenever status changes frequency tier.
  // Always keep a background slow poll (8s) so auto-triggered tasks are discovered;
  // switch to fast poll (2s) while a task is actively running.
  useEffect(() => {
    stopPolling();
    pollStatus(); // immediate check
    intervalRef.current = setInterval(pollStatus, state.status === 'running' ? 2000 : 30000);
    return () => stopPolling();
  }, [state.status]);

  const startJob = async () => {
    try {
      const res = await fetch('/api/articles/ai-categorize', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 409) return; // already running
      if (!res.ok) throw new Error(`${res.status}`);
      prevServerStatusRef.current = 'running';
      setState((s) => ({ ...s, status: 'running', progress: 'AI分類を開始中...', currentTitle: '' }));
    } catch { /* ignore */ }
  };

  const setOnComplete = (fn: () => void) => {
    onCompleteRef.current = fn;
  };

  return (
    <AiJobContext.Provider value={{ ...state, startJob, setOnComplete }}>
      {children}
    </AiJobContext.Provider>
  );
}

export const useAiJob = () => useContext(AiJobContext);
