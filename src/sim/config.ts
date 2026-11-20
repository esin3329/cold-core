/**
 * 튜닝 설정 (밸런스 데이터).
 * - [기획] = 기획서(§11, §14.2 등)에 적힌 예시 값을 그대로 사용
 * - [기획 v0.2] = 기획서 v0.2에서 확정된 값 (이전 프로토타입의 추정값을 기획이 채택)
 * - [기획 v0.3] = 기획 v0.3에서 확정된 값 (링크 교전 규칙)
 * - [추정] = 기획서에 없어 프로토타입에서 임의로 정한 값 → 플레이테스트 후 조정 대상
 * 모든 HP/피해는 엔진 내부에서 ×10 정수(데시 단위)로 처리한다 (§16.1 "정수 연산만 사용").
 * 데이터 점수는 내부에서 ×2 정수(0.5점 단위)로 처리한다.
 */
import type { IceKind, NodeKind, ProgKind, AttackClass, DefClass } from './types';

export const TUNING = {
  // ── 링크 교전 (§6.4 ③ "같은 링크에서 마주치면 교전") — 아래 4개 규칙 모두 [기획 v0.3] 확정 ──
  // 1) 프로그램 대 프로그램 피해 = 공격력 × linkCombatDmgPct% (상성표 없음)        [기획 v0.3]
  // 2) 탐지되지 않은(은신) 셰이드는 마주쳐도 교전 없이 지나감                        [기획 v0.3]
  // 3) 한 프로그램이 여러 적과 마주치면 번호가 가장 낮은 상대를 공격                  [기획 v0.3]
  // 4) 링크 교전 처치에는 역컴파일 CYC 보상 없음                                      [기획 v0.3]
  linkCombatDmgPct: 100, // [기획 v0.3]
  planSeconds: 20, // [기획 §14.2] 계획 단계 20초
  setupSeconds: 60, // [기획 §4.1] 요새 구축 단계 60초
  maxTurns: 20, // [기획 §14.2]
  setupCyc: 30, // [기획 §14.2] 구축 단계 자금
  baseIncome: 6, // [기획 v0.2] 기본 6 + 프로세서당 2
  processorIncome: 2, // [기획 v0.2]. 1턴(구축 종료) 수입도 이 공식 = 6 + 2×2 = 10 [기획 v0.2 확정]
  neutralIncome: 1, // [기획 §14.2]
  killReward: 1, // [기획 §6.2] 역컴파일 보상
  cycCap: 30, // [기획 §14.2]
  bwBase: 10, // [기획 §14.2]
  bwPerRelay: 2, // [기획 §14.2]
  dataWin: 12, // [기획 §14.2] (옵션 D1이 켜지면 SIEGE_PRESSURE.dataWinRaised 사용)
  vaultData: 4, // [기획 §14.2]
  neutralDataPerTurn: 0.5, // [기획 §8.1]
  siphonPerTurn: 1, // [기획 §11.1]
  heatDecay: 10, // [기획 §14.2]
  heatMax: 100, // [기획 §14.2] 역추적 임계치
  heatDetected: 50, // [기획 §7.3]
  heatTracking: 80, // [기획 §7.3]
  heatAfterTraceback: 40, // [기획 §7.3]
  jackoutCostWhenTracked: 2, // [기획 §7.3]
  heatBrutePerTurn: 5, // [기획 §7.3]
  heatInWatchRange: 10, // [기획 §7.3] (브루트는 ×1.5 → 15, §7.2)
  heatOverclock: 20, // [기획 §6.2]
  heatHoneypot: 30, // [기획 §11.2]
  overclockCyc: 4, // [기획 §6.2]
  recompileRefundPct: 50, // [기획 §14.2]
  repairCost: 2, // [기획 §14.2]
  repairHp: 10, // [기획 §14.2]
  processorOfflineTurns: 3, // [기획 §5.2]
  processorRestoreHp: 10, // [추정] 오프라인 종료 후 복구 HP
  tracebackBreachTurns: 2, // [기획 §7.3]
  emergencyCoreHpPct: 30, // [기획 §8.2] 비상 프로토콜 발동 기준
  emergencyBulwarks: 2, // [기획 §8.2]
  pingRange: 2, // [기획 v0.2] 발사 지점(내 릴레이/프로그램) 기준 2칸
  pingRevealRadius: 1, // [기획 v0.2] 핑 대상 노드 + 인접 1칸 공개
  lanternRange: 2, // [기획 §11.2]
  advantagePct: 150, // [기획 §7.2]
  disadvantagePct: 50, // [기획 §7.2]
  bruteVsNodePct: 150, // [추정] 오거 "노드에 강함"(§11.1)을 ×1.5로 해석
  viralVsNodePct: 50, // [추정] 바이럴은 노드 파괴에 약함
  detectedShadeVsHoundRecvPct: 100, // [추정] 랜턴에 탐지된 셰이드는 하운드에 보통 상성
  tieTimeBonusPer10PctCore: 0.5, // [기획 §9]
} as const;

