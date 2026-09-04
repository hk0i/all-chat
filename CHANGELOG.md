# Changelog

All notable changes to this project are documented here.

## v.1.1.0

### Added
- **Auth**: password hashing, token generation, login endpoints (env-var password), setup/status pages, admin token management pages, option to disable auth entirely.
- **OAuth**: platform models/config, API endpoints, admin UI for connection status + disconnect, multi-connection support per platform (Twitch/YouTube), Facebook OAuth groundwork + endpoints, auto token refresh on message send (Twitch/YouTube).
- **Chat ingestion/send**: Facebook chat ingestion + normalization, send chat via Twitch with profile dropdown to pick sending account, send via YouTube, send via Facebook (OAuth-connected).
- **Message timestamps**: EDD, `formatTimestamp` helper, `showTimestamps` state + query-param parsing, header toggle button, rendered in feed.
- **Header profile-switcher**: fetch profile list on mount, dropdown markup, toggle + outside-click/Escape close, wire selection to local switch + overlay pointer, hover/focus/active-indicator states, extracted to `ProfileSwitcher.svelte`.
- Version number surfaced in header for end users.
- Release script (`scripts/release.sh`) to bump versions across workspaces, commit, and tag — with regex support for prerelease suffixes (`-beta.1`, `-RC.1`, etc).
- Basic error logging to console (manager).

### Changed
- Bare `/` route now adopts the active overlay profile as implicit target.
- `npm run dev` shares the same `.env` as Docker.
- Secrets moved outside the working directory for improved security.
- Message `Date` built once and shared between `datetime` attribute and `formatTimestamp` (single source of truth).
- `connectStream`/`closeStream` hoisted out of `onMount` to component scope.
- EDDs renamed to `<date>-<name>.edd.md` and cross-references updated for clearer history when browsing.
- Dock header: icons/avatars/timestamps/theme toggles collapsed into a single options popover (`DisplayOptionsMenu.svelte`), trigger collapses to a gear icon at narrow widths — more room for small OBS dock sizes.

### Fixed
- EDD markdown headers now render as tables instead of clumped paragraphs.

### Docs
- v2 EDD first draft, with sections on the Facebook app-review multiplier problem, HTTPS redirects from the OAuth flow, and forward-looking notes on native mobile client discovery over mDNS/LAN.