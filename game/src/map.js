// The Foundry: one original map. A smelter yard split by a furnace hall (site A, north-west)
// and a rail yard (site B, south-east), joined by a mid core, an A connector, a B link and a
// roofed tunnel run along the east wall. Every solid is an AABB collider; the waypoint graph
// below is how bots read the same space, with a BFS next-hop table built once at load.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBox } from './physics.js';
import { groundTexture, sidingTexture, concreteTexture, crateTexture, containerTexture } from './textures.js';

export const SITES = [
  { id: 'A', name: 'Furnace Hall', x: -19, z: -13.5, r: 5.2 },
  { id: 'B', name: 'Rail Yard', x: 21, z: 16, r: 5.2 },
];

export const SPAWNS = [
  [[-28, 21], [-24, 21], [-26, 18.5], [-29, 18], [-23, 18.5]], // Jackals
  [[28, -21], [24, -21], [26, -18.5], [29, -18], [23, -18.5]], // Wardens
];

// Waypoints: [x, z]. Edges are mutual; routes between any two nodes come from BFS.
const NODES = [
  [-26, 20], [-27, 8], [-27, -4], [-18.8, -6], [-19, -13.5], [-10.5, -13.8], [-16, -20],
  [-9.5, -11], [0, -16], [0, -8], [-8, 0], [0, 1.5], [8, 0], [0, 9], [12, 7], [16, 11],
  [21, 16], [31.3, 8.5], [31.3, -4.5], [26, -20], [-8, -20], [-14, -4], [14, -2], [6, -9],
  [-14, 10], [24, 24], [-24, -11], [26, 12], [-15, -13.8],
];
const EDGES = [
  [0, 1], [0, 24], [1, 2], [1, 24], [2, 3], [2, 21], [3, 4], [3, 7], [3, 21], [4, 6],
  [4, 26], [4, 28], [5, 7], [5, 28], [6, 28], [7, 9], [8, 9], [8, 19], [8, 20], [8, 23],
  [9, 10], [9, 23], [10, 11], [10, 21], [10, 24], [11, 12], [11, 13], [12, 14], [12, 22],
  [12, 23], [13, 14], [13, 24], [14, 15], [14, 22], [15, 16], [16, 25], [16, 27], [17, 18],
  [17, 27], [18, 19], [18, 22], [19, 20],
];
// Where a bot standing on a hold node should watch: node id -> [x, z] it faces.
export const HOLD_FACE = { 26: [-19, -13.5], 6: [-13, -13], 27: [16, 11], 25: [21, 10], 23: [0, 1.5], 21: [-24, -2], 22: [8, 2] };
export const HOLD_NODES = { A: [26, 6], B: [27, 25], mid: [23, 21, 22] };
export const SITE_NODES = { A: 4, B: 16 };

function buildGraph() {
  const adj = NODES.map(() => []);
  for (const [a, b] of EDGES) { adj[a].push(b); adj[b].push(a); }
  const nextHop = [];
  for (let s = 0; s < NODES.length; s++) {
    const prev = new Array(NODES.length).fill(-1);
    const queue = [s];
    prev[s] = s;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      for (const n of adj[cur]) if (prev[n] === -1) { prev[n] = cur; queue.push(n); }
    }
    const row = new Array(NODES.length).fill(s);
    for (let t = 0; t < NODES.length; t++) {
      let cur = t;
      while (prev[cur] !== -1 && prev[cur] !== s) cur = prev[cur];
      row[t] = cur;
    }
    nextHop.push(row);
  }
  return { nodes: NODES.map(([x, z]) => ({ x, z })), nextHop };
}

