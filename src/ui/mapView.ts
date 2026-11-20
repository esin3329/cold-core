/** 네트워크 맵 SVG 렌더러 (도형 + 텍스트 플레이스홀더). 시뮬레이션 상태는 읽기만 한다. */
import { ICE_SPECS, PROG_SPECS } from '../sim/config';
import { pickSpawn } from '../sim/engine';
import { LINKS, MAP_H, MAP_W } from '../sim/map';
import type { MatchState, NodeKind, Order, Player } from '../sim/types';
import type { MatchView, NodeView } from '../sim/view';

const FILL: Record<NodeKind, string> = { core: '#ff3b6b', gate: '#ffb020', vault: '#7c4dff', processor: '#00bcd4', relay: '#2e7d32', neutral: '#455a64' };
const KIND_KO: Record<NodeKind, string> = { core: '코어', gate: '게이트', vault: '금고', processor: '프로세서', relay: '릴레이', neutral: '중립' };
export const kindKo = (k: NodeKind) => KIND_KO[k];
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function shape(kind: NodeKind, r: number, fill: string, stroke: string, dash: string, op: number) {
  const st = `fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} class="shape"`;
  switch (kind) {
    case 'core': return `<circle r="${r + 6}" ${st}/>`;
    case 'gate': return `<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" ${st}/>`;
    case 'vault': return `<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => `${Math.cos((Math.PI / 3) * i) * r},${Math.sin((Math.PI / 3) * i) * r}`).join(' ')}" ${st}/>`;
    case 'processor': return `<rect x="${-r}" y="${-r * 0.75}" width="${2 * r}" height="${1.5 * r}" rx="4" ${st}/>`;
    case 'relay': return `<polygon points="${-r},${-r} ${r},0 ${-r},${r}" ${st}/>`;
    case 'neutral': return `<polygon points="0,${-r} ${r},0 0,${r} ${-r},0" ${st}/>`;
  }
}

/** 맵 상단 여백 (구역 제목이 노드와 겹치지 않도록). 시뮬레이션 좌표는 그대로 두고 렌더링에서만 이동한다. */
const OY = 34;
const BOTTOM_PAD = 70;

