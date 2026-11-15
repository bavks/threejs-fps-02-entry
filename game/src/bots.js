// Bot brains: intent written onto actors; main.js actuates.
import { lineOfSight } from './physics.js';
import { eyeHeight } from './actors.js';
import { WEAPONS } from './weapons.js';
import { HOLD_FACE } from './map.js';

const VIEW_DIST = 58;
const HEAR_DIST = 26;

export function createBotAI(actor, random) {
  return {
    actor,
    skill: 0.85 + random() * 0.3,
    state: 'advance',
    plan: null, // round plan
    goalNode: 0,
    pathNode: 0,
    thinkT: random() * 0.12,
    seen: null, // current target
    lastSeen: { x: 0, z: 0 },
    lastSeenT: -9,
    spottedAt: 0, // first-seen time
    burstLeft: 0,
    burstPauseT: 0,
    strafeDir: 1,
    strafeT: 0,
    scanPhase: random() * 6,
    investigate: null,
    channelWanted: false,
    random,
  };
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function perceive(brain, world, now) {
  const a = brain.actor;
  brain.seen = null;
  if (now < a.flashBlindUntil) return;
  const eyeY = a.pos.y + eyeHeight(a);
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  let bestD = Infinity;
  for (const e of world.actors) {
    if (!e.alive || !world.hostile(a, e)) continue;
    const dx = e.pos.x - a.pos.x;
    const dz = e.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VIEW_DIST || dist >= bestD) continue;
    const dot = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
    if (dot < 0.42 && dist > 4) continue; // ~65° half-angle
    const ty = e.pos.y + e.height * 0.62;
    if (!lineOfSight(a.pos.x, eyeY, a.pos.z, e.pos.x, ty, e.pos.z, world.colliders)) continue;
    bestD = dist;
    brain.seen = e;
    brain.lastSeen.x = e.pos.x;
    brain.lastSeen.z = e.pos.z;
    brain.lastSeenT = now;
  }
  if (!brain.seen) {
    for (let i = world.noise.length - 1; i >= 0; i--) {
      const n = world.noise[i];
      if (now - n.t > 1.6) break;
      if (n.team === a.team && !world.ffa) continue;
      const d = Math.hypot(n.x - a.pos.x, n.z - a.pos.z);
      if (d > 2 && d < HEAR_DIST) {
        brain.investigate = { x: n.x, z: n.z };
        brain.lastSeen.x = n.x;
        brain.lastSeen.z = n.z;
        break;
      }
    }
  }
}

function steer(brain, world, tx, tz, dt, arriveR = 0.8) {
  const a = brain.actor;
  const dx = tx - a.pos.x;
  const dz = tz - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < arriveR) {
    a.intent.moveX = 0;
    a.intent.moveZ = 0;
    return true;
  }
  let mx = dx / dist;
  let mz = dz / dist;
  for (const o of world.actors) {
    if (o === a || !o.alive) continue;
    const ox = a.pos.x - o.pos.x;
    const oz = a.pos.z - o.pos.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.01 && od < 0.9) { mx += (ox / od) * 0.7; mz += (oz / od) * 0.7; }
  }
  const ml = Math.hypot(mx, mz) || 1;
  a.intent.moveX = mx / ml;
  a.intent.moveZ = mz / ml;
  a.intent.faceYaw = Math.atan2(-(dx / dist), -(dz / dist));
  return false;
}

function followPath(brain, world, dt) {
  const a = brain.actor;
  const nodes = world.map.nodes;
  const here = nearestNode(nodes, a.pos.x, a.pos.z);
  const next = world.map.nextHop[here][brain.goalNode];
  brain.pathNode = next;
  const n = nodes[next];
  const arrivedGoal = here === brain.goalNode && Math.hypot(n.x - a.pos.x, n.z - a.pos.z) < 1.1;
  if (arrivedGoal) { a.intent.moveX = 0; a.intent.moveZ = 0; return true; }
  steer(brain, world, n.x, n.z, dt, 0.65);
  return false;
}

function aimError(brain, target, dist) {
  const base = 1.5 + dist * 0.028 + Math.min(1.2, target.speed2d * 0.22);
  return ((base / brain.skill) * Math.PI) / 180;
}

