# Logger App — Mobile Strategy Plan

## Context

The logger app is a locally-run, AI-powered lifestyle blog system (FastAPI + SQLite + Ollama backend, Vite/React frontend). The user wants to explore packaging it as a proper iOS/Android app. The generative-radio project (Expo React Native) is a reference implementation for mobile in this codebase.

The central question: **PWA or native wrapper?** The answer depends on a critical architectural insight.

---

## The Key Insight: "Background Tasks" Are Server-Side

Unlike generative-radio (which needs the _device_ to process audio in background), the logger app's "AI Commentary" task runs entirely on the **server** (Ollama on the local Mac). The mobile app's job is only:

1. **Trigger** the task (a POST request)
2. **Receive notification** when done (push notification or poll)

This is a **Push Notification problem, not a background processing problem.** The device never needs to run JS in background for AI work — only to display a notification when the server calls back.

```
┌────────────────────────────────────────────────────────┐
│                   USER FLOW                            │
│                                                        │
│  App  ──POST /ai-comment──►  FastAPI                   │
│                              │                         │
│                              ▼                         │
│                          Ollama (local Mac)             │
│                          generates comment             │
│                              │  ~30s–2min              │
│                              ▼                         │
│  App  ◄──Push Notification── FastAPI                   │
│         "AI comment ready"   (Web Push / APNs / FCM)  │
│                                                        │
│  App foreground/background: DOESN'T MATTER             │
└────────────────────────────────────────────────────────┘
```

The device only needs a **push notification channel** — not background JS execution, not Background Sync, not any of the problematic APIs.

---

## Current Stack Snapshot

```
logger/
├── backend/          FastAPI + SQLite + Ollama
│   ├── services/
│   │   ├── ai_commenter.py     ← generates comments
│   │   ├── task_manager.py     ← async background jobs
│   │   └── ai_classifier.py
│   └── routers/articles.py     ← job trigger endpoints
└── frontend/         Vite + React 19 + Tailwind
    ├── src/
    │   ├── context/AiJobContext.tsx  ← polls every 2s
    │   └── api/client.ts
    └── vite.config.ts
```

---

## Option A: PWA (Progressive Web App)

### What It Is

