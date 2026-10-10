import { mean, median, percentile, clamp } from '../../src/utils/math.js';
import { SeededRandom } from '../../src/utils/prng.js';

describe('math', () => {
  it('mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  it('median', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
  });

  it('percentile', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('prng', () => {
  it('is deterministic', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
  });

  it('nextBetween bounds', () => {
    const r = new SeededRandom(1);
    for (let i = 0; i < 100; i++) {
      const v = r.nextBetween(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });
});
