// IRONFALL — boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate; player and bots share one combat path. ?shot=1..4 stages a screenshot.
import * as THREE from 'three';
import { PALETTE, TEAM_NAMES } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createSky } from './sky.js';
import { rayWorld, rayBox } from './physics.js';
import { createActor, buildActorModel, setModelGun, poseActorModel, stepLocomotion, eyeHeight, rayActor } from './actors.js';
import { createBotAI, stepBot, botBuy, freePick } from './bots.js';
import { createMatch } from './rounds.js';
import { createInput } from './input.js';
import { createPlayerController } from './player.js';
import { WEAPONS, currentGun, currentZoom, damageAt, spreadRadians, buildGunModel } from './weapons.js';
import { createEffects, createBombProp } from './effects.js';
import { glowTexture } from './textures.js';
import { createAudio } from './audio.js';
import { createHud, BUY_ITEMS } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 34, 115);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 240);
scene.add(camera);

const map = createMap(scene, random);
const sky = createSky(scene, map.sky, renderer);
const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene, glowTexture());
const bombProp = createBombProp(scene);

// --- Cast ---
const BOT_NAMES = ['Vex', 'Onyx', 'Rurik', 'Sable', 'Koda', 'Miro', 'Talon', 'Ash', 'Reyes'];
const player = createActor(0, 'You', true);
const actors = [player];
const brains = new Map();
for (let i = 0; i < 9; i++) {
  const bot = createActor(i < 4 ? 0 : 1, BOT_NAMES[i], false);
  bot.brain = createBotAI(bot, random);
  brains.set(bot, bot.brain);
  actors.push(bot);
}
for (const a of actors) {
  a.intent = { moveX: 0, moveZ: 0, fire: false, crouch: false, channel: false, faceYaw: a.yaw, facePitch: 0 };
  if (!a.isPlayer) {
    buildActorModel(a);
    scene.add(a.model);
    setModelGun(a, 'wren');
  }
}
const squads = [[player, actors[1], actors[2], actors[3], actors[4]], [actors[5], actors[6], actors[7], actors[8], actors[9]]];
const match = createMatch(actors, squads, map, random);
const world = {
  actors, colliders: map.colliders, map, noise: [], round: match, siteOf: match.siteOf, siteNodeOf: match.siteNodeOf,
  hostile: (a, b) => (match.mode === 'ffa' ? a !== b : a.team !== b.team),
  ffa: false,
};
const controller = createPlayerController(player);
const input = createInput(renderer.domElement, onLockChange);

const viewmodel = new THREE.Group();
viewmodel.position.set(0.235, -0.225, -0.48);
camera.add(viewmodel);
const vmGuns = {};
let vmKick = 0;
let vmKickZ = 0;
let vmLagYaw = 0;
let vmLagPitch = 0;
let lastViewYaw = 0;
let lastViewPitch = 0;
let vmReloadDip = 0;
function showViewmodel(id) {
  for (const key of Object.keys(vmGuns)) vmGuns[key].visible = false;
  if (!vmGuns[id]) {
    vmGuns[id] = buildGunModel(id);
    vmGuns[id].scale.setScalar(1.05);
    viewmodel.add(vmGuns[id]);
  }
  vmGuns[id].visible = true;
}
showViewmodel('wren');

// --- Practice range ---
const LINE = { x: -33, z: -24.6, yaw: -Math.PI / 2 };
const RANGE_SPOTS = [[-23, -24.6, 10], [-8, -24.6, 25], [17, -24.6, 50], [32, -24.6, 65]];
const range = { built: false, targets: [], hits: 0, hs: 0, last: '' };

function buildRange() {
  range.built = true;
  for (const [x, z, dist] of RANGE_SPOTS) {
    const t = createActor(1, `Target ${dist}m`, false);
    t.pos.x = x; t.pos.z = z;
    t.yaw = Math.atan2(-(LINE.x - x), -(LINE.z - z));
    t.dist = dist;
    t.rockT = 0;
    t.respawnT = 0;
    buildActorModel(t);
    scene.add(t.model);
    range.targets.push(t);
  }
}

function resetRange() {
  if (!range.built) buildRange();
  range.hits = 0;
  range.hs = 0;
  range.last = '';
  for (const t of range.targets) {
    t.alive = true; t.health = 100; t.deathT = 0; t.flashT = 0; t.rockT = 0; t.respawnT = 0;
    t.model.visible = true;
  }
}

function placePlayerAtLine() {
  player.pos.x = LINE.x; player.pos.z = LINE.z; player.pos.y = 0;
  player.vel.x = 0; player.vel.y = 0; player.vel.z = 0;
  player.yaw = LINE.yaw;
  player.pitch = 0;
}

function rangeHit(target, dmg, metres, part) {
  target.health -= dmg;
  target.flashT = 0.18;
  target.rockT = 0.3;
  range.hits += 1;
  const head = part === 'head';
  if (head) range.hs += 1;
  const down = target.health <= 0;
  if (down) { target.alive = false; target.health = 0; target.respawnT = 3; }
  range.last = `${head ? 'HEADSHOT · ' : ''}HIT ${Math.round(dmg)} DMG · ${metres} M${down ? ' · TARGET DOWN' : ''}`;
  hud.hitmarker(down);
  audio.hit(head);
}

function stepRange(dt) {
  for (const t of range.targets) {
    if (t.alive) continue;
    t.respawnT -= dt;
    if (t.respawnT <= 0) { t.alive = true; t.health = 100; t.deathT = 0; }
  }
  if (!player.alive) {
    player.respawnT -= dt;
    if (player.respawnT <= 0) {
      placePlayerAtLine();
      player.alive = true;
      player.health = 100;
      player.deathT = 0;
      hud.setSpectate(null);
    }
  }
}

