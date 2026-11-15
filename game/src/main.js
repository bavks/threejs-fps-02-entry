// IRONFALL — boot and the one loop. A fixed 60 Hz simulation (movement, bot brains, combat,
// grenades, the round machine) feeds a render at the display's rate (camera, models,
// viewmodel, effects). Combat is resolved here and shared: the player and every bot fire
// through tryFire, take damage through applyDamage and die through killActor, so one set of
// rules — spread, falloff, headshots, armour — governs everyone. ?shot=1..4 with &seed=N
// stages a deterministic scene for a screenshot instead of starting the menu.
import * as THREE from 'three';
import { PALETTE, TEAM_NAMES } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { rayWorld, rayBox } from './physics.js';
import { createActor, buildActorModel, setModelGun, poseActorModel, stepLocomotion, eyeHeight, rayActor } from './actors.js';
import { createBotAI, stepBot, botBuy } from './bots.js';
import { createMatch } from './rounds.js';
import { createInput } from './input.js';
import { createPlayerController } from './player.js';
import { WEAPONS, currentGun, damageAt, spreadRadians, buildGunModel } from './weapons.js';
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
renderer.toneMappingExposure = 1.06;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 34, 115);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 240);
scene.add(camera);

const map = createMap(scene, random);
const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene, glowTexture());
const bombProp = createBombProp(scene);

// --- Cast ---------------------------------------------------------------------
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
const world = { actors, colliders: map.colliders, map, noise: [], round: match, siteOf: match.siteOf, siteNodeOf: match.siteNodeOf };
const controller = createPlayerController(player);
const input = createInput(renderer.domElement, onLockChange);

// First-person viewmodel: one cached model per gun, swapped on the camera.
const viewmodel = new THREE.Group();
viewmodel.position.set(0.235, -0.225, -0.48);
camera.add(viewmodel);
const vmGuns = {};
let vmKick = 0;
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

// --- Combat -------------------------------------------------------------------
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
    hud.setSpectate('You are down — spectating a teammate until the round ends');
    hud.setScope(false);
  }
}

