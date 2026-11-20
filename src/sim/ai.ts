/**
 * 규칙 기반 AI (결정론적). 자기 시점 뷰(viewFor)만 보고 판단한다 — 상대의 숨겨진 ICE를 훔쳐보지 않는다.
 * 다양성: 성향 프로필 4종 + 시드 기반 선택 변주. 시드는 AI에만 들어가고 시뮬레이션 코어에는 들어가지 않는다
 * (같은 시드 + 같은 상태 → 같은 명령. 시뮬레이션 결정론에 영향 없음).
 */
import { NODE_SPECS } from './config';
import { breachDataOn, isSocket, socketsOf, income, planBudget, upkeepIces, upkeepPerIce, suddenDeathDmg } from './engine';
import type { IceKind, MatchState, Order, Player } from './types';
import { other } from './types';
import { viewFor } from './view';

export type AiStyle = 'balanced' | 'raider' | 'turtle' | 'thief' | 'sieger';
export const AI_STYLES: AiStyle[] = ['balanced', 'raider', 'turtle', 'thief', 'sieger'];
export const AI_STYLE_KO: Record<AiStyle, string> = { balanced: '균형형', raider: '돌격형', turtle: '철벽형', thief: '탈취형', sieger: '공성형' };

interface Profile {
  maxAuger: number; heatLimit: number; maxSiphon: number; maxShade: number;
  extraDefenseAt: number; extraAugerAt: number; pingEvery: number; augerMinCyc: number;
}
const PROFILES: Record<AiStyle, Profile> = {
  balanced: { maxAuger: 2, heatLimit: 70, maxSiphon: 1, maxShade: 1, extraDefenseAt: 12, extraAugerAt: 99, pingEvery: 3, augerMinCyc: 7 },
  raider: { maxAuger: 3, heatLimit: 85, maxSiphon: 1, maxShade: 1, extraDefenseAt: 99, extraAugerAt: 14, pingEvery: 3, augerMinCyc: 6 },
  turtle: { maxAuger: 1, heatLimit: 60, maxSiphon: 1, maxShade: 0, extraDefenseAt: 7, extraAugerAt: 99, pingEvery: 4, augerMinCyc: 10 },
  thief: { maxAuger: 1, heatLimit: 70, maxSiphon: 2, maxShade: 2, extraDefenseAt: 14, extraAugerAt: 99, pingEvery: 2, augerMinCyc: 9 },
  // 공성형: 게이트 하나를 골라 셰이드로 하운드를 먼저 치고 오거를 몰아 넣는 협공 (사이펀 없음)
  sieger: { maxAuger: 3, heatLimit: 80, maxSiphon: 0, maxShade: 1, extraDefenseAt: 99, extraAugerAt: 99, pingEvery: 2, augerMinCyc: 5 },
};

/** 정수 해시 기반 결정론적 난수 (0 이상 n 미만). AI 전용. */
function rng(seed: number, turn: number, me: Player, salt: number) {
  let h = (seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b) ^ (me === 'A' ? 0x1234567 : 0x7654321)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (n: number) => h % n;
}

const SETUPS: [IceKind, string][][] = [
  [['hound', 'R2'], ['bulwark', 'G1'], ['bulwark', 'G2'], ['lantern', 'P1'], ['honeypot', 'R3']],
  [['bulwark', 'G1'], ['hound', 'G1'], ['bulwark', 'G2'], ['lantern', 'R2'], ['honeypot', 'R1']],
  [['hound', 'G2'], ['bulwark', 'G1'], ['bulwark', 'G2'], ['lantern', 'P2'], ['honeypot', 'P1']],
];

/** AI 실험 플래그 (측정 전용, 기본 모두 off = 브라우저 AI와 동일) */
export interface AiFlags {
  /** v0.7 측정용: 공성형이 늦어도 T5에는 게이트 공격에 들어가도록 — 셰이드 선행 + 오거 집결 후 T5 이전 일제 돌입 */
  siegerEarlyGate?: boolean;
}
export const SIEGER_COMMIT_TURN = 5;

/**
 * @param seed  AI 선택 변주용 시드 (기본 -1 = 변주 없음, 기존 동작과 동일)
 * @param flags AI 실험 플래그 (밸런스 측정 전용, 기본 off)
 */
