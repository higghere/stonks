/**
 * Mulberry32 is a simple generator that produces 32-bit unsigned integers
 * from a 32-bit state seed. It is highly deterministic.
 */
export function getMulberry32(seedStr: string): () => number {
  // Simple hash function to convert seed string to 32-bit integer
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed << 5) - seed + seedStr.charCodeAt(i);
    seed |= 0;
  }

  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
