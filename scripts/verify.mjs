// 헤드리스 브라우저로 단일 파일 빌드를 file:// 로 열어 실제 플레이를 검증하고 스크린샷을 저장한다.
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const file = resolve('dist-single/cold-core-prototype.html');
const shots = resolve('screenshots');
mkdirSync(shots, { recursive: true });
const exe = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const step = (m) => console.log('•', m);
const turnText = () => page.locator('[data-testid=turn]').innerText();
const ordersText = () => page.locator('[data-testid=orders]').innerText();
// 확정은 재진입 가드(확정 직후 400ms 유예)가 있으므로 사람처럼 약간 텀을 두고 누른다
const confirmTurn = async () => { await page.waitForTimeout(450); await page.click('[data-testid=btn-confirm]'); };
// 디버그 패널은 기본 접힘 → 필요할 때 펼친다
const openDebug = async () => { if ((await page.locator('details.debug[open]').count()) === 0) await page.click('[data-testid=debug-toggle]'); };
const dbg = async (sel) => { await openDebug(); await page.click(sel); };
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']); // 기록 복사 검증용

// [기획 v0.3.1] 결과 화면 기록 블록: 행 읽기 · 기대 TSV · '기록 복사' 두 경로(클립보드 API / execCommand 대체) 검증
const RECORD_KEYS = ['winner', 'winType', 'turns', 'firstGate', 'suddenDeath', 'minCoreHp', 'heatPulloutTurns', 'heatHighTurns', 'tracebacks'];
const recordRows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=record-block] tr[data-testid]')].map((tr) => ({
  key: tr.dataset.testid.replace('record-row-', ''), label: tr.querySelector('th').textContent.replace('ⓘ', '').trim(),
  vals: [...tr.querySelectorAll('td')].map((td) => td.textContent), title: tr.getAttribute('title') })));
// 복사 내용 = 값 1줄 (머리줄 없음, 13열). 열 이름은 버튼 툴팁에만
const tsvFromRows = (rows) => rows.flatMap((r) => r.vals).join('\t');
const colsFromRows = (rows) => rows.flatMap((r) => (r.vals.length === 1 ? [r.label] : [`${r.label} A`, `${r.label} B`]));
async function checkRecord(name, want) {
  const rows = await recordRows();
  const by = Object.fromEntries(rows.map((r) => [r.key, r.vals.join('/')]));
  const fails = [];
  if (rows.map((r) => r.key).join() !== RECORD_KEYS.join()) fails.push(`행 순서 ${rows.map((r) => r.key).join()}`);
  for (const [k, v] of Object.entries(want)) if (!(v instanceof RegExp ? v.test(by[k]) : by[k] === v)) fails.push(`${k}="${by[k]}" (기대 ${v})`);
  for (const k of ['heatPulloutTurns', 'heatHighTurns', 'tracebacks']) if (!(rows.find((r) => r.key === k)?.title ?? '').includes('[기획 v0.3.1]')) fails.push(`${k} 툴팁 없음`);
  if ((await page.locator('[data-testid=heat-stats]').count()) !== 0) fails.push('옛 노출도 표가 따로 남아 있음');
  const bannerReason = (await page.locator('[data-testid=screen-result] .sub').innerText()).split(' · ')[0].trim();
  const bannerTitle = (await page.locator('[data-testid=screen-result] .win, [data-testid=screen-result] .lose').innerText()).trim();
  const bannerWord = by.winType === '무승부' ? bannerTitle : bannerReason;
  if (by.winType !== bannerWord) fails.push(`승리 유형 용어 불일치: 기록 "${by.winType}" / 배너 "${bannerWord}"`);
  const SHEET = ['승자', '승리 유형', '경기 길이 (턴)', '첫 게이트 돌파', '서든데스 도달', '최저 코어 HP A', '최저 코어 HP B', 'HEAT 80+ 철수 턴 A', 'HEAT 80+ 철수 턴 B', 'HEAT 80+ 머문 턴 A', 'HEAT 80+ 머문 턴 B', '역추적 (HEAT 100) A', '역추적 (HEAT 100) B'];
  if (colsFromRows(rows).join('|') !== SHEET.join('|')) fails.push(`열 순서 ${colsFromRows(rows).join('|')}`);
  step(`배너 용어 "${bannerWord}" = 기록 "${by.winType}" ${by.winType === bannerWord ? 'OK' : '(실패)'} / 13열 순서 ${colsFromRows(rows).join(' | ')}`);
  step(`기록 블록(${name}) ${fails.length ? `(실패: ${fails.join('; ')})` : 'OK'}: ${rows.map((r) => `${r.label}=${r.vals.join('/')}`).join(' · ')}`);
  // 복사 ① 클립보드 API
  const want1 = tsvFromRows(rows);
  const msgSel = '[data-testid=record-copy-msg]';
  await page.evaluate(() => navigator.clipboard.writeText('(비움)'));
  await page.click('[data-testid=btn-copy-record]');
  await page.waitForFunction((sel) => document.querySelector(sel).textContent.length > 0, msgSel, { timeout: 3000 });
  const msg1 = await page.locator(msgSel).innerText();
  const got1 = await page.evaluate(() => navigator.clipboard.readText());
  // 복사 ② execCommand 대체 경로 (클립보드 API가 없는 환경 흉내)
  await page.evaluate((sel) => {
    window.__clip = navigator.clipboard; window.__exec = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined });
    const orig = document.execCommand.bind(document);
    document.execCommand = (c, ...a) => { window.__exec++; return orig(c, ...a); };
    document.querySelector(sel).textContent = '';
    return window.__clip.writeText('(비움)');
  }, msgSel);
  await page.click('[data-testid=btn-copy-record]');
  await page.waitForFunction((sel) => document.querySelector(sel).textContent.length > 0, msgSel, { timeout: 3000 });
  const msg2 = await page.locator(msgSel).innerText();
  const [got2, execN] = await page.evaluate(async () => [await window.__clip.readText(), window.__exec]);
  await page.evaluate(() => { delete navigator.clipboard; delete document.execCommand; });
  const tip = (await page.locator('[data-testid=btn-copy-record]').getAttribute('title')) ?? '';
  const wantTip = colsFromRows(rows).map((c, i) => `${i + 1}. ${c}`).join(' | ');
  const okShape = !/[\n\r]/.test(got1) && got1.split('\t').length === 13 && !got1.includes('승자');
  const okTip = tip.includes(wantTip) && tip.includes('머리줄 없음');
  step(`기록 복사 형식(${name}): 값 1줄·${got1.split('\t').length}열·머리줄 없음 ${okShape ? 'OK' : '(실패)'} / 버튼 툴팁 열 순서 ${okTip ? 'OK' : '(실패)'}: "${tip}"`);
  const ok1 = got1 === want1 && msg1.startsWith('복사됨') && !msg1.includes('대체');
  const ok2 = got2 === want1 && msg2.includes('대체 경로') && execN === 1;
  step(`기록 복사(${name}): 클립보드 API ${ok1 ? 'OK' : '(실패)'} "${msg1}" / execCommand 대체 ${ok2 ? 'OK' : '(실패)'} "${msg2}" (execCommand ${execN}회) / 복사 내용: ${JSON.stringify(got1)}`);
}