Add `manifest.json` + service worker to the existing Vite/React frontend. Users install via Safari "Add to Home Screen". Backend sends Web Push notifications via VAPID.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                 OPTION A: PWA                        │
│                                                      │
│  Existing Vite/React app                             │
│         +                                            │
│  manifest.json (icons, theme, display: standalone)   │
│         +                                            │
│  service-worker.js (push handler)                    │
│         +                                            │
│  Backend: VAPID keys + /api/push/subscribe           │
│           + sends WebPush when job completes         │
│                                                      │
│  iOS requirement: Safari → Share → Add to Home Screen │
│  iOS 16.4+ required (March 2023)                    │
│  iOS 26: home screen web apps open as apps by default │
└─────────────────────────────────────────────────────┘
```

### Implementation Detail

**Frontend additions** (3 files):

1. **`frontend/public/manifest.json`**
```json
{
  "name": "Logger",
  "short_name": "Logger",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f1117",
  "theme_color": "#0f1117",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

2. **`frontend/public/sw.js`** — service worker push handler:
```js
self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'Logger', {
      body: data.body,
      icon: '/icon-192.png',
      data: { url: data.url }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
```

3. **`frontend/src/hooks/usePushSubscription.ts`** — registers SW + subscribes:
```ts
export async function subscribeToPush(vapidPublicKey: string) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
  });
  await fetch('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(sub)
  });
}
```

**Backend additions** (2 files):

4. **`backend/routers/push.py`** — subscription storage:
```python
# POST /api/push/subscribe — save push subscription to SQLite
# GET  /api/push/vapid-public — return public key
# Helper: send_push(subscription, title, body, url)
```
Uses `pywebpush` library:
```
pip install pywebpush
```

5. **`backend/services/task_manager.py`** modification — after job completes:
```python
# In _run_comment(), after each article done:
await send_push_to_all(title="AIコメント完了", body=f"{article.title}", url=f"/articles/{article.slug}")
```

**VAPID key generation** (one-time):
```bash
python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print(v.public_key, v.private_key)"
```

### Pros & Cons

```
PROS                               CONS
─────────────────────────────────  ──────────────────────────────────
✓ Zero new UI code — reuse 100%   ✗ iOS: MUST install to home screen
✓ Fastest to ship (~1-2 days)     ✗ No App Store presence
✓ No Apple Developer account      ✗ Background Sync NOT supported iOS
✓ No Xcode/Android Studio         ✗ EU iOS: push disabled (iOS 17.4)
✓ OTA updates instant             ✗ 7-day service worker cache expiry
✓ Single codebase (web = mobile)  ✗ 50MB storage cap on iOS Safari
✓ Works with existing CloudFlare  ✗ "Add to Home Screen" friction
  tunnel URL                      ✗ Push only works on home screen app
```

### iOS Push Limitation Summary

| Condition | Push Works? |
|-----------|-------------|
| iOS 16.3 or earlier | ❌ No |
| iOS 16.4+ in browser tab | ❌ No |
| iOS 16.4+ on home screen | ✅ Yes |
| iOS 17.4+ EU (before rollback) | ❌ No |
| iOS 17.4+ EU (after Apple rollback) | ✅ Yes |
| iOS 26 (auto-app mode) | ✅ Yes (better UX) |

---

## Option B: Capacitor (Web-to-Native Bridge)

### What It Is

Capacitor (by Ionic) wraps the existing Vite/React web app inside a native iOS/Android WebView container. The web code runs unchanged; Capacitor plugins provide native APIs (push notifications, filesystem, etc.). Published to App Store / Play Store.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  OPTION B: CAPACITOR                         │
│                                                              │
│  ┌──────────────────────────────────┐                        │
│  │     Native iOS / Android Shell   │                        │
│  │  ┌────────────────────────────┐  │                        │
│  │  │  WKWebView (iOS)           │  │  ◄── Existing          │
│  │  │  WebView (Android)         │  │       React app        │
│  │  │                            │  │                        │
│  │  │  Capacitor Bridge (JS↔NS)  │  │                        │
│  │  └────────────────────────────┘  │                        │
│  │                                  │                        │
│  │  Capacitor Plugins:              │                        │
│  │  ├── @capacitor/push-notifications (APNs + FCM)          │
│  │  ├── @capacitor/network (offline detect)                 │
│  │  ├── @capacitor/background-runner (periodic tasks)       │
│  │  └── @capacitor/filesystem (local cache)                 │
│  └──────────────────────────────────┘                        │
│                                                              │
│  Distribution: App Store + Google Play                       │
│  Build: Xcode + Android Studio (one-time setup)             │
└─────────────────────────────────────────────────────────────┘
```

### Push Notification Flow (Capacitor)

```
Mobile App                 Backend               APNs / FCM
─────────                  ───────               ──────────
App starts
     │
     ├─ request permission ──────────────────────────────────
     │
     │◄───────────────── device token (APNs/FCM) ───────────
     │
     ├─ POST /api/push/register {token, platform: "ios"|"android"}
     │
     │         ... user triggers AI commentary ...
     │
     ├─ POST /api/articles/{slug}/ai-comment ──► job starts
     │
     │                    job done
     │                       │
     │         POST to FCM/APNs ───────────────► push ──────►
     │                                                        │
     │◄────────────────────────────────────── notification ◄─┘
     │
   show notification, tap → deep link to article
```

### Implementation Detail

**Setup** (inside `logger/` or a new `logger/mobile/` directory):

```bash
# Install Capacitor CLI
npm install -g @capacitor/cli

# In frontend/ directory:
npm install @capacitor/core @capacitor/ios @capacitor/android
npm install @capacitor/push-notifications @capacitor/network

# Initialize
npx cap init "Logger" "com.scramblerlab.logger"
npx cap add ios
npx cap add android
```

**`capacitor.config.ts`**:
```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scramblerlab.logger',
  appName: 'Logger',
  webDir: 'dist',
  server: {
    // Dev: point to local backend via CF tunnel
    // Prod: built into app
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
```

**`frontend/src/hooks/useCapacitorPush.ts`**:
```ts
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

export async function initPush() {
  if (!Capacitor.isNativePlatform()) return; // fallback to Web Push

  await PushNotifications.requestPermissions();
  await PushNotifications.register();

  PushNotifications.addListener('registration', async ({ value: token }) => {
    await fetch('/api/push/register', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() })
    });
  });

  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = notification.data?.url;
    if (url) window.location.href = url;
  });
}
```

**Backend: `backend/routers/push.py`** (new):
```python
from fastapi import APIRouter
import httpx

