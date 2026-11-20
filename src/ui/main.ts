import { fmtClock } from './clock';
/** UI / 화면 흐름 — 시뮬레이션 코어(src/sim)를 호출만 한다. */
import './style.css';
import { aiOrders, AI_STYLES, AI_STYLE_KO, type AiStyle } from '../sim/ai';
import { ICE_SPECS, MATCHUP, PROG_SPECS, SIEGE_PRESSURE, SIEGE_V03_PRESET, TUNING } from '../sim/config';
import { HEAT_ROWS } from './heatStats';
import { bannerText, buildRecord, recordColumns, recordTsv } from './record';

const HEAT_TIPS: Record<string, string> = Object.fromEntries(HEAT_ROWS.map(([k, , tip]) => [k, tip]));

/** 클립보드 복사: file://에서도 동작하도록 execCommand 대체 경로를 둔다 */
async function copyText(text: string): Promise<'clipboard' | 'execCommand' | 'fail'> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return 'clipboard'; }
  } catch { /* 아래 대체 경로 */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok ? 'execCommand' : 'fail';
}
import { NODE_SPECS } from '../sim/config';
import { STEP_NAMES, createMatch, dataWinTarget, debugApply, describeOrder, fillVaultPick, forfeit, iceCyc, vaultDataPts, nodeLabel, planBudget, resolveTurn, socketsOf, timeScore, type DebugAction } from '../sim/engine';
import type { IceKind, LogEntry, MatchState, Order, Player, ProgKind } from '../sim/types';
import type { MatchView } from '../sim/view';
import { other } from '../sim/types';
import { heatStage, viewFor } from '../sim/view';
import { kindKo, renderMap } from './mapView';

type Screen = 'title' | 'loadout' | 'match' | 'result';
type Tool = { t: 'prog'; k: ProgKind } | { t: 'ice'; k: IceKind } | { t: 'retarget'; id: number } | null;

const ATK: ProgKind[] = ['ping', 'auger', 'shade', 'siphon'];
const DEF: IceKind[] = ['bulwark', 'hound', 'lantern', 'honeypot'];
const CLS_KO = { brute: '브루트', stealth: '스텔스', viral: '바이럴', wall: '장벽형', watch: '감시형', active: '반격형' } as const;

const app = {
  screen: 'title' as Screen,
  mode: 'ai' as 'ai' | 'hotseat',
  timerOn: false,
  state: createMatch(),
  planner: 'A' as Player,
  pending: { A: [] as Order[], B: [] as Order[] },
  selected: null as string | null,
  tool: null as Tool,
  handover: null as null | { to: Player; msg: string },
  deadline: 0,
  bigLog: false,
  /** 공성 압박 보정안 토글 (타이틀에서 변경, 매치 시작 시 상태에 고정) */
  options: { iceUpkeepEnabled: SIEGE_PRESSURE.iceUpkeepEnabled, coreDirectDamageEnabled: SIEGE_PRESSURE.coreDirectDamageEnabled, suddenDeathEnabled: SIEGE_PRESSURE.suddenDeathEnabled,
    dataWinRaiseEnabled: SIEGE_PRESSURE.dataWinRaiseEnabled, neutralDataCapEnabled: SIEGE_PRESSURE.neutralDataCapEnabled, neutralDataDelayEnabled: SIEGE_PRESSURE.neutralDataDelayEnabled,
    coreBreachDataEnabled: SIEGE_PRESSURE.coreBreachDataEnabled, coreBreachE2Enabled: SIEGE_PRESSURE.coreBreachE2Enabled,
    breachTimeOnlyEnabled: SIEGE_PRESSURE.breachTimeOnlyEnabled, gateHpReducedEnabled: SIEGE_PRESSURE.gateHpReducedEnabled, augerPierceEnabled: SIEGE_PRESSURE.augerPierceEnabled,
    augerPierceStrongEnabled: SIEGE_PRESSURE.augerPierceStrongEnabled, gateSlotsReducedEnabled: SIEGE_PRESSURE.gateSlotsReducedEnabled, suddenDeathEarlyEnabled: SIEGE_PRESSURE.suddenDeathEarlyEnabled,
    suddenDeathGentleEnabled: SIEGE_PRESSURE.suddenDeathGentleEnabled, vaultDataReducedEnabled: SIEGE_PRESSURE.vaultDataReducedEnabled, siphonSlowEnabled: SIEGE_PRESSURE.siphonSlowEnabled,
    houndCostRaisedEnabled: SIEGE_PRESSURE.houndCostRaisedEnabled,
    hiddenVaultsEnabled: SIEGE_PRESSURE.hiddenVaultsEnabled },
  aiStyle: 'balanced' as AiStyle,
  aiSeed: 0,
  debugOpen: false,
  /** 숨은 금고: 구축 단계에서 고르는 중인 금고 소켓 (2곳이 되면 setVaults 명령으로 반영) */
  vaultPick: null as string[] | null,
  /** 숨은 금고 패널 안내 (선택 해제·확정 차단 메시지) */
  vaultMsg: '' as string,
};
type OptKey = keyof typeof app.options;
const OPT_LABEL: Record<OptKey, string> = {
  iceUpkeepEnabled: `A. ICE 유지비 (T${SIEGE_PRESSURE.iceUpkeepStartTurn}부터 ICE당 ${SIEGE_PRESSURE.iceUpkeepCycPerIce} CYC, ${SIEGE_PRESSURE.iceUpkeepStepTurns}턴마다 +1, 상한 ${SIEGE_PRESSURE.iceUpkeepCap}, 허니팟 제외)`,
  coreDirectDamageEnabled: `B. 코어 직접 피해 ×${SIEGE_PRESSURE.coreDirectDamagePct / 100} (코어 본체만)`,
  suddenDeathEnabled: `C. 서든데스 (T${SIEGE_PRESSURE.suddenDeathStartTurn}부터 양쪽 코어 ${SIEGE_PRESSURE.suddenDeathCoreDmgPerTurn}, 매 턴 +${SIEGE_PRESSURE.suddenDeathCoreDmgStep}, 안개 해제)`,
  dataWinRaiseEnabled: `D1. 데이터 승리 기준 ${TUNING.dataWin} → ${SIEGE_PRESSURE.dataWinRaised}점`,
  neutralDataCapEnabled: `D2. 중립 노드 데이터 누적 상한 ${SIEGE_PRESSURE.neutralDataCap}점 (나머지는 금고 탈취로)`,
  neutralDataDelayEnabled: `D3. 중립 데이터는 T${SIEGE_PRESSURE.neutralDataStartTurn}부터 생성 (점령·수입은 그대로)`,
  coreBreachDataEnabled: `E1. 코어 브리치 데이터 (내 프로그램이 상대 코어에 준 누적 피해 ${SIEGE_PRESSURE.coreBreachDmgStep}마다 +${SIEGE_PRESSURE.coreBreachDataPer}, 최대 +${SIEGE_PRESSURE.coreBreachDataMax}, 서든데스 피해 제외)`,
  coreBreachE2Enabled: `E2. E1 + 중립 데이터 상한 ${SIEGE_PRESSURE.e2NeutralDataCap}점`,
  breachTimeOnlyEnabled: `E1'. 브리치 데이터는 데이터 승리(12점)에 넣지 않고 20턴 시간 판정 점수에만 반영 (E1/E2와 함께)`,
  gateHpReducedEnabled: `G1. 게이트 HP 30 → ${SIEGE_PRESSURE.gateHpReduced}`,
  augerPierceEnabled: `G2. 오거 관통 (코어 위 ICE를 칠 때 피해 ${SIEGE_PRESSURE.augerPiercePct}%가 코어 본체로)`,
  augerPierceStrongEnabled: `G2'. 오거 관통 ${SIEGE_PRESSURE.augerPiercePct}% → ${SIEGE_PRESSURE.augerPierceStrongPct}% (G2 포함)`,
  gateSlotsReducedEnabled: `G3. 게이트 ICE 슬롯 3 → ${SIEGE_PRESSURE.gateSlotsReduced} (게이트 HP ${SIEGE_PRESSURE.gateHpReduced}, G1 포함)`,
  suddenDeathEarlyEnabled: `C'. 이른 서든데스 (T${SIEGE_PRESSURE.suddenDeathEarlyStartTurn}부터 양쪽 코어 ${SIEGE_PRESSURE.suddenDeathEarlyCoreDmg}, 매 턴 +${SIEGE_PRESSURE.suddenDeathEarlyStep}, C 포함·C 수치 대체)`,
  suddenDeathGentleEnabled: `C''. 완만한 이른 서든데스 (T${SIEGE_PRESSURE.suddenDeathEarlyStartTurn}부터 ${SIEGE_PRESSURE.suddenDeathEarlyCoreDmg}, 매 턴 +${SIEGE_PRESSURE.suddenDeathGentleStep}, C·C' 포함)`,
  vaultDataReducedEnabled: `V1. 금고 데이터 ${TUNING.vaultData} → ${SIEGE_PRESSURE.vaultDataReduced}점`,
  siphonSlowEnabled: `V2. 사이펀 탈취 ${TUNING.siphonPerTurn} → ${SIEGE_PRESSURE.siphonSlowHalfPerTurn / 2}점/턴`,
  houndCostRaisedEnabled: `K. 하운드 비용 ${ICE_SPECS.hound.cyc} → ${SIEGE_PRESSURE.houndCostRaised} CYC (기획 v0.3 측정)`,
  hiddenVaultsEnabled: `H. 숨은 금고 (저장 소켓 4곳이 정찰 전 모두 중계로 보임, 구축 단계에 2곳을 금고로 지정, 허니팟은 나머지 소켓에만)`,
};
function presetState() {
  const ks = Object.keys(app.options) as OptKey[];
  return ks.every((k) => app.options[k] === SIEGE_V03_PRESET[k]) ? 'v0.3 프리셋' : ks.every((k) => !app.options[k]) ? '모두 끔' : '사용자 지정';
}
function activeOptsText(o: Record<OptKey, boolean>) {
  const on = (Object.keys(OPT_LABEL) as OptKey[]).filter((k) => o[k]).map((k) => OPT_LABEL[k].split(' (')[0]);
  return on.length ? on.join(' · ') : '공성 압박 보정안 없음 (기본)';
}
const root = document.getElementById('app')!;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtHp = (d: number) => (d % 10 === 0 ? String(d / 10) : (d / 10).toFixed(1));