await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
await page.waitForSelector('[data-testid=screen-title]');
await page.screenshot({ path: `${shots}/01-title.png` });
step('타이틀 화면 OK');

await page.click('[data-testid=btn-vs-ai]');
await page.waitForSelector('[data-testid=screen-loadout]');
await page.screenshot({ path: `${shots}/02-loadout.png` });
step('로드아웃 화면 OK');
await page.click('[data-testid=btn-start]');
await page.waitForSelector('[data-testid=screen-match]');
step(`매치 시작: ${await turnText()}`);

// 구축: 드래그 앤 드롭 + 클릭 배치
await page.locator('[data-testid=tool-bulwark]').dragTo(page.locator('[data-node=AG1]').first());
await page.locator('[data-testid=tool-bulwark]').dragTo(page.locator('[data-node=AG2]').first());
await page.click('[data-testid=tool-hound]');
await page.click('[data-node=AR2] >> nth=0');
await page.click('[data-testid=tool-lantern]');
await page.click('[data-node=AP1] >> nth=0');
step(`구축 명령: ${(await ordersText()).replace(/\n/g, ' | ')}`);
await confirmTurn();
step(`구축 완료 → ${await turnText()}`);

// T1: 정찰 + 공격 (드래그)
await page.locator('[data-testid=tool-ping]').dragTo(page.locator('[data-node=BR2]').first());
await page.locator('[data-testid=tool-auger]').dragTo(page.locator('[data-node=BC]').first());
await page.locator('[data-testid=tool-siphon]').dragTo(page.locator('[data-node=BV1]').first());
step(`T1 명령: ${(await ordersText()).replace(/\n/g, ' | ')}`);
await confirmTurn();
// T2~T4
for (let i = 0; i < 3; i++) {
  if (i === 0) await page.locator('[data-testid=tool-auger]').dragTo(page.locator('[data-node=BC]').first());
  if (i === 1) { await page.click('[data-testid=tool-shade]'); await page.click('[data-node=BR2] >> nth=0'); }
  await confirmTurn();
  step(`턴 진행 → ${await turnText()}`);
}
await page.click('[data-node=BG1] >> nth=0');
await page.screenshot({ path: `${shots}/03-match-midgame.png` });
await page.click('[data-testid=btn-biglog]');
await page.screenshot({ path: `${shots}/04-turn-resolution-log.png` });
await page.click('[data-testid=btn-biglog]');
const logTxt = await page.locator('[data-testid=log]').innerText();
step(`로그 단계 헤더 포함: ${['① ', '② ', '③ ', '④ ', '⑦ '].filter((h) => logTxt.includes(h)).join(' ')}`);

