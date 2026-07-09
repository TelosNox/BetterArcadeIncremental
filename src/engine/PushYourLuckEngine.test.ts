import { describe, expect, it } from 'vitest';
import { PushYourLuckRun } from './PushYourLuckEngine';
import type { Milestone, ResolvedAction } from './types';

const bigWin: ResolvedAction = { id: 'big', payoutRange: [16, 22] };
const simpleHit: ResolvedAction = { id: 'simple', payoutRange: [5, 8] };
const loss: ResolvedAction = { id: 'loss', payoutRange: [-10, -7] };

const milestones: Milestone[] = [
    { threshold: 10, bankable: true },
    { threshold: 25, bankable: false }, // "point of no return": erreichbar, aber nicht bankbar
    { threshold: 50, bankable: true },
];

// rng-Sequenz aus vorgegebenen Werten abarbeiten. Phase 7c: resolveAction
// braucht nur noch EINEN rng()-Aufruf pro Aktion (die Payout-Position
// innerhalb der Spanne) -- der fruehere zusaetzliche Fehlschlag-Check-Aufruf
// entfaellt, da jede Aktion garantiert trifft (siehe PushYourLuckEngine.ts).
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
        it('zieht einen Payout innerhalb der konfigurierten Spanne und addiert ihn (Baukasten 1.11)', () => {
            const run = new PushYourLuckRun(milestones);
            const result = run.resolveAction(simpleHit, scriptedRng([0.5])); // Mitte der Spanne

            expect(result.payout).toBe(6.5); // 5 + 0.5 * (8 - 5)
            expect(result.scoreAfter).toBe(6.5);
            expect(run.getScore()).toBe(6.5);
        });

        it('trifft am unteren Rand der Spanne bei rng 0', () => {
            const run = new PushYourLuckRun(milestones);
            const result = run.resolveAction(bigWin, scriptedRng([0]));
            expect(result.payout).toBe(16);
        });

        it('trifft am oberen Rand der Spanne bei rng nahe 1', () => {
            const run = new PushYourLuckRun(milestones);
            const result = run.resolveAction(bigWin, scriptedRng([0.9999]));
            expect(result.payout).toBeCloseTo(22, 2);
        });

        // Phase 7c (Kernmechanik-Revision v2, siehe STATUS.md): das Phase-7b-
        // Konzept "Fehlschlag zieht FAILURE_PENALTY_FRACTION des aktuellen
        // Punktestands ab" entfaellt komplett. Ein Verlust ist jetzt ein
        // EIGENER, fester (negativer) Payout-Bereich der Aktion selbst --
        // diese Tests ersetzen die alten FAILURE_PENALTY_FRACTION-Tests
        // bewusst (gewollte Verhaltensaenderung, keine Regression).
        it('ein Verlust-Payout (negative Spanne) zieht den Punktestand direkt ab, Lauf bleibt aktiv', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0])); // Score 16
            const result = run.resolveAction(loss, scriptedRng([0])); // -10 (unterer Rand von [-10,-7], betragsmaessig am groessten)

            expect(result.payout).toBe(-10);
            expect(result.scoreAfter).toBeCloseTo(6);
            expect(run.getScore()).toBeCloseTo(6);
            expect(run.getStatus()).toBe('active');
        });

        it('klemmt den Punktestand bei 0, wenn ein Verlust ihn sonst negativ machen wuerde', () => {
            const run = new PushYourLuckRun(milestones);
            const result = run.resolveAction(loss, scriptedRng([0])); // Score 0 - 10 -> geklemmt auf 0
            expect(result.scoreAfter).toBe(0);
            expect(run.getScore()).toBe(0);
        });

        it('mehrere aufeinanderfolgende Verluste reduzieren den Punktestand kumulativ, ohne den Lauf zu beenden', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0.9999])); // Score ~22
            run.resolveAction(loss, scriptedRng([0])); // -10: ~12
            run.resolveAction(loss, scriptedRng([0])); // -10: ~2

            expect(run.getScore()).toBeCloseTo(2, 1);
            expect(run.getStatus()).toBe('active');
        });

        it('wirft, wenn der Lauf bereits gebankt ist', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0]));
            run.resolveAction(bigWin, scriptedRng([0])); // Score 32
            run.bank();

            expect(() => run.resolveAction(bigWin, scriptedRng([0]))).toThrow(/banked/);
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
            for (let i = 0; i < 2; i += 1) {
                run.resolveAction(bigWin, scriptedRng([0.9999])); // ~22 je Schritt -> Score ~44 nach 2 Schritten
            }

            const reached = run.getReachedMilestones().map((m) => m.threshold);
            expect(reached).toEqual([10, 25]);
        });

        it('erkennt mehrere erreichte Meilensteine gleichzeitig, inklusive nicht-bankbarer', () => {
            const run = new PushYourLuckRun(milestones);
            // 2x bigWin (Payout je ~22 bei rng 0.9999) -> Score ~44: Meilenstein 10 (bankable) und 25 (nicht bankable) erreicht
            run.resolveAction(bigWin, scriptedRng([0.9999]));
            run.resolveAction(bigWin, scriptedRng([0.9999]));

            expect(run.getScore()).toBeCloseTo(44, 0);
            expect(run.getReachedMilestones().map((m) => m.threshold)).toEqual([10, 25]);
            expect(run.getNextMilestone()).toEqual({ threshold: 50, bankable: true });
        });

        // Phase 7b/7c: Meilenstein-Erreichung ist bewusst "sticky" (Peak-
        // basiert) -- ein einmal erreichter Meilenstein bleibt erreicht,
        // auch wenn eine spaetere Aktion mit Verlust-Ausgang den AKTUELLEN
        // Punktestand wieder unter die Schwelle drueckt.
        it('bleibt bei einem erreichten Meilenstein, auch wenn ein Verlust den aktuellen Punktestand darunter drueckt', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0])); // Score 16, Meilenstein 10 erreicht
            run.resolveAction(loss, scriptedRng([0])); // -10: Score 6

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
            run.resolveAction(bigWin, scriptedRng([0])); // Score 16
            expect(run.canBank()).toBe(true);
        });

        it('bank() wirft, wenn noch kein bankbarer Meilenstein erreicht wurde', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(simpleHit, scriptedRng([0])); // Score 5, < erster Meilenstein
            expect(() => run.bank()).toThrow(/Banking/);
        });

        it('bank() sichert den aktuellen Punktestand und beendet den Lauf', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0])); // Score 16

            const banked = run.bank();

            expect(banked).toBe(16);
            expect(run.getStatus()).toBe('banked');
        });

        // Ersetzt den alten Test "bank() sichert nur den reduzierten
        // aktuellen Punktestand nach einer Teilstrafe" -- Teilstrafen
        // existieren nicht mehr, das gleichwertige Verhalten fuer Phase 7c
        // ist: Banking bleibt nach einem Verlust moeglich (Peak-
        // Stickiness), sichert aber nur den TATSAECHLICHEN (durch den
        // Verlust reduzierten) Punktestand.
        it('bank() bleibt nach einem Verlust moeglich, sichert aber nur den reduzierten aktuellen Punktestand', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0])); // Score 16, bankbar
            run.resolveAction(loss, scriptedRng([0])); // -10: Score 6

            expect(run.canBank()).toBe(true);
            const banked = run.bank();
            expect(banked).toBeCloseTo(6);
            expect(run.getStatus()).toBe('banked');
        });

        it('bank() wirft bei erneutem Aufruf nach erfolgreichem Banking', () => {
            const run = new PushYourLuckRun(milestones);
            run.resolveAction(bigWin, scriptedRng([0])); // Score 16
            run.bank();

            expect(() => run.bank()).toThrow(/Banking/);
        });
    });
});