// ---------------- 화면: 타이틀 ----------------
function renderTitle() {
  root.innerHTML = `
  <div class="screen" data-testid="screen-title">
    <div class="boot">LIGHTHOUSE.SYS v0.1 :: 심해망 접속... OK\n성채 프로토콜 로드... OK\n넷 시즈 개시 대기 중_</div>
    <h1>COLD CORE</h1>
    <div class="sub">넷 시즈 :: 사이버펑크 해킹 공성전 — 디지털 프로토타입 (MVP)</div>
    <div class="card" style="max-width:640px;line-height:1.7">
      한정된 <b>CYC(사이클)</b>와 <b>BW(대역폭)</b>를 매 턴 공격과 방어에 나눠 쓰세요.
      양쪽은 동시에 명령을 내리고(WEGO), 명령은 정해진 7단계 순서로 한꺼번에 해결됩니다.
      상대 성채는 <b>핑</b>으로 정찰하기 전까지 안개 속에 있습니다.
      <br/>승리: 상대 코어 HP 0 · 데이터 <span id="title-datawin">${app.options.dataWinRaiseEnabled ? SIEGE_PRESSURE.dataWinRaised : TUNING.dataWin}</span>점 선취 · ${TUNING.maxTurns}턴 종료 시 점수 판정.
    </div>
    <div class="row">
      <button class="big primary" data-act="mode-ai" data-testid="btn-vs-ai">vs AI 스커미시</button>
      <button class="big" data-act="mode-hotseat" data-testid="btn-hotseat">핫시트 1v1</button>
    </div>
    <label><input type="checkbox" data-act="timer" ${app.timerOn ? 'checked' : ''}/> 계획 단계 타이머 (${TUNING.planSeconds}초, 구축 ${TUNING.setupSeconds}초 · 시간 초과 시 자동 확정)</label>
    <div class="card" data-testid="options" style="line-height:1.8"><b>밸런스 옵션 — 기본값: 기획 v0.3 확정 플레이테스트 조합 (A·B·C·C'·D2·D3·E2·E1'·G2'·H)</b><br/>
      <div class="row" style="gap:6px;justify-content:flex-start;margin:4px 0"><button data-act="preset-v03" data-testid="btn-preset-v03">v0.3 프리셋으로 되돌리기</button><button data-act="preset-off" data-testid="btn-preset-off">모든 옵션 끄기 (예전 기본 동작)</button><span class="legend" data-testid="preset-state">현재: ${presetState()}</span></div>
      <b style="font-weight:normal;opacity:.8">실험 토글 — v0.2 A~C · v0.3 D1~D3 · v0.4 E1~E2 · v0.5 E1'·G1·G2 · H 숨은 금고 · v0.6 G2'·G3·C' · v0.7 C''·V1·V2 · v0.8 K 하운드 비용</b><br/>
      ${(Object.keys(OPT_LABEL) as OptKey[]).map((k) => `<label><input type="checkbox" data-act="opt" data-key="${k}" data-testid="opt-${k}" ${app.options[k] ? 'checked' : ''}/> ${OPT_LABEL[k]}</label>`).join('<br/>')}
    </div>
    <label>AI 성향: <select data-act="aistyle" data-testid="ai-style">${AI_STYLES.map((st) => `<option value="${st}" ${st === app.aiStyle ? 'selected' : ''}>${AI_STYLE_KO[st]}</option>`).join('')}</select></label>
  </div>`;
}