/**
 * HEAT 80 철수 집계 [기획 v0.3.1] — 통계 전용 (규칙에는 영향 없음)
 * - 'HEAT 80+ 철수 턴': 그 턴 시작(계획 단계) 노출도가 이 값 이상이고, 그 턴에 공격 프로그램을 1개 이상 철수(잭아웃)한 턴. 철수한 프로그램 수와 무관하게 턴당 1회.
 *   사람·AI 구분 없음 (사람은 자동 철수가 없으므로 직접 철수한 경우만 잡힘). 이 게임의 '회수(recall)' 명령은 ICE 전용이라, 공격 프로그램을 거둬들이는 명령은 철수 하나뿐이다.
 * - 'HEAT 80+ 머문 턴': 그 턴 시작 노출도가 이 값 이상이었던 턴 수
 * - '역추적(HEAT 100)': 역추적 발동 횟수 (별도 집계)
 */
export const HEAT_PULLOUT_THRESHOLD = 80; // [기획 v0.3.1] 기획이 바꿀 수 있는 단일 상수

export interface NodeSpec { hp: number; slots: number }
export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  core: { hp: 100, slots: 2 }, // [기획 §5.2]
  gate: { hp: 30, slots: 3 }, // [기획 §5.2]
  vault: { hp: 20, slots: 2 }, // [기획 §5.2]
  processor: { hp: 20, slots: 1 }, // [기획 §5.2]
  relay: { hp: 15, slots: 2 }, // [기획 §5.2]
  neutral: { hp: 15, slots: 0 }, // [기획 HP] / 슬롯 0 [추정]
};

export interface ProgSpec {
  name: string; cls: AttackClass; cyc: number; bw: number; hp: number; atk: number; speed: number; desc: string;
}
export const PROG_SPECS: Record<ProgKind, ProgSpec> = {
  // [기획 §11.1] 비용/HP/공격/속도. 핑 HP·공격 0, 사이펀 공격 2는 [추정]
  ping: { name: '핑', cls: 'stealth', cyc: 1, bw: 0, hp: 0, atk: 0, speed: 0, desc: '대상 노드와 인접 노드의 ICE 공개(1회). 피해 없음' },
  auger: { name: '오거', cls: 'brute', cyc: 4, bw: 2, hp: 12, atk: 6, speed: 1, desc: 'HP12 공격6, 이동1. 장벽·노드에 강함' },
  shade: { name: '셰이드', cls: 'stealth', cyc: 4, bw: 2, hp: 6, atk: 4, speed: 2, desc: 'HP6 공격4, 은신 이동2. 하운드가 못 봄' },
  siphon: { name: '사이펀', cls: 'viral', cyc: 4, bw: 2, hp: 8, atk: 2, speed: 1, desc: 'HP8, 금고에서 데이터 1점/턴 탈취' },
};

export interface IceSpec { name: string; cls: DefClass; cyc: number; bw: number; hp: number; dmg: number; desc: string }
export const ICE_SPECS: Record<IceKind, IceSpec> = {
  // [기획 §11.2] 비용·벌워크 HP20·하운드 피해5. 하운드/랜턴/허니팟 HP 10/6/4는 [기획 v0.2]
  bulwark: { name: '벌워크', cls: 'wall', cyc: 3, bw: 1, hp: 20, dmg: 0, desc: 'HP20, 노드 통과 차단' },
  hound: { name: '하운드', cls: 'active', cyc: 4, bw: 2, hp: 10 /* [기획 v0.2] */, dmg: 5, desc: '노드 안 적에게 매턴 5 피해' },
  lantern: { name: '랜턴', cls: 'watch', cyc: 2, bw: 1, hp: 6 /* [기획 v0.2] */, dmg: 0, desc: '2칸 범위 은신 탐지 + 노출도 상승' },
  honeypot: { name: '허니팟', cls: 'watch', cyc: 3, bw: 0, hp: 4 /* [기획 v0.2] */, dmg: 0, desc: '가짜 금고. 진입 시 1턴 정지 + 노출도+30. 1회용' },
};

