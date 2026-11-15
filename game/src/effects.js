// Effects: everything transient and visual. Tracers, muzzle flashes, impact bursts and
// grenades are pooled and reused — nothing is allocated per frame. Grenades are small bodies
// on the same AABB physics as actors, with velocity reflected on impact so they bounce off
// walls and floors before their fuse runs out.
import * as THREE from 'three';
import { moveBody } from './physics.js';

const TRACERS = 40;
const PARTICLES = 420;

export function createEffects(scene, glowTex) {
  // Tracers: one line each, additive, gone in a blink.
  const tracerPool = [];
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  // Muzzle flash: a glow sprite plus the one shared flash light, moved to whoever fired.
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb347, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flashSprite.scale.setScalar(0.6);
  scene.add(flashSprite);
  const flashLight = new THREE.PointLight(0xffa347, 0, 9, 1.6);
  scene.add(flashLight);
  let flashLife = 0;

  // Particles: one Points cloud, slots recycled round-robin.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLES * 3);
  const pCol = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) pPos[i * 3 + 1] = -20;
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < PARTICLES; i++) parts.push({ life: 0, vx: 0, vy: 0, vz: 0, grav: 0 });
  let partIdx = 0;

  const grenades = [];

  function burst(x, y, z, count, color, speed, life, grav, spread = 1) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const p = parts[partIdx];
      const i3 = partIdx * 3;
      partIdx = (partIdx + 1) % PARTICLES;
      pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
      pCol[i3] = c.r; pCol[i3 + 1] = c.g; pCol[i3 + 2] = c.b;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.3 + Math.random() * 0.7);
      p.vx = Math.sin(ph) * Math.cos(th) * s * spread;
      p.vy = Math.abs(Math.cos(ph)) * s * 0.9 + speed * 0.25;
      p.vz = Math.sin(ph) * Math.sin(th) * s * spread;
      p.life = life * (0.6 + Math.random() * 0.7);
      p.grav = grav;
    }
  }

  return {
    grenades,

    tracer(x0, y0, z0, x1, y1, z1) {
      const t = tracerPool[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACERS;
      const a = t.line.geometry.attributes.position.array;
      a[0] = x0; a[1] = y0; a[2] = z0; a[3] = x1; a[4] = y1; a[5] = z1;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.visible = true;
      t.life = 0.05;
      t.line.material.opacity = 0.85;
    },

    muzzle(x, y, z, big) {
      flashSprite.position.set(x, y, z);
      flashSprite.material.opacity = 0.95;
      flashSprite.material.rotation = Math.random() * 3;
      flashSprite.scale.setScalar(big ? 1.15 : 0.55 + Math.random() * 0.25);
      flashLight.position.set(x, y, z);
      flashLight.intensity = big ? 60 : 26;
      flashLife = 0.045;
    },

    impact(x, y, z, kind) {
      if (kind === 'blood') burst(x, y, z, 7, 0x9e2015, 1.6, 0.4, 4);
      else if (kind === 'spark') burst(x, y, z, 5, 0xffc266, 2.4, 0.25, 3);
      else burst(x, y, z, 6, 0x9a938a, 1.1, 0.5, 2); // dust
    },

    explosion(x, y, z) {
      burst(x, y, z, 46, 0xff7a26, 6.5, 0.7, 2.5);
      burst(x, y, z, 26, 0xffd9a0, 4, 0.45, 1.5);
      burst(x, y, z, 18, 0x555049, 2.2, 1.1, -0.6); // smoke drifts up
      flashSprite.position.set(x, y + 0.4, z);
      flashSprite.material.opacity = 1;
      flashSprite.scale.setScalar(4.2);
      flashLight.position.set(x, y + 0.5, z);
      flashLight.intensity = 260;
      flashLife = 0.16;
    },

    throwGrenade(kind, x, y, z, vx, vy, vz, owner) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshStandardMaterial({ color: kind === 'he' ? 0x6e3a1f : 0xb9c0c4, roughness: 0.5, metalness: 0.4 }),
      );
      mesh.position.set(x, y, z);
      scene.add(mesh);
      grenades.push({
        kind, owner, mesh, fuse: kind === 'he' ? 1.5 : 1.4, bounced: false,
        body: { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, radius: 0.09, height: 0.18, onGround: false },
      });
    },

    // Advance everything. onGrenade(grenade) fires when a fuse ends; the caller applies
    // damage/blind and this module removes the mesh.
    update(dt, colliders, onGrenade) {
      for (const t of tracerPool) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.05) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) { flashSprite.material.opacity = 0; flashLight.intensity = 0; }
      }
      for (let i = 0; i < PARTICLES; i++) {
        const p = parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        const i3 = i * 3;
        if (p.life <= 0) { pPos[i3 + 1] = -20; continue; }
        p.vy -= p.grav * dt;
        pPos[i3] += p.vx * dt;
        pPos[i3 + 1] += p.vy * dt;
        pPos[i3 + 2] += p.vz * dt;
        if (pPos[i3 + 1] < 0.03) { pPos[i3 + 1] = 0.03; p.vy = 0; }
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      for (let i = grenades.length - 1; i >= 0; i--) {
        const g = grenades[i];
        g.fuse -= dt;
        const b = g.body;
        const pvx = b.vel.x; const pvy = b.vel.y; const pvz = b.vel.z;
        b.vel.y -= 13.5 * dt;
        moveBody(b, colliders, dt);
        if (b.vel.x === 0 && pvx !== 0) b.vel.x = -pvx * 0.42;
        if (b.vel.z === 0 && pvz !== 0) b.vel.z = -pvz * 0.42;
        if (b.onGround && pvy < -1.2) { b.vel.y = -pvy * 0.38; b.vel.x *= 0.7; b.vel.z *= 0.7; g.bounced = true; }
        else if (b.onGround) { b.vel.x *= Math.max(0, 1 - 6 * dt); b.vel.z *= Math.max(0, 1 - 6 * dt); b.vel.y = 0; }
        g.mesh.position.set(b.pos.x, b.pos.y + 0.09, b.pos.z);
        if (g.fuse <= 0) {
          scene.remove(g.mesh);
          grenades.splice(i, 1);
          onGrenade(g);
        }
      }
    },
  };
}

// The planted charge: a slab with a keypad, an antenna and a light that blinks faster as
// the fuse runs down. Built once, shown and hidden by the round logic.
export function createBombProp(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0x35383c, roughness: 0.5, metalness: 0.5 }));
  body.position.y = 0.08;
  body.castShadow = true;
  g.add(body);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.14), new THREE.MeshBasicMaterial({ color: 0x67e08a }));
  pad.position.set(0, 0.17, 0);
  g.add(pad);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), lightMat);
  bulb.position.set(0.16, 0.19, 0.1);
  g.add(bulb);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0x17181a }));
  antenna.position.set(-0.18, 0.3, -0.1);
  g.add(antenna);
  g.visible = false;
  scene.add(g);
  return {
    group: g,
    show(x, z) { g.position.set(x, 0, z); g.visible = true; },
    hide() { g.visible = false; },
    blink(t, urgent) { lightMat.color.setHex(Math.sin(t * (urgent ? 26 : 9)) > 0 ? 0xff3b30 : 0x571512); },
  };
}
