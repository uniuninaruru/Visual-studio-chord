export type Seed = string | number;

export interface RandomSource {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

export function seedToString(seed: Seed): string {
  return String(seed);
}

/** Stable 32-bit FNV-1a hash. */
export function hashSeed(seed: Seed): number {
  const text = seedToString(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function deriveSeed(seed: Seed, ...parts: readonly (string | number)[]): string {
  return [seedToString(seed), ...parts.map(String)].join("::");
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Mulberry32 wrapped in a small API. Generation code never calls Math.random. */
export function createSeededRandom(seed: Seed): RandomSource {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(minInclusive, maxExclusive) {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
        throw new TypeError("Random integer bounds must be integers.");
      }
      if (maxExclusive <= minInclusive) {
        throw new RangeError("maxExclusive must be greater than minInclusive.");
      }
      return minInclusive + Math.floor(next() * (maxExclusive - minInclusive));
    },
    chance(probability) {
      return next() < clampProbability(probability);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("Cannot pick from an empty list.");
      return items[Math.floor(next() * items.length)] as T;
    },
    weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
      if (items.length === 0 || items.length !== weights.length) {
        throw new RangeError("Items and weights must be non-empty and equal in length.");
      }
      const normalized = weights.map((weight) =>
        Number.isFinite(weight) && weight > 0 ? weight : 0,
      );
      const total = normalized.reduce((sum, weight) => sum + weight, 0);
      if (total <= 0) return items[0] as T;
      let cursor = next() * total;
      for (let index = 0; index < items.length; index += 1) {
        cursor -= normalized[index] as number;
        if (cursor < 0) return items[index] as T;
      }
      return items[items.length - 1] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(next() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
      }
      return result;
    },
  };
}