// ---------------- 화면: 로드아웃 ----------------
function renderLoadout() {
  const card = (k: string, atk: boolean) => {
    const sp: any = atk ? PROG_SPECS[k as ProgKind] : ICE_SPECS[k as IceKind];
    return `<div class="card ${atk ? 'atk' : 'def'}"><div class="nm">${atk ? '▲' : '■'} ${sp.name}</div>
      <div class="meta">${CLS_KO[sp.cls as keyof typeof CLS_KO]} · ${atk ? sp.cyc : iceCyc({ ...SIEGE_PRESSURE, ...app.options }, k as IceKind)} CYC / ${sp.bw} BW</div><div>${sp.desc}</div></div>`;
  };
  const cls = ['wall', 'watch', 'active'] as const;
  root.innerHTML = `
  <div class="screen" data-testid="screen-loadout">
    <h2>로드아웃 확인 — 8슬롯 (공격 4 + 방어 4, MVP 고정 구성)</h2>
    <div class="legend">매치 중 언제든 8개 모두 사용 가능 (카드 드로우 없음). 공격 = ▲ 마젠타, 방어 = ■ 시안.</div>
    <div class="card-grid">${ATK.map((k) => card(k, true)).join('')}${DEF.map((k) => card(k, false)).join('')}</div>
    <div class="card"><b>상성표</b> (공격자가 주는 피해 배율 · 유리 시 받는 피해 ×0.5, 불리 시 ×1.5)
      <table class="mx" style="margin-top:6px"><tr><th>공격 \\ 방어</th>${cls.map((c) => `<th>${CLS_KO[c]}</th>`).join('')}</tr>
      ${(['brute', 'stealth', 'viral'] as const).map((a) => `<tr><th>${CLS_KO[a]}</th>${cls.map((d) => { const m = MATCHUP[a][d]; return `<td class="${m > 100 ? 'good' : m < 100 ? 'bad' : ''}">×${m / 100}</td>`; }).join('')}</tr>`).join('')}
      </table>
      <div class="legend" style="margin-top:4px">오거=브루트 · 핑/셰이드=스텔스 · 사이펀=바이럴 / 벌워크=장벽형 · 랜턴/허니팟=감시형 · 하운드=반격형</div>
    </div>
    <div class="legend" data-testid="loadout-options">보정안: ${activeOptsText(app.options)}</div>
    <div class="legend">모드: ${app.mode === 'ai' ? `vs AI (규칙 기반 ${AI_STYLE_KO[app.aiStyle]})` : '핫시트 1v1 (한 기기에서 번갈아 계획)'} · 타이머 ${app.timerOn ? 'ON' : 'OFF'}</div>
    <div class="row"><button data-act="to-title">← 뒤로</button><button class="big primary" data-act="start" data-testid="btn-start">확정하고 매치 시작</button></div>
  </div>`;
}

// ---------------- 화면: 매치 ----------------
function viewer(): Player { return app.mode === 'ai' ? 'A' : app.planner; }

function visibleLog(entries: LogEntry[], v: Player | 'all') { return v === 'all' ? entries : entries.filter((e) => e.vis === 'all' || e.vis === v); }

function renderLogHtml(s: MatchState, v: Player | 'all') {
  const out: string[] = [];
  for (const t of [...s.turnLogs].reverse()) {
    const es = visibleLog(t.log, v);
    out.push(`<div class="t">── ${t.turn === 0 ? '구축 단계' : `T${String(t.turn).padStart(2, '0')}`} 해결 로그 ──</div>`);
    let step = 0;
    for (const e of es) {
      if (e.step !== step) { step = e.step; out.push(`<div class="s">${STEP_NAMES[step]}</div>`); }
      out.push(`<div class="e ${e.kind ?? ''}">&gt; ${esc(e.text)}</div>`);
    }
    if (!es.length) out.push(`<div class="e info">&gt; (보이는 사건 없음)</div>`);
  }
  if (!s.turnLogs.length) out.push(`<div class="e info">&gt; 요새 구축 단계: 초기 자금 ${TUNING.setupCyc} CYC로 내 성채에 ICE를 배치하세요 (상대는 볼 수 없음). 왼쪽 ■ 카드를 내 노드로 드래그.</div>`);
  return out.join('');
}

