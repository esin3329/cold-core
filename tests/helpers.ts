/**
 * 테스트용 설정 고정: v0.3부터 기본값(SIEGE_PRESSURE)에 플레이테스트 조합이 켜져 있으므로,
 * 옵션별 단위 테스트는 '전체 off'(SIEGE_ALL_OFF) 위에 필요한 옵션만 명시적으로 얹어 만든다 (검사 내용은 그대로).
 */
import { SIEGE_ALL_OFF, type SiegeOptions } from '../src/sim/config';
import { createMatch as createMatchRaw } from '../src/sim/engine';
export const createMatch = (options: Partial<SiegeOptions> = {}) => createMatchRaw({ ...SIEGE_ALL_OFF, ...options });
