# Nox Analytics Setup

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (any name, e.g. "nox-analytics")
3. Wait for provisioning to complete

## 2. Run SQL Schema

1. Open **SQL Editor** in Supabase dashboard
2. Copy & paste the contents of `supabase_schema.sql`
3. Click **Run**

This creates:
- `nox_events` table with `country` and `error_code` columns
- Row Level Security policies (**no direct inserts** — only via RPC)
- `insert_nox_events` RPC function with token validation
- Realtime subscription support

## 3. Set Secret Token

The RPC function validates a secret token before inserting events. Without the correct token, no events can be sent.

The token is hardcoded directly in the `insert_nox_events` function in `supabase_schema.sql`. Supabase hides function source code from anon users, so this is secure.

1. Generate a strong random string:
   ```
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
2. In `supabase_schema.sql`, replace `CHANGE_ME_TO_A_STRONG_TOKEN` with your generated token
3. Run the schema in Supabase SQL Editor
4. Use this same token in the Nox app config

## 4. Create Dashboard User

1. Go to **Authentication → Users** in Supabase dashboard
2. Click **Add user**
3. Enter your email + a strong password
4. Enable **Auto Confirm User** (or confirm via email)

This is the login for the analytics dashboard.

## 5. Get API Keys

1. Go to **Project Settings → API**
2. Note down:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **anon public key** (safe to embed — can only call RPC, not read data)

## 6. Configure Nox App

Add to `%APPDATA%\Nox\config.yaml`:

```yaml
analytics_enabled: true
analytics_supabase_url: https://xxxxx.supabase.co
analytics_supabase_key: your-anon-key
analytics_token: your-secret-token-here
```

## 7. Configure Dashboard

Edit `website/dashboard/config.js`:

```js
export const SUPABASE_URL = "https://xxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key";
```

## 8. Deploy Dashboard

The dashboard is in `website/dashboard/` and gets deployed alongside the website via GitHub Pages.

The login button appears in the website footer — click it to access the analytics dashboard.

## Dashboard Features

- **Stats**: Total events, unique sessions, app starts, voice interactions, tool uses, active versions, countries, errors
- **Timeline**: Events over last 30 days
- **Event Types**: Breakdown by event type
- **Users by Country**: Anonymous country breakdown (derived from system locale, e.g. `de_DE` → `DE`)
- **Error Codes**: Breakdown by error code (E001–E016)
- **Top Tools**: Most used tools
- **Recent Events**: Latest 50 events with country and error code columns

## Error Codes

| Code | Error |
|------|-------|
| E001 | Ollama not reachable |
| E002 | No microphone found |
| E003 | Wake word model missing |
| E004 | Backend starting |
| E005 | Backend failed to start |
| E006 | WebSocket disconnected |
| E007 | WebSocket error |
| E008 | Fetch request failed |
| E009 | Settings load failed |
| E010 | Settings save failed |
| E011 | Audio test failed |
| E012 | TTS failed |
| E013 | Voice trigger failed |
| E014 | Re-index failed |
| E015 | Onboarding save failed |
| E016 | UI crash |

## Security Notes

- **No direct table access**: Row Level Security blocks all direct inserts — only the `insert_nox_events` RPC can insert
- **Token validation**: The RPC function validates a secret token stored in PostgreSQL config (`app.nox_analytics_token`)
- **Rate limiting**: RPC rejects batches larger than 100 events
- **Anon key** is safe to embed — it can only call the RPC (which requires the token), not read data
- **Dashboard** requires email+password authentication via Supabase Auth
- **No IPs, no user content** — only event type, version, OS, locale (→ country), session ID, error code
- **Country is derived** from system locale (e.g. `de_DE` → `DE`), not from IP address — fully anonymous
- **Session ID** is a random UUID generated per app start — not traceable to a user

## Dashboard Security (Open Source Protection)

Since this project is open source, the dashboard URL and code are publicly visible. These measures ensure only authorized users can access analytics:

### Client-side protections
- **Brute-force lockout**: After 5 failed login attempts, login is locked for 60 seconds
- **Session timeout**: Auto-logout after 15 minutes of inactivity (with 5-minute warning)
- **Token revocation**: Logout calls Supabase `/auth/v1/logout` to invalidate the token server-side
- **401 auto-logout**: If the API returns 401 (expired/invalid token), the dashboard auto-logs out
- **Password clearing**: Password field is cleared from memory immediately after login attempt
- **CSP headers**: Content-Security-Policy prevents XSS, clickjacking, and external resource loading
- **No referrer**: Referrer-Policy set to `no-referrer` to prevent leaking dashboard URL
- **No indexing**: `noindex, nofollow, noarchive, nosnippet` prevents search engine indexing
- **Session age check**: Stored sessions older than 15 minutes are automatically discarded

### Supabase dashboard settings (MUST configure)
1. **Authentication → Providers → Email**:
   - Disable **"Allow new users to sign up"** — prevents anyone from creating accounts
   - Enable **"Confirm email"** — requires email verification
2. **Authentication → URL Configuration**:
   - Set **Site URL** to your GitHub Pages URL only
   - Remove all redirect URLs except your dashboard URL
3. **Authentication → Rate Limits**:
   - Set **Auth rate limit** to 10 requests per minute (or lower)
   - Enable **CAPTCHA** (hCaptcha or Cloudflare Turnstile) on login
4. **Database → Settings**:
   - Set the `app.nox_analytics_token` to a strong 32+ character random string
5. **API Settings**:
   - Ensure **anon key** can only access the RPC function (RLS handles this)
6. **User Management**:
   - Only create users you trust
   - Set `analytics_access: true` in user's `app_metadata` (via SQL or dashboard)
   - Regularly review active sessions in Authentication → Users