const RANGE_GUNS = ['wren', 'magpie', 'boar', 'krait', 'jackdaw', 'harrier', 'heron', 'oxen', 'lance'];
function grantRangeGun(id) {
  const lo = player.loadout;
  const slot = WEAPONS[id].slot;
  lo[slot] = { id, mag: WEAPONS[id].mag, reserve: 9999 };
  lo.current = slot;
  player.scoped = false;
  player.zoomIdx = 0;
  showViewmodel(id);
  audio.draw();
  range.last = `${WEAPONS[id].name.toUpperCase()} · ${WEAPONS[id].blurb}`;
}

// --- Combat ---
const tmpDir = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
let shake = 0;
let lastBeepAt = 0;

function muzzlePos(actor, out) {
  if (actor.isPlayer) {
    controller.eyePos(out);
    tmpDir.set(-Math.sin(controller.viewYaw()) * Math.cos(controller.viewPitch()), Math.sin(controller.viewPitch()), -Math.cos(controller.viewYaw()) * Math.cos(controller.viewPitch()));
    out.addScaledVector(tmpDir, 0.55);
    out.y -= 0.12;
    return out;
  }
  return actor.model.userData.gunMount.getWorldPosition(out);
}

function applyDamage(target, amount, attacker, part) {
  if (!target.alive || match.phase !== 'live') return;
  target.health -= amount;
  target.flashT = 0.18;
  if (target.isPlayer) {
    hud.damageFlash();
    audio.hurt();
    shake = Math.min(0.5, shake + amount * 0.004);
    if (attacker) {
      const bearing = Math.atan2(attacker.pos.x - target.pos.x, attacker.pos.z - target.pos.z) + controller.viewYaw() + Math.PI;
      hud.setHitDir(bearing);
    }
  } else if (attacker && attacker.isPlayer) {
    hud.hitmarker(target.health <= 0);
    audio.hit(part === 'head');
  }
  if (target.health <= 0) killActor(target, attacker, part === 'head');
}

function killActor(victim, attacker, headshot) {
  victim.alive = false;
  victim.health = 0;
  match.onKill(attacker, victim);
  const wName = attacker ? currentGun(attacker.loadout).def.name : 'Charge';
  const kName = attacker ? attacker.name : '—';
  const kc = attacker ? `k${attacker.team}` : '';
  const vc = `k${victim.team}`;
  hud.addKill(`<span class="${kc}">${kName}</span> ▸ ${wName}${headshot ? ' <span class="hs">HEADSHOT</span>' : ''} ▸ <span class="${vc}">${victim.name}</span>`);
  if (attacker && attacker.isPlayer) audio.kill();
  if (victim.isPlayer) {
    hud.setSpectate(match.mode === 'defusal'
      ? 'You are down — spectating a teammate until the round ends'
      : 'You are down — respawning…');
    hud.setScope(false);
    if (match.mode === 'range') victim.respawnT = 1;
  }
}

function fireOne(actor, def, now) {
  const eyeY = actor.pos.y + eyeHeight(actor);
  const speedRatio = Math.min(1, actor.speed2d / def.speed);
  const spread = spreadRadians(def, speedRatio, !actor.onGround, actor.crouch, actor.scoped, actor.bloom);
  const yaw = actor.isPlayer ? controller.viewYaw() : actor.yaw;
  const pitch = actor.isPlayer ? controller.viewPitch() : actor.pitch;
  tmpDir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  if (spread > 0) {
    tmpDir.x += (random() * 2 - 1) * spread;
    tmpDir.y += (random() * 2 - 1) * spread;
    tmpDir.z += (random() * 2 - 1) * spread;
    tmpDir.normalize();
  }
  const wallT = rayWorld(actor.pos.x, eyeY, actor.pos.z, tmpDir.x, tmpDir.y, tmpDir.z, map.colliders);
  let bestT = wallT;
  let bestActor = null;
  let bestPart = null;
  let bestTarget = null;
  for (const other of actors) {
    if (other === actor || !other.alive || !world.hostile(actor, other)) continue;
    const hit = rayActor(actor.pos.x, eyeY, actor.pos.z, tmpDir.x, tmpDir.y, tmpDir.z, other);
    if (hit && hit.t < bestT) { bestT = hit.t; bestActor = other; bestPart = hit.part; }
  }
  if (match.mode === 'range') {
    for (const t of range.targets) {
      if (!t.alive) continue;
      const hit = rayActor(actor.pos.x, eyeY, actor.pos.z, tmpDir.x, tmpDir.y, tmpDir.z, t);
      if (hit && hit.t < bestT) { bestT = hit.t; bestActor = null; bestTarget = t; bestPart = hit.part; }
    }
  }
  const ex = actor.pos.x + tmpDir.x * bestT;
  const ey = eyeY + tmpDir.y * bestT;
  const ez = actor.pos.z + tmpDir.z * bestT;
  muzzlePos(actor, tmpOrigin);
  effects.tracer(tmpOrigin.x, tmpOrigin.y, tmpOrigin.z, ex, ey, ez);
  if (bestTarget) {
    effects.impact(ex, ey, ez, 'blood');
    rangeHit(bestTarget, damageAt(def, bestT, bestPart, 0), Math.round(bestT), bestPart);
  } else if (bestActor) {
    effects.impact(ex, ey, ez, 'blood');
    applyDamage(bestActor, damageAt(def, bestT, bestPart, bestActor.loadout.armor), actor, bestPart);
  } else if (bestT < Infinity) {
    effects.impact(ex, ey, ez, random() < 0.4 ? 'spark' : 'dust');
  }
  return bestT;
}

