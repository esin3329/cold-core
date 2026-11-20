import { describe, expect, it } from 'vitest';
import { aiOrders } from '../src/sim/ai';
import { ICE_SPECS, MATCHUP, PROG_SPECS, SIEGE_ALL_OFF, SIEGE_PRESSURE } from '../src/sim/config';
import { resolveTurn, timeScore } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
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

describe('v0.5 기본값', () => {
  it('G1·G2·E1\'·숨은 금고 전체 off 프리셋에서 off (v0.3부터 기본값은 v03-defaults.test.ts), 예시 수치', () => {
    expect([SIEGE_ALL_OFF.gateHpReducedEnabled, SIEGE_ALL_OFF.augerPierceEnabled, SIEGE_ALL_OFF.breachTimeOnlyEnabled, SIEGE_ALL_OFF.hiddenVaultsEnabled]).toEqual([false, false, false, false]);
    expect([SIEGE_PRESSURE.gateHpReduced, SIEGE_PRESSURE.augerPiercePct]).toEqual([20, 50]);
  });
});

describe('(G1) 게이트 HP 20', () => {
  it('on: 4개 게이트 HP/최대 HP 20, 다른 노드 그대로 / off: 30', () => {
    const on = createMatch({ gateHpReducedEnabled: true }), off = createMatch();
    for (const g of ['AG1', 'AG2', 'BG1', 'BG2']) { expect([on.nodes[g].hp, on.nodes[g].maxHp]).toEqual([200, 200]); expect(off.nodes[g].maxHp).toBe(300); }
    expect(on.nodes.AC.maxHp).toBe(off.nodes.AC.maxHp);
  });
});

describe('(G2) 오거 관통', () => {
  it('코어 위 벌워크를 치면 피해 절반이 코어 본체로 (로그), off면 전부 ICE', () => {
    for (const pierce of [true, false]) {
      let s = playing({ augerPierceEnabled: pierce });
      const b = addIce(s, 'B', 'BC', 'bulwark');
      augersAt(s, 'A', 'BC', 1);
      const core0 = s.nodes.BC.hp;
      s = resolveTurn(s, [], []);
      const p = pierce ? Math.floor(vsBulwark / 2) : 0;
      expect(s.ices.find((i) => i.id === b)!.hp).toBe(ICE_SPECS.bulwark.hp * 10 - (vsBulwark - p));
      expect(s.nodes.BC.hp).toBe(core0 - p);
      expect(s.log.some((l) => l.text.includes('(G2)'))).toBe(pierce);
    }
  });
  it('관통 피해는 E1 누적에 들어가고, 코어 아닌 노드(게이트)·오거 아닌 프로그램은 관통 없음', () => {
    let s = playing({ augerPierceEnabled: true, coreBreachDataEnabled: true });
    addIce(s, 'B', 'BC', 'bulwark'); addIce(s, 'B', 'BG1', 'bulwark');
    augersAt(s, 'A', 'BC', 1); augersAt(s, 'A', 'BG1', 1);
    const g0 = s.nodes.BG1.hp;
    s = resolveTurn(s, [], []);
    expect(s.players.A.coreDmgDealt).toBe(Math.floor(vsBulwark / 2));
    expect(s.nodes.BG1.hp).toBe(g0);
  });
  it('B(코어 ×2)와 함께면 관통분에도 ×2 [추정]', () => {
    let s = playing({ augerPierceEnabled: true, coreDirectDamageEnabled: true });
    addIce(s, 'B', 'BC', 'bulwark');
    augersAt(s, 'A', 'BC', 1);
    const c0 = s.nodes.BC.hp;
    s = resolveTurn(s, [], []);
    expect(c0 - s.nodes.BC.hp).toBe(Math.floor(vsBulwark / 2) * 2);
  });
});

describe("(E1') 브리치 데이터는 시간 판정에만", () => {
  it('데이터 점수에 더하지 않아 11점+브리치 2점이어도 데이터 승리 아님, 시간 점수에는 포함', () => {
    let s = playing({ coreBreachDataEnabled: true, breachTimeOnlyEnabled: true });
    s.players.A.data = 22;
    augersAt(s, 'A', 'BC', 3);
    s = resolveTurn(s, [], []);
    expect(s.players.A.breachData).toBe(4);
    expect(s.players.A.data).toBe(22);
    expect(s.over).toBe(false);
    expect(timeScore(s, 'A') - timeScore((() => { const t = structuredClone(s); t.players.A.breachData = 0; return t; })(), 'A')).toBe(4);
    expect(s.log.some((l) => l.text.includes("E1'") && l.text.includes('시간 판정'))).toBe(true);
  });
  it('20턴 시간 판정에서 브리치 데이터가 승부를 가른다', () => {
    let s = playing({ coreBreachDataEnabled: true, breachTimeOnlyEnabled: true });
    s.turn = 20; s.players.A.data = 10; s.players.B.data = 10; s.players.A.breachData = 4;
    s = resolveTurn(s, [], []);
    expect([s.winReason, s.winner]).toEqual(['time', 'A']);
  });
  it('E1\' 없이 E1만이면 기존대로 데이터에 합산', () => {
    let s = playing({ coreBreachDataEnabled: true });
    augersAt(s, 'A', 'BC', 3);
    s = resolveTurn(s, [], []);
    expect(s.players.A.data).toBe(4);
  });
});

describe('결정론 (v0.5 기준선 + G1 + G2)', () => {
  it('공성형 vs 탈취형 두 번 = 동일', () => {
    const o = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true, coreBreachE2Enabled: true, breachTimeOnlyEnabled: true, gateHpReducedEnabled: true, augerPierceEnabled: true };
    const run = () => { let s = createMatch(o); while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 9), aiOrders(s, 'B', 'thief', 4)); return s; };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
