/**
 * 공성 압박 보정안 v0.2 측정: 8개 옵션 조합 × 헤드리스 AI 대전.
 * 다양성은 AI 쪽(성향 프로필 4종 + AI 전용 시드)에서만 만든다. 시뮬레이션 코어는 그대로 결정론적.
 * 실행: npm run balance  (결과: ../balance_results_v0.2.md, balance_results_v0.2.json)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { aiOrders, AI_STYLES, AI_STYLE_KO, type AiFlags, type AiStyle } from '../src/sim/ai';
import { HEAT_PULLOUT_THRESHOLD, SIEGE_ALL_OFF, type SiegeOptions } from '../src/sim/config';
import { createMatch, resolveTurn } from '../src/sim/engine';
import type { MatchState } from '../src/sim/types';

const SEEDS_PER_PAIR = Number(process.env.SEEDS ?? 20); // 25쌍 × 20 = 500판 / 조합
const PLANNER_SEEDS = Number(process.env.PSEEDS ?? 100); // 기획 매치업 3종 × 100 = 300판 / 조합

const SET = process.env.SET ?? 'v02'; // v02 = 공성 압박 8조합, v03 = 데이터 감속안 비교
const ABC = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true };
const D12 = { dataWinRaiseEnabled: true, neutralDataCapEnabled: true };
const COMBOS_V03: { key: string; opts: Partial<SiegeOptions> }[] = [
  // 측정 순서: 기획 지정 (1)→(2)→(3), 이어서 비교용 기준선·이전 최선
  { key: 'C+D1+D2', opts: { suddenDeathEnabled: true, ...D12 } },
  { key: 'C+D1+D2+D3', opts: { suddenDeathEnabled: true, ...D12, neutralDataDelayEnabled: true } },
  { key: 'A+B+C+D1+D2+D3', opts: { ...ABC, ...D12, neutralDataDelayEnabled: true } },
  { key: 'off', opts: {} },
  { key: 'A+B+C', opts: ABC },
  // 참고(기획 미요청): D1 없이 D2+D3만 — D1(20점)+D2(6점)에서는 데이터 승리가 수학적으로 불가능해서 비교용으로 추가
  { key: 'A+B+C+D2+D3 (참고)', opts: { ...ABC, neutralDataCapEnabled: true, neutralDataDelayEnabled: true } },
];
const BASE04 = { ...ABC, neutralDataCapEnabled: true, neutralDataDelayEnabled: true }; // v0.4 기준선 = A+B+C+D2+D3 (데이터 목표 12)
const COMBOS_V04: { key: string; opts: Partial<SiegeOptions> }[] = [
  { key: '기준선', opts: BASE04 },
  { key: '기준선+E1', opts: { ...BASE04, coreBreachDataEnabled: true } },
  { key: '기준선+E2', opts: { ...BASE04, coreBreachE2Enabled: true } },
];
const BASE05 = { ...BASE04, coreBreachE2Enabled: true, breachTimeOnlyEnabled: true }; // v0.5 기준선 = A+B+C+D2+D3+E2+E1'
const COMBOS_V05: { key: string; opts: Partial<SiegeOptions> }[] = [
  { key: '기준선', opts: BASE05 },
  { key: '+G1', opts: { ...BASE05, gateHpReducedEnabled: true } },
  { key: '+G2', opts: { ...BASE05, augerPierceEnabled: true } },
  { key: '+G1+G2', opts: { ...BASE05, gateHpReducedEnabled: true, augerPierceEnabled: true } },
];
const BASE06 = { ...BASE05, augerPierceStrongEnabled: true }; // v0.6 기준선 = A+B+C+D2+D3+E2+E1'+G2' (H off)
const COMBOS_V06: { key: string; opts: Partial<SiegeOptions> }[] = [
  { key: '기준선', opts: BASE06 },
  { key: '+G3', opts: { ...BASE06, gateSlotsReducedEnabled: true } },
  { key: "+C'", opts: { ...BASE06, suddenDeathEarlyEnabled: true } },
  { key: "+G3+C'", opts: { ...BASE06, gateSlotsReducedEnabled: true, suddenDeathEarlyEnabled: true } },
];
const BASE07 = { ...BASE06, suddenDeathEarlyEnabled: true }; // v0.7 기준선 = A+B+C+D2+D3+E2+E1'+G2'+C' (G3 제외, H off)
const EARLY: AiFlags = { siegerEarlyGate: true };
const COMBOS_V07: { key: string; opts: Partial<SiegeOptions>; ai?: AiFlags }[] = [
  { key: '기준선 (AI 변경 전)', opts: BASE07 },
  { key: '기준선 (AI 조기 공성)', opts: BASE07, ai: EARLY },
  { key: '+V1', opts: { ...BASE07, vaultDataReducedEnabled: true }, ai: EARLY },
  { key: '+V2', opts: { ...BASE07, siphonSlowEnabled: true }, ai: EARLY },
  { key: "+V1+C''", opts: { ...BASE07, vaultDataReducedEnabled: true, suddenDeathGentleEnabled: true }, ai: EARLY },
  { key: "+V1+V2+C''", opts: { ...BASE07, vaultDataReducedEnabled: true, siphonSlowEnabled: true, suddenDeathGentleEnabled: true }, ai: EARLY },
];
// v0.8: 기획 v0.3 확정 기준선 = A+B+C+D2+D3+E2+E1'+G2'+C' (H off, AI 조기 공성 off) vs 하운드 비용 4→5
const COMBOS_V08: { key: string; opts: Partial<SiegeOptions>; ai?: AiFlags }[] = [
  { key: '기준선 (대조)', opts: BASE07 },
  { key: '+하운드 5 CYC', opts: { ...BASE07, houndCostRaisedEnabled: true } },
];
const COMBOS_V02: { key: string; opts: Partial<SiegeOptions> }[] = [
  { key: 'off', opts: {} },
  { key: 'A', opts: { iceUpkeepEnabled: true } },
  { key: 'B', opts: { coreDirectDamageEnabled: true } },
  { key: 'C', opts: { suddenDeathEnabled: true } },
  { key: 'A+B', opts: { iceUpkeepEnabled: true, coreDirectDamageEnabled: true } },
  { key: 'A+C', opts: { iceUpkeepEnabled: true, suddenDeathEnabled: true } },
  { key: 'B+C', opts: { coreDirectDamageEnabled: true, suddenDeathEnabled: true } },
  { key: 'A+B+C', opts: { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true } },
];
const COMBOS: { key: string; opts: Partial<SiegeOptions>; ai?: AiFlags }[] = SET === 'v08' ? COMBOS_V08 : SET === 'v07' ? COMBOS_V07 : SET === 'v06' ? COMBOS_V06 : SET === 'v05' ? COMBOS_V05 : SET === 'v04' ? COMBOS_V04 : SET === 'v03' ? COMBOS_V03 : COMBOS_V02;
// 표 표시 순서 (v03: 기준선 → 이전 최선 → (1)(2)(3))
const SHOW = SET === 'v03' ? ['off', 'A+B+C', 'C+D1+D2', 'C+D1+D2+D3', 'A+B+C+D1+D2+D3', 'A+B+C+D2+D3 (참고)'].map((k) => COMBOS.find((c) => c.key === k)!) : COMBOS;

interface Result {
  styleA: AiStyle; styleB: AiStyle; turns: number; reason: string; winner: string;
  peakLossA: number; peakLossB: number; sdKill: boolean; reclaims: number; repairs: number; links: number; linkKills: number; honey: number; neutralData: number; breachData: number; totalData: number; winnerData: number; siegerBreach: number; siegerGames: number; vaultData: number; siegerGateTurns: number[]; siegerCoreDmg: number; gateTurns: { style: AiStyle; turn: number }[]; siegerEngage: number[]; heat: { style: AiStyle; pull: number; high: number; tb: number }[]; siegerWave: { wiped: boolean; allLost: boolean; houndKills: number; linkKills: number; jackouts: number; tbKills: number; otherKills: number; size: number; turn: number }[]; sig: string;
}

function play(opts: Partial<SiegeOptions>, sa: AiStyle, sb: AiStyle, seedA: number, seedB: number, ai: AiFlags = {}): Result {
  // 설정 고정: 기본값(v0.3 확정 조합)이 바뀌어도 기록된 수치를 재현하도록 '전체 off' 위에 조합 옵션만 얹는다
  let s: MatchState = createMatch({ ...SIEGE_ALL_OFF, ...opts });
  let minA = s.nodes.AC.hp, minB = s.nodes.BC.hp;
  let reclaims = 0, repairs = 0, guard = 0, links = 0, linkKills = 0, honey = 0;
  // 공성형 첫 오거 파도: 공성형이 처음으로 오거를 발사한 턴의 오거들. 게이트 돌파 전에 전부 삭제되고 그 삭제가 모두 하운드 피해를 받은 턴에 일어났으면 '하운드에 전멸'
  const wave: Record<'A' | 'B', { ids: number[]; dead: Set<number>; hound: Set<number>; link: Set<number>; out: Set<number>; tb: Set<number>; turn: number; lastDeath: number } | null> = { A: null, B: null };
  const engage: Record<'A' | 'B', number> = { A: 0, B: 0 }; // 상대 게이트(ICE 또는 본체)에 처음 피해를 준 턴
  const gateTurn: Record<'A' | 'B', number> = { A: 0, B: 0 }; // 각 쪽이 상대 게이트를 처음 부순 턴
  while (!s.over && guard++ < 50) {
    const oa = aiOrders(s, 'A', sa, seedA, ai), ob = aiOrders(s, 'B', sb, seedB, ai);
    repairs += [...oa, ...ob].filter((o) => o.type === 'repair' && o.node.endsWith('C')).length;
    s = resolveTurn(s, oa, ob);
    minA = Math.min(minA, s.nodes.AC.hp); minB = Math.min(minB, s.nodes.BC.hp);
    reclaims += s.log.filter((l) => l.text.includes('강제 회수')).length;
    for (const p of ['A', 'B'] as const) {
      if ((p === 'A' ? sa : sb) !== 'sieger') continue;
      const w0 = wave[p];
      if (!w0) {
        const ids = s.log.map((l) => l.text.match(new RegExp(`^\\[${p}\\] 오거#(\\d+) 발사`))).filter(Boolean).map((m) => Number(m![1]));
        if (ids.length) wave[p] = { ids, dead: new Set(), hound: new Set(), link: new Set(), out: new Set(), tb: new Set(), turn: s.turn, lastDeath: 0 };
      }
      const w = wave[p];
      if (!w) continue;
      for (const id of w.ids) {
        if (w.dead.has(id) || w.out.has(id)) continue;
        if (s.log.some((l) => l.text.startsWith(`[${p}] 오거#${id} 철수`))) { w.out.add(id); continue; }
        // 역추적(HEAT 100)은 그 플레이어의 프로그램 전원을 삭제한다 — 로그 형식이 달라 따로 잡는다
        if (s.log.some((l) => l.text.startsWith(`★ 역추적(TRACEBACK)! [${p}]`) && new RegExp(`오거#${id}(?!\\d)`).test(l.text))) { w.dead.add(id); w.tb.add(id); w.lastDeath = s.turn; continue; }
        if (s.log.some((l) => l.text.includes(`오거#${id}[${p}] `) && l.text.includes('삭제됨'))) {
          w.dead.add(id); w.lastDeath = s.turn;
          if (s.log.some((l) => l.text.includes(`오거#${id}[${p}] 링크 교전에서 삭제됨`))) w.link.add(id);
          if (s.log.some((l) => l.step === 4 && /^하운드#\d+\[[AB]\] → /.test(l.text) && l.text.includes(`→ 오거#${id}[${p}]`))) w.hound.add(id);
        }
      }
    }
    for (const p of ['A', 'B'] as const) if (!engage[p] && s.log.some((l) => l.step === 4 && l.text.includes(`[${p}] →`) && l.text.includes(`@ ${p === 'A' ? 'B' : 'A'} 게이트`))) engage[p] = s.turn;
    if (!gateTurn.A && (s.nodes.BG1.destroyed || s.nodes.BG2.destroyed)) gateTurn.A = s.turn;
    if (!gateTurn.B && (s.nodes.AG1.destroyed || s.nodes.AG2.destroyed)) gateTurn.B = s.turn;
    links += s.log.filter((l) => l.text.startsWith('링크 교전!')).length;
    linkKills += s.log.filter((l) => l.text.includes('링크 교전에서 삭제됨')).length;
    honey += s.log.filter((l) => l.step === 3 && l.text.includes('허니팟에 묶여')).length;
  }
  if (!s.over) throw new Error('match did not terminate');
  const last = s.turnLogs[s.turnLogs.length - 1].log;
  const sdKill = s.winReason === 'core' && last.some((l) => l.step === 5 && l.text.includes('코어 파괴'));
  return {
    styleA: sa, styleB: sb, turns: s.turn, reason: s.winReason!, winner: s.winner!,
    peakLossA: (s.nodes.AC.maxHp - minA) / 10, peakLossB: (s.nodes.BC.maxHp - minB) / 10, sdKill, reclaims, repairs, links, linkKills, honey,
    neutralData: (s.players.A.neutralData + s.players.B.neutralData) / 2, breachData: (s.players.A.breachData + s.players.B.breachData) / 2,
    vaultData: (s.players.A.vaultData + s.players.B.vaultData) / 2,
    siegerGateTurns: [...(sa === 'sieger' ? [gateTurn.A] : []), ...(sb === 'sieger' ? [gateTurn.B] : [])],
    heat: (['A', 'B'] as const).map((p) => ({ style: p === 'A' ? sa : sb, pull: s.players[p].heatPulloutTurns, high: s.players[p].heatHighTurns, tb: s.players[p].tracebacks })),
    siegerWave: (['A', 'B'] as const).filter((p) => (p === 'A' ? sa : sb) === 'sieger' && wave[p]).map((p) => {
      const w = wave[p]!;
      const broke = gateTurn[p];
      const lost = w.dead.size + w.out.size === w.ids.length && (!broke || w.lastDeath < broke);
      return { wiped: lost && w.out.size === 0 && w.hound.size === w.ids.length, allLost: lost, houndKills: w.hound.size, linkKills: w.link.size, jackouts: w.out.size, tbKills: w.tb.size, otherKills: w.dead.size - w.hound.size - w.link.size - w.tb.size, size: w.ids.length, turn: w.turn };
    }),
    siegerEngage: [...(sa === 'sieger' ? [engage.A] : []), ...(sb === 'sieger' ? [engage.B] : [])],
    gateTurns: [{ style: sa, turn: gateTurn.A }, { style: sb, turn: gateTurn.B }],
    siegerCoreDmg: (sa === 'sieger' ? s.players.A.coreDmgDealt / 10 : 0) + (sb === 'sieger' ? s.players.B.coreDmgDealt / 10 : 0),
    siegerBreach: (sa === 'sieger' ? s.players.A.breachData / 2 : 0) + (sb === 'sieger' ? s.players.B.breachData / 2 : 0), siegerGames: (sa === 'sieger' ? 1 : 0) + (sb === 'sieger' ? 1 : 0),
    totalData: (s.players.A.data + s.players.B.data) / 2,
    winnerData: s.winner === 'A' || s.winner === 'B' ? s.players[s.winner].data / 2 : 0,
    sig: JSON.stringify([s.winner, s.winReason, s.turn, s.players.A.data, s.players.B.data, s.nodes.AC.hp, s.nodes.BC.hp, s.players.A.heat, s.players.B.heat]),
  };
}

function summarize(rs: Result[]) {
  const n = rs.length;
  const pct = (k: number) => (100 * k) / n;
  const coreDmg = rs.filter((r) => r.peakLossA >= 1 || r.peakLossB >= 1).length;
  const decisive = rs.filter((r) => r.peakLossA >= 40 || r.peakLossB >= 40).length;
  const meanLoss = rs.reduce((a, r) => a + (r.peakLossA + r.peakLossB) / 2, 0) / n;
  const time = rs.filter((r) => r.reason === 'time').length;
  const draw = rs.filter((r) => r.winner === 'draw').length;
  const core = rs.filter((r) => r.reason === 'core').length;
  const data = rs.filter((r) => r.reason === 'data').length;
  const timeWin = rs.filter((r) => r.reason === 'time' && r.winner !== 'draw').length;
  const drawNonTime = rs.filter((r) => r.reason !== 'time' && r.winner === 'draw').length;
  const turns = rs.reduce((a, r) => a + r.turns, 0) / n;
  const sdKills = rs.filter((r) => r.sdKill).length;
  const distinct = new Set(rs.map((r) => r.sig)).size;
  const reclaims = rs.reduce((a, r) => a + r.reclaims, 0) / n;
  const repairs = rs.reduce((a, r) => a + r.repairs, 0) / n;
  const links = rs.reduce((a, r) => a + r.links, 0) / n, linkKills = rs.reduce((a, r) => a + r.linkKills, 0) / n;
  const neutralShare = rs.reduce((a, r) => a + r.totalData, 0) ? (100 * rs.reduce((a, r) => a + r.neutralData, 0)) / rs.reduce((a, r) => a + r.totalData, 0) : 0;
  const dataPerGame = rs.reduce((a, r) => a + r.totalData, 0) / n;
  const neutralPer = rs.reduce((a, r) => a + r.neutralData, 0) / n, breachPer = rs.reduce((a, r) => a + r.breachData, 0) / n;
  const vaultPer = rs.reduce((a, r) => a + r.vaultData, 0) / n; // 금고 사이펀 누적 (엔진 집계)
  const sgN = rs.reduce((a, r) => a + r.siegerGames, 0);
  const siegerBreachAvg = sgN ? rs.reduce((a, r) => a + r.siegerBreach, 0) / sgN : 0;
  const sgTurns = rs.flatMap((r) => r.siegerGateTurns);
  const siegerGatePct = sgTurns.length ? (100 * sgTurns.filter((t) => t > 0).length) / sgTurns.length : 0;
  const siegerGateTurn = sgTurns.filter((t) => t > 0).length ? sgTurns.filter((t) => t > 0).reduce((a, b) => a + b, 0) / sgTurns.filter((t) => t > 0).length : 0;
  const siegerCoreDmg = sgN ? rs.reduce((a, r) => a + r.siegerCoreDmg, 0) / sgN : 0;
  // 게이트 돌파 (모든 성향, 각 측 = 1표본): 돌파율과 돌파한 경우의 평균 턴
  const gstat = (xs: { turn: number }[]) => { const b = xs.filter((g) => g.turn > 0); return { n: xs.length, pct: xs.length ? (100 * b.length) / xs.length : 0, turn: b.length ? b.reduce((a, g) => a + g.turn, 0) / b.length : 0, by12: xs.length ? (100 * b.filter((g) => g.turn <= 12).length) / xs.length : 0 }; };
  const engs = rs.flatMap((r) => r.siegerEngage);
  const siegerEngage = { pct: engs.length ? (100 * engs.filter((t) => t > 0).length) / engs.length : 0, turn: engs.filter((t) => t > 0).length ? engs.filter((t) => t > 0).reduce((a, b) => a + b, 0) / engs.filter((t) => t > 0).length : 0, by5: engs.length ? (100 * engs.filter((t) => t > 0 && t <= 5).length) / engs.length : 0 };
  const allG = rs.flatMap((r) => r.gateTurns);
  const gateAll = gstat(allG);
  const gateByStyle = Object.fromEntries(AI_STYLES.map((st) => [st, gstat(allG.filter((g) => g.style === st))]).filter(([, g]) => (g as { n: number }).n > 0));
  // [기획 v0.3.1] HEAT 80 집계: 측(플레이어)당 판 평균
  const hs = rs.flatMap((r) => r.heat);
  const hstat = (xs: typeof hs) => ({ n: xs.length, pull: xs.reduce((a, h) => a + h.pull, 0) / (xs.length || 1), high: xs.reduce((a, h) => a + h.high, 0) / (xs.length || 1), tb: xs.reduce((a, h) => a + h.tb, 0) / (xs.length || 1), pullAny: (100 * xs.filter((h) => h.pull > 0).length) / (xs.length || 1) });
  const heatAll = hstat(hs);
  const heatByStyle = Object.fromEntries(AI_STYLES.map((st) => [st, hstat(hs.filter((h) => h.style === st))]).filter(([, h]) => (h as { n: number }).n > 0));
  const waves = rs.flatMap((r) => r.siegerWave);
  const tot = waves.reduce((a, w) => a + w.size, 0) || 1;
  const siegerWave = { allLostPct: waves.length ? (100 * waves.filter((w) => w.allLost).length) / waves.length : 0, linkShare: (100 * waves.reduce((a, w) => a + w.linkKills, 0)) / tot, jackShare: (100 * waves.reduce((a, w) => a + w.jackouts, 0)) / tot, tbShare: (100 * waves.reduce((a, w) => a + w.tbKills, 0)) / tot, otherShare: (100 * waves.reduce((a, w) => a + w.otherKills, 0)) / tot, n: waves.length, wipedPct: waves.length ? (100 * waves.filter((w) => w.wiped).length) / waves.length : 0, size: waves.length ? waves.reduce((a, w) => a + w.size, 0) / waves.length : 0, houndKillShare: waves.reduce((a, w) => a + w.size, 0) ? (100 * waves.reduce((a, w) => a + w.houndKills, 0)) / waves.reduce((a, w) => a + w.size, 0) : 0, turn: waves.length ? waves.reduce((a, w) => a + w.turn, 0) / waves.length : 0 };
  const dataWins = rs.filter((r) => r.reason === 'data');
  const dataWinTurn = dataWins.length ? dataWins.reduce((a, r) => a + r.turns, 0) / dataWins.length : 0;
  const linkGames = pct(rs.filter((r) => r.links > 0).length), honey = rs.reduce((a, r) => a + r.honey, 0) / n;
  // 성향별 승률 (해당 성향이 등장한 판 기준, 미러전 제외)
  const styleWin: Record<string, { w: number; g: number }> = {};
  for (const r of rs) {
    if (r.styleA === r.styleB) continue;
    for (const [side, st] of [['A', r.styleA], ['B', r.styleB]] as const) {
      styleWin[st] ??= { w: 0, g: 0 };
      styleWin[st].g++;
      if (r.winner === side) styleWin[st].w++;
    }
  }
  const aWin = rs.filter((r) => r.winner === 'A').length, bWin = rs.filter((r) => r.winner === 'B').length;
  return {
    n, coreDmgPct: pct(coreDmg), decisivePct: pct(decisive), meanLoss, turns, timePct: pct(time),
    corePct: pct(core), dataPct: pct(data), timeWinPct: pct(timeWin), drawPct: pct(draw), drawNonTime,
    sdKillPct: pct(sdKills), distinct, reclaims, repairs, links, linkKills, linkGames, honey, neutralShare, dataPerGame, dataWinTurn, neutralPer, breachPer, vaultPer, siegerBreachAvg, siegerGatePct, siegerGateTurn, siegerCoreDmg, gateAll, gateByStyle, siegerEngage, siegerWave, heatAll, heatByStyle, aWinPct: pct(aWin), bWinPct: pct(bWin),
    styleWin: Object.fromEntries(Object.entries(styleWin).map(([k, v]) => [k, (100 * v.w) / v.g])),
    styleGames: Object.fromEntries(Object.entries(styleWin).map(([k, v]) => [k, v.g])),
  };
}
type Sum = ReturnType<typeof summarize>;

function score(x: Sum) {
  // 목표 구간 벗어난 정도의 합 (작을수록 좋음)
  const out = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  return out(x.coreDmgPct, 70, 100) + out(x.meanLoss, 30, 60) + out(x.decisivePct, 40, 100) + out(x.turns, 12, 16) * 5 +
    out(x.timePct, 0, 20) + out(x.corePct, 35, 50) + out(x.dataPct, 30, 45);
}

const t0 = Date.now();
const mixed: Record<string, Sum> = {}, planner: Record<string, Sum> = {};
const perMatchup: Record<string, Record<string, Sum>> = {};
const PLANNER_MATCHUPS: [AiStyle, AiStyle][] = [['balanced', 'balanced'], ['raider', 'balanced'], ['raider', 'raider']];
for (const c of COMBOS) {
  const rs: Result[] = [];
  AI_STYLES.forEach((sa, i) => AI_STYLES.forEach((sb, j) => {
    for (let k = 0; k < SEEDS_PER_PAIR; k++) rs.push(play(c.opts, sa, sb, 1000 * (i * 5 + j) + 2 * k + 1, 1000 * (i * 5 + j) + 2 * k + 2, c.ai));
  }));
  mixed[c.key] = summarize(rs);
  const prs: Result[] = [];
  perMatchup[c.key] = {};
  for (const [sa, sb] of PLANNER_MATCHUPS) {
    const sub: Result[] = [];
    for (let k = 0; k < PLANNER_SEEDS; k++) sub.push(play(c.opts, sa, sb, 50000 + 2 * k + 1, 50000 + 2 * k + 2, c.ai));
    perMatchup[c.key][`${sa}-${sb}`] = summarize(sub);
    prs.push(...sub);
  }
  planner[c.key] = summarize(prs);
  console.log(`${c.key.padEnd(6)} mixed n=${rs.length} planner n=${prs.length}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const f = (v: number, d = 1) => v.toFixed(d);
const mark = (ok: boolean) => (ok ? '✅' : '❌');
function table(title: string, data: Record<string, Sum>) {
  const L: string[] = [];
  L.push(`### ${title}`, '');
  L.push('| 조합 | 판수 | 서로 다른 결과 | 코어 피해 발생률 (≥70%) | 평균 코어 피해 (30~60) | 결정적 코어 피해 (≥40%) | 평균 턴 (12~16) | 시간 판정 (≤20%) | 코어 승 (35~50%) | 데이터 승 (30~45%) | 시간 승 | 무승부 | 서든데스가 끝낸 판 | 목표 이탈 점수 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of SHOW) {
    const x = data[c.key];
    L.push(`| ${c.key} | ${x.n} | ${x.distinct} | ${f(x.coreDmgPct)}% ${mark(x.coreDmgPct >= 70)} | ${f(x.meanLoss)} ${mark(x.meanLoss >= 30 && x.meanLoss <= 60)} | ${f(x.decisivePct)}% ${mark(x.decisivePct >= 40)} | ${f(x.turns)} ${mark(x.turns >= 12 && x.turns <= 16)} | ${f(x.timePct)}% ${mark(x.timePct <= 20)} | ${f(x.corePct)}% ${mark(x.corePct >= 35 && x.corePct <= 50)} | ${f(x.dataPct)}% ${mark(x.dataPct >= 30 && x.dataPct <= 45)} | ${f(x.timeWinPct)}% | ${f(x.drawPct)}% | ${f(x.sdKillPct)}% | ${f(score(x))} |`);
  }
  return L.join('\n');
}
const best = (d: Record<string, Sum>) => SHOW.map((c) => c.key).sort((a, b) => score(d[a]) - score(d[b]));

const md: string[] = [];
const OUT = SET === 'v08' ? '../balance_results_v0.8.md' : SET === 'v07' ? '../balance_results_v0.7.md' : SET === 'v06' ? '../balance_results_v0.6.md' : SET === 'v05' ? '../balance_results_v0.5.md' : SET === 'v04' ? '../balance_results_v0.4.md' : SET === 'v03' ? '../balance_results_v0.3.md' : '../balance_results_v0.2.md';
md.push(SET === 'v08' ? '# COLD CORE v0.8 (기획 v0.3 확정 기준선 vs 하운드 비용 5) — 헤드리스 AI 대전 측정 결과' : SET === 'v07' ? "# COLD CORE v0.7 (V1 · V2 · C'' · AI 조기 공성) — 헤드리스 AI 대전 측정 결과" : SET === 'v06' ? "# COLD CORE v0.6 (G2' · G3 · C') — 헤드리스 AI 대전 측정 결과" : SET === 'v05' ? '# COLD CORE v0.5 (E1\' · G1 · G2) — 헤드리스 AI 대전 측정 결과' : SET === 'v04' ? '# COLD CORE 코어 브리치 데이터 v0.4 — 헤드리스 AI 대전 측정 결과' : SET === 'v03' ? '# COLD CORE 데이터 감속안 v0.3 — 헤드리스 AI 대전 측정 결과' : '# COLD CORE 공성 압박 보정안 v0.2 — 헤드리스 AI 대전 측정 결과', '');
md.push(`생성: \`npm run balance\` (scripts/balance.ts${SET !== 'v02' ? `, \`SET=${SET}\`` : ''}). 실행 시간 ${((Date.now() - t0) / 1000).toFixed(1)}초. 모든 수치는 실제 실행 결과이며, 시뮬레이션과 AI가 결정론적이라 같은 명령으로 다시 돌리면 같은 숫자가 나온다.`, '');
md.push('## 방법', '');
if (SET === 'v08') {
  md.push("- **기준선 (대조)** = 기획 v0.3 확정안 A+B+C+D2+D3+E2+E1'+G2'+C' (H off, 공성형 AI 조기 공성 플래그 off, 데이터 목표 12). v0.6 +C' 행·v0.7 '기준선 (AI 변경 전)' 행과 같은 설정·같은 시드라 같은 숫자가 나와야 한다 (재현 대조).");
  md.push('- **+하운드 5 CYC** = 기준선 + 하운드 컴파일 비용 4 → 5 [기획 v0.3 측정]. HP·피해·BW는 그대로. 회수 환급은 floor(5×50%) = 2로 4일 때와 같다. AI 코드는 바꾸지 않았다 (AI의 하운드 설치도 같은 비용 검사를 거치므로 CYC가 모자라면 자동으로 못 짓는다).');
  md.push("- 목표: 공성형 승률 ≥35%, 데이터 승 ≤45% (두 풀), 시간 판정 ≤20%, **평균 턴 14~18** (v0.8부터), 코어 승 35~50%, 평균 게이트 돌파 턴 ≤12.");
  md.push("- 진단 지표: **공성형 첫 오거 파도** = 공성형이 처음으로 오거를 발사한 턴에 나간 오거 전부. '하운드에 전멸' = 그 오거가 게이트 돌파 전에 모두 삭제되었고, 각 오거가 삭제된 턴에 하운드 피해를 받았음 (로그 기준). 링크 교전·철수·코어 ICE 등 다른 원인이 하나라도 섞이면 전멸로 세지 않는다. 비교용으로 '돌파 전 전부 소실 (원인 무관, 철수 포함)'과 오거별 운명(하운드 피해를 받은 턴에 삭제 / 링크 교전 삭제 / 철수 / 역추적(HEAT 100)으로 전원 삭제 / 그 밖의 삭제, 나머지는 돌파 또는 경기 종료까지 생존)도 함께 잰다.");
  md.push('- 게이트 돌파 = 상대 게이트 2개 중 하나를 처음 파괴한 턴. "T12 이내 비율"은 해당 측 표본 전체(돌파 못 한 판 포함) 대비. 평균 돌파 턴은 돌파한 경우만.');
} else if (SET === 'v07') {
  md.push("- **기준선** = A+B+C+D2+D3+E2+E1'+G2'+C' (G3 제외, H off, 데이터 목표 12). 조합 6개: 기준선(AI 변경 전 = v0.6 +C' 행과 같은 설정) / 기준선(AI 조기 공성) / 이하 모두 AI 조기 공성으로 +V1 / +V2 / +V1+C'' / +V1+V2+C''. 수치는 기획 예시값.");
  md.push("- V1 = 금고 데이터 4 → 3점. V2 = 사이펀 탈취 1 → 0.5점/턴 (내부 ×2 정수 = 1). C'' = C'와 같이 T13·6 피해로 시작하되 매 턴 +2 (13..20턴 합 104, C'는 132).");
  md.push('- **AI 조기 공성** (`AiFlags.siegerEarlyGate`, 밸런스 러너만 켬 — 브라우저 AI는 그대로): 공성형만 바뀐다. 셰이드 2기를 먼저 게이트로 보내 하운드를 치고, 오거는 그 게이트 쪽 중립 노드에 모았다가 정찰상 게이트에 하운드가 없거나 **늦어도 T5**에 전부 게이트로 돌입. 돌입 후에는 하운드 정보와 무관하게 오거 최대치 유지. 다른 성향은 변경 없음.');
  md.push('- 참고(측정): 변경 전 공성형도 이미 T1~T2에 오거를 발사해 대부분 T3~T4에 게이트를 친다 (아래 "공성형 첫 게이트 교전"). 변경 전 문제는 시작이 늦은 것이 아니라, 첫 파도가 하운드에 한 번에 지워져 돌파가 T15 전후로 밀리는 것이었다.');
  md.push('- 게이트 돌파 = 해당 측이 상대 게이트 2개 중 하나를 처음 파괴한 턴. 평균 턴은 돌파한 경우만 (돌파 못 한 판은 돌파율·T12 이내 비율에만 반영). 공성형 노이즈 폭 = 비미러 공성형 판수 n에서 95% 정규근사 ±1.96·√(p(1−p)/n).');
} else if (SET === 'v06') {
  md.push("- 조합 4개: **기준선** = A+B+C+D2+D3+E2+E1'+G2' (데이터 목표 12, D1 off, H off) / +G3 / +C' / +G3+C'. 수치는 기획 예시값.");
  md.push("- G2' = G2 관통 비율 50% → 75% (G2 포함). 관통분에 B ×2 적용, 노드 ×1.5 미적용 — v0.5와 같은 [추정] 해석.");
  md.push("- G3 = 게이트 ICE 슬롯 3 → 2, 게이트 HP 20 (G1 포함). C' = 서든데스 T13 시작, 고정 피해 6에서 매 턴 +3 (13..20턴: 6,9,…,27), C 포함·C 수치 대체, 안개 해제는 C와 같음.");
  md.push("- AI는 v0.5와 동일 — G2'/G3/C'를 따로 인지하는 AI 변경 없음. 기존 AI 구축 배치는 게이트당 ICE 최대 2개라 G3에서도 그대로 유효. 서든데스 시점 인지(코어 수리 기준 상향)는 옵션 시작 턴을 읽으므로 C'에 자동으로 따라감.");
  md.push('- 게이트 돌파 = 해당 측이 상대 게이트 2개 중 하나를 처음 파괴한 턴. 평균 턴은 돌파한 경우만의 평균 (돌파 못 한 판은 돌파율에만 반영).');
} else if (SET === 'v05') {
  md.push("- 조합 4개: **기준선** = A+B+C+D2+D3+E2+E1' (데이터 목표 12, D1 off) / +G1 / +G2 / +G1+G2. 수치는 기획 예시값.");
  md.push("- E1' = 브리치 데이터(누적 코어 피해 20당 +2, 최대 +10)는 데이터 승리에 넣지 않고 20턴 시간 판정 점수에만 더함. E2의 중립 상한 4 유지. 서든데스 피해는 브리치 누적에서 제외 [추정].");
  md.push('- G1 = 게이트 HP 30→20. G2 = 오거가 ICE 있는 코어를 칠 때 피해의 50%가 코어 본체로 관통(E1 누적 포함, B ×2 적용 [추정], 노드 ×1.5 미적용 [추정]).');
  md.push('- AI는 v0.4와 동일 (E1/E2가 켜지면 공성형만 코어 집중). G1/G2/E1\'을 따로 인지하는 AI 변경 없음. 숨은 금고(H)는 이 측정 뒤에 구현되어 측정에 포함되지 않음 (기본 off).');
} else if (SET === 'v04') {
  md.push('- 조합 3개: **기준선** = A+B+C+D2+D3 (데이터 목표 12, D1 off) / 기준선+E1 / 기준선+E2. 수치는 기획 예시값.');
  md.push('- E1 = 내 프로그램이 상대 코어 본체에 실제로 깎은 누적 HP 20마다 데이터 +2, 매치당 최대 +10. 수리로 카운터가 줄지 않음. 데이터 승리에 포함, D2 중립 상한과 무관. **서든데스 고정 피해는 공격자가 없어 세지 않음 [추정]**.');
  md.push('- E2 = E1 + 중립 데이터 상한 6 → 4.');
  md.push('- AI 변경은 **공성형(sieger)만**: E1/E2가 켜지면 게이트가 열렸을 때 오거 상한 +1, 노출도 여유 15→5, 코어에 붙은 오거가 있으면 오버클럭(노출도 45 미만). 다른 성향은 v0.3과 동일.');
} else if (SET === 'v03') {
  md.push('- 조합 5개 (측정 순서): (1) C+D1+D2 → (2) C+D1+D2+D3 → (3) A+B+C+D1+D2+D3, 비교용 off(기준선)·A+B+C(v0.2 최선).');
  md.push('- D1 = 데이터 승리 12→20점, D2 = 중립 노드 데이터 누적 상한 6점/플레이어, D3 = 중립 데이터는 T6부터. 수치는 기획 예시값. A/B/C는 v0.2 그대로. 중립 데이터 0.25 하향안은 구현·측정하지 않음.');
  md.push('- 링크 교전 4개 규칙은 [기획 v0.3] 확정값 (×1.0, 은신 셰이드 통과, 최저 번호 상대, 처치 보상 없음).');
  md.push('- **주의: D1(20점)과 D2(중립 6점)를 함께 켜면 데이터 승리는 불가능하다.** 한 플레이어가 얻을 수 있는 최대 데이터 = 중립 6 + 상대 금고 2개 × 4 = 14점 < 20. 그래서 D1+D2 조합의 데이터 승은 구조적으로 0%다. 비교용으로 D1을 뺀 A+B+C+D2+D3(참고, 기획 미요청)를 추가 측정했다.');
  md.push('- AI는 D옵션을 인지하지 않는다 (중립 점령은 수입 +이므로 계속 시도). 시뮬레이션에는 "코어 공격으로 얻는 데이터"가 없어, D2 이후 데이터는 금고 사이펀 탈취로만 들어온다.');
} else md.push(`- 옵션 조합 8개: off / A(ICE 유지비) / B(코어 직접 피해 ×2) / C(서든데스) / A+B / A+C / B+C / A+B+C. 수치는 balance_options_v0.2.md 그대로.`);
md.push(`- **혼합 풀**: AI 성향 ${AI_STYLES.length}종(${AI_STYLES.map((s) => `${s}=${AI_STYLE_KO[s]}`).join(', ')})의 ${AI_STYLES.length ** 2}개 순서쌍 × 시드 ${SEEDS_PER_PAIR}개 = 조합당 ${AI_STYLES.length ** 2 * SEEDS_PER_PAIR}판.`);
md.push(`- **기획 매치업**: 균형-균형, 돌격-균형, 돌격-돌격 × 시드 ${PLANNER_SEEDS}개 = 조합당 ${3 * PLANNER_SEEDS}판 (기획서 14.5.4의 최소 50판 이상).`);
md.push('- 다양성은 AI 밖이 아닌 **AI 안에서만** 만든다: 시드가 구축 배치(3안), 오거 목표(코어/게이트/프로세서), 핑 위치, 사이펀 금고 선택, 노출도 한계 ±10, 25% 확률로 공격 한 턴 보류를 바꾼다. 시드는 AI 함수 인자이며 시뮬레이션 코어에는 들어가지 않는다.');
md.push('- AI는 옵션을 약하게 인지한다: 유지비가 수입-3을 넘으면 랜턴→벌워크→하운드 순으로 회수(코어 ICE 제외), 서든데스 직전·중에는 코어 수리 기준 80%→95% (돌격형 제외).');
md.push('- 코어 피해 = 매치 중 코어 HP 최저점 기준 손실(수리로 회복돼도 피해로 셈). 평균 코어 피해 = 양쪽 손실의 평균. 결정적 = 한쪽이라도 손실 40 이상 또는 파괴. 시간 판정 = 20턴 종료(무승부 포함).');
md.push('- "목표 이탈 점수" = 각 목표 구간에서 벗어난 %p(턴은 ×5)의 합. 0이면 모든 목표 충족. 작을수록 좋음.', '');
md.push('## 결과', '');
md.push(table(`기획 매치업 (균형-균형 / 돌격-균형 / 돌격-돌격, 조합당 ${3 * PLANNER_SEEDS}판)`, planner), '');
md.push(table(`혼합 풀 (성향 ${AI_STYLES.length}종 ${AI_STYLES.length ** 2}쌍, 조합당 ${AI_STYLES.length ** 2 * SEEDS_PER_PAIR}판)`, mixed), '');
md.push('### 기획 매치업별 세부 (조합 × 매치업)', '');
md.push('| 조합 | 매치업 | 서로 다른 결과 | 코어 피해 발생률 | 평균 턴 | 시간 판정 | 코어/데이터/시간/무 | 서든데스가 끝낸 판 |');
md.push('|---|---|---|---|---|---|---|---|');
for (const c of SHOW) for (const [k, x] of Object.entries(perMatchup[c.key])) md.push(`| ${c.key} | ${k} | ${x.distinct}/${x.n} | ${f(x.coreDmgPct)}% | ${f(x.turns)} | ${f(x.timePct)}% | ${f(x.corePct, 0)}/${f(x.dataPct, 0)}/${f(x.timeWinPct, 0)}/${f(x.drawPct, 0)}% | ${f(x.sdKillPct)}% |`);
md.push('');
md.push('### 성향별 승률 (혼합 풀, 미러전 제외) · 기타 지표', '');
md.push(`| 조합 | ${AI_STYLES.map((s) => AI_STYLE_KO[s]).join(' | ')} | A측 승 / B측 승 | 판당 강제 회수 | 판당 코어 수리 | 링크 교전 발생 판 | 판당 링크 교전 / 처치 | 판당 허니팟 정지 |`);
md.push(`|---|${AI_STYLES.map(() => '---').join('|')}|---|---|---|---|---|---|`);
for (const c of SHOW) { const x = mixed[c.key]; md.push(`| ${c.key} | ${AI_STYLES.map((s) => f(x.styleWin[s] ?? 0) + '%').join(' | ')} | ${f(x.aWinPct)}% / ${f(x.bWinPct)}% | ${f(x.reclaims, 2)} | ${f(x.repairs, 2)} | ${f(x.linkGames)}% | ${f(x.links, 2)} / ${f(x.linkKills, 2)} | ${f(x.honey, 2)} |`); }
md.push('');
if (SET === 'v04' || SET === 'v05' || SET === 'v06' || SET === 'v07' || SET === 'v08') {
  md.push('### 기획 목표 (혼합 풀 / 기획 매치업)', '');
  md.push('| 조합 | 공성형 승률 (≥35%) | 데이터 승 비율 (≤45%) — 혼합 / 기획 | 시간 판정 (≤20%) — 혼합 / 기획 | 돌격형 승률 | 탈취형 승률 | 공성형 판당 브리치 데이터 | 공성형 게이트 돌파율 / 평균 턴 | 공성형 판당 코어 본체 피해 |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of SHOW) { const x = mixed[c.key], y = planner[c.key]; const sg = x.styleWin.sieger ?? 0; md.push(`| ${c.key} | ${f(sg)}% ${mark(sg >= 35)} | ${f(x.dataPct)}% ${mark(x.dataPct <= 45)} / ${f(y.dataPct)}% ${mark(y.dataPct <= 45)} | ${f(x.timePct)}% ${mark(x.timePct <= 20)} / ${f(y.timePct)}% ${mark(y.timePct <= 20)} | ${f(x.styleWin.raider ?? 0)}% | ${f(x.styleWin.thief ?? 0)}% | ${f(x.siegerBreachAvg, 2)} | ${f(x.siegerGatePct)}% / ${x.siegerGateTurn ? 'T' + f(x.siegerGateTurn) : '-'} | ${f(x.siegerCoreDmg)} |`); }
  md.push('');
  md.push('### 데이터 출처 (판당 양쪽 합, 점)', '');
  md.push(`| 조합 | 풀 | 중립 | 금고 탈취 | 코어 브리치 (E1${SET === 'v05' || SET === 'v06' || SET === 'v07' || SET === 'v08' ? "', 시간 판정에만" : ''}) | 합계 | 중립 / 금고 / 브리치 비율 |`);
  md.push('|---|---|---|---|---|---|---|');
  for (const c of SHOW) for (const [pool, x] of [['혼합', mixed[c.key]], ['기획 매치업', planner[c.key]]] as const) {
    const tot = x.neutralPer + x.vaultPer + x.breachPer; const t = tot || 1;
    md.push(`| ${c.key} | ${pool} | ${f(x.neutralPer, 2)} | ${f(x.vaultPer, 2)} | ${f(x.breachPer, 2)} | ${f(tot, 2)} | ${f((100 * x.neutralPer) / t)}% / ${f((100 * x.vaultPer) / t)}% / ${f((100 * x.breachPer) / t)}% |`);
  }
  md.push('');
}
if (SET === 'v08') {
  md.push('### v0.8 목표 요약 (✅/❌ = 측정값이 목표를 충족하는지)', '');
  md.push('| 조합 | 공성형 승률 ≥35% (95% 노이즈 폭, n) | 데이터 승 ≤45% 혼합 / 기획 | 시간 판정 ≤20% 혼합 / 기획 | 평균 턴 14~18 혼합 / 기획 | 코어 승 35~50% 혼합 / 기획 | 평균 게이트 돌파 턴 ≤12 공성형 / 전체(혼합) / 전체(기획) | 서든데스 종결 혼합 / 기획 | 돌격형 / 탈취형 승률 |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of SHOW) {
    const x = mixed[c.key], y = planner[c.key]; const sg = x.styleWin.sieger ?? 0; const n = x.styleGames.sieger ?? 0; const band = n ? 1.96 * Math.sqrt((sg / 100) * (1 - sg / 100) / n) * 100 : 0;
    const sgT = x.gateByStyle.sieger?.turn ?? 0; const t = (v: number) => (v ? 'T' + f(v) : '-');
    md.push(`| ${c.key} | ${f(sg)}% ±${f(band)} (n=${n}) ${mark(sg >= 35)} | ${f(x.dataPct)}% ${mark(x.dataPct <= 45)} / ${f(y.dataPct)}% ${mark(y.dataPct <= 45)} | ${f(x.timePct)}% ${mark(x.timePct <= 20)} / ${f(y.timePct)}% ${mark(y.timePct <= 20)} | ${f(x.turns)} ${mark(x.turns >= 14 && x.turns <= 18)} / ${f(y.turns)} ${mark(y.turns >= 14 && y.turns <= 18)} | ${f(x.corePct)}% ${mark(x.corePct >= 35 && x.corePct <= 50)} / ${f(y.corePct)}% ${mark(y.corePct >= 35 && y.corePct <= 50)} | ${t(sgT)} ${mark(sgT > 0 && sgT <= 12)} / ${t(x.gateAll.turn)} ${mark(x.gateAll.turn > 0 && x.gateAll.turn <= 12)} / ${t(y.gateAll.turn)} ${mark(y.gateAll.turn > 0 && y.gateAll.turn <= 12)} | ${f(x.sdKillPct)}% / ${f(y.sdKillPct)}% | ${f(x.styleWin.raider ?? 0)}% / ${f(x.styleWin.thief ?? 0)}% |`);
  }
  md.push('');
  md.push('### 진단: 공성형 첫 오거 파도 · 게이트 돌파 (혼합 풀, 공성형 표본)', '');
  md.push('| 조합 | 첫 파도 표본 | 첫 파도 평균 발사 턴 / 평균 오거 수 | 하운드에 전멸 | 돌파 전 전부 소실 (원인 무관) | 첫 파도 오거 운명: 하운드 / 링크 교전 / 철수 / 역추적 / 기타 삭제 | 첫 게이트 교전 평균 턴 / T5 이내 | 게이트 돌파율 | T12 이내 돌파 (표본 대비) | 평균 돌파 턴 (돌파한 경우) |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of SHOW) { const x = mixed[c.key]; const w = x.siegerWave; const g = x.gateByStyle.sieger; md.push(`| ${c.key} | ${w.n} | T${f(w.turn)} / ${f(w.size, 2)} | ${f(w.wipedPct)}% | ${f(w.allLostPct)}% | ${f(w.houndKillShare)}% / ${f(w.linkShare)}% / ${f(w.jackShare)}% / ${f(w.tbShare)}% / ${f(w.otherShare)}% | T${f(x.siegerEngage.turn)} / ${f(x.siegerEngage.by5)}% | ${g ? f(g.pct) + '%' : '-'} | ${g ? f(g.by12) + '%' : '-'} | ${g?.turn ? 'T' + f(g.turn) : '-'} |`); }
  md.push('');
  md.push(`### 노출도 집계 [기획 v0.3.1] (측당 판 평균, 혼합 풀)`, '');
  md.push(`- 정의: **HEAT ${HEAT_PULLOUT_THRESHOLD}+ 철수 턴** = 그 턴 시작 노출도 ≥${HEAT_PULLOUT_THRESHOLD}이고 그 턴에 공격 프로그램을 1개 이상 철수한 턴 (턴당 1회, 사람·AI 구분 없음). **HEAT ${HEAT_PULLOUT_THRESHOLD}+ 머문 턴** = 그 턴 시작 노출도 ≥${HEAT_PULLOUT_THRESHOLD}인 턴. **역추적** = HEAT 100 발동 횟수 (별도).`, '');
  md.push(`| 조합 | 항목 | 전체 | ${AI_STYLES.map((s) => AI_STYLE_KO[s]).join(' | ')} |`);
  md.push(`|---|---|---|${AI_STYLES.map(() => '---').join('|')}|`);
  for (const c of SHOW) {
    const x = mixed[c.key];
    const row = (label: string, g: (h: { pull: number; high: number; tb: number; pullAny: number }) => string) => md.push(`| ${c.key} | ${label} | ${g(x.heatAll)} | ${AI_STYLES.map((st) => (x.heatByStyle[st] ? g(x.heatByStyle[st]) : '-')).join(' | ')} |`);
    row(`HEAT ${HEAT_PULLOUT_THRESHOLD}+ 철수 턴 (판당 / 1회 이상 비율)`, (h) => `${f(h.pull, 2)} / ${f(h.pullAny)}%`);
    row(`HEAT ${HEAT_PULLOUT_THRESHOLD}+ 머문 턴 (판당)`, (h) => f(h.high, 2));
    row('역추적 HEAT 100 (판당)', (h) => f(h.tb, 2));
  }
  md.push('');
  md.push('### 게이트 돌파 T12 이내 비율 (표본 대비) — 성향별', '');
  md.push(`| 조합 | 풀 | 전체 | ${AI_STYLES.map((s) => AI_STYLE_KO[s]).join(' | ')} |`);
  md.push(`|---|---|---|${AI_STYLES.map(() => '---').join('|')}|`);
  for (const c of SHOW) for (const [pool, x] of [['혼합', mixed[c.key]], ['기획 매치업', planner[c.key]]] as const) md.push(`| ${c.key} | ${pool} | ${f(x.gateAll.by12)}% | ${AI_STYLES.map((s) => (x.gateByStyle[s] ? f(x.gateByStyle[s].by12) + '%' : '-')).join(' | ')} |`);
  md.push('');
}
if (SET === 'v07') {
  md.push('### v0.7 목표 요약 (✅/❌ = 측정값이 목표를 충족하는지)', '');
  md.push('| 조합 | 공성형 승률 ≥35% (95% 노이즈 폭, n) | 데이터 승 ≤45% 혼합 / 기획 | 시간 판정 ≤20% 혼합 / 기획 | 평균 턴 12~16 혼합 / 기획 | 코어 승 35~50% 혼합 / 기획 | 평균 게이트 돌파 턴 ≤12 공성형 / 전체(혼합) / 전체(기획) | 서든데스 종결 혼합 / 기획 | 돌격형 / 탈취형 승률 |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of SHOW) {
    const x = mixed[c.key], y = planner[c.key]; const sg = x.styleWin.sieger ?? 0; const n = x.styleGames.sieger ?? 0; const band = n ? 1.96 * Math.sqrt((sg / 100) * (1 - sg / 100) / n) * 100 : 0;
    const sgT = x.gateByStyle.sieger?.turn ?? 0;
    const t = (v: number) => (v ? 'T' + f(v) : '-');
    md.push(`| ${c.key} | ${f(sg)}% ±${f(band)} (n=${n}) ${mark(sg >= 35)} | ${f(x.dataPct)}% ${mark(x.dataPct <= 45)} / ${f(y.dataPct)}% ${mark(y.dataPct <= 45)} | ${f(x.timePct)}% ${mark(x.timePct <= 20)} / ${f(y.timePct)}% ${mark(y.timePct <= 20)} | ${f(x.turns)} ${mark(x.turns >= 12 && x.turns <= 16)} / ${f(y.turns)} ${mark(y.turns >= 12 && y.turns <= 16)} | ${f(x.corePct)}% ${mark(x.corePct >= 35 && x.corePct <= 50)} / ${f(y.corePct)}% ${mark(y.corePct >= 35 && y.corePct <= 50)} | ${t(sgT)} ${mark(sgT > 0 && sgT <= 12)} / ${t(x.gateAll.turn)} ${mark(x.gateAll.turn > 0 && x.gateAll.turn <= 12)} / ${t(y.gateAll.turn)} ${mark(y.gateAll.turn > 0 && y.gateAll.turn <= 12)} | ${f(x.sdKillPct)}% / ${f(y.sdKillPct)}% | ${f(x.styleWin.raider ?? 0)}% / ${f(x.styleWin.thief ?? 0)}% |`);
  }
  md.push('');
  md.push('### 공성형 공세 지표 (혼합 풀)', '');
  md.push('| 조합 | 첫 게이트 교전: 비율 / 평균 턴 / T5 이내 | 게이트 돌파율 / 평균 턴 / T12 이내 | 판당 코어 본체 피해 | 판당 브리치 데이터 |');
  md.push('|---|---|---|---|---|');
  for (const c of SHOW) { const x = mixed[c.key]; const g = x.gateByStyle.sieger; md.push(`| ${c.key} | ${f(x.siegerEngage.pct)}% / T${f(x.siegerEngage.turn)} / ${f(x.siegerEngage.by5)}% | ${g ? `${f(g.pct)}% / ${g.turn ? 'T' + f(g.turn) : '-'} / ${f(g.by12)}%` : '-'} | ${f(x.siegerCoreDmg)} | ${f(x.siegerBreachAvg, 2)} |`); }
  md.push('');
}
if (SET === 'v06' || SET === 'v07' || SET === 'v08') {
  md.push('### 게이트 돌파 (기획 목표: 평균 돌파 턴 ~T10) — 돌파율 / 돌파 시 평균 턴', '');
  md.push(`| 조합 | 풀 | 전체 성향 | ${AI_STYLES.map((s) => AI_STYLE_KO[s]).join(' | ')} |`);
  md.push(`|---|---|---|${AI_STYLES.map(() => '---').join('|')}|`);
  const g = (x: { pct: number; turn: number } | undefined) => (x ? `${f(x.pct)}% / ${x.turn ? 'T' + f(x.turn) : '-'}` : '-');
  for (const c of SHOW) for (const [pool, x] of [['혼합', mixed[c.key]], ['기획 매치업', planner[c.key]]] as const) md.push(`| ${c.key} | ${pool} | ${g(x.gateAll)} | ${AI_STYLES.map((s) => g(x.gateByStyle[s])).join(' | ')} |`);
  md.push('');
}
md.push('### 성향 목표 · 데이터 출처 (혼합 풀)', '');
md.push('| 조합 | 공성형 승률 (35~50%) | 돌격형 승률 | 탈취형 승률 | 판당 데이터 (양쪽 합, 점) | 데이터 중 중립 출처 비율 | 데이터 승리 판의 평균 턴 |');
md.push('|---|---|---|---|---|---|---|');
for (const c of SHOW) { const x = mixed[c.key]; const sg = x.styleWin.sieger ?? 0; md.push(`| ${c.key} | ${f(sg)}% ${mark(sg >= 35 && sg <= 50)} | ${f(x.styleWin.raider ?? 0)}% | ${f(x.styleWin.thief ?? 0)}% | ${f(x.dataPerGame)} | ${f(x.neutralShare)}% | ${x.dataWinTurn ? f(x.dataWinTurn) : '-'} |`); }
md.push('');
md.push('## 순위 (목표 이탈 점수 기준)', '');
md.push(`- 기획 매치업: ${best(planner).map((k) => `${k} (${f(score(planner[k]))})`).join(' → ')}`);
md.push(`- 혼합 풀: ${best(mixed).map((k) => `${k} (${f(score(mixed[k]))})`).join(' → ')}`, '');
// 손으로 쓴 '## 해석' 절이 이미 있으면 보존 (숫자가 바뀌었으면 해석도 다시 검토할 것)
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const keep = prev.indexOf('## 해석');
md.push(keep >= 0 ? prev.slice(keep).trimEnd() : '<!-- ANALYSIS -->');
writeFileSync(OUT, md.join('\n') + '\n');
writeFileSync(SET === 'v08' ? 'balance_results_v0.8.json' : SET === 'v07' ? 'balance_results_v0.7.json' : SET === 'v06' ? 'balance_results_v0.6.json' : SET === 'v05' ? 'balance_results_v0.5.json' : SET === 'v04' ? 'balance_results_v0.4.json' : SET === 'v03' ? 'balance_results_v0.3.json' : 'balance_results_v0.2.json', JSON.stringify({ planner, mixed, perMatchup }, null, 1));
console.log('best planner:', best(planner).slice(0, 3), 'best mixed:', best(mixed).slice(0, 3));
