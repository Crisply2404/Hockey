import type { Difficulty } from '../../types';
import { useSettings, type Lang } from './settings';

const zh = {
  solo: '人机对战',
  local: '本地双人',
  online: '联机对战',
  difficulty: { easy: '简单', normal: '普通', hard: '困难' } as Record<Difficulty, string>,
  back: '返回',
  pause: '暂停',
  resume: '继续',
  restart: '重新开始',
  quit: '返回菜单',
  rematch: '再来一局',
  waitingRematch: '等待房主开始下一局',
  mute: '静音',
  unmute: '打开声音',
  theme: '切换黑白',
  otherLanguage: 'EN',

  lobbyTitle: '联机',
  yourName: '你的名字',
  createRoom: '创建房间',
  connecting: '连接中…',
  joinPlaceholder: '房间编号',
  join: '加入',
  waitingOpponent: '等待对手加入',
  copyLink: '复制邀请链接',
  copied: '已复制',
  leave: '离开',
  leaveConfirmHost: '离开后房间会关闭。',
  leaveConfirmGuest: '离开后比赛会中断。',
  stay: '留下',

  errors: {
    room_not_found: '没有找到这个房间',
    room_full: '房间已经满了',
    not_in_room: '你不在这个房间里',
    wrong_role: '这个操作属于另一名玩家',
    host_left: '房主离开了房间',
    invalid_message: '请求没有被服务接受',
  } as Record<string, string>,
};

const en: typeof zh = {
  solo: 'Versus AI',
  local: 'Two players',
  online: 'Online',
  difficulty: { easy: 'Easy', normal: 'Normal', hard: 'Hard' },
  back: 'Back',
  pause: 'Pause',
  resume: 'Resume',
  restart: 'Restart',
  quit: 'Menu',
  rematch: 'Rematch',
  waitingRematch: 'Waiting for the host to start again',
  mute: 'Mute',
  unmute: 'Unmute',
  theme: 'Switch light and dark',
  otherLanguage: '中',

  lobbyTitle: 'Online',
  yourName: 'Your name',
  createRoom: 'Create room',
  connecting: 'Connecting…',
  joinPlaceholder: 'Room code',
  join: 'Join',
  waitingOpponent: 'Waiting for an opponent',
  copyLink: 'Copy invite link',
  copied: 'Copied',
  leave: 'Leave',
  leaveConfirmHost: 'Leaving closes the room.',
  leaveConfirmGuest: 'Leaving stops the match.',
  stay: 'Stay',

  errors: {
    room_not_found: 'That room does not exist',
    room_full: 'That room is full',
    not_in_room: 'You are not in this room',
    wrong_role: 'That action belongs to the other player',
    host_left: 'The host left the room',
    invalid_message: 'The service rejected the request',
  },
};

const dictionaries: Record<Lang, typeof zh> = { zh, en };

export type Strings = typeof zh;

export function useT(): Strings {
  return dictionaries[useSettings().lang];
}