router = APIRouter(prefix="/api/push")

@router.post("/register")
async def register_device(body: DeviceToken, db=Depends(get_db)):
    # Save {token, platform, created_at} to push_subscriptions table
    ...

async def send_native_push(token: str, platform: str, title: str, body: str, data: dict):
    if platform == "android":
        # Send via FCM v1 API
        await send_fcm(token, title, body, data)
    elif platform == "ios":
        # Send via APNs HTTP/2
        await send_apns(token, title, body, data)
```

**Backend: `services/task_manager.py`** — hook into job completion:
```python
# After _run_comment() completes each article:
tokens = await db.execute(select(PushSubscription))
for sub in tokens:
    await send_native_push(sub.token, sub.platform,
        title="AIコメント完了 ✦",
        body=article.title,
        data={"url": f"/articles/{article.slug}"}
    )
```

**Build workflow**:
```
npm run build              # Vite build to dist/
npx cap sync               # Copy dist/ to iOS/Android projects
npx cap open ios           # Open in Xcode → Archive → App Store
npx cap open android       # Open in Android Studio → Generate APK/AAB
```

### Required Credentials

| Credential | Purpose | Cost |
|------------|---------|------|
| Apple Developer Account | iOS App Store + APNs | $99/year |
| APNs Auth Key (.p8) | iOS push delivery | Free (included) |
| Google Play Developer | Android App Store | $25 one-time |
| Firebase project | FCM for Android push | Free tier sufficient |

### Pros & Cons

```
PROS                               CONS
─────────────────────────────────  ──────────────────────────────────
✓ Reuse 100% of React frontend    ✗ Apple Developer account $99/year
✓ App Store distribution          ✗ Xcode required (Mac only)
✓ Reliable push on iOS + Android  ✗ App Store review process (1-3 days)
✓ Deep links work natively        ✗ WebView: slight scroll lag vs native
✓ No home screen install friction ✗ Background Runner: 15min minimum
✓ Capacitor plugins for extras    ✗ FCM setup for Android
✓ Can share web + native codebase ✗ Must rebuild app for API URL changes
✓ Background Runner plugin        ✗ Two-step build (web → cap sync → Xcode)
```

---

## Option C: Expo React Native

### What It Is

Build a new React Native app with Expo (the same approach used in generative-radio). The UI is rebuilt in React Native components, sharing TypeScript types with the backend. Most native to the platform, best performance.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                 OPTION C: EXPO REACT NATIVE                   │
│                                                               │
│  logger/                                                      │
│  ├── backend/          (unchanged)                            │
│  ├── frontend/         (web — unchanged)                      │
│  └── mobile/           (NEW — mirrors generative-radio)       │
│      ├── app/                                                 │
│      │   ├── (tabs)/                                          │
│      │   │   ├── index.tsx        ← Article list              │
│      │   │   ├── write.tsx        ← New article               │
│      │   │   └── search.tsx       ← Search                    │
│      │   └── articles/[slug].tsx  ← Article detail            │
│      ├── src/                                                 │
│      │   ├── components/          ← Native RN components      │
│      │   ├── hooks/               ← useArticles, useAiJob     │
│      │   └── api/client.ts        ← Mirror frontend/api       │
│      ├── app.json                 ← Expo config               │
│      └── eas.json                 ← EAS build config          │
│                                                               │
│  Navigation: Expo Router (file-based, like Next.js)          │
│  Push: expo-notifications (APNs + FCM unified)               │
│  Build: EAS Build (cloud, no local Xcode needed)             │
└──────────────────────────────────────────────────────────────┘
```

