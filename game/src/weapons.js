// Weapons: nine guns with distinct jobs, plus two grenades and two armour tiers. The numbers
// are the game: a headshot multiplies damage, damage falls off past a gun's range, and spread
// (in degrees, converted where it is used) grows with movement, air time and sustained fire —
// so stopping, crouching and bursting are how you hit things. Firing itself is resolved by
// main.js with physics.rayWorld; this module owns the data, the maths and the gun models.
// Optics: a gun with `zooms` can be aimed with RMB. `optic: 'dot'` is an open reflex sight
// (low zoom, sight picture stays open); `optic: 'scope'` is a closed tube (circular lens,
// mil-dots). The Lance carries two zoom levels, toggled with X or the wheel while aiming.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  wren: {
    name: 'P9 Wren', slot: 'sidearm', price: 0, blurb: 'Standard sidearm. Free, honest, outclassed.', damage: 34, headMult: 4, rpm: 380, auto: false,
    mag: 12, reserve: 96, reload: 1.5, spread: 0.35, spreadMove: 2.4, spreadAir: 5.5, bloom: 0.3,
    recoil: 0.5, range: 20, minFactor: 0.45, pellets: 1, speed: 5.0,
  },
  magpie: {
    name: 'M7 Magpie', slot: 'sidearm', price: 700, blurb: 'Revolver. Six heavy rounds — a pocket cannon that kicks like one.', damage: 62, headMult: 3, rpm: 150, auto: false,
    mag: 6, reserve: 36, reload: 2.6, spread: 0.5, spreadMove: 2.0, spreadAir: 5, bloom: 0.5,
    recoil: 1.9, range: 24, minFactor: 0.6, pellets: 1, speed: 5.0,
  },
  boar: {
    name: 'SG-8 Boar', slot: 'primary', price: 1100, blurb: 'Pump shotgun. Eight pellets settle close arguments.', damage: 11, headMult: 2.4, rpm: 68, auto: false,
    mag: 6, reserve: 32, reload: 2.9, spread: 3.4, spreadMove: 1.2, spreadAir: 3, bloom: 0,
    recoil: 2.6, range: 9, minFactor: 0.2, pellets: 8, speed: 4.8,
  },
  krait: {
    name: 'Krait SMG', slot: 'primary', price: 1250, blurb: 'Fast, light, forgiving on the move. Weak at range.', damage: 26, headMult: 4, rpm: 820, auto: true,
    mag: 32, reserve: 128, reload: 2.1, spread: 0.85, spreadMove: 1.1, spreadAir: 4, bloom: 0.16,
    recoil: 0.34, range: 16, minFactor: 0.5, pellets: 1, speed: 5.1,
  },
  jackdaw: {
    name: 'BR-3 Jackdaw', slot: 'primary', price: 2300, blurb: 'Burst rifle. Three-round bursts stitch a chest or a head.', damage: 34, headMult: 4, rpm: 780, auto: false, burst: 3,
    mag: 30, reserve: 120, reload: 2.5, spread: 0.48, spreadMove: 2.2, spreadAir: 5.5, bloom: 0.14,
    recoil: 0.52, range: 25, minFactor: 0.55, pellets: 1, speed: 4.9,
  },
  harrier: {
    name: 'Harrier AR', slot: 'primary', price: 2700, blurb: 'The rifle, with a red-dot sight. Lethal to the head, the default buy.', damage: 36, headMult: 4, rpm: 660, auto: true,
    mag: 30, reserve: 120, reload: 2.4, spread: 0.42, spreadMove: 2.6, spreadAir: 6, bloom: 0.22,
    recoil: 0.46, range: 26, minFactor: 0.55, pellets: 1, speed: 4.9, zooms: [1.35], optic: 'dot',
  },
  heron: {
    name: 'DMR-6 Heron', slot: 'primary', price: 3100, blurb: 'Semi-auto marksman rifle, 2.5x optic. Owns the long lanes.', damage: 58, headMult: 3, rpm: 235, auto: false,
    mag: 12, reserve: 60, reload: 2.8, spread: 0.1, spreadMove: 3.4, spreadAir: 7, bloom: 0.4,
    recoil: 1.7, range: 46, minFactor: 0.78, pellets: 1, speed: 4.7, zooms: [2.5], optic: 'scope',
  },
  oxen: {
    name: 'MG-9 Oxen', slot: 'primary', price: 3400, blurb: 'Belt-fed LMG. A hundred rounds of go-away; plant your feet to aim it.', damage: 30, headMult: 4, rpm: 720, auto: true, heavy: true,
    mag: 100, reserve: 200, reload: 5.4, spread: 1.15, spreadMove: 3.6, spreadAir: 6.5, bloom: 0.3,
    recoil: 0.52, range: 24, minFactor: 0.5, pellets: 1, speed: 4.45,
  },
  lance: {
    name: 'Lance SR', slot: 'primary', price: 3500, blurb: 'Bolt-action. One body shot kills; X toggles the 2.5x/5x scope.', damage: 108, headMult: 2, rpm: 42, auto: false,
    mag: 5, reserve: 30, reload: 3.1, spread: 0.06, spreadMove: 4.5, spreadAir: 8, bloom: 0,
    recoil: 3.2, range: 60, minFactor: 0.85, pellets: 1, speed: 4.6, zooms: [2.5, 5], optic: 'scope',
  },
};
export const GRENADES = {
  he: { name: 'Frag Charge', price: 300, key: 'he', blurb: 'High explosive. Clears corners and site plants. Throw with G.' },
  flash: { name: 'Blind Charge', price: 200, key: 'flash', blurb: 'Blinds anyone looking at it. Throw with F.' },
};
export const ARMOR = [
  { name: 'No armour', price: 0, factor: 1, headMultCap: 4, blurb: '' },
  { name: 'Kevlar Vest', price: 650, factor: 0.55, headMultCap: 4, blurb: 'Body armour. Cuts all damage taken by 45%.' },
  { name: 'Vest + Helmet', price: 1000, factor: 0.55, headMultCap: 2.2, blurb: 'Vest plus helmet. Headshots lose most of their multiplier.' },
];

