// The player's body: mouse look with a recoil punch that springs back, and wish-direction
// movement from the camera yaw. All physics is the shared actor step — this module only
// translates input into intent, so the player and the bots move by the same rules.
import { stepLocomotion, eyeHeight } from './actors.js';
import { currentGun, currentZoom } from './weapons.js';

const SENS = 0.0021;
const PITCH_MAX = 1.45;

export function createPlayerController(actor) {
  const ctl = {
    actor,
    punch: 0, // recoil pitch offset, decays back to zero
    punchYaw: 0,
    bobPhase: 0,
    bobAmount: 0,
    swayT: 0, // scope breathing phase; swayAmp eases toward its scoped target
    swayAmp: 0,

    look(dx, dy, scale = 1) {
      actor.yaw -= dx * SENS * scale;
      actor.pitch -= dy * SENS * scale;
      actor.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, actor.pitch));
    },

    kick(pitchDeg, yawDeg) {
      ctl.punch += (pitchDeg * Math.PI) / 180;
      ctl.punchYaw += (yawDeg * Math.PI) / 180;
      actor.pitch += (pitchDeg * Math.PI) / 180 * 0.35; // part of the kick is permanent aim shift
      actor.pitch = Math.min(PITCH_MAX, actor.pitch);
    },

    step(dt, input, colliders, canMove) {
      const a = actor;
      // Recoil recovery.
      const decay = Math.max(0, 1 - dt * 7);
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
      const len = Math.hypot(wishX, wishZ);
      if (len > 0) { wishX /= len; wishZ /= len; }
      const { def } = currentGun(a.loadout);
      let speed = def.speed;
      if (a.crouch) speed *= 0.36;
      if (a.scoped) speed *= 0.45;
      stepLocomotion(a, wishX, wishZ, speed, input.state.keys.has('Space'), dt, colliders);
      // Scope sway: a breathing figure, larger at higher magnification and on the move,
      // settling crouched and still. It feeds the view below, so reticle and shot agree.
      ctl.swayT += dt * 3.9;
      const swayTarget = a.scoped && a.alive
        ? 0.0011 * currentZoom(a, def) * (a.crouch ? 0.4 : 1) * (a.speed2d > 0.4 ? 1.7 : 1)
        : 0;
      ctl.swayAmp += (swayTarget - ctl.swayAmp) * Math.min(1, dt * 5);
      // View bob: grows with ground speed, settles when still.
      const target = a.onGround && a.alive ? Math.min(1, a.speed2d / 5) : 0;
      ctl.bobAmount += (target - ctl.bobAmount) * Math.min(1, dt * 8);
      ctl.bobPhase += a.speed2d * dt * 1.6;
    },

    eyePos(out) {
      const a = actor;
      out.set(
        a.pos.x,
        a.pos.y + eyeHeight(a) + Math.sin(ctl.bobPhase * 2) * 0.018 * ctl.bobAmount,
        a.pos.z,
      );
      return out;
    },

    viewPitch() { return actor.pitch + ctl.punch + Math.sin(ctl.swayT) * ctl.swayAmp; },
    viewYaw() { return actor.yaw + ctl.punchYaw + Math.sin(ctl.swayT * 0.63 + 1.3) * ctl.swayAmp * 0.8; },
  };
  return ctl;
}