### Key Files to Create

**`mobile/app.json`**:
```json
{
  "expo": {
    "name": "Logger",
    "slug": "logger",
    "version": "1.0.0",
    "scheme": "logger",
    "orientation": "portrait",
    "userInterfaceStyle": "dark",
    "ios": {
      "bundleIdentifier": "com.scramblerlab.logger",
      "infoPlist": {
        "UIBackgroundModes": ["fetch", "remote-notification"]
      }
    },
    "android": {
      "package": "com.scramblerlab.logger",
      "permissions": ["RECEIVE_BOOT_COMPLETED", "VIBRATE"]
    },
    "plugins": [
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",
        "color": "#0f1117"
      }]
    ]
  }
}
```

**`mobile/eas.json`**:
```json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}
```

**`mobile/src/hooks/useNotifications.ts`**:
```ts
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  // OR: await Notifications.getDevicePushTokenAsync() for APNs/FCM token

  await fetch(`${BACKEND_URL}/api/push/register`, {
    method: 'POST',
    body: JSON.stringify({ token, platform: Platform.OS })
  });
}
```

**`mobile/app/(tabs)/index.tsx`** (Article List):
```tsx
import { FlatList, RefreshControl } from 'react-native';
import { useArticles } from '@/hooks/useArticles';
import ArticleCard from '@/components/ArticleCard';

export default function HomeScreen() {
  const { articles, loading, refresh } = useArticles();
  return (
    <FlatList
      data={articles}
      renderItem={({ item }) => <ArticleCard article={item} />}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    />
  );
}
```

### Background Task Strategy (Expo)

Since AI jobs run on the server, we only need periodic status polling as a fallback if the push fails:

```ts
// mobile/src/tasks/checkAiJobs.ts
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

const TASK_NAME = 'check-ai-jobs';

TaskManager.defineTask(TASK_NAME, async () => {
  const status = await fetch(`${BACKEND_URL}/api/articles/ai-comment-bulk/status`);
  const data = await status.json();
  if (data.status === 'done' && data.updated > 0) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'AIコメント完了 ✦',
        body: `${data.updated}件の記事にコメントが追加されました`,
      },
      trigger: null, // immediate
    });
  }
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

// Register (minimum 15 min interval, OS may enforce longer):
await BackgroundFetch.registerTaskAsync(TASK_NAME, {
  minimumInterval: 15 * 60,
  stopOnTerminate: false,
  startOnBoot: true,
});
```

### Block Editor in React Native

The web `BlockEditor.tsx` cannot be ported directly. Options:
1. **`react-native-rich-editor`** — WebView-based, close to existing behavior
2. **Custom RN Block Editor** — FlatList of block components (2-3 days work)
3. **WebView embed** — Load the existing web editor in a WebView (fast, but less native)

Recommended: Use a `WebView` pointing to the write endpoint for editing, native RN for reading. This avoids rebuilding the block editor from scratch.

### Monorepo Setup (mirrors generative-radio)

```
logger/
├── package.json           { "workspaces": ["frontend", "mobile", "packages/*"] }
├── packages/
│   └── shared/
│       └── src/types.ts   ← Article, Category, Tag, AiJobStatus types
├── frontend/              (existing)
└── mobile/                (new Expo app)
```

### Pros & Cons

```
PROS                               CONS
─────────────────────────────────  ──────────────────────────────────
✓ Best native performance          ✗ Must rebuild all UI in React Native
✓ Full native feature access       ✗ Block editor needs WebView or rebuild
✓ Proven pattern (generative-radio)✗ Most effort (1-2 weeks minimum)
✓ EAS Build (no local Xcode)       ✗ Apple Developer $99/year
✓ OTA updates (Expo Updates)       ✗ Maintain two UI codebases
✓ expo-notifications: reliable     ✗ Japanese FTS won't run on device
✓ expo-router: clean nav           ✗ Image optimization (Pillow) stays server
✓ TypeScript types shared          
✓ Background fetch as push fallback
```

---

## Comparison Matrix

