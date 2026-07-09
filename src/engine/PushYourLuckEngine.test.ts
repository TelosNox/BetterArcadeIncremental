import { describe, expect, it } from 'vitest';
import { drawPayout } from './PushYourLuckEngine';
import type { ResolvedAction } from './types';

// Phase 7e: PushYourLuckRun (Score/Peak/Bank/Milestone) ist entfallen (siehe
// STATUS.md) -- die aequivalenten Tests fuer Meilenstein-Auswertung/Peak-
// Stickiness leben jetzt in EconomyStore.test.ts (machinePeakScore/
// applyMachineScoreDelta), da diese Logik dorthin gewandert ist. Diese Datei
// deckt nur noch das verbleibende `drawPayout`.

const bigWin: ResolvedAction = { id: 'big', payoutRange: [16, 22] };
const loss: ResolvedAction = { id: 'loss', payoutRange: [-10, -7] };

function scriptedRng(values: number[]): () => number {
    let i = 0;
    return () => {
        if (i >= values.length) {
            throw new Error('scriptedRng: keine weiteren Werte vorbereitet');
        }
        return values[i++];
    };
}

describe('drawPayout', () => {
    it('zieht einen Payout innerhalb der konfigurierten Spanne (Baukasten 1.11)', () => {
        expect(drawPayout(bigWin, scriptedRng([0.5]))).toBe(19); // 16 + 0.5 * (22-16)
    });

    it('trifft am unteren Rand der Spanne bei rng 0', () => {
        expect(drawPayout(bigWin, scriptedRng([0]))).toBe(16);
    });

    it('trifft am oberen Rand der Spanne bei rng nahe 1', () => {
        expect(drawPayout(bigWin, scriptedRng([0.9999]))).toBeCloseTo(22, 2);
    });

    it('kann einen negativen Wert liefern (Verlust-Spanne)', () => {
        expect(drawPayout(loss, scriptedRng([0]))).toBe(-10);
        expect(drawPayout(loss, scriptedRng([1]))).toBe(-7);
    });

    it('nutzt Math.random als Default-rng, wenn keiner uebergeben wird', () => {
        const value = drawPayout(bigWin);
        expect(value).toBeGreaterThanOrEqual(16);
        expect(value).toBeLessThanOrEqual(22);
    });
});
