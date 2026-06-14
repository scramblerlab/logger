import { useState, useEffect } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

interface PushState {
  supported: boolean;
  permission: Permission;
  subscribed: boolean;
  loading: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotification(): PushState {
  const [permission, setPermission] = useState<Permission>('unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  useEffect(() => {
    if (!supported) return;
    setPermission(Notification.permission as Permission);

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
      });
    });
  }, [supported]);

  async function subscribe() {
    if (!supported) return;
    setLoading(true);
    try {
      // Register SW first (no-op if already registered)
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const reg = await navigator.serviceWorker.ready;

      // Fetch VAPID public key from backend
      const res = await fetch('/api/push/vapid-key');
      if (!res.ok) throw new Error('Failed to fetch VAPID key');
      const { publicKey } = await res.json();

      // Request permission + subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      setPermission('granted');

      // Save subscription to backend
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
        credentials: 'include',
      });

      setSubscribed(true);
    } catch (err) {
      const p = Notification.permission as Permission;
      setPermission(p === 'denied' ? 'denied' : 'default');
      console.error('Push subscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          credentials: 'include',
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error('Push unsubscribe failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return { supported, permission, subscribed, loading, subscribe, unsubscribe };
}
