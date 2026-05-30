# Plan: Viewer / Editor Mode (JWT Auth)

## Context

The Logger app is currently fully open — anyone who visits can create, edit, delete articles and categories. We need two modes:

- **Viewer** (unauthenticated): read-only. All mutating buttons hidden. 投稿 replaced by ログイン.
- **Editor** (authenticated): full access. All buttons visible. ログアウト button in header.

Auth is JWT-based. Credentials live in a manually-edited `backend/editors.json` file. The JWT is stored in `localStorage` and verified against the backend on each page load. Backend write endpoints are also guarded.

---

## Architecture

```
editors.json           backend/.env
  ↓ loaded at startup    ↓ JWT_SECRET, JWT_EXPIRE_DAYS
  └── auth.py (verify credentials, issue JWT, FastAPI dependency)
       ├── routers/auth.py   POST /api/auth/login  → sets httpOnly cookie
       │                     POST /api/auth/logout → clears cookie
       │                     POST /api/auth/verify → reads cookie, returns {email}
       └── routers/*.py      Depends(get_current_user) reads cookie on write endpoints

httpOnly cookie: auth_token  (JS cannot read this — XSS-proof)
  ↓ browser sends automatically on every request
  └── AuthContext (isEditor, email, login(), logout())
       ├── Header.tsx          ログイン vs 投稿 + ログアウト
       ├── Sidebar.tsx         hide AI分類, カテゴリー編集
       ├── Home.tsx            hide mobile edit buttons
       ├── ArticlePage.tsx     hide 編集/削除
       ├── WritePage.tsx       redirect if !isEditor
       └── ImportPage.tsx      redirect if !isEditor
```

---

## Backend

### 1. `backend/editors.json` (new, added to `.gitignore`)
```json
{
  "scramblerlab@gmail.com": "yourpassword"
}
```
Plaintext passwords — simple enough for manual editing on a personal local tool.

### 2. `backend/.env` — add two lines
```
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_urlsafe(32))">
JWT_EXPIRE_DAYS=30
```
`token_urlsafe(32)` produces 43 base64 chars = 256 bits of entropy, matching HS256 key strength.

### 3. `backend/requirements.txt` — add two lines
```
python-jose[cryptography]==3.3.0
slowapi==0.1.9
```
`slowapi` provides rate limiting for the login endpoint (5 attempts/minute per IP — brute-force protection).

### 4. `backend/auth.py` (new)
- `load_editors()` — reads `editors.json` at import time; returns `{ email: password }` dict
- `verify_credentials(email, password)` — uses `hmac.compare_digest()` (constant-time, no timing leak)
- `create_access_token(email)` — HS256 JWT with `{ sub, email, exp: now + JWT_EXPIRE_DAYS }`, signed by `JWT_SECRET`
- `verify_token(token: str) -> str` — decodes JWT with `algorithms=["HS256"]` pinned (prevents `alg: none` attack), validates exp, returns email or raises `HTTPException(401)`
- `get_current_user` — FastAPI `Depends(Request)`: reads `request.cookies.get("auth_token")`, calls `verify_token` (raises 401 if missing or invalid)

### 5. `backend/routers/auth.py` (new)
```
POST /api/auth/login   { email, password }
  → On success: JSONResponse({"email": email}) + Set-Cookie: auth_token=<jwt>;
                HttpOnly; SameSite=Strict; Max-Age=<30days>; Path=/
  → On failure: 401
  → Rate-limited: 5 requests/minute per IP via slowapi

POST /api/auth/logout  (no body)
  → Clears cookie with Max-Age=0; returns {"ok": true}

POST /api/auth/verify  (no body — browser sends cookie automatically)
  → Reads cookie, returns { valid: true, email } or 401
```

**Cookie security properties:**
- `HttpOnly` — JavaScript cannot read the cookie (XSS-proof)
- `SameSite=Strict` — cookie not sent on cross-site requests (CSRF-proof for same-origin app)
- `Secure=True` — cookie only sent over HTTPS; modern browsers also honor it on `localhost`
- `Max-Age` — browser expires automatically after 30 days

### 6. `backend/main.py`
Add `from routers import auth` and `app.include_router(auth.router)`.

### 7. Protect write endpoints — add `_: str = Depends(get_current_user)` param

| Router file | Endpoints to protect |
|---|---|
| `routers/articles.py` | POST create, PUT/PATCH update, DELETE, POST ai-categorize, POST ai-classify |
| `routers/categories.py` | POST create, DELETE |
| `routers/importer.py` | POST /api/import/run |

All GET / read endpoints remain public.

---

## Frontend

### 8. `frontend/src/context/AuthContext.tsx` (new)
```ts
type AuthContextValue = {
  isEditor: boolean
  isLoading: boolean   // true while POST /api/auth/verify is in-flight on mount
  email: string | null
  login: (email: string, password: string) => Promise<void>  // throws on bad credentials
  logout: () => Promise<void>
}
```
- On mount: sets `isLoading=true`, calls `POST /api/auth/verify`; sets `isEditor=true` + `isLoading=false` if 200; sets `isLoading=false` only on 401. No localStorage anywhere.
- `login()`: calls `POST /api/auth/login` with `{email, password}`; backend sets the httpOnly cookie in the response; updates React state from the response body.
- `logout()`: calls `POST /api/auth/logout`; backend clears the cookie; resets React state.
- Export `useAuth()` hook.

