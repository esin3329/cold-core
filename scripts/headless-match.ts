import { aiOrders } from '../src/sim/ai';
import { createMatch, resolveTurn } from '../src/sim/engine';
let s = createMatch();
while (!s.over) {
  s = resolveTurn(s, aiOrders(s, 'A', (process.env.SA as any) ?? 'balanced'), aiOrders(s, 'B', (process.env.SB as any) ?? 'raider'));
  for (const l of s.log) if (l.vis === 'all' || process.env.ALL) console.log(`T${s.turnLogs.at(-1)!.turn} [${l.step}] ${l.text}`);
}
console.log('WINNER', s.winner, s.winReason, 'turn', s.turn, 'data', s.players.A.data / 2, s.players.B.data / 2, 'core', s.nodes.AC.hp / 10, s.nodes.BC.hp / 10, 'heat', s.players.A.heat, s.players.B.heat);
