// Sky: Blue Sky, Cloudy, Sunset, Night — one mood; K cycles it.
import * as THREE from 'three';

// [top,hor,fog,near,far,sun,sunI,pos,hSky,hGnd,hemiI,fillI,lamp,exp,glow]
const SKIES = [
  [0x527a9e,0xa9c3d8,0x9db2c2,34,115,0xffd9a3,2.7,[34,42,-20],0xbcd3e6,0x5a5040,1.1,0.5,1,1.22,0.55],
  [0x66727c,0xb4babd,0xa3adb2,24,82,0xe9e5db,1.0,[16,40,16],0xc3ccd2,0x5c574e,1.3,0.6,1.35,1.1,0.1],
  [0x2e3a5c,0xf07f3c,0xcf9464,30,105,0xff8f3d,2.4,[-40,8,-14],0x9a7d8f,0x54432e,0.7,0.28,1.7,1.15,1.1],
  [0x050a18,0x1a2a44,0x111c2c,26,92,0xbcd2ff,0.6,[-18,44,20],0x2e4a73,0x141a20,0.6,0.2,3.2,1.06,0.5],
];
export const SKY_NAMES = ['Blue Sky', 'Cloudy', 'Sunset', 'Night'];
const COLS = ['top', 'hor', 'fog', 'sun', 'hSky', 'hGnd'];
const NUMS = ['near', 'far', 'sunI', 'hemiI', 'fillI', 'lamp', 'exp', 'glow'];

function decode(p) {
  return {
    top: new THREE.Color(p[0]), hor: new THREE.Color(p[1]), fog: new THREE.Color(p[2]),
    near: p[3], far: p[4], sun: new THREE.Color(p[5]), sunI: p[6],
    sunPos: new THREE.Vector3(p[7][0], p[7][1], p[7][2]),
    hSky: new THREE.Color(p[8]), hGnd: new THREE.Color(p[9]),
    hemiI: p[10], fillI: p[11], lamp: p[12], exp: p[13], glow: p[14],
  };
}
function clone(s) {
  const o = { sunPos: s.sunPos.clone() };
  for (const k of COLS) o[k] = s[k].clone();
  for (const k of NUMS) o[k] = s[k];
  return o;
}
function mix(a, b, t, out) {
  for (const k of COLS) out[k].lerpColors(a[k], b[k], t);
  for (const k of NUMS) out[k] = a[k] + (b[k] - a[k]) * t;
  out.sunPos.lerpVectors(a.sunPos, b.sunPos, t);
}

export function createSky(scene, lights, renderer) {
  const uniforms = {
    uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uGlow: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(190, 24, 12),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uGlow;
        void main(){ vec3 d = normalize(vDir); float h = pow(clamp(d.y * 1.5 + 0.14, 0.0, 1.0), 0.75);
        vec3 col = mix(uHor, uTop, h); float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunCol * (pow(s, 120.0) * 0.9 + smoothstep(0.9995, 0.99985, s) * 1.6) * uGlow;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment> }`,
    }),
  );
  dome.frustumCulled = false;
  scene.add(dome);
  scene.background = null;

  let idx = 0;
  let cur = decode(SKIES[0]);
  let from = clone(cur);
  let to = clone(cur);
  let t = 1;

  function apply(s) {
    scene.fog.color.copy(s.fog);
    scene.fog.near = s.near;
    scene.fog.far = s.far;
    uniforms.uTop.value.copy(s.top);
    uniforms.uHor.value.copy(s.hor);
    uniforms.uSunDir.value.copy(s.sunPos).normalize();
    uniforms.uSunCol.value.copy(s.sun);
    uniforms.uGlow.value = s.glow;
    lights.sun.color.copy(s.sun);
    lights.sun.intensity = s.sunI;
    lights.sun.position.copy(s.sunPos);
    lights.hemi.color.copy(s.hSky);
    lights.hemi.groundColor.copy(s.hGnd);
    lights.hemi.intensity = s.hemiI;
    lights.fill.intensity = s.fillI;
    for (let i = 0; i < lights.lamps.length; i++) lights.lamps[i].intensity = lights.lampBase[i] * s.lamp;
    renderer.toneMappingExposure = s.exp;
  }
  apply(cur);

  return {
    get index() { return idx; },
    name() { return SKY_NAMES[idx]; },
    set(i, instant = false) {
      idx = ((i % SKIES.length) + SKIES.length) % SKIES.length;
      from = clone(cur);
      to = decode(SKIES[idx]);
      t = instant ? 1 : 0;
      if (instant) { cur = clone(to); apply(cur); }
    },
    cycle() { this.set(idx + 1); },
    update(dt) {
      if (t >= 1) return;
      t = Math.min(1, t + dt / 3.2);
      mix(from, to, t * t * (3 - 2 * t), cur);
      apply(cur);
    },
  };
}
