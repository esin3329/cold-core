// 진단: 옵션 off, 혼합 풀(성향 5종 25쌍 × 시드 20 = 500판, balance.ts와 같은 시드)에서 경기 길이·데이터 출처·오거 코어 타격 집계
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { SIEGE_ALL_OFF } from '../src/sim/config';
import { createMatch, resolveTurn } from '../src/sim/engine';
let n = 0, ge8 = 0, ge15 = 0, wSiph = 0, wNeut = 0, augerCore = 0, gamesCoreHit = 0;
const hist: Record<number, number> = {};
AI_STYLES.forEach((sa, i) => AI_STYLES.forEach((sb, j) => { for (let k = 0; k < 20; k++) {
  let s = createMatch(SIEGE_ALL_OFF); const src = { A: { s: 0, n: 0 }, B: { s: 0, n: 0 } } as any; let hit = false;
  while (!s.over) {
    s = resolveTurn(s, aiOrders(s, 'A', sa, 1000 * (i * 5 + j) + 2 * k + 1), aiOrders(s, 'B', sb, 1000 * (i * 5 + j) + 2 * k + 2));
    for (const l of s.log) {
      let m = l.text.match(/\[([AB])\]에서? .*데이터 (\d)점 탈취/) ; const m2 = l.text.match(/^\S+\[([AB])\] .*데이터 1점 탈취/);
      if (m2) src[m2[1]].s += 1;
      const m3 = l.text.match(/^\[([AB])\] 중립 노드 (\d)개 보유/); if (m3) src[m3[1]].n += Number(m3[2]) / 2;
      if (l.text.includes('오거') && l.text.includes('→ 노드') && l.text.includes('코어')) { augerCore++; hit = true; }
    }
  }
  n++; if (s.turn >= 8) ge8++; if (s.turn >= 15) ge15++; hist[s.turn] = (hist[s.turn] ?? 0) + 1; if (hit) gamesCoreHit++;
  if (s.winner === 'A' || s.winner === 'B') { wSiph += src[s.winner].s; wNeut += src[s.winner].n; }
}}));
console.log({ n, ge8: ge8 / n, ge15: ge15 / n, winnerSiphonAvg: wSiph / n, winnerNeutralAvg: wNeut / n, augerCoreHits: augerCore, gamesWithAugerCoreHit: gamesCoreHit, hist });
