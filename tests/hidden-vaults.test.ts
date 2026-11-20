import { describe, expect, it } from 'vitest';
import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { describeOrder, planBudget, resolveTurn, socketsOf } from '../src/sim/engine';
import { createMatch } from './helpers'; // 전체 off 위에 옵션을 명시 (기본값 v0.3 조합과 무관)
import type { Order } from '../src/sim/types';
import { viewFor } from '../src/sim/view';

const H = { hiddenVaultsEnabled: true };
const setVaults = (nodes: string[]): Order => ({ type: 'setVaults', nodes });

describe('(H) 숨은 금고', () => {
  it('기본 off: setVaults 명령은 무효, 기존 금고 V1·V2', () => {
    const s = createMatch();
    expect(planBudget(s, 'A', [setVaults(['AV1', 'AR1'])]).errors[0]).toContain('꺼져');
    expect(viewFor(s, 'B').nodes.AV1.shownKind).toBe('vault');
  });
  it('구축 단계에서 소켓 2곳을 금고로 지정 → 종류·HP·데이터 변환, 나머지 소켓은 중계', () => {
    const s = resolveTurn(createMatch(H), [setVaults(['AR1', 'AV2'])], []);
    expect(['AV1', 'AR1', 'AV2', 'AR3'].map((id) => s.nodes[id].kind)).toEqual(['relay', 'vault', 'vault', 'relay']);
    expect([s.nodes.AR1.maxHp, s.nodes.AR1.data, s.nodes.AV1.maxHp, s.nodes.AV1.data]).toEqual([200, 8, 150, 0]);
    // B는 선택 안 함 → 기본 V1·V2
    expect(['BV1', 'BV2'].every((id) => s.nodes[id].kind === 'vault')).toBe(true);
    expect(s.log.some((l) => l.text.includes('저장 소켓 금고 지정: A 소켓2, A 소켓3'))).toBe(true);
  });
  it('검증: 서로 다른 내 소켓 2곳만, 구축 단계에서만, 1회만', () => {
    const s = createMatch(H);
    expect(planBudget(s, 'A', [setVaults(['AV1'])]).errors[0]).not.toBeNull();
    expect(planBudget(s, 'A', [setVaults(['AV1', 'AV1'])]).errors[0]).not.toBeNull();
    expect(planBudget(s, 'A', [setVaults(['AV1', 'AG1'])]).errors[0]).not.toBeNull();
    expect(planBudget(s, 'A', [setVaults(['BV1', 'BV2'])]).errors[0]).not.toBeNull();
    expect(planBudget(s, 'A', [setVaults(['AV1', 'AR1']), setVaults(['AV2', 'AR3'])]).errors).toEqual([null, '금고 지정은 한 번만']);
    const t1 = resolveTurn(s, [], []);
    expect(planBudget(t1, 'A', [setVaults(['AV1', 'AR1'])]).errors[0]).toContain('구축 단계');
  });
  it('허니팟은 금고가 아닌 소켓에만 (같은 명령 목록의 지정 반영)', () => {
    const s = createMatch(H);
    const hp = (node: string): Order => ({ type: 'compile', ice: 'honeypot', node });
    expect(planBudget(s, 'A', [setVaults(['AR1', 'AV2']), hp('AV1')]).errors[1]).toBeNull();
    expect(planBudget(s, 'A', [setVaults(['AR1', 'AV2']), hp('AR1')]).errors[1]).toContain('허니팟');
    expect(planBudget(s, 'A', [hp('AP1')]).errors[0]).toContain('허니팟'); // 소켓 아닌 노드 불가
    expect(planBudget(s, 'A', [hp('AV1')]).errors[0]).toContain('허니팟'); // 지정 없으면 V1·V2가 금고
    expect(planBudget(createMatch(), 'A', [hp('AP1')]).errors[0]).toBeNull(); // off면 기존대로 어디든
  });
  it('정찰 전: 적 소켓 4곳 모두 중계로 보이고 HP·데이터 비공개, 이름은 소켓n (로그에도 금고 이름 없음)', () => {
    let s = resolveTurn(createMatch(H), [], [setVaults(['BR1', 'BR3']), { type: 'compile', ice: 'honeypot', node: 'BV1' }]);
    const v = viewFor(s, 'A');
    const ids = socketsOf('B');
    expect(ids.map((id) => v.nodes[id].shownKind)).toEqual(['relay', 'relay', 'relay', 'relay']);
    expect(ids.map((id) => v.nodes[id].kind)).toEqual(['relay', 'relay', 'relay', 'relay']);
    expect(ids.every((id) => v.nodes[id].hpHidden && v.nodes[id].hp === 0 && v.nodes[id].data === null && !v.nodes[id].vaultSignal)).toBe(true);
    expect(ids.map((id) => v.nodes[id].label)).toEqual(['B 소켓1', 'B 소켓2', 'B 소켓3', 'B 소켓4']);
    // 내 시점에서는 내 금고가 보임
    expect(viewFor(s, 'B').nodes.BR1.kind).toBe('vault');
    expect(s.turnLogs.flatMap((t) => t.log).some((l) => /금고[12]/.test(l.text))).toBe(false);
  });
  it('핑 후: 진짜 금고와 허니팟 소켓은 똑같이 "금고 신호"(종류는 여전히 중계), 빈 중계 소켓은 신호 없음', () => {
    let s = resolveTurn(createMatch(H), [], [setVaults(['BR1', 'BV2']), { type: 'compile', ice: 'honeypot', node: 'BV1' }]);
    s = resolveTurn(s, [{ type: 'launch', prog: 'ping', target: 'BR1' }], []); // BR1 + 인접 BV1·N1 공개
    const v = viewFor(s, 'A');
    expect([v.nodes.BR1.vaultSignal, v.nodes.BV1.vaultSignal]).toEqual([true, true]);
    expect([v.nodes.BR1.shownKind, v.nodes.BV1.shownKind]).toEqual(['relay', 'relay']);
    expect([v.nodes.BR1.hpHidden, v.nodes.BV1.hpHidden]).toEqual([true, true]);
    const ping = s.log.find((l) => l.step === 2)!.text;
    expect(ping).toContain('B 소켓2: ICE 없음 (금고 신호)');
    expect(ping).toContain('B 소켓1: ICE 없음 (금고 신호)');
    s = resolveTurn(s, [{ type: 'launch', prog: 'ping', target: 'BR3' }], []); // BR3(중계 소켓) 정찰
    expect(viewFor(s, 'A').nodes.BR3.vaultSignal).toBe(false);
  });
  it('직접 접촉하면 종류·HP 공개', () => {
    let s = resolveTurn(createMatch(H), [], [setVaults(['BR1', 'BV2'])]);
    s.ices = [];
    const id = s.nextId++;
    s.programs.push({ id, kind: 'siphon', owner: 'A', node: 'BR1', target: 'BR1', hp: 80, stunned: 0, detected: false, revealed: false, seq: id });
    s = resolveTurn(s, [], []);
    const n = viewFor(s, 'A').nodes.BR1;
    expect([n.shownKind, n.hpHidden, n.maxHp]).toEqual(['vault', false, 200]);
    expect(s.players.A.data).toBe(2); // 사이펀 탈취 정상 동작
  });
  it('AI: 시드로 결정론적 금고 선택(시드 없음 = V1·V2), 허니팟은 비금고 소켓', () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const s = createMatch(H);
      const o = aiOrders(s, 'A', 'balanced', seed);
      expect(JSON.stringify(o)).toBe(JSON.stringify(aiOrders(s, 'A', 'balanced', seed)));
      const sv = o.find((x) => x.type === 'setVaults') as { nodes: string[] };
      picks.add(sv.nodes.join(','));
      const hps = o.filter((x) => x.type === 'compile' && x.ice === 'honeypot') as { node: string }[];
      for (const h of hps) expect(sv.nodes.includes(h.node) || !socketsOf('A').includes(h.node)).toBe(false);
      expect(planBudget(s, 'A', o).errors.every((e) => e === null)).toBe(true);
    }
    expect(picks.size).toBeGreaterThan(3);
    expect((aiOrders(createMatch(H), 'B', 'balanced').find((x) => x.type === 'setVaults') as { nodes: string[] }).nodes).toEqual(['BV1', 'BV2']);
  });
  it('AI 대전 완주 + 결정론 (모든 성향)', () => {
    for (const st of AI_STYLES) {
      const run = () => { let s = createMatch(H); let g = 0; while (!s.over && g++ < 40) s = resolveTurn(s, aiOrders(s, 'A', st, 3), aiOrders(s, 'B', 'thief', 8)); return s; };
      const a = run();
      expect(a.over).toBe(true);
      expect(JSON.stringify(a)).toBe(JSON.stringify(run()));
    }
  });
  it('describeOrder는 소켓 이름 사용', () => {
    expect(describeOrder(createMatch(H), setVaults(['AV1', 'AR3']))).toBe('금고 지정: A 소켓1, A 소켓4');
  });
});