function tryFire(actor, now) {
  if (!actor.alive || match.phase !== 'live' || match.channel?.actor === actor) return;
  const { held, def } = currentGun(actor.loadout);
  if (actor.reloading) {
    if (now >= actor.reloadUntil) finishReload(actor);
    else return;
  }
  if (now < actor.nextShot) return;
  if (def.burst) {
    if (actor.burstLeft <= 0) {
      if (actor.semiLatch) return;
      actor.burstLeft = def.burst;
    }
  } else if (!def.auto && actor.semiLatch) return;
  if (held.mag <= 0) {
    startReload(actor, now);
    if (actor.isPlayer) audio.dryFire();
    actor.nextShot = now + 0.3;
    return;
  }
  held.mag -= 1;
  actor.semiLatch = true;
  if (def.burst) {
    actor.burstLeft -= 1;
    if (actor.burstLeft > 0) actor.semiLatch = false; // the burst feeds itself
  }
  actor.nextShot = now + 60 / def.rpm;
  actor.lastShotAt = now;
  actor.bloom = Math.min(2.2, actor.bloom + def.bloom);
  for (let p = 0; p < def.pellets; p++) fireOne(actor, def, now);
  muzzlePos(actor, tmpOrigin);
  const big = def.pellets > 1 || def.damage > 60 || def.heavy;
  const fyaw = actor.isPlayer ? controller.viewYaw() : actor.yaw;
  const fpitch = actor.isPlayer ? controller.viewPitch() : actor.pitch;
  tmpDir.set(-Math.sin(fyaw) * Math.cos(fpitch), Math.sin(fpitch), -Math.cos(fyaw) * Math.cos(fpitch));
  effects.muzzle(tmpOrigin.x, tmpOrigin.y, tmpOrigin.z, big, tmpDir.x, tmpDir.y, tmpDir.z);
  effects.smoke(tmpOrigin.x, tmpOrigin.y, tmpOrigin.z, tmpDir.x, tmpDir.y, tmpDir.z, big);
  audio.shot(held.id, actor.isPlayer ? undefined : actor.pos.x, actor.isPlayer ? undefined : actor.pos.z);
  world.noise.push({ x: actor.pos.x, z: actor.pos.z, t: now, team: actor.team });
  if (actor.isPlayer) {
    controller.kick(def.recoil * 0.55, (random() * 2 - 1) * def.recoil * 0.22);
    vmKick = Math.min(0.16, vmKick + 0.035 + def.recoil * 0.016);
    vmKickZ = (random() * 2 - 1) * 0.03;
  } else {
    actor.muzzleT = 0.05;
  }
}

function startReload(actor, now) {
  const { held, def } = currentGun(actor.loadout);
  if (actor.reloading || held.reserve <= 0 || held.mag >= def.mag) return;
  actor.reloading = true;
  actor.reloadUntil = now + def.reload;
  if (actor.isPlayer) { audio.reload(); vmReloadDip = 1; }
}

function finishReload(actor) {
  const { held, def } = currentGun(actor.loadout);
  const need = def.mag - held.mag;
  const take = Math.min(need, held.reserve);
  held.mag += take;
  held.reserve -= take;
  actor.reloading = false;
}

function throwGrenade(actor, kind, targetPos) {
  const lo = actor.loadout;
  if (lo[kind] <= 0) return;
  lo[kind] -= 1;
  const eyeY = actor.pos.y + eyeHeight(actor);
  let dx; let dy; let dz;
  if (targetPos) {
    const dist = Math.hypot(targetPos.x - actor.pos.x, targetPos.z - actor.pos.z);
    dx = (targetPos.x - actor.pos.x) / (dist || 1);
    dz = (targetPos.z - actor.pos.z) / (dist || 1);
    dy = 0.42 + dist * 0.012;
  } else {
    const yaw = actor.isPlayer ? controller.viewYaw() : actor.yaw;
    const pitch = actor.isPlayer ? controller.viewPitch() : actor.pitch;
    dx = -Math.sin(yaw) * Math.cos(pitch);
    dy = Math.sin(pitch) + 0.24;
    dz = -Math.cos(yaw) * Math.cos(pitch);
  }
  const power = 15.5;
  effects.throwGrenade(kind, actor.pos.x, eyeY, actor.pos.z, dx * power, dy * power, dz * power, actor);
  audio.throwIt();
}

function onGrenade(g) {
  const { x, y, z } = g.body.pos;
  const gy = y + 0.1;
  if (g.kind === 'he') {
    effects.explosion(x, gy, z);
    audio.explosion(x, z);
    world.noise.push({ x, z, t: simNow, team: g.owner ? g.owner.team : 0 });
    for (const a of actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.y + 0.9 - gy, a.pos.z - z);
      if (d > 5.4) continue;
      let dmg = 94 * (1 - (d / 5.4) * 0.78);
      const blocked = rayWorld(x, gy, z, (a.pos.x - x) / (d || 1), 0.2, (a.pos.z - z) / (d || 1), map.colliders) < d - 0.4;
      if (blocked) dmg *= 0.25;
      applyDamage(a, dmg, g.owner === a ? null : g.owner, 'body');
    }
    if (match.mode === 'range') {
      for (const t of range.targets) {
        if (!t.alive) continue;
        const d = Math.hypot(t.pos.x - x, t.pos.y + 0.9 - gy, t.pos.z - z);
        if (d > 5.4) continue;
        rangeHit(t, 94 * (1 - (d / 5.4) * 0.78), t.dist, 'body');
      }
    }
    if (player.alive && Math.hypot(player.pos.x - x, player.pos.z - z) < 13) shake = Math.min(0.6, shake + 0.3);
  } else {
    effects.impact(x, gy, z, 'spark');
    audio.flashPop(x, z);
    for (const a of actors) {
      if (!a.alive) continue;
      const dx = x - a.pos.x;
      const dz = z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 16) continue;
      const fx = -Math.sin(a.yaw);
      const fz = -Math.cos(a.yaw);
      const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      let dur = 0;
      if (dot > 0.25) dur = 3.4 * dot * (1 - d / 20);
      else if (d < 5) dur = 0.8;
      if (dur > 0.1) {
        const blocked = rayWorld(a.pos.x, a.pos.y + 1.4, a.pos.z, dx / (d || 1), 0, dz / (d || 1), map.colliders) < d - 0.3;
        if (!blocked) {
          a.flashBlindUntil = Math.max(a.flashBlindUntil, simNow + dur);
          a.blindTotal = dur;
        }
      }
    }
  }
}

