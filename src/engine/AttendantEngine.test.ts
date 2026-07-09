import { describe, expect, it } from 'vitest';
import {
    ATTENDANT_MAX_EFFICIENCY,
    MANUAL_KNOWLEDGE_GAIN,
    TRAINING_KNOWLEDGE_GAIN,
    chooseAttendantAction,
    chooseAttendantIntermediateTier,
    gainKnowledgeFromManualPlay,
    gainKnowledgeFromTraining,
    getAttendantEfficiency,
    getAttendantLookahead,
    getAttendantResolvedAction,
} from './AttendantEngine';
import type { HardActionDef, IntermediateActionDef, ResolvedAction } from './types';

const safe: IntermediateActionDef = { kind: 'intermediate', id: 'safe', payoutRange: [3, 3], failureChance: 0 };
const balanced: IntermediateActionDef = {
    kind: 'intermediate',
    id: 'balanced',
    payoutRange: [6, 10],
    failureChance: 0.15,
};
const risky: IntermediateActionDef = {
    kind: 'intermediate',
    id: 'risky',
    payoutRange: [14, 22],
    failureChance: 0.35,
};
const tiers = [safe, balanced, risky];

const hardA: HardActionDef = { kind: 'hard', id: 'blitzlauf', payoutRange: [12, 19], counterState: 'alarm' };
const hardB: HardActionDef = { kind: 'hard', id: 'schleichgang', payoutRange: [15, 23], counterState: 'nah' };
const hardActions = [hardA, hardB];

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

    describe('getAttendantLookahead', () => {
        it('ist 0 bei Musterkenntnis 0, unabhaengig vom sichtbaren Fenster', () => {
            expect(getAttendantLookahead(3, 0)).toBe(0);
        });

        it('entspricht bei voller Musterkenntnis genau dem sichtbaren Fenster (wie ein Spieler)', () => {
            expect(getAttendantLookahead(3, 1)).toBe(3);
            expect(getAttendantLookahead(1, 1)).toBe(1);
        });

        it('rundet auf ganze Zug-Anzahl ab', () => {
            expect(getAttendantLookahead(3, 0.5)).toBe(1); // floor(1.5)
        });

        it('klemmt Musterkenntnis ausserhalb [0, 1]', () => {
            expect(getAttendantLookahead(3, -1)).toBe(0);
            expect(getAttendantLookahead(3, 2)).toBe(3);
        });
    });

    describe('getAttendantResolvedAction', () => {
        const resolved: ResolvedAction = { id: 'blitzlauf', payoutRange: [12, 19], failureChance: 0 };

        it('behaelt die id bei', () => {
            expect(getAttendantResolvedAction(resolved, 0.5).id).toBe('blitzlauf');
        });

        it('skaliert die payoutRange mit der Effizienz', () => {
            const derived = getAttendantResolvedAction(resolved, 1);
            expect(derived.payoutRange[0]).toBeCloseTo(12 * ATTENDANT_MAX_EFFICIENCY);
            expect(derived.payoutRange[1]).toBeCloseTo(19 * ATTENDANT_MAX_EFFICIENCY);
        });

        it('laesst die failureChance unveraendert (0 bleibt 0)', () => {
            expect(getAttendantResolvedAction(resolved, 0).failureChance).toBe(0);
        });

        it('laesst eine failureChance von 1 (harte Aktion am Gegenstueck) unveraendert', () => {
            const failing: ResolvedAction = { id: 'blitzlauf', payoutRange: [12, 19], failureChance: 1 };
            expect(getAttendantResolvedAction(failing, 1).failureChance).toBe(1);
        });

        it('laesst eine feste Zwischenstufen-Fangchance unveraendert', () => {
            const intermediate: ResolvedAction = { id: 'risky', payoutRange: [14, 22], failureChance: 0.35 };
            expect(getAttendantResolvedAction(intermediate, 1).failureChance).toBeCloseTo(0.35);
        });
    });

    describe('chooseAttendantIntermediateTier', () => {
        it('wirft bei leerer tiers-Liste', () => {
            expect(() => chooseAttendantIntermediateTier([], 0.5)).toThrow(RangeError);
        });

        it('waehlt bei Musterkenntnis 0 die sicherste Zwischenstufe', () => {
            expect(chooseAttendantIntermediateTier(tiers, 0)).toBe(safe);
        });

        it('waehlt bei voller Musterkenntnis die riskanteste Zwischenstufe', () => {
            expect(chooseAttendantIntermediateTier(tiers, 1)).toBe(risky);
        });

        it('waehlt bei mittlerer Musterkenntnis eine mittlere Zwischenstufe', () => {
            expect(chooseAttendantIntermediateTier(tiers, 0.5)).toBe(balanced);
        });
    });

    describe('chooseAttendantAction', () => {
        it('waehlt am Gegenstueck von hardA die andere harte Aktion (hardB)', () => {
            expect(chooseAttendantAction(hardActions, tiers, 'alarm', 1)).toBe(hardB);
        });

        it('waehlt am Gegenstueck von hardB die andere harte Aktion (hardA)', () => {
            expect(chooseAttendantAction(hardActions, tiers, 'nah', 1)).toBe(hardA);
        });

        it('waehlt am neutralen Zustand die harte Aktion mit dem hoeheren Payout', () => {
            // neutral: weder hardA.counterState ('alarm') noch hardB.counterState ('nah')
            // hardB (Mittelwert 19) hat einen hoeheren Payout als hardA (Mittelwert 15.5)
            expect(chooseAttendantAction(hardActions, tiers, 'fern', 1)).toBe(hardB);
        });

        it('faellt bei unbekanntem Zustand (ausserhalb des eigenen Lookaheads) auf eine Zwischenstufe zurueck', () => {
            expect(chooseAttendantAction(hardActions, tiers, undefined, 0)).toBe(safe);
            expect(chooseAttendantAction(hardActions, tiers, undefined, 1)).toBe(risky);
        });

        it('raet nie blind auf eine harte Aktion, auch nicht bei hoher Musterkenntnis', () => {
            const result = chooseAttendantAction(hardActions, tiers, undefined, 0.99);
            expect(result.kind).toBe('intermediate');
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
