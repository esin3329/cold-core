import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { Player, Program } from '../src/sim/types';
import { viewFor } from '../src/sim/view';
import { fmtClock } from '../src/ui/clock';
import { renderMap } from '../src/ui/mapView';

describe('QA 버그 6: 타이머 표시', () => {
  it('60초는 01:00, 이후 mm:ss', () => {
    expect(fmtClock(60)).toBe('01:00');
    expect(fmtClock(59)).toBe('00:59');
    expect(fmtClock(20)).toBe('00:20');
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(-3)).toBe('00:00');
  });
});

describe('QA 버그 4: 프로그램 마커 상한', () => {
  const withProgs = (k: number) => {
    const s = resolveTurn(createMatch(), [], []);
    for (let i = 0; i < k; i++) {
      const id = s.nextId++;
      s.programs.push({ id, kind: 'auger', owner: 'A' as Player, node: 'N2', target: 'N2', hp: 120, stunned: 0, detected: false, revealed: false, seq: id } as Program);
    }
    return renderMap(s, viewFor(s, 'A'), { selected: null, pending: [], me: 'A' });
  };
  const markers = (svg: string) => (svg.match(/<polygon points="0,-7 7,6 -7,6"/g) ?? []).length;
  it('4개까지는 그대로 4개 표시', () => {
    const svg = withProgs(4);
    expect(markers(svg)).toBe(4);
    expect(svg).not.toContain('prog-overflow');
  });
  it('6개면 3개 + "+3" 칩 (한 줄, 4칸 이내)', () => {
    const svg = withProgs(6);
    expect(markers(svg)).toBe(3);
    expect((svg.match(/data-testid="prog-overflow"/g) ?? []).length).toBe(1);
    expect(svg).toContain('>+3<');
  });
});