// --- Actuation ---
let simNow = 0;
let skyClock = 0; // seconds since the last automatic sky change (continuous modes)
let playing = false;
let buyOpen = false;
let specActor = null;
let pendingPrimary = 'harrier'; // the deathmatch spawn pick, applied on respawn

function actuateBot(actor, dt) {
  const brain = actor.brain;
  const intent = actor.intent;
  const rate = brain.seen ? 13 : 8;
  let dy = intent.faceYaw - actor.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  actor.yaw += Math.max(-rate * dt, Math.min(rate * dt, dy));
  const dp = (intent.facePitch || 0) - actor.pitch;
  actor.pitch += Math.max(-9 * dt, Math.min(9 * dt, dp));
  actor.crouch = !!intent.crouch;
  const { def } = currentGun(actor.loadout);
  let speed = def.speed * 0.94;
  if (intent.fire) speed *= 0.4;
  if (actor.crouch) speed *= 0.36;
  stepLocomotion(actor, intent.moveX, intent.moveZ, speed, false, dt, map.colliders);
  if (intent.fire) tryFire(actor, simNow);
  if (!intent.fire) actor.semiLatch = false;
  const { held } = currentGun(actor.loadout);
  if (held.mag === 0 || (held.mag < def.mag * 0.3 && !brain.seen)) startReload(actor, simNow);
  if (actor.loadout.he > 0 && brain.seen && simNow - brain.lastSeenT < 0.3) {
    const d = Math.hypot(brain.seen.pos.x - actor.pos.x, brain.seen.pos.z - actor.pos.z);
    if (d > 9 && d < 23 && random() < 0.006) throwGrenade(actor, 'he', brain.seen.pos);
  }
}

function stepPlayer(dt) {
  const canMove = match.phase === 'live';
  controller.step(dt, input, map.colliders, canMove);
  player.intent.fire = input.state.firing && input.state.locked && !buyOpen;
  player.intent.channel = input.state.keys.has('KeyE');
  player.scoped = input.state.aiming && !!currentGun(player.loadout).def.zooms && player.alive;
  if (!player.intent.fire) player.semiLatch = false;
  if (player.intent.fire) tryFire(player, simNow);
}

function step(dt) {
  simNow += dt;
  for (const a of actors) a.bloom = Math.max(0, a.bloom - dt * 1.9);
  if (match.phase === 'live') {
    for (const bot of actors) if (!bot.isPlayer && bot.alive) stepBot(bot.brain, world, simNow, dt);
  }
  for (const bot of actors) if (!bot.isPlayer) actuateBot(bot, dt);
  if (player.alive) stepPlayer(dt);
  if (match.mode === 'range') stepRange(dt);
  effects.update(dt, map.colliders, onGrenade);
  match.step(dt);
  // The sky turns over every two minutes here; defusal turns it per round instead.
  if (match.mode !== 'defusal') {
    skyClock += dt;
    if (skyClock > 120) { skyClock = 0; sky.cycle(); }
  }
  drainEvents();
  while (world.noise.length && simNow - world.noise[0].t > 2.5) world.noise.shift();
  if (match.bombPlanted) {
    bombProp.blink(simNow, match.bombTimer < 10);
    const interval = match.bombTimer > 20 ? 1 : match.bombTimer > 10 ? 0.5 : 0.25;
    if (simNow - lastBeepAt > interval) { lastBeepAt = simNow; audio.beep(match.bombTimer < 10); }
  }
}

// --- Round events → HUD, audio, models ---
function bannerForRound() {
  const atk = player.team === 0;
  hud.banner(
    `ROUND ${match.round}`,
    atk ? 'Jackals attack — plant the charge or wipe the Wardens' : 'Wardens defend — hold the sites, defuse the charge',
    2400,
  );
}