/** [기획 §7.2] 공격 성향 × 방어 성향 배율(%). 공격자가 주는 피해 배율. */
export const MATCHUP: Record<AttackClass, Record<DefClass, number>> = {
  brute: { wall: 150, watch: 100, active: 50 },
  stealth: { wall: 100, watch: 50, active: 150 },
  viral: { wall: 50, watch: 150, active: 100 },
};
/** 공격자가 받는 피해 배율(%) — 유리 ×0.5 / 불리 ×1.5 (§7.2) */
export function receivedPct(a: AttackClass, d: DefClass): number {
  const m = MATCHUP[a][d];
  return m > 100 ? TUNING.disadvantagePct : m < 100 ? TUNING.advantagePct : 100;
}

/**
 * 공성 압박 보정안 (실험용, 기획서 v0.2 §14.5) — balance_options_v0.2.md 그대로.
 * 기본값: [기획 v0.3 확정] 플레이테스트 조합(V03_PRESET_ON)이 on, 나머지 실험 토글은 off. 각 옵션은 독립적으로 켜고 끌 수 있다.
 * 예전(모두 off) 동작은 SIEGE_ALL_OFF.
 * 매치 시작 시 createMatch(options)로 상태에 복사되므로(MatchState.options) 시뮬레이션은 순수·결정론적으로 유지된다.
 * 피해량은 엔진 내부에서 ×10 (데시 단위)로 적용한다.
 */
