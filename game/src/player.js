import { stepLocomotion,eyeHeight } from './actors.js';
import { currentGun,currentZoom } from './weapons.js';

const SENS = 0.0021;
const PITCH_MAX = 1.45;

export function createPlayerController(actor) {
  const ctl = {
    actor,
    punch:0,
    punchYaw:0,
    bobPhase:0,
    bobAmount:0,
    swayT:0,
    swayAmp:0,
    landDip:0,
    lean:0,

    look(dx,dy,scale = 1) {
      actor.yaw -= dx * SENS * scale;
      actor.pitch -= dy * SENS * scale;
      actor.pitch = Math.max(-PITCH_MAX,Math.min(PITCH_MAX,actor.pitch));
    },

    kick(pitchDeg,yawDeg) {
      ctl.punch += (pitchDeg * Math.PI) / 180;
      ctl.punchYaw += (yawDeg * Math.PI) / 180;
      actor.pitch += (pitchDeg * Math.PI) / 180 * 0.35;
      actor.pitch = Math.min(PITCH_MAX,actor.pitch);
    },

    step(dt,input,colliders,canMove) {
      const a = actor;
      const decay = Math.max(0,1 - dt * 7);
      ctl.punch *= decay;
      ctl.punchYaw *= decay;

      a.crouch = input.state.keys.has('ControlLeft') || input.state.keys.has('KeyC');
      let fwd = 0;
      let strafe = 0;
      if (canMove && a.alive) {
        if (input.state.keys.has('KeyW')) fwd += 1;
        if (input.state.keys.has('KeyS')) fwd -= 1;
        if (input.state.keys.has('KeyD')) strafe += 1;
        if (input.state.keys.has('KeyA')) strafe -= 1;
      }
      const sin = Math.sin(a.yaw);
      const cos = Math.cos(a.yaw);
      let wishX = (-sin * fwd + cos * strafe);
      let wishZ = (-cos * fwd - sin * strafe);
      const len = Math.hypot(wishX,wishZ);
      if (len > 0) { wishX /= len; wishZ /= len; }
      const { def } = currentGun(a.loadout);
      let speed = def.speed;
      if (a.crouch) speed *= 0.36;
      if (a.scoped) speed *= 0.45;
      const wasAir = !a.onGround;
      const vy = a.vel.y;
      stepLocomotion(a,wishX,wishZ,speed,input.state.keys.has('Space'),dt,colliders);
      if (wasAir && a.onGround) ctl.landDip = Math.min(0.55,-vy * 0.045);
      ctl.landDip = Math.max(0,ctl.landDip - dt * 2.4);
      const lat = a.vel.x * cos - a.vel.z * sin;
      const leanT = a.onGround && a.alive ? Math.max(-0.04,Math.min(0.04,-lat * 0.007)) :0;
      ctl.lean += (leanT - ctl.lean) * Math.min(1,dt * 7);
      ctl.swayT += dt * 3.9;
      const swayTarget = a.scoped && a.alive
        ? 0.0011 * currentZoom(a,def) * (a.crouch ? 0.4 :1) * (a.speed2d > 0.4 ? 1.7 :1)
        :0;
      ctl.swayAmp += (swayTarget - ctl.swayAmp) * Math.min(1,dt * 5);
      const target = a.onGround && a.alive ? Math.min(1,a.speed2d / 5) :0;
      ctl.bobAmount += (target - ctl.bobAmount) * Math.min(1,dt * 8);
      ctl.bobPhase += a.speed2d * dt * 1.6;
    },

    eyePos(out) {
      const a = actor;
      out.set(
        a.pos.x,
        a.pos.y + eyeHeight(a) + Math.sin(ctl.bobPhase * 2) * 0.018 * ctl.bobAmount - ctl.landDip * 0.13,
        a.pos.z,
      );
      return out;
    },

    viewPitch() { return actor.pitch + ctl.punch + Math.sin(ctl.swayT) * ctl.swayAmp; },
    viewYaw() { return actor.yaw + ctl.punchYaw + Math.sin(ctl.swayT * 0.63 + 1.3) * ctl.swayAmp * 0.8; },
  };
  return ctl;
}
