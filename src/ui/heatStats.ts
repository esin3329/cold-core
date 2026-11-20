import { HEAT_PULLOUT_THRESHOLD } from '../sim/config';

/** 결과 화면 노출도 통계 행 [기획 v0.3.1] — 툴팁에 정의를 그대로 적는다 */
export const HEAT_ROWS: [('heatPulloutTurns' | 'heatHighTurns' | 'tracebacks'), string, string][] = [
  ['heatPulloutTurns', `HEAT ${HEAT_PULLOUT_THRESHOLD}+ 철수 턴`, `[기획 v0.3.1] 그 턴 시작 노출도가 ${HEAT_PULLOUT_THRESHOLD} 이상이고, 그 턴에 공격 프로그램을 1개 이상 철수(잭아웃)한 턴 수. 철수한 프로그램 수와 무관하게 턴당 1회. 사람·AI 구분 없음 (사람은 자동 철수 없음, 직접 철수만 집계)`],
  ['heatHighTurns', `HEAT ${HEAT_PULLOUT_THRESHOLD}+ 머문 턴`, `[기획 v0.3.1] 그 턴 시작 노출도가 ${HEAT_PULLOUT_THRESHOLD} 이상이었던 턴 수`],
  ['tracebacks', '역추적 (HEAT 100)', '[기획 v0.3.1] 노출도가 100에 닿아 역추적이 발동한 횟수 (별도 집계)'],
];
