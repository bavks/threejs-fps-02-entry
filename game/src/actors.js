import * as THREE from 'three';
import { PALETTE,TEAM_COLORS } from './palette.js';
import { makeBox,moveBody,rayBox } from './physics.js';
import { createLoadout,buildGunModel } from './weapons.js';

const STAND_H = 1.8;
const CROUCH_H = 1.34;

export function createActor(team,name,isPlayer) {
  return {
    team,name,isPlayer,
    pos:{ x:0,y:0,z:0 },
    vel:{ x:0,y:0,z:0 },
    radius:0.34,height:STAND_H,onGround:true,
    yaw:0,pitch:0,crouch:false,
    health:100,alive:true,
    loadout:createLoadout(),
    money:800,kills:0,deaths:0,
    nextShot:0,reloadUntil:0,bloom:0,scoped:false,triggerHeld:false,
    burstLeft:0,zoomIdx:0,
    semiLatch:false,lastShotAt:-9,flashBlindUntil:0,suppressedUntil:0,
    model:null,walkPhase:0,deathT:0,flashT:0,muzzleT:0,
    speed2d:0,
  };
}

export function eyeHeight(actor) {
  return actor.height - 0.16;
}

export function actorHitboxes(actor,out) {
  const top = actor.pos.y + actor.height;
  const headBase = actor.pos.y + actor.height * 0.76;
  out.body = makeBox(actor.pos.x,(actor.pos.y + headBase) / 2,actor.pos.z,0.68,headBase - actor.pos.y,0.68);
  out.head = makeBox(actor.pos.x,(headBase + top) / 2,actor.pos.z,0.34,top - headBase,0.34);
  return out;
}

const hitScratch = { body:null,head:null };
export function rayActor(ox,oy,oz,dx,dy,dz,actor) {
  actorHitboxes(actor,hitScratch);
  const tb = rayBox(ox,oy,oz,dx,dy,dz,hitScratch.body);
  const th = rayBox(ox,oy,oz,dx,dy,dz,hitScratch.head);
  if (th < tb) return { t:th,part:'head' };
  if (tb < Infinity) return { t:tb,part:'body' };
  return null;
}

export function stepLocomotion(actor,wishX,wishZ,speedMax,wantJump,dt,colliders) {
  const targetH = actor.crouch ? CROUCH_H :STAND_H;
  actor.height += (targetH - actor.height) * Math.min(1,dt * 12);
  const k = actor.onGround ? 11 :0.6;
  const blend = Math.min(1,k * dt);
  actor.vel.x += (wishX * speedMax - actor.vel.x) * blend;
  actor.vel.z += (wishZ * speedMax - actor.vel.z) * blend;
  if (wantJump && actor.onGround && !actor.crouch) {
    actor.vel.y = 4.9;
    actor.onGround = false;
  }
  if (!actor.onGround || actor.vel.y > 0) actor.vel.y -= 13.5 * dt;
  moveBody(actor,colliders,dt);
  actor.speed2d = Math.hypot(actor.vel.x,actor.vel.z);
}

const skinMat = new THREE.MeshStandardMaterial({ color:0xc9a186,roughness:0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color:0x2a2c2e,roughness:0.7,metalness:0.3 });

function part(mat,geo,x,y,z,rx = 0,sx = 1,sy = 1,sz = 1) {
  const m = new THREE.Mesh(geo,mat);
  m.position.set(x,y,z);
  m.rotation.x = rx;
  m.scale.set(sx,sy,sz);
  m.castShadow = true;
  return m;
}

