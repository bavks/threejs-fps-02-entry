// Axis-aligned box physics. A collider is { minX, maxX, minY, maxY, minZ, maxZ }.

export function makeBox(cx, cy, cz, w, h, d) {
  return {
    minX: cx - w / 2, maxX: cx + w / 2,
    minY: cy - h / 2, maxY: cy + h / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
  };
}

export function moveBody(body, colliders, dt) {
  const p = body.pos;
  const v = body.vel;
  const r = body.radius;
  const h = body.height;

  p.x += v.x * dt;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (p.x + r > c.minX && p.x - r < c.maxX && p.z + r > c.minZ && p.z - r < c.maxZ && p.y < c.maxY && p.y + h > c.minY) {
      if (v.x > 0) p.x = c.minX - r; else if (v.x < 0) p.x = c.maxX + r;
      v.x = 0;
    }
  }
  p.z += v.z * dt;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (p.x + r > c.minX && p.x - r < c.maxX && p.z + r > c.minZ && p.z - r < c.maxZ && p.y < c.maxY && p.y + h > c.minY) {
      if (v.z > 0) p.z = c.minZ - r; else if (v.z < 0) p.z = c.maxZ + r;
      v.z = 0;
    }
  }
  p.y += v.y * dt;
  body.onGround = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (p.x + r > c.minX && p.x - r < c.maxX && p.z + r > c.minZ && p.z - r < c.maxZ && p.y < c.maxY && p.y + h > c.minY) {
      if (v.y <= 0 && p.y < c.maxY && p.y > c.maxY - 0.6) {
        p.y = c.maxY;
        v.y = 0;
        body.onGround = true;
      } else if (v.y > 0) {
        p.y = c.minY - h;
        v.y = 0;
      }
    }
  }
  if (p.y <= 0) {
    p.y = 0;
    v.y = 0;
    body.onGround = true;
  }
}

export function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let tmin = 0;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < c.minX || ox > c.maxX) return Infinity;
  } else {
    let t1 = (c.minX - ox) / dx;
    let t2 = (c.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < c.minY || oy > c.maxY) return Infinity;
  } else {
    let t1 = (c.minY - oy) / dy;
    let t2 = (c.maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < c.minZ || oz > c.maxZ) return Infinity;
  } else {
    let t1 = (c.minZ - oz) / dz;
    let t2 = (c.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export function rayWorld(ox, oy, oz, dx, dy, dz, colliders) {
  let best = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i]);
    if (t < best) best = t;
  }
  return best;
}

export function lineOfSight(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const inv = 1 / len;
  const t = rayWorld(ax, ay, az, dx * inv, dy * inv, dz * inv, colliders);
  return t >= len - 0.05;
}