export function renderMap(s: MatchState, v: MatchView, opts: { selected: string | null; pending: Order[]; me: Player }): string {
  const flip = v.viewer === 'B';
  const X = (x: number) => (flip ? MAP_W - x : x);
  const Y = (y: number) => y + OY;
  const N = v.nodes;
  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${MAP_W} ${MAP_H + OY + BOTTOM_PAD}" xmlns="http://www.w3.org/2000/svg" data-testid="map">`);
  // 구역 제목은 맵 맨 위 여백에 (노드 라벨과 겹치지 않음)
  parts.push(`<text class="zone" x="${X(flip ? 820 : 220)}" y="18" text-anchor="middle">내 성채 (전체 공개)</text>`);
  parts.push(`<text class="zone" x="520" y="18" text-anchor="middle">심해망 중립 구역</text>`);
  parts.push(`<text class="zone" x="${X(flip ? 220 : 820)}" y="18" text-anchor="middle">상대 성채 (안개)</text>`);
  for (const l of LINKS) {
    const a = N[l.a], b = N[l.b];
    const dead = a.destroyed || b.destroyed;
    const stroke = l.fast ? '#8fa3c7' : dead ? '#2a3550' : '#2f4a78';
    parts.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="${stroke}" stroke-width="${l.fast ? 5 : 2}" ${l.fast ? 'stroke-dasharray="10 4"' : ''}/>`);
  }
  // 계획된 발사 경로 (점선)
  for (const o of opts.pending) {
    if (o.type === 'launch') {
      const from = o.prog === 'ping' ? null : pickSpawn(s, opts.me, o.target);
      const t = N[o.target];
      if (from) parts.push(`<line x1="${X(N[from].x)}" y1="${Y(N[from].y)}" x2="${X(t.x)}" y2="${Y(t.y)}" stroke="#ff3bd4" stroke-width="1.5" stroke-dasharray="4 4" opacity=".8"/>`);
      parts.push(`<circle cx="${X(t.x)}" cy="${Y(t.y)}" r="34" fill="none" stroke="${o.prog === 'ping' ? '#39ff88' : '#ff3bd4'}" stroke-dasharray="3 3"/>`);
    }
  }
  // 레이어 분리: 모든 노드 도형을 먼저 그리고, 라벨·아이콘·마커는 맨 위 레이어에 그린다 (링크·이웃 노드에 가려지지 않음)
  const nodes = Object.values(N);
  for (const n of nodes) parts.push(renderNodeBase(n, v, X, Y, opts));
  for (const n of nodes) parts.push(renderNodeOverlay(n, v, X, Y, opts));
  parts.push('</svg>');
  return parts.join('');
}

/** 도형의 시각적 반지름 (코어 원은 r+6) */
const radius = (n: NodeView) => (n.kind === 'core' ? 30 : 20);
const baseR = (n: NodeView) => (n.kind === 'core' ? 24 : 20);
/** 대략적인 글자 폭 (한글 ≈ 글꼴 크기, 영문/숫자 ≈ 0.62배) */
function textW(t: string, size: number) {
  let w = 0;
  for (const ch of t) w += /[\u3131-\uD79D]/.test(ch) ? size : size * 0.62;
  return w;
}

function renderNodeBase(n: NodeView, v: MatchView, X: (x: number) => number, Y: (y: number) => number, opts: { selected: string | null }) {
  const r = baseR(n);
  const R = radius(n);
  const ownerStroke = n.mine ? '#00e5ff' : n.enemy ? '#ff3b6b' : n.owner === v.viewer ? '#00e5ff' : n.owner ? '#ff3b6b' : '#7d8ba3';
  const fill = n.destroyed ? '#222a38' : FILL[n.enemy ? n.shownKind : n.kind];
  const fog = n.enemy && n.ices === null;
  const o: string[] = [];
  o.push(`<g class="node" data-node="${n.id}" transform="translate(${X(n.x)},${Y(n.y)})">`);
  o.push(`<circle r="${R + 14}" fill="transparent"/>`);
  if (opts.selected === n.id) o.push(`<circle r="${R + 5}" fill="none" stroke="#ffb020" stroke-width="2.5"/>`);
  o.push(shape(n.enemy ? n.shownKind : n.kind, r, fill, ownerStroke, fog ? '5 3' : '', n.destroyed ? 0.5 : fog ? 0.35 : 0.85));
  if (n.destroyed) o.push(`<text y="7" text-anchor="middle" font-size="22" fill="#ff3b6b">✕</text>`);
  o.push('</g>');
  return o.join('');
}

function renderNodeOverlay(n: NodeView, v: MatchView, X: (x: number) => number, Y: (y: number) => number, opts: { pending: Order[] }) {
  const R = radius(n);
  const o: string[] = [];
  o.push(`<g class="node" data-node="${n.id}" transform="translate(${X(n.x)},${Y(n.y)})">`);
  // ── 아래쪽 라벨 블록: 이름 + (HP · 데이터) — 어두운 배경판 위에 그려 링크와 겹쳐도 읽힘
  const name = n.label.replace(/^[AB] /, '');
  const hpTxt = n.kind === 'neutral' ? (n.owner ? (n.owner === v.viewer ? '내 점령' : '상대 점령') : '미점령') : n.destroyed ? (n.offline ? `오프라인 ${n.offline}` : '파괴') : n.hpHidden ? 'HP ?' : `HP ${Math.ceil(n.hp / 10)}/${n.maxHp / 10}`;
  const dataTxt = n.data !== null && !n.destroyed ? ` ◆${n.data}` : '';
  const w = Math.max(textW(name, 12), textW(hpTxt + dataTxt, 11)) + 10;
  const y0 = R + 4;
  o.push(`<rect class="lblbg" x="${-w / 2}" y="${y0}" width="${w}" height="29" rx="3"/>`);
  o.push(`<text class="lbl" y="${y0 + 12}" text-anchor="middle" font-size="12" fill="#e2ebfb">${esc(name)}</text>`);
  const hpColor = n.kind !== 'neutral' && n.hp < n.maxHp ? '#ffb020' : n.kind === 'neutral' && n.owner ? (n.owner === v.viewer ? '#00e5ff' : '#ff6b8b') : '#8fa3c7';
  o.push(`<text class="lbl" y="${y0 + 25}" text-anchor="middle" font-size="11"><tspan fill="${hpColor}">${esc(hpTxt)}</tspan>${dataTxt ? `<tspan fill="#c3b0ff">${dataTxt}</tspan>` : ''}</text>`);
  // ── 위쪽 ICE 줄: 설치된 ICE + 계획된 ICE(+), 안개면 'ICE ?' 배지
  const iy = -R - 19;
  const q = opts.pending.filter((p): p is Extract<Order, { type: 'compile' }> => p.type === 'compile' && p.node === n.id);
  if (n.ices === null) {
    o.push(`<rect class="lblbg" x="-22" y="${iy - 1}" width="44" height="15" rx="3"/><text class="lbl" y="${iy + 11}" text-anchor="middle" font-size="11" fill="#ff6b8b">ICE ?</text>`);
  } else {
    const items = [...n.ices.map((ice) => ({ k: ice.kind, compiling: ice.compiling, planned: false })), ...q.map((p) => ({ k: p.ice, compiling: true, planned: true }))];
    const stale = n.enemy && n.scoutedTurn !== null && v.turn - n.scoutedTurn > 1; // 오래된 정찰 정보는 흐리게
    const sig = n.vaultSignal ? 52 : 0; // 핑으로 잡힌 '금고 신호' 칩 (허니팟 위장)
    const total = Math.max(0, items.length * 15 - 2) + (sig && items.length ? 4 : 0) + sig;
    if (total > 0) o.push(`<rect class="lblbg" x="${-total / 2 - 3}" y="${iy - 2}" width="${total + 6}" height="17" rx="3"/>`);
    items.forEach((it, i) => {
      const c = it.planned ? '#39ff88' : n.mine ? '#00e5ff' : '#ff6b8b';
      const x = -total / 2 + i * 15;
      o.push(`<g opacity="${stale ? 0.45 : 1}" transform="translate(${x},${iy})"><rect width="13" height="13" fill="${it.compiling ? 'none' : c}" fill-opacity=".85" stroke="${c}" ${it.compiling ? 'stroke-dasharray="2 2"' : ''}/><text x="6.5" y="10.5" font-size="9" text-anchor="middle" fill="${it.compiling ? c : '#000'}">${it.planned ? '+' : ICE_SPECS[it.k].name[0]}</text></g>`);
    });
    if (sig) o.push(`<text class="lbl" data-testid="vault-signal" x="${total / 2 - sig / 2}" y="${iy + 11}" text-anchor="middle" font-size="10" fill="#c3b0ff">금고 신호</text>`);
  }
  // ── 프로그램 마커: 라벨 블록 아래 한 줄만 사용 (아래 노드와 겹치지 않도록 최대 4칸, 넘치면 3개 + '+N')
  const progs = v.programs.filter((p) => p.node === n.id);
  const MAXM = 4;
  const shown = progs.length > MAXM ? progs.slice(0, MAXM - 1) : progs;
  const slots = shown.length + (progs.length > MAXM ? 1 : 0);
  const py = y0 + 29 + 8;
  shown.forEach((p, i) => {
    const c = p.mine ? '#ff3bd4' : '#ff9a3b';
    const px = -((slots - 1) * 15) / 2 + i * 15;
    o.push(`<g transform="translate(${px},${py})" opacity="${p.stealth && p.mine ? 0.55 : 1}"><polygon points="0,-7 7,6 -7,6" fill="${c}" stroke="#05070d" stroke-width="1"/><text y="5" font-size="8" text-anchor="middle" fill="#000">${PROG_SPECS[p.kind].name[0]}</text></g>`);
  });
  if (progs.length > MAXM) {
    const px = -((slots - 1) * 15) / 2 + (slots - 1) * 15;
    o.push(`<g transform="translate(${px},${py})" data-testid="prog-overflow"><rect x="-9" y="-7" width="18" height="13" rx="3" fill="#05070d" stroke="#ff3bd4"/><text y="3.5" font-size="9" text-anchor="middle" fill="#ff8fe8">+${progs.length - shown.length}</text></g>`);
  }
  o.push('</g>');
  return o.join('');
}
