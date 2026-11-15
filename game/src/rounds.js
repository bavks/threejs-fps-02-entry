// Rounds: the match itself. One state machine owns the phase (freeze, live, planted, end,
// match over), the round clock, the bomb, both economies and the score. It never touches the
// DOM or three.js: it pushes events onto a queue that main.js drains into the HUD, the audio
// and the effects, and it reads intent (fire/channel/move) that the player controller and
// the bot brains write onto each actor. Two squads of five; the squads swap sides at half
// time, so the player attacks for eight rounds, then defends for eight.
import { WEAPONS, GRENADES, ARMOR, createLoadout } from './weapons.js';
import { HOLD_NODES, SITE_NODES, SITES } from './map.js';

export const ROUND_TIME = 100;
export const BOMB_TIME = 40;
export const FREEZE_TIME = 6;
export const END_TIME = 4.5;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
const WIN_AWARD = 2700;
const OBJECTIVE_AWARD = 2900;
const LOSS_BASE = 1400;

export function createMatch(actors, squads, map, random) {
  const match = {
    actors, map, random,
    phase: 'menu',
    phaseT: 0,
    roundTime: ROUND_TIME,
    round: 0,
    scores: [0, 0],
    lossStreak: [0, 0],
    carrier: null,
    bombPlanted: false,
    bombSite: null,
    bombPos: { x: 0, z: 0 },
    bombTimer: 0,
    defuser: null,
    channel: null, // { actor, kind, progress, need }
    events: [],
    winner: -1,
    siteOf(id) { return SITES.find((s) => s.id === id); },
    siteNodeOf(id) { return SITE_NODES[id]; },
    aliveCount(team) { return actors.filter((a) => a.alive && a.team === team).length; },

    startMatch() {
      match.scores = [0, 0];
      match.lossStreak = [0, 0];
      match.round = 0;
      match.winner = -1;
      setSides(0);
      for (const a of actors) { a.money = 800; a.kills = 0; a.deaths = 0; a.loadout = createLoadout(); }
      match.startRound();
    },

    startRound() {
      match.round += 1;
      if (match.round === 9) {
        // Half time: squads swap sides, purses and loadouts reset.
        setSides(1);
        for (const a of actors) { a.money = 800; a.loadout = createLoadout(); }
        match.events.push({ type: 'halftime' });
      }
      match.phase = 'freeze';
      match.phaseT = FREEZE_TIME;
      match.roundTime = ROUND_TIME;
      match.bombPlanted = false;
      match.bombSite = null;
      match.bombTimer = 0;
      match.defuser = null;
      match.channel = null;
      // Bodies back to spawn, whole and unhurt.
      for (const squad of squads) {
        squad.forEach((a, i) => {
          const sp = map.spawns[a.team][i % map.spawns[a.team].length];
          a.pos.x = sp[0]; a.pos.z = sp[1]; a.pos.y = 0;
          a.vel.x = 0; a.vel.y = 0; a.vel.z = 0;
          a.health = 100;
          a.alive = true;
          a.deathT = 0;
          a.flashBlindUntil = 0;
          a.suppressedUntil = 0;
          a.bloom = 0;
          a.reloadUntil = 0;
          a.crouch = false;
          a.yaw = a.team === 0 ? Math.PI * 0.85 : -Math.PI * 0.35;
          const lo = a.loadout;
          if (lo.primary) { lo.primary.mag = WEAPONS[lo.primary.id].mag; }
          lo.sidearm.mag = WEAPONS.wren.mag;
          lo.current = lo.primary ? 'primary' : 'sidearm';
          a.intent = a.intent || { moveX: 0, moveZ: 0, fire: false, crouch: false, channel: false, faceYaw: a.yaw, facePitch: 0 };
          a.intent.fire = false;
          a.intent.channel = false;
        });
      }
      // The charge goes to a random Jackal — sometimes the player.
      const jackals = actors.filter((a) => a.team === 0);
      match.carrier = jackals[Math.floor(random() * jackals.length)];
      planRound();
      match.events.push({ type: 'roundStart', round: match.round });
    },

    // Buy window: the freeze, or the first 15 seconds of the round near your own spawn.
    canBuy(actor) {
      if (match.phase === 'freeze') return true;
      if (match.phase !== 'live' || match.bombPlanted) return false;
      if (ROUND_TIME - match.roundTime > 15) return false;
      const sp = map.spawns[actor.team];
      return sp.some(([x, z]) => Math.hypot(actor.pos.x - x, actor.pos.z - z) < 8);
    },

    tryBuy(actor, item) {
      if (!match.canBuy(actor)) return 'Buy window closed';
      const lo = actor.loadout;
      const buyGun = (id) => {
        const slot = WEAPONS[id].slot;
        if (lo[slot] && lo[slot].id === id) return 'Already owned';
        if (actor.money < WEAPONS[id].price) return 'Not enough money';
        actor.money -= WEAPONS[id].price;
        lo[slot] = { id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
        if (slot === 'primary') lo.current = 'primary';
        return null;
      };
      if (WEAPONS[item]) return buyGun(item);
      if (item === 'armor1' || item === 'armor2') {
        const tier = item === 'armor1' ? 1 : 2;
        if (lo.armor >= tier) return 'Already owned';
        const cost = tier === 2 && lo.armor === 1 ? 350 : ARMOR[tier].price;
        if (actor.money < cost) return 'Not enough money';
        actor.money -= cost;
        lo.armor = tier;
        return null;
      }
      if (item === 'he' || item === 'flash') {
        if (lo[item] >= 1) return 'Already carried';
        if (actor.money < GRENADES[item].price) return 'Not enough money';
        actor.money -= GRENADES[item].price;
        lo[item] = 1;
        return null;
      }
      return 'Unknown item';
    },

    onKill(killer, victim) {
      victim.deaths += 1;
      if (killer && killer !== victim) {
        killer.kills += 1;
        killer.money += 300;
      }
      if (match.carrier === victim) match.carrier = null; // the charge is lost with its carrier
    },

    step(dt) {
      if (match.phase === 'freeze') {
        match.phaseT -= dt;
        if (match.phaseT <= 0) {
          match.phase = 'live';
          match.events.push({ type: 'go' });
        }
        return;
      }
      if (match.phase === 'end') {
        match.phaseT -= dt;
        if (match.phaseT <= 0) {
          if (match.winner >= 0) { match.phase = 'matchover'; match.events.push({ type: 'matchOver' }); }
          else match.startRound();
        }
        return;
      }
      if (match.phase !== 'live') return;

      stepChannel(dt);

      if (match.bombPlanted) {
        match.bombTimer -= dt;
        pickDefuser();
        if (match.bombTimer <= 0) {
          match.events.push({ type: 'detonate', x: match.bombPos.x, z: match.bombPos.z });
          endRound(0, 'objective');
          return;
        }
        if (match.aliveCount(1) === 0) { endRound(0, 'elimination'); return; }
        // Attackers all dead with the charge down: the round still runs — Wardens must defuse.
        return;
      }

      match.roundTime -= dt;
      if (match.aliveCount(0) === 0) { endRound(1, 'elimination'); return; }
      if (match.aliveCount(1) === 0) { endRound(0, 'elimination'); return; }
      if (match.roundTime <= 0) { endRound(1, 'time'); return; }
    },
  };

  function setSides(half) {
    // Squad 0 attacks in the first half and defends in the second; squad 1 the reverse.
    squads[0].forEach((a) => { a.team = half === 0 ? 0 : 1; });
    squads[1].forEach((a) => { a.team = half === 0 ? 1 : 0; });
    match.events.push({ type: 'sides', half });
  }

  function planRound() {
    const site = random() < 0.5 ? 'A' : 'B';
    const other = site === 'A' ? 'B' : 'A';
    const jackalBots = actors.filter((a) => a.team === 0 && !a.isPlayer);
    let lurker = null;
    if (random() < 0.3 && jackalBots.length > 1) lurker = jackalBots[Math.floor(random() * jackalBots.length)];
    for (const a of actors) {
      if (!a.brain) continue;
      if (a.team === 0) {
        a.brain.plan = { type: 'attack', site: a === lurker ? other : site, planter: a === match.carrier };
      } else {
        const holds = [...HOLD_NODES.A, ...HOLD_NODES.B, ...HOLD_NODES.mid];
        const idx = actors.filter((x) => x.team === 1 && x.brain).indexOf(a);
        a.brain.plan = { type: 'defend', holdNode: holds[(idx + match.round) % holds.length] };
      }
    }
    if (match.carrier && match.carrier.brain) {
      match.carrier.brain.plan = { type: 'attack', site, planter: true };
    }
    match.targetSite = site;
  }

  function pickDefuser() {
    if (match.defuser && match.defuser.alive && !match.defuser.isPlayer) return;
    let best = null;
    let bd = Infinity;
    for (const a of actors) {
      if (!a.alive || a.team !== 1 || a.isPlayer || !a.brain) continue;
      const d = Math.hypot(a.pos.x - match.bombPos.x, a.pos.z - match.bombPos.z);
      if (d < bd) { bd = d; best = a; }
    }
    match.defuser = best;
  }

  // Plant and defuse are channels: hold the intent in place for the duration. Moving,
  // dying or letting go breaks them.
  function stepChannel(dt) {
    const ch = match.channel;
    if (ch) {
      const a = ch.actor;
      const broken = !a.alive || !a.intent.channel || a.speed2d > 0.6;
      const outOfZone = ch.kind === 'plant'
        ? Math.hypot(a.pos.x - match.siteOf(match.targetSite).x, a.pos.z - match.siteOf(match.targetSite).z) > match.siteOf(match.targetSite).r
        : Math.hypot(a.pos.x - match.bombPos.x, a.pos.z - match.bombPos.z) > 1.6;
      if (broken || outOfZone) {
        match.channel = null;
        match.events.push({ type: 'channelBreak', kind: ch.kind });
      } else {
        ch.progress += dt;
        if (ch.progress >= ch.need) {
          match.channel = null;
          if (ch.kind === 'plant') completePlant(a);
          else { match.events.push({ type: 'defused' }); endRound(1, 'defuse'); }
        }
        return;
      }
    }
    // Start a plant: the carrier, standing in either site, asking to channel.
    const carrier = match.carrier;
    if (!match.bombPlanted && carrier && carrier.alive && carrier.intent.channel) {
      for (const s of SITES) {
        if (Math.hypot(carrier.pos.x - s.x, carrier.pos.z - s.z) < s.r - 0.4) {
          match.targetSite = s.id;
          match.channel = { actor: carrier, kind: 'plant', progress: 0, need: PLANT_TIME };
          match.events.push({ type: 'channelStart', kind: 'plant' });
          return;
        }
      }
    }
    // Start a defuse: a Warden at the charge, asking to channel.
    if (match.bombPlanted) {
      for (const a of actors) {
        if (a.alive && a.team === 1 && a.intent.channel && Math.hypot(a.pos.x - match.bombPos.x, a.pos.z - match.bombPos.z) < 1.6) {
          match.channel = { actor: a, kind: 'defuse', progress: 0, need: DEFUSE_TIME };
          match.events.push({ type: 'channelStart', kind: 'defuse' });
          return;
        }
      }
    }
  }

  function completePlant(a) {
    match.bombPlanted = true;
    match.bombSite = match.targetSite;
    match.bombPos.x = a.pos.x;
    match.bombPos.z = a.pos.z;
    match.bombTimer = BOMB_TIME;
    match.carrier = null;
    a.money += 300;
    match.events.push({ type: 'planted', site: match.bombSite, x: match.bombPos.x, z: match.bombPos.z });
  }

  function endRound(winnerTeam, how) {
    match.phase = 'end';
    match.phaseT = END_TIME;
    match.channel = null;
    match.scores[winnerTeam] += 1;
    const loser = 1 - winnerTeam;
    match.lossStreak[winnerTeam] = 0;
    match.lossStreak[loser] += 1;
    const winPay = how === 'objective' || how === 'defuse' ? OBJECTIVE_AWARD : WIN_AWARD;
    const lossPay = LOSS_BASE + Math.min(3, match.lossStreak[loser] - 1) * 400;
    for (const a of actors) {
      a.money += a.team === winnerTeam ? winPay : lossPay;
    }
    match.events.push({ type: 'roundEnd', winner: winnerTeam, how, scores: [...match.scores] });
    // Match point: first to 9, with round 17 as the decider if the halves split 8-8.
    if (match.scores[winnerTeam] >= 9 || match.round >= 17) {
      match.winner = match.scores[0] > match.scores[1] ? 0 : 1;
    }
  }

  return match;
}
