# Agent Handover & Architecture Guide: CodexProxy

> **Purpose**: This document serves as the authoritative operational and architectural handover for any incoming AI agent or engineer working on `codex-proxy`. Read this document carefully before making changes.

---

## 1. Project Background & Core Philosophy

- **Goal**: `codex-proxy` is a specialized desktop gateway and account manager built **specifically and solely for OpenAI Codex**.
- **The Problem It Solves**: The original "Cockpit Tools" project was overloaded with bloat: 15+ irrelevant IDE configurations, commercial advertisements, telemetry trackers, and a separate Go sidecar (`cockpit-cliproxy`) requiring external process management.
- **The Constraints (Strict)**:
  1. **Pure Rust Host**: All backend gateway logic, OAuth handling, schedulers, and account management must run in-process inside Tauri v2 Rust. **No Go sidecars, no external proxy binaries**.
  2. **Tauri v2 + React 19**: Modern desktop stack with Vite and Tailwind CSS. **No Electron**.
  3. **Zero Retention / Local Only**: No external analytics, no telemetry. All credentials stay local in `~/.codex-proxy/` and `~/.codex/`.
  4. **Strict Quality Bar**: Must always pass `cargo test`, `npm run typecheck`, and `npm run build` with 0 errors.

---

## 2. System Architecture & Component Map

```mermaid
flowchart TD
    subgraph Frontend ["React 19 Frontend (src/)"]
        DASH["DashboardPage.tsx"]
        ACC["AccountsPage.tsx"]
        WAKE_UI["WakeupPage.tsx"]
        GW_UI["GatewayPage.tsx"]
        INST_UI["InstancesPage.tsx"]
        LOG_UI["InspectorPage.tsx"]
        SET_UI["SettingsPage.tsx"]
        STORES["Zustand Stores (src/stores/)"]
    end

    subgraph RustHost ["Tauri v2 Host (src-tauri/)"]
        LIB["lib.rs (AppState & IPC Handler)"]
        PROXY["proxy.rs (In-Process HTTP & SSE :8080)"]
        OAUTH["oauth.rs (PKCE Loopback & Token Exchange)"]
        WAKE["wakeup.rs (Tokio Scheduler Loop)"]
        ACCT["account.rs (Account Pool & ~/.codex Takeover)"]
        MODELS["models.rs (Core Structs)"]
    end

    subgraph External ["External Services & Clients"]
        CLI["OpenAI Codex CLI (/opt/homebrew/bin/codex)"]
        OAI_AUTH["https://auth.openai.com"]
        OAI_USAGE["https://chatgpt.com/backend-api/wham/usage"]
        STORAGE_PROXY["~/.codex-proxy/ (accounts.json, wakeup_tasks.json)"]
        STORAGE_CODEX["~/.codex/ (auth.json, config.toml)"]
    end

    Frontend <-->|Tauri IPC (invoke)| LIB
    LIB --> PROXY
    LIB --> OAUTH
    LIB --> WAKE
    LIB --> ACCT

    CLI <-->|HTTP & Responses SSE| PROXY
    OAUTH <-->|PKCE Auth Code & Token Exchange| OAI_AUTH
    WAKE -->|Keepalive Ping (Every 30s Loop)| OAI_USAGE
    ACCT -->|Live Quota Sync| OAI_USAGE
    ACCT -->|Refresh Token| OAI_AUTH
    ACCT <-->|Persistence| STORAGE_PROXY
    ACCT -->|Sync Active Profile| STORAGE_CODEX
```

---

## 3. Directory & File Walkthrough

### Backend (`src-tauri/`)
- [`src-tauri/src/lib.rs`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src-tauri/src/lib.rs): Main application entrypoint. Initializes `AppState` (`AccountManager`, `ProxyServer`, `WakeupManager`, `GatewayConfig`), starts background loops, registers system tray menu (Quit, Show/Hide), and exposes all Tauri IPC invoke commands.
- [`src-tauri/src/proxy.rs`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src-tauri/src/proxy.rs): In-process HTTP & Server-Sent Events (SSE) server listening on `127.0.0.1:8080`:
  - `GET /health` & `/ping`: Returns `{"status":"healthy","engine":"rust-in-process"}`.
  - `GET /v1/models`: OpenAI-compatible models catalog (`gpt-5.5`, `gpt-5.6-luna`, `gpt-image-2.5`, `deepseek-v4-flash`).
  - `POST /v1/responses`: **Codex Responses Wire API**. Implements the full SSE lifecycle: `response.created` → `response.output_item.added` → `response.output_text.delta` → `response.output_item.done` → `response.completed`. Compatible with `/opt/homebrew/bin/codex exec`.
  - `POST /v1/chat/completions`: Handles both JSON and SSE streaming (`"stream": true`) with `data: [DONE]`.
  - `OPTIONS *`: CORS preflight handling.
- [`src-tauri/src/oauth.rs`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src-tauri/src/oauth.rs): Official OpenAI PKCE OAuth flow:
  - Generates 32-byte `code_verifier` and SHA-256 S256 `code_challenge`.
  - Binds an ephemeral local TCP listener (`127.0.0.1:<port>/auth/callback`).
  - Launches system browser with Client ID `app_EMoamEEZ73f0CkXaXp7hrann`.
  - Catches code on redirect, returns a confirmation web page to the browser, exchanges code at `https://auth.openai.com/oauth/token`, parses JWT claims, and stores the account.
- [`src-tauri/src/wakeup.rs`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src-tauri/src/wakeup.rs): Keepalive Wakeup Engine:
  - Background Tokio loop runs every 30 seconds.
  - Pings `https://chatgpt.com/backend-api/wham/usage` with live tokens to keep sessions warm and start the rolling 5-hour rate limit reset early.
  - Persists schedule to `~/.codex-proxy/wakeup_tasks.json`.
