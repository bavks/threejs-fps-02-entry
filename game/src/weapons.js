// Weapons: nine guns, grenades, armour — data, maths, models.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  wren: { name: 'P9 Wren', slot: 'sidearm', price: 0, blurb: 'Standard sidearm — free and honest.', damage: 34, headMult: 4, rpm: 380, auto: false,
    mag: 12, reserve: 96, reload: 1.5, spread: 0.35, spreadMove: 2.4, spreadAir: 5.5, bloom: 0.3, recoil: 0.5, range: 20, minFactor: 0.45, pellets: 1, speed: 5.0 },
  magpie: { name: 'M7 Magpie', slot: 'sidearm', price: 700, blurb: 'Revolver — six heavy rounds.', damage: 62, headMult: 3, rpm: 150, auto: false,
    mag: 6, reserve: 36, reload: 2.6, spread: 0.5, spreadMove: 2.0, spreadAir: 5, bloom: 0.5, recoil: 1.9, range: 24, minFactor: 0.6, pellets: 1, speed: 5.0 },
  boar: { name: 'SG-8 Boar', slot: 'primary', price: 1100, blurb: 'Pump shotgun — eight pellets.', damage: 11, headMult: 2.4, rpm: 68, auto: false,
    mag: 6, reserve: 32, reload: 2.9, spread: 3.4, spreadMove: 1.2, spreadAir: 3, bloom: 0, recoil: 2.6, range: 9, minFactor: 0.2, pellets: 8, speed: 4.8 },
  krait: { name: 'Krait SMG', slot: 'primary', price: 1250, blurb: 'Fast on the move, weak at range.', damage: 26, headMult: 4, rpm: 820, auto: true,
    mag: 32, reserve: 128, reload: 2.1, spread: 0.85, spreadMove: 1.1, spreadAir: 4, bloom: 0.16, recoil: 0.34, range: 16, minFactor: 0.5, pellets: 1, speed: 5.1 },
  jackdaw: { name: 'BR-3 Jackdaw', slot: 'primary', price: 2300, blurb: 'Burst rifle — three-round stitch.', damage: 34, headMult: 4, rpm: 780, auto: false, burst: 3,
    mag: 30, reserve: 120, reload: 2.5, spread: 0.48, spreadMove: 2.2, spreadAir: 5.5, bloom: 0.14, recoil: 0.52, range: 25, minFactor: 0.55, pellets: 1, speed: 4.9 },
  harrier: { name: 'Harrier AR', slot: 'primary', price: 2700, blurb: 'The rifle, red-dot sight fitted.', damage: 36, headMult: 4, rpm: 660, auto: true,
    mag: 30, reserve: 120, reload: 2.4, spread: 0.42, spreadMove: 2.6, spreadAir: 6, bloom: 0.22, recoil: 0.46, range: 26, minFactor: 0.55, pellets: 1, speed: 4.9, zooms: [1.35], optic: 'dot' },
  heron: { name: 'DMR-6 Heron', slot: 'primary', price: 3100, blurb: 'Marksman rifle, 2.5x optic. Owns long lanes.', damage: 58, headMult: 3, rpm: 235, auto: false,
    mag: 12, reserve: 60, reload: 2.8, spread: 0.1, spreadMove: 3.4, spreadAir: 7, bloom: 0.4, recoil: 1.7, range: 46, minFactor: 0.78, pellets: 1, speed: 4.7, zooms: [2.5], optic: 'scope' },
  oxen: { name: 'MG-9 Oxen', slot: 'primary', price: 3400, blurb: 'Belt-fed LMG — plant your feet to aim it.', damage: 30, headMult: 4, rpm: 720, auto: true, heavy: true,
    mag: 100, reserve: 200, reload: 5.4, spread: 1.15, spreadMove: 3.6, spreadAir: 6.5, bloom: 0.3, recoil: 0.52, range: 24, minFactor: 0.5, pellets: 1, speed: 4.45 },
  lance: { name: 'Lance SR', slot: 'primary', price: 3500, blurb: 'Bolt-action. One body shot kills.', damage: 108, headMult: 2, rpm: 42, auto: false,
    mag: 5, reserve: 30, reload: 3.1, spread: 0.06, spreadMove: 4.5, spreadAir: 8, bloom: 0, recoil: 3.2, range: 60, minFactor: 0.85, pellets: 1, speed: 4.6, zooms: [2.5, 5], optic: 'scope' },
};
export const GRENADES = {
  he: { name: 'Frag Charge', price: 300, key: 'he', blurb: 'High explosive. Throw with G.' },
  flash: { name: 'Blind Charge', price: 200, key: 'flash', blurb: 'Blinds onlookers. Throw with F.' },
};
export const ARMOR = [
  { name: 'No armour', price: 0, factor: 1, headMultCap: 4, blurb: '' },
  { name: 'Kevlar Vest', price: 650, factor: 0.55, headMultCap: 4, blurb: 'Cuts damage taken by 45%.' },
  { name: 'Vest + Helmet', price: 1000, factor: 0.55, headMultCap: 2.2, blurb: 'Helmet caps headshot multipliers.' },
];