/** 구축 단계(숨은 금고)에서 고른 금고 소켓을 내 화면에 미리 반영 */
function myView(s: MatchState, v: Player): MatchView {
  const view = viewFor(s, v);
  if (s.turn === 0 && s.options.hiddenVaultsEnabled) {
    // 미리보기는 실제로 고른 소켓만 금고로 표시 (아무것도 안 골랐으면 4곳 모두 중계로 — 기본값을 미리 보여 주지 않음)
    const sv = app.pending[v].find((o) => o.type === 'setVaults');
    const vaults = app.vaultPick ?? (sv && sv.type === 'setVaults' ? sv.nodes : []);
    for (const id of socketsOf(v)) {
      const n = view.nodes[id];
      const kind = vaults.includes(id) ? 'vault' : 'relay';
      n.kind = kind; n.shownKind = kind; n.maxHp = NODE_SPECS[kind].hp * 10; n.hp = n.maxHp; n.data = kind === 'vault' ? vaultDataPts(s.options) : null;
    }
  }
  return view;
}
function renderMatch() {
  const s = app.state;
  const v = viewer();
  const view = myView(s, v);
  const pend = app.pending[v];
  const b = planBudget(s, v, pend);
  const setup = s.turn === 0;
  const enemy = other(v);
  const bwSeg = (n: number, cls: string) => `<div class="${cls}" style="width:${(n / b.bwCap) * 100}%"></div>`;
  const plannedAtk = b.bwAtk - view.me.bwAtk, plannedDef = b.bwDef - view.me.bwDef;
  const insp = renderInspector();
  const tool = app.tool;
  const toolHint = tool ? (tool.t === 'retarget' ? '목표 변경: 새 목표 노드를 클릭하세요 (Esc 취소)' : `${tool.t === 'prog' ? PROG_SPECS[tool.k].name + ' 발사: 대상 노드를 클릭' : ICE_SPECS[tool.k].name + ' 설치: 내 노드를 클릭'} (Esc 취소)`) : '카드를 노드로 드래그하거나, 카드 클릭 → 노드 클릭. 노드 클릭 = 인스펙터';
  root.innerHTML = `
  <div class="match ${app.bigLog ? 'biglog' : ''}" data-testid="screen-match">
    <div class="topbar">
      <div class="l1">
        <span data-testid="turn">TURN <b>${setup ? '구축' : String(s.turn).padStart(2, '0')}</b>/${TUNING.maxTurns}</span>
        <span>[ <b id="timer-top">${app.timerOn ? '--' : '타이머 꺼짐'}</b> ]</span>
        <span>${app.mode === 'hotseat' ? `<b style="color:var(--amber)">플레이어 ${v} 계획 중</b>` : '나 = A · 상대 = AI(B)'}</span>
        <span data-testid="cyc">CYC <b>${view.me.cyc}</b>/${TUNING.cycCap} → 계획 후 <b class="${b.cyc < 0 ? 'bad' : ''}">${b.cyc}</b> (수입 +${view.me.income}/턴)</span>
        <span data-testid="data">DATA ${v} <b>${view.me.data}</b> : <b>${view.enemy.data}</b> ${enemy} (목표 ${dataWinTarget(s)})</span>
        <span data-testid="heat">HEAT <span class="heatbar"><div style="width:${view.me.heat}%"></div></span> <b>${view.me.heat}</b> ${heatStage(view.me.heat)}</span>
        <span class="legend">상대 노출도: ${view.enemy.heat === null ? '잠복(?)' : `<b class="warn">${view.enemy.heat} ${view.enemy.heatStage}</b> · ICE ${view.enemy.iceCount}개 감지`}</span>
      </div>
      <div class="l1">
        <span>BW</span>
        <div class="bwbar" data-testid="bw">${bwSeg(view.me.bwDef, 'd')}${bwSeg(Math.max(0, plannedDef), 'd')}${bwSeg(view.me.bwAtk, 'a')}${bwSeg(Math.max(0, plannedAtk), 'a')}</div>
        <span><b>${b.bwUsed}</b>/${b.bwCap} (방어 <b style="color:var(--cyan)">${b.bwDef}</b> / 공격 <b style="color:var(--mag)">${b.bwAtk}</b>)</span>
        ${view.me.breach ? `<span class="warn">⚡ 침투 링크: ${esc(view.nodes[view.me.breach].label)}에서 발사 가능</span>` : ''}
        ${s.options.iceUpkeepEnabled ? `<span class="${view.pressure.upkeepTotal ? 'warn' : 'legend'}" data-testid="badge-upkeep">◇ 유지비 ${view.pressure.upkeepPerIce ? `이번 정산 ${view.pressure.upkeepPerIce}×ICE = ${view.pressure.upkeepTotal} CYC` : `T${s.options.iceUpkeepStartTurn}부터`}</span>` : ''}
        ${s.options.coreDirectDamageEnabled ? `<span class="legend" data-testid="badge-core">◇ 코어 직접 피해 ×${s.options.coreDirectDamagePct / 100}</span>` : ''}
        ${s.options.dataWinRaiseEnabled || s.options.neutralDataCapEnabled || s.options.neutralDataDelayEnabled ? `<span class="legend" data-testid="badge-data">◇ 데이터 감속:${s.options.dataWinRaiseEnabled ? ` 목표 ${s.options.dataWinRaised}` : ''}${s.options.neutralDataCapEnabled ? `${s.options.dataWinRaiseEnabled ? ' ·' : ''} 중립 누적 ${view.me.neutralData}/${s.options.coreBreachE2Enabled ? s.options.e2NeutralDataCap : s.options.neutralDataCap}` : ''}${s.options.neutralDataDelayEnabled ? `${s.options.dataWinRaiseEnabled || s.options.neutralDataCapEnabled ? ' ·' : ''} 중립 데이터 ${s.turn >= s.options.neutralDataStartTurn ? 'ON' : `T${s.options.neutralDataStartTurn}부터`}` : ''}</span>` : ''}
        ${s.options.coreBreachDataEnabled || s.options.coreBreachE2Enabled ? `<span class="legend" data-testid="badge-breach">◇ 코어 브리치 데이터${s.options.coreBreachE2Enabled ? ' (E2)' : ''}: ${view.me.breachData}/${s.options.coreBreachDataMax} · 누적 코어 피해 ${view.me.coreDmgDealt}${s.options.coreBreachE2Enabled ? ` · 중립 누적 ${view.me.neutralData}/${s.options.e2NeutralDataCap}` : ''}${s.options.breachTimeOnlyEnabled ? ' · 시간 판정에만' : ''}</span>` : ''}
        ${s.options.gateHpReducedEnabled || s.options.augerPierceEnabled ? `<span class="legend" data-testid="badge-gate">◇ ${[s.options.gateHpReducedEnabled ? `게이트 HP ${s.options.gateHpReduced}` : '', s.options.augerPierceEnabled ? `오거 관통 ${s.options.augerPiercePct}%` : '', s.options.gateSlotsReducedEnabled ? `게이트 슬롯 ${s.options.gateSlotsReduced}` : ''].filter(Boolean).join(' · ')}</span>` : ''}
        ${s.options.vaultDataReducedEnabled || s.options.siphonSlowEnabled ? `<span class="legend" data-testid="badge-vault">◇ ${[s.options.vaultDataReducedEnabled ? `금고 데이터 ${s.options.vaultDataReduced}` : '', s.options.siphonSlowEnabled ? `사이펀 ${s.options.siphonSlowHalfPerTurn / 2}점/턴` : ''].filter(Boolean).join(' · ')}</span>` : ''}
        ${s.options.suddenDeathEnabled ? `<span class="${view.pressure.suddenDeath ? 'bad' : 'legend'}" data-testid="badge-sd">◇ 서든데스 ${view.pressure.suddenDeath ? `이번 턴 코어 -${view.pressure.suddenDeath}${view.fogLifted ? ' · 안개 해제' : ''}` : `T${s.options.suddenDeathStartTurn}부터`}</span>` : ''}
        ${view.enemy.breachOnMe ? `<span class="bad">⚠ 상대가 내 ${esc(view.nodes[view.enemy.breachOnMe].label)}에 침투 링크 보유</span>` : ''}
      </div>
    </div>
    <div class="panel" data-testid="loadout-panel">
      <h3>로드아웃 · 공격 ▲</h3>
      ${ATK.map((k) => `<div class="tool atk ${tool?.t === 'prog' && tool.k === k ? 'sel' : ''}" draggable="${!setup}" data-tool="prog:${k}" data-testid="tool-${k}" style="${setup ? 'opacity:.4' : ''}"><span>▲ ${PROG_SPECS[k].name}</span><span class="c">${PROG_SPECS[k].cyc}/${PROG_SPECS[k].bw}</span></div>`).join('')}
      <h3>방어 ■ (ICE)</h3>
      ${DEF.map((k) => `<div class="tool def ${tool?.t === 'ice' && tool.k === k ? 'sel' : ''}" draggable="true" data-tool="ice:${k}" data-testid="tool-${k}"><span>■ ${ICE_SPECS[k].name}</span><span class="c">${iceCyc(s.options, k)}/${ICE_SPECS[k].bw}</span></div>`).join('')}
      ${setup && s.options.hiddenVaultsEnabled ? (() => {
        const sv = pend.find((o) => o.type === 'setVaults');
        const picked = app.vaultPick ?? (sv && sv.type === 'setVaults' ? sv.nodes : []);
        return `<h3>금고 지정 (숨은 금고)</h3><div class="row" style="flex-wrap:wrap;gap:3px;justify-content:flex-start" data-testid="vault-pick">${socketsOf(v).map((id) => `<button data-act="vpick" data-id="${id}" data-testid="vpick-${id.slice(1)}" class="${picked.includes(id) ? 'primary' : ''}">${picked.includes(id) ? '◆ ' : ''}${esc(nodeLabel(s, id).replace(/^[AB] /, ''))}</button>`).join('')}</div><div class="legend">${picked.length === 2 ? `금고: ${picked.map((id) => esc(nodeLabel(s, id).replace(/^[AB] /, ''))).join(' · ')}` : `<b style="color:var(--amber,#ffb020)">정확히 2곳을 골라야 확정할 수 있습니다 (현재 ${picked.length}곳)</b> · 시간 만료 시 고른 곳은 유지하고 빈 자리만 기본 소켓으로 채움`} — 나머지는 중계, 허니팟은 금고 아닌 소켓에만</div>${app.vaultMsg ? `<div class="legend" data-testid="vault-msg" style="color:#ffb020">${esc(app.vaultMsg)}</div>` : ''}`;
      })() : ''}
      <div class="row" style="justify-content:flex-start;margin:6px 0"><button data-act="overclock" ${setup ? 'disabled' : ''} data-testid="btn-overclock">${pend.some((o) => o.type === 'overclock') ? '✓ ' : ''}오버클럭 (+4 CYC, 노출도 +20)</button></div>
      <h3>이번 턴 명령 (${pend.length})</h3>
      <div class="orders" data-testid="orders">${pend.map((o, i) => `<div class="o ${b.errors[i] ? 'err' : ''}"><span>${esc(describeOrder(s, o))}${b.errors[i] ? ` ⚠ ${esc(b.errors[i]!)}` : ''}</span><button class="x" data-act="rm" data-i="${i}">✕</button></div>`).join('') || '<div class="legend">(없음)</div>'}</div>
      <details class="debug" ${app.debugOpen ? 'open' : ''} data-testid="debug"><summary data-act="dbg-toggle" data-testid="debug-toggle">디버그 · 빠른 검증 ${app.debugOpen ? '▲' : '▼'}</summary>
        <button data-dbg="heatSelf" data-testid="dbg-heat">내 HEAT +50</button>
        <button data-dbg="heatEnemy">상대 HEAT +50</button>
        <button data-dbg="hitEnemyCore" data-testid="dbg-core">상대 코어 HP -40</button>
        <button data-dbg="dataSelf">내 데이터 +4</button>
        <button data-dbg="skipToLastTurn" data-testid="dbg-last">마지막(20) 턴으로</button>
        <button data-dbg="skipToUpkeep" data-testid="dbg-upkeep" ${s.options.iceUpkeepEnabled ? '' : 'disabled'}>유지비 시작(T${s.options.iceUpkeepStartTurn})으로</button>
        <button data-dbg="skipToSuddenDeath" data-testid="dbg-sd" ${s.options.suddenDeathEnabled ? '' : 'disabled'}>서든데스(T${s.options.suddenDeathStartTurn})로</button>
        <div class="legend" style="margin-top:6px" data-testid="dbg-options">보정안 (매치 시작 시 고정, 타이틀에서 변경):<br/>${(Object.keys(OPT_LABEL) as OptKey[]).map((k) => `${s.options[k] ? '<b style="color:var(--green)">ON</b>' : 'off'} ${OPT_LABEL[k].split(' (')[0]}`).join('<br/>')}${app.mode === 'ai' ? `<br/>AI: ${AI_STYLE_KO[app.aiStyle]} · 시드 ${app.aiSeed}` : ''}</div>
        <button data-act="forfeit" class="danger">기권</button>
      </details>
    </div>
    <div class="mapwrap" data-testid="map-wrap">${renderMap(s, view, { selected: app.selected, pending: pend, me: v })}<div class="hint">${toolHint}</div></div>
    <div class="panel insp" data-testid="inspector">${insp}</div>
    <div class="bottom">
      <div class="log" data-testid="log">${renderLogHtml(s, v)}</div>
      <div class="confirm">
        <div class="timer" id="timer">${app.timerOn ? '' : '⏱ OFF'}</div>
        <button class="big primary" data-act="confirm" data-testid="btn-confirm">${setup ? '구축 완료' : '명령 확정'} (Space)</button>
        <button data-act="biglog" data-testid="btn-biglog">${app.bigLog ? '로그 줄이기' : '로그 크게 보기'}</button>
        <div class="legend">${app.mode === 'ai' ? '확정 시 AI와 동시에 해결됩니다.' : '확정 후 다음 플레이어에게 화면을 넘기세요. 상대 명령은 가려집니다.'}</div>
      </div>
    </div>
  </div>
  ${app.handover ? `<div class="overlay" data-testid="handover"><div class="big">${esc(app.handover.msg)}</div><div class="legend">다른 플레이어는 화면을 보지 마세요.</div><button class="big primary" data-act="handover-ok" data-testid="btn-handover">플레이어 ${app.handover.to} 준비 완료</button></div>` : ''}`;
  tickTimer();
}

