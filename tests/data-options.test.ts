import { describe, expect, it } from 'vitest';
import { SIEGE_ALL_OFF, SIEGE_PRESSURE, TUNING } from '../src/sim/config';
import { aiOrders } from '../src/sim/ai';
import { dataWinTarget, resolveTurn } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { MatchState } from '../src/sim/types';

const playing = (opts = {}) => { const s = resolveTurn(createMatch(opts), [], []); s.ices = []; return s; };
const own = (s: MatchState, ...ids: string[]) => { for (const id of ids) s.nodes[id].owner = 'A'; };
const runTurns = (s: MatchState, n: number) => { for (let i = 0; i < n && !s.over; i++) s = resolveTurn(s, [], []); return s; };

describe('데이터 감속안 기본값', () => {
  it('D1·D2·D3 전체 off 프리셋에서 off (v0.3부터 기본값은 v03-defaults.test.ts), 예시 수치', () => {
    expect([SIEGE_ALL_OFF.dataWinRaiseEnabled, SIEGE_ALL_OFF.neutralDataCapEnabled, SIEGE_ALL_OFF.neutralDataDelayEnabled]).toEqual([false, false, false]);
    expect([SIEGE_PRESSURE.dataWinRaised, SIEGE_PRESSURE.neutralDataCap, SIEGE_PRESSURE.neutralDataStartTurn]).toEqual([20, 6, 6]);
    expect(TUNING.neutralDataPerTurn).toBe(0.5); // 0.25 하향안은 구현하지 않음
  });
});

describe('(D1) 데이터 승리 기준 20', () => {
  it('off: 12점에서 데이터 승리', () => {
    const s = playing();
    s.players.A.data = 24;
    const r = resolveTurn(s, [], []);
    expect(dataWinTarget(r)).toBe(12);
    expect([r.over, r.winner, r.winReason]).toEqual([true, 'A', 'data']);
  });
  it('on: 12점으로는 계속, 20점에서 데이터 승리', () => {
    let s = playing({ dataWinRaiseEnabled: true });
    s.players.A.data = 24;
    s = resolveTurn(s, [], []);
    expect(dataWinTarget(s)).toBe(20);
    expect(s.over).toBe(false);
    s.players.A.data = 40;
    s = resolveTurn(s, [], []);
    expect([s.over, s.winner, s.winReason]).toEqual([true, 'A', 'data']);
  });
});

describe('(D2) 중립 데이터 누적 상한 6점', () => {
  it('중립 3개 보유: 4턴 동안 1.5+1.5+1.5+1.5=6, 이후 0 — 상한 로그', () => {
    let s = playing({ neutralDataCapEnabled: true, dataWinRaiseEnabled: true });
    own(s, 'N1', 'N2', 'N3');
    s = runTurns(s, 4);
    expect(s.players.A.data).toBe(12);
    expect(s.players.A.neutralData).toBe(12);
    s = runTurns(s, 3);
    expect(s.players.A.data).toBe(12);
    expect(s.log.some((l) => l.text.includes('이미 도달') && l.text.includes('(D2)'))).toBe(true);
  });
  it('상한 직전에는 남은 만큼만 지급 (5.5 → 6)', () => {
    let s = playing({ neutralDataCapEnabled: true });
    own(s, 'N1', 'N2');
    s.players.A.neutralData = 11; s.players.A.data = 11;
    s = resolveTurn(s, [], []);
    expect(s.players.A.neutralData).toBe(12);
    expect(s.players.A.data).toBe(12);
    expect(s.log.some((l) => l.text.includes('원래 +1') && l.text.includes('상한 6점 도달 (D2)'))).toBe(true);
  });
  it('금고 탈취 데이터는 상한과 무관', () => {
    let s = playing({ neutralDataCapEnabled: true });
    s.players.A.neutralData = 12;
    const id = s.nextId++;
    s.programs.push({ id, kind: 'siphon', owner: 'A', node: 'BV1', target: 'BV1', hp: 80, stunned: 0, detected: false, revealed: false, seq: id });
    s = resolveTurn(s, [], []);
    expect(s.players.A.data).toBeGreaterThan(0);
    expect(s.players.A.neutralData).toBe(12);
  });
  it('off: 상한 없음', () => {
    let s = playing();
    own(s, 'N1', 'N2', 'N3');
    s = runTurns(s, 5);
    expect(s.players.A.data).toBe(15);
  });
});

describe('(D3) 중립 데이터는 T6부터', () => {
  it('T1~T5 정산에는 데이터 0 (로그), T6부터 생성. 점령·수입은 그대로', () => {
    let s = playing({ neutralDataDelayEnabled: true });
    own(s, 'N1');
    s.players.A.cyc = 0;
    expect(s.turn).toBe(1);
    s = runTurns(s, 5); // T1..T5 해결
    expect(s.players.A.data).toBe(0);
    expect(s.players.A.cyc).toBeGreaterThan(0); // 수입은 들어옴
    expect(s.log.some((l) => l.text.includes('T6부터 (D3)'))).toBe(true);
    s = resolveTurn(s, [], []); // T6
    expect(s.players.A.data).toBe(1);
  });
});

describe('결정론', () => {
  it('D1+D2+D3 + A+B+C 전부 켜고 AI 대전 두 번 = 동일, 정수 유지', () => {
    const opts = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, dataWinRaiseEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true };
    const run = () => {
      let s = createMatch(opts);
      while (!s.over) s = resolveTurn(s, aiOrders(s, 'A', 'raider', 7), aiOrders(s, 'B', 'sieger', 11));
      return s;
    };
    const a = run(), b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Number.isInteger(a.players.A.data) && Number.isInteger(a.players.A.neutralData)).toBe(true);
    expect(a.players.A.neutralData).toBeLessThanOrEqual(12);
    expect(a.players.B.neutralData).toBeLessThanOrEqual(12);
  });
});
