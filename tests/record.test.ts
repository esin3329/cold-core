// [기획 v0.3.1] 결과 화면 기록 블록: 첫 게이트 돌파 · 최저 코어 HP · 서든데스 도달 + 로그 재집계 교차 검증
import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { debugApply, createMatch as createMatchDefaults, forfeit, nodeLabel, resolveTurn } from '../src/sim/engine';
import { NODES } from '../src/sim/map';
import type { MatchState, Player, Program } from '../src/sim/types';
import { bannerText, buildRecord, recordColumns, recordTsv, WIN_REASON_TEXT } from '../src/ui/record';
import { createMatch } from './helpers';

function playing(opts = {}): MatchState {
  const s = resolveTurn(createMatch(opts), [], []);
  s.ices = [];
  return s;
}
function addProg(s: MatchState, owner: Player, node: string, kind: Program['kind'] = 'auger', target = node) {
  const id = s.nextId++;
  s.programs.push({ id, kind, owner, node, target, hp: 120, stunned: 0, detected: false, revealed: false, seq: id });
  return id;
}
const GATES = NODES.filter((n) => n.kind === 'gate').map((n) => n.id);

/** 로그만 보고 다시 센다: 첫 '◆ <게이트> 파괴' 턴, 코어 '남은 HP' / 파괴 줄의 최솟값, 첫 서든데스 피해 턴 */
function recount(s: MatchState) {
  let first: { turn: number; gates: string[] } | null = null;
  const minHp: Record<Player, number> = { A: s.nodes.AC.maxHp, B: s.nodes.BC.maxHp };
  let sd: number | null = null;
  for (const t of s.turnLogs) for (const l of t.log) {
    for (const g of GATES) if (l.text.startsWith(`◆ ${nodeLabel(s, g)} 파괴`)) {
      if (!first) first = { turn: t.turn, gates: [g] };
      else if (first.turn === t.turn) first.gates.push(g);
    }
    for (const p of ['A', 'B'] as const) {
      const lab = nodeLabel(s, p + 'C');
      const m = l.text.match(new RegExp(`^(?:\\[디버그\\] )?${lab} (?:남은 HP|HP -40 →) ([\\d.]+)`));
      if (m) minHp[p] = Math.min(minHp[p], Math.round(Number(m[1]) * 10));
      if (l.text.startsWith(`◆ ${lab} 파괴`)) minHp[p] = 0;
    }
    if (sd === null && l.text.startsWith('⚠ 서든데스: 양쪽 코어 고정 피해')) sd = t.turn;
  }
  return { first, minHp, sd };
}

describe('기록: 첫 게이트 돌파 [기획 v0.3.1]', () => {
  it('처음엔 없음, 게이트를 부수면 그 턴·그 게이트가 기록되고 이후 파괴로 바뀌지 않음', () => {
    let s = playing();
    expect(s.firstGateBreak).toBeNull();
    expect(buildRecord(s).find((r) => r.key === 'firstGate')!.value).toBe('없음');
    s.nodes.BG1.hp = 10;
    addProg(s, 'A', 'BG1', 'auger', 'BG1');
    const t = s.turn;
    s = resolveTurn(s, [], []);
    expect(s.nodes.BG1.destroyed).toBe(true);
    expect(s.firstGateBreak).toEqual({ turn: t, gates: ['BG1'] });
    expect(buildRecord(s).find((r) => r.key === 'firstGate')!.value).toBe(`T${t} · B 게이트1`);
    s.nodes.AG1.hp = 10;
    addProg(s, 'B', 'AG1', 'auger', 'AG1');
    s = resolveTurn(s, [], []);
    expect(s.nodes.AG1.destroyed).toBe(true);
    expect(s.firstGateBreak).toEqual({ turn: t, gates: ['BG1'] });
  });
  it('같은 턴에 양쪽 게이트가 깨지면 둘 다 기록', () => {
    let s = playing();
    s.nodes.BG1.hp = 10; s.nodes.AG1.hp = 10;
    addProg(s, 'A', 'BG1', 'auger', 'BG1'); addProg(s, 'B', 'AG1', 'auger', 'AG1');
    s = resolveTurn(s, [], []);
    expect(s.firstGateBreak!.gates.sort()).toEqual(['AG1', 'BG1']);
    expect(buildRecord(s).find((r) => r.key === 'firstGate')!.value).toMatch(/^T\d+ · (A 게이트1, B 게이트1|B 게이트1, A 게이트1)$/);
  });
});