### 9. `frontend/src/main.tsx`
Wrap `<App>` with `<AuthProvider>`.

### 10. `frontend/src/api/client.ts`
- Add `credentials: "include"` to the internal `request()` fetch options so cookies are sent on all requests (required for the Vite dev proxy setup).
- Add `auth.login(email, password)` → `POST /api/auth/login`
- Add `auth.verify()` → `POST /api/auth/verify` (no token argument — cookie is automatic)
- Add `auth.logout()` → `POST /api/auth/logout`
- **No Authorization header injection needed** — the browser attaches the cookie automatically.

### 11. `frontend/src/components/LoginModal.tsx` (new)
Dark modal matching app style:
- Email + password fields, submit button
- Calls `login()` from `useAuth()`, closes on success
- Shows inline error message on failure (「メールアドレスまたはパスワードが違います」)

### 12. `frontend/src/components/Header.tsx`
```tsx
const { isEditor, logout } = useAuth()
// isEditor → show <Link to="/write">投稿</Link> + <button onClick={() => logout()}>ログアウト</button>
// !isEditor → show <button onClick={() => setShowLogin(true)}>ログイン</button>
```
`showLogin` state lives in Header; renders `<LoginModal onClose={...} />` when true.

### 13. `frontend/src/components/Sidebar.tsx`
Wrap AI分類 and カテゴリー編集 buttons: `{isEditor && <button>...}`.

### 14. `frontend/src/pages/Home.tsx`
Wrap mobile AI分類 and カテゴリー編集 buttons: `{isEditor && ...}`.

### 15. `frontend/src/pages/ArticlePage.tsx`
Wrap the fixed top-right 編集/削除 group: `{isEditor && <div className="fixed top-[72px] ...">`.

### 16. `frontend/src/pages/WritePage.tsx`
```tsx
const { isEditor, isLoading } = useAuth()
useEffect(() => { if (!isLoading && !isEditor) navigate('/') }, [isLoading, isEditor])
```
`isLoading` guard prevents redirect firing before the verify call completes on page load.

### 17. `frontend/src/pages/ImportPage.tsx`
Same redirect guard as WritePage (with `isLoading` check).

---

## .gitignore
Add `backend/editors.json` (contains plaintext credentials).

---

## Files to create / modify

| File | Action |
|---|---|
| `backend/editors.json` | Create (gitignored) |
| `backend/.env` | Edit — add JWT_SECRET, JWT_EXPIRE_DAYS |
| `backend/requirements.txt` | Edit — add python-jose, slowapi |
| `backend/auth.py` | Create |
| `backend/routers/auth.py` | Create |
| `backend/main.py` | Edit — include auth router |
| `backend/routers/articles.py` | Edit — add Depends to write endpoints |
| `backend/routers/categories.py` | Edit — add Depends to write endpoints |
| `backend/routers/importer.py` | Edit — add Depends to run endpoint |
| `frontend/src/context/AuthContext.tsx` | Create |
| `frontend/src/main.tsx` | Edit — wrap with AuthProvider |
| `frontend/src/api/client.ts` | Edit — add auth methods, add `credentials: "include"` |
| `frontend/src/components/LoginModal.tsx` | Create |
| `frontend/src/components/Header.tsx` | Edit — conditional buttons |
| `frontend/src/components/Sidebar.tsx` | Edit — guard edit buttons |
| `frontend/src/pages/Home.tsx` | Edit — guard mobile edit buttons |
| `frontend/src/pages/ArticlePage.tsx` | Edit — guard 編集/削除 |
| `frontend/src/pages/WritePage.tsx` | Edit — redirect guard |
| `frontend/src/pages/ImportPage.tsx` | Edit — redirect guard |
| `.gitignore` | Edit — add editors.json |

---

## Verification

1. **Viewer mode (cold)**: Open app unauthenticated. Header shows ログイン (not 投稿). Sidebar has no AI分類/カテゴリー編集. Article pages show no 編集/削除. Navigating directly to `/write` or `/import` redirects to `/`.
2. **Login**: Click ログイン, enter credentials from `editors.json`. Modal closes, header switches to 投稿 + ログアウト, all edit buttons appear.
3. **Persistence**: Refresh the page — editor mode is restored (backend verifies the httpOnly cookie). No localStorage involved.
4. **XSS-proof**: Open browser devtools console, run `document.cookie` — the `auth_token` cookie is NOT visible (httpOnly). `localStorage` has no auth data.
5. **Logout**: Click ログアウト — backend clears the cookie, viewer mode restored.
6. **Bad credentials**: Enter wrong password — error message shown in modal, no state change.
7. **Rate limiting**: Attempt login 6 times in a row — 6th attempt returns 429.
8. **Backend guard**: While unauthenticated, `curl -X POST http://localhost:8000/api/articles` — confirm 401 response.