// 역추적: 디버그로 HEAT 100 → 확정
await dbg('[data-testid=dbg-heat]');
await dbg('[data-testid=dbg-heat]');
step(`HEAT 표시: ${await page.locator('[data-testid=heat]').innerText()}`);
await confirmTurn();
const tb = await page.locator('[data-testid=log] .e', { hasText: '역추적' }).first().innerText();
step(`역추적 로그: ${tb}`);
await page.click('[data-testid=btn-biglog]');
await page.screenshot({ path: `${shots}/05-traceback-log.png` });
await page.click('[data-testid=btn-biglog]');

// 승리 조건 → 결과 화면 (데이터 12점: 디버그 +4 ×3 후 확정)
for (let i = 0; i < 3; i++) await dbg('[data-dbg=dataSelf]');
await confirmTurn();
await page.waitForSelector('[data-testid=screen-result]');
step(`결과 화면: ${(await page.locator('[data-testid=screen-result] .win, [data-testid=screen-result] .lose').innerText())} / ${await page.locator('[data-testid=screen-result] .sub').innerText()}`);
await page.screenshot({ path: `${shots}/06-result.png`, fullPage: true });
await checkRecord('모두 끔 · 데이터 탈취', { winner: 'A', winType: '데이터 탈취', firstGate: '없음', suddenDeath: '아니오 (서든데스 꺼짐)', minCoreHp: /^\d+(\.\d)?\/\d+(\.\d)?$/ });

// 핫시트: 명령 가림 오버레이 확인 + 타이머 자동 확정
await page.click('[data-testid=btn-again]');
await page.check('[data-act=timer]');
await page.click('[data-testid=btn-hotseat]');
await page.click('[data-testid=btn-start]');
await page.waitForSelector('[data-testid=handover]');
await page.click('[data-testid=btn-handover]');
await page.click('[data-testid=tool-hound]'); await page.click('[data-node=AR2] >> nth=0');
await confirmTurn();
await page.waitForSelector('[data-testid=handover]');
step(`핫시트 가림 화면: ${await page.locator('[data-testid=handover] div.big').innerText()}`);
await page.click('[data-testid=btn-handover]');
const bSeesA = await page.locator('[data-testid=log]').innerText();
step(`B 화면에 A의 구축 명령 노출 여부: ${bSeesA.includes('하운드') ? '노출됨(버그)' : '가려짐'}`);
await confirmTurn();
await page.click('[data-testid=btn-handover]');
step(`핫시트 해결 → ${await turnText()}`);
const t0 = await turnText();
await page.waitForFunction((t) => document.querySelector('[data-testid=handover]') || document.querySelector('[data-testid=turn]')?.textContent !== t, t0, { timeout: 25000 });
step(`타이머 20초 만료 → 자동 확정 (오버레이 표시: ${await page.locator('[data-testid=handover]').count() > 0})`);

// 공성 압박 보정안: 타이틀에서 세 옵션 켜기 → 배지·디버그 표시·로그 확인
await page.click('[data-testid=btn-again]').catch(() => {});
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
await page.check('[data-testid=opt-iceUpkeepEnabled]');
await page.check('[data-testid=opt-coreDirectDamageEnabled]');
await page.check('[data-testid=opt-suddenDeathEnabled]');
await page.click('[data-testid=btn-vs-ai]');
step(`로드아웃 보정안 표시: ${await page.locator('[data-testid=loadout-options]').innerText()}`);
await page.click('[data-testid=btn-start]');
await page.click('[data-testid=tool-bulwark]'); await page.click('[data-node=AG1] >> nth=0');
await page.click('[data-testid=tool-hound]'); await page.click('[data-node=AR2] >> nth=0');
await confirmTurn();
await openDebug();
step(`디버그 패널 옵션: ${(await page.locator('[data-testid=dbg-options]').innerText()).replace(/\n/g, ' | ')}`);
await dbg('[data-testid=dbg-upkeep]');
await confirmTurn();
const up = await page.locator('[data-testid=log] .e', { hasText: 'ICE 유지비' }).first().innerText();
step(`유지비 로그: ${up}`);
await dbg('[data-testid=dbg-sd]');
step(`서든데스 배지(T15 계획): ${await page.locator('[data-testid=badge-sd]').innerText()}`);
await confirmTurn();
const sdl = await page.locator('[data-testid=log] .e', { hasText: '서든데스' }).allInnerTexts();
step(`서든데스 로그: ${sdl.join(' / ')}`);
step(`배지: ${await page.locator('[data-testid=badge-upkeep]').innerText()} / ${await page.locator('[data-testid=badge-core]').innerText()} / ${await page.locator('[data-testid=badge-sd]').innerText()}`);
await page.click('[data-node=BG1] >> nth=0');
await page.screenshot({ path: `${shots}/07-siege-options.png` });

