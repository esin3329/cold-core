import { describe, expect, it } from 'vitest';
import { PROG_SPECS } from '../src/sim/config';
import { debugApply, resolveTurn } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { IceKind, MatchState, Player, Program } from '../src/sim/types';
import { viewFor } from '../src/sim/view';

function addIce(s: MatchState, owner: Player, node: string, kind: IceKind, compiling = false) {
  const id = s.nextId++;
  const hp = { bulwark: 200, hound: 100, lantern: 60, honeypot: 40 }[kind];
  s.ices.push({ id, kind, owner, node, hp, compiling, free: false, seq: id });
  return id;
}
function addProg(s: MatchState, owner: Player, node: string, kind: Program['kind'], target = node) {
  const id = s.nextId++;
  s.programs.push({ id, kind, owner, node, target, hp: { auger: 120, shade: 60, siphon: 80 }[kind], stunned: 0, detected: false, revealed: false, seq: id });
  return id;
}
const playing = (opts = {}) => resolveTurn(createMatch(opts), [], []);

describe('QA 버그 2: 허니팟 위치 누설 금지', () => {
  it('정찰 전 허니팟 노드는 본래 종류(중계)로 보이고, 금고 신호·데이터 값이 없다 — 다른 안개 노드와 동일', () => {
    const s = playing();
    s.ices = [];
    addIce(s, 'B', 'BR3', 'honeypot');
    const v = viewFor(s, 'A');
    const hp = v.nodes.BR3, plain = v.nodes.BR1;
    expect(hp.shownKind).toBe('relay');
    expect(hp.vaultSignal).toBe(false);
    expect(hp.data).toBeNull();
    // 허니팟 없는 안개 중계 노드와 표시 필드가 완전히 같아야 한다
    const strip = (n: typeof hp) => ({ shownKind: n.shownKind, data: n.data, ices: n.ices, vaultSignal: n.vaultSignal, scoutedTurn: n.scoutedTurn, hp: n.hp, maxHp: n.maxHp });
    expect(strip(hp)).toEqual(strip(plain));
  });
  it('기획 정정: 핑한 진짜 금고와 허니팟은 똑같은 "금고 신호"를 받는다 (칩으로 허니팟 구별 불가), 로그도 둘 다 (금고 신호)', () => {
    let s = playing();
    s.ices = [];
    addIce(s, 'B', 'BR3', 'honeypot');
    s = resolveTurn(s, [{ type: 'launch', prog: 'ping', target: 'BR3' }], []); // BR3 + 인접 BV2(진짜 금고) 정찰
    const v = viewFor(s, 'A');
    expect(v.nodes.BV2.vaultSignal).toBe(true);
    expect(v.nodes.BR3.vaultSignal).toBe(true);
    expect(v.nodes.BV2.vaultSignal).toBe(v.nodes.BR3.vaultSignal);
    expect(v.nodes.BR3.ices).toEqual(v.nodes.BV2.ices); // 둘 다 보이는 ICE 없음
    const ping = s.log.find((l) => l.step === 2 && l.text.includes('핑'))!.text;
    expect(ping).toMatch(/B 릴레이3: ICE 없음 \(금고 신호\)/);
    expect(ping).toMatch(/B 금고2: ICE 없음 \(금고 신호\)/);
    // 핑하지 않은 금고에는 신호 없음
    expect(v.nodes.BV1.vaultSignal).toBe(false);
  });
  it('핑으로 정찰한 뒤에는 "금고 신호"만 표시 (가짜 금고 종류·HP·데이터 위장 없음)', () => {
    let s = playing();
    s.ices = [];
    addIce(s, 'B', 'BR3', 'honeypot');
    s = resolveTurn(s, [{ type: 'launch', prog: 'ping', target: 'BR3' }], []);
    const n = viewFor(s, 'A').nodes.BR3;
    expect(n.vaultSignal).toBe(true);
    expect(n.shownKind).toBe('relay');
    expect(n.data).toBeNull();
    expect(n.ices).toEqual([]); // 허니팟 자체는 ICE 목록에 나오지 않음
    // 소유자 B 시점에서는 신호 표시 없음
    expect(viewFor(s, 'B').nodes.BR3.vaultSignal).toBe(false);
  });
});

describe('QA 버그 3: 컴파일 중인 ICE는 같은 턴 표적이 아님', () => {
  it('하운드가 컴파일 중인 코어에 도착한 오거는 코어 본체를 치고 하운드는 피해 없음', () => {
    let s = playing();
    s.ices = [];
    const ag = addProg(s, 'A', 'BC', 'auger', 'BC');
    const coreHp = s.nodes.BC.hp;
    s = resolveTurn(s, [], [{ type: 'compile', ice: 'hound', node: 'BC' }]);
    const hound = s.ices.find((i) => i.kind === 'hound')!;
    expect(hound.hp).toBe(100);
    expect(s.nodes.BC.hp).toBeLessThan(coreHp);
    expect(s.programs.find((p) => p.id === ag)).toBeDefined();
  });
});

