import { describe, expect, it } from 'vitest';
import { PushYourLuckRun } from './PushYourLuckEngine';
import type { Milestone, RiskTier } from './types';

const safeTier: RiskTier = { id: 'safe', payoutRange: [5, 5], failureChance: 0 };
const balancedTier: RiskTier = { id: 'balanced', payoutRange: [10, 20], failureChance: 0.3 };
const riskyTier: RiskTier = { id: 'risky', payoutRange: [30, 60], failureChance: 0.6 };

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

        it('Fehlschlag setzt Punktestand auf 0 zurück und beendet den Lauf als "busted"', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0.9999, 0])); // Score 5
            const result = run.resolveAction(riskyTier, scriptedRng([0.1])); // 0.1 < 0.6 -> Fehlschlag

            expect(result.success).toBe(false);
            expect(result.payout).toBe(0);
            expect(result.scoreAfter).toBe(0);
            expect(run.getScore()).toBe(0);
            expect(run.getStatus()).toBe('busted');
        });

        it('wirft, wenn der Lauf bereits busted ist', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(riskyTier, scriptedRng([0.1]));

            expect(() => run.resolveAction(safeTier, scriptedRng([0]))).toThrow(/busted/);
        });

        it('wirft, wenn der Lauf bereits gebankt ist', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10, Meilenstein 10 erreicht
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

        it('bank() wirft nach einem Fehlschlag (busted, Score bereits 0)', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(safeTier, scriptedRng([0, 0]));
            run.resolveAction(safeTier, scriptedRng([0, 0])); // Score 10, bankbar
            run.resolveAction(riskyTier, scriptedRng([0])); // Fehlschlag -> busted, Score 0

            expect(() => run.bank()).toThrow(/Banking/);
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