function renderInspector(): string {
  const s = app.state, v = viewer();
  const view = myView(s, v);
  if (!app.selected) return `<h3>노드 인스펙터</h3><div class="legend">맵에서 노드를 클릭하면 상세 정보가 표시됩니다.<br/><br/>■ 시안 사각형 = ICE (점선 = 컴파일 중)<br/>▲ 마젠타 = 내 프로그램, ▲ 주황 = 적 프로그램<br/>? = 정찰되지 않은 적 노드<br/>◆ = 금고 데이터</div>`;
  const n = view.nodes[app.selected];
  const pend = app.pending[v];
  const out: string[] = [`<h3>노드 인스펙터</h3><div style="font-size:15px;color:#fff">${esc(n.label)}</div>`];
  const shown = n.enemy ? n.shownKind : n.kind;
  out.push(`<div class="kv"><span>종류</span><span>${kindKo(shown)}</span></div>`);
  out.push(`<div class="kv"><span>소유</span><span>${n.owner ? (n.owner === v ? '나' : '상대') : '중립'}</span></div>`);
  if (n.kind !== 'neutral') out.push(`<div class="kv"><span>HP</span><span>${n.destroyed ? (n.offline ? `오프라인(${n.offline}턴)` : '파괴됨') : n.hpHidden ? '? (숨은 금고 소켓 — 접촉 전 비공개)' : `${fmtHp(n.hp)}/${n.maxHp / 10}`}</span></div>`);
  if (n.data !== null) out.push(`<div class="kv"><span>데이터</span><span>${n.data}점</span></div>`);
  if (!n.enemy && n.kind !== 'neutral') out.push(`<div class="kv"><span>ICE 슬롯</span><span>${(n.ices ?? []).filter((i) => !i.free).length}/${n.slots}</span></div>`);
  if (n.vaultSignal) out.push(`<div class="kv"><span>정찰 신호</span><span style="color:#c3b0ff">금고 신호 감지</span></div>`);
  out.push(`<h3>ICE</h3>`);
  if (n.ices === null) out.push(`<div class="warn">미확인 (안개) — 핑으로 정찰하세요</div>`);
  else {
    if (n.enemy) out.push(`<div class="legend">최근 정찰: ${view.turn - (n.scoutedTurn ?? 0) <= 1 ? '최신' : `${view.turn - (n.scoutedTurn ?? 0)}턴 전`}</div>`);
    if (!n.ices.length) out.push(`<div class="legend">없음</div>`);
    for (const ice of n.ices) {
      const rec = pend.some((o) => o.type === 'recompile' && o.iceId === ice.id);
      out.push(`<div class="item"><span>■ ${ICE_SPECS[ice.kind].name}${n.mine ? ` HP ${fmtHp(ice.hp)}${ice.compiling ? ' (컴파일 중)' : ''}${ice.free ? ' (비상)' : ''}` : ''}</span>${n.mine && !ice.free ? `<button data-act="recompile" data-id="${ice.id}" ${rec ? 'disabled' : ''}>${rec ? '회수 예정' : '회수'}</button>` : ''}</div>`);
    }
  }
  const progs = view.programs.filter((p) => p.node === n.id);
  if (progs.length) {
    out.push(`<h3>프로그램</h3>`);
    for (const p of progs) {
      const jo = pend.some((o) => o.type === 'jackout' && o.progId === p.id);
      out.push(`<div class="item"><span>▲ ${PROG_SPECS[p.kind].name}#${p.id} ${p.mine ? `HP ${fmtHp(p.hp)} → ${esc(view.nodes[p.target!].label)}` : '(적)'}${p.stealth ? ' 은신' : ''}${p.detected ? ' 탐지됨' : ''}${p.stunned ? ' 정지' : ''}</span></div>`);
      if (p.mine) out.push(`<div class="btns"><button data-act="jackout" data-id="${p.id}" ${jo ? 'disabled' : ''}>${jo ? '철수 예정' : '철수'}</button><button data-act="retarget" data-id="${p.id}">목표 변경</button></div>`);
    }
  }
  out.push(`<div class="btns">`);
  if (n.mine && !n.destroyed && view.turn > 0) out.push(`<button data-act="repair" ${n.hp >= n.maxHp ? 'disabled' : ''}>수리 (${TUNING.repairCost} CYC → +${TUNING.repairHp})</button>`);
  if (!n.mine && view.turn > 0) out.push(`<button data-act="ping" data-testid="btn-ping">핑 발사 (1 CYC)</button>`);
  out.push(`</div>`);
  return out.join('');
}