describe('QA 버그 5: 디버그 코어 -40은 0까지 내려가 승리 처리', () => {
  it('HP가 0이 되면 코어 파괴 + A 코어 브리치 승리', () => {
    let s = playing();
    for (let i = 0; i < 10 && !s.winner; i++) s = debugApply(s, 'A', 'hitEnemyCore');
    expect(s.nodes.BC.hp).toBe(0);
    expect(s.nodes.BC.destroyed).toBe(true);
    expect(s.winner).toBe('A');
    expect(s.winReason).toBe('core');
  });
});

describe('링크 교전 (§6.4 "같은 링크에서 마주치면 교전")', () => {
  it('반대 방향으로 같은 링크를 건너는 적 프로그램은 둘 다 멈추고 ④에서 서로 공격력만큼 피해', () => {
    let s = playing();
    s.ices = [];
    const a = addProg(s, 'A', 'N2', 'auger', 'BR2');
    const b = addProg(s, 'B', 'BR2', 'auger', 'N2');
    s = resolveTurn(s, [], []);
    const pa = s.programs.find((p) => p.id === a)!, pb = s.programs.find((p) => p.id === b)!;
    expect(pa.node).toBe('N2');
    expect(pb.node).toBe('BR2');
    const d = PROG_SPECS.auger.atk * 10;
    expect(pa.hp).toBe(120 - d);
    expect(pb.hp).toBe(120 - d);
    expect(s.log.some((l) => l.step === 3 && l.text.startsWith('링크 교전!'))).toBe(true);
    expect(s.log.filter((l) => l.step === 4 && l.text.startsWith('링크 교전:')).length).toBe(2);
  });
  it('링크 교전 처치는 동시 적용, 처치 보상 없음', () => {
    let s = playing();
    s.ices = [];
    const a = addProg(s, 'A', 'N2', 'auger', 'BR2');
    const b = addProg(s, 'B', 'BR2', 'siphon', 'N2');
    s.programs.find((p) => p.id === b)!.hp = 10;
    s.programs.find((p) => p.id === a)!.hp = 10;
    const cycA = s.players.A.cyc, cycB = s.players.B.cyc;
    const after = resolveTurn(s, [], []);
    expect(after.programs.find((p) => p.id === a)).toBeUndefined();
    expect(after.programs.find((p) => p.id === b)).toBeUndefined();
    expect(after.log.some((l) => l.text.includes('링크 교전에서 삭제됨'))).toBe(true);
    // 수입만 반영, 역컴파일 보상 없음
    const plain = resolveTurn((() => { const t = structuredClone(s); t.programs = []; return t; })(), [], []);
    expect(after.players.A.cyc - cycA).toBe(plain.players.A.cyc - cycA);
    expect(after.players.B.cyc - cycB).toBe(plain.players.B.cyc - cycB);
  });
  it('탐지되지 않은 셰이드는 마주쳐도 교전 없이 지나간다 [추정]', () => {
    let s = playing();
    s.ices = [];
    const a = addProg(s, 'A', 'N2', 'shade', 'BR2');
    const b = addProg(s, 'B', 'BR2', 'auger', 'N2');
    s = resolveTurn(s, [], []);
    expect(s.log.some((l) => l.text.includes('링크 교전'))).toBe(false);
    expect(s.programs.find((p) => p.id === a)!.node).toBe('BR2');
    expect(s.programs.find((p) => p.id === b)!.node).toBe('N2');
  });
  it('같은 편끼리, 같은 방향 이동은 교전하지 않는다', () => {
    let s = playing();
    s.ices = [];
    addProg(s, 'A', 'N2', 'auger', 'AR2');
    addProg(s, 'A', 'AR2', 'auger', 'N2');
    addProg(s, 'B', 'N1', 'auger', 'N2');
    s = resolveTurn(s, [], []);
    expect(s.log.some((l) => l.text.includes('링크 교전'))).toBe(false);
  });
  it('결정론: 같은 입력이면 같은 링크 교전 결과', () => {
    const mk = () => {
      let s = playing();
      s.ices = [];
      addProg(s, 'A', 'N2', 'auger', 'BR2');
      addProg(s, 'A', 'N2', 'siphon', 'BR2');
      addProg(s, 'B', 'BR2', 'auger', 'N2');
      return resolveTurn(s, [], []);
    };
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