function drainEvents() {
  for (const ev of match.events.splice(0)) {
    if (ev.type === 'modeStart') {
      skyClock = 0;
      hud.clearKillfeed();
      hud.setBomb(null);
      hud.setSpectate(null);
      bombProp.hide();
      world.ffa = ev.mode === 'ffa';
      if (ev.mode === 'range') {
        for (const bot of actors) if (!bot.isPlayer) bot.model.visible = false;
        resetRange();
        placePlayerAtLine();
        player.loadout.he = 99; player.loadout.flash = 99; player.loadout.armor = 0;
        player.loadout.sidearm.reserve = 9999;
        grantRangeGun('harrier');
        hud.banner('PRACTICE RANGE', 'Targets at 10 · 25 · 50 · 65 m — keys 1–9 switch guns, all free', 3200);
      } else {
        for (const bot of actors) {
          if (bot.isPlayer) continue;
          bot.model.visible = true;
          freePick(bot, random);
          setModelGun(bot, currentGun(bot.loadout).held.id);
        }
        const lo = player.loadout;
        lo.primary = { id: 'harrier', mag: WEAPONS.harrier.mag, reserve: WEAPONS.harrier.reserve };
        lo.current = 'primary';
        lo.armor = 1;
        pendingPrimary = 'harrier';
        showViewmodel('harrier');
        hud.banner(
          ev.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'FREE-FOR-ALL',
          ev.mode === 'tdm' ? 'First squad to 30 kills — pick your next gun while you are down' : 'Every fighter for themselves — first to 20 kills',
          3200,
        );
      }
    } else if (ev.type === 'respawn') {
      const a = ev.actor;
      if (a.isPlayer) {
        if (pendingPrimary && (!player.loadout.primary || player.loadout.primary.id !== pendingPrimary)) {
          player.loadout.primary = { id: pendingPrimary, mag: WEAPONS[pendingPrimary].mag, reserve: WEAPONS[pendingPrimary].reserve };
          player.loadout.current = 'primary';
        }
        showViewmodel(currentGun(player.loadout).held.id);
        hud.setSpectate(null);
      } else {
        freePick(a, random);
        setModelGun(a, currentGun(a.loadout).held.id);
      }
    } else if (ev.type === 'matchEnd') {
      hud.banner(
        match.mode === 'ffa' ? `${match.winnerName.toUpperCase()} HITS 20` : `${TEAM_NAMES[ev.winner].toUpperCase()} HIT 30`,
        match.mode === 'ffa' ? 'The free-for-all is decided' : 'The deathmatch is decided',
        3400,
      );
    } else if (ev.type === 'roundStart') {
      sky.cycle(); // a new round, a new sky
      hud.clearKillfeed();
      hud.setBomb(null);
      hud.setSpectate(null);
      bombProp.hide();
      for (const bot of actors) {
        if (bot.isPlayer) continue;
        botBuy(bot, random);
        setModelGun(bot, currentGun(bot.loadout).held.id);
      }
      showViewmodel(currentGun(player.loadout).held.id);
      bannerForRound();
    } else if (ev.type === 'go') {
      hud.banner('GO', '', 700);
    } else if (ev.type === 'halftime') {
      hud.banner('HALF TIME', 'Squads swap sides — purses and loadouts reset', 3200);
      for (const bot of actors) {
        if (bot.isPlayer) continue;
        scene.remove(bot.model);
        buildActorModel(bot);
        scene.add(bot.model);
        setModelGun(bot, currentGun(bot.loadout).held.id);
      }
    } else if (ev.type === 'planted') {
      hud.setBomb(ev.site);
      bombProp.show(ev.x, ev.z);
      hud.banner('CHARGE PLANTED', `Site ${ev.site} — ${TEAM_NAMES[1]} must defuse`, 2400);
      audio.plantDone();
    } else if (ev.type === 'detonate') {
      effects.explosion(ev.x, 1, ev.z);
      audio.explosion(ev.x, ev.z);
      bombProp.hide();
      for (const a of actors) {
        if (!a.alive) continue;
        const d = Math.hypot(a.pos.x - ev.x, a.pos.z - ev.z);
        if (d < 11) applyDamage(a, 150 * (1 - d / 13), null, 'body');
      }
      shake = 0.7;
    } else if (ev.type === 'roundEnd') {
      hud.setBomb(null);
      bombProp.hide();
      const won = ev.winner === player.team;
      const how = { elimination: 'by elimination', objective: 'the charge detonated', defuse: 'the charge was defused', time: 'time expired' }[ev.how];
      hud.banner(`${TEAM_NAMES[ev.winner].toUpperCase()} WIN`, `Round ${how} — ${ev.scores[0]} : ${ev.scores[1]}`, 3400);
      audio.roundEnd(won);
    } else if (ev.type === 'matchOver') {
      if (match.mode === 'tdm') {
        const playerWon = match.winner === player.team;
        hud.showOver(
          `${TEAM_NAMES[match.winner].toUpperCase()} WIN THE DEATHMATCH`,
          `Final score ${match.scores[0]} : ${match.scores[1]} kills. You scored ${player.kills} with ${player.deaths} deaths. ${playerWon ? 'Your squad takes it.' : 'Your squad loses it — run it back.'}`,
        );
      } else if (match.mode === 'ffa') {
        const rank = 1 + actors.filter((a) => a !== player && a.kills > player.kills).length;
        hud.showOver(
          match.winnerName === player.name ? 'YOU WIN THE FREE-FOR-ALL' : `${match.winnerName.toUpperCase()} WINS THE FREE-FOR-ALL`,
          `First to 20 kills. You placed #${rank} of 10 with ${player.kills} kills and ${player.deaths} deaths.`,
        );
      } else {
        const playerWon = match.winner === player.team;
        hud.showOver(
          `${TEAM_NAMES[match.winner].toUpperCase()} TAKE THE MATCH`,
          `Final score ${match.scores[0]} : ${match.scores[1]}. ${playerWon ? 'Your squad wins it.' : 'Your squad loses it — run it back.'}`,
        );
      }
      if (document.pointerLockElement) document.exitPointerLock();
      playing = false;
    }
  }
}

// --- Input wiring ---
hud.onPlay = (mode) => {
  audio.unlock();
  hud.hideMenu();
  hud.hideOver();
  match.startMode(mode || 'defusal');
  playing = true;
  input.requestLock();
};
hud.onResume = () => { hud.hidePause(); input.requestLock(); };
hud.onRestart = () => {
  hud.hidePause();
  hud.hideOver();
  match.startMode(match.mode);
  playing = true;
  input.requestLock();
};
hud.onMenu = () => {
  hud.hidePause();
  hud.hideOver();
  hud.hideLoadout();
  hud.setRange(null);
  hud.showMenu();
  playing = false;
};
hud.onPickGun = (id) => { pendingPrimary = id; };
hud.buildLoadout(['boar', 'krait', 'jackdaw', 'harrier', 'heron', 'oxen', 'lance'].map((id, i) => ({ id, key: String(i + 1) })));
hud.onBuy = (item) => {
  const err = match.tryBuy(player, item);
  if (err) { audio.denied(); hud.els.buyNote.textContent = err; }
  else {
    audio.buy();
    showViewmodel(currentGun(player.loadout).held.id);
    hud.refreshBuy(player, match.canBuy(player));
  }
};