// ── QA 버그 회귀 확인 ──
const intTurn = async () => Number((await turnText()).match(/(\d+)/)?.[1] ?? -1);
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
await page.check('[data-act=timer]');
await page.click('[data-testid=btn-vs-ai]');
await page.click('[data-testid=btn-start]');
await page.waitForTimeout(300);
const clock = await page.locator('#timer-top').innerText();
step(`버그6 구축 타이머 표시: "${clock}" → ${/^0[01]:\d\d$/.test(clock) && clock !== '00:60' ? 'OK' : '실패'}`);
await page.uncheck('[data-act=timer]').catch(() => {});
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
await page.click('[data-testid=btn-vs-ai]');
await page.click('[data-testid=btn-start]');
await confirmTurn();
let t1 = await intTurn();
await page.waitForTimeout(450);
await page.dblclick('[data-testid=btn-confirm]');
await page.waitForTimeout(600);
let t2 = await intTurn();
step(`버그1 확정 더블클릭: 턴 ${t1} → ${t2} (${t2 - t1 === 1 ? 'OK, 1턴만 진행' : '실패'})`);
await page.keyboard.press('Space'); await page.keyboard.press('Space');
await page.waitForTimeout(600);
const t3 = await intTurn();
step(`버그1 Space 연타: 턴 ${t2} → ${t3} (${t3 - t2 === 1 ? 'OK, 1턴만 진행' : '실패'})`);
await page.evaluate(() => { const b = document.querySelector('[data-testid=btn-confirm]'); b.click(); b.click(); b.click(); });
await page.waitForTimeout(600);
const t4 = await intTurn();
step(`버그1 같은 틱 3연속 click(): 턴 ${t3} → ${t4} (${t4 - t3 === 1 ? 'OK' : '실패'})`);

// 버그7: 1280×800에서 왼쪽 패널·디버그 버튼이 잘리지 않는지
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);
const fitClosed = await page.evaluate(() => {
  const vh = window.innerHeight;
  const tools = [...document.querySelectorAll('.tool')].map((e) => e.getBoundingClientRect().bottom);
  const summ = document.querySelector('[data-testid=debug-toggle]').getBoundingClientRect().bottom;
  return { maxTool: Math.max(...tools), summ, vh };
});
step(`버그7 1280×800 디버그 접힘: 툴 최하단 ${Math.round(fitClosed.maxTool)}px, 디버그 제목 ${Math.round(fitClosed.summ)}px / 창 ${fitClosed.vh}px → ${fitClosed.summ <= fitClosed.vh ? 'OK' : '잘림'}`);
await page.screenshot({ path: `${shots}/08-1280x800.png` });
await openDebug();
const dbgBtns = page.locator('details.debug button');
const nBtn = await dbgBtns.count();
let reach = 0;
for (let i = 0; i < nBtn; i++) { const b = dbgBtns.nth(i); await b.scrollIntoViewIfNeeded(); const bb = await b.boundingBox(); if (bb && bb.y >= 0 && bb.y + bb.height <= 800) reach++; }
step(`버그7 1280×800 디버그 펼침: 버튼 ${reach}/${nBtn}개가 화면 안에서 클릭 가능 (패널 스크롤)`);
await page.screenshot({ path: `${shots}/09-1280x800-debug-open.png` });

// 버그5: 디버그 적 코어 -40 반복 → 0 → 코어 브리치 승리
for (let i = 0; i < 12 && (await page.locator('[data-testid=screen-result]').count()) === 0; i++) await dbg('[data-dbg=hitEnemyCore]');
await page.waitForSelector('[data-testid=screen-result]', { timeout: 3000 }).catch(() => {});
const won = (await page.locator('[data-testid=screen-result]').count()) > 0;
step(`버그5 디버그 코어 -40 반복: ${won ? `결과 화면 "${(await page.locator('[data-testid=screen-result] .sub').innerText()).split('\n')[0]}"` : '승리 화면 안 뜸(실패)'}`);
await page.setViewportSize({ width: 1600, height: 950 });

// ── 데이터 감속안 D1~D3: 타이틀 토글 → 배지·목표 점수·로그 ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
for (const k of ['dataWinRaiseEnabled', 'neutralDataCapEnabled', 'neutralDataDelayEnabled']) await page.check(`[data-testid=opt-${k}]`);
await page.screenshot({ path: `${shots}/01b-title-options.png` });
await page.click('[data-testid=btn-vs-ai]');
step(`로드아웃 보정안 표시(D): ${await page.locator('[data-testid=loadout-options]').innerText()}`);
await page.click('[data-testid=btn-start]');
await confirmTurn();
step(`D1 목표 표시: ${await page.locator('[data-testid=data]').innerText()}`);
step(`D 배지: ${await page.locator('[data-testid=badge-data]').innerText()}`);
let dLog = [];
for (let i = 0; i < 4 && !dLog.length; i++) {
  // 내 프로그램으로 중립 북 점령 시도 (오거를 중립 북으로)
  if (i === 0) await page.locator('[data-testid=tool-auger]').dragTo(page.locator('[data-node=N1]').first());
  await confirmTurn();
  dLog = await page.locator('[data-testid=log] .e', { hasText: '(D3)' }).allInnerTexts();
}
step(`D3 로그: ${dLog.length ? dLog[0] : '이번 실행에서는 T6 전에 중립을 보유하지 못해 로그 없음'}`);
await openDebug();
step(`디버그 패널 옵션(D): ${(await page.locator('[data-testid=dbg-options]').innerText()).replace(/\n/g, ' | ')}`);
await page.screenshot({ path: `${shots}/10-data-options.png` });

