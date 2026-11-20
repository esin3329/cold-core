/** MVP 대칭 맵 '해령 7구역' (기획 §5.4) */
import type { NodeKind, Player } from './types';

export interface MapNode { id: string; kind: NodeKind; owner: Player | null; label: string; x: number; y: number }
export interface MapLink { a: string; b: string; fast: boolean }

const half: { id: string; kind: NodeKind; label: string; x: number; y: number }[] = [
  { id: 'C', kind: 'core', label: '코어', x: 60, y: 250 },
  { id: 'G1', kind: 'gate', label: '게이트1', x: 165, y: 150 },
  { id: 'G2', kind: 'gate', label: '게이트2', x: 165, y: 350 },
  { id: 'V1', kind: 'vault', label: '금고1', x: 275, y: 60 },
  { id: 'P1', kind: 'processor', label: '프로세서1', x: 275, y: 195 },
  { id: 'P2', kind: 'processor', label: '프로세서2', x: 275, y: 305 },
  { id: 'V2', kind: 'vault', label: '금고2', x: 275, y: 440 },
  { id: 'R1', kind: 'relay', label: '릴레이1', x: 390, y: 60 },
  { id: 'R2', kind: 'relay', label: '릴레이2', x: 390, y: 250 },
  { id: 'R3', kind: 'relay', label: '릴레이3', x: 390, y: 440 },
];
const halfLinks: [string, string][] = [
  ['C', 'G1'], ['C', 'G2'], ['G1', 'V1'], ['G1', 'P1'], ['G2', 'V2'], ['G2', 'P2'],
  ['V1', 'R1'], ['P1', 'R2'], ['P2', 'R2'], ['V2', 'R3'],
];
export const MAP_W = 1040;
export const MAP_H = 500;

export const NODES: MapNode[] = [
  ...half.map((n) => ({ ...n, id: 'A' + n.id, owner: 'A' as Player, label: 'A ' + n.label })),
  { id: 'N1', kind: 'neutral', owner: null, label: '중립 북', x: 520, y: 60 },
  { id: 'N2', kind: 'neutral', owner: null, label: '중립 중앙', x: 520, y: 250 },
  { id: 'N3', kind: 'neutral', owner: null, label: '중립 남', x: 520, y: 440 },
  ...half.map((n) => ({ ...n, id: 'B' + n.id, owner: 'B' as Player, label: 'B ' + n.label, x: MAP_W - n.x })),
];

export const LINKS: MapLink[] = [
  ...halfLinks.map(([a, b]) => ({ a: 'A' + a, b: 'A' + b, fast: false })),
  ...halfLinks.map(([a, b]) => ({ a: 'B' + a, b: 'B' + b, fast: false })),
  { a: 'N1', b: 'N2', fast: true },
  { a: 'N2', b: 'N3', fast: true },
  { a: 'AR1', b: 'N1', fast: false }, { a: 'AR2', b: 'N2', fast: false }, { a: 'AR3', b: 'N3', fast: false },
  { a: 'BR1', b: 'N1', fast: false }, { a: 'BR2', b: 'N2', fast: false }, { a: 'BR3', b: 'N3', fast: false },
];

export const NODE_BY_ID: Record<string, MapNode> = Object.fromEntries(NODES.map((n) => [n.id, n]));

/** 정렬된 인접 리스트 (결정론적 순회용) */
export const ADJ: Record<string, { to: string; fast: boolean }[]> = (() => {
  const adj: Record<string, { to: string; fast: boolean }[]> = {};
  for (const n of NODES) adj[n.id] = [];
  for (const l of LINKS) {
    adj[l.a].push({ to: l.b, fast: l.fast });
    adj[l.b].push({ to: l.a, fast: l.fast });
  }
  for (const k of Object.keys(adj)) adj[k].sort((x, y) => (x.to < y.to ? -1 : 1));
  return adj;
})();

/** 링크 수 기준 거리 (고속 링크 포함 모든 링크 1칸) */
export function hopDistances(from: string): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 };
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const { to } of ADJ[cur]) if (dist[to] === undefined) { dist[to] = dist[cur] + 1; q.push(to); }
  }
  return dist;
}
export const HOPS: Record<string, Record<string, number>> = Object.fromEntries(NODES.map((n) => [n.id, hopDistances(n.id)]));
