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
  commentStatus: AiJobState['status'];
  commentProgress: string;
  startCommentJob: () => Promise<void>;
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
  commentStatus: 'idle',
  commentProgress: '',
  startCommentJob: async () => {},
});

export function AiJobProvider({ children }: { children: ReactNode }) {
  // --- Categorize job ---
  const [state, setState] = useState<AiJobState>(defaultState);
  const onCompleteRef = useRef<(() => void) | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
        setTimeout(() => {
          prevServerStatusRef.current = 'idle';
          setState((s) => s.status === 'done' ? defaultState : s);
        }, 5000);
      }
    } catch { /* ignore network errors */ }
  };

  useEffect(() => {
    stopPolling();
    pollStatus();
    intervalRef.current = setInterval(pollStatus, state.status === 'running' ? 2000 : 30000);
    return () => stopPolling();
  }, [state.status]);

  const startJob = async () => {
    try {
      const res = await fetch('/api/articles/ai-categorize', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 409) return;
      if (!res.ok) throw new Error(`${res.status}`);
      prevServerStatusRef.current = 'running';
      setState((s) => ({ ...s, status: 'running', progress: 'AI分類を開始中...', currentTitle: '' }));
    } catch { /* ignore */ }
  };

  const setOnComplete = (fn: () => void) => {
    onCompleteRef.current = fn;
  };

  // --- AI Comment job ---
  const [commentState, setCommentState] = useState<AiJobState>(defaultState);
  const commentIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCommentServerStatusRef = useRef<AiJobState['status']>('idle');

  const stopCommentPolling = () => {
    if (commentIntervalRef.current) {
      clearInterval(commentIntervalRef.current);
      commentIntervalRef.current = null;
    }
  };

  const pollCommentStatus = async () => {
    try {
      const res = await fetch('/api/articles/ai-comment-bulk/status');
      if (!res.ok) return;
      const data = await res.json();
      const prev = prevCommentServerStatusRef.current;

      if (data.status === 'done' && prev === 'idle') return;

      prevCommentServerStatusRef.current = data.status;
      setCommentState({
        status: data.status,
        progress: data.progress ?? '',
        currentTitle: data.current_title ?? '',
        updated: data.updated ?? 0,
        total: data.total ?? 0,
        failed: data.failed ?? 0,
      });
      if (data.status === 'done') {
        setTimeout(() => {
          prevCommentServerStatusRef.current = 'idle';
          setCommentState((s) => s.status === 'done' ? defaultState : s);
        }, 5000);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    stopCommentPolling();
    pollCommentStatus();
    commentIntervalRef.current = setInterval(
      pollCommentStatus,
      commentState.status === 'running' ? 2000 : 30000,
    );
    return () => stopCommentPolling();
  }, [commentState.status]);

  const startCommentJob = async () => {
    try {
      const res = await fetch('/api/articles/ai-comment-bulk', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 409) return;
      if (!res.ok) throw new Error(`${res.status}`);
      prevCommentServerStatusRef.current = 'running';
      setCommentState((s) => ({ ...s, status: 'running', progress: 'AIコメント生成を開始中...' }));
    } catch { /* ignore */ }
  };

  return (
    <AiJobContext.Provider value={{
      ...state,
      startJob,
      setOnComplete,
      commentStatus: commentState.status,
      commentProgress: commentState.progress,
      startCommentJob,
    }}>
      {children}
    </AiJobContext.Provider>
  );
}

export const useAiJob = () => useContext(AiJobContext);
