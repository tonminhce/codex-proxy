# CodexProxy

A local desktop gateway and account manager for OpenAI Codex. Tauri v2 and Rust handle networking, OAuth, storage, scheduling, and process management; React 19 provides the UI. No Go proxy sidecar, Electron, analytics, or remote credential storage.

## What works

- Real upstream forwarding for Responses, Responses compaction, model discovery, and Chat Completions. Streaming Responses events—including tool calls—are forwarded without inventing completions.
- ChatGPT OAuth accounts and API-key accounts. OAuth credentials are restricted to OpenAI endpoints; custom provider routes require a matching API-key account.
- Account selection, quota reserve, session affinity, pre-response failover, request timeouts, rate limits, and optional gateway client keys.
- Persistent account, gateway, instance, task, and application settings. Writes are atomic; Unix credential files use mode 0600.
- Up to 500 in-memory request summaries and session token counters. Request/response bodies and credentials are not logged.
- Scheduled quota checks and expired-token refresh. Polling usage does **not** guarantee a quota reset or start a rolling window.
- Isolated Codex CLI app-server instances with real PIDs and loopback connection endpoints. These are CLI servers, not additional Codex Desktop windows.
- Explicit Codex auth switching and optional TOML overrides, with backups. Importing accounts does not overwrite your normal Codex profile.

The OAuth Chat Completions adapter supports text, user images, function tools, tool results, streaming, and non-streaming replies. Unsupported generation controls return an error; API-key accounts forward the native Chat Completions request.

## Develop and verify

Use Node.js 22+, npm, a current stable Rust toolchain, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm ci
npm run tauri:dev
```

Plain `npm run dev` is a browser-only preview: it has no account storage or simulated successful operations.

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm test
npm run typecheck
npm run build
npm run tauri:build
```

Optional integration test using your installed CLI, synthetic loopback upstreams, and temporary profiles:

```bash
CODEX_PROXY_TEST_CODEX=/opt/homebrew/bin/codex \
  cargo test --manifest-path src-tauri/Cargo.toml --test cli_smoke -- --ignored
```

No normal test reads your saved tokens, overwrites your Codex profile, or calls live OpenAI services.

## Connect Codex

1. Open **Accounts**, sign in with OAuth, import an auth.json/flat token object, or add an API-key account.
2. Refresh quota if using OAuth. Unknown quota is displayed as unknown, not a fabricated balance.
3. Start the gateway. It defaults to loopback port 8080 and starts stopped on a fresh installation.
4. Point Codex at the gateway. Choose a model your upstream account actually supports.

```toml
model_provider = "codex_local_access"

[model_providers.codex_local_access]
name = "CodexProxy"
base_url = "http://127.0.0.1:8080/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
# Required if you create a client key in the Gateway page:
# env_key = "CODEX_PROXY_CLIENT_KEY"
```

Set the optional environment variable to your generated **gateway client key**, not an upstream credential. Codex custom providers and service-tier overrides follow the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Health check while the gateway is running:

```bash
curl --fail http://127.0.0.1:8080/health
```

Model discovery forwards the selected account's upstream catalog; no hard-coded model availability is promised. Namespaced routes use the configured target model. Unrecognized/disabled namespaces fail rather than falling back to an unrelated provider.

## Profiles and safety

Application data lives in `~/.codex-proxy/`. Isolated profiles live under its `profiles/` directory. The default external profile is `~/.codex/`; changing that path or applying overrides is an explicit UI operation.

- **Switch account** updates the selected external auth.json. OAuth switching requires that account's own ID token; it never borrows another account's identity.
- The first existing auth/config file is backed up with a `codex-proxy-backup` suffix. Removing an account or instance definition does not delete external auth files or profile directories.
- Credential files are local plaintext protected by filesystem permissions, not encrypted vaults. Protect local backups and your OS account.
- With no configured client keys, native loopback clients can connect without a key. Once any key exists, an enabled key is required. LAN mode requires a key, uses plain HTTP, and is suitable only for a trusted network or protected tunnel.
- Browser-origin requests and unexpected loopback Host headers are rejected. Wildcard browser CORS is intentionally not enabled.
- Model payloads go to the upstream provider selected by the user. Local no-payload-logging is not a claim about that provider's retention policy.
- The OAuth callback uses localhost:1455, matching the [documented Codex login callback](https://learn.chatgpt.com/docs/auth). Close another login flow if that port is occupied.
- Changing gateway ports or keys requires restarting existing managed instances so their launch configuration is refreshed.

## Verification boundaries

The automated tests cover local protocol compatibility and failure handling. The opt-in smoke test also runs the installed Codex CLI and launches/stops a real app-server without using live credentials. Actual OAuth authorization, account/model entitlement, and live OpenAI responses still require an interactive account-specific check. Private ChatGPT backend behavior can change independently of the public API.

**Security notice:** earlier repository revisions contained credential-looking test fixtures. They have been removed from current source, not Git history. Revoke/rotate the affected credentials and arrange history cleanup separately if required.