```
                     PWA          Capacitor     Expo RN
─────────────────────────────────────────────────────────
Code reuse            100%          ~95%          ~30%
UI rebuild needed     None          None          Full
Time to ship          1-2 days      1-2 weeks     2-4 weeks
App Store             ❌            ✅            ✅
Push (Android)        ✅ (FCM Web)  ✅ (FCM)      ✅ (FCM)
Push (iOS 16.4+)      ⚠️ (home scr) ✅ (APNs)     ✅ (APNs)
Background polling    ❌            ⚠️ (15min min) ⚠️ (15min min)
Apple Dev Account     ❌            ✅ required   ✅ required
Performance           WebKit        WebView       Native
Offline support       Limited       Plugin-based  Plugin-based
Block editor          Works as-is   Works as-is   Needs WebView
Japanese FTS search   Via API       Via API       Via API
Deep links            ⚠️ (limited)  ✅            ✅
Effort (developer)    Low           Medium        High
```

---

## Recommendation: Option B — Capacitor

**Why Capacitor is the right call for the logger app:**

1. **The constraint that drives Expo for generative-radio doesn't apply here.** Generative-radio needs custom native code (Android Kotlin HTTP module, silence bridge for iOS audio session). The logger app's "background work" is server-side Ollama inference — the device just needs a push channel.

2. **100% UI reuse is a massive leverage.** The existing React + Tailwind frontend (including the mobile-first block editor, Japanese rendering, article cards) ships to native with zero UI changes. The block editor — the hardest part to rebuild in React Native — works out of the box.

3. **PWA is disqualified by the use case.** The app is accessed via CloudFlare tunnel (custom URL); home screen PWA install friction is high for a personal tool. Push on iOS requires home screen install AND iOS 16.4+. There's no fallback if the user doesn't install it.

4. **Expo would be overengineering.** There's no audio, no BLE, no custom native sensors. The generative-radio background processing patterns (silence bridge, Android Kotlin HTTP module) are simply not needed.

5. **Capacitor Background Runner** provides periodic polling as push fallback (15min minimum, OS-enforced — acceptable since AI jobs take 30s–2min and aren't time-critical).

```
                 DECISION TREE
                 
 Does the app need to process data on-device in background?
              │
              ▼
             NO  ──► Does it need to run complex UI that needs
                      native-only performance?
                               │
                               ▼
                              NO  ──► Capacitor ✓
                               │
                               ▼  (only if complex animations,
                             YES     hardware sensors, or native
                               │      UI required)
                               ▼
                            Expo RN
```

---

## Implementation Plan (Option B: Capacitor)

### Phase 0: Prerequisites (Day 0)

```bash
# Verify prerequisites
node --version      # >= 20.x
npm --version       # >= 10.x

# Install Capacitor
npm install -g @capacitor/cli

# Apple Developer: enroll at developer.apple.com ($99/year)
# Firebase: create project at console.firebase.google.com (free)
# APNs: generate Auth Key in Apple Developer → Certificates → Keys
```

### Phase 1: Capacitor Init (Day 1, ~2h)

```bash
cd logger/frontend

# Install Capacitor core + platforms
npm install @capacitor/core @capacitor/ios @capacitor/android

# Install plugins
npm install @capacitor/push-notifications \
            @capacitor/network \
            @capacitor/status-bar \
            @capacitor/splash-screen

# Initialize
npx cap init "Logger" "com.scramblerlab.logger" --web-dir=dist

# Add platforms
npx cap add ios
npx cap add android
```

**`logger/frontend/capacitor.config.ts`**:
```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scramblerlab.logger',
  appName: 'Logger',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // During development, point to CF tunnel:
    // url: 'https://your-tunnel.trycloudflare.com',
    // cleartext: true,
  },
  ios: {
    contentInset: 'automatic',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#0f1117',
    },
  },
};

export default config;
```

### Phase 2: Push Notifications Frontend (Day 1-2, ~4h)

**`frontend/src/hooks/usePush.ts`** (new):
```ts
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export async function initPush(backendUrl: string) {
  if (!Capacitor.isNativePlatform()) {
    // PWA fallback: Web Push
    await initWebPush(backendUrl);
    return;
  }

  const { receive } = await PushNotifications.requestPermissions();
  if (receive !== 'granted') return;

  await PushNotifications.register();

  PushNotifications.addListener('registration', async ({ value: token }) => {
    await fetch(`${backendUrl}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
    });
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url;
    if (url) window.location.hash = url; // or router.push(url)
  });
}

