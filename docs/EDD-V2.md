# All Chat — Engineering Design Doc v2 (EDD-V2)

**Status:** Draft
**Date:** 2026-07-20
**Scope:** v2
**Author:** Gregory McQuillan
**License:** This document is CC BY-SA 4.0 — see [docs/LICENSE](LICENSE). Source code elsewhere in this repo is licensed separately (root [LICENSE](../LICENSE), [shared/contract/LICENSE](../shared/contract/LICENSE)).
**Builds on:** [EDD.md](EDD.md) (v1). Sections below reference v1 sections by number (e.g. [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)) rather than restate them.

*Acronyms link to the [glossary](#8-glossary) on first use; terms already defined in [EDD.md §11](EDD.md#11-glossary) aren't redefined here.*

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
| Twitch | OAuth (`chat:edit` scope) via Twitch's standard authorization-code flow | None — anonymous IRC read ([EDD §3.1](EDD.md#31-twitch)) unaffected | Helix "Send Chat Message" endpoint, or authenticated IRC `PRIVMSG` |
| YouTube | OAuth (Google, `youtube` scope) | None — InnerTube read ([EDD §3.3](EDD.md#33-youtube)) unaffected | `liveChatMessages.insert` — quota-limited, unlike the free read path |
| Kick | Kick's official API/app-registration story is newer and less battle-tested than Twitch/YouTube's | None — Pusher read ([EDD §3.2](EDD.md#32-kick)) unaffected | Track Kick's official app platform as it matures; treat as higher risk than Twitch/YouTube (consistent with the unofficial-API risk already logged in [EDD §7](EDD.md#7-risks)) |
| Facebook | Graph API OAuth, page access token, app review required for live-comment permissions | **Required even to read** — no anonymous path exists (this is why Facebook was deferred past v1, [EDD §2](EDD.md#2-goals-non-goals)) | Graph API comment-posting endpoint, same page token |

Design:

- One OAuth connection per platform per deployment (single-streamer scope, matching [EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)) — "connect Twitch," "connect YouTube," etc. as buttons in the control panel, not per-profile.
- Tokens (access + refresh where the platform issues them) stored server-side in `/data`, alongside the app-auth config ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)'s `config.json`) — never sent to any client.
- Each platform adapter gains a `send(message)` method alongside the existing `connect`/`onMessage` ([EDD §4](EDD.md#4-architecture), `ChatSource` interface) — implemented only where a token is present; absent token means read-only for that source, same as v1 behavior.
- Facebook's `ChatSource` implementation is gated entirely behind having a connected token — there is no anonymous fallback to build first.
- Token refresh runs server-side on a schedule / on 401; expired-and-unrefreshable tokens surface as a "reconnect Twitch" style prompt in the control panel, not a silent failure.

## 4. Facebook Live support

Given [§3](#3-platform-auth-login-connections)'s token requirement, Facebook is really "Facebook OAuth" plus one more `ChatSource`:

1. Streamer connects their Facebook Page via OAuth in the control panel (requires the page to be one they administer).
2. Resolve the active Live Video ID for that page (Graph API `/​{page-id}​/live_videos`).
3. Poll (or subscribe, if Graph API offers a push option for the account's tier) `/​{live-video-id}​/comments`, normalize into the same `ChatMessage` shape as the other three platforms ([EDD §4.1](EDD.md#41-normalized-message-model)) — Facebook becomes a fourth entry in the `platform` union, same fragment/badge model (badges likely empty — Facebook has no analogous badge concept, which is fine, the field is already optional).
4. App-review requirements (Facebook gates live-comment read permissions behind review for anything beyond a handful of test users) mean this ships with a documented waiting period before it works for the general public, independent of engineering effort. Flag this to the streamer up front in the connect-Facebook UI rather than let it surface as a confusing failure later.

## 5. Chat input / send fan-out

- One compose box in the main feed UI (not per-source) — the "everything is a URL, one unified feed" philosophy ([EDD §1](EDD.md#1-overview)) extends naturally to "one box out" mirroring "one feed in."
- Per-message target selection: default to every connected-and-authenticated source in the active profile; a small per-platform toggle row above the box lets the streamer exclude one (e.g. "don't send this to YouTube").
- Send path: `POST /api/chat/send { profile, text, targets? }`, authenticated by the app-auth session cookie or bearer token ([EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)) — this is the "plain POST endpoints alongside the stream" the v1 doc already reserved ([EDD §3.4](EDD.md#34-api-surface-sveltekit-server-routes-consumable-by-any-client), [§9.1](EDD.md#91-all-chat-as-the-chat-gateway)).
- Fan-out result is per-target: some platforms may succeed and others fail (rate limit, expired token, platform outage) in the same send — the UI reports per-target status inline (a small status row under the sent message), not a single pass/fail.
- The bot integration ([EDD §9.1](EDD.md#91-all-chat-as-the-chat-gateway)) uses the exact same endpoint with its own write-scoped bearer token — no separate "send" path for bots vs. humans.
- Rate limiting: each platform enforces its own (Twitch's per-account message rate, YouTube's quota), so the server tracks per-platform send timestamps and queues/backs off rather than erroring immediately on burst sends.

## 6. App-level auth (building out EDD §6.1)

[EDD §6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) already designed the three credential shapes (admin password/session, bearer token, read-only URL token) and reserved the hooks (`handle` middleware choke point, `?token=` pass-through, storage in `/data`). v2 is building the actual UI and lifecycle on top of that existing design, not redesigning it:

- **Login screen:** first-run setup sets the admin password (`ALLCHAT_PASSWORD` env or an in-app first-run form — both already specified in [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)); subsequent visits get a plain password login form, session cookie issued per [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks)'s `HttpOnly`/`SameSite=Lax`/long-lived-with-refresh terms.
- **Control panel additions:** bearer token issuance/revocation list (name, scope, created date, last used), the platform-OAuth connect buttons from [§3](#3-platform-auth-login-connections), and the "copy OBS URLs" helper ([EDD §4.4](EDD.md#44-configuration-persistence)) upgraded to auto-embed a `?token=` per [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) when auth is on.
- **Migration:** v1 deployments have no `config.json`; its absence already means "auth off" per [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks), so upgrading to a v2 image is a no-op until the streamer opts in by setting a password.

No new design work here — this section exists so the roadmap has a concrete "build this" item distinct from the platform-auth work in [§3](#3-platform-auth-login-connections), which is easy to conflate with it.

## 7. Distribution beyond Docker

v1 ships one way: a Docker image ([EDD §6](EDD.md#6-deployment)), which assumes comfort with `docker run`/compose, a terminal, and basic networking concepts. That's fine for the Restreamer-adjacent audience v1 targeted, but a wider streamer audience won't clear that bar. Options, evaluated:

| Option | What it is | Effort | Fit |
|--------|-----------|--------|-----|
| **Desktop app wrapper (Electron/Tauri)** | Bundles the existing SvelteKit server + a thin native shell; streamer downloads one installer, double-clicks, gets a system-tray icon and the app opens in a window | Medium — mostly packaging, the app itself is unchanged; Tauri over Electron for footprint (Rust shell vs. bundled Chromium engine cost that Electron pays even though OBS's CEF already pays it once) | Best general-audience fit — no terminal, no Docker knowledge, still points OBS at `localhost` URLs exactly like today |
| **OBS plugin (native C++ dock)** | A compiled OBS plugin that runs the ingestion logic in-process inside OBS itself | High — throws away the "one app, any client" design ([EDD §1](EDD.md#1-overview)) for OBS-only distribution, and means rewriting or embedding the Node/TS ingestion logic in a plugin ABI | Poor fit — couples the whole product to OBS, breaks the mobile/native-client roadmap ([EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf)) that depends on the server being independent of any one client |
| **Single self-contained binary (Bun compile / `pkg`)** | One executable, no Node install required, still runs as a local server the streamer starts and browses to | Low–Medium — mostly a build-target addition, [EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf) already flagged Bun as a footprint escape hatch | Good middle ground for technically-comfortable streamers who don't want Docker specifically; doesn't solve "no terminal at all" |
| **One-click installer script** (`curl \| sh` / signed `.pkg`/`.msi`) | Installs Docker (or the standalone binary) and starts the service, adds a shortcut | Low | Reasonable stopgap, but "pipe a script to your shell" has its own trust/security optics, and doesn't give a dock-icon/menu-bar experience |
| **Hosted SaaS option** | All Chat runs the service centrally; streamer just logs in | High — reintroduces multi-tenancy, billing, and abuse-handling that the whole v1 design ([EDD §1](EDD.md#1-overview): "self-hosted, one streamer per deployment") deliberately avoided | Conflicts with the project's stated scope; would effectively be a second product. Worth a future standalone discussion, not a v2 item |
| **Browser extension** | Extension-hosted UI, no server component | Not viable | YouTube/Kick ingestion and any future send-token storage need a real server process; an extension can't run the InnerTube poller or hold refresh tokens securely |

**Recommendation:** desktop app wrapper (Tauri) as the primary non-technical path, single-binary build as a secondary option for people who already run local servers but don't want Docker specifically. Both distribute *the same server*, so this is packaging work layered on the existing architecture ([EDD §5.1](EDD.md#51-backend-language-decision-record-typescriptnode-vs-go-vs-swift-json-vs-protobuf)'s monorepo layout), not a fork. Docker remains the primary path for the audience it already serves (home server / LAN / cloud, Restreamer-adjacent setups); nothing about v2 distribution removes it.

Open question worth flagging rather than resolving here: does the desktop wrapper still expose the HTTP API on `localhost` for OBS to reach (yes, it must — OBS docks/sources are still just browser navigations to a URL), and does packaging change anything about the [§6.1](EDD.md#61-auth-for-cloud-hosting-v2-design-v1-hooks) auth story? Answer, tentatively: no — `localhost`-only binding by default (no LAN/cloud exposure) removes most of the reason to turn on app auth in the first place for this audience, but the same auth system still applies if the streamer opts into LAN/cloud exposure from the desktop app's settings.

## 8. Glossary

New terms introduced in this document; see [EDD.md §11](EDD.md#11-glossary) for everything else.

| Term | Meaning |
|------|---------|
| **Graph API page token** | An access token scoped to a specific Facebook Page (not a personal account), required for that page's Live Video comments. |
| **Tauri** | A framework for building desktop apps that pairs a Rust-based native shell with the OS's existing system webview, avoiding the bundled-Chromium cost Electron pays. |
| **`pkg` / Bun compile** | Tools that package a Node/Bun application and its runtime into one self-contained executable, removing the "install Node first" requirement. |