// ── 코어 브리치 데이터 E1/E2: 타이틀 토글 → 배지·옵션 표시 ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
for (const k of ['coreBreachDataEnabled', 'coreBreachE2Enabled', 'neutralDataCapEnabled']) await page.check(`[data-testid=opt-${k}]`);
await page.click('[data-testid=btn-vs-ai]');
step(`로드아웃 보정안 표시(E): ${await page.locator('[data-testid=loadout-options]').innerText()}`);
await page.click('[data-testid=btn-start]');
await confirmTurn();
step(`E 배지: ${await page.locator('[data-testid=badge-breach]').innerText()} / D 배지(E2 상한 반영): ${await page.locator('[data-testid=badge-data]').innerText()}`);
await openDebug();
step(`디버그 패널 옵션(E): ${(await page.locator('[data-testid=dbg-options]').innerText()).replace(/\n/g, ' | ')}`);
await page.screenshot({ path: `${shots}/11-breach-options.png` });

// ── 핫시트: 가림 화면 해제 직후(100ms 이내) 확정이 먹히는지 + 확정 더블클릭은 한 단계만 ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
await page.click('[data-testid=btn-hotseat]');
await page.click('[data-testid=btn-start]');
await page.click('[data-testid=btn-handover]');           // A 구축 시작
await page.click('[data-testid=btn-confirm]');            // A 구축 확정 → B 가림
await page.waitForSelector('[data-testid=handover]');
const hsMsg0 = await page.locator('[data-testid=handover] div.big').innerText();
const tHs = await page.evaluate(() => {
  const t0 = performance.now();
  document.querySelector('[data-testid=btn-handover]').click();
  const b = document.querySelector('[data-testid=btn-confirm]');
  b.click();
  return { dt: performance.now() - t0, over: !!document.querySelector('[data-testid=handover]'), msg: document.querySelector('[data-testid=handover] div.big')?.textContent ?? '' };
});
step(`핫시트 가림 해제→${tHs.dt.toFixed(1)}ms 후 확정: 이전 "${hsMsg0}" → ${tHs.over && tHs.msg !== hsMsg0 ? `다음 단계로 진행 OK ("${tHs.msg}")` : '확정 무시됨(실패)'}`);
const hsTurn0 = await turnText();
await page.click('[data-testid=btn-handover]');           // A 차례 해제
await page.waitForTimeout(450);
await page.dblclick('[data-testid=btn-confirm]');         // A 더블클릭 확정
await page.waitForTimeout(300);
const hsMsg1 = await page.locator('[data-testid=handover] div.big').innerText().catch(() => '');
await page.click('[data-testid=btn-handover]');           // B 해제
const hsTurn1 = await turnText();
step(`핫시트 확정 더블클릭: 가림 "${hsMsg1}", 턴 ${hsTurn0} → ${hsTurn1} (${hsMsg1.includes('B') && hsTurn0 === hsTurn1 ? 'OK, 한 단계만(B 차례로)' : '실패'})`);