function onLockChange(locked) {
  if (shot) return;
  if (!locked && playing && !buyOpen && match.phase !== 'matchover') hud.showPause();
  if (locked) hud.hidePause();
}

function toggleBuy(force) {
  const open = force !== undefined ? force : !buyOpen;
  if (open === buyOpen) return;
  if (open && match.mode !== 'defusal') return; // the purse exists only in defusal
  if (open && !match.canBuy(player) && match.phase !== 'freeze') return;
  buyOpen = open;
  if (buyOpen) {
    hud.refreshBuy(player, match.canBuy(player));
    hud.showBuy();
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hud.hideBuy();
    if (playing) input.requestLock();
  }
}

function handleKeys() {
  if (input.wasPressed('KeyB')) toggleBuy();
  if (buyOpen) {
    for (const { item, code } of BUY_ITEMS) {
      if (input.wasPressed(code)) hud.onBuy(item);
    }
    if (input.wasPressed('Escape')) toggleBuy(false);
    return;
  }
  if (input.wasPressed('KeyK')) { sky.cycle(); skyClock = 0; }
  if (!playing) return;
  if (match.mode === 'range') {
    for (let i = 0; i < RANGE_GUNS.length; i++) {
      if (input.wasPressed(`Digit${i + 1}`)) grantRangeGun(RANGE_GUNS[i]);
    }
  } else if (!player.alive && match.mode !== 'defusal') {
    const picks = ['boar', 'krait', 'jackdaw', 'harrier', 'heron', 'oxen', 'lance'];
    for (let i = 0; i < picks.length; i++) {
      if (input.wasPressed(`Digit${i + 1}`)) pendingPrimary = picks[i];
    }
  }
  if (input.wasPressed('KeyR')) startReload(player, simNow);
  const heldDef = currentGun(player.loadout).def;
  if (heldDef.zooms && heldDef.zooms.length > 1 &&
      (input.wasPressed('KeyX') || (input.state.wheel !== 0 && player.scoped))) {
    player.zoomIdx = ((player.zoomIdx || 0) + 1) % heldDef.zooms.length;
    input.state.wheel = 0;
    audio.draw();
  }
  if (input.wasPressed('Digit1') && player.loadout.primary) {
    player.loadout.current = 'primary';
    player.scoped = false;
    player.zoomIdx = 0;
    showViewmodel(player.loadout.primary.id);
    audio.draw();
  }
  if (input.wasPressed('Digit2')) {
    player.loadout.current = 'sidearm';
    player.scoped = false;
    player.zoomIdx = 0;
    showViewmodel(player.loadout.sidearm.id);
    audio.draw();
  }
  if (input.state.wheel !== 0 && match.mode !== 'range') {
    const toPrimary = player.loadout.current === 'sidearm' && player.loadout.primary;
    player.loadout.current = toPrimary ? 'primary' : 'sidearm';
    player.zoomIdx = 0;
    showViewmodel(currentGun(player.loadout).held.id);
    input.state.wheel = 0;
  }
  if (input.wasPressed('KeyG')) throwGrenade(player, 'he', null);
  if (input.wasPressed('KeyF')) throwGrenade(player, 'flash', null);
  if (input.state.keys.has('Tab')) { hud.renderBoard(actors, player); hud.showBoard(); }
  else hud.hideBoard();
}

