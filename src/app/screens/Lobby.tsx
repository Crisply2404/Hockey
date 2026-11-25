import { useState } from 'react';
import type { ConnectionState } from '../../net/lobbyClient';
import type { RoomSummary } from '../../net/protocol';
import { useT } from '../i18n';
import { updateSettings, useSettings } from '../settings';
import { Icon, IconButton, Word } from '../ui';

const ROOM_ID = /^[A-Z2-9]{6}$/;

export default function Lobby({ rooms, connection, error, onCreate, onJoin, onBack }: {
  rooms: RoomSummary[];
  connection: ConnectionState;
  error: string | null;
  onCreate: () => void;
  onJoin: (roomId: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const { playerName } = useSettings();
  const [code, setCode] = useState('');
  const normalized = code.trim().toUpperCase();
  const online = connection === 'online';
  // 列表只显示还能加入的房间；输入编号时同时用作筛选。
  const open = rooms.filter((room) => room.players === 1 && room.roomId.includes(normalized));

  return (
    <main className="lobby">
      <div className="frame frame--form">
        <div className="frame__head">
          <IconButton label={t.back} onClick={onBack}>{Icon.back}</IconButton>
          <h1 className="frame__title">{t.lobbyTitle}</h1>
        </div>

        <input
          className="input"
          value={playerName}
          maxLength={18}
          autoComplete="off"
          spellCheck={false}
          placeholder={t.yourName}
          aria-label={t.yourName}
          onChange={(event) => updateSettings({ playerName: event.target.value })}
        />

        <form
          className="join"
          onSubmit={(event) => {
            event.preventDefault();
            if (online && ROOM_ID.test(normalized)) onJoin(normalized);
          }}
        >
          <input
            className="input input--code"
            value={code}
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={t.joinPlaceholder}
            aria-label={t.joinPlaceholder}
            onChange={(event) => setCode(event.target.value)}
          />
          <Word type="submit" disabled={!online || !ROOM_ID.test(normalized)}>{t.join}</Word>
        </form>

        {error && <p className="notice" role="alert">{error}</p>}

        {open.length > 0 && (
          <ul className="rooms">
            {open.map((room) => (
              <li key={room.roomId}>
                <Word onClick={() => onJoin(room.roomId)} disabled={!online}>
                  <span className="rooms__code">{room.roomId}</span>
                  <span className="rooms__who">{room.hostName}</span>
                </Word>
              </li>
            ))}
          </ul>
        )}

        <Word className="frame__primary" onClick={onCreate} disabled={!online}>{online ? t.createRoom : t.connecting}</Word>
      </div>
    </main>
  );
}