// ── v0.5: G1·G2·E1' 배지 + 숨은 금고 소켓 선택 ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
for (const k of ['gateHpReducedEnabled', 'augerPierceEnabled', 'breachTimeOnlyEnabled', 'coreBreachE2Enabled', 'hiddenVaultsEnabled']) await page.check(`[data-testid=opt-${k}]`);
await page.click('[data-testid=btn-vs-ai]');
await page.click('[data-testid=btn-start]');
step(`H 소켓 버튼(기본): ${(await page.locator('[data-testid=vault-pick]').innerText()).replace(/\n/g, ' ')}`);
const vtxt = async () => (await page.locator('[data-testid=vault-pick]').innerText()).replace(/\n/g, ' ');
const vmsg = async () => ((await page.locator('[data-testid=vault-msg]').count()) ? await page.locator('[data-testid=vault-msg]').innerText() : '(없음)');
const panelNote = async () => (await page.locator('[data-testid=vault-pick] + .legend').innerText()).replace(/\n/g, ' ');
// QA1: 0곳 / 1곳 선택에서 수동 확정은 막힌다
// 미리보기 = 실제 선택: 아무것도 안 골랐으면 내 소켓 4곳 모두 중계로 표시
const mySock = () => page.evaluate(() => ['AV1', 'AR1', 'AV2', 'AR3'].map((id) => [...document.querySelectorAll(`[data-node=${id}]`)].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim()).join(' / '));
const prev0 = await mySock();
step(`H 미리보기(0곳 선택): ${prev0} → ${prev0.includes('◆') ? '실패: 금고 표시됨' : 'OK, 금고 표시 없음'}`);
const turnBefore = await turnText();
await page.waitForTimeout(450); await page.click('[data-testid=btn-confirm]');
step(`H 0곳 선택 수동 확정: 턴 ${turnBefore} → ${await turnText()} (${(await turnText()) === turnBefore ? 'OK, 막힘' : '실패: 진행됨'}) / 패널 "${await vmsg()}"`);
await page.click('[data-testid=vpick-R1]');   // 소켓2 (1곳)
const prev1 = await mySock();
step(`H 미리보기(소켓2만 선택): ${prev1} → ${(prev1.match(/◆/g) ?? []).length === 1 && prev1.split(' / ')[1].includes('◆') ? 'OK, 소켓2만 금고' : '확인 필요'}`);
await page.waitForTimeout(450); await page.click('[data-testid=btn-confirm]');
step(`H 1곳 선택 수동 확정: 턴 ${await turnText()} (${(await turnText()) === turnBefore ? 'OK, 막힘' : '실패: 진행됨'}) / 패널 "${await vmsg()}" / 안내 "${await panelNote()}" / 명령에 금고 지정 ${(await ordersText()).includes('금고 지정') ? '있음(실패)' : '없음(OK)'}`);
await page.click('[data-testid=vpick-V1]');   // 소켓2·소켓1
await page.click('[data-testid=vpick-V2]');   // 3번째 → 소켓2 빠짐
step(`H 3번째 소켓 클릭: 버튼 "${await vtxt()}" / 패널 "${await vmsg()}"`);
await page.click('[data-testid=vpick-V1]');   // 소켓1 해제 → 소켓3
await page.click('[data-testid=vpick-R1]');   // 소켓3·소켓2
step(`H 금고 지정 후 명령: ${(await ordersText()).replace(/\n/g, ' | ')}`);
const hint = () => page.locator('.hint').first().innerText();
await page.locator('[data-testid=tool-honeypot]').dragTo(page.locator('[data-node=AR1]').first());  // 금고 소켓 → 거절되어야 함
step(`H 허니팟→금고 소켓(소켓2): ${await hint()}`);
await page.locator('[data-testid=tool-honeypot]').dragTo(page.locator('[data-node=AV1]').first());  // 비금고 소켓 → 허용
step(`H 허니팟→비금고 소켓(소켓1) 후 명령: ${(await ordersText()).replace(/\n/g, ' | ')}`);
await page.screenshot({ path: `${shots}/12-hidden-vaults-setup.png` });
await confirmTurn();
const enemyLabels = await page.evaluate(() => ['BV1', 'BR1', 'BV2', 'BR3'].map((id) => [...document.querySelectorAll(`[data-node=${id}]`)].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim()));
step(`H 적 소켓 표시(정찰 전): ${enemyLabels.join(' / ')}`);
step(`G 배지: ${await page.locator('[data-testid=badge-gate]').innerText()} / E 배지: ${await page.locator('[data-testid=badge-breach]').innerText()}`);
step(`G1 내 게이트 HP: ${(await page.evaluate(() => [...document.querySelectorAll('[data-node=AG1]')].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim()))}`);
await page.screenshot({ path: `${shots}/13-v05-match.png` });
// QA2: E1' 켜진 매치의 20턴 시간 판정 로그에 브리치 점수 표시
await dbg('[data-dbg=skipToLastTurn]');
await confirmTurn();
await page.waitForSelector('[data-testid=screen-result]');
const tlog = (await page.locator('[data-testid=result-log]').innerText()).split('\n').find((l) => l.includes('시간 종료 판정')) ?? '(판정 로그 없음 — 다른 사유로 종료)';
step(`E1' 20턴 판정 로그: ${tlog} → ${tlog.includes('브리치') ? 'OK' : '확인 필요'}`);

// ── v0.6: G2'·G3·C' 배지 + 게이트 슬롯 2 ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
for (const k of ['augerPierceStrongEnabled', 'gateSlotsReducedEnabled', 'suddenDeathEarlyEnabled']) await page.check(`[data-testid=opt-${k}]`);
await page.click('[data-testid=btn-vs-ai]');
await page.click('[data-testid=btn-start]');
step(`v0.6 G 배지: ${await page.locator('[data-testid=badge-gate]').innerText()} / 서든데스 배지: ${await page.locator('[data-testid=badge-sd]').innerText()}`);
for (let i = 0; i < 3; i++) await page.locator('[data-testid=tool-lantern]').dragTo(page.locator('[data-node=AG1]').first());
step(`G3 게이트1에 랜턴 3개 시도: 명령 ${(await ordersText()).split('\n').filter((l) => l.includes('랜턴')).length}개 / 안내 "${await page.locator('.hint').first().innerText()}"`);
step(`G3 게이트 HP: ${await page.evaluate(() => [...document.querySelectorAll('[data-node=AG1]')].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim())}`);
await openDebug();
step(`디버그 패널 옵션(v0.6): ${(await page.locator('[data-testid=dbg-options]').innerText()).replace(/\n/g, ' | ')}`);
await page.screenshot({ path: `${shots}/14-v06-options.png` });

