/**
 * 시뮬레이션 코어 — 순수·결정론적 로직 (DOM 없음, 난수 없음, 정수 연산).
 * resolveTurn(state, ordersA, ordersB) 는 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
 */
import { HEAT_PULLOUT_THRESHOLD, ICE_SPECS, MATCHUP, NODE_SPECS, PROG_SPECS, SIEGE_PRESSURE, TUNING, normalizeOptions, receivedPct, type SiegeOptions } from './config';
import { ADJ, HOPS, NODES, NODE_BY_ID } from './map';
import type { Ice, IceKind, LogEntry, MatchState, NodeKind, NodeState, Order, Player, Program, ProgKind } from './types';
import { other } from './types';

export const STEP_NAMES = ['', '① 철수·회수·수리', '② 정찰', '③ 발사·이동', '④ 교전', '⑤ 특수 효과', '⑥ 트레이스·노출도', '⑦ 컴파일·수입 정산'];
const PLAYERS: Player[] = ['A', 'B'];

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

/** ICE 컴파일 비용 (CYC) — 하운드 비용 상향 옵션 [기획 v0.3 측정] 반영 */
export function iceCyc(o: SiegeOptions, kind: IceKind): number { return kind === 'hound' && o.houndCostRaisedEnabled ? o.houndCostRaised : ICE_SPECS[kind].cyc; }
/** 금고 1개의 초기 데이터 (점) — (V1) 켜면 4 → 3 */
export function vaultDataPts(o: SiegeOptions): number { return o.vaultDataReducedEnabled ? o.vaultDataReduced : TUNING.vaultData; }
/** 사이펀 1턴 탈취량 (×2 정수) — (V2) 켜면 2 → 1 (=0.5점) */
export function siphonAmt2(o: SiegeOptions): number { return o.siphonSlowEnabled ? o.siphonSlowHalfPerTurn : TUNING.siphonPerTurn * 2; }
export function createMatch(options: Partial<SiegeOptions> = {}): MatchState {
  const nodes: Record<string, NodeState> = {};
  for (const n of NODES) {
    const spec = NODE_SPECS[n.kind];
    nodes[n.id] = {
      id: n.id, kind: n.kind, owner: n.owner, hp: spec.hp * 10, maxHp: spec.hp * 10,
      data: n.kind === 'vault' ? TUNING.vaultData * 2 : 0, offlineTurns: 0, destroyed: false,
    };
  }
  const opts = normalizeOptions(clone({ ...SIEGE_PRESSURE, ...options }));
  // (V1) 금고 데이터
  for (const n of Object.values(nodes)) if (n.kind === 'vault') n.data = vaultDataPts(opts) * 2;
  // (G1) 게이트 HP 하향
  if (opts.gateHpReducedEnabled) for (const n of Object.values(nodes)) if (n.kind === 'gate') { n.hp = opts.gateHpReduced * 10; n.maxHp = opts.gateHpReduced * 10; }
  const ps = () => ({ cyc: TUNING.setupCyc, heat: 0, data: 0, neutralData: 0, coreDmgDealt: 0, breachData: 0, vaultData: 0, heatPulloutTurns: 0, heatHighTurns: 0, tracebacks: 0, minCoreHp: 0, emergencyUsed: false, breach: null, scouted: {}, pendingReward: 0, bwHistory: [] });
  const players = { A: ps(), B: ps() };
  for (const p of PLAYERS) players[p].minCoreHp = nodes[p + 'C'].hp;
  return { options: opts, turn: 0, over: false, winner: null, winReason: null, firstGateBreak: null, suddenDeathReachedTurn: null, debugJumps: [], nodes, ices: [], programs: [], players, nextId: 1, log: [], turnLogs: [] };
}

/** 노드의 ICE 슬롯 수 — (G3) 켜면 게이트 3 → 2 */
export function iceSlots(s: MatchState, kind: NodeKind): number {
  return kind === 'gate' && s.options.gateSlotsReducedEnabled ? s.options.gateSlotsReduced : NODE_SPECS[kind].slots;
}

// ---------- 공성 압박 보정안 (v0.2) ----------
/** 해당 턴 정산에서 ICE 1개당 유지비 (0 = 없음) */
export function upkeepPerIce(s: MatchState, turn: number): number {
  const o = s.options;
  if (!o.iceUpkeepEnabled || turn < o.iceUpkeepStartTurn) return 0;
  return Math.min(o.iceUpkeepCap, o.iceUpkeepCycPerIce + Math.floor((turn - o.iceUpkeepStartTurn) / o.iceUpkeepStepTurns));
}
export function upkeepIces(s: MatchState, p: Player): Ice[] {
  return s.ices.filter((i) => i.owner === p && !i.free && !s.options.iceUpkeepExcludeKinds.includes(i.kind));
}
/** 해당 턴 서든데스 코어 고정 피해 (HP 단위, 0 = 없음) */
export function suddenDeathDmg(s: MatchState, turn: number): number {
  const o = s.options;
  if (!o.suddenDeathEnabled || turn < o.suddenDeathStartTurn) return 0;
  return o.suddenDeathCoreDmgPerTurn + (turn - o.suddenDeathStartTurn) * o.suddenDeathCoreDmgStep;
}
/** 데이터 승리 기준 (점). D1이 켜지면 상향값 */
export function dataWinTarget(s: MatchState): number {
  return s.options.dataWinRaiseEnabled ? s.options.dataWinRaised : TUNING.dataWin;
}
/** 이번 턴 중립 데이터 획득량 (×2 단위)과 사유. D2 상한·D3 지연 적용 */
/** E1(코어 브리치 데이터) 적용 여부 — E1 또는 E2 */
export function breachDataOn(s: MatchState): boolean {
  return s.options.coreBreachDataEnabled || s.options.coreBreachE2Enabled;
}
/** 중립 데이터 상한 (점, null = 상한 없음). E2가 켜지면 4 */
export function neutralCap(s: MatchState): number | null {
  if (s.options.coreBreachE2Enabled) return s.options.e2NeutralDataCap;
  return s.options.neutralDataCapEnabled ? s.options.neutralDataCap : null;
}
/** 누적 코어 피해(×10)에 대한 E1 총 지급액(×2) */
export function breachDataFor(s: MatchState, dealtDeci: number): number {
  const o = s.options;
  return Math.min(o.coreBreachDataMax * 2, Math.floor(dealtDeci / (o.coreBreachDmgStep * 10)) * o.coreBreachDataPer * 2);
}
export function neutralDataGain(s: MatchState, p: Player, neut: number): { gain: number; raw: number; note: string } {
  const o = s.options;
  const raw = neut * Math.round(TUNING.neutralDataPerTurn * 2);
  if (!neut) return { gain: 0, raw, note: '' };
  if (o.neutralDataDelayEnabled && s.turn < o.neutralDataStartTurn) return { gain: 0, raw, note: `데이터 생성은 T${o.neutralDataStartTurn}부터 (D3)` };
  const cap = neutralCap(s);
  if (cap !== null) {
    const tag = o.coreBreachE2Enabled ? 'E2' : 'D2';
    const left = Math.max(0, cap * 2 - s.players[p].neutralData);
    if (left < raw) return { gain: left, raw, note: left ? `중립 데이터 상한 ${cap}점 도달 (${tag})` : `중립 데이터 상한 ${cap}점 이미 도달 — 이후는 금고 탈취${breachDataOn(s) ? '·코어 브리치' : ''}로만 (${tag})` };
  }
  return { gain: raw, raw, note: '' };
}
export function fogLifted(s: MatchState): boolean {
  return s.options.suddenDeathEnabled && s.options.suddenDeathRevealFog && s.turn >= s.options.suddenDeathStartTurn;
}