// One shot (or one pellet of several). Returns the point the round ended at.
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
  for (const other of actors) {
    if (other === actor || !other.alive || other.team === actor.team) continue;
    const hit = rayActor(actor.pos.x, eyeY, actor.pos.z, tmpDir.x, tmpDir.y, tmpDir.z, other);
    if (hit && hit.t < bestT) { bestT = hit.t; bestActor = other; bestPart = hit.part; }
  }
  const ex = actor.pos.x + tmpDir.x * bestT;
  const ey = eyeY + tmpDir.y * bestT;
  const ez = actor.pos.z + tmpDir.z * bestT;
  muzzlePos(actor, tmpOrigin);
  effects.tracer(tmpOrigin.x, tmpOrigin.y, tmpOrigin.z, ex, ey, ez);
  if (bestActor) {
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
  if (!def.auto && actor.semiLatch) return;
  if (held.mag <= 0) {
    startReload(actor, now);
    if (actor.isPlayer) audio.dryFire();
    actor.nextShot = now + 0.3;
    return;
  }
  held.mag -= 1;
  actor.semiLatch = true;
  actor.nextShot = now + 60 / def.rpm;
  actor.lastShotAt = now;
  actor.bloom = Math.min(2.2, actor.bloom + def.bloom);
  for (let p = 0; p < def.pellets; p++) fireOne(actor, def, now);
  muzzlePos(actor, tmpOrigin);
  effects.muzzle(tmpOrigin.x, tmpOrigin.y, tmpOrigin.z, def.pellets > 1 || def.damage > 60);
  audio.shot(held.id, actor.isPlayer ? undefined : actor.pos.x, actor.isPlayer ? undefined : actor.pos.z);
  world.noise.push({ x: actor.pos.x, z: actor.pos.z, t: now, team: actor.team });
  if (actor.isPlayer) {
    controller.kick(def.recoil * 0.55, (random() * 2 - 1) * def.recoil * 0.22);
    vmKick = Math.min(0.09, vmKick + 0.03 + def.recoil * 0.008);
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
      // Walls take the edge off.
      const blocked = rayWorld(x, gy, z, (a.pos.x - x) / (d || 1), 0.2, (a.pos.z - z) / (d || 1), map.colliders) < d - 0.4;
      if (blocked) dmg *= 0.25;
      applyDamage(a, dmg, g.owner === a ? null : g.owner, 'body');
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

// --- Actuation ------------------------------------------------------------------
let simNow = 0;
let playing = false;
let buyOpen = false;
let specActor = null;

function actuateBot(actor, dt) {
  const brain = actor.brain;
  const intent = actor.intent;
  // Turn toward the brain's facing at a human rate, faster with a live target.
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
  // Bots reload when the magazine runs dry or a lull lets them.
  const { held } = currentGun(actor.loadout);
  if (held.mag === 0 || (held.mag < def.mag * 0.3 && !brain.seen)) startReload(actor, simNow);
  // A bot with a frag and a fresh sighting sometimes leads with it.
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
  player.scoped = input.state.aiming && currentGun(player.loadout).def.zoom > 1 && player.alive;
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
  effects.update(dt, map.colliders, onGrenade);
  match.step(dt);
  drainEvents();
  while (world.noise.length && simNow - world.noise[0].t > 2.5) world.noise.shift();
  if (match.bombPlanted) {
    bombProp.blink(simNow, match.bombTimer < 10);
    const interval = match.bombTimer > 20 ? 1 : match.bombTimer > 10 ? 0.5 : 0.25;
    if (simNow - lastBeepAt > interval) { lastBeepAt = simNow; audio.beep(match.bombTimer < 10); }
  }
}

// --- Round events → HUD, audio, models -------------------------------------------
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
    if (ev.type === 'roundStart') {
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
      const playerWon = match.winner === player.team;
      hud.showOver(
        `${TEAM_NAMES[match.winner].toUpperCase()} TAKE THE MATCH`,
        `Final score ${match.scores[0]} : ${match.scores[1]}. ${playerWon ? 'Your squad wins it.' : 'Your squad loses it — run it back.'}`,
      );
      if (document.pointerLockElement) document.exitPointerLock();
      playing = false;
    }
  }
}

// --- Input wiring -----------------------------------------------------------------
hud.onPlay = () => {
  audio.unlock();
  hud.hideMenu();
  match.startMatch();
  playing = true;
  input.requestLock();
};
hud.onResume = () => { hud.hidePause(); input.requestLock(); };
hud.onRestart = () => {
  hud.hidePause();
  hud.hideOver();
  match.startMatch();
  playing = true;
  input.requestLock();
};
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
    for (const { item, key } of BUY_ITEMS) {
      if (input.wasPressed('Digit' + key)) hud.onBuy(item);
    }
    if (input.wasPressed('Escape')) toggleBuy(false);
    return;
  }
  if (!playing) return;
  if (input.wasPressed('KeyR')) startReload(player, simNow);
  if (input.wasPressed('Digit1') && player.loadout.primary) {
    player.loadout.current = 'primary';
    player.scoped = false;
    showViewmodel(player.loadout.primary.id);
    audio.draw();
  }
  if (input.wasPressed('Digit2')) {
    player.loadout.current = 'sidearm';
    player.scoped = false;
    showViewmodel('wren');
    audio.draw();
  }
  if (input.state.wheel !== 0) {
    const toPrimary = player.loadout.current === 'sidearm' && player.loadout.primary;
    player.loadout.current = toPrimary ? 'primary' : 'sidearm';
    showViewmodel(currentGun(player.loadout).held.id);
    input.state.wheel = 0;
  }
  if (input.wasPressed('KeyG')) throwGrenade(player, 'he', null);
  if (input.wasPressed('KeyF')) throwGrenade(player, 'flash', null);
  // Tab shows the scoreboard while held.
  if (input.state.keys.has('Tab')) { hud.renderBoard(actors, player); hud.showBoard(); }
  else hud.hideBoard();
}