export function stepBot(brain, world, now, dt) {
  const a = brain.actor;
  const intent = a.intent;
  intent.fire = false;
  intent.crouch = false;
  intent.channel = false;
  brain.channelWanted = false;
  if (!a.alive) { intent.moveX = 0; intent.moveZ = 0; return; }

  brain.thinkT -= dt;
  if (brain.thinkT <= 0) {
    brain.thinkT = 0.12;
    const had = brain.seen;
    perceive(brain, world, now);
    if (brain.seen && brain.seen !== had) brain.spottedAt = now;
    if (brain.seen) brain.investigate = null;
  }

  const round = world.round;
  const enemy = brain.seen;
  const fresh = enemy && now - brain.lastSeenT < 0.4;

  if (round.bombPlanted && a.team === 1) {
    brain.goalNode = world.siteNodeOf(round.bombSite);
    if (round.defuser === a) {
      const bp = round.bombPos;
      if (steer(brain, world, bp.x, bp.z, dt, 1.0)) {
        intent.faceYaw = a.yaw;
        intent.channel = true;
        brain.channelWanted = true;
        intent.moveX = 0; intent.moveZ = 0;
      }
    } else if (followPath(brain, world, dt)) {
      holdStance(brain, world, now);
    }
    if (fresh) engage(brain, world, now, dt);
    return;
  }
  if (round.bombPlanted && a.team === 0) {
    brain.goalNode = world.siteNodeOf(round.bombSite);
    if (followPath(brain, world, dt)) holdStance(brain, world, now);
    if (fresh) engage(brain, world, now, dt);
    return;
  }

  if (brain.plan && brain.plan.planter && a.team === 0 && round.phase === 'live') {
    brain.goalNode = world.siteNodeOf(brain.plan.site);
    const site = world.siteOf(brain.plan.site);
    const inZone = Math.hypot(a.pos.x - site.x, a.pos.z - site.z) < site.r - 0.6;
    if (inZone && !fresh) {
      intent.moveX = 0; intent.moveZ = 0;
      intent.channel = true;
      brain.channelWanted = true;
      intent.faceYaw = brain.plan.site === 'A' ? 2.4 : -0.8;
      return;
    }
    if (followPath(brain, world, dt) && !inZone) holdStance(brain, world, now);
    if (fresh) engage(brain, world, now, dt);
    return;
  }

  if (fresh) { engage(brain, world, now, dt); return; }
  if (brain.seen === null && now - brain.lastSeenT < 1.4 && brain.lastSeenT > 0) {
    if (steer(brain, world, brain.lastSeen.x, brain.lastSeen.z, dt, 1.2)) holdStance(brain, world, now);
    return;
  }

  if (brain.plan && brain.plan.type === 'hunt') {
    brain.goalNode = brain.plan.node;
    if (followPath(brain, world, dt)) brain.plan.node = Math.floor(brain.random() * world.map.nodes.length);
    return;
  }

  if (brain.plan && brain.plan.type === 'defend') {
    brain.goalNode = brain.plan.holdNode;
    if (followPath(brain, world, dt)) {
      if (brain.investigate) {
        const inv = brain.investigate;
        if (steer(brain, world, inv.x, inv.z, dt, 1.4)) brain.investigate = null;
      } else holdStance(brain, world, now);
    }
    return;
  }
  if (brain.plan) {
    brain.goalNode = world.siteNodeOf(brain.plan.site);
    if (followPath(brain, world, dt)) holdStance(brain, world, now);
    return;
  }
  intent.moveX = 0;
  intent.moveZ = 0;
}

function holdStance(brain, world, now) {
  const a = brain.actor;
  a.intent.moveX = 0;
  a.intent.moveZ = 0;
  const face = HOLD_FACE[brain.goalNode];
  brain.scanPhase += 0.016;
  if (face) {
    const base = Math.atan2(-(face[0] - a.pos.x), -(face[1] - a.pos.z));
    a.intent.faceYaw = base + Math.sin(brain.scanPhase * 0.7) * 0.35;
  }
  if (brain.investigate) {
    a.intent.faceYaw = Math.atan2(-(brain.investigate.x - a.pos.x), -(brain.investigate.z - a.pos.z));
  }
  a.intent.crouch = brain.actor.team === 1 && brain.scanPhase % 3 < 1.6;
}

