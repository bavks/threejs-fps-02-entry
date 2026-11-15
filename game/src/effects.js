import * as THREE from 'three';
import { moveBody } from './physics.js';

const TRACERS = 40;
const PARTICLES = 420;

export function createEffects(scene,glowTex) {
  const tracerPool = [];
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
    const line = new THREE.Line(geo,new THREE.LineBasicMaterial({ color:0xffd9a0,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line,life:0 });
  }
  let tracerIdx = 0;

  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex,color:0xffb347,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false }));
  flashSprite.scale.setScalar(0.6);
  scene.add(flashSprite);
  const flashLight = new THREE.PointLight(0xffa347,0,11,1.6);
  scene.add(flashLight);
  let flashLife = 0;

  const FLAMES = 14;
  const flameGeo = new THREE.ConeGeometry(0.085,1,7,1,true);
  flameGeo.translate(0,0.5,0);
  flameGeo.rotateX(Math.PI / 2)
  const flameMatA = new THREE.MeshBasicMaterial({ color:0xff7a26,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false });
  const flameMatB = new THREE.MeshBasicMaterial({ color:0xffe9b0,transparent:true,opacity:0.95,blending:THREE.AdditiveBlending,depthWrite:false });
  const flames = [];
  for (let i = 0; i < FLAMES; i++) {
    const g = new THREE.Group();
    const inner = new THREE.Mesh(flameGeo,flameMatB);
    inner.scale.set(0.55,0.55,0.7);
    g.add(new THREE.Mesh(flameGeo,flameMatA),inner);
    g.visible = false;
    scene.add(g);
    flames.push({ g,life:0,max:1,len:1,w:1 });
  }
  let flameIdx = 0;
  function flame(x,y,z,dx,dy,dz,big) {
    const f = flames[flameIdx];
    flameIdx = (flameIdx + 1) % FLAMES;
    f.g.position.set(x,y,z);
    f.g.lookAt(x + dx,y + dy,z + dz);
    f.g.rotateZ(Math.random() * Math.PI * 2);
    f.len = (big ? 0.9 :0.52) * (0.8 + Math.random() * 0.5);
    f.w = big ? 1.6 :1;
    f.max = big ? 0.07 :0.05;
    f.life = f.max;
    f.g.visible = true;
  }

  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLES * 3);
  const pCol = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) pPos[i * 3 + 1] = -20;
  pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
  pGeo.setAttribute('color',new THREE.BufferAttribute(pCol,3));
  const points = new THREE.Points(pGeo,new THREE.PointsMaterial({ size:0.075,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false }));
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < PARTICLES; i++) parts.push({ life:0,vx:0,vy:0,vz:0,grav:0 });
  let partIdx = 0;

  const SMOKES = 70;
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SMOKES * 3);
  const sCol = new Float32Array(SMOKES * 3);
  for (let i = 0; i < SMOKES; i++) sPos[i * 3 + 1] = -30;
  sGeo.setAttribute('position',new THREE.BufferAttribute(sPos,3));
  sGeo.setAttribute('color',new THREE.BufferAttribute(sCol,3));
  const sPoints = new THREE.Points(sGeo,new THREE.PointsMaterial({ size:0.5,map:glowTex,vertexColors:true,transparent:true,opacity:0.3,depthWrite:false }));
  sPoints.frustumCulled = false;
  scene.add(sPoints);
  const smokes = [];
  for (let i = 0; i < SMOKES; i++) smokes.push({ life:0,vx:0,vy:0,vz:0 });
  let smokeIdx = 0;
  function puff(x,y,z,vx,vy,vz,shade,life) {
    const p = smokes[smokeIdx];
    const i3 = smokeIdx * 3;
    smokeIdx = (smokeIdx + 1) % SMOKES;
    sPos[i3] = x; sPos[i3 + 1] = y; sPos[i3 + 2] = z;
    sCol[i3] = shade; sCol[i3 + 1] = shade; sCol[i3 + 2] = shade * 1.04;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life;
  }

  const grenades = [];

  function burst(x,y,z,count,color,speed,life,grav,spread = 1) {
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

    tracer(x0,y0,z0,x1,y1,z1) {
      const t = tracerPool[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACERS;
      const a = t.line.geometry.attributes.position.array;
      a[0] = x0; a[1] = y0; a[2] = z0; a[3] = x1; a[4] = y1; a[5] = z1;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.visible = true;
      t.life = 0.05;
      t.line.material.opacity = 0.85;
    },

    muzzle(x,y,z,big,dx = 0,dy = 0,dz = -1) {
      flashSprite.position.set(x,y,z);
      flashSprite.material.opacity = 0.95;
      flashSprite.material.rotation = Math.random() * 3;
      flashSprite.scale.setScalar(big ? 1.15 :0.55 + Math.random() * 0.25);
      flashLight.position.set(x,y,z);
      flashLight.intensity = big ? 80 :34;
      flashLife = 0.045;
      flame(x,y,z,dx,dy,dz,big);
    },

    smoke(x,y,z,dx,dy,dz,big) {
      const n = big ? 5 :3;
      for (let i = 0; i < n; i++) {
        const s = 0.4 + Math.random() * 0.5;
        puff(x,y,z,
          dx * s + (Math.random() - 0.5) * 0.3,dy * s + 0.3 + Math.random() * 0.25,dz * s + (Math.random() - 0.5) * 0.3,
          0.55 + Math.random() * 0.2,0.8 + Math.random() * 0.6);
      }
    },

    impact(x,y,z,kind) {
      if (kind === 'blood') burst(x,y,z,7,0x9e2015,1.6,0.4,4);
      else if (kind === 'spark') {
        burst(x,y,z,8,0xffc266,3.1,0.3,3.5);
        burst(x,y,z,3,0xfff2cc,1.8,0.18,2);
        puff(x,y,z,0,0.35,0,0.5,0.7);
      } else {
        burst(x,y,z,7,0x9a938a,1.3,0.55,2);
        burst(x,y,z,2,0xffc266,2.2,0.2,3);
      }
    },

    explosion(x,y,z) {
      burst(x,y,z,46,0xff7a26,6.5,0.7,2.5);
      burst(x,y,z,26,0xffd9a0,4,0.45,1.5);
      burst(x,y,z,18,0x555049,2.2,1.1,-0.6)
      flame(x,y + 0.3,z,0,1,0,true);
      for (let i = 0; i < 6; i++) puff(x,y + 0.4,z,(Math.random() - 0.5) * 1.4,0.8 + Math.random() * 0.8,(Math.random() - 0.5) * 1.4,0.3,1.2 + Math.random() * 0.7);
      flashSprite.position.set(x,y + 0.4,z);
      flashSprite.material.opacity = 1;
      flashSprite.scale.setScalar(4.2);
      flashLight.position.set(x,y + 0.5,z);
      flashLight.intensity = 260;
      flashLife = 0.16;
    },

    throwGrenade(kind,x,y,z,vx,vy,vz,owner) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09,10,8),
        new THREE.MeshStandardMaterial({ color:kind === 'he' ? 0x6e3a1f :0xb9c0c4,roughness:0.5,metalness:0.4 }),
      );
      mesh.position.set(x,y,z);
      scene.add(mesh);
      grenades.push({
        kind,owner,mesh,fuse:kind === 'he' ? 1.5 :1.4,bounced:false,
        body:{ pos:{ x,y,z },vel:{ x:vx,y:vy,z:vz },radius:0.09,height:0.18,onGround:false },
      });
    },

    update(dt,colliders,onGrenade) {
      for (const t of tracerPool) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0,t.life / 0.05) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) { flashSprite.material.opacity = 0; flashLight.intensity = 0; }
      }
      for (const f of flames) {
        if (f.life <= 0) continue;
        f.life -= dt;
        if (f.life <= 0) { f.g.visible = false; continue; }
        const k = f.life / f.max;
        const w = f.w * (0.7 + 0.5 * k);
        f.g.scale.set(w,w,f.len * (0.75 + 0.45 * k));
      }
      for (let i = 0; i < SMOKES; i++) {
        const p = smokes[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        const i3 = i * 3;
        if (p.life <= 0) { sPos[i3 + 1] = -30; continue; }
        p.vy += 0.3 * dt;
        const drag = Math.max(0,1 - 1.6 * dt);
        p.vx *= drag; p.vz *= drag;
        sPos[i3] += p.vx * dt;
        sPos[i3 + 1] += p.vy * dt;
        sPos[i3 + 2] += p.vz * dt;
      }
      sGeo.attributes.position.needsUpdate = true;
      sGeo.attributes.color.needsUpdate = true;
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
        moveBody(b,colliders,dt);
        if (b.vel.x === 0 && pvx !== 0) b.vel.x = -pvx * 0.42;
        if (b.vel.z === 0 && pvz !== 0) b.vel.z = -pvz * 0.42;
        if (b.onGround && pvy < -1.2) { b.vel.y = -pvy * 0.38; b.vel.x *= 0.7; b.vel.z *= 0.7; g.bounced = true; }
        else if (b.onGround) { b.vel.x *= Math.max(0,1 - 6 * dt); b.vel.z *= Math.max(0,1 - 6 * dt); b.vel.y = 0; }
        g.mesh.position.set(b.pos.x,b.pos.y + 0.09,b.pos.z);
        if (g.fuse <= 0) {
          scene.remove(g.mesh);
          grenades.splice(i,1);
          onGrenade(g);
        }
      }
    },
  };
}

export function createBombProp(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.16,0.34),new THREE.MeshStandardMaterial({ color:0x35383c,roughness:0.5,metalness:0.5 }));
  body.position.y = 0.08;
  body.castShadow = true;
  g.add(body);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.03,0.14),new THREE.MeshBasicMaterial({ color:0x67e08a }));
  pad.position.set(0,0.17,0);
  g.add(pad);
  const lightMat = new THREE.MeshBasicMaterial({ color:0xff3b30 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035,8,8),lightMat);
  bulb.position.set(0.16,0.19,0.1);
  g.add(bulb);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.3,6),new THREE.MeshStandardMaterial({ color:0x17181a }));
  antenna.position.set(-0.18,0.3,-0.1);
  g.add(antenna);
  g.visible = false;
  scene.add(g);
  return {
    group:g,
    show(x,z) { g.position.set(x,0,z); g.visible = true; },
    hide() { g.visible = false; },
    blink(t,urgent) { lightMat.color.setHex(Math.sin(t * (urgent ? 26 :9)) > 0 ? 0xff3b30 :0x571512); },
  };
}
