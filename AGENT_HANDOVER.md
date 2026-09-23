# Agent handover: CodexProxy

Updated 2026-09-23. This document replaces the earlier handover's demonstration-state claims.

## Non-negotiable constraints

- Tauri v2 + React 19; gateway, OAuth, scheduler, and account management run in Rust.
- No external proxy binaries or Go sidecars. Optional managed processes are the official Codex CLI app-server itself.
- Local credentials, no analytics, no prompt/response logging.
- Preserve user changes. Never run tests against the real home directory or saved tokens.
- Use CodeGraph first only if the user has created a root .codegraph directory.
- Keep StatusBar/Badge single-line layout protections.

## Implemented architecture

**Rust**

- models.rs: account/quota, validated gateway configuration, session statistics, metadata-only request records.
- storage.rs: atomic JSON/private-file writes, 0600 Unix files, strict corruption handling. Invalid data fails visibly rather than being silently overwritten.
- account.rs: nested auth.json and flat/API-key imports; atomic batch merge by account ID; secret-redacted IPC; explicit auth takeover with backup/rollback; live quota parsing; serialized refresh-token rotation. Imports never perform takeover.
- oauth.rs: PKCE S256 browser authorization, localhost:1455 callback, bounded fragmented-request parsing, state/path/duplicate-parameter validation, cancellation/error response handling, bounded token exchange. Browser confirmation says authorization was received, not that token exchange has already succeeded.
- proxy.rs: Axum in-process HTTP server, acknowledged start/stop/rebind, upstream request forwarding with Reqwest, bounded bodies and incremental SSE forwarding, session affinity, quota-aware routing, failover before streaming begins, rate limits, key validation, browser/DNS-rebinding protections, active-request shutdown, bounded in-memory logs/stats.
- protocol.rs: fragmented UTF-8 SSE decoder, usage extraction support, OAuth Chat Completions compatibility adapter for messages/images/function calls and tool results.
- wakeup.rs: persisted quota-check schedules; disabled/new/startup task behavior; execution-history ownership; overlap protection; error reporting. A usage check is not a model-generation warmup or quota reset.
- settings.rs: local application preferences and explicit, preserving TOML overrides. Saving settings alone never edits Codex config. Blank overrides leave existing config keys unchanged.
- instances.rs: saved isolated profile definitions, validated provider routes, real managed CLI app-server processes, exit polling, stop/reap on exit. Custom routes can only use API-key credentials registered for the exact upstream URL.
- lib.rs: Tauri IPC and tray lifecycle. Start background work with tauri::async_runtime::spawn in setup, not bare tokio::spawn.
- tests/cli_smoke.rs: opt-in installed-CLI protocol and managed-instance integration check, all with synthetic local endpoints and temporary profile directories.

**React**

Every store is backed by IPC. There are no seeded accounts, tokens, request logs, schedules, fake PIDs, or optimistic success fallbacks. Empty backend lists replace existing UI lists. Mutating operations update UI only after success; failures appear in an app-level banner and open modals. App.tsx polls backend state without overlapping polling batches. Browser preview clearly says the backend is unavailable.

The gateway store serializes writes. Accounts passes actual API-key input to Rust but retains only redacted account metadata. Settings uses separate Save and Save-and-apply actions. Modal focus is trapped and errors remain visible.

The 2026-09-23 UI pass added a graphite/mint design system, CSS-only reduced-motion-aware transitions, Cmd/Ctrl+K navigation, explicit form saves, confirmation dialogs, searchable accounts, improved request filters, and responsive states across all seven pages. Navigation labels now use Overview, Gateway, Instances, Schedules, and Request logs, while internal tab IDs are unchanged. See docs/UI_DESIGN.md for evidence and verification boundaries. Synthetic visual fixtures live only under tests/visual and are not imported into the production application.

## Gateway contract

