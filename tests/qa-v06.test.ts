import { describe, expect, it } from 'vitest';
import { fillVaultPick, resolveTurn, timeScore } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { MatchState, Order } from '../src/sim/types';

const H = { hiddenVaultsEnabled: true };

describe('QA: 숨은 금고 시간 만료 자동 채움', () => {
  it('고른 소켓은 유지하고 빈 자리만 기본(소켓1·소켓3 → 소켓2·소켓4)으로', () => {
    expect(fillVaultPick('A', [])).toEqual({ nodes: ['AV1', 'AV2'], autoFilled: ['AV1', 'AV2'] });
    expect(fillVaultPick('A', ['AR1'])).toEqual({ nodes: ['AR1', 'AV1'], autoFilled: ['AV1'] });
    expect(fillVaultPick('A', ['AV1'])).toEqual({ nodes: ['AV1', 'AV2'], autoFilled: ['AV2'] });
    expect(fillVaultPick('B', ['BR3', 'BR1'])).toEqual({ nodes: ['BR1', 'BR3'], autoFilled: [] });
    expect(fillVaultPick('A', ['BV1', 'AR3'])).toEqual({ nodes: ['AR3', 'AV1'], autoFilled: ['AV1'] }); // 상대 소켓은 무시
  });
  it('자동 채움 로그는 소유자에게만 보이고, 공유(all) 로그에는 소켓 선택이 없다', () => {
    const f = fillVaultPick('A', ['AR1']);
    const a: Order[] = [{ type: 'setVaults', nodes: f.nodes, autoFilled: f.autoFilled }];
    const b: Order[] = [{ type: 'setVaults', nodes: ['BR1', 'BR3'] }];
    const s = resolveTurn(createMatch(H), a, b);
    expect([s.nodes.AR1.kind, s.nodes.AV1.kind, s.nodes.AV2.kind]).toEqual(['vault', 'vault', 'relay']);
    const auto = s.log.filter((l) => l.text.includes('자동 지정'));
    expect(auto).toHaveLength(1);
    expect(auto[0].vis).toBe('A');
    expect(auto[0].text).toContain('소켓1'); // 자동으로 채운 소켓
    expect(auto[0].text).toContain('직접 고른 A 소켓2 유지');
    // 공유 로그(all)에는 금고 지정·자동 채움 내용이 없고, B가 보는 로그에는 A의 소켓 이름이 없다
    expect(s.log.filter((l) => l.vis === 'all').some((l) => /자동 지정|소켓|금고 지정/.test(l.text))).toBe(false);
    expect(s.log.filter((l) => l.vis === 'all' || l.vis === 'B').some((l) => /자동 지정|A 소켓/.test(l.text))).toBe(false);
    // B는 수동 지정이라 자동 채움 로그 없음
    expect(s.log.some((l) => l.vis === 'B' && l.text.includes('자동 지정'))).toBe(false);
  });
});

describe("QA: 20턴 판정 로그에 브리치 점수 표시 (E1')", () => {
  const atTurn20 = (opts: object) => { const s: MatchState = createMatch(opts); s.turn = 20; s.players.A.data = 10; s.players.B.data = 10; s.players.A.breachData = 4; return s; };
  it("E1' on: 항목별(데이터 + 브리치 + 코어) 표시, 합이 판정 점수와 같다", () => {
    const s0 = atTurn20({ coreBreachDataEnabled: true, breachTimeOnlyEnabled: true });
    const s = resolveTurn(s0, [], []);
    const line = s.log.find((l) => l.text.startsWith('시간 종료 판정'))!.text;
    expect(line).toContain(`A ${timeScore(s, 'A') / 2}점 = 데이터 5 + 브리치 2 + 코어 5`);
    expect(line).toContain('B 10점 = 데이터 5 + 브리치 0 + 코어 5');
    expect(line).toContain("브리치(E1')");
  });
  it("E1' off: 기존 문구 그대로", () => {
    const s = resolveTurn(atTurn20({}), [], []);
    expect(s.log.find((l) => l.text.startsWith('시간 종료 판정'))!.text).toBe('시간 종료 판정: A 10점 vs B 10점 (데이터 + 코어 HP 10%당 0.5점)');
  });
});
