# Hockey Lobby Worker (Cloudflare Workers + Durable Objects)

This Worker provides:

- Lobby room list (create/list/join/leave)
- WebRTC signaling relay (offer/answer/ice) over WebSocket

It is intentionally **signaling-only**. Game data should go **P2P** over WebRTC DataChannel.

## Endpoints

- `GET /health` -> `ok`
- `GET /ws` -> WebSocket
