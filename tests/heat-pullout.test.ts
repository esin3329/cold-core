// [기획 v0.3.1] HEAT 80 철수 집계 — 정의: 그 턴 시작 노출도 ≥ HEAT_PULLOUT_THRESHOLD 이고
// 그 턴에 공격 프로그램을 1개 이상 철수(잭아웃)한 턴. 철수 개수와 무관하게 턴당 1회. 사람·AI 구분 없음.
import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { HEAT_PULLOUT_THRESHOLD, TUNING } from '../src/sim/config';
import { resolveTurn } from '../src/sim/engine';
import type { MatchState, Player, Program } from '../src/sim/types';
import { HEAT_ROWS } from '../src/ui/heatStats';
import { createMatch } from './helpers';

function playing(): MatchState {
  const s = resolveTurn(createMatch(), [], []);
  s.ices = [];
  return s;
}
function addProg(s: MatchState, owner: Player, node: string, kind: Program['kind'] = 'auger') {
  const id = s.nextId++;
  s.programs.push({ id, kind, owner, node, target: node, hp: 120, stunned: 0, detected: false, revealed: false, seq: id });
  return id;
}

describe('HEAT 80 철수 집계 [기획 v0.3.1]', () => {
  it('임계값은 단일 상수 80', () => {
    expect(HEAT_PULLOUT_THRESHOLD).toBe(80);
  });

  it('시작 노출도 85 + 한 턴에 오거 2기 철수 → 철수 턴 1회 (프로그램 수와 무관), 머문 턴 1', () => {
    let s = playing();
    s.players.A.heat = 85;
    const a1 = addProg(s, 'A', 'BG1'), a2 = addProg(s, 'A', 'BG2');
    s = resolveTurn(s, [{ type: 'jackout', progId: a1 }, { type: 'jackout', progId: a2 }], []);
    expect(s.log.filter((l) => l.text.includes('철수')).length).toBe(2);
    expect(s.players.A.heatPulloutTurns).toBe(1);
    expect(s.players.A.heatHighTurns).toBe(1);
    expect(s.players.B.heatPulloutTurns).toBe(0);
  });

  it('경계: 정확히 80이면 집계, 79면 집계 안 함', () => {
    for (const [heat, want] of [[80, 1], [79, 0]] as const) {
      let s = playing();
      s.players.A.heat = heat;
      const a1 = addProg(s, 'A', 'BG1');
      s = resolveTurn(s, [{ type: 'jackout', progId: a1 }], []);
      expect(s.players.A.heatPulloutTurns, `heat ${heat}`).toBe(want);
      expect(s.players.A.heatHighTurns, `heat ${heat}`).toBe(want);
    }
  });

  it('노출도 80+ 이지만 철수 안 함 → 머문 턴만 +1', () => {
    let s = playing();
    s.players.A.heat = 90;
    addProg(s, 'A', 'BG1');
    s = resolveTurn(s, [], []);
    expect(s.players.A.heatHighTurns).toBe(1);
    expect(s.players.A.heatPulloutTurns).toBe(0);
  });

  it('두 턴 연속 80+ 에서 철수 → 2회, 머문 턴 2 (턴 시작 노출도 기준)', () => {
    let s = playing();
    s.players.B.heat = 95;
    const b1 = addProg(s, 'B', 'AG1');
    s = resolveTurn(s, [], [{ type: 'jackout', progId: b1 }]);
    s.players.B.heat = 90; // 다음 턴 시작 노출도를 80+ 로 고정
    const b2 = addProg(s, 'B', 'AG2');
    s = resolveTurn(s, [], [{ type: 'jackout', progId: b2 }]);
    expect(s.players.B.heatPulloutTurns).toBe(2);
    expect(s.players.B.heatHighTurns).toBe(2);
  });

  it('턴 시작 노출도가 80 미만이면, 그 턴 도중 80을 넘어도 그 턴은 집계 안 함', () => {
    let s = playing();
    s.players.A.heat = 79;
    const a1 = addProg(s, 'A', 'BG1');
    s = resolveTurn(s, [{ type: 'jackout', progId: a1 }, { type: 'overclock' }], []);
    expect(s.players.A.heat).toBeGreaterThanOrEqual(HEAT_PULLOUT_THRESHOLD); // 오버클럭으로 올라감
    expect(s.players.A.heatPulloutTurns).toBe(0);
    expect(s.players.A.heatHighTurns).toBe(0);
  });

  it('역추적(HEAT 100)은 별도 행: 횟수 +1, 철수 턴과 섞이지 않음', () => {
    let s = playing();
    s.players.A.heat = 99;
    addProg(s, 'A', 'BG1');
    s = resolveTurn(s, [{ type: 'overclock' }], []);
    expect(s.log.some((l) => l.text.startsWith('★ 역추적(TRACEBACK)! [A]'))).toBe(true);
    expect(s.players.A.tracebacks).toBe(1);
    expect(s.players.A.heat).toBe(TUNING.heatAfterTraceback);
    expect(s.players.A.heatPulloutTurns).toBe(0);
    expect(s.players.A.heatHighTurns).toBe(1);
  });

  it('AI 경기: 엔진 집계 = 로그로 다시 센 값 (양측, 모든 성향), 철수 턴 ≤ 머문 턴', () => {
    let seen = 0;
    for (const sa of AI_STYLES) for (const sb of AI_STYLES) {
      let s = createMatch();
      const want = { A: { pull: 0, high: 0, tb: 0 }, B: { pull: 0, high: 0, tb: 0 } };
      for (let g = 0; !s.over && g < 60; g++) {
        const start = { A: s.players.A.heat, B: s.players.B.heat };
        s = resolveTurn(s, aiOrders(s, 'A', sa, g), aiOrders(s, 'B', sb, g + 7));
        for (const p of ['A', 'B'] as const) {
          const out = s.log.some((l) => new RegExp(`^\\[${p}\\] (오거|섀도|사이펀)#\\d+ 철수`).test(l.text));
          if (start[p] >= 80) { want[p].high++; if (out) want[p].pull++; }
          want[p].tb += s.log.filter((l) => l.text.startsWith(`★ 역추적(TRACEBACK)! [${p}]`)).length;
        }
      }
      for (const p of ['A', 'B'] as const) {
        const ps = s.players[p];
        expect([ps.heatPulloutTurns, ps.heatHighTurns, ps.tracebacks]).toEqual([want[p].pull, want[p].high, want[p].tb]);
        expect(ps.heatPulloutTurns).toBeLessThanOrEqual(ps.heatHighTurns);
        seen += ps.heatPulloutTurns;
      }
    }
    expect(seen).toBeGreaterThan(0); // 실제로 HEAT 80+ 철수가 일어나는 경기가 있다
  });

  it('결과 화면 툴팁: 세 행, 정의 문구와 [기획 v0.3.1] 태그, 역추적은 별도 행', () => {
    expect(HEAT_ROWS.map((r) => r[0])).toEqual(['heatPulloutTurns', 'heatHighTurns', 'tracebacks']);
    for (const [, , tip] of HEAT_ROWS) expect(tip).toContain('[기획 v0.3.1]');
    expect(HEAT_ROWS[0][1]).toBe('HEAT 80+ 철수 턴');
    expect(HEAT_ROWS[0][2]).toContain('턴당 1회');
    expect(HEAT_ROWS[0][2]).toContain('80 이상');
    expect(HEAT_ROWS[1][1]).toBe('HEAT 80+ 머문 턴');
    expect(HEAT_ROWS[2][1]).toContain('역추적');
  });
});