// A fresh inventory: everyone starts every half with the Wren and nothing else.
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

// Damage after range falloff, the head multiplier (capped by a helmet) and armour.
export function damageAt(def, dist, part, armorTier) {
  let dmg = def.damage;
  if (dist > def.range) {
    const over = Math.min(1, (dist - def.range) / def.range);
    dmg *= 1 - over * (1 - def.minFactor);
  }
  if (part === 'head') dmg *= Math.min(def.headMult, ARMOR[armorTier].headMultCap);
  return dmg * ARMOR[armorTier].factor;
}

// The magnification an actor is currently dialled to (1 for iron sights). The Lance's
// second level is reached with X or the wheel while aiming; zoomIdx resets on a swap.
export function currentZoom(actor, def) {
  if (!def.zooms) return 1;
  return def.zooms[Math.min(actor.zoomIdx || 0, def.zooms.length - 1)];
}

// Total spread in radians for one shot. bloom is the shooter's running bloom in degrees.
export function spreadRadians(def, speedRatio, airborne, crouched, scoped, bloomDeg) {
  let deg = def.spread + bloomDeg;
  if (def.zooms && def.zooms[def.zooms.length - 1] >= 2 && !scoped) deg = Math.max(deg, 2.4); // hip-firing a scoped gun is a guess
  deg += def.spreadMove * speedRatio;
  if (airborne) deg += def.spreadAir;
  if (crouched) deg *= 0.7;
  return (deg * Math.PI) / 180;
}

// --- Gun models -------------------------------------------------------------
// First-person viewmodels and the simpler third-person guns bots carry are both boxes with
// intent: receiver, barrel, magazine, stock, a sight. One material set, shared geometry is
// created per gun (nine guns, nine bots — cheap enough, and each reads differently).
const gunMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.45, metalness: 0.7 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9 }),
  accent: new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.6 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.35, metalness: 0.8 }),
};

function part(group, mat, x, y, z, w, h, d, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  group.add(m);
  return m;
}

