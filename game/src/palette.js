// IRONFALL palette: one look for the whole game. Warm rust against slate teal, late-afternoon
// sun over a smelter yard. Teams read by colour alone: Jackals rust, Wardens teal.
export const PALETTE = {
  sky: 0x7f9db8,
  fog: 0x9db2c2,
  sun: 0xffd9a3,
  concrete: 0x8d8578,
  concreteDark: 0x5d584f,
  asphalt: 0x4a4a4c,
  metal: 0x707880,
  metalDark: 0x3f464d,
  rust: 0xb3542e,
  rustDark: 0x7e3a1f,
  teal: 0x2e7f86,
  tealDark: 0x1d4e54,
  crate: 0x9a7d4f,
  crateDark: 0x6e5836,
  hazard: 0xd9a419,
  jackal: 0xc65a2e,
  jackalDark: 0x8a3c1c,
  warden: 0x2e7f86,
  wardenDark: 0x1d4e54,
  white: 0xf2ede2,
  black: 0x14161a,
};

// Team indices used everywhere: 0 = Jackals (attack), 1 = Wardens (defend).
export const TEAM_NAMES = ['Jackals', 'Wardens'];
export const TEAM_COLORS = [PALETTE.jackal, PALETTE.teal];