// ---------- 질의 헬퍼 ----------
// ---------- 숨은 금고 (H) ----------
/** 진영별 저장 소켓 4곳 — 기존 금고 2곳 + 바깥 릴레이1·릴레이3 자리 [기획 v0.3] */
export const SOCKET_KEYS = ['V1', 'R1', 'V2', 'R3'] as const;
export const SOCKET_LABEL: Record<string, string> = { V1: '소켓1', R1: '소켓2', V2: '소켓3', R3: '소켓4' };
export const socketsOf = (p: Player) => SOCKET_KEYS.map((k) => p + k);
export const isSocket = (id: string) => /^[AB](V1|V2|R1|R3)$/.test(id);
/** 숨은 금고 모드에서는 저장 소켓 이름을 '소켓n'으로 통일해 로그·화면에서 금고 위치가 드러나지 않게 한다 */
let socketNames = false;
export const socketNamesOn = (s: MatchState) => s.options.hiddenVaultsEnabled;
export const nodeLabel = (s: MatchState, id: string) => (s.options.hiddenVaultsEnabled && isSocket(id) ? `${id[0]} ${SOCKET_LABEL[id.slice(1)]}` : NODE_BY_ID[id]?.label ?? id);
export const nodeName = (id: string) => (socketNames && isSocket(id) ? `${id[0]} ${SOCKET_LABEL[id.slice(1)]}` : NODE_BY_ID[id]?.label ?? id);
function withSocketNames<T>(s: MatchState, f: () => T): T {
  const prev = socketNames;
  socketNames = s.options.hiddenVaultsEnabled;
  try { return f(); } finally { socketNames = prev; }
}
/** (숨은 금고) 시간 만료 자동 확정용: 플레이어가 고른 소켓(최대 2)은 유지하고, 모자란 자리만 기본 소켓(소켓1·소켓3 → 소켓2·소켓4 순)으로 채운다 */
export function fillVaultPick(p: Player, pick: readonly string[]): { nodes: string[]; autoFilled: string[] } {
  const keep = [...new Set(pick)].filter((id) => socketsOf(p).includes(id)).slice(-2);
  const order = [p + 'V1', p + 'V2', p + 'R1', p + 'R3'];
  const autoFilled = order.filter((id) => !keep.includes(id)).slice(0, 2 - keep.length);
  return { nodes: [...keep, ...autoFilled].sort(), autoFilled };
}
/** 이번 명령 목록을 반영한 내 금고 소켓 (구축 단계의 setVaults 반영) */
export function effectiveVaults(s: MatchState, p: Player, orders: Order[] = []): string[] {
  const sv = s.turn === 0 && s.options.hiddenVaultsEnabled ? orders.find((o) => o.type === 'setVaults') : undefined;
  if (sv && sv.type === 'setVaults') return [...sv.nodes].sort();
  return socketsOf(p).filter((id) => s.nodes[id].kind === 'vault').sort();
}
export const progName = (p: { kind: string; id: number }) => `${PROG_SPECS[p.kind as ProgKind].name}#${p.id}`;
export const iceName = (i: { kind: string; id: number }) => `${ICE_SPECS[i.kind as IceKind].name}#${i.id}`;
const fmt = (deci: number) => (deci % 10 === 0 ? String(deci / 10) : (deci / 10).toFixed(1));

export function bwCap(s: MatchState, p: Player): number {
  const relays = Object.values(s.nodes).filter((n) => n.owner === p && n.kind === 'relay' && !n.destroyed).length;
  return TUNING.bwBase + TUNING.bwPerRelay * relays;
}
export function bwUse(s: MatchState, p: Player) {
  const def = s.ices.filter((i) => i.owner === p && !i.free).reduce((a, i) => a + ICE_SPECS[i.kind].bw, 0);
  const atk = s.programs.filter((x) => x.owner === p).reduce((a, x) => a + PROG_SPECS[x.kind].bw, 0);
  return { def, atk, total: def + atk };
}
export function income(s: MatchState, p: Player): number {
  const procs = Object.values(s.nodes).filter((n) => n.owner === p && n.kind === 'processor' && !n.destroyed).length;
  const neut = Object.values(s.nodes).filter((n) => n.kind === 'neutral' && n.owner === p).length;
  return TUNING.baseIncome + TUNING.processorIncome * procs + TUNING.neutralIncome * neut;
}
const activeIceAt = (s: MatchState, node: string, owner: Player, kind?: IceKind) =>
  s.ices.filter((i) => i.node === node && i.owner === owner && !i.compiling && (!kind || i.kind === kind));

function isEnemyNode(s: MatchState, nodeId: string, p: Player) {
  const n = s.nodes[nodeId];
  return n.owner === other(p) && n.kind !== 'neutral' && !n.destroyed;
}
/** 적 성채 노드가 통과를 막는가 (살아있는 게이트 또는 활성 벌워크) */
export function isBlocking(s: MatchState, nodeId: string, p: Player): 'gate' | 'bulwark' | null {
  if (!isEnemyNode(s, nodeId, p)) return null;
  if (activeIceAt(s, nodeId, other(p), 'bulwark').length) return 'bulwark';
  if (s.nodes[nodeId].kind === 'gate') return 'gate';
  return null;
}
const stealthy = (pr: Program) => pr.kind === 'shade' && !pr.detected;
function canLeave(s: MatchState, pr: Program) {
  return !isBlocking(s, pr.node, pr.owner) || stealthy(pr);
}

function linkCost(s: MatchState, a: string, b: string, fast: boolean, p: Player) {
  if (!fast) return 2;
  return s.nodes[a].owner === p || s.nodes[b].owner === p ? 1 : Infinity;
}
/** 목표까지의 반칸(half-step) 거리. 일반 링크 2, 고속 링크 1 (점령자만). */
export function distancesTo(s: MatchState, target: string, p: Player): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const n of NODES) dist[n.id] = Infinity;
  dist[target] = 0;
  const done = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    for (const n of NODES) if (!done.has(n.id) && dist[n.id] < Infinity && (cur === null || dist[n.id] < dist[cur])) cur = n.id;
    if (cur === null) break;
    done.add(cur);
    for (const { to, fast } of ADJ[cur]) {
      const d = dist[cur] + linkCost(s, cur, to, fast, p);
      if (d < dist[to]) dist[to] = d;
    }
  }
  return dist;
}
export function nextHop(s: MatchState, from: string, target: string, p: Player): { to: string; cost: number } | null {
  if (from === target) return null;
  const dist = distancesTo(s, target, p);
  let best: { to: string; cost: number; total: number } | null = null;
  for (const { to, fast } of ADJ[from]) {
    const c = linkCost(s, from, to, fast, p);
    const t = c + dist[to];
    if (t < Infinity && (!best || t < best.total)) best = { to, cost: c, total: t };
  }
  return best ? { to: best.to, cost: best.cost } : null;
}

export function spawnPoints(s: MatchState, p: Player): string[] {
  const pts = Object.values(s.nodes).filter((n) => n.owner === p && n.kind === 'relay' && !n.destroyed).map((n) => n.id);
  pts.sort();
  const br = s.players[p].breach;
  if (br) pts.push(br.relay); // 내 릴레이 우선(동률 시), 그다음 침투 링크
  return pts;
}
export function pickSpawn(s: MatchState, p: Player, target: string): string | null {
  const pts = spawnPoints(s, p);
  if (!pts.length) return null;
  const dist = distancesTo(s, target, p);
  let best = pts[0];
  for (const x of pts) if (dist[x] < dist[best]) best = x;
  return dist[best] < Infinity ? best : null;
}
export function pingOrigins(s: MatchState, p: Player): string[] {
  return [...new Set([...spawnPoints(s, p), ...s.programs.filter((x) => x.owner === p).map((x) => x.node)])];
}

// ---------- 명령 검증 / 예산 ----------
export interface Budget { cyc: number; bwUsed: number; bwCap: number; bwAtk: number; bwDef: number; errors: (string | null)[] }