// ---------------- 화면: 결과 ----------------
function renderResult() {
  const s = app.state;
  const v: Player = 'A';
  const w = s.winner;
  const { title, reason } = bannerText(s, app.mode === 'ai' ? 'ai' : 'hotseat'); // 기록 블록과 같은 용어 표 (record.ts)
  const cls = app.mode === 'ai' && w !== 'A' && w !== 'draw' ? 'lose' : 'win';
  const col = (p: Player) => s.players[p].bwHistory.map((h, i) => {
    const tot = Math.max(1, h.atk + h.def);
    return `<div class="col" title="T${i + 1}: 공격 ${h.atk} / 방어 ${h.def}"><div class="d" style="height:${(h.def / tot) * 100}%"></div><div class="a" style="height:${(h.atk / tot) * 100}%"></div></div>`;
  }).join('');
  const row = (p: Player) => `<tr><th>${p}${app.mode === 'ai' ? (p === 'A' ? ' (나)' : ' (AI)') : ''}</th><td>${s.players[p].data / 2}</td><td>${fmtHp(s.nodes[p + 'C'].hp)}/100</td><td>${s.players[p].heat}</td><td>${timeScore(s, p) / 2}</td></tr>`;
  root.innerHTML = `
  <div class="screen result" data-testid="screen-result">
    <div class="${cls}">${title}</div>
    <div class="sub">${reason} · ${s.turn}턴</div>
    <div class="legend" data-testid="result-options">보정안: ${activeOptsText(s.options)}</div>
    <table class="mx"><tr><th></th><th>데이터</th><th>코어 HP</th><th>노출도</th><th>시간판정 점수</th></tr>${row('A')}${row('B')}</table>
    <table class="mx" data-testid="record-block" style="margin-top:6px"><tr><th>플레이테스트 기록 [기획 v0.3.1]</th><th>A</th><th>B</th></tr>${buildRecord(s).map((r) => {
      const tip = HEAT_TIPS[r.key];
      const th = `<th>${r.label}${tip ? ' <span class="legend" style="cursor:help">ⓘ</span>' : ''}</th>`;
      const td = typeof r.value === 'string' ? `<td colspan="2">${esc(r.value)}</td>` : `<td>${esc(r.value[0])}</td><td>${esc(r.value[1])}</td>`;
      return `<tr data-testid="record-row-${r.key}"${tip ? ` title="${esc(tip)}"` : ''}>${th}${td}</tr>`;
    }).join('')}</table>
    <div class="row" style="gap:8px;margin-top:4px"><button data-act="copy-record" data-testid="btn-copy-record" title="${esc(`[기획 v0.3.1] 이번 경기 값 1줄을 탭 구분 ${recordColumns(buildRecord(s)).length}열로 복사 (머리줄 없음). 시트 열 순서: ${recordColumns(buildRecord(s)).map((c, i) => `${i + 1}. ${c}`).join(' | ')}`)}">기록 복사 ⓘ</button><span class="legend" data-testid="record-copy-msg"></span></div>
    <div class="card"><b>턴별 BW 공수 배분</b> <span class="legend">(시안 = 방어, 마젠타 = 공격)</span>
      <div style="margin-top:6px">A <div class="ratio">${col('A')}</div></div>
      <div style="margin-top:6px">B <div class="ratio">${col('B')}</div></div>
    </div>
    <div class="log" style="width:900px;max-height:260px" data-testid="result-log">${renderLogHtml({ ...s, turnLogs: s.turnLogs.slice(-1) }, app.mode === 'ai' ? v : 'all')}</div>
    <div class="row"><button class="big primary" data-act="to-title" data-testid="btn-again">타이틀로</button></div>
  </div>`;
}