// --- HUD sync -----------------------------------------------------------------------
const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function syncHud() {
  const { held, def } = currentGun(player.loadout);
  hud.setHealth(player.health, player.loadout.armor);
  hud.setAmmo(player.reloading ? '—' : held.mag, held.reserve, def.name.toUpperCase());
  hud.setMoney(player.money);
  hud.setScores(match.scores[0], match.scores[1], match.phase === 'matchover' ? 'FULL TIME' : `ROUND ${match.round} / 17`);
  if (match.bombPlanted) hud.setTimer(fmtTime(match.bombTimer), match.bombTimer < 10);
  else if (match.phase === 'freeze') hud.setTimer(fmtTime(match.phaseT), false);
  else hud.setTimer(fmtTime(match.roundTime), match.roundTime < 15);
  hud.setCarrier(match.carrier === player && !match.bombPlanted);
  document.getElementById('nades').innerHTML =
    `FRAG <b>${player.loadout.he ? '●' : '○'}</b> · FLASH <b>${player.loadout.flash ? '●' : '○'}</b>`;
  const spread = spreadRadians(def, Math.min(1, player.speed2d / def.speed), !player.onGround, player.crouch, player.scoped, player.bloom);
  const px = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
  hud.setSpread(Math.max(3, Math.min(46, px * 0.55)));
  // Prompts.
  let prompt = null;
  if (player.alive && match.phase === 'freeze') prompt = 'Buy phase — press <kbd>B</kbd> to equip';
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
  // Blindness: white-out that fades over the last stretch.
  if (player.flashBlindUntil > simNow) {
    const remain = player.flashBlindUntil - simNow;
    hud.setBlind(Math.min(1, remain / Math.max(0.4, (player.blindTotal || remain) * 0.55)));
  } else hud.setBlind(0);
  hud.setScope(player.scoped && player.alive);
}

// --- Camera and render ---------------------------------------------------------------
function syncCamera(dt) {
  if (player.alive) {
    controller.eyePos(camera.position);
    camera.rotation.set(controller.viewPitch(), controller.viewYaw(), 0, 'YXZ');
    specActor = null;
  } else {
    // Spectate the first living teammate from their eyes.
    if (!specActor || !specActor.alive) specActor = actors.find((a) => a !== player && a.team === player.team && a.alive) || null;
    if (specActor) {
      camera.position.set(specActor.pos.x, specActor.pos.y + eyeHeight(specActor), specActor.pos.z);
      camera.rotation.set(specActor.pitch, specActor.yaw, 0, 'YXZ');
    }
  }
  if (shake > 0.002) {
    camera.rotation.x += (random() * 2 - 1) * shake * 0.05;
    camera.rotation.z += (random() * 2 - 1) * shake * 0.04;
    shake *= Math.max(0, 1 - dt * 5);
  }
  const targetFov = player.scoped && player.alive ? 74 / currentGun(player.loadout).def.zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  // Viewmodel life: kick, reload dip, bob, and a sway against look.
  vmKick *= Math.max(0, 1 - dt * 11);
  vmReloadDip = Math.max(0, vmReloadDip - dt * 1.4);
  const bobY = Math.sin(controller.bobPhase * 2) * 0.008 * controller.bobAmount;
  viewmodel.position.set(0.235, -0.225 + bobY - vmReloadDip * 0.05, -0.48 + vmKick);
  viewmodel.rotation.x = vmKick * 1.4 - vmReloadDip * 0.5;
  viewmodel.visible = player.alive;
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
    if (input.state.locked && player.alive) controller.look(look.x, look.y);
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
  syncCamera(dt);
  audio.setListener(player.pos.x, player.pos.z, controller.viewYaw());
  if (playing) syncHud();
  renderer.render(scene, camera);
}

