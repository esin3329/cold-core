import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { ICE_SPECS, MATCHUP, PROG_SPECS, SIEGE_ALL_OFF, SIEGE_PRESSURE } from '../src/sim/config';
import { iceSlots, planBudget, resolveTurn, suddenDeathDmg } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import { viewFor } from '../src/sim/view';
import type { IceKind, MatchState, Player } from '../src/sim/types';

const playing = (opts = {}) => { const s = resolveTurn(createMatch(opts), [], []); s.ices = []; return s; };
function addIce(s: MatchState, owner: Player, node: string, kind: IceKind) {
  const id = s.nextId++;
  s.ices.push({ id, kind, owner, node, hp: ICE_SPECS[kind].hp * 10, compiling: false, free: false, seq: id });
  return id;
}
function augersAt(s: MatchState, owner: Player, node: string, k: number) {
  for (let i = 0; i < k; i++) { const id = s.nextId++; s.programs.push({ id, kind: 'auger', owner, node, target: node, hp: 120, stunned: 0, detected: false, revealed: false, seq: id }); }
}
const vsBulwark = Math.floor((PROG_SPECS.auger.atk * 10 * MATCHUP.brute.wall) / 100);

describe('v0.6 기본값', () => {
  it("G2'·G3·C' 전체 off 프리셋에서 off (v0.3부터 기본값은 v03-defaults.test.ts), 예시 수치", () => {
    expect([SIEGE_ALL_OFF.augerPierceStrongEnabled, SIEGE_ALL_OFF.gateSlotsReducedEnabled, SIEGE_ALL_OFF.suddenDeathEarlyEnabled]).toEqual([false, false, false]);
    expect([SIEGE_PRESSURE.augerPierceStrongPct, SIEGE_PRESSURE.gateSlotsReduced, SIEGE_PRESSURE.suddenDeathEarlyStartTurn, SIEGE_PRESSURE.suddenDeathEarlyCoreDmg, SIEGE_PRESSURE.suddenDeathEarlyStep]).toEqual([75, 2, 13, 6, 3]);
    // 끄면 하위 옵션 값은 손대지 않음
    const s = createMatch();
    expect([s.options.augerPierceEnabled, s.options.augerPiercePct, s.options.suddenDeathEnabled, s.options.suddenDeathStartTurn, s.options.gateHpReducedEnabled]).toEqual([false, 50, false, 15, false]);
  });
});

describe("(G2') 관통 75%", () => {
  it('G2를 켜지 않아도 G2 포함, 피해의 75%가 코어 본체로', () => {
    let s = playing({ augerPierceStrongEnabled: true });
    expect([s.options.augerPierceEnabled, s.options.augerPiercePct]).toEqual([true, 75]);
    const b = addIce(s, 'B', 'BC', 'bulwark');
    augersAt(s, 'A', 'BC', 1);
    const c0 = s.nodes.BC.hp;
    s = resolveTurn(s, [], []);
    const p = Math.floor((vsBulwark * 75) / 100);
    expect(c0 - s.nodes.BC.hp).toBe(p);
    expect(s.ices.find((i) => i.id === b)!.hp).toBe(ICE_SPECS.bulwark.hp * 10 - (vsBulwark - p));
  });
});

describe('(G3) 게이트 슬롯 2 + HP 20', () => {
  it('G1 포함: 게이트 HP 20, 슬롯 2 (다른 노드 슬롯 그대로), 뷰에도 반영', () => {
    const s = createMatch({ gateSlotsReducedEnabled: true });
    expect(s.options.gateHpReducedEnabled).toBe(true);
    for (const g of ['AG1', 'AG2', 'BG1', 'BG2']) expect(s.nodes[g].maxHp).toBe(200);
    expect([iceSlots(s, 'gate'), iceSlots(s, 'core'), iceSlots(s, 'relay')]).toEqual([2, 2, 2]);
    expect(iceSlots(createMatch(), 'gate')).toBe(3);
    expect(viewFor(s, 'A').nodes.AG1.slots).toBe(2);
  });
  it('게이트에 3번째 ICE는 거절, off면 허용', () => {
    const three = [1, 2, 3].map(() => ({ type: 'compile' as const, ice: 'lantern' as const, node: 'AG1' }));
    expect(planBudget(createMatch({ gateSlotsReducedEnabled: true }), 'A', three).errors[2]).toContain('슬롯 부족 (2칸)');
    expect(planBudget(createMatch(), 'A', three).errors.filter(Boolean)).toEqual([]);
  });
  it('AI 구축 배치는 G3에서도 전부 유효 (모든 성향 × 시드)', () => {
    for (const st of AI_STYLES) for (let seed = -1; seed < 30; seed++) {
      const s = createMatch({ gateSlotsReducedEnabled: true });
      const o = aiOrders(s, 'A', st, seed);
      expect(planBudget(s, 'A', o).errors.filter(Boolean)).toEqual([]);
    }
  });
});

describe("(C') 이른 서든데스", () => {
  it('C 포함, T13부터 6, +3/턴 (13..20 합 132), C 수치 대체', () => {
    const s = createMatch({ suddenDeathEarlyEnabled: true });
    expect(s.options.suddenDeathEnabled).toBe(true);
    const seq = [12, 13, 14, 15, 16, 17, 18, 19, 20].map((t) => suddenDeathDmg(s, t));
    expect(seq).toEqual([0, 6, 9, 12, 15, 18, 21, 24, 27]);
    expect(seq.reduce((a, b) => a + b, 0)).toBe(132);
    // C와 함께 켜도 C'가 우선
    expect(suddenDeathDmg(createMatch({ suddenDeathEnabled: true, suddenDeathEarlyEnabled: true }), 14)).toBe(9);
  });
  it('T13 계획 단계에 안개 해제, T13 정산에서 양쪽 코어 -6, 안개 해제', () => {
    let s = playing({ suddenDeathEarlyEnabled: true });
    s.turn = 12;
    s = resolveTurn(s, [], []);
    expect(s.nodes.AC.hp).toBe(1000);
    expect(viewFor(s, 'A').fogLifted).toBe(true); // T13 계획 단계부터 안개 해제
    s = resolveTurn(s, [], []);
    expect([s.nodes.AC.hp, s.nodes.BC.hp]).toEqual([1000 - 60, 1000 - 60]);
    expect(s.log.some((l) => l.text.includes('서든데스 개시 (T13)'))).toBe(true);
  });
});

describe('v0.6 결정론', () => {
  it('기준선+G3+C\' AI 대전이 같은 입력에 같은 결과', () => {
    const opts = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true, coreBreachE2Enabled: true, breachTimeOnlyEnabled: true, augerPierceStrongEnabled: true, gateSlotsReducedEnabled: true, suddenDeathEarlyEnabled: true };
    const run = () => { let s = createMatch(opts); while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 7), aiOrders(s, 'B', 'turtle', 8)); return JSON.stringify([s.winner, s.winReason, s.turn, s.nodes.AC.hp, s.nodes.BC.hp]); };
    expect(run()).toBe(run());
  });
});