export function planBudget(s: MatchState, p: Player, orders: Order[]): Budget {
  const ps = s.players[p];
  const cap = bwCap(s, p);
  const use = bwUse(s, p);
  let bwAtk = use.atk, bwDef = use.def;
  let cyc = ps.cyc + (orders.some((o) => o.type === 'overclock') ? TUNING.overclockCyc : 0);
  const removedIce = new Set<number>(), removedProg = new Set<number>();
  const queuedAt: Record<string, number> = {};
  let overclocks = 0;
  const errors: (string | null)[] = [];
  for (const o of orders) {
    let err: string | null = null;
    let dc = 0, dAtk = 0, dDef = 0;
    if (s.over) err = '경기 종료';
    else if (o.type === 'setVaults') {
      const ok = o.nodes.length === 2 && new Set(o.nodes).size === 2 && o.nodes.every((id) => socketsOf(p).includes(id));
      if (!s.options.hiddenVaultsEnabled) err = '숨은 금고 옵션이 꺼져 있음';
      else if (s.turn !== 0) err = '금고 지정은 구축 단계에서만';
      else if (!ok) err = '내 저장 소켓 4곳 중 서로 다른 2곳을 골라야 함';
      else if (orders.indexOf(o) !== orders.findIndex((x) => x.type === 'setVaults')) err = '금고 지정은 한 번만';
    }
    else if (s.turn === 0 && o.type !== 'compile' && o.type !== 'recompile') err = '구축 단계에서는 ICE 컴파일만 가능';
    else if (o.type === 'overclock') {
      if (++overclocks > 1) err = '오버클럭은 턴당 1회';
    } else if (o.type === 'compile') {
      const n = s.nodes[o.node];
      const spec = ICE_SPECS[o.ice];
      const slots = iceSlots(s, n.kind);
      const present = s.ices.filter((i) => i.node === o.node && !i.free && !removedIce.has(i.id)).length + (queuedAt[o.node] ?? 0);
      const hv = s.options.hiddenVaultsEnabled;
      if (n.owner !== p || n.kind === 'neutral') err = '내 성채 노드에만 설치 가능';
      else if (hv && o.ice === 'honeypot' && (!isSocket(o.node) || effectiveVaults(s, p, orders).includes(o.node))) err = '허니팟은 금고로 지정하지 않은 저장 소켓에만 설치 가능 (숨은 금고)';
      else if (n.destroyed) err = '파괴된 노드';
      else if (present >= slots) err = `ICE 슬롯 부족 (${slots}칸)`;
      else { dc = -iceCyc(s.options, o.ice); dDef = spec.bw; queuedAt[o.node] = (queuedAt[o.node] ?? 0) + 1; }
    } else if (o.type === 'recompile') {
      const ice = s.ices.find((i) => i.id === o.iceId);
      if (!ice || ice.owner !== p || removedIce.has(ice.id)) err = '회수할 ICE 없음';
      else if (ice.free) err = '비상 프로토콜 ICE는 회수 불가';
      else { removedIce.add(ice.id); dDef = -ICE_SPECS[ice.kind].bw; dc = Math.floor((iceCyc(s.options, ice.kind) * TUNING.recompileRefundPct) / 100); }
    } else if (o.type === 'launch') {
      const spec = PROG_SPECS[o.prog];
      const n = s.nodes[o.target];
      if (!n) err = '대상 없음';
      else if (n.owner === p && n.kind !== 'neutral') err = '내 노드는 공격 대상이 아님';
      else if (o.prog === 'ping') {
        const ok = pingOrigins(s, p).some((x) => HOPS[x][o.target] <= TUNING.pingRange);
        if (!ok) err = `핑은 내 릴레이/프로그램에서 ${TUNING.pingRange}칸 이내만 가능`;
        else dc = -spec.cyc;
      } else if (!pickSpawn(s, p, o.target)) err = '발사할 릴레이 없음';
      else { dc = -spec.cyc; dAtk = spec.bw; }
    } else if (o.type === 'jackout') {
      const pr = s.programs.find((x) => x.id === o.progId);
      if (!pr || pr.owner !== p || removedProg.has(pr.id)) err = '철수할 프로그램 없음';
      else { removedProg.add(pr.id); dAtk = -PROG_SPECS[pr.kind].bw; dc = ps.heat >= TUNING.heatTracking ? -TUNING.jackoutCostWhenTracked : 0; }
    } else if (o.type === 'retarget') {
      const pr = s.programs.find((x) => x.id === o.progId);
      const n = s.nodes[o.target];
      if (!pr || pr.owner !== p) err = '프로그램 없음';
      else if (!n || (n.owner === p && n.kind !== 'neutral')) err = '잘못된 목표';
    } else if (o.type === 'repair') {
      const n = s.nodes[o.node];
      if (!n || n.owner !== p || n.kind === 'neutral') err = '내 노드만 수리 가능';
      else if (n.destroyed) err = '파괴된 노드는 수리 불가';
      else if (n.hp >= n.maxHp) err = '이미 최대 HP';
      else dc = -TUNING.repairCost;
    }
    if (!err && cyc + dc < 0) err = `CYC 부족 (필요 ${-dc}, 남음 ${cyc})`;
    if (!err && dAtk + dDef > 0 && bwAtk + bwDef + dAtk + dDef > cap) err = `BW 부족 (${bwAtk + bwDef}/${cap})`;
    if (!err) { cyc += dc; bwAtk += dAtk; bwDef += dDef; }
    else if (o.type === 'compile') queuedAt[o.node] = queuedAt[o.node] ?? 0;
    errors.push(err);
  }
  return { cyc, bwUsed: bwAtk + bwDef, bwCap: cap, bwAtk, bwDef, errors };
}

