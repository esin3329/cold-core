import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { SIEGE_ALL_OFF } from '../src/sim/config';
import { income, resolveTurn, suddenDeathDmg, upkeepPerIce } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { IceKind, MatchState, Player, Program } from '../src/sim/types';
import { viewFor } from '../src/sim/view';

function addIce(s: MatchState, owner: Player, node: string, kind: IceKind) {
  const id = s.nextId++;
  const hp = { bulwark: 200, hound: 100, lantern: 60, honeypot: 40 }[kind];
  s.ices.push({ id, kind, owner, node, hp, compiling: false, free: false, seq: id });
  return id;
}
function addProg(s: MatchState, owner: Player, node: string, kind: Program['kind'], target = node) {
  const id = s.nextId++;
  s.programs.push({ id, kind, owner, node, target, hp: { auger: 120, shade: 60, siphon: 80 }[kind], stunned: 0, detected: false, revealed: false, seq: id });
  return id;
}
const playing = (opts = {}) => resolveTurn(createMatch(opts), [], []);

describe('기본값', () => {
  it('세 옵션 모두 전체 off 프리셋에서 off (v0.3부터 기본값은 v03-defaults.test.ts), v0.2 수치', () => {
    expect(SIEGE_ALL_OFF.iceUpkeepEnabled).toBe(false);
    expect(SIEGE_ALL_OFF.coreDirectDamageEnabled).toBe(false);
    expect(SIEGE_ALL_OFF.suddenDeathEnabled).toBe(false);
    expect(createMatch().options.coreDirectDamagePct).toBe(200);
  });
});

