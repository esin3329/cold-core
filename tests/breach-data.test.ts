import { describe, expect, it } from 'vitest';
import { aiOrders } from '../src/sim/ai';
import { PROG_SPECS, SIEGE_ALL_OFF, SIEGE_PRESSURE, TUNING } from '../src/sim/config';
import { breachDataFor, resolveTurn } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { MatchState, Player } from '../src/sim/types';

const playing = (opts = {}) => { const s = resolveTurn(createMatch(opts), [], []); s.ices = []; return s; };
function augersAt(s: MatchState, owner: Player, node: string, k: number) {
  for (let i = 0; i < k; i++) {
    const id = s.nextId++;
    s.programs.push({ id, kind: 'auger', owner, node, target: node, hp: 120, stunned: 0, detected: false, revealed: false, seq: id });
  }
}
const perAuger = Math.floor((PROG_SPECS.auger.atk * 10 * TUNING.bruteVsNodePct) / 100); // ×10
const E1 = { coreBreachDataEnabled: true };

describe('(E1) 코어 브리치 데이터', () => {
  it('전체 off 프리셋에서 off (v0.3부터 기본값은 v03-defaults.test.ts), 예시 수치', () => {
    expect([SIEGE_ALL_OFF.coreBreachDataEnabled, SIEGE_ALL_OFF.coreBreachE2Enabled]).toEqual([false, false]);
    expect([SIEGE_PRESSURE.coreBreachDmgStep, SIEGE_PRESSURE.coreBreachDataPer, SIEGE_PRESSURE.coreBreachDataMax, SIEGE_PRESSURE.e2NeutralDataCap]).toEqual([20, 2, 10, 4]);
  });
  it('지급 공식: 누적 20 피해마다 +2, 최대 +10 (×2 단위)', () => {
    const s = createMatch(E1);
    expect([0, 199, 200, 399, 400, 999, 1000, 5000].map((d) => breachDataFor(s, d))).toEqual([0, 0, 4, 4, 8, 16, 20, 20]);
  });
  it('턴마다 누적 피해가 20 단위를 넘을 때만 +2씩 지급 (로그 포함)', () => {
    let s = playing(E1);
    augersAt(s, 'A', 'BC', 2);
    const expectData: number[] = [];
    let dealt = 0;
    for (let t = 0; t < 3; t++) {
      s = resolveTurn(s, [], []);
      dealt += 2 * perAuger;
      expectData.push(Math.floor(dealt / 200) * 4);
      expect(s.players.A.coreDmgDealt).toBe(dealt);
      expect(s.players.A.breachData).toBe(expectData[t]);
      expect(s.players.A.data).toBe(expectData[t]);
    }
    expect(s.log.some((l) => l.text.includes('코어 브리치 데이터 +2 (E1'))).toBe(true);
  });
  it('상한 +10, 상대가 코어를 수리해도 카운터는 줄지 않음', () => {
    let s = playing(E1);
    augersAt(s, 'A', 'BC', 3);
    for (let t = 0; t < 8; t++) {
      s = resolveTurn(s, [], []);
      s.nodes.BC.hp = s.nodes.BC.maxHp; // 매 턴 완전 수리했다고 가정
    }
    expect(s.players.A.coreDmgDealt).toBe(8 * 3 * perAuger);
    expect(s.players.A.breachData).toBe(20);
    expect(s.players.A.data).toBe(20);
    expect(s.over).toBe(false);
  });
  it('서든데스 고정 피해는 세지 않는다 [추정]', () => {
    let s = playing({ ...E1, suddenDeathEnabled: true });
    s.turn = 15;
    const hp0 = s.nodes.BC.hp;
    s = resolveTurn(s, [], []);
    expect(s.nodes.BC.hp).toBeLessThan(hp0);
    expect(s.players.A.coreDmgDealt).toBe(0);
    expect(s.players.A.data).toBe(0);
  });
  it('E1 데이터는 데이터 승리에 포함되고 D2 상한과 무관', () => {
    let s = playing({ ...E1, neutralDataCapEnabled: true });
    s.players.A.neutralData = 12; s.players.A.data = 22; // 중립 상한 도달 + 11점
    augersAt(s, 'A', 'BC', 3); // 27 피해 → +2
    s = resolveTurn(s, [], []);
    expect(s.players.A.breachData).toBe(4);
    expect([s.over, s.winner, s.winReason]).toEqual([true, 'A', 'data']);
  });
  it('off: 코어를 쳐도 데이터 없음', () => {
    let s = playing();
    augersAt(s, 'A', 'BC', 3);
    s = resolveTurn(s, [], []);
    expect(s.players.A.data).toBe(0);
    expect(s.players.A.coreDmgDealt).toBe(0);
  });
});

describe('(E2) E1 + 중립 상한 4', () => {
  it('중립 상한 4점(로그 E2) + 코어 브리치 데이터도 적용', () => {
    let s = playing({ coreBreachE2Enabled: true });
    for (const id of ['N1', 'N2', 'N3']) s.nodes[id].owner = 'A';
    for (let i = 0; i < 4; i++) s = resolveTurn(s, [], []);
    expect(s.players.A.neutralData).toBe(8);
    expect(s.log.some((l) => l.text.includes('상한 4점') && l.text.includes('(E2)'))).toBe(true);
    augersAt(s, 'A', 'BC', 3);
    s = resolveTurn(s, [], []);
    expect(s.players.A.breachData).toBe(4);
    expect(s.players.A.data).toBe(8 + 4);
  });
  it('D2를 같이 켜도 E2의 4점이 우선', () => {
    let s = playing({ coreBreachE2Enabled: true, neutralDataCapEnabled: true });
    for (const id of ['N1', 'N2', 'N3']) s.nodes[id].owner = 'B';
    for (let i = 0; i < 5; i++) s = resolveTurn(s, [], []);
    expect(s.players.B.neutralData).toBe(8);
  });
});

describe('결정론', () => {
  it('기준선+E2, 공성형 vs 돌격형 AI 두 번 = 동일, 정수', () => {
    const opts = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true, coreBreachE2Enabled: true };
    const run = () => { let s = createMatch(opts); while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 3), aiOrders(s, 'B', 'raider', 5)); return s; };
    const a = run(), b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const p of ['A', 'B'] as const) {
      expect(Number.isInteger(a.players[p].coreDmgDealt) && Number.isInteger(a.players[p].breachData)).toBe(true);
      expect(a.players[p].breachData).toBeLessThanOrEqual(20);
      expect(a.players[p].neutralData).toBeLessThanOrEqual(8);
    }
  });
});
