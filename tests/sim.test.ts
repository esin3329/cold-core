import { describe, expect, it } from 'vitest';
import { aiOrders, type AiStyle } from '../src/sim/ai';
import { MATCHUP, receivedPct, TUNING } from '../src/sim/config';
import { debugApply, planBudget, resolveTurn } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { IceKind, MatchState, Order, Player, Program } from '../src/sim/types';
import { viewFor } from '../src/sim/view';

function addIce(s: MatchState, owner: Player, node: string, kind: IceKind, hp?: number) {
  const id = s.nextId++;
  const base = { bulwark: 200, hound: 100, lantern: 60, honeypot: 40 }[kind];
  s.ices.push({ id, kind, owner, node, hp: hp ?? base, compiling: false, free: false, seq: id });
  return id;
}
function addProg(s: MatchState, owner: Player, node: string, kind: Program['kind'], target = node) {
  const id = s.nextId++;
  const hp = { auger: 120, shade: 60, siphon: 80 }[kind];
  s.programs.push({ id, kind, owner, node, target, hp, stunned: 0, detected: false, revealed: false, seq: id });
  return id;
}
function playing(): MatchState {
  const s = resolveTurn(createMatch(), [], []); // 구축 단계 통과
  return s;
}
function aiMatch(sa: AiStyle, sb: AiStyle) {
  let s = createMatch();
  const orders: { a: Order[]; b: Order[] }[] = [];
  let guard = 0;
  while (!s.over && guard++ < 100) {
    const a = aiOrders(s, 'A', sa), b = aiOrders(s, 'B', sb);
    orders.push({ a, b });
    s = resolveTurn(s, a, b);
  }
  return { s, orders, guard };
}

describe('결정론', () => {
  it('같은 명령이면 같은 결과 (AI vs AI 두 번 실행 + 명령 로그 리플레이)', () => {
    const r1 = aiMatch('raider', 'balanced');
    const r2 = aiMatch('raider', 'balanced');
    expect(JSON.stringify(r1.s)).toBe(JSON.stringify(r2.s));
    let s = createMatch();
    for (const o of r1.orders) s = resolveTurn(s, o.a, o.b);
    expect(JSON.stringify(s)).toBe(JSON.stringify(r1.s));
  });
  it('resolveTurn은 입력 상태를 변경하지 않는다', () => {
    const s = playing();
    const snap = JSON.stringify(s);
    resolveTurn(s, [{ type: 'launch', prog: 'auger', target: 'BC' }], [{ type: 'overclock' }]);
    expect(JSON.stringify(s)).toBe(snap);
  });
  it('좌우 대칭: 같은 AI끼리는 대칭 결과 (A/B 처리 순서 편향 없음)', () => {
    const { s } = aiMatch('raider', 'raider');
    expect(s.players.A.data).toBe(s.players.B.data);
    expect(s.nodes.AC.hp).toBe(s.nodes.BC.hp);
    expect(s.players.A.heat).toBe(s.players.B.heat);
  });
});