describe('(A) ICE 유지비', () => {
  it('공식: 턴 8~11: 1, 12~15: 2, 16~20: 3 (상한)', () => {
    const s = createMatch({ iceUpkeepEnabled: true });
    expect([7, 8, 11, 12, 15, 16, 20].map((t) => upkeepPerIce(s, t))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(upkeepPerIce(createMatch(), 16)).toBe(0);
  });
  it('수입 직후 차감, 허니팟 제외', () => {
    let s = playing({ iceUpkeepEnabled: true });
    s.ices = [];
    addIce(s, 'A', 'AG1', 'bulwark'); addIce(s, 'A', 'AR2', 'hound'); addIce(s, 'A', 'AR3', 'honeypot');
    s.turn = 12; s.players.A.cyc = 5;
    const inc = income(s, 'A');
    s = resolveTurn(s, [], []);
    expect(s.players.A.cyc).toBe(5 + inc - 2 * 2);
    expect(s.log.some((l) => l.text.includes('ICE 유지비: 2개 × 2 = 4 CYC'))).toBe(true);
  });
  it('CYC 부족 시 가장 최근 ICE부터 환급 없이 강제 회수', () => {
    let s = playing({ iceUpkeepEnabled: true });
    s.ices = [];
    const ids = ['AG1', 'AG2', 'AR2', 'AP1', 'AC'].map((n) => addIce(s, 'A', n, 'bulwark'));
    s.turn = 16; s.players.A.cyc = 0;
    const inc = income(s, 'A'); // 10
    s = resolveTurn(s, [], []);
    const keep = Math.floor(inc / 3);
    expect(s.ices.filter((i) => i.owner === 'A').map((i) => i.id)).toEqual(ids.slice(0, keep));
    expect(s.players.A.cyc).toBe(inc - keep * 3);
    expect(s.log.some((l) => l.text.includes('환급 없이 강제 회수'))).toBe(true);
  });
  it('비상 프로토콜 벌워크(free)는 유지비 면제 [기획 v0.3]', () => {
    let s = playing({ iceUpkeepEnabled: true });
    s.ices = [];
    addIce(s, 'A', 'AG1', 'bulwark');
    const em = addIce(s, 'A', 'AC', 'bulwark');
    s.ices.find((i) => i.id === em)!.free = true;
    s.turn = 8; s.players.A.cyc = 5;
    const inc = income(s, 'A');
    s = resolveTurn(s, [], []);
    expect(s.players.A.cyc).toBe(Math.min(30, 5 + inc) - 1);
    expect(s.log.some((l) => l.text.includes('ICE 유지비: 1개 × 1 = 1 CYC'))).toBe(true);
  });
  it('off이면 유지비 없음', () => {
    let s = playing();
    s.ices = [];
    addIce(s, 'A', 'AG1', 'bulwark');
    s.turn = 16; s.players.A.cyc = 0;
    s = resolveTurn(s, [], []);
    expect(s.players.A.cyc).toBe(income(s, 'A'));
  });
});

describe('(B) 코어 직접 피해', () => {
  it('오거 vs 알몸 코어 9 → 18', () => {
    for (const [on, exp] of [[false, 90], [true, 180]] as const) {
      let s = playing({ coreDirectDamageEnabled: on });
      s.ices = [];
      addProg(s, 'A', 'BC', 'auger', 'BC');
      s = resolveTurn(s, [], []);
      expect(s.nodes.BC.maxHp - s.nodes.BC.hp).toBe(exp);
    }
  });
  it('코어 위 ICE에는 미적용, 다른 노드에도 미적용', () => {
    let s = playing({ coreDirectDamageEnabled: true });
    s.ices = [];
    const bw = addIce(s, 'B', 'BC', 'bulwark');
    addProg(s, 'A', 'BC', 'auger', 'BC');
    addProg(s, 'A', 'BP1', 'auger', 'BP1');
    s = resolveTurn(s, [], []);
    expect(s.ices.find((i) => i.id === bw)!.hp).toBe(200 - 90);
    expect(s.nodes.BC.hp).toBe(1000);
    expect(s.nodes.BP1.maxHp - s.nodes.BP1.hp).toBe(90);
  });
});

describe('(C) 서든데스', () => {
  it('턴 15부터 6, +2/턴 (15..20 합 66)', () => {
    const s = createMatch({ suddenDeathEnabled: true });
    const seq = [14, 15, 16, 17, 18, 19, 20].map((t) => suddenDeathDmg(s, t));
    expect(seq).toEqual([0, 6, 8, 10, 12, 14, 16]);
    expect(seq.reduce((a, b) => a + b, 0)).toBe(66);
  });
  it('양쪽 코어 고정 피해 + 안개 해제', () => {
    let s = playing({ suddenDeathEnabled: true });
    s.ices = [];
    addIce(s, 'B', 'BR3', 'honeypot');
    s.turn = 14;
    expect(viewFor(s, 'A').nodes.BR3.ices).toBeNull();
    s = resolveTurn(s, [], []);
    expect(s.nodes.AC.hp).toBe(1000);
    // T15 계획 단계: 안개 해제 → 허니팟까지 보임
    const v = viewFor(s, 'A');
    expect(v.fogLifted).toBe(true);
    expect(v.nodes.BR3.ices!.map((i) => i.kind)).toEqual(['honeypot']);
    expect(v.nodes.BR3.shownKind).toBe('relay');
    s = resolveTurn(s, [], []);
    expect(s.nodes.AC.hp).toBe(940);
    expect(s.nodes.BC.hp).toBe(940);
    expect(s.log.some((l) => l.text.includes('서든데스 개시'))).toBe(true);
    s = resolveTurn(s, [], []);
    expect(s.nodes.AC.hp).toBe(860);
  });
  it('서든데스로 양쪽 코어 동시 파괴 → 데이터로 판정', () => {
    let s = playing({ suddenDeathEnabled: true });
    s.turn = 15; s.nodes.AC.hp = 50; s.nodes.BC.hp = 50; s.players.B.data = 4;
    s = resolveTurn(s, [], []);
    expect(s.over).toBe(true);
    expect(s.winReason).toBe('core');
    expect(s.winner).toBe('B');
  });
  it('off이면 피해 없음', () => {
    let s = playing();
    s.turn = 16;
    s = resolveTurn(s, [], []);
    expect(s.nodes.AC.hp).toBe(1000);
  });
});

describe('옵션 + AI 결정론', () => {
  it('세 옵션 모두 on, 시드 AI 대전도 반복 시 동일 결과 + 종료', () => {
    const run = () => {
      let s = createMatch({ iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true });
      while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'thief', 11), aiOrders(s, 'B', 'turtle', 22));
      return s;
    };
    const a = run(), b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.turn).toBeLessThanOrEqual(20);
  });
  it('시드가 다르면 AI 선택이 달라질 수 있음 (변주 존재)', () => {
    const finals = new Set<string>();
    for (let seed = 0; seed < 8; seed++) {
      let s = createMatch();
      while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', AI_STYLES[seed % 4], seed), aiOrders(s, 'B', 'balanced', seed + 100));
      finals.add(JSON.stringify([s.winner, s.turn, s.players.A.data, s.players.B.data, s.nodes.AC.hp, s.nodes.BC.hp]));
    }
    expect(finals.size).toBeGreaterThan(1);
  });
});