// Web Push fallback (for browser / PWA):
async function initWebPush(backendUrl: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  const { publicKey } = await fetch(`${backendUrl}/api/push/vapid-key`).then(r => r.json());
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await fetch(`${backendUrl}/api/push/subscribe-web`, {
    method: 'POST',
    body: JSON.stringify(sub),
  });
}
```

**`frontend/src/App.tsx`** — add to initialization:
```tsx
import { initPush } from './hooks/usePush';

// In App component:
useEffect(() => {
  initPush(API_BASE_URL);
}, []);
```

### Phase 3: Push Notifications Backend (Day 2, ~4h)

**Install deps**:
```bash
pip install pywebpush httpx[http2]
# httpx with http2 for APNs HTTP/2 protocol
```

**`backend/models.py`** — add table:
```python
class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: str(uuid4()))
    token: Mapped[str] = mapped_column(unique=True)      # APNs/FCM device token
    platform: Mapped[str]                                 # "ios" | "android" | "web"
    web_endpoint: Mapped[Optional[str]]                   # Web Push endpoint
    web_p256dh: Mapped[Optional[str]]                     # Web Push key
    web_auth: Mapped[Optional[str]]                       # Web Push auth
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
```

**`backend/routers/push.py`** (new, ~120 lines):
```python
from fastapi import APIRouter, Depends
from pywebpush import webpush, WebPushException
import httpx, json

router = APIRouter(prefix="/api/push", tags=["push"])

@router.get("/vapid-key")
async def get_vapid_key():
    return {"publicKey": settings.VAPID_PUBLIC_KEY}

@router.post("/subscribe-web")
async def subscribe_web(sub: WebPushSubscription, db=Depends(get_db)):
    # Upsert subscription by endpoint
    ...

@router.post("/register")
async def register_device(body: DeviceRegistration, db=Depends(get_db)):
    # Upsert by token
    ...

async def broadcast_push(db, title: str, body: str, url: str):
    subs = await db.scalars(select(PushSubscription))
    for sub in subs:
        try:
            if sub.platform == "web":
                send_web_push(sub, title, body, url)
            elif sub.platform == "android":
                await send_fcm(sub.token, title, body, url)
            elif sub.platform == "ios":
                await send_apns(sub.token, title, body, url)
        except Exception as e:
            # Remove stale subscriptions
            if "410" in str(e) or "404" in str(e):
                await db.delete(sub)

async def send_fcm(token: str, title: str, body: str, url: str):
    # FCM v1 HTTP API
    async with httpx.AsyncClient() as client:
        await client.post(
            f"https://fcm.googleapis.com/v1/projects/{FCM_PROJECT}/messages:send",
            headers={"Authorization": f"Bearer {await get_fcm_token()}"},
            json={
                "message": {
                    "token": token,
                    "notification": {"title": title, "body": body},
                    "data": {"url": url},
                }
            }
        )

async def send_apns(token: str, title: str, body: str, url: str):
    # APNs HTTP/2 with JWT auth
    ...
```

**`backend/services/task_manager.py`** — wire in push on completion:
```python
# At end of _run_comment():
await broadcast_push(db, 
    title="✦ AIコメント完了",
    body=f"{state['updated']}件処理しました",
    url="/articles"
)

