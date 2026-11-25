import { useEffect, useRef, useState } from 'react';
import Hockey from '../../components/Hockey';
import { sfx } from '../audio/sfx';
import { LobbyClient, type ConnectionState } from '../net/lobbyClient';
import type { GameSnapshot, OnlineRole, PlayerInput, RoomSummary } from '../net/protocol';
import { useT } from './i18n';
import GameLocal from './screens/GameLocal';
import Home from './screens/Home';
import Lobby from './screens/Lobby';
import Room from './screens/Room';
import { getSettings, useSettings } from './settings';

type Route =
  | { name: 'home' }
  | { name: 'local'; mode: 'pve' | 'pvp'; session: number }
  | { name: 'lobby' }
  | { name: 'room'; room: RoomSummary; role: OnlineRole };

type OnlineError = { code: string; message: string };

// 邀请链接以 ?room=编号 指向房间；打开后直接进入大厅并加入。
function readInviteCode() {
  const code = new URLSearchParams(location.search).get('room')?.trim().toUpperCase();
  return code && /^[A-Z2-9]{6}$/.test(code) ? code : null;
}

export default function App() {
  const t = useT();
  const settings = useSettings();
  const pendingInvite = useRef(readInviteCode());
  const [route, setRoute] = useState<Route>(() => (pendingInvite.current ? { name: 'lobby' } : { name: 'home' }));
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [error, setError] = useState<OnlineError | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const remoteInput = useRef<PlayerInput | null>(null);
  const clientRef = useRef<LobbyClient | null>(null);
  const sessions = useRef(0);

  // 浏览器在用户首次操作之后才允许播放声音。
  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => { sfx.setMuted(settings.muted); }, [settings.muted]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'dark' ? '#191918' : '#eceae4');
  }, [settings.theme, settings.lang]);

  // 只有进入联机大厅或者房间时才连接联机服务；本地游戏不产生网络请求。
  const onlineActive = route.name === 'lobby' || route.name === 'room';
  useEffect(() => {
    if (!onlineActive) return;
    const url = import.meta.env.DEV
      ? `ws://${location.hostname}:8796/ws`
      : import.meta.env.VITE_LOBBY_WS_URL || 'wss://hockey-lobby.tcoinsm.workers.dev/ws';
    let wasOnline = false;
    const client = new LobbyClient({
      url,
      onConnectionState: (state) => {
        setConnection(state);
        if (state === 'online') setError(null);
        if (state === 'online') wasOnline = true;
        if (state === 'offline') {
          remoteInput.current = null;
          setSnapshot(null);
          setRoute((current) => (current.name === 'room' ? { name: 'lobby' } : current));
          setError(wasOnline
            ? { code: 'connection_lost', message: 'Connection interrupted. Reconnecting…' }
            : { code: 'connection_failed', message: 'Unable to connect. Reconnecting…' });
        }
      },
      onLobbyState: setRooms,
      onRoomCreated: (room, role) => {
        setSnapshot(null);
        remoteInput.current = null;
        setRoute({ name: 'room', room, role });
      },
      onRoomJoined: (room, role) => {
        pendingInvite.current = null;
        if (role === 'host' && room.players === 1) remoteInput.current = null;
        setError(null);
        setRoute({ name: 'room', room, role });
      },
      onRoomClosed: (_roomId, reason) => {
        setSnapshot(null);
        remoteInput.current = null;
        setError({ code: reason === 'Host left the room' ? 'host_left' : 'room_closed', message: reason });
        setRoute({ name: 'lobby' });
      },
      onInput: (input) => { remoteInput.current = { ...input, t: performance.now() }; },
      onSnapshot: setSnapshot,
      onError: (code, message) => {
        if (code !== 'connection_failed') pendingInvite.current = null;
        setError({ code, message });
      },
    });
    clientRef.current = client;
    client.connect(getSettings().playerName);
    // 邀请编号保留到加入成功或者服务拒绝为止，连接重建时会再次提交。
    if (pendingInvite.current) {
      client.joinRoom(pendingInvite.current);
      history.replaceState(null, '', location.pathname);
    }
    return () => {
      client.disconnect();
      clientRef.current = null;
      remoteInput.current = null;
      setConnection('offline');
      setRooms([]);
      setSnapshot(null);
      setError(null);
    };
  }, [onlineActive]);

  // 名称输入停顿后再同步到联机服务。
  useEffect(() => {
    if (!onlineActive) return;
    const timer = setTimeout(() => clientRef.current?.setPlayerName(settings.playerName), 400);
    return () => clearTimeout(timer);
  }, [onlineActive, settings.playerName]);

  const announce = () => clientRef.current?.setPlayerName(getSettings().playerName);
  const startLocal = (mode: 'pve' | 'pvp') => setRoute({ name: 'local', mode, session: ++sessions.current });
  const goHome = () => setRoute({ name: 'home' });
  // 连接状态由大厅的按钮表示，这里只保留房间与请求的错误。
  const connectionError = error?.code === 'connection_failed' || error?.code === 'connection_lost';
  const errorText = error && !connectionError ? (t.errors[error.code] ?? error.message) : null;

  return (
    <div className="app">
      {(route.name === 'home' || route.name === 'lobby') && (
        <div className="backdrop" aria-hidden="true">
          <Hockey mode="demo" theme={settings.theme} />
        </div>
      )}

      {route.name === 'home' && (
        <Home
          onSolo={() => startLocal('pve')}
          onLocal={() => startLocal('pvp')}
          onOnline={() => setRoute({ name: 'lobby' })}
        />
      )}

      {route.name === 'local' && <GameLocal key={route.session} mode={route.mode} onExit={goHome} />}

      {route.name === 'lobby' && (
        <Lobby
          rooms={rooms}
          connection={connection}
          error={errorText}
          onBack={goHome}
          onCreate={() => {
            setError(null);
            announce();
            clientRef.current?.createRoom();
          }}
          onJoin={(roomId) => {
            setError(null);
            announce();
            clientRef.current?.joinRoom(roomId);
          }}
        />
      )}

      {route.name === 'room' && (
        <Room
          key={route.room.roomId}
          room={route.room}
          role={route.role}
          snapshot={snapshot}
          send={(message) => clientRef.current?.sendRaw(message)}
          remoteInput={remoteInput}
          error={errorText}
          onLeave={() => {
            clientRef.current?.leaveRoom(route.room.roomId);
            remoteInput.current = null;
            setSnapshot(null);
            setRoute({ name: 'lobby' });
          }}
        />
      )}

    </div>
  );
}
