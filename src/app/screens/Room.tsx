import { useEffect, useMemo, useRef, useState } from 'react';
import { LobbyClient } from '../../net/lobbyClient';
import { GameSnapshot, PlayerInput, WsClientMsg, WsServerMsg } from '../../net/protocol';
import { RtcRole, RtcStatus, WebRtcSession } from '../../net/webrtcSession';
import Hockey from '../../../components/Hockey';
import { decodeJson, encodeJson, makePlayerInput } from '../../net/onlineGame';

export default function Room({
  roomId,
  playerName,
  onLeave,
}: {
  roomId: string;
  playerName: string;
  onLeave: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'waiting' | 'ready'>('idle');
  const [role, setRole] = useState<RtcRole>('guest');
  const [rtc, setRtc] = useState<RtcStatus>({ phase: 'idle' });
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [peerCount, setPeerCount] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const remoteInputRef = useRef<PlayerInput | null>(null);

  const lobbyRef = useRef<LobbyClient | null>(null);
  const rtcRef = useRef<WebRtcSession | null>(null);
  const shareText = useMemo(() => `Room ID: ${roomId}`, [roomId]);

  const wsUrl = useMemo(() => {
    const fromEnv = (import.meta as any).env?.VITE_LOBBY_WS_URL as string | undefined;
    if (fromEnv) return fromEnv;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }, []);

  useEffect(() => {
    setStatus('connecting');
    setErr(null);

    let currentRole: RtcRole = 'guest';

    const lobby = new LobbyClient({
      url: wsUrl,
      onRoomJoined: (room, r) => {
        setRole(r);
        setPeerCount(room.players);
        setStatus(room.players >= 2 ? 'ready' : 'waiting');

        if (currentRole !== r) {
          currentRole = r;
          rtcRef.current?.close();
          rtcRef.current = new WebRtcSession({
            role: r,
            roomId,
            sendSignal: (m: WsServerMsg) => lobby.sendRaw(m as unknown as WsClientMsg),
            onStatus: setRtc,
            onRttMs: setRttMs,
            onDataMessage: (data) => {
              const msg = decodeJson<any>(data);
              if (!msg || typeof msg.type !== 'string') return;
              if (msg.type === 'game:input') remoteInputRef.current = msg.input as PlayerInput;
              if (msg.type === 'game:snapshot') setSnap(msg.snapshot as GameSnapshot);
            },
          });
          rtcRef.current.start();
        }

        // When both players are present, ask host to send a fresh offer.
        if (room.players >= 2 && r === 'host') {
          void rtcRef.current?.renegotiateOffer();
        }

        // Host will create an offer on start(); guest will wait for offer.
      },
      onSignal: (msg) => {
        rtcRef.current?.onSignal(msg);
      },
      onError: (code, message) => {
        setErr(`${code}: ${message}`);
      },
    });
    lobbyRef.current = lobby;

    const rtcSession = new WebRtcSession({
      role: 'guest',
      roomId,
      sendSignal: (m: WsServerMsg) => {
        lobby.sendRaw(m as unknown as WsClientMsg);
      },
      onStatus: setRtc,
      onRttMs: setRttMs,
      onDataMessage: (data) => {
        const msg = decodeJson<any>(data);
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'game:snapshot') setSnap(msg.snapshot as GameSnapshot);
      },
    });
    rtcRef.current = rtcSession;
    rtcSession.start();

    lobby.connect(playerName.trim() || 'Player');
    lobby.joinRoom(roomId);

    return () => {
      rtcSession.close();
      lobby.leaveRoom(roomId);
      lobby.disconnect();
      rtcRef.current = null;
      lobbyRef.current = null;
    };
  }, [roomId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
    } catch {
      // ignore
    }
  };

  return (
    <div className="w-full h-full">
      <div className="absolute inset-0 z-0">
        <Hockey
          mode="pvp"
          online={{
            enabled: true,
            role,
            snapshot: snap
              ? {
                  p1: snap.p1,
                  p2: snap.p2,
                  puck: snap.puck,
                  leftGoalIntegrity: snap.leftGoalIntegrity,
                  rightGoalIntegrity: snap.rightGoalIntegrity,
                  winner: snap.winner,
                }
              : undefined,
            remoteInput:
              role === 'host' && remoteInputRef.current
                ? {
                    keys: {
                      up: remoteInputRef.current.keys.w,
                      down: remoteInputRef.current.keys.s,
                      left: remoteInputRef.current.keys.a,
                      right: remoteInputRef.current.keys.d,
                    },
                  }
                : undefined,
            onSnapshot:
              role === 'host'
                ? (s: any) => {
                    const payload = {
                      type: 'game:snapshot',
                      roomId,
                      snapshot: { t: performance.now(), ...s },
                    };
                    const dc = (rtcRef.current as any)?.dc as RTCDataChannel | undefined;
                    if (dc && dc.readyState === 'open') dc.send(encodeJson(payload));
                    setSnap(payload.snapshot);
                  }
                : undefined,
          }}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-10 pointer-events-none">
        <div className="w-full max-w-3xl px-6 mx-auto pt-16">
          <div className="bg-black/5 border border-black/10 rounded-2xl p-6 shadow-sm pointer-events-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-bold tracking-[0.3em] opacity-60">ROOM</div>
            <div className="text-2xl font-black tracking-[0.35em]">{roomId}</div>
            <div className="mt-1 text-xs font-bold tracking-widest uppercase opacity-60">
              {playerName} • {status} • {role.toUpperCase()} • {peerCount}/2
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={copy}
              className="bg-white text-black px-5 py-2 rounded-full font-bold text-xs tracking-widest uppercase border border-black/20 hover:scale-105 transition-transform"
            >
              Copy ID
            </button>
            <button
              onClick={onLeave}
              className="bg-black text-white px-5 py-2 rounded-full font-bold text-xs tracking-widest uppercase hover:scale-105 hover:bg-gray-800 transition-all"
            >
              Leave
            </button>
          </div>
        </div>

        <div className="mt-6 bg-white border border-black/10 rounded-xl p-4">
          <div className="text-xs font-bold tracking-[0.3em] opacity-60">NEXT</div>
          <div className="mt-2 text-sm opacity-70 leading-relaxed">
            P2P status: <span className="font-bold">{rtc.phase.toUpperCase()}</span>
            {rtc.phase === 'failed' ? ` (${rtc.reason})` : ''}.
          </div>
          <div className="mt-2 text-xs font-bold tracking-widest uppercase opacity-60">
            RTT: {rttMs === null ? '—' : `${rttMs} ms`}
          </div>
          {err && <div className="mt-2 text-xs font-bold tracking-widest uppercase text-red-600">{err}</div>}
          <div className="mt-3 text-xs font-bold tracking-[0.28em] opacity-50">
            {shareText}
          </div>
        </div>
          </div>
        </div>
      </div>

      <RoomInputSender
        enabled={role === 'guest' && rtc.phase === 'connected'}
        onInput={(input) => {
          const dc = (rtcRef.current as any)?.dc as RTCDataChannel | undefined;
          if (!dc || dc.readyState !== 'open') return;
          dc.send(encodeJson({ type: 'game:input', roomId, input }));
        }}
      />
    </div>
  );
}

function RoomInputSender({
  enabled,
  onInput,
}: {
  enabled: boolean;
  onInput: (input: PlayerInput) => void;
}) {
  const keysRef = useRef({ w: false, a: false, s: false, d: false });
  const mouseRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w') keysRef.current.w = true;
      if (k === 'a') keysRef.current.a = true;
      if (k === 's') keysRef.current.s = true;
      if (k === 'd') keysRef.current.d = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w') keysRef.current.w = false;
      if (k === 'a') keysRef.current.a = false;
      if (k === 's') keysRef.current.s = false;
      if (k === 'd') keysRef.current.d = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    const tick = window.setInterval(() => {
      const now = performance.now();
      onInput(makePlayerInput(now, keysRef.current, mouseRef.current));
    }, 33);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.clearInterval(tick);
    };
  }, [enabled, onInput]);

  return null;
}