export function createLoadout() {
  return {
    primary: null,
    sidearm: { id: 'wren', mag: WEAPONS.wren.mag, reserve: WEAPONS.wren.reserve },
    current: 'sidearm',
    he: 0,
    flash: 0,
    armor: 0,
  };
}

export function currentGun(loadout) {
  const held = loadout.current === 'primary' && loadout.primary ? loadout.primary : loadout.sidearm;
  return { held, def: WEAPONS[held.id] };
}

export function damageAt(def, dist, part, armorTier) {
  let dmg = def.damage;
  if (dist > def.range) {
    const over = Math.min(1, (dist - def.range) / def.range);
    dmg *= 1 - over * (1 - def.minFactor);
  }
  if (part === 'head') dmg *= Math.min(def.headMult, ARMOR[armorTier].headMultCap);
  return dmg * ARMOR[armorTier].factor;
}

export function currentZoom(actor, def) {
  if (!def.zooms) return 1;
  return def.zooms[Math.min(actor.zoomIdx || 0, def.zooms.length - 1)];
}

export function spreadRadians(def, speedRatio, airborne, crouched, scoped, bloomDeg) {
  let deg = def.spread + bloomDeg;
  if (def.zooms && def.zooms[def.zooms.length - 1] >= 2 && !scoped) deg = Math.max(deg, 2.4); // scoped hip-fire is a guess
  deg += def.spreadMove * speedRatio;
  if (airborne) deg += def.spreadAir;
  if (crouched) deg *= 0.7;
  return (deg * Math.PI) / 180;
}

const gunMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.7 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 }),
  accent: new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.6 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.35, metalness: 0.8 }),
};

function put(g,geo,mat,x,y,z,rx = 0,sx = 1,sy = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.scale.set(sx, sy, 1);
  g.add(m);
  return m;
}
const tube = (r, l) => new THREE.CylinderGeometry(r, r, l, 20).rotateX(Math.PI / 2)
const rod = (r, l) => new THREE.CapsuleGeometry(r, Math.max(0.01, l - 2 * r), 4, 16).rotateX(Math.PI / 2)
const drop = (r, l) => new THREE.CapsuleGeometry(r, Math.max(0.01, l - 2 * r), 4, 16)
const pin = (r, l) => new THREE.CylinderGeometry(r, r, l, 12)
const ring = (r, t) => new THREE.TorusGeometry(r, t, 10, 28)
const ball = (r) => new THREE.SphereGeometry(r, 16, 12);