export interface SiegeOptions {
  iceUpkeepEnabled: boolean;
  iceUpkeepStartTurn: number;
  iceUpkeepCycPerIce: number;
  iceUpkeepStepTurns: number;
  iceUpkeepCap: number;
  iceUpkeepExcludeKinds: readonly IceKind[];
  coreDirectDamageEnabled: boolean;
  coreDirectDamagePct: number;
  suddenDeathEnabled: boolean;
  suddenDeathStartTurn: number;
  suddenDeathCoreDmgPerTurn: number;
  suddenDeathCoreDmgStep: number;
  suddenDeathRevealFog: boolean;
  dataWinRaiseEnabled: boolean;
  dataWinRaised: number;
  neutralDataCapEnabled: boolean;
  neutralDataCap: number;
  neutralDataDelayEnabled: boolean;
  neutralDataStartTurn: number;
  coreBreachDataEnabled: boolean;
  coreBreachDmgStep: number;
  coreBreachDataPer: number;
  coreBreachDataMax: number;
  coreBreachE2Enabled: boolean;
  e2NeutralDataCap: number;
  breachTimeOnlyEnabled: boolean;
  gateHpReducedEnabled: boolean;
  gateHpReduced: number;
  augerPierceEnabled: boolean;
  augerPiercePct: number;
  hiddenVaultsEnabled: boolean;
  augerPierceStrongEnabled: boolean;
  augerPierceStrongPct: number;
  gateSlotsReducedEnabled: boolean;
  gateSlotsReduced: number;
  suddenDeathEarlyEnabled: boolean;
  suddenDeathEarlyStartTurn: number;
  suddenDeathEarlyCoreDmg: number;
  suddenDeathEarlyStep: number;
  vaultDataReducedEnabled: boolean;
  vaultDataReduced: number;
  siphonSlowEnabled: boolean;
  siphonSlowHalfPerTurn: number;
  suddenDeathGentleEnabled: boolean;
  suddenDeathGentleStep: number;
  houndCostRaisedEnabled: boolean;
  houndCostRaised: number;
}
export const SIEGE_PRESSURE: SiegeOptions = {
  // (A) ICE 유지비 — 턴이 지날수록 상승 [기획 v0.2 §14.5]
  iceUpkeepEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  iceUpkeepStartTurn: 8, // 이 턴부터 유지비 발생
  iceUpkeepCycPerIce: 1, // 시작 유지비 (CYC / ICE)
  iceUpkeepStepTurns: 4, // N턴마다 유지비 +1
  iceUpkeepCap: 3, // 유지비 상한 (CYC / ICE)
  iceUpkeepExcludeKinds: ['honeypot'], // 1회용 허니팟 제외
  // 비상 프로토콜 벌워크(free)도 유지비 면제 [기획 v0.3 확정] (upkeepIces에서 !free로 제외)
  // 공식: perIce = min(cap, cycPerIce + floor((turn - startTurn) / stepTurns)) → 턴 8~11: 1, 12~15: 2, 16~20: 3
  // ⑦ 수입 정산 직후 차감. 부족 시 가장 최근 대상 ICE부터 환급 없이 강제 회수
  // (B) 코어 직접 피해 보너스 — 코어 본체만, ICE HP에는 미적용
  coreDirectDamageEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  coreDirectDamagePct: 200, // 기존 상성·노드 배율 뒤에 곱함
  // (C) 서든데스 — 20턴 종료 전 후반 압박
  suddenDeathEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  suddenDeathStartTurn: 15,
  suddenDeathCoreDmgPerTurn: 6, // 시작 턴 양쪽 코어 고정 피해
  suddenDeathCoreDmgStep: 2, // 매 턴 증가
  suddenDeathRevealFog: true, // 시작 턴에 안개 해제
  // 공식: dmg(t) = perTurn + (t - startTurn) * step → 15..20턴: 6,8,10,12,14,16 (합 66)
  // 적용 시점: ⑤ 교전·특수효과 이후, ⑦ 수입 이전 (수리는 ① 단계라 이미 끝난 뒤)
  // ── 데이터 감속안 [기획 v0.3 실험, 수치는 예시] ──
  // (D1) 데이터 승리 기준 상향
  dataWinRaiseEnabled: false,
  dataWinRaised: 20, // 12 → 20점
  // (D2) 중립 노드에서 얻는 데이터 누적 상한 (플레이어별). 나머지는 금고 탈취로
  neutralDataCapEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  neutralDataCap: 6, // 점 (내부 ×2 = 12)
  // (D3) 중립 데이터는 이 턴부터 쌓임 (점령·수입은 그대로)
  neutralDataDelayEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  neutralDataStartTurn: 6,
  // 모든 D 옵션은 ⑦ 중립 데이터 정산 단계에서 적용. neutralDataPerTurn 자체는 바꾸지 않는다
  // ── 코어 브리치 데이터 [기획 v0.4 실험, 수치는 예시] ──
  // (E1) 내 프로그램이 상대 코어 본체에 준 누적 피해 20마다 데이터 +2, 매치당 최대 +10.
  //      누적 '가한 피해'(실제로 깎인 HP) 기준이라 상대가 코어를 수리해도 카운터는 줄지 않는다.
  //      E1 데이터는 데이터 승리에 포함되고 D2 중립 상한과는 무관하다.
  //      서든데스 고정 피해는 공격자가 없으므로 세지 않는다 [추정]. 디버그 버튼 피해도 세지 않는다.
  coreBreachDataEnabled: false,
  coreBreachDmgStep: 20, // HP
  coreBreachDataPer: 2, // 점
  coreBreachDataMax: 10, // 점 / 매치 / 플레이어
  // (E2) E1 + 중립 데이터 상한 6 → 4 (E2를 켜면 E1 규칙과 상한 4가 함께 적용, D2 체크 여부와 무관)
  coreBreachE2Enabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  e2NeutralDataCap: 4,
  // ── v0.5 [기획 v0.5 실험, 수치는 예시] ──
  // (E1') 브리치 데이터는 12점 데이터 승리에 포함하지 않고 20턴 시간 판정 점수에만 더한다 (E1 또는 E2와 함께 켤 때 의미 있음)
  breachTimeOnlyEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  // (G1) 게이트 HP 30 → 20
  gateHpReducedEnabled: false,
  gateHpReduced: 20,
  // (G2) 오거가 ICE가 있는 코어를 공격하면 ICE에 줄 피해의 50%가 코어 본체로 관통 (나머지는 ICE).
  //      관통 피해는 코어 본체 피해이므로 E1 누적에 들어가고, B(코어 직접 피해 ×2)도 적용 [추정]. 노드 배율 ×1.5는 적용하지 않음 [추정]
  augerPierceEnabled: false,
  augerPiercePct: 50,
  // (H) 숨은 금고: 각 진영의 저장 소켓 4곳(V1·V2·R1·R3 자리 [기획 v0.3])이 정찰 전에는 모두 중계 노드로 보이고,
  //     구축 단계에서 2곳을 진짜 금고로 고른다 (나머지 2곳은 중계). 허니팟은 금고가 아닌 소켓에만 설치 가능
  hiddenVaultsEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  // ── v0.6 [기획 v0.6 실험, 수치는 예시] — 켜면 createMatch에서 상위 옵션 값으로 정규화된다 ──
  // (G2') G2 관통 비율 50% → 75% (G2를 함께 켬)
  augerPierceStrongEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  augerPierceStrongPct: 75,
  // (G3) 게이트 ICE 슬롯 3 → 2, 게이트 HP 20 (G1 포함)
  gateSlotsReducedEnabled: false,
  gateSlotsReduced: 2,
  // (C') 서든데스 T13부터, 고정 피해 6 시작 매 턴 +3 (C를 함께 켜고 C의 수치를 대체)
  //      → 13..20턴: 6,9,12,15,18,21,24,27 (합 132)
  suddenDeathEarlyEnabled: true, // [기획 v0.3 확정] 기본 on (플레이테스트 기본 조합)
  suddenDeathEarlyStartTurn: 13,
  suddenDeathEarlyCoreDmg: 6,
  suddenDeathEarlyStep: 3,
  // ── v0.7 [기획 v0.7 실험, 수치는 예시] ──
  // (V1) 금고 데이터 4 → 3점 (금고 2개 → 상대가 훔칠 수 있는 최대 6점)
  vaultDataReducedEnabled: false,
  vaultDataReduced: 3,
  // (V2) 사이펀 탈취 1 → 0.5점/턴. 데이터는 내부 ×2 정수이므로 1(=0.5점)로 저장해 정수 연산 유지
  siphonSlowEnabled: false,
  siphonSlowHalfPerTurn: 1,
  // (C'') 서든데스 T13 시작·6 피해는 C'와 같고, 증가폭만 +3 → +2 (C·C' 포함) → 13..20턴: 6,8,…,20 (합 104)
  suddenDeathGentleEnabled: false,
  suddenDeathGentleStep: 2,
  // ── v0.8 [기획 v0.3 측정] ──
  // 하운드 CYC 비용 4 → 5 (BW·HP·피해는 그대로). 회수 환급은 기존 공식 floor(비용 × 50%) = 2로 4일 때와 같다
  houndCostRaisedEnabled: false,
  houndCostRaised: 5,
};