- GET /health and /ping: listener health, no upstream call.
- GET /v1/models (also /models): selected account's real upstream catalog.
- POST /v1/responses (also /responses): JSON or upstream SSE.
- POST /v1/responses/compact (also /responses/compact): non-streaming compaction forwarding.
- POST /v1/chat/completions (also /chat/completions): native API-key forwarding, or OAuth Responses adapter.
- Unknown paths, unsupported methods, bad JSON/content types, unavailable accounts, invalid keys, and upstream failures return errors. No canned success.
- Upstream SSE bytes are preserved for Responses and native Chat. Truncated streams never receive an invented response.completed.
- OAuth Responses uses store=false and streaming; non-streaming clients receive the terminal response aggregated from the stream.
- Chat adapter unsupported generation controls fail explicitly. No WebSocket gateway, persisted response retrieval, image-generation endpoint, or generic arbitrary-path proxy is advertised.
- Session affinity uses session_id/x-session-id scoped by gateway key. Instance-owned profile config sends x-codex-proxy-instance.
- Namespaced routes are unique across profiles and pin the registered provider account. They do not forward OAuth secrets.
- Logs are capped at 500 records, memory only. Tokens/counters are for this application session.
- Default: stopped, 127.0.0.1:8080, no keys, native loopback clients only. LAN requires an enabled key. Disabling all existing keys denies access; deleting all keys returns to unauthenticated loopback mode.

## Persistence and external profile writes

Local files: accounts.json, gateway.json, settings.json, instances.json, wakeup_tasks.json under ~/.codex-proxy. Credentials are plaintext local files with Unix permissions, not an encrypted vault.

External auth.json is updated only by explicit Switch or a refresh of the same active account already present in that file. OAuth schema retains auth_mode=chatgpt, OPENAI_API_KEY=null, tokens with id/access/refresh/account ID, and last_refresh. API-key takeover uses the API-key schema.

One-time backups use auth.json.codex-proxy-backup and config.toml.codex-proxy-backup. No automatic deletion of instance directories or external auth files.

Never copy real credentials into tests, examples, screenshots, logs, or commits. Old revisions contained credential-looking fixtures and tests that wrote real profile files. Current tests are isolated; affected credentials still require user-controlled revocation/rotation, and history remains unchanged.

## Verification

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm ci
npm test
npm run typecheck
npm run build
npm audit

# Opt-in, installed CLI; does not use live accounts:
CODEX_PROXY_TEST_CODEX=/opt/homebrew/bin/codex \
  cargo test --manifest-path src-tauri/Cargo.toml --test cli_smoke -- --ignored

# macOS debug application bundle:
npm run tauri:build -- --debug --bundles app
```

At the latest UI verification: 34 Rust tests and 53 frontend tests pass. Clippy and frontend typecheck/build pass; npm audit reports zero vulnerabilities. The macOS debug CodexProxy.app bundle built successfully at src-tauri/target/debug/bundle/macos/CodexProxy.app. The installed Codex 0.154.0 passed the separate CLI/app-server smoke test during the earlier backend implementation; it was not rerun for this UI-only change. Test discovery is restricted to src/**/*.test.{ts,tsx}, excluding the ignored .reference clone.

## Boundaries and follow-up checks

- Interactive OAuth login and live authenticated OpenAI requests have not been exercised with the user's credentials. Do not claim they were.
- Windows packaging/process/permissions behavior has not been verified on Windows.
- Browser preview verification covers layout and unavailable-backend error behavior, not live Tauri IPC.
- System-login autostart is not installed. The setting controls starting the gateway when the app opens.
- Instance launch manages a CLI app-server with a loopback endpoint; use codex --remote ENDPOINT to connect. It is not a Codex Desktop window launcher.
- Restart managed instances after gateway port/key changes. Saved instance config preserves unrelated TOML settings.
- Private OAuth/usage/Codex endpoints can change; validate live compatibility without exposing credentials.
- Credential revocation and Git-history rewriting are separate, explicitly authorized operations.
- Do not push or rewrite history without user authorization.

### Reference audit correction

The initial implementation did not establish full parity with .reference. Subsequent read-only comparison found that its wakeup scheduler executes model prompts (ours only polls quota), its instance system supports Desktop launching (ours manages CLI app-server processes), its OAuth flow has a callback-port fallback (ours binds 1455 only), and its Responses normalization handles additional compatibility cases. The UI redesign does not resolve those backend differences. Do not describe the app as fully reference-equivalent or live-account verified.

Official references used: [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [authentication](https://learn.chatgpt.com/docs/auth), [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [Codex app-server](https://learn.chatgpt.com/docs/app-server).