export function buildActorModel(actor) {
  const teamMat = new THREE.MeshStandardMaterial({ color:TEAM_COLORS[actor.team],roughness:0.75 });
  const teamDark = new THREE.MeshStandardMaterial({ color:actor.team === 0 ? PALETTE.jackalDark :PALETTE.wardenDark,roughness:0.8 });
  const g = new THREE.Group();
  const legGeo = new THREE.CapsuleGeometry(0.08,0.62,4,14);
  legGeo.translate(0,-0.39,0);
  const bootGeo = new THREE.SphereGeometry(0.08,16,12);
  const kneeGeo = new THREE.SphereGeometry(0.07,14,10);
  const mkLeg = (x) => {
    const leg = part(teamDark,legGeo,x,0.78,0,0,1,1,1.19);
    leg.add(part(darkMat,bootGeo,0,-0.735,-0.03,0,1,0.55,1.1))
    leg.add(part(darkMat,kneeGeo,0,-0.4,-0.055,0,1,1,0.55))
    return leg;
  };
  const legL = mkLeg(-0.11);
  const legR = mkLeg(0.11);
  const torso = part(teamMat,new THREE.CapsuleGeometry(0.13,0.36,6,18),0,1.09,0,0,1.77);
  const vest = part(darkMat,new THREE.CapsuleGeometry(0.15,0.1,6,18),0,1.12,0,0,1.67);
  const shoulderGeo = new THREE.SphereGeometry(0.085,18,14);
  const shoulderL = part(teamMat,shoulderGeo,-0.255,1.33,0);
  const shoulderR = part(teamMat,shoulderGeo,0.255,1.33,0);
  const head = part(skinMat,new THREE.SphereGeometry(0.15,22,16),0,1.56,0,0,1,1.06);
  const visor = part(darkMat,new THREE.SphereGeometry(0.13,20,14),0,1.575,-0.07,0,1.05,0.4,0.75);
  const helmet = part(teamDark,new THREE.SphereGeometry(0.163,22,16),0,1.635,0,0,1,0.78);
  const brim = part(teamDark,new THREE.CylinderGeometry(0.168,0.168,0.022,24),0,1.615,0);
  const armPivot = new THREE.Group();
  armPivot.position.set(0.18,1.34,0);
  const arm = part(teamMat,new THREE.CapsuleGeometry(0.055,0.41,4,14).rotateX(Math.PI / 2),0,-0.02,-0.2);
  armPivot.add(arm);
  const gunMount = new THREE.Group();
  gunMount.position.set(-0.08,-0.02,-0.24);
  armPivot.add(gunMount);
  const armL = part(teamMat,new THREE.CapsuleGeometry(0.055,0.31,4,14),-0.29,1.12,-0.12,-0.7);
  g.add(legL,legR,torso,vest,shoulderL,shoulderR,head,visor,helmet,brim,armPivot,armL);
  g.userData = { legL,legR,torso,vest,head,helmet,armPivot,gunMount,teamMat };
  actor.model = g;
  return g;
}

export function setModelGun(actor,weaponId) {
  const mount = actor.model.userData.gunMount;
  while (mount.children.length) mount.remove(mount.children[0]);
  const gun = buildGunModel(weaponId);
  gun.scale.setScalar(1.15);
  mount.add(gun);
}

export function poseActorModel(actor,dt) {
  const g = actor.model;
  if (!g) return;
  const u = g.userData;
  g.position.set(actor.pos.x,actor.pos.y,actor.pos.z);
  g.rotation.set(0,actor.yaw,0);
  if (!actor.alive) {
    actor.deathT = Math.min(1,actor.deathT + dt * 2.6);
    g.rotation.x = -Math.PI / 2 * actor.deathT;
    g.position.y = actor.pos.y + 0.12 * actor.deathT;
    return;
  }
  actor.deathT = 0;
  const targetScaleY = actor.height / STAND_H;
  g.scale.y = targetScaleY;
  actor.walkPhase += actor.speed2d * dt * 1.9;
  const swing = Math.sin(actor.walkPhase) * Math.min(0.55,actor.speed2d * 0.11);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armPivot.rotation.x = actor.pitch;
  if (actor.flashT > 0) {
    actor.flashT -= dt;
    u.teamMat.emissive.setHex(0xaa2211);
    u.teamMat.emissiveIntensity = Math.max(0,actor.flashT * 6);
  } else {
    u.teamMat.emissiveIntensity = 0;
  }
}
