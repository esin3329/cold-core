import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES, SIEGER_COMMIT_TURN } from '../src/sim/ai';
import { SIEGE_PRESSURE } from '../src/sim/config';
import { resolveTurn, suddenDeathDmg, timeScore } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { MatchState, Order } from '../src/sim/types';

const playing = (opts = {}) => { const s = resolveTurn(createMatch(opts), [], []); s.ices = []; return s; };
function siphonAt(s: MatchState, node: string) {
  const id = s.nextId++;
  s.programs.push({ id, kind: 'siphon', owner: 'A', node, target: node, hp: 80, stunned: 0, detected: false, revealed: false, seq: id });
}
const BASE07 = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true, coreBreachE2Enabled: true, breachTimeOnlyEnabled: true, augerPierceStrongEnabled: true, suddenDeathEarlyEnabled: true };

describe('v0.7 기본값', () => {
  it("V1·V2·C'' 기본 off, 예시 수치", () => {
    expect([SIEGE_PRESSURE.vaultDataReducedEnabled, SIEGE_PRESSURE.siphonSlowEnabled, SIEGE_PRESSURE.suddenDeathGentleEnabled]).toEqual([false, false, false]);
    expect([SIEGE_PRESSURE.vaultDataReduced, SIEGE_PRESSURE.siphonSlowHalfPerTurn, SIEGE_PRESSURE.suddenDeathGentleStep]).toEqual([3, 1, 2]);
  });
});

describe('(V1) 금고 데이터 3', () => {
  it('on: 금고 4개 모두 3점(내부 6), off: 4점(내부 8)', () => {
    const on = createMatch({ vaultDataReducedEnabled: true }), off = createMatch();
    for (const v of ['AV1', 'AV2', 'BV1', 'BV2']) { expect(on.nodes[v].data).toBe(6); expect(off.nodes[v].data).toBe(8); }
  });
  it('숨은 금고(H)와 함께: 지정한 소켓 금고도 3점', () => {
    const s = resolveTurn(createMatch({ vaultDataReducedEnabled: true, hiddenVaultsEnabled: true }), [{ type: 'setVaults', nodes: ['AR1', 'AR3'] } as Order], []);
    expect([s.nodes.AR1.data, s.nodes.AR3.data, s.nodes.AV1.data]).toEqual([6, 6, 0]);
  });
});

describe('(V2) 사이펀 0.5점/턴', () => {
  it('on: 한 턴에 내부 1(=0.5점), 정수 유지 / off: 내부 2', () => {
    for (const [on, amt] of [[true, 1], [false, 2]] as const) {
      let s = playing({ siphonSlowEnabled: on });
      siphonAt(s, 'BV1');
      const d0 = s.nodes.BV1.data;
      s = resolveTurn(s, [], []);
      expect(s.players.A.vaultData).toBe(amt);
      expect(d0 - s.nodes.BV1.data).toBe(amt);
      expect(Number.isInteger(s.players.A.data)).toBe(true);
      expect(s.log.some((l) => l.text.includes(`데이터 ${amt / 2}점 탈취`))).toBe(true);
    }
  });
  it('V1+V2: 금고 하나를 비우는 데 6턴', () => {
    let s = playing({ vaultDataReducedEnabled: true, siphonSlowEnabled: true });
    siphonAt(s, 'BV1');
    for (let i = 0; i < 6; i++) s = resolveTurn(s, [], []);
    expect([s.nodes.BV1.data, s.players.A.vaultData]).toEqual([0, 6]);
  });
});

describe('(V2) 0.5점 단위 일관성 — 내부 ×2 정수 하나로 탈취·데이터 승리·20턴 판정·로그가 같은 값을 쓴다', () => {
  it('11.5점 + 0.5 탈취 = 정확히 12점 → 데이터 승리 (반올림 없음)', () => {
    let s = playing({ siphonSlowEnabled: true });
    s.players.A.data = 23; // 11.5점
    siphonAt(s, 'BV1');
    s = resolveTurn(s, [], []);
    expect(s.players.A.data).toBe(24);
    expect([s.over, s.winReason, s.winner]).toEqual([true, 'data', 'A']);
    expect(s.log.some((l) => l.text.includes('데이터 0.5점 탈취') && l.text.includes('A 데이터 12)'))).toBe(true);
  });
  it('11점 + 0.5 탈취 = 11.5점 → 승리 아님 (12로 올림하지 않음)', () => {
    let s = playing({ siphonSlowEnabled: true });
    s.players.A.data = 22;
    siphonAt(s, 'BV1');
    s = resolveTurn(s, [], []);
    expect([s.players.A.data, s.over]).toEqual([23, false]);
  });
  it('20턴 판정: 0.5점 차이가 그대로 승부를 가르고 로그에 11.5로 표시', () => {
    let s = playing({ siphonSlowEnabled: true });
    s.turn = 20; s.players.A.data = 22; s.players.B.data = 22;
    siphonAt(s, 'BV1');
    s = resolveTurn(s, [], []);
    expect([s.winReason, s.winner]).toEqual(['time', 'A']);
    expect(timeScore(s, 'A') - timeScore(s, 'B')).toBe(1);
    const line = s.log.find((l) => l.text.startsWith('시간 종료 판정'))!.text;
    expect(line).toContain(`A ${timeScore(s, 'A') / 2}점`);
    expect(String(timeScore(s, 'A') / 2)).toMatch(/\.5$/);
  });
});