export function buildGunModel(id) {
  const g = new THREE.Group();
  const B = gunMats.body, K = gunMats.barrel, W = gunMats.grip, A = gunMats.accent;
  if (id === 'wren') {
    put(g,rod(0.035,0.21),B,0,0,0,0,0.64);
    put(g,tube(0.015,0.07),K,0,0.028,-0.13);
    put(g,drop(0.025,0.1),W,0,-0.075,0.055,0.25,0.8);
    put(g,ball(0.009),A,0,0.045,-0.05);
  } else if (id === 'magpie') {
    put(g,rod(0.03,0.3),B,0,0.01,-0.02,0,0.83);
    put(g,tube(0.016,0.16),K,0,0.02,-0.24);
    put(g,tube(0.011,0.14),K,0,-0.004,-0.235);
    put(g,tube(0.0295,0.075),B,0,-0.03,0);
    put(g,drop(0.026,0.105),W,0,-0.085,0.06,0.3,0.8);
    put(g,ball(0.009),A,0,0.048,-0.13);
  } else if (id === 'boar') {
    put(g,rod(0.04,0.4),B,0,0,-0.05,0,0.75);
    put(g,tube(0.0175,0.34),K,0,0.015,-0.38);
    put(g,tube(0.013,0.3),K,0,-0.024,-0.36);
    put(g,tube(0.027,0.14),W,0,0.012,-0.22);
    put(g,rod(0.045,0.18),W,0,-0.02,0.24,0,0.61);
  } else if (id === 'krait') {
    put(g,rod(0.045,0.34),B,0,0,-0.02,0,0.61);
    put(g,tube(0.015,0.16),K,0,0.01,-0.26);
    put(g,tube(0.021,0.05),K,0,0.01,-0.325);
    put(g,drop(0.025,0.13),B,0,-0.09,-0.02,0,0.7);
    put(g,drop(0.024,0.09),W,0,-0.07,0.1,0.25,0.83);
    put(g,rod(0.0125,0.1),A,0,0.058,-0.1,0,0.8);
  } else if (id === 'jackdaw') {
    put(g,rod(0.0425,0.44),B,0,0,-0.03,0,0.66);
    put(g,tube(0.03,0.2),W,0,0.005,-0.3);
    put(g,tube(0.013,0.1),K,0,0.012,-0.42);
    put(g,rod(0.014,0.3),B,0,0.068,-0.02);
    put(g,drop(0.027,0.13),B,0,-0.095,-0.01,0,0.67);
    put(g,drop(0.024,0.09),W,0,-0.07,0.11,0.25,0.83);
    put(g,rod(0.035,0.13),B,0,-0.01,0.26,0,0.71);
  } else if (id === 'heron') {
    put(g,rod(0.035,0.52),B,0,0,-0.06,0,0.71);
    put(g,tube(0.012,0.4),K,0,0.012,-0.5);
    put(g,tube(0.023,0.2),B,0,0.072,-0.1);
    put(g,tube(0.029,0.035),K,0,0.072,-0.19);
    put(g,tube(0.026,0.03),K,0,0.072,-0.015);
    put(g,ring(0.024,0.0035),K,0,0.072,-0.205);
    put(g,drop(0.025,0.11),B,0,-0.085,-0.06,0,0.68);
    put(g,drop(0.024,0.09),W,0,-0.07,0.1,0.25,0.83);
    put(g,rod(0.0375,0.2),W,0,-0.01,0.3,0,0.72);
    put(g,pin(0.006,0.07),K,0,-0.055,-0.44);
  } else if (id === 'oxen') {
    put(g,rod(0.05,0.46),B,0,0,-0.04,0,0.75);
    put(g,tube(0.017,0.32),K,0,0.015,-0.42);
    put(g,tube(0.027,0.18),K,0,0.015,-0.36);
    put(g,rod(0.055,0.16),B,0,-0.115,-0.05,0,0.82);
    put(g,rod(0.015,0.3),B,0,0.075,-0.02);
    put(g,drop(0.025,0.095),W,0,-0.07,0.13,0.25,0.84);
    put(g,rod(0.0375,0.15),B,0,-0.01,0.27,0,0.75);
    put(g,ball(0.01),A,0,0.048,-0.56);
  } else if (id === 'lance') {
    put(g,rod(0.035,0.5),B,0,0,-0.05,0,0.71);
    put(g,tube(0.0125,0.44),K,0,0.01,-0.48);
    put(g,tube(0.018,0.06),K,0,0.01,-0.67);
    put(g,tube(0.026,0.24),B,0,0.078,-0.08);
    put(g,tube(0.031,0.035),K,0,0.078,-0.21);
    put(g,tube(0.028,0.03),K,0,0.078,0.025);
    put(g,ring(0.027,0.004),K,0,0.078,-0.226);
    put(g,ball(0.011),K,0.042,0,0.05);
    put(g,rod(0.04,0.22),W,0,-0.02,0.3,0,0.69);
    put(g,drop(0.025,0.1),B,0,-0.08,-0.05,0,0.7);
  } else {
    put(g,rod(0.0425,0.42),B,0,0,-0.03,0,0.65);
    put(g,tube(0.027,0.15),W,0,0.008,-0.27);
    put(g,tube(0.014,0.2),K,0,0.012,-0.33);
    put(g,tube(0.017,0.05),K,0,0.012,-0.415);
    put(g,drop(0.0275,0.14),B,0,-0.095,0,-0.12,0.64);
    put(g,drop(0.024,0.09),W,0,-0.07,0.12,0.25,0.83);
    put(g,rod(0.035,0.14),B,0,-0.01,0.27,0,0.71);
    put(g,pin(0.005,0.028),B,0,0.052,-0.04);
    put(g,ring(0.02,0.005),B,0,0.072,-0.04);
    put(g,ball(0.005),A,0,0.072,-0.04);
  }
  return g;
}
