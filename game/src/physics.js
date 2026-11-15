
export function makeBox(cx,cy,cz,w,h,d) {
  return {
    minX:cx - w / 2,maxX:cx + w / 2,
    minY:cy - h / 2,maxY:cy + h / 2,
    minZ:cz - d / 2,maxZ:cz + d / 2,
  };
}

export function moveBody(body,colliders,dt) {
  const p = body.pos;
  const v = body.vel;
  const r = body.radius;
  const h = body.height;

  for (const [ax,mn,mx,oz,omn,omx] of [['x','minX','maxX','z','minZ','maxZ'],['z','minZ','maxZ','x','minX','maxX']]) {
    p[ax] += v[ax] * dt;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (p[ax] + r > c[mn] && p[ax] - r < c[mx] && p[oz] + r > c[omn] && p[oz] - r < c[omx] && p.y < c.maxY && p.y + h > c.minY) {
        if (v[ax] > 0) p[ax] = c[mn] - r; else if (v[ax] < 0) p[ax] = c[mx] + r;
        v[ax] = 0;
      }
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

export function rayBox(ox,oy,oz,dx,dy,dz,c) {
  const o = [ox,oy,oz];
  const d = [dx,dy,dz];
  const lo = [c.minX,c.minY,c.minZ];
  const hi = [c.maxX,c.maxY,c.maxZ];
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin,t1);
      tmax = Math.min(tmax,t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function rayWorld(ox,oy,oz,dx,dy,dz,colliders) {
  let best = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox,oy,oz,dx,dy,dz,colliders[i]);
    if (t < best) best = t;
  }
  return best;
}

export function lineOfSight(ax,ay,az,bx,by,bz,colliders) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx,dy,dz);
  if (len < 1e-6) return true;
  const inv = 1 / len;
  const t = rayWorld(ax,ay,az,dx * inv,dy * inv,dz * inv,colliders);
  return t >= len - 0.05;
}
