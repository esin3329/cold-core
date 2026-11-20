import { aiOrders, AI_STYLES } from '../src/sim/ai';
import { SIEGE_ALL_OFF } from '../src/sim/config';
import { createMatch, resolveTurn } from '../src/sim/engine';
const opts = { iceUpkeepEnabled: true, coreDirectDamageEnabled: true, suddenDeathEnabled: true, neutralDataCapEnabled: true, neutralDataDelayEnabled: true, coreBreachDataEnabled: true };
for (const opp of AI_STYLES.filter((x) => x !== 'sieger')) {
  let gate = 0, gateTurn = 0, dealt = 0, breach = 0, win = 0, oppData = 0, turns = 0, augerLaunch = 0, augerAtCore = 0, n = 40;
  for (let k = 0; k < n; k++) {
    let s = createMatch({ ...SIEGE_ALL_OFF, ...opts }); let gt = 0;
    while (!s.over) {
      const oa = aiOrders(s, 'A', 'sieger', 100 + k), ob = aiOrders(s, 'B', opp, 200 + k);
      augerLaunch += oa.filter((o) => o.type === 'launch' && o.prog === 'auger').length;
      s = resolveTurn(s, oa, ob);
      augerAtCore += s.programs.filter((p) => p.owner === 'A' && p.node === 'BC').length;
      if (!gt && (s.nodes.BG1.destroyed || s.nodes.BG2.destroyed)) gt = s.turn;
    }
    if (gt) { gate++; gateTurn += gt; }
    dealt += s.players.A.coreDmgDealt / 10; breach += s.players.A.breachData / 2; win += s.winner === 'A' ? 1 : 0; oppData += s.players.B.data / 2; turns += s.turn;
  }
  console.log(opp, { gateBrokenPct: (100 * gate) / n, gateTurn: gate ? +(gateTurn / gate).toFixed(1) : '-', coreDmgDealt: +(dealt / n).toFixed(1), breach: +(breach / n).toFixed(2), augerLaunchPerGame: +(augerLaunch / n).toFixed(1), augerTurnsAtCore: +(augerAtCore / n).toFixed(2), siegerWin: (100 * win) / n, oppData: +(oppData / n).toFixed(1), turns: +(turns / n).toFixed(1) });
}