// ---------- 턴 해결 ----------
export function resolveTurn(s0: MatchState, ordersA: Order[], ordersB: Order[]): MatchState {
  return withSocketNames(s0, () => resolveTurnInner(s0, ordersA, ordersB));
}
function resolveTurnInner(s0: MatchState, ordersA: Order[], ordersB: Order[]): MatchState {
  const s = clone(s0);
  const log: LogEntry[] = [];
  s.log = log;
  if (s.over) return s;
  const L = (step: number, text: string, vis: LogEntry['vis'] = 'all', kind?: LogEntry['kind']) => log.push({ step, text, vis, kind });
  const orders: Record<Player, Order[]> = { A: [], B: [] };
  const raw: Record<Player, Order[]> = { A: ordersA, B: ordersB };
  for (const p of PLAYERS) {
    const b = planBudget(s0, p, raw[p]);
    raw[p].forEach((o, i) => (b.errors[i] ? L(1, `[${p}] 명령 무효: ${describeOrder(s0, o)} — ${b.errors[i]}`, p, 'warn') : orders[p].push(o)));
  }
  const setup = s.turn === 0;
  // [기획 v0.3.1] HEAT 80 통계: 이 턴 시작(계획 단계) 노출도 기준
  for (const p of PLAYERS) {
    const ps = s.players[p];
    if (ps.heat >= HEAT_PULLOUT_THRESHOLD) {
      ps.heatHighTurns++;
      if (orders[p].some((o) => o.type === 'jackout')) ps.heatPulloutTurns++;
    }
  }
  const overclocked: Record<Player, boolean> = { A: false, B: false };

  // ⓪ (숨은 금고) 구축 단계 금고 지정: 고른 2곳은 금고(HP 20, 데이터 4), 나머지 소켓은 중계(HP 15)
  if (setup && s.options.hiddenVaultsEnabled) {
    for (const p of PLAYERS) {
      const vaults = effectiveVaults(s, p, orders[p]);
      for (const id of socketsOf(p)) {
        const n = s.nodes[id];
        const kind = vaults.includes(id) ? 'vault' : 'relay';
        n.kind = kind; n.hp = NODE_SPECS[kind].hp * 10; n.maxHp = n.hp; n.data = kind === 'vault' ? vaultDataPts(s.options) * 2 : 0;
      }
      L(1, `[${p}] 저장 소켓 금고 지정: ${vaults.map(nodeName).join(', ')} (나머지 소켓은 중계)`, p, 'def');
      // 자동 채움 안내도 그 플레이어에게만 보인다 (상대 화면·공유 로그에 소켓 선택이 새지 않도록)
      const sv = orders[p].find((o) => o.type === 'setVaults');
      if (sv && sv.type === 'setVaults' && sv.autoFilled?.length) {
        const kept = vaults.filter((id) => !sv.autoFilled!.includes(id));
        L(1, `[${p}] 구축 시간 만료: 금고 소켓 ${sv.autoFilled.length}곳이 비어 기본 소켓으로 자동 지정 — ${sv.autoFilled.map(nodeName).join(', ')}${kept.length ? ` (직접 고른 ${kept.map(nodeName).join(', ')} 유지)` : ''}`, p, 'warn');
      }
    }
  }
  // ① 철수·회수·수리 (+ 오버클럭, 재지정, ICE 컴파일 시작)
  for (const p of PLAYERS) {
    const ps = s.players[p];
    for (const o of orders[p]) {
      if (o.type === 'overclock') { ps.cyc += TUNING.overclockCyc; overclocked[p] = true; L(1, `[${p}] 오버클럭: CYC +${TUNING.overclockCyc} (노출도 +${TUNING.heatOverclock} 예정)`, p, 'warn'); }
    }
    for (const o of orders[p]) {
      if (o.type === 'recompile') {
        const ice = s.ices.find((i) => i.id === o.iceId)!;
        const refund = Math.floor((iceCyc(s.options, ice.kind) * TUNING.recompileRefundPct) / 100);
        s.ices = s.ices.filter((i) => i !== ice);
        ps.cyc += refund;
        L(1, `[${p}] ${iceName(ice)} 회수 (${nodeName(ice.node)}) → BW ${ICE_SPECS[ice.kind].bw} 반환, CYC +${refund}`, p, 'def');
      } else if (o.type === 'jackout') {
        const pr = s.programs.find((x) => x.id === o.progId)!;
        const cost = ps.heat >= TUNING.heatTracking ? TUNING.jackoutCostWhenTracked : 0;
        ps.cyc -= cost;
        s.programs = s.programs.filter((x) => x !== pr);
        L(1, `[${p}] ${progName(pr)} 철수 (${nodeName(pr.node)}) → BW ${PROG_SPECS[pr.kind].bw} 반환${cost ? `, 추적 중이라 CYC -${cost}` : ''}`, p, 'atk');
      } else if (o.type === 'retarget') {
        const pr = s.programs.find((x) => x.id === o.progId);
        if (pr) { pr.target = o.target; L(1, `[${p}] ${progName(pr)} 목표 변경 → ${nodeName(o.target)}`, p, 'atk'); }
      } else if (o.type === 'repair') {
        const n = s.nodes[o.node];
        if (!n.destroyed) {
          ps.cyc -= TUNING.repairCost;
          const before = n.hp;
          n.hp = Math.min(n.maxHp, n.hp + TUNING.repairHp * 10);
          L(1, `[${p}] ${nodeName(n.id)} 수리 HP ${fmt(before)} → ${fmt(n.hp)} (CYC -${TUNING.repairCost})`, p, 'def');
        }
      } else if (o.type === 'compile') {
        const spec = ICE_SPECS[o.ice];
        ps.cyc -= iceCyc(s.options, o.ice);
        s.ices.push({ id: s.nextId, kind: o.ice, owner: p, node: o.node, hp: spec.hp * 10, compiling: true, free: false, seq: s.nextId });
        L(1, `[${p}] ${spec.name}#${s.nextId} 컴파일 시작 @ ${nodeName(o.node)} (CYC -${iceCyc(s.options, o.ice)}, ${setup ? '구축 단계 종료 시' : '이번 턴 정산 시'} 활성화)`, p, 'def');
        s.nextId++;
      }
    }
  }

  // ② 정찰
  for (const p of PLAYERS) {
    for (const o of orders[p]) {
      if (o.type !== 'launch' || o.prog !== 'ping') continue;
      s.players[p].cyc -= PROG_SPECS.ping.cyc;
      const area = NODES.filter((n) => HOPS[o.target][n.id] <= TUNING.pingRevealRadius && isEnemyNode(s, n.id, p)).map((n) => n.id);
      const parts: string[] = [];
      for (const nid of area) {
        const ices = s.ices.filter((i) => i.node === nid && i.owner === other(p));
        const visible = ices.filter((i) => i.kind !== 'honeypot').map((i) => i.kind);
        const fake = ices.some((i) => i.kind === 'honeypot');
        // 진짜 금고와 허니팟은 핑에서 똑같이 '금고 신호'로 잡힌다 (기획 결정: 신호로 허니팟을 구별할 수 없어야 함)
        s.players[p].scouted[nid] = { turn: s.turn, ice: visible, fakeVault: fake, vaultSignal: fake || s.nodes[nid].kind === 'vault', contact: s.players[p].scouted[nid]?.contact ?? false };
        parts.push(`${nodeName(nid)}: ${visible.length ? visible.map((k) => ICE_SPECS[k].name).join(', ') : 'ICE 없음'}${fake || s.nodes[nid].kind === 'vault' ? ' (금고 신호)' : ''}`);
      }
      L(2, `[${p}] 핑 → ${nodeName(o.target)} 주변 정찰. ${parts.length ? parts.join(' / ') : '적 노드 없음'}`, p, 'atk');
    }
  }
  updateDetection(s);

  // ③ 발사·이동
  for (const p of PLAYERS) {
    for (const o of orders[p]) {
      if (o.type !== 'launch' || o.prog === 'ping') continue;
      const spec = PROG_SPECS[o.prog];
      const at = pickSpawn(s, p, o.target);
      if (!at) { L(3, `[${p}] ${spec.name} 발사 실패: 릴레이 없음`, p, 'warn'); continue; }
      s.players[p].cyc -= spec.cyc;
      const pr: Program = { id: s.nextId, kind: o.prog, owner: p, node: at, target: o.target, hp: spec.hp * 10, stunned: 0, detected: false, revealed: false, seq: s.nextId };
      s.nextId++;
      s.programs.push(pr);
      L(3, `[${p}] ${progName(pr)} 발사 @ ${nodeName(at)} → 목표 ${nodeName(o.target)} (CYC -${spec.cyc}, BW ${spec.bw})`, p, 'atk');
    }
  }
  const stunnedNow = new Set<number>();
  const budget: Record<number, number> = {};
  const honeyHits: { prog: Program; ice: Ice }[] = [];
  const progs = [...s.programs].sort((a, b) => a.id - b.id);
  for (const pr of progs) {
    pr.revealed = false;
    const start = s.nodes[pr.node];
    budget[pr.id] = PROG_SPECS[pr.kind].speed * 2 + (start.kind === 'neutral' && start.owner === pr.owner ? 2 : 0);
    if (pr.stunned > 0) { pr.stunned--; stunnedNow.add(pr.id); budget[pr.id] = 0; L(3, `[${pr.owner}] ${progName(pr)} 허니팟에 묶여 이번 턴 정지`, pr.owner, 'warn'); }
    else if (pr.node !== pr.target && !canLeave(s, pr)) {
      budget[pr.id] = 0;
      L(3, `[${pr.owner}] ${progName(pr)} ${nodeName(pr.node)}에서 저지됨 (${isBlocking(s, pr.node, pr.owner) === 'gate' ? '게이트' : '벌워크'} 돌파 필요)`, pr.owner, 'atk');
    }
  }
  // 서브틱 이동. 각 서브틱에서 모든 프로그램의 이번 한 칸 이동 의도를 먼저 정하고(서브틱 시작 위치 기준),
  // 같은 링크를 반대 방향으로 건너려는 적 프로그램끼리는 '링크 교전'으로 둘 다 멈춘다 (§6.4 ③ "같은 링크에서 마주치면 교전").
  const encounters: [Program, Program][] = [];
  const engaged = new Set<number>();
  for (let sub = 1; sub <= 6; sub++) {
    const intents: { pr: Program; to: string; cost: number }[] = [];
    for (const pr of progs) {
      if (budget[pr.id] <= 0 || pr.node === pr.target) continue;
      if (!canLeave(s, pr)) { budget[pr.id] = 0; continue; }
      const hop = nextHop(s, pr.node, pr.target, pr.owner);
      if (!hop || hop.cost > budget[pr.id]) { budget[pr.id] = 0; continue; }
      intents.push({ pr, to: hop.to, cost: hop.cost });
    }
    if (!intents.length) break;
    // 링크 교전 판정: X a→b, Y b→a, 소유자 다름, 둘 다 은신 아님 (은신 셰이드는 마주쳐도 들키지 않고 지나감 [기획 v0.3])
    const blocked = new Set<number>();
    for (const x of intents) for (const y of intents) {
      if (x.pr.id >= y.pr.id || x.pr.owner === y.pr.owner) continue;
      if (x.pr.node !== y.to || y.pr.node !== x.to) continue;
      if (stealthy(x.pr) || stealthy(y.pr)) continue;
      blocked.add(x.pr.id); blocked.add(y.pr.id);
      encounters.push([x.pr, y.pr]);
      engaged.add(x.pr.id); engaged.add(y.pr.id);
      L(3, `링크 교전! ${progName(x.pr)}[${x.pr.owner}] ↔ ${progName(y.pr)}[${y.pr.owner}]: ${nodeName(x.pr.node)}–${nodeName(y.pr.node)} 링크에서 마주쳐 둘 다 정지 (④에서 교전)`, 'all', 'warn');
    }
    for (const { pr, to, cost } of intents) {
      if (blocked.has(pr.id)) { budget[pr.id] = 0; continue; }
      budget[pr.id] -= cost;
      const from = pr.node;
      pr.node = to;
      L(3, `[${pr.owner}] ${progName(pr)} 이동 ${nodeName(from)} → ${nodeName(pr.node)}${cost === 1 ? ' (고속 링크)' : ''}`, pr.owner, 'atk');
      if (isEnemyNode(s, pr.node, pr.owner)) {
        if (!stealthy(pr)) L(3, `[${other(pr.owner)}] 경보: 적 ${PROG_SPECS[pr.kind].name} 프로그램이 ${nodeName(pr.node)}에 진입`, other(pr.owner), 'warn');
        const hp = s.ices.find((i) => i.node === pr.node && i.owner === other(pr.owner) && i.kind === 'honeypot' && !i.compiling);
        const blk = isBlocking(s, pr.node, pr.owner);
        if (hp) { honeyHits.push({ prog: pr, ice: hp }); budget[pr.id] = 0; }
        else if (blk) {
          budget[pr.id] = 0;
          if (stealthy(pr)) L(3, `[${pr.owner}] ${progName(pr)} 은신 상태로 ${blk === 'gate' ? '게이트' : '벌워크'} 우회 중 (통과에 1턴 추가)`, pr.owner, 'atk');
          else L(3, `[${pr.owner}] ${progName(pr)} ${nodeName(pr.node)}의 ${blk === 'gate' ? '게이트' : '벌워크'}에 막혀 정지`, pr.owner, 'atk');
        }
      }
    }
  }
  updateDetection(s);
  for (const pr of s.programs) if (pr.kind === 'shade' && pr.detected) L(3, `[${pr.owner}] ${progName(pr)} 랜턴 범위 안 — 은신 해제됨 (${nodeName(pr.node)})`, 'all', 'warn');

  // ④ 교전 (동시 피해 계산 후 일괄 적용)
  const dmgIce: Record<number, number> = {}, dmgProg: Record<number, number> = {}, dmgNode: Record<string, number> = {};
  const killer: Record<number, Player> = {}; // ICE(하운드)가 처치 → 역컴파일 보상
  const progKiller: Record<number, Player> = {}; // 링크 교전으로 처치 (보상 없음)
  const siphoning: Program[] = [];
  const prioBy: Record<string, IceKind[]> = {
    auger: ['bulwark', 'hound', 'lantern', 'honeypot'],
    shade: ['hound', 'lantern', 'bulwark', 'honeypot'],
    siphon: ['bulwark', 'lantern', 'hound', 'honeypot'],
  };
  // 링크 교전: 마주친 프로그램끼리 서로 공격력 × linkCombatDmgPct% 피해 (상성표 없음) [기획 v0.3].
  // 한 프로그램이 여러 적과 마주치면 가장 낮은 번호의 상대를 공격 [기획 v0.3], 상대들은 모두 그 프로그램을 공격. 처치 보상 없음 [기획 v0.3].
  const linkFoe: Record<number, Program> = {};
  for (const [x, y] of encounters) {
    if (!linkFoe[x.id] || y.id < linkFoe[x.id].id) linkFoe[x.id] = y;
    if (!linkFoe[y.id] || x.id < linkFoe[y.id].id) linkFoe[y.id] = x;
  }
  for (const id of Object.keys(linkFoe).map(Number).sort((a, b) => a - b)) {
    const pr = s.programs.find((p) => p.id === id)!;
    const foe = linkFoe[id];
    const d = Math.floor((PROG_SPECS[pr.kind].atk * 10 * TUNING.linkCombatDmgPct) / 100);
    if (d <= 0) continue;
    dmgProg[foe.id] = (dmgProg[foe.id] ?? 0) + d;
    progKiller[foe.id] = pr.owner;
    L(4, `링크 교전: ${progName(pr)}[${pr.owner}] → ${progName(foe)}[${foe.owner}]: ${PROG_SPECS[pr.kind].atk} × ${TUNING.linkCombatDmgPct / 100} = ${fmt(d)} 피해`, 'all', 'atk');
  }
  for (const pr of [...s.programs].sort((a, b) => a.id - b.id)) {
    if (stunnedNow.has(pr.id) || honeyHits.some((h) => h.prog === pr) || engaged.has(pr.id)) continue;
    if (!isEnemyNode(s, pr.node, pr.owner)) continue;
    const atTarget = pr.target === pr.node;
    if (!atTarget && canLeave(s, pr)) continue; // 통과 중
    const spec = PROG_SPECS[pr.kind];
    const n = s.nodes[pr.node];
    // 컴파일 중인 ICE는 아직 존재하지 않는 것으로 취급 (§6.2 1턴 컴파일 지연) — 교전 대상이 아님
    const enemyIce = s.ices.filter((i) => i.node === pr.node && i.owner === other(pr.owner) && !i.compiling);
    if (pr.kind === 'siphon' && atTarget && n.kind === 'vault' && n.data > 0 && !activeIceAt(s, pr.node, other(pr.owner), 'bulwark').length) {
      siphoning.push(pr);
      continue;
    }
    let tgt: Ice | null = null;
    for (const k of prioBy[pr.kind]) {
      const c = enemyIce.filter((i) => i.kind === k).sort((a, b) => a.id - b.id)[0];
      if (c) { tgt = c; break; }
    }
    if (pr.kind === 'shade') pr.revealed = true;
    if (tgt) {
      const pct = MATCHUP[spec.cls][ICE_SPECS[tgt.kind].cls];
      let d = Math.floor((spec.atk * 10 * pct) / 100);
      // (G2) 오거가 코어 위 ICE를 칠 때 피해 일부가 코어 본체로 관통
      const pierce = pr.kind === 'auger' && n.kind === 'core' && s.options.augerPierceEnabled ? Math.floor((d * s.options.augerPiercePct) / 100) : 0;
      d -= pierce;
      dmgIce[tgt.id] = (dmgIce[tgt.id] ?? 0) + d;
      L(4, `${progName(pr)}[${pr.owner}] → ${iceName(tgt)}[${tgt.owner}] @ ${nodeName(pr.node)}: ${spec.atk} × ${pct / 100} = ${fmt(d + pierce)} 피해${pierce ? ` (G2 관통: ICE ${fmt(d)} / 코어 ${fmt(pierce)})` : ''}${pctNote(pct)}`, 'all', 'atk');
      if (pierce) {
        const pd = s.options.coreDirectDamageEnabled ? Math.floor((pierce * s.options.coreDirectDamagePct) / 100) : pierce;
        dmgNode[n.id] = (dmgNode[n.id] ?? 0) + pd;
        L(4, `${progName(pr)}[${pr.owner}] 관통 → 코어 ${nodeName(n.id)}: ${fmt(pierce)}${s.options.coreDirectDamageEnabled ? ` × ${s.options.coreDirectDamagePct / 100} (코어 직접 피해 보너스)` : ''} = ${fmt(pd)} 피해 (G2)`, 'all', 'atk');
      }
    } else {
      const pct = spec.cls === 'brute' ? TUNING.bruteVsNodePct : spec.cls === 'viral' ? TUNING.viralVsNodePct : 100;
      let d = Math.floor((spec.atk * 10 * pct) / 100);
      // (B) 코어 직접 피해 보너스: 코어 본체에만, 상성·노드 배율 뒤에 곱함
      const coreBonus = n.kind === 'core' && s.options.coreDirectDamageEnabled;
      if (coreBonus) d = Math.floor((d * s.options.coreDirectDamagePct) / 100);
      dmgNode[n.id] = (dmgNode[n.id] ?? 0) + d;
      L(4, `${progName(pr)}[${pr.owner}] → 노드 ${nodeName(n.id)}: ${spec.atk} × ${pct / 100}${coreBonus ? ` × ${s.options.coreDirectDamagePct / 100} (코어 직접 피해 보너스)` : ''} = ${fmt(d)} 피해`, 'all', 'atk');
    }
  }
  for (const h of s.ices.filter((i) => i.kind === 'hound' && !i.compiling).sort((a, b) => a.id - b.id)) {
    for (const pr of s.programs.filter((x) => x.node === h.node && x.owner !== h.owner).sort((a, b) => a.id - b.id)) {
      if (stealthy(pr)) { L(4, `${progName(pr)}: ${iceName(h)}가 은신 상태를 보지 못함 (스텔스 유리 상성)`, pr.owner, 'atk'); continue; }
      const cls = PROG_SPECS[pr.kind].cls;
      const pct = pr.kind === 'shade' ? TUNING.detectedShadeVsHoundRecvPct : receivedPct(cls, 'active');
      const d = Math.floor((ICE_SPECS.hound.dmg * 10 * pct) / 100);
      dmgProg[pr.id] = (dmgProg[pr.id] ?? 0) + d;
      killer[pr.id] = h.owner;
      L(4, `${iceName(h)}[${h.owner}] → ${progName(pr)}[${pr.owner}] @ ${nodeName(h.node)}: ${ICE_SPECS.hound.dmg} × ${pct / 100} = ${fmt(d)} 피해${pctNote(pct === 150 ? 50 : pct === 50 ? 150 : 100)}`, 'all', 'def');
    }
  }
  for (const ice of [...s.ices]) {
    if (!dmgIce[ice.id]) continue;
    ice.hp -= dmgIce[ice.id];
    if (ice.hp <= 0) { s.ices = s.ices.filter((i) => i !== ice); L(4, `${iceName(ice)}[${ice.owner}] 파괴됨 (${nodeName(ice.node)})`, 'all', 'warn'); }
    else L(4, `${iceName(ice)}[${ice.owner}] 남은 HP ${fmt(ice.hp)}`, 'all');
  }
  for (const pr of [...s.programs]) {
    if (!dmgProg[pr.id]) continue;
    pr.hp -= dmgProg[pr.id];
    if (pr.hp <= 0) {
      s.programs = s.programs.filter((x) => x !== pr);
      const k = killer[pr.id];
      if (k) {
        s.players[k].pendingReward += TUNING.killReward;
        L(4, `${progName(pr)}[${pr.owner}] 삭제됨 → [${k}] 역컴파일 보상 CYC +${TUNING.killReward}`, 'all', 'warn');
      } else L(4, `${progName(pr)}[${pr.owner}] 링크 교전에서 삭제됨`, 'all', 'warn');
    } else L(4, `${progName(pr)}[${pr.owner}] 남은 HP ${fmt(pr.hp)}`, 'all');
  }
  for (const nid of Object.keys(dmgNode).sort()) {
    const n = s.nodes[nid];
    const before = n.destroyed ? 0 : n.hp;
    damageNode(s, nid, dmgNode[nid], L);
    // (E1) 코어 본체에 프로그램이 실제로 깎은 HP를 공격자 누적에 더하고, 20마다 데이터 +2 (최대 +10)
    if (n.kind === 'core' && breachDataOn(s) && n.owner) {
      const atk = other(n.owner);
      const ps = s.players[atk];
      ps.coreDmgDealt += before - n.hp;
      const due = breachDataFor(s, ps.coreDmgDealt) - ps.breachData;
      if (due > 0) {
        ps.breachData += due;
        const timeOnly = s.options.breachTimeOnlyEnabled;
        if (!timeOnly) ps.data += due; // E1': 데이터 승리에는 넣지 않고 시간 판정 점수에만
        L(4, `[${atk}] 코어 브리치 데이터 +${due / 2} (E1${timeOnly ? "'" : ''}: 누적 코어 피해 ${fmt(ps.coreDmgDealt)} → 브리치 데이터 ${ps.breachData / 2}/${s.options.coreBreachDataMax}${timeOnly ? ' — 20턴 시간 판정 점수에만 반영' : `, 총 데이터 ${ps.data / 2}`})`, 'all', 'atk');
      }
    }
  }

  // ⑤ 특수 효과 (탈취, 허니팟)
  for (const pr of siphoning) {
    const n = s.nodes[pr.node];
    if (n.destroyed || n.data <= 0 || !s.programs.includes(pr)) continue;
    const amt = Math.min(n.data, siphonAmt2(s.options));
    n.data -= amt;
    s.players[pr.owner].data += amt;
    s.players[pr.owner].vaultData += amt;
    L(5, `${progName(pr)}[${pr.owner}] ${nodeName(n.id)}에서 데이터 ${amt / 2}점 탈취 (금고 잔량 ${n.data / 2}, ${pr.owner} 데이터 ${s.players[pr.owner].data / 2})`, 'all', 'atk');
  }
  const honeyHeat: Record<Player, number> = { A: 0, B: 0 };
  for (const h of honeyHits) {
    if (!s.programs.includes(h.prog)) continue;
    h.prog.stunned = 1;
    honeyHeat[h.prog.owner] += TUNING.heatHoneypot;
    if (s.ices.includes(h.ice)) {
      s.ices = s.ices.filter((i) => i !== h.ice);
      s.players[h.prog.owner].scouted[h.ice.node] = { turn: s.turn, ice: s.ices.filter((i) => i.node === h.ice.node && i.owner === h.ice.owner).map((i) => i.kind), fakeVault: false, vaultSignal: false, contact: true };
    }
    L(5, `허니팟 발동! ${progName(h.prog)}[${h.prog.owner}]가 ${nodeName(h.ice.node)}의 가짜 금고에 걸림 → 다음 턴 정지, ${h.prog.owner} 노출도 +${TUNING.heatHoneypot}`, 'all', 'warn');
  }

  // (C) 서든데스: ⑤ 교전·특수효과 이후, ⑦ 수입 이전에 양쪽 코어 고정 피해
  const sd = suddenDeathDmg(s, s.turn);
  if (sd > 0) {
    if (s.suddenDeathReachedTurn === null) s.suddenDeathReachedTurn = s.turn; // [기획 v0.3.1] 기록
    if (s.turn === s.options.suddenDeathStartTurn && s.options.suddenDeathRevealFog) L(5, `⚠ 서든데스 개시 (T${s.turn}) — 안개 해제: 양쪽 성채의 ICE가 모두 공개됨`, 'all', 'warn');
    L(5, `⚠ 서든데스: 양쪽 코어 고정 피해 ${sd} (다음 턴 ${sd + s.options.suddenDeathCoreDmgStep})`, 'all', 'warn');
    for (const p of PLAYERS) damageNode(s, p + 'C', sd * 10, L, 5);
  }

  // ⑥ 트레이스·노출도
  for (const p of PLAYERS) {
    const ps = s.players[p];
    const reasons: string[] = [];
    let gain = 0;
    for (const pr of s.programs.filter((x) => x.owner === p).sort((a, b) => a.id - b.id)) {
      if (pr.kind === 'auger') { gain += TUNING.heatBrutePerTurn; reasons.push(`${progName(pr)} 브루트 활동 +${TUNING.heatBrutePerTurn}`); }
      const lit = s.ices.some((i) => i.kind === 'lantern' && !i.compiling && i.owner === other(p) && HOPS[i.node][pr.node] <= TUNING.lanternRange);
      if (lit) {
        const g = Math.floor((TUNING.heatInWatchRange * (PROG_SPECS[pr.kind].cls === 'brute' ? 150 : 100)) / 100);
        gain += g; reasons.push(`${progName(pr)} 감시 범위 +${g}`);
      }
    }
    if (overclocked[p]) { gain += TUNING.heatOverclock; reasons.push(`오버클럭 +${TUNING.heatOverclock}`); }
    if (honeyHeat[p]) { gain += honeyHeat[p]; reasons.push(`허니팟 +${honeyHeat[p]}`); }
    const before = ps.heat;
    const raised = Math.min(TUNING.heatMax, ps.heat + gain);
    if (raised >= TUNING.heatMax) {
      const killed = s.programs.filter((x) => x.owner === p);
      s.programs = s.programs.filter((x) => x.owner !== p);
      const relays = Object.values(s.nodes).filter((n) => n.owner === p && n.kind === 'relay').map((n) => n.id).sort();
      const relay = relays.find((r) => r.endsWith('R2') && !s.nodes[r].destroyed) ?? relays.find((r) => !s.nodes[r].destroyed) ?? relays[1];
      s.players[other(p)].breach = { relay, turns: s.turn + TUNING.tracebackBreachTurns };
      ps.heat = TUNING.heatAfterTraceback;
      ps.tracebacks++;
      L(6, `★ 역추적(TRACEBACK)! [${p}] 노출도 ${before} → 100${reasons.length ? ` (${reasons.join(', ')})` : ''}. ${p}의 작동 중 프로그램 ${killed.length}개 전원 삭제${killed.length ? `(${killed.map(progName).join(', ')})` : ''}, [${other(p)}]가 ${nodeName(relay)}에 무료 침투 링크 획득(${TUNING.tracebackBreachTurns}턴, 그 릴레이에서 바로 발사 가능). 노출도 ${TUNING.heatAfterTraceback}으로 리셋`, 'all', 'warn');
    } else {
      ps.heat = Math.max(0, raised - TUNING.heatDecay);
      if (before !== ps.heat || gain) L(6, `[${p}] 노출도 ${before} → ${ps.heat}${reasons.length ? ` (${reasons.join(', ')}` : ' ('}${reasons.length ? ', ' : ''}자연 감소 -${TUNING.heatDecay})${stageNote(ps.heat)}`, p, ps.heat >= TUNING.heatDetected ? 'warn' : 'info');
    }
  }

  // ⑦ 컴파일 활성화 · 점령 · 수입 정산
  for (const ice of s.ices) if (ice.compiling) { ice.compiling = false; L(7, `[${ice.owner}] ${iceName(ice)} 활성화 @ ${nodeName(ice.node)}`, ice.owner, 'def'); }
  for (const n of Object.values(s.nodes).filter((x) => x.kind === 'neutral').sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const here = new Set(s.programs.filter((x) => x.node === n.id).map((x) => x.owner));
    if (here.size === 1) {
      const p = [...here][0];
      if (n.owner !== p) { n.owner = p; L(7, `[${p}] ${nodeName(n.id)} 점령 (CYC +1/턴, 데이터 +0.5/턴, 이동 보너스)`, 'all', 'atk'); }
    } else if (here.size === 2) L(7, `${nodeName(n.id)} 쟁탈 중 — 점령 변화 없음`, 'all');
  }
  for (const p of PLAYERS) {
    const ps = s.players[p];
    if (!setup) {
      const inc = income(s, p) + ps.pendingReward;
      const before = ps.cyc;
      ps.cyc = Math.min(TUNING.cycCap, ps.cyc + inc);
      L(7, `[${p}] 수입 +${inc}${ps.pendingReward ? ` (역컴파일 +${ps.pendingReward} 포함)` : ''} → CYC ${before} → ${ps.cyc}${before + inc > TUNING.cycCap ? ` (상한 ${TUNING.cycCap} 초과분 소멸)` : ''}`, p, 'info');
    } else {
      const inc = income(s, p);
      ps.cyc = Math.min(TUNING.cycCap, ps.cyc + inc);
      L(7, `[${p}] 구축 완료. 1턴 수입 +${inc} → CYC ${ps.cyc}`, p, 'info');
    }
    ps.pendingReward = 0;
    // (A) ICE 유지비: ⑦ 수입 정산 직후 차감. 부족하면 가장 최근 대상 ICE부터 환급 없이 강제 회수
    const per = setup ? 0 : upkeepPerIce(s, s.turn);
    if (per > 0) {
      const reclaimed: Ice[] = [];
      let list = upkeepIces(s, p);
      while (list.length && ps.cyc < per * list.length) {
        const newest = [...list].sort((x, y) => y.seq - x.seq)[0];
        s.ices = s.ices.filter((i) => i !== newest);
        reclaimed.push(newest);
        list = upkeepIces(s, p);
      }
      const cost = per * list.length;
      const before = ps.cyc;
      ps.cyc -= cost;
      if (cost || reclaimed.length) L(7, `[${p}] ICE 유지비: ${list.length}개 × ${per} = ${cost} CYC (CYC ${before} → ${ps.cyc})${reclaimed.length ? ` — CYC 부족으로 ${reclaimed.map((i) => `${iceName(i)}@${nodeName(i.node)}`).join(', ')} 환급 없이 강제 회수` : ''}`, p, reclaimed.length ? 'warn' : 'info');
    }
    const neut = Object.values(s.nodes).filter((n) => n.kind === 'neutral' && n.owner === p).length;
    if (neut && !setup) {
      const g = neutralDataGain(s, p, neut);
      ps.data += g.gain; ps.neutralData += g.gain;
      L(7, `[${p}] 중립 노드 ${neut}개 보유 → 데이터 +${g.gain / 2}${g.note ? ` (원래 +${g.raw / 2}, ${g.note})` : ''} (총 ${ps.data / 2}, 중립 누적 ${ps.neutralData / 2})`, 'all', g.note ? 'warn' : 'info');
    }
    if (ps.breach && s.turn >= ps.breach.turns) { L(7, `[${p}] ${nodeName(ps.breach.relay)} 침투 링크 만료`, 'all'); ps.breach = null; }
  }
  for (const n of Object.values(s.nodes)) {
    if (n.kind === 'processor' && n.destroyed && n.offlineTurns > 0) {
      n.offlineTurns--;
      if (n.offlineTurns === 0) { n.destroyed = false; n.hp = TUNING.processorRestoreHp * 10; L(7, `[${n.owner}] ${nodeName(n.id)} 재가동 (HP ${TUNING.processorRestoreHp})`, 'all', 'info'); }
    }
  }
  for (const p of PLAYERS) {
    const ps = s.players[p];
    const core = s.nodes[p + 'C'];
    if (!ps.emergencyUsed && !core.destroyed && core.hp * 100 <= core.maxHp * TUNING.emergencyCoreHpPct) {
      ps.emergencyUsed = true;
      for (let k = 0; k < TUNING.emergencyBulwarks; k++) {
        s.ices.push({ id: s.nextId, kind: 'bulwark', owner: p, node: core.id, hp: ICE_SPECS.bulwark.hp * 10, compiling: false, free: true, seq: s.nextId });
        s.nextId++;
      }
      L(7, `[${p}] 비상 프로토콜! 코어 HP ${TUNING.emergencyCoreHpPct}% 이하 → 무료 벌워크 ${TUNING.emergencyBulwarks}개 즉시 활성화`, 'all', 'def');
    }
    // BW 상한 초과 → 가장 최근 유닛부터 정지(삭제)
    const cap = bwCap(s, p);
    while (bwUse(s, p).total > cap) {
      const units = [
        ...s.ices.filter((i) => i.owner === p && !i.free && ICE_SPECS[i.kind].bw > 0).map((i) => ({ seq: i.seq, ice: i as Ice | null, pr: null as Program | null })),
        ...s.programs.filter((x) => x.owner === p).map((x) => ({ seq: x.seq, ice: null as Ice | null, pr: x as Program | null })),
      ].sort((a, b) => b.seq - a.seq);
      const u = units[0];
      if (!u) break;
      if (u.ice) { s.ices = s.ices.filter((i) => i !== u.ice); L(7, `[${p}] BW 상한(${cap}) 초과 → ${iceName(u.ice)} 정지`, p, 'warn'); }
      else if (u.pr) { s.programs = s.programs.filter((x) => x !== u.pr); L(7, `[${p}] BW 상한(${cap}) 초과 → ${progName(u.pr)} 정지`, p, 'warn'); }
    }
    // 접촉 정찰: 내 프로그램이 있는 적 노드의 ICE는 보인다
    for (const pr of s.programs.filter((x) => x.owner === p)) {
      if (isEnemyNode(s, pr.node, p)) ps.scouted[pr.node] = { turn: s.turn, ice: s.ices.filter((i) => i.node === pr.node && i.owner === other(p)).map((i) => i.kind), fakeVault: false, vaultSignal: false, contact: true };
    }
    const use = bwUse(s, p);
    if (!setup) ps.bwHistory.push({ atk: use.atk, def: use.def });
  }
  checkWin(s, L);
  s.turnLogs.push({ turn: s.turn, log });
  if (!s.over) s.turn++;
  return s;
}

function pctNote(pct: number) { return pct > 100 ? ' (유리 상성)' : pct < 100 ? ' (불리 상성)' : ''; }
function stageNote(h: number) {
  if (h >= TUNING.heatTracking) return ' — 추적 중: 철수 비용 발생';
  if (h >= TUNING.heatDetected) return ' — 감지됨: 상대에게 릴레이·ICE 개수 공개';
  return '';
}

function damageNode(s: MatchState, nid: string, d: number, L: (step: number, text: string, vis?: LogEntry['vis'], kind?: LogEntry['kind']) => void, step = 4) {
  const n = s.nodes[nid];
  if (n.destroyed) return;
  n.hp = Math.max(0, n.hp - d);
  if (n.kind === 'core' && n.owner) { const ps = s.players[n.owner as Player]; ps.minCoreHp = Math.min(ps.minCoreHp, n.hp); } // [기획 v0.3.1] 기록
  if (n.kind === 'gate' && n.hp === 0) { // [기획 v0.3.1] 기록: 첫 게이트 파괴 턴 (같은 턴에 여러 개면 모두)
    if (!s.firstGateBreak) s.firstGateBreak = { turn: s.turn, gates: [nid] };
    else if (s.firstGateBreak.turn === s.turn) s.firstGateBreak.gates.push(nid);
  }
  if (n.hp > 0) { L(step, `${nodeName(nid)} 남은 HP ${fmt(n.hp)}`, 'all'); return; }
  n.destroyed = true;
  const lost = s.ices.filter((i) => i.node === nid);
  s.ices = s.ices.filter((i) => i.node !== nid);
  let extra = '';
  if (n.kind === 'processor') { n.offlineTurns = TUNING.processorOfflineTurns; extra = ` — ${TUNING.processorOfflineTurns}턴간 수입 중단`; }
  if (n.kind === 'vault') { extra = ` — 남은 데이터 ${n.data / 2}점 소실`; n.data = 0; }
  if (n.kind === 'relay') extra = ` — ${n.owner}의 BW 상한 -${TUNING.bwPerRelay}`;
  if (n.kind === 'gate') extra = ' — 성문 개방, 안쪽 경로 열림';
  if (n.kind === 'core') extra = ' — 코어 붕괴!';
  L(step, `◆ ${nodeName(nid)} 파괴${extra}${lost.length ? ` (설치된 ICE ${lost.length}개 소멸)` : ''}`, 'all', 'warn');
}

function checkWin(s: MatchState, L: (step: number, text: string, vis?: LogEntry['vis'], kind?: LogEntry['kind']) => void) {
  const a = s.players.A, b = s.players.B;
  const coreA = s.nodes.AC.destroyed, coreB = s.nodes.BC.destroyed;
  const tiebreak = (sa: number, sb: number): Player | 'draw' => (sa !== sb ? (sa > sb ? 'A' : 'B') : a.heat !== b.heat ? (a.heat < b.heat ? 'A' : 'B') : 'draw');
  let w: Player | 'draw' | null = null;
  let reason: MatchState['winReason'] = null;
  if (coreA || coreB) {
    reason = 'core';
    w = coreA && coreB ? tiebreak(a.data, b.data) : coreA ? 'B' : 'A';
  } else if (a.data >= dataWinTarget(s) * 2 || b.data >= dataWinTarget(s) * 2) {
    reason = 'data';
    const goal = dataWinTarget(s) * 2;
    w = a.data >= goal && b.data >= goal ? tiebreak(a.data, b.data) : a.data >= goal ? 'A' : 'B';
  } else if (s.turn >= TUNING.maxTurns) {
    reason = 'time';
    w = tiebreak(timeScore(s, 'A'), timeScore(s, 'B'));
    if (s.options.breachTimeOnlyEnabled) {
      // E1': 브리치 점수가 시간 판정에 들어가므로 항목별로 보여 준다
      const part = (p: Player) => { const ps = s.players[p]; return `${timeScore(s, p) / 2}점 = 데이터 ${ps.data / 2} + 브리치 ${ps.breachData / 2} + 코어 ${(timeScore(s, p) - ps.data - ps.breachData) / 2}`; };
      L(7, `시간 종료 판정: A ${part('A')} vs B ${part('B')} (데이터 + 브리치(E1') + 코어 HP 10%당 0.5점)`, 'all', 'warn');
    } else L(7, `시간 종료 판정: A ${timeScore(s, 'A') / 2}점 vs B ${timeScore(s, 'B') / 2}점 (데이터 + 코어 HP 10%당 0.5점)`, 'all', 'warn');
  }
  if (reason) {
    s.over = true; s.winner = w; s.winReason = reason;
    L(7, `■ 경기 종료 — ${w === 'draw' ? '무승부' : `${w} 승리`} (${{ core: '코어 브리치', data: '데이터 탈취', time: '시간 종료', forfeit: '기권' }[reason]})`, 'all', 'warn');
  }
}
/** 시간 판정 점수 (×2 정수) */
export function timeScore(s: MatchState, p: Player): number {
  const core = s.nodes[p + 'C'];
  const breach = s.options.breachTimeOnlyEnabled ? s.players[p].breachData : 0; // E1': 브리치 데이터는 시간 판정에만
  return s.players[p].data + breach + Math.floor((core.hp * 10) / core.maxHp) * Math.round(TUNING.tieTimeBonusPer10PctCore * 2);
}

export function forfeit(s0: MatchState, p: Player): MatchState {
  const s = clone(s0);
  s.over = true; s.winner = other(p); s.winReason = 'forfeit';
  s.log = [{ step: 7, text: `[${p}] 기권 — ${other(p)} 승리`, vis: 'all', kind: 'warn' }];
  return s;
}

function updateDetection(s: MatchState) {
  for (const pr of s.programs) {
    if (pr.kind !== 'shade') continue;
    pr.detected = s.ices.some((i) => i.kind === 'lantern' && !i.compiling && i.owner !== pr.owner && HOPS[i.node][pr.node] <= TUNING.lanternRange);
  }
}

export function describeOrder(s: MatchState, o: Order): string {
  return withSocketNames(s, () => describeOrderInner(s, o));
}
function describeOrderInner(s: MatchState, o: Order): string {
  switch (o.type) {
    case 'setVaults': return `금고 지정: ${o.nodes.map(nodeName).join(', ')}`;
    case 'compile': return `${ICE_SPECS[o.ice].name} 컴파일 @ ${nodeName(o.node)} (${iceCyc(s.options, o.ice)} CYC)`;
    case 'recompile': { const i = s.ices.find((x) => x.id === o.iceId); return `회수 ${i ? iceName(i) : '#' + o.iceId}`; }
    case 'launch': return `${PROG_SPECS[o.prog].name} 발사 → ${nodeName(o.target)} (${PROG_SPECS[o.prog].cyc} CYC)`;
    case 'retarget': { const p = s.programs.find((x) => x.id === o.progId); return `${p ? progName(p) : '#' + o.progId} 목표 → ${nodeName(o.target)}`; }
    case 'jackout': { const p = s.programs.find((x) => x.id === o.progId); return `철수 ${p ? progName(p) : '#' + o.progId}`; }
    case 'repair': return `수리 ${nodeName(o.node)} (${TUNING.repairCost} CYC)`;
    case 'overclock': return `오버클럭 (+${TUNING.overclockCyc} CYC, 노출도 +${TUNING.heatOverclock})`;
  }
}

/** 디버그(검증용) — 순수 함수 */
export type DebugAction = 'heatSelf' | 'heatEnemy' | 'hitEnemyCore' | 'dataSelf' | 'skipToLastTurn' | 'skipToUpkeep' | 'skipToSuddenDeath';
export function debugApply(s0: MatchState, p: Player, a: DebugAction): MatchState {
  const s = clone(s0);
  const e = other(p);
  if (a === 'heatSelf') s.players[p].heat = Math.min(100, s.players[p].heat + 50);
  if (a === 'heatEnemy') s.players[e].heat = Math.min(100, s.players[e].heat + 50);
  if (a === 'hitEnemyCore') {
    const c = s.nodes[e + 'C'];
    c.hp = Math.max(0, c.hp - 400);
    s.players[e].minCoreHp = Math.min(s.players[e].minCoreHp, c.hp);
    const log: LogEntry[] = [{ step: 4, text: `[디버그] ${nodeName(c.id)} HP -40 → ${fmt(c.hp)}`, vis: 'all', kind: 'warn' }];
    if (c.hp === 0) {
      c.destroyed = true;
      s.ices = s.ices.filter((i) => i.node !== c.id);
      log.push({ step: 4, text: `◆ ${nodeName(c.id)} 파괴 — 코어 붕괴!`, vis: 'all', kind: 'warn' });
      checkWin(s, (step, text, vis = 'all', kind) => log.push({ step, text, vis, kind }));
    }
    s.log = log;
    s.turnLogs.push({ turn: s.turn, log });
  }
  if (a === 'dataSelf') s.players[p].data += 8;
  const from = s.turn;
  if (a === 'skipToLastTurn') s.turn = Math.max(s.turn, TUNING.maxTurns);
  if (a === 'skipToUpkeep') s.turn = Math.max(s.turn, s.options.iceUpkeepStartTurn);
  if (a === 'skipToSuddenDeath') s.turn = Math.max(s.turn, s.options.suddenDeathStartTurn);
  if (s.turn !== from) (s.debugJumps ??= []).push({ from, to: s.turn });
  return s;
}
