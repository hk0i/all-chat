# All Chat — Engineering Design Doc v2 (EDD-V2)

**Status:** Draft
**Date:** 2026-07-20
**Scope:** v2
**Author:** Gregory McQuillan
**License:** This document is CC BY-SA 4.0 — see [docs/LICENSE](LICENSE). Source code elsewhere in this repo is licensed separately (root [LICENSE](../LICENSE), [shared/contract/LICENSE](../shared/contract/LICENSE)).
**Builds on:** [EDD.md](EDD.md) (v1). Sections below reference v1 sections by number (e.g. [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)) rather than restate them.

*Acronyms link to the [glossary](#9-glossary) on first use; terms already defined in [EDD.md §11](EDD.md#11-glossary) aren't redefined here.*

## 1. Overview

v1 is read-only: no logins, no writes, three platforms. v2's job is to add the two things v1 deliberately deferred — **sending** chat and **Facebook Live** — plus the app-level auth v1 only reserved hooks for ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)), and to figure out how All Chat reaches streamers who won't run `docker run`.

Two credential systems exist in v2 and must not be confused:

| | Who authenticates to whom | Why it exists |
|---|---|---|
| **App auth** ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) — admin password, bearer tokens, URL tokens) | The streamer (or their client) authenticates *to All Chat* | Protects a publicly-hosted All Chat instance from strangers |
| **Platform auth** (this doc, [§3](#3-platform-auth-login-connections)) | All Chat authenticates *to Twitch/Kick/YouTube/Facebook* | Required to send messages, and required to even read Facebook |

A fully-configured v2 deployment needs both, but they're independent: a LAN-only streamer might never turn on app auth yet still connect platform OAuth to send messages.

## 2. Goals / Non-goals

### Goals (v2)

- Facebook Live read support ([§4](#4-facebook-live-support)), unlocked by platform OAuth.
- Platform OAuth connections for Twitch, YouTube, and (where available) Kick and Facebook ([§3](#3-platform-auth-login-connections)), used for sending and for Facebook reads.
- Chat input box: compose once, fan out to every connected platform in the active profile ([§5](#5-chat-input-send-fan-out)).
- App-level auth built out from the v1 hooks: login UI, session management, token issuance in a control panel ([§6](#6-app-level-auth-building-out-edd-61)).
- At least one lower-friction distribution path for non-technical streamers, beyond `docker run` ([§7](#7-distribution-beyond-docker)).

### Non-goals (v2)

- Multi-user / team accounts — still single-streamer-per-deployment (unchanged from [EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)).
- Moderation actions (timeouts, bans, deletes) — still deferred, TBD in a later doc.
- A plugin marketplace / sandboxed plugin execution ([EDD §9.2](EDD.md#92-what-the-bot-owns-design-sketch-full-edd-lives-in-the-bots-repo)) — homebrew plugins stay unsandboxed, self-hosted.

## 3. Platform auth (login connections)

Each platform's send path and Facebook's read path need an OAuth-obtained token. All four are different enough to need separate notes:

| Platform | Auth mechanism | Read impact | Send capability |
|----------|----------------|-------------|------------------|
| Twitch | OAuth (`user:write:chat` scope) via Twitch's standard authorization-code flow | None — anonymous IRC read ([EDD §3.1](EDD.md#31-twitch)) unaffected | Helix "Send Chat Message" endpoint (implemented) — a stateless POST, not a second authenticated IRC connection; the anonymous read socket stays untouched |
| YouTube | OAuth (Google, `youtube` scope) | None — InnerTube read ([EDD §3.3](EDD.md#33-youtube)) unaffected | `liveChatMessages.insert` (implemented) — the official Data API v3, a different family entirely from the unofficial InnerTube read path; quota-metered (200 units/call), unlike the free read path |
| Kick | Kick's official API/app-registration story is newer and less battle-tested than Twitch/YouTube's | None — Pusher read ([EDD §3.2](EDD.md#32-kick)) unaffected | Track Kick's official app platform as it matures; treat as higher risk than Twitch/YouTube (consistent with the unofficial-API risk already logged in [EDD §7](EDD.md#7-risks)) |
| Facebook | Graph API OAuth, page access token, app review required for live-comment permissions | **Required even to read** — no anonymous path exists (this is why Facebook was deferred past v1, [EDD §2](EDD.md#2-goals-non-goals)) | Graph API comment-posting endpoint, same page token |

Design:

- **Many connected accounts per platform, not one** (revised — the original draft said "one OAuth connection per platform per deployment," which quietly conflated "single admin/operator" with "single connected account" and contradicted v1's own design: profiles already let the same platform repeat as a source, EDD §1/§2. Connecting a co-streamer's Twitch account, or an alt, alongside the main one is a normal, unremarkable action — same multiplicity as reading, now for sending too). "Connect Twitch," "connect YouTube" buttons in the control panel always add a new connection; nothing is overwritten by reconnecting.
- Tokens (access + refresh where the platform issues them) stored server-side in `/data`, alongside the app-auth config ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)'s `config.json`) — never sent to any client. Twitch/YouTube connections are labeled with the connected account's own display name/handle (fetched via one extra API call right after token exchange) so multiple connections on the same platform are distinguishable in the UI.
- Send is a standalone dispatcher (`send.ts`), not a method on `ChatSource` — sending doesn't need a persistent connection the way reading does (see the Twitch row above), so it didn't make sense to force it onto the same stateful interface. `SourceConfig.connectionId` says *which* connection a source sends through — implemented (originally added for Facebook's read path, §4, then reused here); absent `connectionId` means read-only, same as v1 behavior.
- Facebook's `ChatSource` implementation is gated entirely behind having a connected token — there is no anonymous fallback to build first.
- **Token refresh — implemented.** `web/src/lib/server/auth/tokenRefresh.ts`'s `ensureFreshToken()` runs right before every send attempt uses a Twitch/YouTube connection's token (not a background timer — token freshness only ever matters at the moment of use, and read paths for both platforms are anonymous, unaffected). Expired-or-expiring-soon (60s safety margin) triggers a refresh via `oauth.ts`'s existing `refreshAccessToken()`, persisted via `updatePlatformConnectionTokens()`; a dead refresh token surfaces as a normal per-target send failure ("reconnect this account"), not a crash. One real gotcha caught in review: Google doesn't resend a `refresh_token` on refresh (only on first consent) — naively persisting the refresh response as-is would silently wipe the stored refresh token via `updatePlatformConnectionTokens`'s `Object.assign`, permanently breaking every subsequent refresh; fixed by falling back to the existing refresh token when the response omits one (covered by a regression test). Facebook Page tokens aren't handled by this path — they're derived from a long-lived user token, a different lifecycle than Twitch/Google's short access-token cadence (EDD-V2 §4).

**Redirect URI must be HTTPS — a constraint the rest of the app doesn't have (confirmed hands-on, not just from docs).** Every OAuth provider validates the `redirect_uri` scheme; Twitch's docs state HTTPS is required with exactly one exception: `http://localhost:PORT` (literally the hostname `localhost`, not `127.0.0.1` or a LAN hostname like `chat.lan`). This is a real wall for the plain-HTTP-over-LAN story the rest of the app is built around ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) already declined self-signed HTTPS-over-LAN as not worth the setup cost for that reason) — platform-connect is the one flow in this app that can't just tolerate plain HTTP.

Self-signed certs *technically* satisfy the provider's check — Twitch only string-matches the scheme/URL, it never fetches the callback to validate the cert; only the streamer's own browser does, during the consent redirect, and a browser click-through-the-warning works exactly like visiting any other self-signed site. But that doesn't solve the actual goal (a URL native mobile clients can also reach, per [§7](#7-distribution-beyond-docker)'s LAN-discovery plan): a native app's networking stack won't trust a self-signed cert without per-deployment pinning, and every self-hosted instance mints its own unique cert — there's no single cert to bake trust for into a distributed mobile app. Also worth correcting a specific assumption: there's no Twitch rule about port 80 specifically; the wall is the HTTPS scheme requirement itself (plus the `localhost`-only exception), and a real CA can't issue a trusted cert for a bare LAN IP regardless of port, since domain validation needs a name, not an address.

Options, cheapest first:

1. **Treat platform-connect as a `localhost`-only admin action.** No new infrastructure — the admin runs it once from the host machine itself (or via an SSH tunnel/port-forward to their own machine). Doesn't make it mobile-reachable, but it's a rare one-time setup step, not a routine flow — worth first asking whether it needs to be mobile-reachable at all before paying for the alternatives below.
2. **Split-horizon DNS**: point a subdomain you own at the LAN IP, get a real Let's Encrypt cert for that domain, resolve it internally. Real trusted cert, no third-party tunnel dependency, but requires owning a domain and running/configuring internal DNS.
3. **A tunnel** (Cloudflare Tunnel, Tailscale Funnel, ngrok): a real public HTTPS hostname forwarding to the LAN box. No self-signed cert anywhere, reachable from mobile networks too, but adds a third-party dependency and a moving part to the deployment story.

Leaning toward option 1 as the default (zero added infrastructure, matches the project's minimal-footprint stance) with option 3 documented as the answer for anyone who specifically needs platform-connect reachable from a phone.

**Better fix, not yet implemented: OAuth Device Authorization Grant (RFC 8628).** Both Twitch and Google publicly support a device-code flow with *no redirect URI at all* — the server requests a device code + short user code from the provider, the admin visits a provider-hosted verification URL (`twitch.tv/activate`, `google.com/device`) on any device and enters the code, and the server polls the token endpoint until approved. No callback route, no HTTPS wall, no localhost tunnel, no split-horizon DNS — the whole problem above stops applying. This is a materially better fit for a headless self-hosted box than the redirect-based flow currently implemented (`start`/`callback` routes, state-cookie CSRF check), and would likely replace it for Twitch/YouTube specifically. Not universal, though: Kick's OAuth story is too immature to assume support, and Facebook's Graph API is redirect-only — no device grant — so Facebook (§4) still needs the redirect+HTTPS approach or its own broker regardless. Flagged here as the real next design decision for this section; not yet built.

## 4. Facebook Live support

Given [§3](#3-platform-auth-login-connections)'s token requirement, Facebook is really "Facebook OAuth" plus one more `ChatSource`:

1. Streamer connects their Facebook Page via OAuth in the control panel (requires the page to be one they administer).
2. Resolve the active Live Video ID for that page (Graph API `/​{page-id}​/live_videos`).
3. Poll (or subscribe, if Graph API offers a push option for the account's tier) `/​{live-video-id}​/comments`, normalize into the same `ChatMessage` shape as the other three platforms ([EDD §4.1](EDD.md#41-normalized-message-model)) — Facebook becomes a fourth entry in the `platform` union, same fragment/badge model (badges likely empty — Facebook has no analogous badge concept, which is fine, the field is already optional).
4. App-review requirements (Facebook gates live-comment read permissions behind review for anything beyond a handful of test users) mean this ships with a documented waiting period before it works for the general public, independent of engineering effort. Flag this to the streamer up front in the connect-Facebook UI rather than let it surface as a confusing failure later.

**Status: implemented.** `Platform` gained `facebook` directly (the earlier `ConnectablePlatform` split was collapsed once ingestion existed — no reason to keep them separate). `SourceConfig` gained an optional `connectionId`, since `channel` for facebook is just the connected Page's display name and can't itself resolve to a Page access token; `FacebookSource` looks the token up via `connectionId` → `PlatformConnectionRecord`. The control panel's per-source editor picks a connected Page from a dropdown rather than typing a channel. Steps 2-3 poll (no push) — resolve the current `LIVE` video, then poll its `/comments` edge on a fixed interval, restarting the whole pipeline (re-resolve the connection, re-find the live video) on any error, since a poll failure and "the stream ended" look identical from the client's side. Known gaps, not blocking: no Page-token refresh loop yet (Page tokens derived via the long-lived user token are effectively long-lived themselves, so this is lower urgency than it sounds); live-video rediscovery is backoff-polled rather than event-driven.

**Self-hosted multiplier problem (flagged for v3, not designed here):** Facebook's App Review for Page permissions requires **Business Verification** — a legal-entity check — per registered app (per Client ID), not per hosting model. If every self-hosting streamer registers their own Facebook app to connect their own page, every one of them individually clears Business Verification — a real KYC hurdle for a hobbyist, independent of whether their All Chat instance is self-hosted or not. This is the actual pressure toward a SaaS-shaped architecture, not a hosting-convenience argument — see [§7](#7-distribution-beyond-docker)'s SaaS row and the open question below. Worth evaluating a smaller middle ground first: a single centrally-hosted **OAuth broker** — one All Chat-owned Facebook app, Business Verification cleared once, a thin hosted relay doing only the OAuth handshake and handing tokens back to each self-hosted instance — before committing to migrating the whole product to SaaS.

## 5. Chat input / send fan-out

- One compose box in the main feed UI (not per-source) — the "everything is a URL, one unified feed" philosophy ([EDD §1](EDD.md#1-overview)) extends naturally to "one box out" mirroring "one feed in."
- Per-message target selection: every source with a connected account (`connectionId`) in the active profile, no exceptions. Per-platform exclude toggles (deciding not to send to one platform for a given message) were explicitly descoped for now — every connected source gets every send.
- Send path: `POST /api/chat/send { profileId, text }`, authenticated by the app-auth session cookie or a write-scoped bearer token ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks), hooks.server.ts's explicit single-path allowlist for that scope) — this is the "plain POST endpoints alongside the stream" the v1 doc already reserved ([EDD §3.4](EDD.md#34-api-surface-sveltekit-server-routes-consumable-by-any-client), [§9.1](EDD.md#91-all-chat-as-the-chat-gateway)).
- Fan-out result is per-target: some platforms may succeed and others fail (rate limit, expired token, platform outage) in the same send — returned as a `ChatSendResult[]`, one entry per attempted source. Sources with no connected account aren't attempted at all (not reported as failures) — nothing to send through.
- The bot integration ([EDD §9.1](EDD.md#91-all-chat-as-the-chat-gateway)) uses the exact same endpoint with its own write-scoped bearer token — no separate "send" path for bots vs. humans.
- Rate limiting: each platform enforces its own (Twitch's per-account message rate, YouTube's quota) — not yet implemented; a burst send today just surfaces whatever error the platform itself returns (e.g. Twitch's `is_sent: false` drop reason) per-target rather than the server pre-emptively queuing/backing off. Tracked as a gap, not a blocker for a first working send path.

**Status: Twitch and YouTube implemented (both confirmed working against real accounts); Facebook/Kick not yet.** `sendChatMessage()` (`web/src/lib/server/send.ts`) fans out per source, independent per-target try/catch. Twitch sends via Helix's Send Chat Message endpoint (§3's table) — resolves the target channel's numeric id via the Users API, then posts with the connected account's own numeric id (`platformUserId`, captured at connect time alongside the display-name label) as `sender_id`. YouTube reuses the read path's `resolveInput()` (URL/id/`@handle` → video id) to find the target video, then resolves that video's `activeLiveChatId` via `videos.list` and posts through `liveChatMessages.insert` — no equivalent of Twitch's `platformUserId` needed, since the Data API infers the sender from the OAuth token itself. Facebook (comment-post to the live video) currently returns a "not implemented yet" per-target error; Kick has no OAuth story to send through at all (§3's table). The control panel's per-source "send via" picker (profiles editor) is what attaches a `connectionId` to a Twitch/YouTube/Kick source — separate from Facebook's picker, which replaces the channel field entirely (§4) rather than sitting alongside it.

## 6. App-level auth (building out EDD §6.1)

[EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) already designed the three credential shapes (admin password/session, bearer token, read-only URL token) and reserved the hooks (`handle` middleware choke point, `?token=` pass-through, storage in `/data`). v2 is building the actual UI and lifecycle on top of that existing design, not redesigning it:

- **Login screen:** first-run setup sets the admin password (`ALLCHAT_PASSWORD` env or an in-app first-run form — both already specified in [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)); subsequent visits get a plain password login form, session cookie issued per [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)'s `HttpOnly`/`SameSite=Lax`/long-lived-with-refresh terms.
- **Control panel additions:** bearer token issuance/revocation list (name, scope, created date, last used), the platform-OAuth connect buttons from [§3](#3-platform-auth-login-connections), and the "copy OBS URLs" helper ([EDD §4.4](EDD.md#44-configuration-persistence)) upgraded to auto-embed a `?token=` per [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) when auth is on.
- **Migration:** v1 deployments have no `config.json`; its absence already means "auth off" per [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks), so upgrading to a v2 image is a no-op until the streamer opts in by setting a password.

No new design work here — this section exists so the roadmap has a concrete "build this" item distinct from the platform-auth work in [§3](#3-platform-auth-login-connections), which is easy to conflate with it.

**Secret storage: `.env` stays the default, file-based secrets are the more-secure opt-in (implemented).** Plain env vars (`.env`, `docker-compose.yml`'s `environment:` block) leak into `docker inspect` and process-environ dumps — fine for a hobbyist default, not great as the *only* option. `web/src/lib/server/secretsFile.ts` loads an optional single dotenv-format file (`ALLCHAT_SECRETS_FILE`, default `~/.allchat/secrets`) into `process.env` at server startup (called once from `hooks.server.ts`, so it applies uniformly to `npm run dev` and the production/Docker build — no Vite-specific plumbing needed, unlike the root-`.env`-for-local-dev fix below). Real env vars already set always win over the file, so `.env` keeps working standalone with zero interaction. Warns (doesn't block startup) if the file's permissions are looser than owner-only, same posture `ssh` takes toward private keys. For Docker specifically, `docker-compose.secrets.yml` is an opt-in override (`docker compose -f docker-compose.yml -f docker-compose.secrets.yml up`) that bind-mounts the file in as a Docker secret (tmpfs, never in `docker inspect`) rather than a plain volume — kept out of the base `docker-compose.yml` because Compose errors at `up` time if a declared secret's source file doesn't exist, which would break the zero-config default for everyone not using this.

**Aside — why local dev needed its own separate `.env` fix.** `vite.config.ts` now explicitly `loadEnv()`s the repo-root `.env` and assigns it into `process.env` (Vite's own env loading only ever populates `import.meta.env`, never real `process.env`, which is what `providers.ts`/`facebookOAuth.ts` read directly). That fix is unrelated to the secrets-file mechanism above — it exists only because `npm run dev` runs through Vite at all, whereas the production/Docker path (`node build`, no Vite) never needed it; Compose's own `${VAR}` interpolation already delivered `.env` into real container env vars there.

## 7. Distribution beyond Docker

v1 ships one way: a Docker image ([EDD §6](EDD.md#6-deployment)), which assumes comfort with `docker run`/compose, a terminal, and basic networking concepts. That's fine for the Restreamer-adjacent audience v1 targeted, but a wider streamer audience won't clear that bar. Options, evaluated:

| Option | What it is | Effort | Fit |
|--------|-----------|--------|-----|
| **Desktop app wrapper (Electron/Tauri)** | Bundles the existing SvelteKit server + a thin native shell; streamer downloads one installer, double-clicks, gets a system-tray icon and the app opens in a window | Medium — mostly packaging, the app itself is unchanged; Tauri over Electron for footprint (Rust shell vs. bundled Chromium engine cost that Electron pays even though OBS's CEF already pays it once) | Best general-audience fit — no terminal, no Docker knowledge, still points OBS at `localhost` URLs exactly like today |
| **OBS plugin (native C++ dock)** | A compiled OBS plugin that runs the ingestion logic in-process inside OBS itself | High — throws away the "one app, any client" design ([EDD §1](EDD.md#1-overview)) for OBS-only distribution, and means rewriting or embedding the Node/TS ingestion logic in a plugin ABI | Poor fit — couples the whole product to OBS, breaks the mobile/native-client roadmap ([EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf)) that depends on the server being independent of any one client |
| **Single self-contained binary (Bun compile / `pkg`)** | One executable, no Node install required, still runs as a local server the streamer starts and browses to | Low–Medium — mostly a build-target addition, [EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf) already flagged Bun as a footprint escape hatch | Good middle ground for technically-comfortable streamers who don't want Docker specifically; doesn't solve "no terminal at all" |
| **One-click installer script** (`curl \| sh` / signed `.pkg`/`.msi`) | Installs Docker (or the standalone binary) and starts the service, adds a shortcut | Low | Reasonable stopgap, but "pipe a script to your shell" has its own trust/security optics, and doesn't give a dock-icon/menu-bar experience |
| **Hosted SaaS option** | All Chat runs the service centrally; streamer just logs in | High — reintroduces multi-tenancy, billing, and abuse-handling that the whole v1 design ([EDD §1](EDD.md#1-overview): "self-hosted, one streamer per deployment") deliberately avoided | Conflicts with the project's stated scope; would effectively be a second product. Worth a future standalone discussion, not a v2 item — see [§4](#4-facebook-live-support)'s Business Verification note and [§8](#8-open-questions) below, which is the actual driver, not general hosting convenience |
| **Browser extension** | Extension-hosted UI, no server component | Not viable | YouTube/Kick ingestion and any future send-token storage need a real server process; an extension can't run the InnerTube poller or hold refresh tokens securely |

**Recommendation:** desktop app wrapper (Tauri) as the primary non-technical path, single-binary build as a secondary option for people who already run local servers but don't want Docker specifically. Both distribute *the same server*, so this is packaging work layered on the existing architecture ([EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf)'s monorepo layout), not a fork. Docker remains the primary path for the audience it already serves (home server / LAN / cloud, Restreamer-adjacent setups); nothing about v2 distribution removes it.

**LAN discoverability for native mobile clients.** The mobile apps on the roadmap ([EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf)) need to find and reach the desktop-wrapped server on the same network — same one-API-surface design as everything else ([EDD §4.1](EDD.md#41-normalized-message-model): "web, OBS, future mobile" all speaking the same contract), not a second RPC protocol grown just for mobile. Two separate problems, both with standard, purpose-built solutions rather than custom work:

- **Discovery:** the desktop app advertises itself via mDNS (`_allchat._tcp.local`) — the same mechanism Plex, Sonos, and Home Assistant use for LAN service discovery. Mobile apps browse for the service instead of the streamer typing an IP.
- **Plain HTTP over LAN:** both mobile platforms block cleartext HTTP by default, but both carve out an exception for exactly this local-network case rather than requiring TLS. iOS: `NSAllowsLocalNetworking` (an App Transport Security exception scoped to loopback/`.local`/private-IP addresses — distinct from, and far narrower than, the all-HTTP `NSAllowsArbitraryLoads` flag), paired with the `NSLocalNetworkUsageDescription` + `NSBonjourServices` permission prompt iOS 14+ requires for any LAN/mDNS access. Android: Network Security Config scoping `cleartextTrafficPermitted` to private IP ranges, plus NSD (Android's mDNS equivalent) for discovery. Neither needs the self-signed-certificate setup already ruled out as not worth it for HTTPS-over-LAN ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)).

Open question worth flagging rather than resolving here: does the desktop wrapper still expose the HTTP API on `localhost` for OBS to reach (yes, it must — OBS docks/sources are still just browser navigations to a URL), and does packaging change anything about the [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) auth story? Answer, tentatively: no — `localhost`-only binding by default (no LAN/cloud exposure) removes most of the reason to turn on app auth in the first place for this audience, but the same auth system still applies once the streamer opts into LAN exposure (needed for the mobile-discovery case above) or cloud exposure from the desktop app's settings.

## 8. Open questions

1. **Self-hosted Facebook OAuth doesn't scale per-streamer (v3 candidate, not designed here).** Facebook's App Review for Page permissions requires Business Verification per registered app — if every self-hosting streamer registers their own Facebook app, each clears that individually (see [§4](#4-facebook-live-support)). Candidates, cheapest first: (a) do nothing — Facebook stays opt-in/self-service, streamers who want it clear their own review; (b) a thin centrally-hosted OAuth broker — one All Chat-owned Facebook app, verified once, relays tokens to self-hosted instances; (c) full SaaS migration — biggest lift, last resort, only if (b) proves insufficient. Not a v2 item; flagged for v3 scoping.
2. Kick's official app-platform maturity ([§3](#3-platform-auth-login-connections)) — revisit once it stabilizes; may simplify or complicate the OAuth story relative to the current unofficial-API posture.
3. Desktop-wrapper ([§7](#7-distribution-beyond-docker)) LAN/cloud exposure toggle: does turning it on need to nudge the streamer toward enabling app auth ([§6](#6-app-level-auth-building-out-edd-61)), or leave that fully manual?

## 9. Glossary

New terms introduced in this document; see [EDD.md §11](EDD.md#11-glossary) for everything else.

| Term | Meaning |
|------|---------|
| **Graph API page token** | An access token scoped to a specific Facebook Page (not a personal account), required for that page's Live Video comments. |
| **Tauri** | A framework for building desktop apps that pairs a Rust-based native shell with the OS's existing system webview, avoiding the bundled-Chromium cost Electron pays. |
| **`pkg` / Bun compile** | Tools that package a Node/Bun application and its runtime into one self-contained executable, removing the "install Node first" requirement. |
