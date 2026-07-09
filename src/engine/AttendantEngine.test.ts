import { describe, expect, it } from 'vitest';
import {
    ATTENDANT_MAX_EFFICIENCY,
    MANUAL_KNOWLEDGE_GAIN,
    TRAINING_KNOWLEDGE_GAIN,
    chooseAttendantTier,
    gainKnowledgeFromManualPlay,
    gainKnowledgeFromTraining,
    getAttendantEfficiency,
    getAttendantFailureChance,
    getAttendantTier,
} from './AttendantEngine';
import type { RiskTier } from './types';

const safe: RiskTier = { id: 'safe', payoutRange: [3, 3], failureChance: 0 };
const balanced: RiskTier = { id: 'balanced', payoutRange: [6, 10], failureChance: 0.15 };
const risky: RiskTier = { id: 'risky', payoutRange: [14, 22], failureChance: 0.35 };
const tiers = [safe, balanced, risky];

describe('AttendantEngine', () => {
    describe('getAttendantEfficiency', () => {
        it('ist 0 bei Musterkenntnis 0', () => {
            expect(getAttendantEfficiency(0)).toBe(0);
        });

        it('erreicht ATTENDANT_MAX_EFFICIENCY bei voller Musterkenntnis, nie mehr', () => {
            expect(getAttendantEfficiency(1)).toBeCloseTo(ATTENDANT_MAX_EFFICIENCY);
            expect(ATTENDANT_MAX_EFFICIENCY).toBeLessThan(1);
        });

        it('liegt im Richtwert 85-90% bei voller Musterkenntnis (game-spec.md 3.2)', () => {
            expect(getAttendantEfficiency(1)).toBeGreaterThanOrEqual(0.85);
            expect(getAttendantEfficiency(1)).toBeLessThanOrEqual(0.9);
        });

        it('klemmt Musterkenntnis ausserhalb [0, 1]', () => {
            expect(getAttendantEfficiency(-1)).toBe(0);
            expect(getAttendantEfficiency(2)).toBeCloseTo(ATTENDANT_MAX_EFFICIENCY);
        });

        it('skaliert linear mit der Musterkenntnis', () => {
            expect(getAttendantEfficiency(0.5)).toBeCloseTo(ATTENDANT_MAX_EFFICIENCY * 0.5);
        });
    });

    describe('getAttendantFailureChance', () => {
        it('laesst eine Basis-Fangchance von 0 ("safe") immer bei 0, unabhaengig von der Musterkenntnis', () => {
            expect(getAttendantFailureChance(0, 0)).toBe(0);
            expect(getAttendantFailureChance(0, 1)).toBe(0);
        });

        it('entspricht bei voller Musterkenntnis exakt der Basis-Fangchance eines Spielers', () => {
            expect(getAttendantFailureChance(0.15, 1)).toBeCloseTo(0.15);
            expect(getAttendantFailureChance(0.35, 1)).toBeCloseTo(0.35);
        });

        it('addiert bei Musterkenntnis 0 den maximalen Aufschlag', () => {
            expect(getAttendantFailureChance(0.15, 0)).toBeCloseTo(0.45);
        });

        it('sinkt streng monoton mit wachsender Musterkenntnis', () => {
            const atZero = getAttendantFailureChance(0.15, 0);
            const atHalf = getAttendantFailureChance(0.15, 0.5);
            const atFull = getAttendantFailureChance(0.15, 1);
            expect(atZero).toBeGreaterThan(atHalf);
            expect(atHalf).toBeGreaterThan(atFull);
        });

        it('klemmt auf 1', () => {
            expect(getAttendantFailureChance(0.9, 0)).toBe(1);
        });
    });

    describe('getAttendantTier', () => {
        it('behaelt die id der Basis-Tier bei', () => {
            expect(getAttendantTier(risky, 0.5, 0.35).id).toBe('risky');
        });

        it('skaliert die payoutRange mit der Effizienz', () => {
            const derived = getAttendantTier(risky, 1, 0.35);
            expect(derived.payoutRange[0]).toBeCloseTo(14 * ATTENDANT_MAX_EFFICIENCY);
            expect(derived.payoutRange[1]).toBeCloseTo(22 * ATTENDANT_MAX_EFFICIENCY);
        });

        it('nutzt getAttendantFailureChance fuer die failureChance', () => {
            const derived = getAttendantTier(balanced, 1, 0.15);
            expect(derived.failureChance).toBeCloseTo(0.15);
        });

        it('lässt "safe" unabhaengig von Effizienz/Musterkenntnis niemals scheitern', () => {
            const derived = getAttendantTier(safe, 0, 0);
            expect(derived.failureChance).toBe(0);
        });
    });

    describe('chooseAttendantTier', () => {
        it('wirft bei leerer tiers-Liste', () => {
            expect(() => chooseAttendantTier([], 0.5)).toThrow(RangeError);
        });

        it('waehlt bei Musterkenntnis 0 den sichersten Tier', () => {
            expect(chooseAttendantTier(tiers, 0)).toBe(safe);
        });

        it('waehlt bei voller Musterkenntnis den riskantesten Tier', () => {
            expect(chooseAttendantTier(tiers, 1)).toBe(risky);
        });

        it('waehlt bei mittlerer Musterkenntnis einen mittleren Tier', () => {
            expect(chooseAttendantTier(tiers, 0.5)).toBe(balanced);
        });
    });

    describe('gainKnowledgeFromManualPlay / gainKnowledgeFromTraining', () => {
        it('erhoeht die Musterkenntnis um MANUAL_KNOWLEDGE_GAIN bzw. TRAINING_KNOWLEDGE_GAIN', () => {
            expect(gainKnowledgeFromManualPlay(0.5)).toBeCloseTo(0.5 + MANUAL_KNOWLEDGE_GAIN);
            expect(gainKnowledgeFromTraining(0.5)).toBeCloseTo(0.5 + TRAINING_KNOWLEDGE_GAIN);
        });

        it('klemmt bei 1', () => {
            expect(gainKnowledgeFromManualPlay(0.999)).toBe(1);
            expect(gainKnowledgeFromTraining(0.999)).toBe(1);
        });

        it('manuelles Spielen steigert die Musterkenntnis schneller als Credits-Training (game-spec.md 3.2)', () => {
            expect(MANUAL_KNOWLEDGE_GAIN).toBeGreaterThan(TRAINING_KNOWLEDGE_GAIN);
        });
    });
});
