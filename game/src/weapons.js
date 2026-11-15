// Weapons: five guns with distinct jobs, plus two grenades and two armour tiers. The numbers
// are the game: a headshot multiplies damage, damage falls off past a gun's range, and spread
// (in degrees, converted where it is used) grows with movement, air time and sustained fire —
// so stopping, crouching and bursting are how you hit things. Firing itself is resolved by
// main.js with physics.rayWorld; this module owns the data, the maths and the gun models.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  wren: {
    name: 'P9 Wren', slot: 'sidearm', price: 0, blurb: 'Standard sidearm. Free, honest, outclassed.', damage: 34, headMult: 4, rpm: 380, auto: false,
    mag: 12, reserve: 96, reload: 1.5, spread: 0.35, spreadMove: 2.4, spreadAir: 5.5, bloom: 0.3,
    recoil: 0.5, range: 20, minFactor: 0.45, pellets: 1, speed: 5.0, zoom: 1,
  },
  boar: {
    name: 'SG-8 Boar', slot: 'primary', price: 1100, blurb: 'Pump shotgun. Eight pellets settle close arguments.', damage: 11, headMult: 2.4, rpm: 68, auto: false,
    mag: 6, reserve: 32, reload: 2.9, spread: 3.4, spreadMove: 1.2, spreadAir: 3, bloom: 0,
    recoil: 2.6, range: 9, minFactor: 0.2, pellets: 8, speed: 4.8, zoom: 1,
  },
  krait: {
    name: 'Krait SMG', slot: 'primary', price: 1250, blurb: 'Fast, light, forgiving on the move. Weak at range.', damage: 26, headMult: 4, rpm: 820, auto: true,
    mag: 32, reserve: 128, reload: 2.1, spread: 0.85, spreadMove: 1.1, spreadAir: 4, bloom: 0.16,
    recoil: 0.34, range: 16, minFactor: 0.5, pellets: 1, speed: 5.1, zoom: 1,
  },
  harrier: {
    name: 'Harrier AR', slot: 'primary', price: 2700, blurb: 'The rifle. Accurate, lethal to the head, the default buy.', damage: 36, headMult: 4, rpm: 660, auto: true,
    mag: 30, reserve: 120, reload: 2.4, spread: 0.42, spreadMove: 2.6, spreadAir: 6, bloom: 0.22,
    recoil: 0.46, range: 26, minFactor: 0.55, pellets: 1, speed: 4.9, zoom: 1,
  },
  lance: {
    name: 'Lance SR', slot: 'primary', price: 3500, blurb: 'Bolt-action. One body shot kills; the scope rewards stillness.', damage: 108, headMult: 2, rpm: 42, auto: false,
    mag: 5, reserve: 30, reload: 3.1, spread: 0.06, spreadMove: 4.5, spreadAir: 8, bloom: 0,
    recoil: 3.2, range: 60, minFactor: 0.85, pellets: 1, speed: 4.6, zoom: 2.6,
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

// Total spread in radians for one shot. bloom is the shooter's running bloom in degrees.
export function spreadRadians(def, speedRatio, airborne, crouched, scoped, bloomDeg) {
  let deg = def.spread + bloomDeg;
  if (def.zoom > 1 && !scoped) deg = Math.max(deg, 2.4); // an unscoped Lance is a guess
  deg += def.spreadMove * speedRatio;
  if (airborne) deg += def.spreadAir;
  if (crouched) deg *= 0.7;
  return (deg * Math.PI) / 180;
}

// --- Gun models -------------------------------------------------------------
// First-person viewmodels and the simpler third-person guns bots carry are both boxes with
// intent: receiver, barrel, magazine, stock, a sight. One material set, shared geometry is
// created per gun (five guns, nine bots — cheap enough, and each reads differently).
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
  } else if (id === 'lance') {
    part(g, gunMats.body, 0, 0, -0.05, 0.05, 0.07, 0.5);
    part(g, gunMats.barrel, 0, 0.01, -0.48, 0.025, 0.025, 0.44);
    part(g, gunMats.body, 0, 0.075, -0.08, 0.045, 0.05, 0.16); // scope
    part(g, gunMats.grip, 0, -0.02, 0.3, 0.055, 0.08, 0.22); // stock
    part(g, gunMats.body, 0, -0.08, -0.05, 0.035, 0.1, 0.05); // mag
  } else {
    // harrier
    part(g, gunMats.body, 0, 0, -0.03, 0.055, 0.085, 0.42);
    part(g, gunMats.barrel, 0, 0.012, -0.33, 0.028, 0.028, 0.2);
    part(g, gunMats.body, 0, -0.095, 0.0, 0.035, 0.14, 0.055, -0.12); // curved mag
    part(g, gunMats.grip, 0, -0.07, 0.12, 0.04, 0.09, 0.045, 0.25);
    part(g, gunMats.body, 0, -0.01, 0.27, 0.05, 0.07, 0.14); // stock
    part(g, gunMats.accent, 0, 0.062, -0.06, 0.014, 0.03, 0.014); // front post
    part(g, gunMats.accent, 0, 0.062, 0.1, 0.03, 0.03, 0.012); // rear sight
  }
  return g;
}