// ---------------- 흐름 ----------------
function render() {
  if (app.screen === 'title') renderTitle();
  else if (app.screen === 'loadout') renderLoadout();
  else if (app.screen === 'match') renderMatch();
  else renderResult();
}

function startMatch() {
  app.state = createMatch(app.options);
  app.aiSeed = Date.now() % 1000000; // AI 선택 변주용 (시뮬레이션에는 들어가지 않음)
  app.planner = 'A';
  app.pending = { A: [], B: [] }; app.vaultPick = null; app.vaultMsg = '';
  app.selected = null; app.tool = null;
  app.handover = app.mode === 'hotseat' ? { to: 'A', msg: '요새 구축 단계 — 플레이어 A 차례' } : null;
  app.screen = 'match';
  resetDeadline();
  render();
}
function resetDeadline() { app.deadline = Date.now() + (app.state.turn === 0 ? TUNING.setupSeconds : TUNING.planSeconds) * 1000; }

function addOrder(o: Order) {
  const v = viewer();
  const list = app.pending[v];
  const b = planBudget(app.state, v, [...list, o]);
  const err = b.errors[b.errors.length - 1];
  if (err) { flash(`명령 불가: ${err}`); return; }
  list.push(o);
  app.tool = null;
  render();
}
let flashTimer = 0;
function flash(msg: string) {
  const h = root.querySelector('.hint');
  if (h) { h.textContent = msg; (h as HTMLElement).style.color = '#ff3b6b'; }
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { if (h) (h as HTMLElement).style.color = ''; }, 2500);
}

function dropOn(nodeId: string, tool: Tool) {
  if (!tool) { app.selected = nodeId; render(); return; }
  if (tool.t === 'prog') addOrder({ type: 'launch', prog: tool.k, target: nodeId });
  else if (tool.t === 'ice') addOrder({ type: 'compile', ice: tool.k, node: nodeId });
  else addOrder({ type: 'retarget', progId: tool.id, target: nodeId });
}

// 확정 재진입 방지: 더블클릭·Space 연타·타이머 만료가 겹쳐도 한 번의 계획 단계는 한 번만 해결된다
let confirmLock = false;
let phaseReadyAt = 0; // 새 계획 단계가 시작된 직후 짧은 유예 (더블클릭의 두 번째 클릭이 다음 턴을 확정하지 않도록)
const CONFIRM_SETTLE_MS = 400;
function confirm(auto = false) {
  if (confirmLock || app.handover || app.screen !== 'match' || Date.now() < phaseReadyAt) return;
  // 숨은 금고 구축 단계: 수동 확정은 금고 소켓 정확히 2곳일 때만. 시간 만료 자동 확정만 빈 자리를 기본값으로 채운다
  if (app.state.options.hiddenVaultsEnabled && app.state.turn === 0) {
    const v = viewer();
    if (!app.pending[v].some((o) => o.type === 'setVaults')) {
      const pick = app.vaultPick ?? [];
      if (!auto) {
        app.vaultMsg = `확정 불가: 금고 소켓을 정확히 2곳 고르세요 (현재 ${pick.length}곳)`;
        render(); flash(app.vaultMsg); return;
      }
      const f = fillVaultPick(v, pick);
      app.pending[v].unshift({ type: 'setVaults', nodes: f.nodes, autoFilled: f.autoFilled });
    }
  }
  confirmLock = true;
  try { doConfirm(); } finally { confirmLock = false; phaseReadyAt = Date.now() + CONFIRM_SETTLE_MS; }
}
function doConfirm() {
  app.vaultPick = null; app.vaultMsg = '';
  const v = viewer();
  if (app.mode === 'ai') {
    const ai = aiOrders(app.state, 'B', app.aiStyle, app.aiSeed);
    app.state = resolveTurn(app.state, app.pending.A, ai);
    app.pending = { A: [], B: [] };
    afterResolve();
  } else if (v === 'A') {
    app.planner = 'B';
    app.handover = { to: 'B', msg: `${app.state.turn === 0 ? '구축 단계' : `T${app.state.turn}`} — 플레이어 B 차례` };
    app.selected = null; app.tool = null;
    resetDeadline();
    render();
  } else {
    app.state = resolveTurn(app.state, app.pending.A, app.pending.B);
    app.pending = { A: [], B: [] };
    app.planner = 'A';
    app.handover = app.state.over ? null : { to: 'A', msg: `해결 완료 — T${app.state.turn} 플레이어 A 차례` };
    afterResolve();
  }
}
function afterResolve() {
  app.tool = null;
  if (app.state.over) { app.screen = 'result'; stopTimer(); }
  resetDeadline();
  render();
}

let timerHandle = 0;
function stopTimer() { clearInterval(timerHandle); timerHandle = 0; }
function tickTimer() {
  if (!app.timerOn || app.screen !== 'match') return;
  if (!timerHandle) timerHandle = window.setInterval(tickTimer, 250);
  if (app.handover) { resetDeadline(); }
  const left = Math.max(0, Math.ceil((app.deadline - Date.now()) / 1000));
  const el = document.getElementById('timer'), top = document.getElementById('timer-top');
  const txt = fmtClock(left);
  if (el) { el.textContent = `⏱ ${txt}`; el.classList.toggle('low', left <= 5); }
  if (top) top.textContent = txt;
  if (left <= 0 && !app.handover) confirm(true);
}