describe('기록: 최저 코어 HP [기획 v0.3.1]', () => {
  it('시작값 = 코어 최대 HP, 피해 시 내려가고 수리로 올라가도 최저값 유지', () => {
    let s = playing();
    expect(s.players.A.minCoreHp).toBe(s.nodes.AC.maxHp);
    s = debugApply(s, 'A', 'hitEnemyCore');
    expect(s.players.B.minCoreHp).toBe(s.nodes.BC.maxHp - 400);
    s = resolveTurn(s, [], [{ type: 'repair', node: 'BC' }]);
    expect(s.nodes.BC.hp).toBeGreaterThan(s.players.B.minCoreHp);
    expect(s.players.B.minCoreHp).toBe(s.nodes.BC.maxHp - 400);
    expect(s.players.A.minCoreHp).toBe(s.nodes.AC.maxHp);
  });
  it('서든데스 고정 피해도 반영되고, 도달 턴이 기록된다 (v0.3 기본값: T13, 6)', () => {
    let s = resolveTurn(createMatchDefaults(), aiOrders(createMatchDefaults(), 'A'), aiOrders(createMatchDefaults(), 'B'));
    expect(s.suddenDeathReachedTurn).toBeNull();
    s = debugApply(s, 'A', 'skipToSuddenDeath');
    const before = s.nodes.AC.hp;
    s = resolveTurn(s, [], []);
    expect(s.suddenDeathReachedTurn).toBe(13);
    expect(s.players.A.minCoreHp).toBeLessThanOrEqual(before - 60);
    expect(buildRecord(s).find((r) => r.key === 'suddenDeath')!.value).toBe('예 (T13 개시)');
  });
});

describe('기록: 디버그 점프로 서든데스 개시 턴을 건너뛴 경우', () => {
  it("'20턴으로' 점프 → 설정 개시 턴 T13 + '(디버그 점프)', 'T20 개시'로 적지 않음", () => {
    let s = createMatchDefaults();
    s = resolveTurn(s, aiOrders(s, 'A'), aiOrders(s, 'B'));
    s = debugApply(s, 'A', 'skipToLastTurn');
    expect(s.debugJumps).toEqual([{ from: 1, to: 20 }]);
    s = resolveTurn(s, [], []);
    expect(s.suddenDeathReachedTurn).toBe(20); // 시뮬레이션 기록은 실제 첫 적용 턴
    const v = buildRecord(s).find((r) => r.key === 'suddenDeath')!.value;
    expect(v).toBe('예 (T13 개시) (디버그 점프)');
    expect(v).not.toContain('T20');
  });
  it("'서든데스로' 점프는 개시 턴에 정확히 도착 → 표시 없음; 점프 없는 정상 경기도 표시 없음", () => {
    let s = createMatchDefaults();
    s = resolveTurn(s, aiOrders(s, 'A'), aiOrders(s, 'B'));
    s = debugApply(s, 'A', 'skipToSuddenDeath');
    s = resolveTurn(s, [], []);
    expect(buildRecord(s).find((r) => r.key === 'suddenDeath')!.value).toBe('예 (T13 개시)');
    let t = createMatchDefaults();
    for (let g = 0; !t.over && g < 60; g++) t = resolveTurn(t, aiOrders(t, 'A', 'turtle', g), aiOrders(t, 'B', 'turtle', g + 1));
    expect(t.debugJumps).toEqual([]);
    if (t.suddenDeathReachedTurn !== null) expect(buildRecord(t).find((r) => r.key === 'suddenDeath')!.value).toBe('예 (T13 개시)');
  });
  it('승리 유형 용어는 배너와 같은 "코어 브리치"', () => {
    let s = resolveTurn(createMatch(), [], []);
    for (let i = 0; i < 3 && !s.over; i++) s = debugApply(s, 'A', 'hitEnemyCore');
    expect(s.winReason).toBe('core');
    expect(buildRecord(s).find((r) => r.key === 'winType')!.value).toBe('코어 브리치');
  });
});

describe('승리 유형 용어: 배너 = 기록·복사 (모든 승리 유형)', () => {
  const recType = (s: MatchState) => buildRecord(s).find((r) => r.key === 'winType')!.value as string;
  /** 배너에서 승리 유형에 해당하는 말: 무승부면 큰 제목, 그 밖에는 부제 사유 */
  const bannerType = (s: MatchState, mode: 'ai' | 'hotseat') => (s.winner === 'draw' ? bannerText(s, mode).title : bannerText(s, mode).reason);
  it('용어 표는 정확히 코어 브리치 / 데이터 탈취 / 시간 종료 판정 / 기권, 무승부', () => {
    expect(WIN_REASON_TEXT).toEqual({ core: '코어 브리치', data: '데이터 탈취', time: '시간 종료 판정', forfeit: '기권' });
  });
  it('실제 경기로 만든 다섯 가지 결과 + D1 켜짐 데이터 승리: 배너와 기록 용어가 같다', () => {
    const seen: Record<string, string> = {};
    const check = (name: string, s: MatchState, want: string) => {
      expect(s.over, name).toBe(true);
      for (const mode of ['ai', 'hotseat'] as const) expect(recType(s), `${name}/${mode}`).toBe(bannerType(s, mode));
      expect(recType(s), name).toBe(want);
      expect(recordTsv(buildRecord(s)).split('\t')[1], name).toBe(want); // 복사 줄 2열
      seen[name] = recType(s);
    };
    let s = resolveTurn(createMatch(), [], []);
    for (let i = 0; i < 3 && !s.over; i++) s = debugApply(s, 'A', 'hitEnemyCore');
    check('core', s, '코어 브리치');
    for (const d1 of [false, true]) {
      let t = resolveTurn(createMatch({ dataWinRaiseEnabled: d1 }), [], []);
      for (let i = 0; i < (d1 ? 5 : 3); i++) t = debugApply(t, 'A', 'dataSelf');
      t = resolveTurn(t, [], []);
      expect(t.winReason).toBe('data');
      check(d1 ? 'data-D1' : 'data', t, '데이터 탈취');
    }
    let u = debugApply(resolveTurn(createMatch(), [], []), 'A', 'skipToLastTurn');
    u.players.A.data = 4;
    u = resolveTurn(u, [], []);
    expect([u.winReason, u.winner]).toEqual(['time', 'A']);
    check('time', u, '시간 종료 판정');
    let d = debugApply(resolveTurn(createMatch(), [], []), 'A', 'skipToLastTurn');
    d = resolveTurn(d, [], []);
    expect(d.winner).toBe('draw');
    check('draw', d, '무승부');
    check('forfeit', forfeit(resolveTurn(createMatch(), [], []), 'B'), '기권');
    expect(Object.keys(seen).sort()).toEqual(['core', 'data', 'data-D1', 'draw', 'forfeit', 'time']);
  });
});