describe("(C'') 완만한 이른 서든데스", () => {
  it("C·C' 포함, T13부터 6, +2/턴 (합 104)", () => {
    const s = createMatch({ suddenDeathGentleEnabled: true });
    expect([s.options.suddenDeathEnabled, s.options.suddenDeathEarlyEnabled, s.options.suddenDeathStartTurn]).toEqual([true, true, 13]);
    const seq = [12, 13, 14, 15, 16, 17, 18, 19, 20].map((t) => suddenDeathDmg(s, t));
    expect(seq).toEqual([0, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(seq.reduce((a, b) => a + b, 0)).toBe(104);
    expect(suddenDeathDmg(createMatch({ suddenDeathEarlyEnabled: true }), 14)).toBe(9); // C'만이면 그대로 +3
  });
});

describe('AI 조기 공성 플래그 (측정 전용)', () => {
  it('플래그 없음 = 기존 AI 그대로 ({}와 동일한 명령)', () => {
    let s = createMatch(BASE07);
    for (let t = 0; t < 8 && !s.over; t++) {
      for (const st of AI_STYLES) expect(JSON.stringify(aiOrders(s, 'A', st, 7))).toBe(JSON.stringify(aiOrders(s, 'A', st, 7, {})));
      s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 7), aiOrders(s, 'B', 'balanced', 8));
    }
  });
  it(`공성형: T${SIEGER_COMMIT_TURN} 전에는 오거를 중립 노드에 모으거나 게이트로, T${SIEGER_COMMIT_TURN}부터는 모든 오거가 게이트(또는 열린 뒤 코어)를 향함`, () => {
    for (let seed = 0; seed < 10; seed++) {
      let s = createMatch(BASE07);
      while (!s.over && s.turn < SIEGER_COMMIT_TURN + 1) {
        const oa = aiOrders(s, 'A', 'sieger', seed, { siegerEarlyGate: true });
        if (s.turn >= 1 && s.turn < SIEGER_COMMIT_TURN) for (const o of oa) if (o.type === 'launch' && o.prog === 'auger') expect(['N1', 'N3', 'BG1', 'BG2', 'BC']).toContain(o.target);
        s = resolveTurn(s, oa, aiOrders(s, 'B', 'balanced', seed + 100));
      }
      if (s.over) continue;
      const oa = aiOrders(s, 'A', 'sieger', seed, { siegerEarlyGate: true });
      const s2 = resolveTurn(s, oa, []);
      for (const p of s2.programs.filter((x) => x.owner === 'A' && x.kind === 'auger')) expect(['BG1', 'BG2', 'BC']).toContain(p.target);
    }
  });
  it('다른 성향은 플래그와 무관', () => {
    let s = createMatch(BASE07);
    for (let t = 0; t < 6; t++) {
      for (const st of AI_STYLES.filter((x) => x !== 'sieger')) expect(JSON.stringify(aiOrders(s, 'B', st, 3, { siegerEarlyGate: true }))).toBe(JSON.stringify(aiOrders(s, 'B', st, 3)));
      s = resolveTurn(s, aiOrders(s, 'A', 'raider', 3), aiOrders(s, 'B', 'turtle', 4));
    }
  });
  it("결정론: 기준선+V1+V2+C'' + 조기 공성 두 번 = 동일", () => {
    const o = { ...BASE07, vaultDataReducedEnabled: true, siphonSlowEnabled: true, suddenDeathGentleEnabled: true };
    const run = () => { let s = createMatch(o); while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 9, { siegerEarlyGate: true }), aiOrders(s, 'B', 'thief', 4, { siegerEarlyGate: true })); return JSON.stringify(s); };
    expect(run()).toBe(run());
  });
});
