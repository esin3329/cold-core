// [기획 v0.3.1] 결과 화면 플레이테스트 기록 블록 — 기획 시트 순서 그대로. 순수 함수 (DOM 없음, 테스트 가능)
import { HEAT_PULLOUT_THRESHOLD } from '../sim/config';
import { nodeLabel } from '../sim/engine';
import type { MatchState, Player, WinReason } from '../sim/types';

export interface RecordRow {
  key: string;
  label: string;
  /** 경기 단위 값이면 문자열 하나, 플레이어별이면 [A, B] */
  value: string | [string, string];
}

const fmtHp = (d: number) => (d % 10 === 0 ? String(d / 10) : (d / 10).toFixed(1));

/** 승리 사유 용어 — 결과 화면 배너와 기록 블록·복사가 같은 표를 쓴다 (D1 켜짐 여부와 무관하게 '데이터 탈취') */
export const WIN_REASON_TEXT: Record<WinReason, string> = { core: '코어 브리치', data: '데이터 탈취', time: '시간 종료 판정', forfeit: '기권' };
export const DRAW_TEXT = '무승부';

/** 결과 화면 배너: 큰 제목(승리/패배/무승부/플레이어 X 승리) + 부제 사유. 순수 함수라 기록 용어와 테스트로 맞춰 본다 */
export function bannerText(s: MatchState, mode: 'ai' | 'hotseat'): { title: string; reason: string } {
  const w = s.winner;
  const title = w === 'draw' ? DRAW_TEXT : mode === 'ai' ? (w === 'A' ? '승리' : '패배') : `플레이어 ${w} 승리`;
  return { title, reason: WIN_REASON_TEXT[s.winReason ?? 'time'] };
}

export function winTypeText(s: MatchState): string {
  if (!s.over) return '진행 중';
  if (s.winner === 'draw') return DRAW_TEXT;
  return WIN_REASON_TEXT[s.winReason ?? 'time'];
}

export function firstGateBreakText(s: MatchState): string {
  const g = s.firstGateBreak;
  if (!g) return '없음';
  // 게이트 이름에 주인이 들어 있다 (예: 'B 게이트1' = B의 게이트가 깨짐). 같은 턴에 여러 개면 해결 순서대로 모두
  return `T${g.turn} · ${g.gates.map((id) => nodeLabel(s, id)).join(', ')}`;
}

export function suddenDeathText(s: MatchState): string {
  if (!s.options.suddenDeathEnabled) return '아니오 (서든데스 꺼짐)';
  const start = s.options.suddenDeathStartTurn;
  const reached = s.suddenDeathReachedTurn;
  if (reached === null) return `아니오 (T${start} 개시 예정)`;
  // 디버그 턴 점프가 개시 턴을 건너뛰었으면(예: '20턴으로') 실제 첫 적용 턴 대신 설정된 개시 턴을 적고 표시를 붙인다
  const skipped = reached > start && (s.debugJumps ?? []).some((j) => j.from <= start && j.to > start);
  return skipped ? `예 (T${start} 개시) (디버그 점프)` : `예 (T${reached} 개시)`;
}

export function buildRecord(s: MatchState): RecordRow[] {
  const per = (f: (p: Player) => string): [string, string] => [f('A'), f('B')];
  const t = HEAT_PULLOUT_THRESHOLD;
  return [
    { key: 'winner', label: '승자', value: s.winner === 'draw' ? '무승부' : s.winner ?? '-' },
    { key: 'winType', label: '승리 유형', value: winTypeText(s) },
    { key: 'turns', label: '경기 길이 (턴)', value: String(s.turn) },
    { key: 'firstGate', label: '첫 게이트 돌파', value: firstGateBreakText(s) },
    { key: 'suddenDeath', label: '서든데스 도달', value: suddenDeathText(s) },
    { key: 'minCoreHp', label: '최저 코어 HP', value: per((p) => fmtHp(s.players[p].minCoreHp)) },
    { key: 'heatPulloutTurns', label: `HEAT ${t}+ 철수 턴`, value: per((p) => String(s.players[p].heatPulloutTurns)) },
    { key: 'heatHighTurns', label: `HEAT ${t}+ 머문 턴`, value: per((p) => String(s.players[p].heatHighTurns)) },
    { key: 'tracebacks', label: '역추적 (HEAT 100)', value: per((p) => String(s.players[p].tracebacks)) },
  ];
}

const clean = (x: string) => x.replace(/[\t\n\r]/g, ' ');

/** 시트 열 이름 (13열) — 복사에는 들어가지 않는다. README·버튼 툴팁에 적어 시트 머리줄을 맞추는 용도 */
export function recordColumns(rows: RecordRow[]): string[] {
  return rows.flatMap((r) => (typeof r.value === 'string' ? [r.label] : [`${r.label} A`, `${r.label} B`]));
}

/** '기록 복사' 내용: 이번 경기 값 1줄, 탭 구분 13열, 머리줄 없음 (플레이어별 항목은 A·B 두 열) */
export function recordTsv(rows: RecordRow[]): string {
  return rows.flatMap((r) => (typeof r.value === 'string' ? [r.value] : r.value)).map(clean).join('\t');
}