# For single article (in single_job.py):
await broadcast_push(db,
    title="✦ AIコメント完了",
    body=article.title,
    url=f"/articles/{article.slug}"
)
```

**`.env` additions**:
```
VAPID_PUBLIC_KEY=<base64>
VAPID_PRIVATE_KEY=<base64>
VAPID_CLAIMS_EMAIL=scramblerlab@gmail.com
FCM_PROJECT_ID=<firebase-project-id>
FCM_SERVICE_ACCOUNT_JSON=./firebase-service-account.json
APNS_KEY_ID=<10-char key id>
APNS_TEAM_ID=<10-char team id>
APNS_KEY_FILE=./apns-key.p8
APNS_BUNDLE_ID=com.scramblerlab.logger
```

### Phase 4: iOS App Icons & Splash Screen (Day 2, ~1h)

```bash
# Generate icons from a single 1024x1024 PNG
npx @capacitor/assets generate --iconBackgroundColor '#0f1117' \
  --iconBackgroundColorDark '#0f1117' \
  --splashBackgroundColor '#0f1117' \
  --splashBackgroundColorDark '#0f1117'
```

### Phase 5: Build & Test (Day 3)

```bash
# Build web app
cd logger/frontend
npm run build

# Sync to native projects
npx cap sync

# iOS: open Xcode
npx cap open ios
# → Product → Archive → Distribute App (App Store Connect)

# Android: open Android Studio
npx cap open android
# → Build → Generate Signed Bundle/APK
```

**Development testing** (no Apple account needed):
```bash
# Run on iOS Simulator
npx cap run ios --target="iPhone 16 Pro"

# Run on Android Emulator
npx cap run android
```

### Phase 6: Deep Links (Day 3, ~1h)

**iOS — `ios/App/App/Info.plist`** (added via Xcode or cap config):
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>logger</string></array>
  </dict>
</array>
```

**Frontend — handle deep link on push tap**:
```ts
// In usePush.ts:
PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
  const slug = action.notification.data?.slug;
  if (slug) navigate(`/articles/${slug}`);  // react-router
});
```

---

## Database Migration Required

Add `push_subscriptions` table (migration v5):
```python
# In database.py, version 4 → 5:
await conn.execute("""
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        platform TEXT NOT NULL,
        web_endpoint TEXT,
        web_p256dh TEXT,
        web_auth TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
""")
```

---

## File Change Summary

### New files:
```
logger/
├── frontend/
│   ├── capacitor.config.ts
│   ├── ios/                    ← generated by `cap add ios`
│   ├── android/                ← generated by `cap add android`
│   ├── public/
│   │   ├── manifest.json       ← PWA manifest (for web fallback)
│   │   └── sw.js               ← service worker (web push fallback)
│   └── src/
│       └── hooks/
│           └── usePush.ts      ← push init (Capacitor + Web Push)
└── backend/
    └── routers/
        └── push.py             ← subscribe/register/broadcast
```

### Modified files:
```
backend/
├── models.py           ← add PushSubscription table
├── database.py         ← add migration v4→v5
├── main.py             ← include push router
├── settings.py         ← add VAPID_*/FCM_*/APNS_* env vars
└── services/
    └── task_manager.py ← call broadcast_push on job completion
frontend/src/
└── App.tsx             ← call initPush() on startup
```

---

## Verification

1. **Web (browser)**: Open `http://localhost:5173` → check DevTools Application → Manifest loads, Service Worker registered, Push Manager available
2. **iOS Simulator**: `npx cap run ios` → tap "Allow Notifications" → trigger AI comment → check notification appears
3. **Android Emulator**: `npx cap run android` → same flow
4. **Background test**: Lock phone → trigger AI comment from web UI → verify push arrives on locked screen
5. **Deep link test**: Tap notification → app opens directly to article page
6. **Push cleanup**: Uninstall app → trigger job → verify no crash on stale token (410/404 handling)

---

## Sources

- [PWA iOS Limitations and Safari Support 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [PWA Push Notifications on iOS in 2026: What Really Works](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- [Background Runner Capacitor Plugin API](https://capacitorjs.com/docs/v5/apis/background-runner)
- [Push Notifications Capacitor Plugin API](https://capacitorjs.com/docs/apis/push-notifications)
- [React Native vs Expo vs Capacitor 2026](https://www.pkgpulse.com/guides/react-native-vs-expo-vs-capacitor-cross-platform-mobile-2026)
- [Android & iOS Push + WebSocket for Capacitor Apps 2026](https://lushbinary.com/blog/android-ios-push-notification-websocket-capacitor-signal-guide-2026/)
