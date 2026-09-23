# UI design and verification

Updated 2026-09-23.

## Direction

The interface uses graphite surfaces, a muted mint accent, system fonts, compact metadata, and clear page hierarchy. Navigation is deliberately lower-contrast than the main content; primary actions carry the accent. Borders separate functional groups rather than decorating every element.

The design research emphasized two sources:

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) — consistent placement, less competing visual weight, softer structural boundaries, and quieter navigation.
- [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions) — unnecessary motion should be avoidable, and system motion preferences should be respected.

This is an original implementation of those principles, not a replica of either product.

## System

- `src/index.css` owns color tokens, layout, component surfaces, breakpoints, and motion.
- Shared UI components own semantic buttons, badges, progress bars, sliders, fields, switches, notices, confirmations, and dialogs.
- The shell includes grouped navigation, a breadcrumb, a persistent status bar, and a searchable Cmd/Ctrl+K navigation palette.
- All seven pages use the same headers, action styles, empty states, and form spacing.
- API-key accounts show provider-managed quota; unknown OAuth quota is not presented as a known balance.
- Gateway port/limit edits and routing-slider changes have explicit save/apply actions.
- Removing accounts, keys, routes, schedules, instances, or request history requires confirmation. External Codex profile writes have a separate confirmation.
- Clipboard success appears only after the write succeeds. Errors remain visible, including inside modals.
- Dialogs render in a portal, make the app shell inert, trap focus, restore it on close, and support Escape/backdrop dismissal. Busy authorization and save operations cannot be dismissed accidentally.

## Motion

Motion is CSS-only; no animation package or remote font dependency was introduced.

| Interaction          | Duration   | Treatment                        |
| -------------------- | ---------- | -------------------------------- |
| Page navigation      | 280 ms     | Opacity and a 7 px entrance      |
| Dialog opening       | 220 ms     | Small translation and scale      |
| Backdrop             | 150 ms     | Opacity                          |
| Buttons and switches | 150–180 ms | Color and short control movement |
| Quota changes        | 400 ms     | Bar-width interpolation          |

The easing curve is `cubic-bezier(.22, 1, .36, 1)`. There is no decorative perpetual pulse or parallax. Busy operations use a small spinner and retain a readable action label. `prefers-reduced-motion: reduce` disables animations and transitions, including the spinner motion.

## Verification completed

- **53 frontend tests:** backend-owned state, component behavior, page interactions, all seven pages in empty and populated states, eight dialog accessibility checks, color-token contrast, motion and overflow safeguards.
- **Automated semantic accessibility checks:** axe-core in jsdom. No detected violations in the tested states. Color-contrast checking is disabled in jsdom because it does not render layout; core token-pair contrast is tested separately at a minimum of 4.5:1.
- **Browser inspection:** all seven pages; account connection and request-detail dialogs; populated cards, long labels, routes, request errors, and schedule results using explicit synthetic fixtures.
- **Responsive sweep:** all seven pages at 1280 px, 960 px, and 480 px; selected instance checks at 720 px; 960×640 minimum desktop sizing. Main-page horizontal overflow was corrected in narrow request/key tables; overflow is now contained to each table.
- **Keyboard:** navigation palette filtering and Enter activation; dialog focus trap, Escape handling, focus restoration, and busy-dismissal prevention.
- **Build checks:** TypeScript, Vite production build, 34 Rust tests, Clippy with warnings denied, and a successful macOS debug `.app` bundle.
- **Dependency audit:** zero reported vulnerabilities at verification time.

The visual fixture entry point is `tests/visual/preview.html`, available only from the development server. It is visibly labeled synthetic, imports no real credentials, never enables Tauri, and is not a production Vite entry point. The normal application still starts with empty backend-owned state.

```bash
npm run dev
# Normal, unpopulated browser preview:
# http://127.0.0.1:5173/
# Explicit populated visual fixtures:
# http://127.0.0.1:5173/tests/visual/preview.html?tab=accounts

npm test
npm run typecheck
npm run build
npm audit
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri:build -- --debug --bundles app
```

## Boundaries

These checks are not a complete WCAG certification or a screen-reader audit. Actual OS Reduce Motion toggling and every native WebView/platform combination were not exercised. Windows and live authenticated OAuth/generation remain unverified. The backend was not modified in this UI pass; previously documented reference-feature gaps remain. Tests and synthetic fixtures must not be represented as live account verification.
