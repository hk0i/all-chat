# All Chat

Self-hosted unified live chat for multistreamers. Aggregates Twitch, Kick, and
YouTube chat into one merged feed, with OBS dock and on-stream overlay support.
The chat-side companion to a video multistream stack like
[Restreamer](https://datarhei.github.io/restreamer/).

Read the full design in [docs/EDD.md](docs/EDD.md).

> **Status: v1.** Read-only unified feed, live against Twitch, Kick, and
> YouTube, with a profile manager, OBS dock/overlay support, and dark/light
> themes. No authentication yet — see the hosting note below.

## Run from a clone -- installing from source

```sh
docker compose up --build
```

Then open <http://localhost:8420> (or <http://all-chat.localhost> behind a
local [nginx-proxy](https://github.com/nginx-proxy/nginx-proxy) on
`proxy_network` — override with `PROXY_NETWORK` / `ALLCHAT_HOST`).

## Run the published image (production)

```yaml
services:
  allchat:
    image: ghcr.io/hk0i/all-chat # <- instead of `build: .`
    expose: ["3000"]
    environment:
      VIRTUAL_HOST: chat.example.com
      VIRTUAL_PORT: "3000"
    volumes:
      - allchat-data:/data
    networks: [proxy]
networks:
  proxy:
    external: true
    name: proxy_network
volumes:
  allchat-data:
```

> **Public hosting note:** v1 has no authentication. Keep deployments
> LAN-only or put them behind your reverse proxy's auth until in-app auth
> (EDD §6.1) lands.

## Using it

Open the app and go to **Profiles** to create a named group of chat sources
(any mix of Twitch/Kick/YouTube, duplicates of a platform allowed — e.g. two
Twitch channels in one profile). Each profile gets:

- **watch** — the merged feed at `/?profile=<id>`
- **obs urls** — ready-made Dock and Overlay links for OBS

You can also skip profiles entirely and connect ad hoc:
`/?source=twitch:somechannel&source=kick:145222` (repeat `source=` for more).

Display options ride the query string on any of the above:

| Param | Default | Effect |
|-------|---------|--------|
| `icons=0` | on | Hide platform icons + accent stripe |
| `avatars=0` / `avatars=1` | on (dock), off (overlay) | Author avatars / colored-initial discs |
| `overlay=1` | off | Transparent, chrome-less, larger stroked text — OBS **browser source** |
| `fade=N` | 10s (overlay only) | Evict a message N seconds after it arrives; `fade=0` disables eviction |

## Develop

```sh
npm install
npm run dev        # dev server on :5173
npm run check      # type checks (all workspaces)
npm test           # unit tests
```

Try the stream pipeline against a live channel:
`http://localhost:5173/?source=twitch:somechannel`

## Repository layout

| Path | What | License |
|------|------|---------|
| `web/` | SvelteKit gateway: web UI + API server, one deployable | GPL-3.0-only |
| `shared/contract/` | Wire-format types — the API contract for all clients | MIT |
| `ios/`, `android/` | Native apps (future) | MIT |
| `docs/` | Design docs | CC BY-SA 4.0 |

## License

GPL-3.0-only, except `shared/contract/` (MIT) and `docs/` (CC BY-SA 4.0,
[docs/LICENSE](docs/LICENSE)) — see [docs/EDD.md §9.4](docs/EDD.md) for the
reasoning.
