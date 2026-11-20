/** 플레이어 시점(전장의 안개) 뷰. 렌더러와 AI가 공통으로 사용 — 상대의 비공개 정보는 여기서 걸러진다. */
import { TUNING } from './config';
import { iceSlots, bwCap, bwUse, fogLifted, income, isSocket, nodeLabel, suddenDeathDmg, upkeepIces, upkeepPerIce } from './engine';
import { NODE_BY_ID } from './map';
import type { IceKind, MatchState, NodeKind, Player, ProgKind } from './types';
import { other } from './types';

export interface IceView { id: number; kind: IceKind; hp: number; maxHp: number; compiling: boolean; free: boolean }
export interface NodeView {
  id: string; kind: NodeKind; shownKind: NodeKind; label: string; owner: Player | null; mine: boolean; enemy: boolean;
  hp: number; maxHp: number; destroyed: boolean; offline: number; data: number | null; slots: number;
  ices: IceView[] | null; // null = 미확인 (안개)
  scoutedTurn: number | null;
  /** 핑으로 정찰한 적 노드의 '금고 신호'. 진짜 금고와 허니팟이 똑같이 표시되어 신호만으로는 구별 불가. 정찰 전에는 항상 false — 노드는 본래 종류로만 보인다 */
  vaultSignal: boolean; x: number; y: number;
  /** 숨은 금고 모드에서 아직 종류가 드러나지 않은 적 저장 소켓: HP·데이터를 숨기고 중계로 표시 */
  hpHidden: boolean;
}
export interface ProgView { id: number; kind: Exclude<ProgKind, 'ping'>; owner: Player; mine: boolean; node: string; target: string | null; hp: number; maxHp: number; stealth: boolean; detected: boolean; stunned: number }
export interface MatchView {
  viewer: Player; turn: number; over: boolean; fogLifted: boolean;
  /** 이번 턴 정산 예정: ICE 유지비(개당/합계), 서든데스 코어 피해 */
  pressure: { upkeepPerIce: number; upkeepTotal: number; suddenDeath: number };
  nodes: Record<string, NodeView>; programs: ProgView[];
  me: { cyc: number; heat: number; data: number; neutralData: number; breachData: number; coreDmgDealt: number; bwCap: number; bwAtk: number; bwDef: number; income: number; breach: string | null; history: { atk: number; def: number }[] };
  enemy: { heat: number | null; heatStage: string; data: number; iceCount: number | null; breachOnMe: string | null };
}

export function heatStage(h: number) {
  if (h >= TUNING.heatMax) return '역추적';
  if (h >= TUNING.heatTracking) return '추적 중';
  if (h >= TUNING.heatDetected) return '감지됨';
  return '잠복';
}

export function viewFor(s: MatchState, v: Player): MatchView {
  const e = other(v);
  const nodes: Record<string, NodeView> = {};
  const lifted = fogLifted(s); // 서든데스 안개 해제
  for (const n of Object.values(s.nodes)) {
    const mn = NODE_BY_ID[n.id];
    const enemy = n.owner === e && n.kind !== 'neutral';
    const mine = n.owner === v && n.kind !== 'neutral';
    const sc = s.players[v].scouted[n.id];
    const realIces = s.ices.filter((i) => i.node === n.id).map((i) => ({ id: i.id, kind: i.kind, hp: i.hp, maxHp: 0, compiling: i.compiling, free: i.free }));
    const vaultSignal = enemy && !lifted && !!sc?.vaultSignal; // 핑으로 잡힌 금고 신호 (진짜 금고·허니팟 동일)
    let ices: IceView[] | null = realIces;
    if (enemy && !lifted) ices = sc ? sc.ice.map((k, idx) => ({ id: -1 - idx, kind: k, hp: 0, maxHp: 0, compiling: false, free: false })) : null;
    // 숨은 금고: 적 저장 소켓은 직접 접촉·파괴·안개 해제 전까지 중계로 보이고 HP·데이터도 숨김 (핑 신호는 금고·허니팟 동일)
    const hidden = s.options.hiddenVaultsEnabled && enemy && isSocket(n.id) && !lifted && !n.destroyed && !sc?.contact;
    const kind = hidden ? 'relay' : n.kind;
    nodes[n.id] = {
      id: n.id, kind, shownKind: kind, label: nodeLabel(s, n.id), owner: n.owner, mine, enemy,
      hp: hidden ? 0 : n.hp, maxHp: hidden ? 0 : n.maxHp, destroyed: n.destroyed, offline: n.offlineTurns,
      data: !hidden && n.kind === 'vault' ? n.data / 2 : null, hpHidden: hidden,
      slots: iceSlots(s, n.kind), ices, scoutedTurn: enemy ? (lifted ? s.turn : sc ? sc.turn : null) : null, vaultSignal, x: mn.x, y: mn.y,
    };
  }
  const programs: ProgView[] = [];
  for (const p of s.programs) {
    const mine = p.owner === v;
    const node = s.nodes[p.node];
    const stealth = p.kind === 'shade' && !p.detected;
    const inEnemyHome = node.owner === p.owner && node.kind !== 'neutral';
    const visible = mine || p.revealed || p.detected || (!stealth && (!inEnemyHome || lifted));
    if (!visible) continue;
    programs.push({ id: p.id, kind: p.kind, owner: p.owner, mine, node: p.node, target: mine ? p.target : null, hp: p.hp, maxHp: 0, stealth, detected: p.detected, stunned: p.stunned });
  }
  const use = bwUse(s, v);
  const eh = s.players[e].heat;
  return {
    viewer: v, turn: s.turn, over: s.over, nodes, programs, fogLifted: lifted,
    pressure: { upkeepPerIce: upkeepPerIce(s, s.turn), upkeepTotal: upkeepPerIce(s, s.turn) * upkeepIces(s, v).length, suddenDeath: suddenDeathDmg(s, s.turn) },
    me: { cyc: s.players[v].cyc, heat: s.players[v].heat, data: s.players[v].data / 2, neutralData: s.players[v].neutralData / 2, breachData: s.players[v].breachData / 2, coreDmgDealt: s.players[v].coreDmgDealt / 10, bwCap: bwCap(s, v), bwAtk: use.atk, bwDef: use.def, income: income(s, v), breach: s.players[v].breach?.relay ?? null, history: s.players[v].bwHistory },
    enemy: {
      heat: eh >= TUNING.heatDetected ? eh : null, heatStage: heatStage(eh), data: s.players[e].data / 2,
      iceCount: eh >= TUNING.heatDetected ? s.ices.filter((i) => i.owner === e).length : null,
      breachOnMe: s.players[e].breach?.relay ?? null,
    },
  };
}