// ── v0.7: V1·V2·C'' 배지 ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
for (const k of ['vaultDataReducedEnabled', 'siphonSlowEnabled', 'suddenDeathGentleEnabled']) await page.check(`[data-testid=opt-${k}]`);
await page.click('[data-testid=btn-vs-ai]');
await page.click('[data-testid=btn-start]');
step(`v0.7 배지: ${await page.locator('[data-testid=badge-vault]').innerText()} / ${await page.locator('[data-testid=badge-sd]').innerText()}`);
step(`V1 상대 금고 표시: ${await page.evaluate(() => [...document.querySelectorAll('[data-node=AV1]')].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim())}`);
await openDebug();
step(`디버그 패널 옵션(v0.7): ${(await page.locator('[data-testid=dbg-options]').innerText()).replace(/\n/g, ' | ')}`);

// ── v0.8: 하운드 비용 5 (K) ──
await page.goto('file://' + file);
await page.click('[data-testid=btn-preset-off]'); // 예전 기본 동작(모든 옵션 off)으로 고정한 회귀 검사
await page.check('[data-testid=opt-houndCostRaisedEnabled]');
await page.click('[data-testid=btn-vs-ai]');
const loadHound = (await page.locator('[data-testid=screen-loadout]').innerText()).split('\n').find((l) => l.includes('CYC') && l.includes('/ 2 BW') && l.includes('5 CYC')) ?? '(없음)';
step(`K 로드아웃 하운드 카드: ${loadHound}`);
await page.click('[data-testid=btn-start]');
step(`K 툴 카드: ${(await page.locator('[data-testid=tool-hound]').innerText()).replace(/\n/g, ' ')}`);
await page.locator('[data-testid=tool-hound]').dragTo(page.locator('[data-node=AG1]').first());
step(`K 명령: ${(await ordersText()).replace(/\n/g, ' | ')} / CYC 표시 ${await page.locator('[data-testid=cyc]').count() ? await page.locator('[data-testid=cyc]').innerText() : '-'}`);

// ── v0.3 확정 기본값 (플레이테스트 빌드): 프리셋 버튼 · 기본 배지 스크린샷 ──
await page.goto('file://' + file);
await page.waitForSelector('[data-testid=screen-title]');
const onKeys = await page.evaluate(() => [...document.querySelectorAll('[data-act=opt]')].filter((e) => e.checked).map((e) => e.dataset.key));
step(`기본값 체크된 토글(${onKeys.length}): ${onKeys.join(', ')} / 상태 "${await page.locator('[data-testid=preset-state]').innerText()}"`);
await page.screenshot({ path: `${shots}/16-defaults-title.png`, fullPage: true });
await page.click('[data-testid=btn-preset-off]');
step(`모든 옵션 끄기 → 체크 ${await page.locator('[data-act=opt]:checked').count()}개 / "${await page.locator('[data-testid=preset-state]').innerText()}"`);
await page.check('[data-testid=opt-gateHpReducedEnabled]');
step(`토글 개별 변경 → "${await page.locator('[data-testid=preset-state]').innerText()}"`);
await page.click('[data-testid=btn-preset-v03]');
const onKeys2 = await page.evaluate(() => [...document.querySelectorAll('[data-act=opt]')].filter((e) => e.checked).map((e) => e.dataset.key));
step(`v0.3 프리셋으로 되돌리기 → 체크 ${onKeys2.length}개 (${JSON.stringify(onKeys2) === JSON.stringify(onKeys) ? '기본값과 동일 OK' : '불일치'}) / "${await page.locator('[data-testid=preset-state]').innerText()}"`);
await page.click('[data-testid=btn-vs-ai]');
step(`기본값 로드아웃 보정안: ${await page.locator('[data-testid=screen-loadout]').innerText().then((t) => t.split('\n').find((l) => l.startsWith('보정안')) ?? '-')}`);
await page.click('[data-testid=btn-start]');
await page.click('[data-testid=vpick-V1]'); await page.click('[data-testid=vpick-R3]');
const badges = async () => (await page.locator('[data-testid^=badge-]').allInnerTexts()).join(' / ');
step(`기본값 구축 단계 배지: ${await badges()}`);
await page.screenshot({ path: `${shots}/17-defaults-setup.png` });
await confirmTurn();
step(`기본값 T1: ${await turnText()} / 배지: ${await badges()}`);
await page.screenshot({ path: `${shots}/18-defaults-match.png` });
await dbg('[data-dbg=skipToSuddenDeath]');
step(`디버그 서든데스로 이동 → ${await turnText()} / 서든데스 배지: ${await page.locator('[data-testid=badge-sd]').innerText()}`);
await confirmTurn();
step(`T13 해결 후: ${await turnText()} / 서든데스 배지: ${await page.locator('[data-testid=badge-sd]').innerText()} / 적 소켓: ${await page.evaluate(() => ['BV1', 'BR1', 'BV2', 'BR3'].map((id) => [...document.querySelectorAll(`[data-node=${id}]`)].map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim()).join(' / '))}`);
step(`T13 로그: ${(await page.locator('[data-testid=log]').innerText()).split('\n').filter((l) => l.includes('서든데스')).slice(0, 2).join(' / ')}`);
await page.screenshot({ path: `${shots}/19-defaults-sudden-death.png` });
// v0.3 기본값 경기를 코어 브리치로 끝내고 결과 화면 기록 블록 확인 + 스크린샷
for (let i = 0; i < 12 && (await page.locator('[data-testid=screen-result]').count()) === 0; i++) await dbg('[data-dbg=hitEnemyCore]');
await page.waitForSelector('[data-testid=screen-result]', { timeout: 3000 });
await checkRecord('v0.3 기본값 · 코어 브리치', { winner: 'A', winType: '코어 브리치', turns: '14', suddenDeath: '예 (T13 개시)', minCoreHp: /^\d+(\.\d)?\/0$/ });
await page.locator('[data-testid=record-block]').screenshot({ path: `${shots}/20-result-record.png` });
await page.screenshot({ path: `${shots}/21-result-record-full.png`, fullPage: true });
// QA: 디버그 '20턴으로' 점프가 서든데스 개시 턴(T13)을 건너뛰면 기록은 설정 개시 턴 + '(디버그 점프)' 표시
await page.goto('file://' + file);
await page.waitForSelector('[data-testid=screen-title]');
await page.click('[data-testid=btn-vs-ai]');
await page.click('[data-testid=btn-start]');
await page.click('[data-testid=vpick-V1]'); await page.click('[data-testid=vpick-R3]');
await confirmTurn();
await dbg('[data-dbg=skipToLastTurn]');
await confirmTurn();
await page.waitForSelector('[data-testid=screen-result]', { timeout: 5000 });
{
  const sdRow = (await page.locator('[data-testid=record-row-suddenDeath] td').allInnerTexts()).join('/');
  const turns = (await page.locator('[data-testid=record-row-turns] td').allInnerTexts()).join('/');
  step(`디버그 20턴 점프 기록: 경기 길이 ${turns} / 서든데스 도달 "${sdRow}" → ${sdRow === '예 (T13 개시) (디버그 점프)' ? 'OK' : '(실패)'}`);
}