export function buildGunModel(id) {
  const g = new THREE.Group();
  if (id === 'wren') {
    part(g, gunMats.body, 0, 0, 0, 0.045, 0.07, 0.21);
    part(g, gunMats.barrel, 0, 0.028, -0.13, 0.03, 0.03, 0.07);
    part(g, gunMats.grip, 0, -0.075, 0.055, 0.04, 0.1, 0.05, 0.25);
    part(g, gunMats.accent, 0, 0.045, -0.05, 0.012, 0.02, 0.012);
  } else if (id === 'magpie') {
    part(g, gunMats.body, 0, 0.01, -0.02, 0.05, 0.06, 0.3); // frame and top strap
    part(g, gunMats.barrel, 0, 0.02, -0.24, 0.032, 0.032, 0.16); // heavy barrel
    part(g, gunMats.body, 0, -0.03, 0.0, 0.058, 0.055, 0.075); // cylinder
    part(g, gunMats.grip, 0, -0.085, 0.06, 0.042, 0.105, 0.052, 0.3);
    part(g, gunMats.accent, 0, 0.048, -0.13, 0.012, 0.02, 0.012); // front blade
  } else if (id === 'boar') {
    part(g, gunMats.body, 0, 0, -0.05, 0.06, 0.08, 0.4);
    part(g, gunMats.barrel, 0, 0.015, -0.38, 0.035, 0.035, 0.34);
    part(g, gunMats.grip, 0, -0.01, -0.22, 0.05, 0.05, 0.14); // pump
    part(g, gunMats.grip, 0, -0.02, 0.24, 0.055, 0.09, 0.18); // stock
  } else if (id === 'krait') {
    part(g, gunMats.body, 0, 0, -0.02, 0.055, 0.09, 0.34);
    part(g, gunMats.barrel, 0, 0.01, -0.26, 0.03, 0.03, 0.16);
    part(g, gunMats.body, 0, -0.09, -0.02, 0.035, 0.13, 0.05); // long mag
    part(g, gunMats.grip, 0, -0.07, 0.1, 0.04, 0.09, 0.045, 0.25);
    part(g, gunMats.accent, 0, 0.06, -0.1, 0.02, 0.025, 0.1); // top rail stripe
  } else if (id === 'jackdaw') {
    part(g, gunMats.body, 0, 0, -0.03, 0.056, 0.085, 0.44);
    part(g, gunMats.grip, 0, 0.005, -0.3, 0.052, 0.06, 0.2); // long handguard
    part(g, gunMats.barrel, 0, 0.012, -0.42, 0.026, 0.026, 0.1);
    part(g, gunMats.body, 0, 0.068, -0.02, 0.03, 0.028, 0.3); // carry handle
    part(g, gunMats.body, 0, -0.095, -0.01, 0.036, 0.13, 0.055); // straight mag
    part(g, gunMats.grip, 0, -0.07, 0.11, 0.04, 0.09, 0.045, 0.25);
    part(g, gunMats.body, 0, -0.01, 0.26, 0.05, 0.07, 0.13); // stock
  } else if (id === 'heron') {
    part(g, gunMats.body, 0, 0, -0.06, 0.05, 0.07, 0.52);
    part(g, gunMats.barrel, 0, 0.012, -0.5, 0.024, 0.024, 0.4);
    part(g, gunMats.body, 0, 0.072, -0.1, 0.042, 0.046, 0.2); // scope tube
    part(g, gunMats.body, 0, -0.085, -0.06, 0.034, 0.11, 0.05); // slim mag
    part(g, gunMats.grip, 0, -0.07, 0.1, 0.04, 0.09, 0.045, 0.25);
    part(g, gunMats.grip, 0, -0.01, 0.3, 0.054, 0.075, 0.2); // stock
    part(g, gunMats.barrel, 0, -0.055, -0.44, 0.012, 0.07, 0.012); // bipod nub
  } else if (id === 'oxen') {
    part(g, gunMats.body, 0, 0, -0.04, 0.075, 0.1, 0.46); // fat receiver
    part(g, gunMats.barrel, 0, 0.015, -0.42, 0.034, 0.034, 0.32); // shrouded barrel
    part(g, gunMats.body, 0, -0.115, -0.05, 0.09, 0.11, 0.16); // belt box
    part(g, gunMats.body, 0, 0.075, -0.02, 0.026, 0.03, 0.3); // carry handle
    part(g, gunMats.grip, 0, -0.07, 0.13, 0.042, 0.095, 0.046, 0.25);
    part(g, gunMats.body, 0, -0.01, 0.27, 0.056, 0.075, 0.15); // stock
    part(g, gunMats.accent, 0, 0.045, -0.56, 0.014, 0.028, 0.014); // front post
  } else if (id === 'lance') {
    part(g, gunMats.body, 0, 0, -0.05, 0.05, 0.07, 0.5);
    part(g, gunMats.barrel, 0, 0.01, -0.48, 0.025, 0.025, 0.44);
    part(g, gunMats.body, 0, 0.078, -0.08, 0.046, 0.052, 0.24); // long scope tube
    part(g, gunMats.barrel, 0, 0.078, -0.21, 0.056, 0.06, 0.03); // objective bell
    part(g, gunMats.grip, 0, -0.02, 0.3, 0.055, 0.08, 0.22); // stock
    part(g, gunMats.body, 0, -0.08, -0.05, 0.035, 0.1, 0.05); // mag
  } else {
    // harrier, wearing its red-dot sight
    part(g, gunMats.body, 0, 0, -0.03, 0.055, 0.085, 0.42);
    part(g, gunMats.barrel, 0, 0.012, -0.33, 0.028, 0.028, 0.2);
    part(g, gunMats.body, 0, -0.095, 0.0, 0.035, 0.14, 0.055, -0.12); // curved mag
    part(g, gunMats.grip, 0, -0.07, 0.12, 0.04, 0.09, 0.045, 0.25);
    part(g, gunMats.body, 0, -0.01, 0.27, 0.05, 0.07, 0.14); // stock
    part(g, gunMats.body, 0, 0.068, -0.04, 0.036, 0.045, 0.07); // reflex housing
    part(g, gunMats.accent, 0, 0.072, -0.045, 0.008, 0.014, 0.008); // the dot
  }
  return g;
}
