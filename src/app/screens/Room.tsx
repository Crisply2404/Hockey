import { useEffect, useRef, useState, type RefObject } from 'react';
import Hockey from '../../../components/Hockey';
import type { HockeyRef } from '../../../types';
import type { GameSnapshot, OnlineRole, PlayerInput, RoomSummary, WsClientMsg } from '../../net/protocol';
import { useT } from '../i18n';
import { useSettings } from '../settings';
import { Icon, IconButton, Popup, SoundButton, TopBar, Word } from '../ui';
import { useMatch } from '../useMatch';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 剪贴板接口不可用时，退回到选中文本后复制。
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  }
}

export default function Room({ room, role, snapshot, send, remoteInput, error, onLeave }: {
  room: RoomSummary;
  role: OnlineRole;
  snapshot: GameSnapshot | null;
  send: (message: WsClientMsg) => void;
  remoteInput: RefObject<PlayerInput | null>;
  error: string | null;
  onLeave: () => void;
}) {
  const t = useT();
  const settings = useSettings();
  const gameRef = useRef<HockeyRef>(null);
  const [leaving, setLeaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const match = useMatch();
  const ready = room.players === 2;
  const inviteLink = `${location.origin}${location.pathname}?room=${room.roomId}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="game">
      <TopBar
        start={<IconButton label={t.leave} onClick={() => setLeaving(true)}>{Icon.back}</IconButton>}
        end={<SoundButton />}
      />

      <div className="game__stage">
        <Hockey
          ref={gameRef}
          mode="pvp"
          theme={settings.theme}
          onEvent={match.onEvent}
          online={{
            enabled: true,
            ready,
            role,
            snapshot: snapshot ?? undefined,
            readRemoteInput: () => {
              const input = remoteInput.current;
              return input && performance.now() - input.t < 500 ? input : null;
            },
            onInput: (input) => send({ type: 'game:input', roomId: room.roomId, input }),
            onSnapshot: (value) => send({ type: 'game:snapshot', roomId: room.roomId, snapshot: value }),
          }}
        />

        {leaving ? (
          <Popup label={t.leave}>
            <p className="frame__note">{role === 'host' ? t.leaveConfirmHost : t.leaveConfirmGuest}</p>
            <Word onClick={() => setLeaving(false)} autoFocus>{t.stay}</Word>
            <Word onClick={onLeave}>{t.leave}</Word>
          </Popup>
        ) : !ready ? (
          <Popup label={t.waitingOpponent}>
            <div className="frame__code" data-testid="room-id">{room.roomId}</div>
            <p className="frame__note">{t.waitingOpponent}<span className="dots" aria-hidden="true" /></p>
            <Word onClick={async () => setCopied(await copyText(inviteLink))}>{copied ? t.copied : t.copyLink}</Word>
          </Popup>
        ) : match.phase === 'settled' ? (
          <Popup label={t.rematch}>
            {role === 'host'
              ? <Word onClick={() => gameRef.current?.resetGame()} autoFocus>{t.rematch}</Word>
              : <p className="frame__note">{t.waitingRematch}</p>}
            <Word onClick={onLeave}>{t.leave}</Word>
          </Popup>
        ) : null}

        {error && <p className="toast" role="alert">{error}</p>}
      </div>
    </div>
  );
}