// ── QA: 핫시트 + 숨은 금고 — 구축 시간 만료 자동 채움, 로그는 그 플레이어에게만 ──
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  await ctx.clock.install();
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await p2.goto('file://' + file);
  await p2.click('[data-testid=btn-preset-off]');
  await p2.check('[data-testid=opt-hiddenVaultsEnabled]');
  await p2.check('[data-act=timer]');
  await p2.click('[data-testid=btn-hotseat]');
  await p2.click('[data-testid=btn-start]');
  await p2.click('[data-testid=btn-handover]');
  await p2.click('[data-testid=vpick-R1]');            // A: 소켓2만 고름 (1곳)
  await p2.clock.runFor(61_000);                         // 구축 60초 만료 → 자동 확정
  await p2.waitForSelector('[data-testid=handover]');
  const ho = await p2.locator('[data-testid=handover]').innerText();
  step(`핫시트 A 구축 시간 만료 → 가림 "${ho.split('\n')[0]}" / 가림 화면에 소켓 정보 ${/소켓|자동/.test(ho) ? '노출(실패)' : '없음(OK)'}`);
  await p2.click('[data-testid=btn-handover]');
  const bView = [await p2.locator('[data-testid=log]').innerText(), await p2.locator('[data-testid=orders]').innerText(), await p2.locator('[data-testid=vault-pick]').innerText()].join(' ');
  step(`B 화면(구축): A 자동 채움·A 소켓 노출 ${/자동 지정|A 소켓/.test(bView) ? '있음(실패)' : '없음(OK)'}`);
  await p2.click('[data-testid=vpick-V1]'); await p2.click('[data-testid=vpick-V2]');
  await p2.clock.runFor(500);
  await p2.click('[data-testid=btn-confirm]');           // B: 2곳 골라 수동 확정
  await p2.waitForSelector('[data-testid=handover]');
  await p2.click('[data-testid=btn-handover]');
  const aLog = await p2.locator('[data-testid=log]').innerText();
  const autoLine = aLog.split('\n').find((l) => l.includes('자동 지정')) ?? '(없음)';
  step(`A 화면 로그: ${autoLine} → ${autoLine.includes('A 소켓1') && autoLine.includes('A 소켓2 유지') ? 'OK (1곳 유지 + 1곳 기본값)' : '확인 필요'}`);
  await p2.clock.runFor(500);
  await p2.click('[data-testid=btn-confirm]');           // A: T1 확정 → B 차례
  await p2.waitForSelector('[data-testid=handover]');
  await p2.click('[data-testid=btn-handover]');
  const bLog = await p2.locator('[data-testid=log]').innerText();
  step(`B 화면 로그(T1): A 자동 채움 ${bLog.includes('자동 지정') ? '노출(실패)' : '없음(OK)'} / A 소켓 이름 ${/A 소켓|\[A\] 저장 소켓/.test(bLog) ? '노출(실패)' : '없음(OK)'} / B 자기 지정 로그 ${bLog.includes('[B] 저장 소켓 금고 지정') ? '보임' : '없음'}`);
  await p2.screenshot({ path: `${shots}/15-hotseat-vault-autofill-B.png` });
  await ctx.close();
}

console.log('\n콘솔 에러/경고:', errors.length ? errors : '없음');
await browser.close();
process.exit(errors.length ? 1 : 0);
