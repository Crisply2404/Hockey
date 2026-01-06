<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Hockey

Minimal air hockey game.

## Run locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Online (P2P Mode A) — Lobby + Rooms (Cloudflare Worker)

This repo now includes an **online lobby/room system** for WebRTC P2P (Mode A):

- Lobby: room list, create room, join by roomId (search)
- Signaling relay: offer/answer/ice (gameplay wiring comes next)

### 1) Create Cloudflare account

- Sign up at Cloudflare.
- Make sure you can access the **Workers & Pages** dashboard.

### 2) Install Wrangler (Cloudflare CLI)

From the project root:

```bash
npm install -g wrangler
wrangler login
```

If you prefer not to install globally, you can use the local one under `cf/worker`.

### 3) Deploy the Lobby Worker (includes Durable Object)

The worker lives in `cf/worker`.

```bash
cd cf/worker
npm install
wrangler deploy
```

Notes:

- The first deploy applies the Durable Object migration in `cf/worker/wrangler.toml`.
- Wrangler will print your Worker URL, for example:
  - `https://hockey-lobby.<your-subdomain>.workers.dev`
- The lobby WebSocket endpoint is `.../ws`.

### 4) Point the web app at the Worker

Create or edit `d:/GameDev/WebGame/hockey/.env.local`:

```ini
VITE_LOBBY_WS_URL=wss://hockey-lobby.<your-subdomain>.workers.dev/ws
```

Then run:

```bash
npm run dev
```

Open the page, you should see:

- Lobby shows **CONNECTED**
- Create Room -> enters Room screen
- Room list updates and search by Room ID works

### What you need to do in Cloudflare dashboard

Nothing special for this phase (Worker + Durable Objects are configured by `wrangler.toml`).

If you want a custom domain later:

- Add your domain to Cloudflare
- Workers -> Triggers -> Custom Domains
- Set `VITE_LOBBY_WS_URL` to your custom domain `wss://.../ws`

## Why not PeerJS + Vercel?

You *can* build this with PeerJS, but this repo uses a Cloudflare Worker + Durable Object for these reasons:

- **We need a lobby/rooms anyway**: room list + search + join are first-class features here.
- **Stable WebSocket signaling**: Vercel Serverless/Edge is not a great fit for long-lived WebSocket stateful routing; Durable Objects are.
- **Lower moving parts**: no extra PeerJS server to run; signaling and lobby are one deploy.
- **More control**: protocol is explicit (offer/answer/ice), so we can add reconnect rules and debugging without a black box.

If you already have a good PeerJS server + region strategy, it can work, but you still end up needing a lobby/state store somewhere.
