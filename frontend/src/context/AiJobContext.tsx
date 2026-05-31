import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

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
      setState({
        status: data.status,
        progress: data.progress ?? '',
        currentTitle: data.current_title ?? '',
        updated: data.updated ?? 0,
        total: data.total ?? 0,
        failed: data.failed ?? 0,
      });
      if (data.status !== 'running') {
        stopPolling();
        if (data.status === 'done') {
          onCompleteRef.current?.();
          // Auto-reset to idle after 5s so badge disappears
          setTimeout(() => setState((s) => s.status === 'done' ? defaultState : s), 5000);
        }
      }
    } catch { /* ignore network errors */ }
  };

  const startPolling = () => {
    stopPolling();
    intervalRef.current = setInterval(pollStatus, 2000);
  };

  // On mount: check current state once (handles page refresh mid-run)
  useEffect(() => {
    pollStatus();
    return () => stopPolling();
  }, []);

  // Manage polling interval whenever status changes
  useEffect(() => {
    if (state.status === 'running') {
      startPolling();
    } else {
      stopPolling();
    }
  }, [state.status]);

  const startJob = async () => {
    try {
      const res = await fetch('/api/articles/ai-categorize', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 409) return; // already running
      if (!res.ok) throw new Error(`${res.status}`);
      // Setting status to 'running' triggers the polling effect
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