// --- HUD sync ---
const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function syncHud() {
  const { held, def } = currentGun(player.loadout);
  hud.setHealth(player.health, player.loadout.armor);
  hud.setAmmo(player.reloading ? '—' : held.mag, held.reserve, def.name.toUpperCase());
  const mode = match.mode;
  hud.showMoney(mode === 'defusal');
  hud.setRange(mode === 'range' ? (range.last || 'TARGETS AT 10 · 25 · 50 · 65 M — KEYS 1–9 SWITCH GUNS') : null);
  if (mode === 'defusal') {
    hud.setLabels('JACKALS', 'WARDENS');
    hud.hideLoadout();
    hud.setScores(match.scores[0], match.scores[1], match.phase === 'matchover' ? 'FULL TIME' : `ROUND ${match.round} / 17`);
    if (match.bombPlanted) hud.setTimer(fmtTime(match.bombTimer), match.bombTimer < 10);
    else if (match.phase === 'freeze') hud.setTimer(fmtTime(match.phaseT), false);
    else hud.setTimer(fmtTime(match.roundTime), match.roundTime < 15);
    hud.setCarrier(match.carrier === player && !match.bombPlanted);
  } else if (mode === 'tdm' || mode === 'ffa') {
    if (mode === 'tdm') {
      hud.setLabels('JACKALS', 'WARDENS');
      hud.setScores(match.scores[0], match.scores[1], 'TEAM DEATHMATCH · FIRST TO 30');
    } else {
      hud.setLabels('YOU', 'LEADER');
      const leader = Math.max(0, ...actors.filter((a) => !a.isPlayer).map((a) => a.kills));
      hud.setScores(player.kills, leader, 'FREE-FOR-ALL · FIRST TO 20');
    }
    hud.setTimer(fmtTime(match.matchTime), false);
    hud.setCarrier(false);
    if (!player.alive && match.phase === 'live') hud.showLoadout(pendingPrimary);
    else hud.hideLoadout();
  } else {
    hud.setLabels('HITS', 'HEADSHOTS');
    hud.setScores(range.hits, range.hs, 'PRACTICE RANGE');
    hud.setTimer(fmtTime(match.matchTime), false);
    hud.setCarrier(false);
    hud.hideLoadout();
  }
  document.getElementById('nades').innerHTML =
    `FRAG <b>${player.loadout.he ? '●' : '○'}</b> · FLASH <b>${player.loadout.flash ? '●' : '○'}</b>`;
  const spread = spreadRadians(def, Math.min(1, player.speed2d / def.speed), !player.onGround, player.crouch, player.scoped, player.bloom);
  const px = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
  hud.setSpread(Math.max(3, Math.min(46, px * 0.55)));
  let prompt = null;
  if (mode !== 'defusal') { /* no prompts */ }
  else if (player.alive && match.phase === 'freeze') prompt = 'Buy phase — press <kbd>B</kbd> to equip';
  else if (player.alive && match.carrier === player && !match.bombPlanted && match.phase === 'live') {
    const inSite = map.sites.some((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < s.r);
    prompt = inSite ? 'Hold <kbd>E</kbd> to plant the charge' : 'You have the charge — reach site A or B';
  } else if (player.alive && match.bombPlanted && player.team === 1 && Math.hypot(player.pos.x - match.bombPos.x, player.pos.z - match.bombPos.z) < 2.2) {
    prompt = 'Hold <kbd>E</kbd> to defuse';
  }
  hud.prompt(prompt);
  if (match.channel) {
    const label = match.channel.kind === 'plant' ? `PLANTING — ${match.channel.actor.name}` : `DEFUSING — ${match.channel.actor.name}`;
    hud.channel(match.channel.progress / match.channel.need, label);
  } else hud.channel(null);
  if (player.flashBlindUntil > simNow) {
    const remain = player.flashBlindUntil - simNow;
    hud.setBlind(Math.min(1, remain / Math.max(0.4, (player.blindTotal || remain) * 0.55)));
  } else hud.setBlind(0);
  const ads = player.scoped && player.alive;
  hud.setScope(ads, def.optic, ads && def.zooms ? `${currentZoom(player, def)}×` : '');
}

// --- Camera and render ---
function syncCamera(dt) {
  if (player.alive) {
    controller.eyePos(camera.position);
    camera.rotation.set(controller.viewPitch(), controller.viewYaw(), 0, 'YXZ');
    specActor = null;
  } else {
    if (!specActor || !specActor.alive) {
      specActor = actors.find((a) => a !== player && a.alive && (a.team === player.team || match.mode === 'ffa')) || null;
    }
    if (specActor) {
      camera.position.set(specActor.pos.x, specActor.pos.y + eyeHeight(specActor), specActor.pos.z);
      camera.rotation.set(specActor.pitch, specActor.yaw, 0, 'YXZ');
    }
  }
  if (player.alive) camera.rotation.z += controller.lean; // strafe roll
  if (shake > 0.002) {
    camera.rotation.x += (random() * 2 - 1) * shake * 0.05;
    camera.rotation.z += (random() * 2 - 1) * shake * 0.04;
    shake *= Math.max(0, 1 - dt * 5);
  }
  const heldDef = currentGun(player.loadout).def;
  const targetFov = player.scoped && player.alive ? 74 / currentZoom(player, heldDef) : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  vmKick *= Math.max(0, 1 - dt * 9);
  vmKickZ *= Math.max(0, 1 - dt * 9);
  vmReloadDip = Math.max(0, vmReloadDip - dt * 1.4);
  let dYaw = controller.viewYaw() - lastViewYaw;
  if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const dPitch = controller.viewPitch() - lastViewPitch;
  lastViewYaw = controller.viewYaw();
  lastViewPitch = controller.viewPitch();
  const lagK = Math.min(1, dt * 10);
  vmLagYaw += (-dYaw * 1.6 - vmLagYaw) * lagK;
  vmLagPitch += (-dPitch * 1.6 - vmLagPitch) * lagK;
  const bobA = controller.bobAmount * (player.scoped ? 0.3 : 1);
  const bobY = Math.sin(controller.bobPhase * 2) * 0.008 * bobA;
  const bobX = Math.sin(controller.bobPhase) * 0.011 * bobA;
  viewmodel.position.set(
    0.235 + bobX + vmLagYaw * 0.35,
    -0.225 + bobY - vmReloadDip * 0.05 - controller.landDip * 0.05,
    -0.48 + vmKick,
  );
  viewmodel.rotation.set(
    vmKick * 1.9 - vmReloadDip * 0.5 + vmLagPitch * 2.2,
    vmLagYaw * 2.2,
    Math.sin(controller.bobPhase) * 0.012 * bobA + vmKickZ,
  );
  viewmodel.visible = player.alive && !(player.scoped && heldDef.optic === 'scope');
}

let accumulator = 0;
let lastTime = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  handleKeys();
  if (playing) {
    const look = input.takeLook();
    if (input.state.locked && player.alive) {
      const scale = player.scoped ? 1 / currentZoom(player, currentGun(player.loadout).def) : 1;
      controller.look(look.x, look.y, scale);
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  for (const a of actors) if (!a.isPlayer) poseActorModel(a, dt);
  for (const t of range.targets) {
    poseActorModel(t, dt);
    if (t.rockT > 0) {
      t.rockT = Math.max(0, t.rockT - dt);
      t.model.rotation.x -= Math.sin((t.rockT / 0.3) * Math.PI) * 0.16;
    }
  }
  syncCamera(dt);
  sky.update(dt);
  audio.setListener(player.pos.x, player.pos.z, controller.viewYaw());
  if (playing) syncHud();
  renderer.render(scene, camera);
}

// --- Staged screenshots ---
function faceToward(a, x, z) {
  a.yaw = Math.atan2(-(x - a.pos.x), -(z - a.pos.z));
  a.intent.faceYaw = a.yaw;
}
function place(a, x, z, tx, tz) {
  a.pos.x = x;
  a.pos.z = z;
  a.pos.y = 0;
  if (tx !== undefined) faceToward(a, tx, tz);
}

function stageShot(n) {
  hud.hideMenu();
  match.phase = 'live';
  const [vex, onyx, rurik] = [actors[5], actors[6], actors[7]];
  const ally = actors[1];

  if (n === 1) {
    place(player, -27.5, 1.5, -18.6, -4.9);
    player.pitch = -0.02;
    player.loadout.primary = { id: 'lance', mag: 4, reserve: 25 };
    player.loadout.current = 'primary';
    player.scoped = true;
    player.zoomIdx = 1; // the 5x level
    player.money = 3400;
    place(vex, -18.6, -4.9, player.pos.x, player.pos.z);
    setModelGun(vex, 'harrier');
    place(onyx, -16.8, -11.5, -19, -6);
    match.scores = [2, 1];
    match.round = 4;
    match.roundTime = 72;
  } else if (n === 2) {
    match.mode = 'tdm';
    match.matchTime = 203;
    sky.set(2, true); // sunset
    place(player, 27.5, 8.5, 19, 17);
    player.pitch = -0.03;
    player.loadout.primary = { id: 'oxen', mag: 84, reserve: 200 };
    player.loadout.current = 'primary';
    player.health = 68;
    player.money = 2900;
    place(ally, 25.2, 12.2, 17, 18.5);
    setModelGun(ally, 'jackdaw');
    const down = vex;
    place(down, 21.5, 15.8);
    down.alive = false;
    down.health = 0;
    down.deathT = 0.55;
    place(onyx, 16.5, 19.5, player.pos.x, player.pos.z);
    setModelGun(onyx, 'harrier');
    place(rurik, 24.8, 20.8, player.pos.x, player.pos.z);
    match.scores = [17, 12];
    hud.addKill('<span class="k0">You</span> ▸ MG-9 Oxen <span class="hs">HEADSHOT</span> ▸ <span class="k1">Koda</span>');
    hud.addKill('<span class="k0">Vex</span> ▸ BR-3 Jackdaw ▸ <span class="k1">Talon</span>');
    hud.hitmarker(false);
    const m1 = muzzlePos(player, new THREE.Vector3());
    effects.tracer(m1.x, m1.y, m1.z, 21.8, 1.1, 16.1);
    effects.muzzle(m1.x, m1.y, m1.z, true, (21.8 - m1.x) / 9, (1.1 - m1.y) / 9, (16.1 - m1.z) / 9);
    effects.impact(21.8, 1.1, 16.1, 'spark');
    const m2 = muzzlePos(onyx, new THREE.Vector3());
    effects.tracer(m2.x, m2.y, m2.z, 26.2, 1.3, 9.3);
    effects.muzzle(m2.x, m2.y, m2.z, false, (26.2 - m2.x) / 13, (1.3 - m2.y) / 13, (9.3 - m2.z) / 13);
    const m3 = muzzlePos(ally, new THREE.Vector3());
    effects.tracer(m3.x, m3.y, m3.z, 17.2, 1.2, 19.0);
    effects.muzzle(m3.x, m3.y, m3.z, false, (17.2 - m3.x) / 10, (1.2 - m3.y) / 10, (19.0 - m3.z) / 10);
    effects.impact(17.2, 1.2, 19.0, 'dust');
  } else if (n === 3) {
    match.phase = 'freeze';
    match.phaseT = 5;
    sky.set(3, true); // night — the lamps carry the yard
    place(player, -26, 20, -6, 0);
    player.loadout.primary = { id: 'harrier', mag: 30, reserve: 120 };
    player.loadout.current = 'primary';
    player.loadout.armor = 1;
    player.money = 4750;
    match.scores = [3, 2];
    match.round = 6;
    hud.refreshBuy(player, true);
    hud.showBuy();
    buyOpen = true;
  } else {
    match.mode = 'range';
    sky.set(1, true); // cloudy
    resetRange();
    placePlayerAtLine();
    player.loadout.primary = { id: 'harrier', mag: 27, reserve: 9999 };
    player.loadout.current = 'primary';
    player.loadout.he = 99;
    player.loadout.flash = 99;
    for (const bot of actors) if (!bot.isPlayer) bot.model.visible = false;
    const [t10, t25] = range.targets;
    t10.flashT = 0.18;
    t10.rockT = 0.22;
    t25.alive = false;
    t25.health = 0;
    t25.deathT = 0.7;
    range.hits = 23;
    range.hs = 7;
    range.last = 'HIT 58 DMG · 25 M · TARGET DOWN';
    hud.hitmarker(false);
  }

  if (player.scoped) {
    camera.fov = 74 / currentZoom(player, currentGun(player.loadout).def);
    camera.updateProjectionMatrix();
  }
  showViewmodel(currentGun(player.loadout).held.id);
  for (const a of actors) if (!a.isPlayer) poseActorModel(a, 0.001);
  for (const t of range.targets) {
    poseActorModel(t, 0.001);
    if (t.rockT > 0) t.model.rotation.x -= Math.sin((t.rockT / 0.3) * Math.PI) * 0.16;
  }
  syncHud();
  let painted = 0;
  (function paint() {
    requestAnimationFrame(paint);
    syncCamera(0.016);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) window.__shotReady = true;
  })();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) stageShot(Number(shot));
else {
  hud.showMenu();
  requestAnimationFrame(frame);
}