// ---------------- 이벤트 ----------------
root.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const actEl = t.closest('[data-act]') as HTMLElement | null;
  const dbg = t.closest('[data-dbg]') as HTMLElement | null;
  const toolEl = t.closest('[data-tool]') as HTMLElement | null;
  const nodeEl = t.closest('[data-node]') as Element | null;
  if (dbg) {
    app.state = debugApply(app.state, viewer(), dbg.dataset.dbg as DebugAction);
    if (app.state.over) { app.screen = 'result'; stopTimer(); } // 디버그로 코어 0 → 즉시 승리 화면
    render(); return;
  }
  if (toolEl) {
    const [kind, k] = toolEl.dataset.tool!.split(':');
    if (kind === 'prog' && app.state.turn === 0) { flash('구축 단계에서는 ICE만 배치할 수 있습니다'); return; }
    const same = app.tool && app.tool.t === kind && (app.tool as any).k === k;
    app.tool = same ? null : ({ t: kind, k } as Tool);
    render();
    return;
  }
  if (nodeEl) { dropOn(nodeEl.getAttribute('data-node')!, app.tool); return; }
  if (!actEl) return;
  const act = actEl.dataset.act!;
  const id = Number(actEl.dataset.id);
  switch (act) {
    case 'mode-ai': app.mode = 'ai'; app.screen = 'loadout'; render(); break;
    case 'mode-hotseat': app.mode = 'hotseat'; app.screen = 'loadout'; render(); break;
    case 'timer': app.timerOn = (actEl as HTMLInputElement).checked; break;
    case 'copy-record': {
      const text = recordTsv(buildRecord(app.state));
      const msg = document.querySelector('[data-testid=record-copy-msg]');
      void copyText(text).then((how) => { if (msg) msg.textContent = how === 'fail' ? '복사 실패 — 표를 직접 선택해 복사하세요' : `복사됨 (값 1줄 · 탭 구분 ${text.split('\t').length}열${how === 'execCommand' ? ', 대체 경로' : ''})`; });
      break;
    }
    case 'preset-v03': case 'preset-off': {
      for (const k of Object.keys(app.options) as OptKey[]) app.options[k] = act === 'preset-v03' ? SIEGE_V03_PRESET[k] : false;
      render(); break;
    }
    case 'opt': {
      app.options[actEl.dataset.key as OptKey] = (actEl as HTMLInputElement).checked;
      const dw = document.getElementById('title-datawin');
      if (dw) dw.textContent = String(app.options.dataWinRaiseEnabled ? SIEGE_PRESSURE.dataWinRaised : TUNING.dataWin);
      const ps = document.querySelector('[data-testid=preset-state]');
      if (ps) ps.textContent = `현재: ${presetState()}`;
      break;
    }
    case 'to-title': stopTimer(); app.screen = 'title'; render(); break;
    case 'start': startMatch(); break;
    case 'confirm': if ((ev as MouseEvent).detail > 1) break; confirm(); break;
    case 'dbg-toggle': ev.preventDefault(); app.debugOpen = !app.debugOpen; render(); break;
    case 'biglog': app.bigLog = !app.bigLog; render(); break;
    case 'handover-ok':
      // 가림 화면 해제는 '확정'이 아니므로 유예 창을 열지 않는다 (바로 확정 가능). 해제 클릭 자체는 이 분기에서 끝나 확정으로 새지 않는다
      app.handover = null; phaseReadyAt = 0; resetDeadline(); render(); break;
    case 'rm': { const l = app.pending[viewer()]; if (l[Number(actEl.dataset.i)]?.type === 'setVaults') { app.vaultPick = null; app.vaultMsg = ''; } l.splice(Number(actEl.dataset.i), 1); render(); break; }
    case 'vpick': {
      const v = viewer(), id = actEl.dataset.id!;
      const sv = app.pending[v].find((o) => o.type === 'setVaults');
      const cur = app.vaultPick ?? (sv && sv.type === 'setVaults' ? [...sv.nodes] : []);
      let pick = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      app.vaultMsg = '';
      if (pick.length > 2) {
        // 3번째 선택: 가장 먼저 고른 곳이 빠진다 (마지막 2곳 유지) — 무엇이 빠졌는지 알려 준다
        const dropped = pick.slice(0, pick.length - 2);
        pick = pick.slice(pick.length - 2);
        app.vaultMsg = `${dropped.map((d) => nodeLabel(app.state, d).replace(/^[AB] /, '')).join(', ')} 선택 해제 (금고는 최대 2곳 — 마지막에 고른 2곳 유지)`;
      }
      app.vaultPick = pick;
      app.pending[v] = app.pending[v].filter((o) => o.type !== 'setVaults');
      if (pick.length === 2) app.pending[v].unshift({ type: 'setVaults', nodes: [...pick].sort() });
      render(); break;
    }
    case 'overclock': {
      const l = app.pending[viewer()];
      const i = l.findIndex((o) => o.type === 'overclock');
      if (i >= 0) { l.splice(i, 1); render(); } else addOrder({ type: 'overclock' });
      break;
    }
    case 'recompile': addOrder({ type: 'recompile', iceId: id }); break;
    case 'jackout': addOrder({ type: 'jackout', progId: id }); break;
    case 'retarget': app.tool = { t: 'retarget', id }; render(); break;
    case 'repair': if (app.selected) addOrder({ type: 'repair', node: app.selected }); break;
    case 'ping': if (app.selected) addOrder({ type: 'launch', prog: 'ping', target: app.selected }); break;
    case 'forfeit': app.state = forfeit(app.state, viewer()); afterResolve(); break;
  }
});
root.addEventListener('change', (ev) => {
  const t = ev.target as HTMLSelectElement;
  if (t.dataset.act === 'aistyle') app.aiStyle = t.value as AiStyle;
});
root.addEventListener('dragstart', (ev) => {
  const el = (ev.target as HTMLElement).closest?.('[data-tool]') as HTMLElement | null;
  if (!el || !ev.dataTransfer) return;
  ev.dataTransfer.setData('text/plain', el.dataset.tool!);
  ev.dataTransfer.effectAllowed = 'copy';
});
root.addEventListener('dragover', (ev) => {
  const n = (ev.target as Element).closest?.('[data-node]');
  if (n) { ev.preventDefault(); root.querySelectorAll('.drop-ok').forEach((x) => x.classList.remove('drop-ok')); root.querySelectorAll(`[data-node="${n.getAttribute('data-node')}"]`).forEach((x) => x.classList.add('drop-ok')); }
});
root.addEventListener('drop', (ev) => {
  const n = (ev.target as Element).closest?.('[data-node]');
  const data = ev.dataTransfer?.getData('text/plain');
  if (!n || !data) return;
  ev.preventDefault();
  const [kind, k] = data.split(':');
  if (kind === 'prog' && app.state.turn === 0) { flash('구축 단계에서는 ICE만 배치할 수 있습니다'); return; }
  dropOn(n.getAttribute('data-node')!, { t: kind, k } as Tool);
});
window.addEventListener('keydown', (ev) => {
  if (app.screen !== 'match') return;
  if (ev.key === 'Escape') { app.tool = null; render(); }
  if (ev.code === 'Space' && !app.handover) { ev.preventDefault(); if (!ev.repeat) confirm(); }
});
(window as any).__coldcore = app; // 디버깅·자동 검증용 핸들
render();
