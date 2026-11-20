import { describe, expect, it } from 'vitest';
import { aiOrders } from '../src/sim/ai';
import { ICE_SPECS, SIEGE_PRESSURE } from '../src/sim/config';
import { describeOrder, iceCyc, planBudget, resolveTurn } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { Order } from '../src/sim/types';

const hound = (node: string): Order => ({ type: 'compile', ice: 'hound', node });

describe('하운드 비용 4 → 5 [기획 v0.3 측정]', () => {
  it('기본 off, 예시 수치 5', () => {
    expect([SIEGE_PRESSURE.houndCostRaisedEnabled, SIEGE_PRESSURE.houndCostRaised, ICE_SPECS.hound.cyc]).toEqual([false, 5, 4]);
    expect(iceCyc(createMatch().options, 'hound')).toBe(4);
    expect(iceCyc(createMatch({ houndCostRaisedEnabled: true }).options, 'hound')).toBe(5);
    for (const k of ['bulwark', 'lantern', 'honeypot'] as const) expect(iceCyc(createMatch({ houndCostRaisedEnabled: true }).options, k)).toBe(ICE_SPECS[k].cyc);
  });
  it('구축 예산·실제 차감·로그·명령 설명이 모두 5', () => {
    const on = createMatch({ houndCostRaisedEnabled: true }), off = createMatch();
    expect(planBudget(on, 'A', [hound('AG1')]).cyc).toBe(30 - 5);
    expect(planBudget(off, 'A', [hound('AG1')]).cyc).toBe(30 - 4);
    expect(describeOrder(on, hound('AG1'))).toContain('(5 CYC)');
    const s = resolveTurn(on, [hound('AG1')], []);
    expect(s.log.some((l) => l.text.includes('하운드') && l.text.includes('CYC -5'))).toBe(true);
    // 구축 30 - 5 = 25 → 1턴 수입(10) 후 상한 30 이내
    expect(s.players.A.cyc).toBe(Math.min(30, 25 + 10));
  });
  it('구축 30 CYC: on이면 하운드 6개(30)까지, 7번째는 CYC 부족 / off면 7개(28)도 가능', () => {
    const seven = ['AG1', 'AG1', 'AG1', 'AG2', 'AG2', 'AG2', 'AC'].map(hound);
    const on = planBudget(createMatch({ houndCostRaisedEnabled: true }), 'A', seven);
    expect(on.errors.slice(0, 6).filter(Boolean)).toEqual([]);
    expect(on.errors[6]).toBeTruthy();
    expect(planBudget(createMatch(), 'A', seven).errors.filter(Boolean)).toEqual([]);
  });
  it('회수 환급은 floor(5×50%) = 2 (4일 때와 같음)', () => {
    let s = resolveTurn(createMatch({ houndCostRaisedEnabled: true }), [hound('AG1')], []);
    const id = s.ices.find((i) => i.kind === 'hound' && i.owner === 'A')!.id;
    expect(planBudget(s, 'A', [{ type: 'recompile', iceId: id }]).cyc).toBe(s.players.A.cyc + 2);
  });
  it('AI 대전 결정론 (옵션 on)', () => {
    const o = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true, coreBreachE2Enabled: true, breachTimeOnlyEnabled: true, augerPierceStrongEnabled: true, suddenDeathEarlyEnabled: true, houndCostRaisedEnabled: true };
    const run = () => { let s = createMatch(o); while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 3), aiOrders(s, 'B', 'balanced', 4)); return JSON.stringify(s); };
    expect(run()).toBe(run());
  });
});
