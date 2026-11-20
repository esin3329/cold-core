/** [기획 v0.3 확정] 기본값 = 플레이테스트 조합. 이 파일만 엔진의 실제 기본값(createMatch())을 쓴다 */
import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { OPTION_TOGGLES, SIEGE_ALL_OFF, SIEGE_PRESSURE, SIEGE_V03_PRESET, V03_PRESET_ON } from '../src/sim/config';
import { createMatch, resolveTurn, suddenDeathDmg, socketsOf, timeScore } from '../src/sim/engine';
import type { MatchState } from '../src/sim/types';
import { viewFor } from '../src/sim/view';

const EXPECT_ON = ['iceUpkeepEnabled', 'coreDirectDamageEnabled', 'suddenDeathEnabled', 'suddenDeathEarlyEnabled', 'neutralDataCapEnabled', 'neutralDataDelayEnabled', 'coreBreachE2Enabled', 'breachTimeOnlyEnabled', 'augerPierceStrongEnabled', 'hiddenVaultsEnabled'].sort();
const EXPECT_OFF = ['gateSlotsReducedEnabled', 'suddenDeathGentleEnabled', 'vaultDataReducedEnabled', 'siphonSlowEnabled', 'houndCostRaisedEnabled', 'dataWinRaiseEnabled', 'coreBreachDataEnabled', 'gateHpReducedEnabled', 'augerPierceEnabled'].sort();

describe('기본값 = 기획 v0.3 확정 조합', () => {
  it('켜진 토글은 정확히 A·B·C·C\'·D2·D3·E2·E1\'·G2\'·H, 나머지(G3·C\'\'·V1·V2·K·D1·E1·G1·G2)는 off', () => {
    const on = OPTION_TOGGLES.filter((k) => SIEGE_PRESSURE[k]).sort();
    const off = OPTION_TOGGLES.filter((k) => !SIEGE_PRESSURE[k]).sort();
    expect(on).toEqual(EXPECT_ON);
    expect(off).toEqual(EXPECT_OFF);
    expect([...V03_PRESET_ON].sort()).toEqual(EXPECT_ON);
    expect(SIEGE_V03_PRESET).toEqual(SIEGE_PRESSURE);
    expect(OPTION_TOGGLES.every((k) => SIEGE_ALL_OFF[k] === false)).toBe(true);
    expect(SIEGE_ALL_OFF.suddenDeathRevealFog).toBe(true); // 하위 설정은 전체 off에서도 그대로
  });
  it('공성형 AI 조기 공성 플래그는 기본 off (플래그 없이 부른 AI = 플래그 false)', () => {
    let s = createMatch();
    for (let t = 0; t < 6; t++) {
      expect(JSON.stringify(aiOrders(s, 'A', 'sieger', 5))).toBe(JSON.stringify(aiOrders(s, 'A', 'sieger', 5, { siegerEarlyGate: false })));
      s = resolveTurn(s, aiOrders(s, 'A', 'sieger', 5), aiOrders(s, 'B', 'balanced', 6));
    }
  });
  it('정규화 결과: 서든데스 T13·6·+3, 관통 75% (G2\'가 G2 포함), 데이터 목표 12', () => {
    const o = createMatch().options;
    expect([o.suddenDeathStartTurn, o.suddenDeathCoreDmgPerTurn, o.suddenDeathCoreDmgStep]).toEqual([13, 6, 3]);
    expect([o.augerPierceEnabled, o.augerPiercePct]).toEqual([true, 75]);
    expect([12, 13, 14, 15, 20].map((t) => suddenDeathDmg(createMatch(), t))).toEqual([0, 6, 9, 12, 27]);
  });
});

describe('기본값 스모크: AI 대전 (H 포함)', () => {
  // 기본값 그대로 AI끼리 여러 판: 세 승리 조건, 서든데스 T13, H 금고 정체 공개를 모두 관찰
  const found: Record<string, MatchState | null> = { core: null, data: null, time: null };
  let sdChecked = 0, revealChecked = 0;
  const pairs: [string, string][] = AI_STYLES.flatMap((a) => AI_STYLES.map((b) => [a, b] as [string, string]));
  for (let k = 0; k < 4; k++) for (const [sa, sb] of pairs) {
    let s = createMatch();
    let hiddenAt12: string[] = [];
    while (!s.over) {
      if (s.turn === 12) hiddenAt12 = socketsOf('B').filter((id) => viewFor(s, 'A').nodes[id].hpHidden);
      if (s.turn === 13 && hiddenAt12.length) {
        const v = viewFor(s, 'A');
        for (const id of hiddenAt12) {
          expect(v.nodes[id].hpHidden).toBe(false);
          if (!v.nodes[id].destroyed) expect(v.nodes[id].shownKind).toBe(s.nodes[id].kind);
          if (s.nodes[id].kind === 'vault') expect(v.nodes[id].data).toBe(s.nodes[id].data / 2);
        }
        revealChecked += hiddenAt12.length;
      }
      s = resolveTurn(s, aiOrders(s, 'A', sa as any, 100 * k + 1), aiOrders(s, 'B', sb as any, 100 * k + 2));
      const tl = s.turnLogs[s.turnLogs.length - 1];
      if (tl.turn === 13 && !s.over) {
        expect(tl.log.some((l) => l.text.includes('서든데스 개시 (T13)'))).toBe(true);
        expect(tl.log.some((l) => l.text.includes('양쪽 코어 고정 피해 6 (다음 턴 9)'))).toBe(true);
        sdChecked++;
      }
      if (tl.turn === 14 && !s.over) expect(tl.log.some((l) => l.text.includes('양쪽 코어 고정 피해 9 (다음 턴 12)'))).toBe(true);
    }
    if (s.winReason && s.winReason in found && !found[s.winReason]) found[s.winReason] = s;
  }
  it('코어 파괴 승리가 나온다', () => {
    const s = found.core!;
    expect(s).toBeTruthy();
    const loser = s.winner === 'A' ? 'B' : 'A';
    expect(s.winner === 'draw' || s.nodes[loser + 'C'].hp <= 0).toBe(true);
  });
  it('데이터 12점 승리가 나온다 (브리치는 포함 안 됨)', () => {
    const s = found.data!;
    expect(s).toBeTruthy();
    if (s.winner === 'A' || s.winner === 'B') expect(s.players[s.winner].data).toBeGreaterThanOrEqual(24);
  });
  it('20턴 점수 판정이 나온다 (판정 로그에 브리치 항목)', () => {
    const s = found.time!;
    expect(s).toBeTruthy();
    expect(s.turn).toBeGreaterThanOrEqual(20);
    const line = s.log.find((l) => l.text.startsWith('시간 종료 판정'))!.text;
    expect(line).toContain(`A ${timeScore(s, 'A') / 2}점 = 데이터`);
    expect(line).toContain('브리치');
  });
  it('서든데스 T13 개시·6·+3 로그, H 소켓 정체가 T13에 공개됨을 실제 경기에서 확인', () => {
    console.log(`[스모크] 100판: 서든데스 T13 확인 ${sdChecked}판, T13 공개 확인 소켓 ${revealChecked}개, 승리 사유 core=${!!found.core} data=${!!found.data} time=${!!found.time}`);
    expect(sdChecked).toBeGreaterThan(0);
    expect(revealChecked).toBeGreaterThan(0);
  });
});
