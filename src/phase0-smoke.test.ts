import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';

describe('Phase 0: break_infinity.js Grundgerüst', () => {
    it('rechnet mit Zahlen jenseits von Number.MAX_SAFE_INTEGER', () => {
        const big = new Decimal(Number.MAX_SAFE_INTEGER).times(1000).plus(1);

        expect(big.gt(Number.MAX_SAFE_INTEGER)).toBe(true);
    });
});