export function aiOrders(s: MatchState, me: Player, style: AiStyle = 'balanced', seed = -1, flags: AiFlags = {}): Order[] {
  const pf = PROFILES[style];
  const varied = seed >= 0;
  const R = (salt: number, n: number) => (varied ? rng(seed, s.turn, me, salt)(n) : 0);
  const heatLimit = pf.heatLimit + (varied ? (R(1, 3) - 1) * 10 : 0);
  const v = viewFor(s, me);
  const e = other(me);
  const orders: Order[] = [];
  const tryAdd = (o: Order) => {
    const b = planBudget(s, me, [...orders, o]);
    if (b.errors[b.errors.length - 1]) return false;
    orders.push(o);
    return true;
  };
  const cyc = () => planBudget(s, me, orders).cyc;
  const my = (id: string) => me + id;
  const en = (id: string) => e + id;
  if (s.over) return [];

  if (v.turn === 0) {
    const setup = style === 'turtle'
      ? [...SETUPS[R(2, 3)], ['hound', 'C'] as [IceKind, string]]
      : SETUPS[varied ? R(2, 3) : 0];
    // 숨은 금고: 저장 소켓 4곳 중 2곳을 시드로 결정론적으로 고른다 (시드 없음 = 기존 배치 V1·V2). 허니팟은 금고가 아닌 소켓으로 옮긴다
    let vaults: string[] = [];
    if (s.options.hiddenVaultsEnabled) {
      const socks = socketsOf(me);
      const pairs: [number, number][] = [[0, 2], [0, 1], [0, 3], [1, 2], [1, 3], [2, 3]];
      const [i, j] = pairs[varied ? rng(seed, 0, me, 50)(pairs.length) : 0];
      vaults = [socks[i], socks[j]].sort();
      tryAdd({ type: 'setVaults', nodes: vaults });
    }
    const decoy = socketsOf(me).find((id) => !vaults.includes(id));
    for (const [k, n] of setup) {
      const node = s.options.hiddenVaultsEnabled && k === 'honeypot' && (!isSocket(my(n)) || vaults.includes(my(n))) && decoy ? decoy : my(n);
      tryAdd({ type: 'compile', ice: k, node });
    }
    return orders;
  }

  const myProgs = v.programs.filter((p) => p.mine);
  const iceCountAt = (id: string) => (v.nodes[id].ices ?? []).filter((i) => !i.free).length;
  const queuedAt = (id: string) => orders.filter((o) => o.type === 'compile' && o.node === id).length;
  // 유지비 인지: 다음 정산 유지비가 수입을 크게 잠식하면 덜 중요한 ICE부터 회수 (방어 → 공격 전환)
  const nextUpkeep = upkeepPerIce(s, s.turn);
  const upkeepNow = nextUpkeep * upkeepIces(s, me).length;
  const inc = income(s, me);
  if (nextUpkeep > 0 && upkeepNow > inc - 3) {
    const order: IceKind[] = ['lantern', 'bulwark', 'hound'];
    const mine = upkeepIces(s, me).filter((i) => !i.node.endsWith('C')).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.seq - a.seq);
    let over = upkeepNow - (inc - 3);
    for (const ice of mine) {
      if (over <= 0) break;
      if (tryAdd({ type: 'recompile', iceId: ice.id })) over -= nextUpkeep;
    }
  }
  const upkeepReserve = () => (nextUpkeep > 0 ? nextUpkeep : 0);

  // 1) 상대 침투 링크가 내 릴레이에 열림 → 하운드
  if (v.enemy.breachOnMe) {
    const r = v.enemy.breachOnMe;
    if (!v.nodes[r].destroyed && !(v.nodes[r].ices ?? []).some((i) => i.kind === 'hound') && iceCountAt(r) + queuedAt(r) < NODE_SPECS.relay.slots) tryAdd({ type: 'compile', ice: 'hound', node: r });
  }
  // 2) 방어: 내 노드에 보이는 적 프로그램 → 그 노드에 하운드
  const intruders = v.programs.filter((p) => !p.mine && v.nodes[p.node].mine).sort((a, b) => a.id - b.id);
  for (const p of intruders) {
    const n = v.nodes[p.node];
    if (n.destroyed) continue;
    const has = (k: string) => (n.ices ?? []).some((i) => i.kind === k) || orders.some((o) => o.type === 'compile' && o.node === n.id && o.ice === k);
    if (iceCountAt(n.id) + queuedAt(n.id) >= n.slots) continue;
    if (!has('hound') && cyc() >= 4 + upkeepReserve()) tryAdd({ type: 'compile', ice: 'hound', node: n.id });
  }
  // 3) 수리 (서든데스가 다가오면 코어 수리 기준 상향)
  const sdSoon = suddenDeathDmg(s, s.turn) > 0 || suddenDeathDmg(s, s.turn + 1) > 0;
  for (const id of ['C', 'G1', 'G2']) {
    const n = v.nodes[my(id)];
    const pct = id === 'C' ? (sdSoon && style !== 'raider' ? 95 : 80) : 50;
    if (!n.destroyed && n.hp * 100 < n.maxHp * pct && cyc() >= 6) tryAdd({ type: 'repair', node: n.id });
  }
  // 4) 노출도 관리
  const hot = v.me.heat >= heatLimit;
  if (hot) for (const p of myProgs.filter((x) => x.kind === 'auger')) tryAdd({ type: 'jackout', progId: p.id });
  // 5) 오버클럭: 상대 코어가 약할 때 몰아치기
  const ecore = v.nodes[en('C')];
  if (ecore.hp * 100 <= ecore.maxHp * 30 && v.me.heat < 40) tryAdd({ type: 'overclock' });

  // 6) 재지정
  const vaultTargets = s.options.hiddenVaultsEnabled
    // 숨은 금고: 드러난 금고 + 핑에 '금고 신호'가 잡힌 소켓 (허니팟일 수도 있음)
    ? socketsOf(e).filter((id) => !v.nodes[id].destroyed && ((v.nodes[id].shownKind === 'vault' && (v.nodes[id].data ?? 0) > 0) || (v.nodes[id].vaultSignal && v.nodes[id].hpHidden)))
    : ['V1', 'V2'].map(en).filter((id) => !v.nodes[id].destroyed && (v.nodes[id].data ?? 0) > 0 && v.nodes[id].shownKind === 'vault');
  for (const p of myProgs) {
    if (!p.target) continue;
    const t = v.nodes[p.target];
    const done = t.destroyed || (p.kind === 'siphon' && !t.hpHidden && (t.kind !== 'vault' || (t.data ?? 0) <= 0)); // 숨은 소켓은 도착해 봐야 앎
    if (!done) continue;
    const nt = p.kind === 'siphon' && vaultTargets.length ? vaultTargets[0] : en('C');
    if (nt !== p.target) tryAdd({ type: 'retarget', progId: p.id, target: nt });
  }
  // 7) 정찰
  if (v.turn % pf.pingEvery === 1 && !v.fogLifted) tryAdd({ type: 'launch', prog: 'ping', target: en(['R2', 'R1', 'R3'][R(3, 3)]) });
  // 8) 공격
  const count = (k: string) => myProgs.filter((p) => p.kind === k).length + orders.filter((o) => o.type === 'launch' && o.prog === k).length;
  const skipOffense = varied && R(4, 4) === 0; // 시드 변주: 가끔 공격을 한 턴 미룸
  const augerTarget = () => {
    if (!varied) return en('C');
    const r = R(5 + count('auger'), 6);
    return r === 0 ? en('P1') : r === 1 ? en('P2') : r === 2 ? en('G1') : en('C');
  };
  if (v.me.breach && !hot && cyc() >= 4) tryAdd({ type: 'launch', prog: 'auger', target: en('C') });
  if (style === 'sieger' && flags.siegerEarlyGate) siegerEarly();
  else if (style === 'sieger') {
    // 매치 내내 같은 게이트를 노린다 (시드로 G1/G2 선택)
    const tg = en(varied && rng(seed, 0, me, 99)(2) === 1 ? 'G2' : 'G1');
    const gateDown = v.nodes[tg].destroyed;
    // E1(코어 브리치 데이터)가 켜져 있으면 코어 본체 피해가 데이터가 되므로, 게이트가 열리는 즉시 코어에 전력 집중 (공성형만)
    const e1 = breachDataOn(s);
    const tgt = gateDown ? en('C') : tg;
    for (const p of myProgs) if (p.kind === 'auger' && p.target !== tgt && p.target !== en('C')) tryAdd({ type: 'retarget', progId: p.id, target: tgt });
    if (gateDown) for (const p of myProgs) if (p.kind === 'auger' && p.target === tg) tryAdd({ type: 'retarget', progId: p.id, target: en('C') });
    const hounds = (v.nodes[tg].ices ?? []).filter((i) => i.kind === 'hound').length;
    if (!gateDown && count('shade') < 1 && cyc() >= 4) tryAdd({ type: 'launch', prog: 'shade', target: tg });
    if (v.nodes[tg].ices === null || v.turn % 2 === 0) tryAdd({ type: 'launch', prog: 'ping', target: tg });
    // 하운드가 정찰상 없거나 게이트가 열렸으면 오거 투입, 아니면 셰이드가 처리할 때까지 1기만
    const want = gateDown || hounds === 0 ? pf.maxAuger + (e1 ? 1 : 0) : 1;
    const heatMargin = e1 && gateDown ? 5 : 15; // E1: 코어가 열렸으면 노출도 여유를 줄여서라도 오거를 더 넣는다
    while (count('auger') < want && !hot && v.me.heat < heatLimit - heatMargin && cyc() >= 4) if (!tryAdd({ type: 'launch', prog: 'auger', target: tgt })) break;
  }
  /**
   * (측정 전용) 공성형 조기 게이트 공세:
   * - 셰이드 2기를 먼저 게이트로 보내 하운드를 정리 (하운드는 은신 셰이드를 못 봄)
   * - 오거는 게이트 쪽 중립 노드(게이트1=중립 북, 게이트2=중립 남)에 모아 두고,
   *   정찰상 게이트에 하운드가 없거나 늦어도 T5가 되면 전부 게이트로 돌입 (이후 하운드 정보와 무관하게 최대치 유지)
   */
  function siegerEarly() {
    const tg = en(varied && rng(seed, 0, me, 99)(2) === 1 ? 'G2' : 'G1');
    const stage = tg.endsWith('G2') ? 'N3' : 'N1';
    const gateDown = v.nodes[tg].destroyed;
    const e1 = breachDataOn(s);
    const gateIces = v.nodes[tg].ices;
    const hounds = (gateIces ?? []).filter((i) => i.kind === 'hound').length;
    const commit = gateDown || v.turn >= SIEGER_COMMIT_TURN || (gateIces !== null && hounds === 0);
    const tgt = gateDown ? en('C') : commit ? tg : stage;
    for (const p of myProgs) if (p.kind === 'auger' && p.target !== tgt && p.target !== en('C')) tryAdd({ type: 'retarget', progId: p.id, target: tgt });
    if (gateDown) for (const p of myProgs) if (p.kind === 'auger' && p.target === tg) tryAdd({ type: 'retarget', progId: p.id, target: en('C') });
    if (!gateDown && (v.nodes[tg].ices === null || v.turn % 2 === 0)) tryAdd({ type: 'launch', prog: 'ping', target: tg });
    while (!gateDown && count('shade') < 2 && cyc() >= 4) if (!tryAdd({ type: 'launch', prog: 'shade', target: tg })) break;
    const want = pf.maxAuger + (e1 && gateDown ? 1 : 0);
    const heatMargin = e1 && gateDown ? 5 : 10;
    while (count('auger') < want && !hot && v.me.heat < heatLimit - heatMargin && cyc() >= 4) if (!tryAdd({ type: 'launch', prog: 'auger', target: tgt })) break;
  }
  if (!skipOffense) {
    if (count('siphon') < pf.maxSiphon && vaultTargets.length && cyc() >= 6) {
      const pick = vaultTargets[(v.turn + R(6, 2)) % vaultTargets.length];
      tryAdd({ type: 'launch', prog: 'siphon', target: pick });
    }
    // E1 공성형: 코어 공격 중인 오거가 있으면 오버클럭으로 피해(=브리치 데이터) 가속
    if (style === 'sieger' && breachDataOn(s) && v.me.heat < 45 && myProgs.some((p) => p.kind === 'auger' && p.node === en('C'))) tryAdd({ type: 'overclock' });
    if (count('auger') < pf.maxAuger && !hot && v.me.heat < heatLimit - 10 && cyc() >= pf.augerMinCyc + upkeepReserve()) tryAdd({ type: 'launch', prog: 'auger', target: augerTarget() });
    const houndNode = Object.values(v.nodes).filter((n) => n.enemy && !n.destroyed && (n.ices ?? []).some((i) => i.kind === 'hound')).sort((a, b) => (a.id < b.id ? -1 : 1))[varied ? 0 : 0];
    if (houndNode && count('shade') < pf.maxShade && cyc() >= 6) tryAdd({ type: 'launch', prog: 'shade', target: houndNode.id });
  }
  // 9) 남는 CYC: 철벽/균형형은 방어 보강, 돌격형은 추가 오거
  if (cyc() >= pf.extraAugerAt && !hot) tryAdd({ type: 'launch', prog: 'auger', target: en('C') });
  if (cyc() >= pf.extraDefenseAt + upkeepReserve() * 4) {
    for (const [id, k] of [['G1', 'hound'], ['G2', 'hound'], ['C', 'bulwark'], ['R2', 'bulwark']] as const) {
      const n = v.nodes[my(id)];
      if (!n.destroyed && iceCountAt(n.id) + queuedAt(n.id) < n.slots && cyc() >= 8) tryAdd({ type: 'compile', ice: k, node: n.id });
    }
  }
  return orders;
}
