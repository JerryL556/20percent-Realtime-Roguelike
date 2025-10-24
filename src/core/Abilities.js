// Simple ability registry. Extend with more abilities as needed.
export const abilityDefs = [
  {
    id: 'ads',
    name: 'ADS',
    desc: 'Deploy a stationary triangle that zaps enemy projectiles within range (5/s).',
  },
  {
    id: 'bits',
    name: 'BITs',
    desc: 'Deploy 6 remote bits that strafe targets and fire blue lasers for 7s.',
  },
  {
    id: 'repulse',
    name: 'Repulsion Pulse',
    desc: 'Release an expanding orange ring that blocks enemy projectiles and pushes enemies away.',
  },
];

export function getAbilityById(id) {
  return abilityDefs.find((a) => a.id === id) || abilityDefs[0];
}
