import { describe, expect, it } from 'vitest';
import { FAILURE_PENALTY_FRACTION, PushYourLuckRun } from './PushYourLuckEngine';
import type { Milestone, ResolvedAction } from './types';

const safeTier: ResolvedAction = { id: 'safe', payoutRange: [5, 5], failureChance: 0 };
const balancedTier: ResolvedAction = { id: 'balanced', payoutRange: [10, 20], failureChance: 0.3 };
const riskyTier: ResolvedAction = { id: 'risky', payoutRange: [30, 60], failureChance: 0.6 };

const milestones: Milestone[] = [
    { threshold: 10, bankable: true },
    { threshold: 25, bankable: false }, // "point of no return": erreichbar, aber nicht bankbar
    { threshold: 50, bankable: true },
];

// rng-Sequenz aus vorgegebenen Werten abarbeiten, wie es resolveAction
// braucht (1 Aufruf bei Fehlschlag, 2 Aufrufe bei Erfolg: Fehlschlag-Check
// + Payout-Position innerhalb der Spanne).
function scriptedRng(values: number[]): () => number {
    let i = 0;
    return () => {
        if (i >= values.length) {
            throw new Error('scriptedRng: keine weiteren Werte vorbereitet');
        }
        return values[i++];
    };
}

describe('PushYourLuckRun', () => {
    describe('Konstruktion', () => {
        it('wirft bei leerer Meilenstein-Liste', () => {
            expect(() => new PushYourLuckRun([])).toThrow(RangeError);
        });

        it('wirft bei negativem Schwellenwert', () => {
            expect(() => new PushYourLuckRun([{ threshold: -1, bankable: true }])).toThrow(RangeError);
        });

        it('startet aktiv mit Punktestand 0', () => {
            const run = new PushYourLuckRun(milestones);
            expect(run.getStatus()).toBe('active');
            expect(run.getScore()).toBe(0);
        });
    });

    describe('resolveAction', () => {
        it('safe (failureChance 0) gelingt immer und addiert den Payout', () => {
            const run = new PushYourLuckRun(milestones);
            const result = run.resolveAction(safeTier, scriptedRng([0.9999, 0]));

            expect(result.success).toBe(true);
            expect(result.payout).toBe(5);
            expect(result.penalty).toBe(0);
            expect(result.scoreAfter).toBe(5);
            expect(run.getScore()).toBe(5);
        });

        it('Payout liegt innerhalb der konfigurierten Spanne (sichtbare Bandbreite, Baukasten 1.11)', () => {
            const run = new PushYourLuckRun(milestones);
            // Fehlschlag-Check: 0.9 >= 0.3 -> kein Fehlschlag; Payout-Position: 0.5 -> Mitte der Spanne
            const result = run.resolveAction(balancedTier, scriptedRng([0.9, 0.5]));

            expect(result.success).toBe(true);
            expect(result.payout).toBe(15); // 10 + 0.5 * (20 - 10)
        });

        it('Grenzfall: rng-Wert exakt an failureChance zählt nicht als Fehlschlag', () => {
            const run = new PushYourLuckRun(milestones);
            const result = run.resolveAction(balancedTier, scriptedRng([0.3, 0]));
            expect(result.success).toBe(true);
        });

        // Phase 7b (Kernmechanik-Revision, siehe STATUS.md): das fruehere
        // harte Run-Ende bei Fehlschlag ("busted", Score auf 0) entfaellt.
        // Ein Fehlschlag kostet stattdessen nur einen Teil
        // (FAILURE_PENALTY_FRACTION) des AKTUELLEN Punktestands, der Lauf
        // bleibt 'active'. Diese Tests ersetzen die alten busted-Tests
        // bewusst (gewollte Verhaltensaenderung, keine Regression, siehe
        // STATUS.md Aufstellung der geaenderten Tests).
        it('Fehlschlag zieht FAILURE_PENALTY_FRACTION des aktuellen Punktestands ab, Lauf bleibt aktiv', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0.9999, 0])); // Score 5
            const result = run.resolveAction(riskyTier, scriptedRng([0.1])); // 0.1 < 0.6 -> Fehlschlag

            expect(result.success).toBe(false);
            expect(result.payout).toBe(0);
            expect(result.penalty).toBeCloseTo(5 * FAILURE_PENALTY_FRACTION);
            expect(result.scoreAfter).toBeCloseTo(5 - 5 * FAILURE_PENALTY_FRACTION);
            expect(run.getScore()).toBeCloseTo(5 - 5 * FAILURE_PENALTY_FRACTION);
            expect(run.getStatus()).toBe('active');
        });

        it('FAILURE_PENALTY_FRACTION liegt im Richtwert 30-50% (STATUS.md Phase 7b)', () => {
            expect(FAILURE_PENALTY_FRACTION).toBeGreaterThanOrEqual(0.3);
            expect(FAILURE_PENALTY_FRACTION).toBeLessThanOrEqual(0.5);
        });

        it('erlaubt eine abweichende penaltyFraction als optionalen Parameter', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0.9999, 0])); // Score 5
            const result = run.resolveAction(riskyTier, scriptedRng([0.1]), 0.5);

            expect(result.penalty).toBeCloseTo(2.5);
            expect(result.scoreAfter).toBeCloseTo(2.5);
        });

        it('mehrere aufeinanderfolgende Fehlschlaege reduzieren den Punktestand kumulativ, ohne den Lauf zu beenden', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0.9999, 0])); // Score 5
            run.resolveAction(riskyTier, scriptedRng([0.1])); // Fehlschlag: 5 -> 3
            run.resolveAction(riskyTier, scriptedRng([0.1])); // Fehlschlag: 3 -> 1.8

            expect(run.getScore()).toBeCloseTo(1.8);
            expect(run.getStatus()).toBe('active');
        });

        it('wirft, wenn der Lauf bereits gebankt ist', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10
            run.bank();

            expect(() => run.resolveAction(safeTier, scriptedRng([0]))).toThrow(/banked/);
        });
    });

    describe('Meilenstein-Auswertung', () => {
        it('meldet noch keinen erreichten Meilenstein bei Punktestand 0', () => {
            const run = new PushYourLuckRun(milestones);
            expect(run.getReachedMilestones()).toEqual([]);
            expect(run.getNextMilestone()).toEqual({ threshold: 10, bankable: true });
        });

        it('sortiert Meilensteine unabhängig von der Eingabereihenfolge aufsteigend aus', () => {
            const unsorted: Milestone[] = [
                { threshold: 50, bankable: true },
                { threshold: 10, bankable: true },
                { threshold: 25, bankable: false },
            ];
            const run = new PushYourLuckRun(unsorted);
            for (let i = 0; i < 6; i += 1) {
                run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 30
            }

            const reached = run.getReachedMilestones().map((m) => m.threshold);
            expect(reached).toEqual([10, 25]);
        });

        it('erkennt mehrere erreichte Meilensteine gleichzeitig, inklusive nicht-bankbarer', () => {
            const run = new PushYourLuckRun(milestones);
            // 6x safe (Payout 5) -> Score 30: Meilenstein 10 (bankable) und 25 (nicht bankable) erreicht
            for (let i = 0; i < 6; i += 1) {
                run.resolveAction(safeTier, scriptedRng([0, 0]));
            }

            expect(run.getScore()).toBe(30);
            expect(run.getReachedMilestones().map((m) => m.threshold)).toEqual([10, 25]);
            expect(run.getNextMilestone()).toEqual({ threshold: 50, bankable: true });
        });

        // Phase 7b: Meilenstein-Erreichung ist bewusst "sticky" (Peak-basiert,
        // siehe Klassenkommentar in PushYourLuckEngine.ts) -- ein einmal
        // erreichter Meilenstein bleibt erreicht, auch wenn ein spaeterer
        // Fehlschlag den AKTUELLEN Punktestand wieder unter die Schwelle
        // drueckt. Ohne diese Regel wuerde eine Teilstrafe denselben Effekt
        // wie das alte harte Run-Ende auf die Banking-Berechtigung haben.
        it('bleibt bei einem erreichten Meilenstein, auch wenn ein Fehlschlag den aktuellen Punktestand darunter drueckt', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10, Meilenstein 10 erreicht
            run.resolveAction(riskyTier, scriptedRng([0.1])); // Fehlschlag: Score 10 -> 6

            expect(run.getScore()).toBeCloseTo(6);
            expect(run.getReachedMilestones()).toEqual([{ threshold: 10, bankable: true }]);
        });
    });

    describe('Banking', () => {
        it('canBank ist false, solange kein bankbarer Meilenstein erreicht wurde', () => {
            const run = new PushYourLuckRun(milestones);
            expect(run.canBank()).toBe(false);
        });

        it('canBank wird true, sobald ein bankbarer Meilenstein erreicht ist', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10
            expect(run.canBank()).toBe(true);
        });

        it('bleibt bankbar an einem nicht-bankbaren Meilenstein, solange ein früherer bankbarer erreicht bleibt', () => {
            const run = new PushYourLuckRun(milestones);
            for (let i = 0; i < 5; i += 1) {
                run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 25 (Meilenstein 25 nicht bankbar)
            }
            expect(run.getScore()).toBe(25);
            expect(run.canBank()).toBe(true); // Meilenstein 10 (bankable) bereits erreicht
        });

        it('bank() wirft, wenn noch kein bankbarer Meilenstein erreicht wurde', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 5, < erster Meilenstein
            expect(() => run.bank()).toThrow(/Banking/);
        });

        it('bank() sichert den aktuellen Punktestand und beendet den Lauf', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10

            const banked = run.bank();

            expect(banked).toBe(10);
            expect(run.getStatus()).toBe('banked');
        });

        // Ersetzt den alten Test "bank() wirft nach einem Fehlschlag (busted,
        // Score bereits 0)" -- busted existiert nicht mehr. Neues, bewusst
        // gegenteiliges Verhalten (Phase 7b): Banking bleibt nach einem
        // Fehlschlag moeglich, sofern zuvor ein bankbarer Meilenstein
        // erreicht wurde (Peak-Stickiness), sichert aber nur den
        // TATSAECHLICHEN (durch die Teilstrafe reduzierten) Punktestand.
        it('bank() bleibt nach einem Fehlschlag moeglich, sichert aber nur den reduzierten aktuellen Punktestand', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10, bankbar
            run.resolveAction(riskyTier, scriptedRng([0.1])); // Fehlschlag: Score 10 -> 6

            expect(run.canBank()).toBe(true);
            const banked = run.bank();
            expect(banked).toBeCloseTo(6);
            expect(run.getStatus()).toBe('banked');
        });

        it('bank() wirft bei erneutem Aufruf nach erfolgreichem Banking', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10
            run.bank();

            expect(() => run.bank()).toThrow(/Banking/);
        });
    });
});