function engage(brain, world, now, dt) {
  const a = brain.actor;
  const intent = a.intent;
  const e = brain.seen;
  const dx = e.pos.x - a.pos.x;
  const dz = e.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  const aimY = e.pos.y + e.height * (brain.random() < 0.22 ? 0.88 : 0.6);
  const eyeY = a.pos.y + (a.height - 0.16);
  const err = aimError(brain, e, dist);
  const ex = (brain.random() * 2 - 1) * err;
  const ey = (brain.random() * 2 - 1) * err * 0.7;
  intent.faceYaw = Math.atan2(-dx, -dz) + ex;
  intent.facePitch = Math.atan2(aimY - eyeY, dist) + ey;

  const reacted = now - brain.spottedAt > 0.34 / brain.skill;
  const blind = now < a.flashBlindUntil;
  if (brain.burstPauseT > 0) brain.burstPauseT -= dt;
  if (reacted && !blind && brain.burstPauseT <= 0) {
    intent.fire = true;
    brain.burstLeft -= dt;
    if (brain.burstLeft <= 0) {
      brain.burstLeft = 0.28 + brain.random() * 0.3;
      brain.burstPauseT = 0.22 + brain.random() * 0.3;
    }
  }
  brain.strafeT -= dt;
  if (brain.strafeT <= 0) { brain.strafeT = 0.7 + brain.random() * 0.8; brain.strafeDir = brain.random() < 0.5 ? -1 : 1; }
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  if (dist > 26) { intent.moveX = fx; intent.moveZ = fz; }
  else if (dist < 7) { intent.moveX = -fx * 0.6; intent.moveZ = -fz * 0.6; }
  else { intent.moveX = -fz * brain.strafeDir; intent.moveZ = fx * brain.strafeDir; }
  intent.crouch = brain.strafeT < 0.25 && dist < 20;
}

export function botBuy(actor, random) {
  const lo = actor.loadout;
  if (!lo.primary) {
    const menu = ['lance', 'oxen', 'heron', 'harrier', 'jackdaw', 'krait', 'boar'];
    const afford = menu.filter((id) => actor.money >= WEAPONS[id].price);
    if (afford.length) {
      const id = afford[random() < 0.72 || afford.length === 1 ? 0 : 1];
      actor.money -= WEAPONS[id].price;
      lo.primary = freshGun(id);
    }
  }
  if (lo.sidearm.id === 'wren' && actor.money >= 1500 && random() < 0.35) {
    actor.money -= WEAPONS.magpie.price;
    lo.sidearm = freshGun('magpie');
  }
  if (lo.armor < 2 && actor.money >= (lo.armor === 1 ? 350 : 1000) && actor.money > 1600) {
    actor.money -= lo.armor === 1 ? 350 : 1000;
    lo.armor = 2;
  } else if (lo.armor < 1 && actor.money >= 650) {
    actor.money -= 650;
    lo.armor = 1;
  }
  if (actor.money >= 900 && lo.he === 0 && random() < 0.4) { actor.money -= 300; lo.he = 1; }
  if (actor.money >= 700 && lo.flash === 0 && random() < 0.3) { actor.money -= 200; lo.flash = 1; }
  lo.current = lo.primary ? 'primary' : 'sidearm';
}

function freshGun(id) {
  return { id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
}

export function freePick(actor, random) {
  const lo = actor.loadout;
  const ladder = ['boar', 'krait', 'krait', 'jackdaw', 'jackdaw', 'harrier', 'harrier', 'harrier', 'heron', 'oxen', 'lance'];
  lo.primary = freshGun(ladder[Math.floor(random() * ladder.length)]);
  lo.sidearm = freshGun(random() < 0.3 ? 'magpie' : 'wren');
  lo.armor = random() < 0.5 ? 2 : 1;
  lo.he = random() < 0.4 ? 1 : 0;
  lo.flash = random() < 0.3 ? 1 : 0;
  lo.current = 'primary';
}