/** 실험 토글(boolean) 키 목록 — UI 체크박스·프리셋·전체 끄기에 쓴다 */
export const OPTION_TOGGLES = (Object.keys(SIEGE_PRESSURE) as (keyof SiegeOptions)[]).filter((k) => k.endsWith('Enabled') && typeof SIEGE_PRESSURE[k] === 'boolean') as BoolKey[]; // suddenDeathRevealFog 같은 하위 설정은 토글이 아님
type BoolKey = { [K in keyof SiegeOptions]: SiegeOptions[K] extends boolean ? K : never }[keyof SiegeOptions];
/** [기획 v0.3 확정] 플레이테스트 기본 조합: A+B+C+C'+D2+D3+E2+E1'+G2'+H (나머지 실험 토글은 off) */
export const V03_PRESET_ON: readonly BoolKey[] = ['iceUpkeepEnabled', 'coreDirectDamageEnabled', 'suddenDeathEnabled', 'suddenDeathEarlyEnabled', 'neutralDataCapEnabled', 'neutralDataDelayEnabled', 'coreBreachE2Enabled', 'breachTimeOnlyEnabled', 'augerPierceStrongEnabled', 'hiddenVaultsEnabled'];
/** 모든 실험 토글 off (수치는 기본값 그대로) — v0.3 이전의 기본 동작. 기존 테스트·밸런스 러너가 설정을 고정할 때 기준으로 쓴다 */
export const SIEGE_ALL_OFF: SiegeOptions = { ...SIEGE_PRESSURE, ...Object.fromEntries(OPTION_TOGGLES.map((k) => [k, false])) };
/** v0.3 프리셋 = 전체 off + V03_PRESET_ON만 on (현재 기본값과 같음) */
export const SIEGE_V03_PRESET: SiegeOptions = { ...SIEGE_ALL_OFF, ...Object.fromEntries(V03_PRESET_ON.map((k) => [k, true])) };

/** 상위 옵션(G2'·G3·C')이 포함하는 하위 옵션을 켜고 수치를 대체한다 (createMatch에서 1회 적용) */
export function normalizeOptions(o: SiegeOptions): SiegeOptions {
  if (o.augerPierceStrongEnabled) { o.augerPierceEnabled = true; o.augerPiercePct = o.augerPierceStrongPct; }
  if (o.gateSlotsReducedEnabled) o.gateHpReducedEnabled = true;
  if (o.suddenDeathGentleEnabled) o.suddenDeathEarlyEnabled = true;
  if (o.suddenDeathEarlyEnabled) {
    o.suddenDeathEnabled = true;
    o.suddenDeathStartTurn = o.suddenDeathEarlyStartTurn;
    o.suddenDeathCoreDmgPerTurn = o.suddenDeathEarlyCoreDmg;
    o.suddenDeathCoreDmgStep = o.suddenDeathGentleEnabled ? o.suddenDeathGentleStep : o.suddenDeathEarlyStep;
  }
  return o;
}