export function createMap(scene, random) {
  const colliders = [];
  const mats = {
    siding: new THREE.MeshStandardMaterial({ map: sidingTexture(random), roughness: 0.85, metalness: 0.25 }),
    sidingRust: new THREE.MeshStandardMaterial({ map: sidingTexture(random, '#7a4a34', '#5f3826'), roughness: 0.9, metalness: 0.2 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(random), roughness: 0.95 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTexture(random), roughness: 0.9 }),
    containerRust: new THREE.MeshStandardMaterial({ map: containerTexture(random, '#a34d28', '#7e3a1f'), roughness: 0.8, metalness: 0.3 }),
    containerTeal: new THREE.MeshStandardMaterial({ map: containerTexture(random, '#2e6f76', '#1d4e54'), roughness: 0.8, metalness: 0.3 }),
    metalDark: new THREE.MeshStandardMaterial({ color: PALETTE.metalDark, roughness: 0.6, metalness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.5, metalness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 1 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xff7a26 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
  };

  // box(): a rendered solid that also collides. visual(): rendered only (roofs high above
  // the head are colliders too; skyline pieces are not).
  function box(cx, cy, cz, w, h, d, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push(makeBox(cx, cy, cz, w, h, d));
    return mesh;
  }
  function visual(mesh, cast = true) {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  // Ground: the painted yard sheet, over a dark apron that runs to the horizon.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(68, 52),
    new THREE.MeshStandardMaterial({ map: groundTexture(random), roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.01;
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ color: 0x33322f, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);

  // Perimeter.
  box(0, 2, -26.3, 69, 4, 0.6, mats.siding);
  box(0, 2, 26.3, 69, 4, 0.6, mats.siding);
  box(-34.3, 2, 0, 0.6, 4, 53, mats.siding);
  box(34.3, 2, 0, 0.6, 4, 53, mats.siding);

  // Furnace Hall (site A): east and south walls with door gaps; the rest is perimeter.
  box(-13, 1.8, -20, 0.6, 3.6, 10, mats.concrete);
  box(-13, 1.8, -10.8, 0.6, 3.6, 3.6, mats.concrete);
  box(-25.5, 1.8, -9, 11, 3.6, 0.6, mats.concrete);
  box(-15.3, 1.8, -9, 4.6, 3.6, 0.6, mats.concrete);
  box(-26, 2.75, -20, 5, 5.5, 5, mats.sidingRust); // the furnace block
  const furnaceGlow = new THREE.Mesh(new THREE.BoxGeometry(5.06, 0.5, 1.6), mats.glow);
  furnaceGlow.position.set(-26, 1.1, -20);
  scene.add(furnaceGlow);
  const chimney = visual(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 7, 12), mats.metalDark));
  chimney.position.set(-26, 9, -20);

  // Warehouse block between mid and the A connector.
  box(-9.5, 2.25, -16, 5, 4.5, 6, mats.siding);

  // Mid core: four walls, doors west and east, the core machine inside, gantry beams above.
  box(-5, 1.8, -3.1, 0.6, 3.6, 3.8, mats.concrete);
  box(-5, 1.8, 3.1, 0.6, 3.6, 3.8, mats.concrete);
  box(5, 1.8, -3.1, 0.6, 3.6, 3.8, mats.concrete);
  box(5, 1.8, 3.1, 0.6, 3.6, 3.8, mats.concrete);
  box(0, 1.8, -5, 10.6, 3.6, 0.6, mats.concrete);
  box(0, 1.8, 5, 10.6, 3.6, 0.6, mats.concrete);
  box(0, 2, -2.6, 3.4, 4, 2.2, mats.sidingRust);
  box(0, 3.85, -3, 11, 0.35, 0.5, mats.metalDark);
  box(0, 3.85, 3, 11, 0.35, 0.5, mats.metalDark);

  // Standalone blocks that make the lanes: B link, defender cover, attacker cover.
  box(9.5, 2, 14, 5, 4, 6, mats.siding);
  box(17, 2, -19, 6, 4, 6, mats.concrete);
  box(-17, 2, 16, 6, 4, 6, mats.concrete);

  // Tanks: round to look at, square to collide with.
  for (const [tx, tz] of [[-8, -22], [10, 21]]) {
    const tank = visual(new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4.6, 16), mats.metal));
    tank.position.set(tx, 2.3, tz);
    box(tx, 2.3, tz, 3.2, 4.6, 3.2, mats.dark).visible = false;
    colliders[colliders.length - 1] = makeBox(tx, 2.3, tz, 3.2, 4.6, 3.2);
  }

  // The tunnel run: inner wall with two entries and a low roof.
  box(29.8, 1.8, -6.5, 0.6, 3.6, 3, mats.concrete);
  box(29.8, 1.8, 1.5, 0.6, 3.6, 7, mats.concrete);
  box(32, 2.95, 1, 4.8, 0.5, 19, mats.metalDark);

  // Rail Yard containers (site B).
  box(18, 1.3, 12.5, 6, 2.6, 2.4, mats.containerRust);
  box(27, 1.3, 19, 2.4, 2.6, 6, mats.containerTeal);
  box(23, 1.3, 23.5, 6, 2.6, 2.4, mats.containerTeal);
  box(23, 3.9, 23.5, 6, 2.6, 2.4, mats.containerRust);

  // Crates: full cubes you fight around, doubles you cannot see over, low slabs you can
  // jump onto and crouch behind.
  const crate1 = [[-8, -12], [8, -2], [-2, 8], [12, 3.5], [14.5, 13], [-24, 6], [-6, 18], [24, -8], [2, -13], [-29, -11], [-15.5, -19]];
  for (const [x, z] of crate1) box(x, 0.575, z, 1.15, 1.15, 1.15, mats.crate);
  const crate2 = [[-4, -11], [20, -12], [-11, 4], [25, 5]];
  for (const [x, z] of crate2) { box(x, 0.575, z, 1.15, 1.15, 1.15, mats.crate); box(x, 1.725, z, 1.15, 1.15, 1.15, mats.crate); }
  const low = [[0, -9.5], [18.5, 16.5], [-20.5, -11], [10, -6]];
  for (const [x, z] of low) box(x, 0.275, z, 1.6, 0.55, 1.6, mats.crate);
  // Half walls at the mid doors and the A-long lane.
  box(-8, 0.575, 3.5, 0.5, 1.15, 3, mats.concrete);
  box(8, 0.575, -3.5, 0.5, 1.15, 3, mats.concrete);
  box(0, 0.575, 12.5, 3, 1.15, 0.5, mats.concrete);
  box(-22, 0.575, 2, 3, 1.15, 0.5, mats.concrete);

  // Lamp poles: emissive heads; three real point lights live in the hall, tunnels and core.
  for (const [x, z] of [[-12, -2], [12, -12], [-2, 20], [20, -2]]) {
    const pole = visual(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 8), mats.metalDark));
    pole.position.set(x, 2.2, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), mats.lamp);
    head.position.set(x, 4.45, z);
    scene.add(head);
    colliders.push(makeBox(x, 2.2, z, 0.24, 4.4, 0.24));
  }

  // Skyline: the rest of the works, silhouetted beyond the fence.
  const skyline = [[-44, -20, 10, 12], [40, -30, 12, 14], [0, -44, 30, 10], [-46, 16, 8, 8], [44, 24, 10, 10], [12, 42, 26, 9], [-20, 44, 18, 10]];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), mats.dark);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }
  for (const [x, z, h] of [[-40, -34, 20], [36, 38, 18]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, h, 12), mats.dark);
    stack.position.set(x, h / 2, z);
    scene.add(stack);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    beacon.position.set(x, h + 0.4, z);
    scene.add(beacon);
  }

  // Light: low warm sun with shadows, cool sky fill, and three working lights.
  const hemi = new THREE.HemisphereLight(0xbcd3e6, 0x5a5040, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.7);
  sun.position.set(34, 42, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  // A shadowless fill from the opposite quarter keeps unlit faces readable.
  const fill = new THREE.DirectionalLight(0xdfeaf5, 0.5);
  fill.position.set(-30, 24, 26);
  scene.add(fill);
  const hallLight = new THREE.PointLight(0xff9a3c, 60, 20, 1.8);
  hallLight.position.set(-20, 3.2, -14);
  scene.add(hallLight);
  const tunnelLight = new THREE.PointLight(0xbfd9ff, 30, 13, 1.8);
  tunnelLight.position.set(31.5, 2.2, 1);
  scene.add(tunnelLight);
  const coreLight = new THREE.PointLight(0xffc98a, 36, 15, 1.8);
  coreLight.position.set(0, 3.1, 1.5);
  scene.add(coreLight);

  const graph = buildGraph();
  return { colliders, nodes: graph.nodes, nextHop: graph.nextHop, sites: SITES, spawns: SPAWNS };
}