describe('기록: 로그 재집계 교차 검증 (AI 전 성향 쌍, v0.3 기본값 + 전체 off)', () => {
  it('첫 게이트 돌파 · 최저 코어 HP · 서든데스 도달 = 로그로 다시 센 값', () => {
    let gateSeen = 0, sdSeen = 0, hitSeen = 0;
    for (const mk of [() => createMatchDefaults(), () => createMatch()]) for (const sa of AI_STYLES) for (const sb of AI_STYLES) {
      let s = mk();
      for (let g = 0; !s.over && g < 60; g++) s = resolveTurn(s, aiOrders(s, 'A', sa, g), aiOrders(s, 'B', sb, g + 3));
      const r = recount(s);
      expect(s.firstGateBreak, `${sa}/${sb}`).toEqual(r.first);
      expect({ A: s.players.A.minCoreHp, B: s.players.B.minCoreHp }, `${sa}/${sb}`).toEqual(r.minHp);
      expect(s.suddenDeathReachedTurn, `${sa}/${sb}`).toBe(r.sd);
      if (s.firstGateBreak) gateSeen++;
      if (s.suddenDeathReachedTurn !== null) sdSeen++;
      if (s.players.A.minCoreHp < s.nodes.AC.maxHp || s.players.B.minCoreHp < s.nodes.BC.maxHp) hitSeen++;
      // 최저 코어 HP는 현재 HP보다 클 수 없다
      for (const p of ['A', 'B'] as const) expect(s.players[p].minCoreHp).toBeLessThanOrEqual(s.nodes[p + 'C'].hp);
    }
    // 검증이 공허하지 않도록: 실제로 게이트 파괴·서든데스·코어 피해가 일어난 경기가 있어야 한다
    expect(gateSeen).toBeGreaterThan(10);
    expect(sdSeen).toBeGreaterThan(0);
    expect(hitSeen).toBeGreaterThan(10);
  });
});

describe('기록 블록·TSV', () => {
  it('기획 시트 순서, 복사 내용은 값 1줄·탭 구분 13열·머리줄 없음, 열 이름 목록은 따로 13개', () => {
    let s = createMatchDefaults();
    for (let g = 0; !s.over && g < 60; g++) s = resolveTurn(s, aiOrders(s, 'A', 'sieger', g), aiOrders(s, 'B', 'balanced', g + 1));
    const rows = buildRecord(s);
    expect(rows.map((r) => r.key)).toEqual(['winner', 'winType', 'turns', 'firstGate', 'suddenDeath', 'minCoreHp', 'heatPulloutTurns', 'heatHighTurns', 'tracebacks']);
    expect(['코어 브리치', '데이터 탈취', '시간 종료 판정', '무승부', '기권']).toContain(rows[1].value);
    const tsv = recordTsv(rows);
    expect(tsv).not.toMatch(/[\n\r]/); // 1줄
    const vals = tsv.split('\t');
    expect(vals.length).toBe(13);
    expect(vals).not.toContain('승자'); // 머리줄 없음
    expect(vals[0]).toBe(s.winner === 'draw' ? '무승부' : s.winner);
    expect(vals[2]).toBe(String(s.turn));
    expect(vals.slice(5)).toEqual([s.players.A.minCoreHp, s.players.B.minCoreHp].map((h) => String(h / 10)).concat(
      ...(['heatPulloutTurns', 'heatHighTurns', 'tracebacks'] as const).map((k) => [String(s.players.A[k]), String(s.players.B[k])])));
    expect(recordColumns(rows)).toEqual(['승자', '승리 유형', '경기 길이 (턴)', '첫 게이트 돌파', '서든데스 도달', '최저 코어 HP A', '최저 코어 HP B',
      'HEAT 80+ 철수 턴 A', 'HEAT 80+ 철수 턴 B', 'HEAT 80+ 머문 턴 A', 'HEAT 80+ 머문 턴 B', '역추적 (HEAT 100) A', '역추적 (HEAT 100) B']);
  });
});