- [`src-tauri/src/account.rs`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src-tauri/src/account.rs): Multi-account manager:
  - Storage in `~/.codex-proxy/accounts.json`.
  - Cleans JSON with trailing commas (`clean_json_trailing_commas`).
  - Live quota queries (`wham/usage`) parsing `primary_window` (hourly), `secondary_window` (weekly), and `reset_credits`.
  - Token refresh via `https://auth.openai.com/oauth/token`.
  - **`sync_profile_takeover`**: When switching accounts, writes the official schema to `~/.codex/auth.json` with `auth_mode: "chatgpt"`, `tokens: { id_token, access_token, refresh_token, account_id }`, and `last_refresh`.
- [`src-tauri/src/models.rs`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src-tauri/src/models.rs): Rust data definitions (`CodexAccount`, `CodexQuota`, `WakeupTask`, `GatewayConfig`).

### Frontend (`src/`)
- [`src/components/layout/AppLayout.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/components/layout/AppLayout.tsx): Root layout with gradient depth and viewport padding to prevent bottom clipping.
- [`src/components/layout/Sidebar.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/components/layout/Sidebar.tsx): Navigation sidebar with draggable macOS titlebar region, live gateway status indicator, and high-res brand logo.
- [`src/components/layout/StatusBar.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/components/layout/StatusBar.tsx): Single-line footer showing Gateway URL, Active Profile, Privacy Mode, and Engine runtime. All items have `whitespace-nowrap flex-shrink-0` to eliminate wrapping.
- [`src/components/ui/ProgressBar.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/components/ui/ProgressBar.tsx): Custom dual-tone glow gradient progress meters.
- [`src/components/ui/Slider.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/components/ui/Slider.tsx): Custom gradient slider with quick presets.
- [`src/pages/DashboardPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/DashboardPage.tsx): Gateway control, stats cards, rate limit meters, Account Pool Routing table with 1-click active switch, and live stream logs.
- [`src/pages/AccountsPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/AccountsPage.tsx): Account cards, plan badges, quota gauges, active profile indicator, PKCE login trigger, and JSON batch importer.
- [`src/pages/WakeupPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/WakeupPage.tsx): Wakeup task list, interval configuration (2h, 4h, 6h, 12h, 24h), execution history, duration, and manual trigger.
- [`src/pages/GatewayPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/GatewayPage.tsx): Gateway configuration (port, timeout, rate limiting).
- [`src/pages/InstancesPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/InstancesPage.tsx): Route routing (`cpa/*`, `deepseek/*`, `openai/*`).
- [`src/pages/InspectorPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/InspectorPage.tsx): Request logging inspector with segmented filters (`All`, `Success`, `Errors`).
- [`src/pages/SettingsPage.tsx`](file:///Users/tonminh-mac/Documents/GitHub/codex-proxy/src/pages/SettingsPage.tsx): Path overrides for `~/.codex` and system options.

---

## 4. Key Conventions & Rules to Remember

1. **`~/.codex/auth.json` Schema Compatibility**:
   The official OpenAI Codex CLI requires the following JSON structure. **Never change this structure or omit `tokens` or `id_token`**, or `codex doctor` will report an auth failure:
   ```json
   {
     "auth_mode": "chatgpt",
     "OPENAI_API_KEY": null,
     "tokens": {
       "id_token": "<jwt>",
       "access_token": "<jwt>",
       "refresh_token": "<rt_token>",
       "account_id": "<uuid>"
     },
     "last_refresh": "2026-09-22T00:00:00Z"
   }
   ```
2. **OpenAI OAuth Client Details**:
   - Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
   - Authorization URL: `https://auth.openai.com/authorize`
   - Token Exchange URL: `https://auth.openai.com/oauth/token`
   - Scopes: `openid email profile offline_access api.connectors.read api.connectors.invoke`
   - PKCE Challenge Method: `S256` with URL-safe unpadded base64 encoding.
3. **Codex Responses Wire Protocol**:
   When clients use `wire_api = "responses"`, requests to `/v1/responses` must be responded to with `Content-Type: text/event-stream` containing `event: response.completed` as the terminal event, otherwise Codex CLI will error with `stream disconnected before completion: stream closed before response.completed`.
4. **Desktop Layout Stability**:
   Never remove `whitespace-nowrap flex-shrink-0` from `StatusBar.tsx` or `Badge.tsx`. This ensures single-line developer-grade alignment across different window widths without wrapping or visual clipping.
5. **Tauri Background Async Spawning**:
   In Tauri v2 `setup()`, always use `tauri::async_runtime::spawn` instead of naked `tokio::spawn`, because Tauri manages its own async runtime context.

---

## 5. Verification Commands

Before concluding any work, run the following verification pipeline:

```bash
# 1. Rust unit & integration test suite (must pass 16 of 16)
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture

# 2. TypeScript compilation check
npm run typecheck

# 3. Production asset bundling
npm run build

# 4. Proxy Health check
curl -s http://127.0.0.1:8080/health

# 5. Codex CLI Live Verification
codex exec --ephemeral \
  -c model_provider="codex_local_access" \
  -c model_providers.codex_local_access.base_url="http://127.0.0.1:8080/v1" \
  -c model_providers.codex_local_access.wire_api="responses" \
  -c model_providers.codex_local_access.requires_openai_auth=false \
  -c model_providers.codex_local_access.supports_websockets=false \
  "ping"

# 6. Codex CLI Auth Diagnostic
codex doctor
```

---

## 6. Remote Repository

- **Origin**: `https://github.com/tonminhce/codex-proxy.git`
- **Primary Branch**: `main`
- All changes are synchronized and up to date.