// --- Staged screenshots ---------------------------------------------------------
// ?shot=1..4 freezes one deterministic, photogenic frame: the sim never runs, actors are
// placed and posed by hand, live effects are fired once, and the frame is painted twice
// before window.__shotReady is set for the capture harness.
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
  const [vex, onyx, rurik, sable] = [actors[5], actors[6], actors[7], actors[8]];
  const ally = actors[1];

  if (n === 1) {
    // Down A-long toward the furnace door: two Wardens holding it, an ally on the flank.
    place(player, -27.5, 1.5, -19, -5);
    player.pitch = -0.03;
    player.loadout.primary = { id: 'harrier', mag: 25, reserve: 90 };
    player.loadout.current = 'primary';
    player.money = 3400;
    place(ally, -25.2, 3.4, -19, -5);
    setModelGun(ally, 'harrier');
    place(vex, -19.5, -4.6, player.pos.x, player.pos.z);
    setModelGun(vex, 'harrier');
    place(onyx, -16.8, -11.5, -19, -6);
    match.scores = [2, 1];
    match.round = 4;
    match.roundTime = 72;
  } else if (n === 2) {
    // A firefight in the rail yard: one Warden down, one returning fire, an ally pushing.
    place(player, 13, 8.6, 21, 15);
    player.pitch = -0.02;
    player.loadout.primary = { id: 'harrier', mag: 17, reserve: 90 };
    player.loadout.current = 'primary';
    player.health = 68;
    player.money = 2900;
    place(ally, 15.6, 12.6, 24, 20);
    setModelGun(ally, 'krait');
    const down = vex;
    place(down, 20.6, 14.2);
    down.alive = false;
    down.health = 0;
    down.deathT = 0.55;
    place(onyx, 26.5, 11.8, player.pos.x, player.pos.z);
    setModelGun(onyx, 'harrier');
    place(rurik, 24.5, 21.5, player.pos.x, player.pos.z);
    match.scores = [3, 2];
    match.round = 5;
    match.roundTime = 54;
    hud.addKill('<span class="k0">You</span> ▸ Harrier AR <span class="hs">HEADSHOT</span> ▸ <span class="k1">Vex</span>');
    hud.addKill('<span class="k0">Onyx</span> ▸ Krait SMG ▸ <span class="k1">Rurik</span>');
    hud.hitmarker(false);
    // Live fire, frozen at the flash: player and Onyx trade rounds, the ally sprays the yard.
    const m1 = muzzlePos(player, new THREE.Vector3());
    effects.tracer(m1.x, m1.y, m1.z, 20.9, 1.25, 14.3);
    effects.muzzle(m1.x, m1.y, m1.z, false);
    effects.impact(20.9, 1.25, 14.3, 'spark');
    const m2 = muzzlePos(onyx, new THREE.Vector3());
    effects.tracer(m2.x, m2.y, m2.z, 14.2, 1.35, 9.4);
    effects.muzzle(m2.x, m2.y, m2.z, false);
    const m3 = muzzlePos(ally, new THREE.Vector3());
    effects.tracer(m3.x, m3.y, m3.z, 23.8, 1.1, 19.8);
    effects.impact(23.8, 1.1, 19.8, 'dust');
    void sable;
  } else if (n === 3) {
    // The buy menu over spawn, freeze time: a rifle and a vest already owned.
    match.phase = 'freeze';
    match.phaseT = 5;
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
    // The charge is down at A: a Warden defuses under cover, the player holds the door.
    player.team = 1;
    place(player, -14.8, -9.6, -19, -13.2);
    player.pitch = -0.04;
    player.loadout.sidearm.mag = 9;
    player.health = 84;
    player.money = 2100;
    const defuser = vex;
    place(defuser, -18.5, -12.8, -19.3, -13.3);
    defuser.crouch = true;
    defuser.height = 1.34;
    place(onyx, -16, -18.5, -17, -9);
    const jackal = ally;
    jackal.team = 0;
    place(jackal, -24.5, -10.5, -15, -10);
    setModelGun(jackal, 'harrier');
    match.bombPlanted = true;
    match.bombSite = 'A';
    match.bombPos.x = -19.3;
    match.bombPos.z = -13.3;
    match.bombTimer = 23;
    match.scores = [5, 4];
    match.round = 10;
    bombProp.show(-19.3, -13.3);
    hud.setBomb('A');
    hud.channel(0.62, 'DEFUSING — Vex');
  }

  showViewmodel(currentGun(player.loadout).held.id);
  for (const a of actors) if (!a.isPlayer) poseActorModel(a, 0.001);
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
