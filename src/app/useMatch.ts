import { useCallback, useState } from 'react';
import type { GameEvent, Side } from '../../types';
import { sfx } from '../audio/sfx';
import { TABLE_HEIGHT, TABLE_WIDTH } from '../game/table';

/** 一局比赛在界面上的三个阶段：进行中、已分出胜负、进球线图画完。 */
export type MatchPhase = 'playing' | 'won' | 'settled';

// 边墙是弦：撞在哪里，就拨出哪个音。长边从左到右音逐渐升高，上边比下边高，两端的短墙最高。
function noteAt(x: number, y: number) {
  if (y <= 1) return 10 + Math.floor((x / TABLE_WIDTH) * 8);
  if (y >= TABLE_HEIGHT - 1) return 5 + Math.floor((x / TABLE_WIDTH) * 8);
  return 15 + Math.floor((y / TABLE_HEIGHT) * 4);
}

/**
 * 把比赛画布报告的事件转换为声音与界面阶段。
 * 本地比赛与联机双方都使用这一套处理；访客的事件由快照差异还原。
 */
export function useMatch() {
  const [phase, setPhase] = useState<MatchPhase>('playing');
  const [winner, setWinner] = useState<Side | null>(null);

  const onEvent = useCallback((event: GameEvent) => {
    switch (event.type) {
      case 'reset':
        setPhase('playing');
        setWinner(null);
        break;
      case 'countdown':
        sfx.countdown();
        break;
      case 'serve':
        sfx.serve();
        break;
      case 'impact':
        if (event.kind === 'paddle' || event.kind === 'burst') sfx.hit(event.kind === 'burst', event.speed);
        else if (event.kind === 'barrier') sfx.band(event.power);
        else sfx.pluck(noteAt(event.x, event.y), event.power);
        break;
      case 'snap':
        sfx.snap();
        break;
      case 'goal':
        sfx.goal();
        break;
      case 'win':
        setWinner(event.winner);
        setPhase('won');
        break;
      case 'recap':
        sfx.recap(event.index);
        break;
      case 'settled':
        setPhase('settled');
        break;
    }
  }, []);

  return { phase, winner, onEvent };
}