describe('상성 배율 (§7.2, §11.4)', () => {
  it('표 값', () => {
    expect(MATCHUP.brute.wall).toBe(150);
    expect(MATCHUP.brute.active).toBe(50);
    expect(MATCHUP.stealth.active).toBe(150);
    expect(MATCHUP.stealth.watch).toBe(50);
    expect(MATCHUP.viral.watch).toBe(150);
    expect(MATCHUP.viral.wall).toBe(50);
    expect(receivedPct('brute', 'active')).toBe(150);
    expect(receivedPct('stealth', 'active')).toBe(50);
  });
  it('오거 vs 벌워크 = 9 피해, 하운드 vs 오거 = 7.5 피해 → 오거 2턴 만에 삭제', () => {
    let s = playing();
    s.ices = [];
    const bw = addIce(s, 'B', 'BG1', 'bulwark');
    addIce(s, 'B', 'BG1', 'hound');
    const ag = addProg(s, 'A', 'BG1', 'auger', 'BC');
    s = resolveTurn(s, [], []);
    expect(s.ices.find((i) => i.id === bw)!.hp).toBe(200 - 90);
    expect(s.programs.find((p) => p.id === ag)!.hp).toBe(120 - 75);
    s = resolveTurn(s, [], []);
    expect(s.programs.find((p) => p.id === ag)).toBeUndefined();
    expect(s.ices.find((i) => i.id === bw)!.hp).toBe(20);
  });
  it('하운드는 은신 셰이드를 공격하지 못하고, 셰이드는 하운드에 ×1.5', () => {
    let s = playing();
    s.ices = [];
    const h = addIce(s, 'B', 'BR2', 'hound');
    const sh = addProg(s, 'A', 'BR2', 'shade', 'BR2');
    s = resolveTurn(s, [], []);
    expect(s.programs.find((p) => p.id === sh)!.hp).toBe(60);
    expect(s.ices.find((i) => i.id === h)!.hp).toBe(100 - 60);
  });
  it('랜턴에 탐지되면 셰이드도 하운드에 맞는다', () => {
    let s = playing();
    s.ices = [];
    addIce(s, 'B', 'BR2', 'hound');
    addIce(s, 'B', 'BP1', 'lantern');
    const sh = addProg(s, 'A', 'BR2', 'shade', 'BR2');
    s = resolveTurn(s, [], []);
    expect(s.programs.find((p) => p.id === sh)!.hp).toBe(10);
  });
  it('사이펀 vs 벌워크 ×0.5', () => {
    let s = playing();
    s.ices = [];
    const bw = addIce(s, 'B', 'BV1', 'bulwark');
    addProg(s, 'A', 'BV1', 'siphon', 'BV1');
    s = resolveTurn(s, [], []);
    expect(s.ices.find((i) => i.id === bw)!.hp).toBe(190);
    expect(s.players.A.data).toBe(0); // 벌워크가 있으면 탈취 불가
  });
});

describe('해결 순서 (§6.4)', () => {
  it('로그 단계는 1→7 순서로만 진행', () => {
    const { s } = aiMatch('raider', 'balanced');
    for (const t of s.turnLogs) {
      const steps = t.log.map((l) => l.step);
      expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    }
  });
  it('① 철수가 ④ 교전보다 먼저 → 철수한 프로그램은 피해를 받지 않고 BW 반환', () => {
    let s = playing();
    s.ices = [];
    addIce(s, 'B', 'BG1', 'hound');
    const ag = addProg(s, 'A', 'BG1', 'auger', 'BC');
    s = resolveTurn(s, [{ type: 'jackout', progId: ag }], []);
    expect(s.programs.length).toBe(0);
    const dmgLines = s.log.filter((l) => l.step === 4);
    expect(dmgLines.length).toBe(0);
  });
  it('이번 턴에 컴파일한 ICE는 ⑦에서 활성화 → 이번 턴 교전에 참여하지 않음', () => {
    let s = playing();
    s.ices = [];
    const ag = addProg(s, 'A', 'BG1', 'auger', 'BC');
    s = resolveTurn(s, [], [{ type: 'compile', ice: 'hound', node: 'BG1' }]);
    expect(s.programs.find((p) => p.id === ag)!.hp).toBe(120);
    expect(s.ices.find((i) => i.kind === 'hound')!.compiling).toBe(false);
    s = resolveTurn(s, [], []);
    expect(s.programs.find((p) => p.id === ag)!.hp).toBe(45);
  });
  it('② 정찰 공개는 ③ 이동 전에, 안개 뷰는 정찰 전 ICE를 숨김', () => {
    let s = playing();
    expect(viewFor(s, 'A').nodes.BR2.ices).toBeNull();
    s = resolveTurn(s, [{ type: 'launch', prog: 'ping', target: 'BR2' }], [{ type: 'compile', ice: 'hound', node: 'BR2' }]);
    const v = viewFor(s, 'A');
    expect(v.nodes.BR2.ices).not.toBeNull();
    // 핑은 ② 시점의 정보: 같은 턴 ①에서 컴파일 시작한 하운드가 보인다(설치 중 포함)
    expect(v.nodes.BR2.ices!.map((i) => i.kind)).toContain('hound');
    expect(viewFor(s, 'A').nodes.BG1.ices).toBeNull();
  });
});

