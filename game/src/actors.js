// Actors: every combatant — the player and the nine bots — is one of these. An actor owns
// its physics body, health, loadout, score line and (for bots) a low-poly humanoid model in
// team colours with a separate head, so a headshot is a place, not a dice roll. Locomotion
// lives here too: the same accelerate/friction/crouch/jump step drives the player from input
// and the bots from their steering, so both play by identical movement rules.
import * as THREE from 'three';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { makeBox, moveBody, rayBox } from './physics.js';
import { createLoadout, buildGunModel } from './weapons.js';

const STAND_H = 1.8;
const CROUCH_H = 1.34;

export function createActor(team, name, isPlayer) {
  return {
    team, name, isPlayer,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    radius: 0.34, height: STAND_H, onGround: true,
    yaw: 0, pitch: 0, crouch: false,
    health: 100, alive: true,
    loadout: createLoadout(),
    money: 800, kills: 0, deaths: 0,
    // combat state
    nextShot: 0, reloadUntil: 0, bloom: 0, scoped: false, triggerHeld: false,
    burstLeft: 0, zoomIdx: 0,
    semiLatch: false, lastShotAt: -9, flashBlindUntil: 0, suppressedUntil: 0,
    // presentation
    model: null, walkPhase: 0, deathT: 0, flashT: 0, muzzleT: 0,
    speed2d: 0,
  };
}

export function eyeHeight(actor) {
  return actor.height - 0.16;
}

// The two hitboxes, rebuilt from the actor's current pose. Head is its own box above the
// shoulders; crouching lowers both.
export function actorHitboxes(actor, out) {
  const top = actor.pos.y + actor.height;
  const headBase = actor.pos.y + actor.height * 0.76;
  out.body = makeBox(actor.pos.x, (actor.pos.y + headBase) / 2, actor.pos.z, 0.68, headBase - actor.pos.y, 0.68);
  out.head = makeBox(actor.pos.x, (headBase + top) / 2, actor.pos.z, 0.34, top - headBase, 0.34);
  return out;
}

// Ray vs one actor: returns { t, part } for the nearer of body/head, or null.
const hitScratch = { body: null, head: null };
export function rayActor(ox, oy, oz, dx, dy, dz, actor) {
  actorHitboxes(actor, hitScratch);
  const tb = rayBox(ox, oy, oz, dx, dy, dz, hitScratch.body);
  const th = rayBox(ox, oy, oz, dx, dy, dz, hitScratch.head);
  if (th < tb) return { t: th, part: 'head' };
  if (tb < Infinity) return { t: tb, part: 'body' };
  return null;
}

// One fixed step of movement. wishX/wishZ is a normalised direction in world space;
// speedMax already accounts for the held weapon and crouching.
export function stepLocomotion(actor, wishX, wishZ, speedMax, wantJump, dt, colliders) {
  const targetH = actor.crouch ? CROUCH_H : STAND_H;
  actor.height += (targetH - actor.height) * Math.min(1, dt * 12);
  const k = actor.onGround ? 11 : 0.6; // ground: snappy accel and friction; air: a nudge
  const blend = Math.min(1, k * dt);
  actor.vel.x += (wishX * speedMax - actor.vel.x) * blend;
  actor.vel.z += (wishZ * speedMax - actor.vel.z) * blend;
  if (wantJump && actor.onGround && !actor.crouch) {
    actor.vel.y = 4.9;
    actor.onGround = false;
  }
  if (!actor.onGround || actor.vel.y > 0) actor.vel.y -= 13.5 * dt;
  moveBody(actor, colliders, dt);
  actor.speed2d = Math.hypot(actor.vel.x, actor.vel.z);
}

// --- Bot models ---------------------------------------------------------------
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7, metalness: 0.3 });

function limb(mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// A soldier from boxes: legs that swing, a team-colour torso, a dark vest, helmet, and a gun
// carried in both hands at the aim pitch. Built once per bot and posed every frame.
export function buildActorModel(actor) {
  const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[actor.team], roughness: 0.75 });
  const teamDark = new THREE.MeshStandardMaterial({ color: actor.team === 0 ? PALETTE.jackalDark : PALETTE.wardenDark, roughness: 0.8 });
  const g = new THREE.Group();
  const legL = limb(teamDark, 0.16, 0.78, 0.19, -0.11, 0.39, 0);
  const legR = limb(teamDark, 0.16, 0.78, 0.19, 0.11, 0.39, 0);
  legL.geometry.translate(0, -0.39, 0); legL.position.y = 0.78;
  legR.geometry.translate(0, -0.39, 0); legR.position.y = 0.78;
  const torso = limb(teamMat, 0.46, 0.62, 0.26, 0, 1.09, 0);
  const vest = limb(darkMat, 0.5, 0.4, 0.3, 0, 1.12, 0);
  const head = limb(skinMat, 0.26, 0.28, 0.26, 0, 1.56, 0);
  const helmet = limb(teamDark, 0.32, 0.13, 0.32, 0, 1.71, 0);
  const armPivot = new THREE.Group();
  armPivot.position.set(0.18, 1.34, 0);
  const arm = limb(teamMat, 0.11, 0.11, 0.52, 0, -0.02, -0.2);
  armPivot.add(arm);
  const gunMount = new THREE.Group();
  gunMount.position.set(0.1, 1.32, -0.18);
  armPivot.add(gunMount);
  const armL = limb(teamMat, 0.11, 0.42, 0.11, -0.29, 1.12, -0.12);
  armL.rotation.x = -0.7;
  g.add(legL, legR, torso, vest, head, helmet, armPivot, armL);
  g.userData = { legL, legR, torso, vest, head, helmet, armPivot, gunMount, teamMat };
  actor.model = g;
  return g;
}

export function setModelGun(actor, weaponId) {
  const mount = actor.model.userData.gunMount;
  while (mount.children.length) mount.remove(mount.children[0]);
  const gun = buildGunModel(weaponId);
  gun.scale.setScalar(1.15);
  mount.add(gun);
}

// Pose the model from the actor's state: position, facing, walk swing, aim pitch, hit flash,
// and the fall when dead. Called in the render step, never in the fixed simulation.
export function poseActorModel(actor, dt) {
  const g = actor.model;
  if (!g) return;
  const u = g.userData;
  g.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
  g.rotation.set(0, actor.yaw, 0);
  if (!actor.alive) {
    actor.deathT = Math.min(1, actor.deathT + dt * 2.6);
    g.rotation.x = -Math.PI / 2 * actor.deathT;
    g.position.y = actor.pos.y + 0.12 * actor.deathT;
    return;
  }
  actor.deathT = 0;
  const targetScaleY = actor.height / STAND_H;
  g.scale.y = targetScaleY;
  actor.walkPhase += actor.speed2d * dt * 1.9;
  const swing = Math.sin(actor.walkPhase) * Math.min(0.55, actor.speed2d * 0.11);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armPivot.rotation.x = actor.pitch;
  if (actor.flashT > 0) {
    actor.flashT -= dt;
    u.teamMat.emissive.setHex(0xaa2211);
    u.teamMat.emissiveIntensity = Math.max(0, actor.flashT * 6);
  } else {
    u.teamMat.emissiveIntensity = 0;
  }
}
