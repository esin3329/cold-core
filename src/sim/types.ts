import type { SiegeOptions } from './config';

export type Player = 'A' | 'B';
export type NodeKind = 'core' | 'gate' | 'vault' | 'processor' | 'relay' | 'neutral';
export type ProgKind = 'ping' | 'auger' | 'shade' | 'siphon';
export type IceKind = 'bulwark' | 'hound' | 'lantern' | 'honeypot';
export type AttackClass = 'brute' | 'stealth' | 'viral';
export type DefClass = 'wall' | 'watch' | 'active';

export interface NodeState {
  id: string;
  kind: NodeKind;
  owner: Player | null;
  hp: number; // ×10
  maxHp: number; // ×10
  data: number; // ×2 (vault)
  offlineTurns: number; // processor
  destroyed: boolean;
}

export interface Ice {
  id: number;
  kind: IceKind;
  owner: Player;
  node: string;
  hp: number; // ×10
  compiling: boolean;
  free: boolean; // 비상 프로토콜 (BW 0)
  seq: number;
}

export interface Program {
  id: number;
  kind: Exclude<ProgKind, 'ping'>;
  owner: Player;
  node: string;
  target: string;
  hp: number; // ×10
  stunned: number;
  detected: boolean;
  revealed: boolean;
  seq: number;
}

/** fakeVault = 실제로 허니팟이 있었는지 (내부용). vaultSignal = 핑이 잡은 '금고 신호' — 진짜 금고와 허니팟 모두 true라 구별 불가 */
export interface ScoutInfo { turn: number; ice: IceKind[]; fakeVault: boolean; vaultSignal: boolean; /** 프로그램이 직접 들어가 본 적 있음 (숨은 금고 모드에서 노드 종류 공개) */ contact?: boolean }

export interface PlayerState {
  cyc: number;
  heat: number;
  data: number; // ×2
  neutralData: number; // ×2, 중립 노드에서 얻은 누적 데이터 (옵션 D2 상한 판정용)
  coreDmgDealt: number; // ×10, 내 프로그램이 상대 코어 본체에 실제로 준 누적 피해 (E1, 수리로 줄지 않음)
  breachData: number; // ×2, E1으로 얻은 누적 데이터
  vaultData: number; // ×2, 금고 사이펀으로 얻은 누적 데이터 (통계용)
  /** [기획 v0.3.1] 통계: HEAT 80+ 철수 턴 / HEAT 80+ 머문 턴 / 역추적 횟수 (HEAT_PULLOUT_THRESHOLD 참고) */
  heatPulloutTurns: number;
  heatHighTurns: number;
  tracebacks: number;
  /** [기획 v0.3.1] 기록: 경기 중 내 코어의 최저 HP (×10). 코어가 피해를 받는 순간마다 갱신 */
  minCoreHp: number;
  emergencyUsed: boolean;
  breach: { relay: string; turns: number } | null; // 상대 릴레이에 대한 무료 침투 링크
  scouted: Record<string, ScoutInfo>;
  pendingReward: number;
  bwHistory: { atk: number; def: number }[];
}

export type Order =
  | { type: 'compile'; ice: IceKind; node: string }
  | { type: 'recompile'; iceId: number }
  | { type: 'launch'; prog: ProgKind; target: string }
  | { type: 'retarget'; progId: number; target: string }
  | { type: 'jackout'; progId: number }
  | { type: 'repair'; node: string }
  | { type: 'overclock' }
  | { type: 'setVaults'; nodes: string[]; autoFilled?: string[] }; // (숨은 금고) 구축 단계에서 내 저장 소켓 4곳 중 2곳을 진짜 금고로 지정

export interface LogEntry { step: number; text: string; vis: 'all' | Player; kind?: 'warn' | 'atk' | 'def' | 'info' }

export type WinReason = 'core' | 'data' | 'time' | 'forfeit';

export interface MatchState {
  options: SiegeOptions; // 공성 압박 보정안 (매치 시작 시 고정)
  turn: number; // 0 = 구축 단계
  over: boolean;
  winner: Player | 'draw' | null;
  winReason: WinReason | null;
  /** [기획 v0.3.1] 기록: 처음 게이트가 파괴된 턴과 그 턴에 파괴된 게이트들 (해결 순서대로). 없으면 null */
  firstGateBreak: { turn: number; gates: string[] } | null;
  /** [기획 v0.3.1] 기록: 서든데스 고정 피해가 처음 적용된 턴. 도달하지 않았으면 null */
  suddenDeathReachedTurn: number | null;
  /** 디버그 턴 점프 기록 (검증용). 서든데스 개시 턴을 건너뛰었는지 기록 블록에서 판단한다 */
  debugJumps: { from: number; to: number }[];
  nodes: Record<string, NodeState>;
  ices: Ice[];
  programs: Program[];
  players: Record<Player, PlayerState>;
  nextId: number;
  log: LogEntry[]; // 직전 해결의 로그
  turnLogs: { turn: number; log: LogEntry[] }[];
}

export const other = (p: Player): Player => (p === 'A' ? 'B' : 'A');