describe('노출도·역추적 (§7.3)', () => {
  it('노출도 100 → 프로그램 전원 삭제, 상대 침투 링크, 40 리셋', () => {
    let s = playing();
    addProg(s, 'A', 'N2', 'auger', 'BC');
    s = debugApply(debugApply(s, 'A', 'heatSelf'), 'A', 'heatSelf');
    s = resolveTurn(s, [], []);
    expect(s.programs.filter((p) => p.owner === 'A').length).toBe(0);
    expect(s.players.A.heat).toBe(TUNING.heatAfterTraceback);
    expect(s.players.B.breach?.relay).toBe('AR2');
    expect(s.log.some((l) => l.text.includes('역추적'))).toBe(true);
    // 침투 링크로 B는 A 릴레이2에서 바로 발사
    s = resolveTurn(s, [], [{ type: 'launch', prog: 'auger', target: 'AC' }]);
    expect(s.log.some((l) => l.text.includes('발사 @ A 릴레이2'))).toBe(true);
  });
  it('자연 감소 -10', () => {
    let s = playing();
    s.players.A.heat = 35;
    s = resolveTurn(s, [], []);
    expect(s.players.A.heat).toBe(25);
  });
});

describe('승리 조건 (§9)', () => {
  it('코어 브리치', () => {
    let s = playing();
    s.ices = [];
    s.nodes.BC.hp = 50;
    addProg(s, 'A', 'BC', 'auger', 'BC');
    s = resolveTurn(s, [], []);
    expect(s.over).toBe(true);
    expect(s.winner).toBe('A');
    expect(s.winReason).toBe('core');
  });
  it('데이터 12점 탈취', () => {
    let s = playing();
    s.ices = [];
    s.players.B.data = 22;
    addProg(s, 'B', 'AV1', 'siphon', 'AV1');
    s = resolveTurn(s, [], []);
    expect(s.winner).toBe('B');
    expect(s.winReason).toBe('data');
  });
  it('20턴 시간 판정: 데이터 + 코어 10%당 0.5', () => {
    let s = playing();
    s.turn = TUNING.maxTurns;
    s.nodes.AC.hp = 500; // 50% → 2.5점
    s.players.B.data = 2; // 1점 + 코어 100% 5점 = 6점
    s = resolveTurn(s, [], []);
    expect(s.over).toBe(true);
    expect(s.winReason).toBe('time');
    expect(s.winner).toBe('B');
  });
});

describe('자원·명령 검증 (§6.1, §6.2)', () => {
  it('CYC 부족·BW 초과·슬롯 초과 명령은 거절', () => {
    const s = playing();
    s.players.A.cyc = 5;
    const b = planBudget(s, 'A', [
      { type: 'launch', prog: 'auger', target: 'BC' },
      { type: 'launch', prog: 'auger', target: 'BC' },
      { type: 'compile', ice: 'hound', node: 'AP1' },
      { type: 'compile', ice: 'hound', node: 'AP1' },
    ]);
    expect(b.errors[0]).toBeNull();
    expect(b.errors[1]).toMatch(/CYC/);
    expect(b.errors[3]).toMatch(/슬롯|CYC/);
  });
  it('ICE 회수: BW 즉시 반환 + CYC 50% 환급', () => {
    let s = playing();
    s.ices = [];
    const id = addIce(s, 'A', 'AG1', 'hound');
    const before = s.players.A.cyc;
    const b = planBudget(s, 'A', [{ type: 'recompile', iceId: id }]);
    expect(b.cyc).toBe(before + 2);
    expect(b.bwDef).toBe(0);
    s = resolveTurn(s, [{ type: 'recompile', iceId: id }], []);
    expect(s.ices.length).toBe(0);
  });
});

describe('헤드리스 AI 대전', () => {
  for (const [a, b] of [['balanced', 'balanced'], ['raider', 'balanced'], ['balanced', 'raider'], ['raider', 'raider']] as [AiStyle, AiStyle][]) {
    it(`${a} vs ${b} 는 최대 턴 이내에 종료`, () => {
      const r = aiMatch(a, b);
      expect(r.s.over).toBe(true);
      expect(r.s.turn).toBeLessThanOrEqual(TUNING.maxTurns);
      expect(r.guard).toBeLessThanOrEqual(TUNING.maxTurns + 1);
    });
  }
});
