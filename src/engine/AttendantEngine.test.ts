import { describe, expect, it } from 'vitest';
import {
    ATTENDANT_MAX_EFFICIENCY,
    MANUAL_KNOWLEDGE_GAIN,
    TRAINING_KNOWLEDGE_GAIN,
    chooseAttendantAction,
    gainKnowledgeFromManualPlay,
    gainKnowledgeFromTraining,
    getAttendantEfficiency,
    getAttendantLookahead,
    getAttendantPrecision,
    getAttendantResolvedAction,
} from './AttendantEngine';
import type { CyclicActionDef, ResolvedAction } from './types';

// Handgebaute Fixture statt Import aus src/data/machines.config.ts -- die
// Engine-Tests bleiben damit unabhaengig von der konkreten Automaten-
// Konfiguration (wie schon vor Phase 7c). 5 Zustaende/Aktionen im selben
// Zyklus wie "Greed Run" (machines.config.ts), aber hier bewusst eigenstaendig
// definiert: actions[i] gewinnt bei states[i+1], verliert bei states[i-1].
const states = ['fern', 'nah', 'alarm', 'sichtkontakt', 'rueckzug'];
const payouts = { payoutBig: [16, 22] as [number, number], payoutSimple: [5, 8] as [number, number], payoutLoss: [-10, -7] as [number, number] };
const actions: CyclicActionDef[] = ['sprint', 'schleicher', 'ablenker', 'versteck', 'vorstoss'].map((id, i) => ({
    id,
    counterState: states[(i + 1) % states.length],
    losesToState: states[(i - 1 + states.length) % states.length],
    ...payouts,
}));
// actions[0] = sprint: win 'nah', loss 'rueckzug'

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
        it('ist 0 bei Musterkenntnis 0, unabhaengig von der gekauften Tiefe', () => {
            expect(getAttendantLookahead(3, 0)).toBe(0);
        });

        it('entspricht bei voller Musterkenntnis genau der gekauften Tiefe (wie ein Spieler)', () => {
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

    describe('getAttendantPrecision', () => {
        it('ist 0 bei Musterkenntnis 0, unabhaengig von der gekauften Praezision', () => {
            expect(getAttendantPrecision(4, 0)).toBe(0);
        });

        it('entspricht bei voller Musterkenntnis genau der gekauften Praezision', () => {
            expect(getAttendantPrecision(4, 1)).toBe(4);
        });

        it('rundet auf eine ganze Kandidatenzahl ab', () => {
            expect(getAttendantPrecision(4, 0.5)).toBe(2);
        });
    });

    describe('getAttendantResolvedAction', () => {
        const resolved: ResolvedAction = { id: 'sprint', payoutRange: [16, 22] };

        it('behaelt die id bei', () => {
            expect(getAttendantResolvedAction(resolved, 0.5).id).toBe('sprint');
        });

        it('skaliert die payoutRange mit der Effizienz', () => {
            const derived = getAttendantResolvedAction(resolved, 1);
            expect(derived.payoutRange[0]).toBeCloseTo(16 * ATTENDANT_MAX_EFFICIENCY);
            expect(derived.payoutRange[1]).toBeCloseTo(22 * ATTENDANT_MAX_EFFICIENCY);
        });

        it('skaliert auch eine negative (Verlust-)Spanne einheitlich', () => {
            const loss: ResolvedAction = { id: 'sprint', payoutRange: [-10, -7] };
            const derived = getAttendantResolvedAction(loss, 1);
            expect(derived.payoutRange[0]).toBeCloseTo(-10 * ATTENDANT_MAX_EFFICIENCY);
            expect(derived.payoutRange[1]).toBeCloseTo(-7 * ATTENDANT_MAX_EFFICIENCY);
        });

        it('liefert 0-Spanne bei Musterkenntnis 0', () => {
            const derived = getAttendantResolvedAction(resolved, 0);
            expect(derived.payoutRange[0]).toBe(0);
            expect(derived.payoutRange[1]).toBe(0);
        });
    });

    describe('chooseAttendantAction', () => {
        it('wirft bei leerer actions-Liste', () => {
            expect(() => chooseAttendantAction([], undefined)).toThrow(RangeError);
        });

        it('waehlt bei exakt bekanntem Zustand (1 verbleibender Kandidat) die dort konternde Aktion', () => {
            // actions[0].counterState === 'nah' -> bei bekanntem Zustand 'nah' gewinnt actions[0]
            expect(chooseAttendantAction(actions, ['nah'])).toBe(actions[0]);
        });

        it('waehlt bei jedem anderen exakt bekannten Zustand konsistent die jeweils konternde Aktion', () => {
            for (const action of actions) {
                expect(chooseAttendantAction(actions, [action.counterState])).toBe(action);
            }
        });

        it('meidet bei partieller Information eine Aktion, deren Verlust-Zustand noch Kandidat ist', () => {
            // actions[0] (sprint) verliert bei 'rueckzug'. Bleibt 'rueckzug' als Kandidat,
            // aber gewinnt actions[0] bei 'nah' (nicht mehr Kandidat) -> sprint ist unsicher.
            const remaining = ['rueckzug', 'sichtkontakt']; // 2 von 5 Kandidaten uebrig
            const result = chooseAttendantAction(actions, remaining);
            expect(result.losesToState).not.toBe('rueckzug');
            // duerfte auch nicht 'sichtkontakt' als losesToState haben, da ebenfalls Kandidat
            expect(remaining).not.toContain(result.losesToState);
        });

        it('bevorzugt unter sicheren Aktionen eine, deren Gewinn-Zustand noch moeglich ist', () => {
            // versteck (actions[3]) gewinnt bei 'rueckzug', verliert bei 'alarm'.
            // Kandidaten: 'rueckzug' (Gewinn fuer versteck) und 'fern' (neutral fuer alle).
            const remaining = ['rueckzug', 'fern'];
            const result = chooseAttendantAction(actions, remaining);
            expect(result.counterState).toBe('rueckzug');
        });

        it('faellt bei komplett fehlender Information (undefined) auf eine feste Wahl zurueck', () => {
            expect(chooseAttendantAction(actions, undefined)).toBe(actions[0]);
        });

        it('faellt bei allen Zustaenden als Kandidat (Praezision 0) auf dieselbe feste Wahl zurueck', () => {
            expect(chooseAttendantAction(actions, [...states])).toBe(actions[0]);
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
