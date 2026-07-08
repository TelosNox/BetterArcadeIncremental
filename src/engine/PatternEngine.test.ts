import { describe, expect, it } from 'vitest';
import { PatternEngine } from './PatternEngine';
import type { PatternConfig } from './types';

// Deterministischer PRNG (mulberry32) fuer reproduzierbare Stichproben in
// den Verteilungs-Tests, statt Math.random() zu mocken.
function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const patrolConfig: PatternConfig = {
    states: ['aggressiv', 'defensiv', 'finte'],
    transitions: {
        aggressiv: { aggressiv: 0.5, defensiv: 0.3, finte: 0.2 },
        defensiv: { aggressiv: 0.6, defensiv: 0.4 },
        finte: { aggressiv: 1 },
    },
    baseVisibility: 0.34,
    visibilityPerUpgrade: [0.33, 0.33],
};

describe('PatternEngine', () => {
    describe('Konfigurationsvalidierung', () => {
        it('wirft bei leerer states-Liste', () => {
            expect(
                () => new PatternEngine({ states: [], transitions: {}, baseVisibility: 0, visibilityPerUpgrade: [] }),
            ).toThrow(RangeError);
        });

        it('wirft, wenn Übergangswahrscheinlichkeiten eines Zustands nicht auf 1 summieren', () => {
            const broken: PatternConfig = {
                states: ['a', 'b'],
                transitions: { a: { b: 0.5 } },
                baseVisibility: 0,
                visibilityPerUpgrade: [],
            };
            expect(() => new PatternEngine(broken)).toThrow(/summieren sich auf/);
        });

        it('wirft bei Übergang zu unbekanntem Zielzustand', () => {
            const broken: PatternConfig = {
                states: ['a'],
                transitions: { a: { unbekannt: 1 } },
                baseVisibility: 0,
                visibilityPerUpgrade: [],
            };
            expect(() => new PatternEngine(broken)).toThrow(/unbekannter Zustand/);
        });

        it('wirft bei Übergang von unbekanntem Quellzustand', () => {
            const broken: PatternConfig = {
                states: ['a'],
                transitions: { unbekannt: { a: 1 } },
                baseVisibility: 0,
                visibilityPerUpgrade: [],
            };
            expect(() => new PatternEngine(broken)).toThrow(/unbekanntem Zustand/);
        });

        it('wirft bei negativer Wahrscheinlichkeit', () => {
            const broken: PatternConfig = {
                states: ['a', 'b'],
                transitions: { a: { a: 1.5, b: -0.5 } },
                baseVisibility: 0,
                visibilityPerUpgrade: [],
            };
            expect(() => new PatternEngine(broken)).toThrow(RangeError);
        });

        it('wirft bei baseVisibility außerhalb [0, 1]', () => {
            const broken: PatternConfig = {
                states: ['a'],
                transitions: {},
                baseVisibility: 1.1,
                visibilityPerUpgrade: [],
            };
            expect(() => new PatternEngine(broken)).toThrow(RangeError);
        });

        it('akzeptiert einen Zustand ohne ausgehende Übergänge (terminal)', () => {
            const config: PatternConfig = {
                states: ['a', 'ende'],
                transitions: { a: { ende: 1 } },
                baseVisibility: 0,
                visibilityPerUpgrade: [],
            };
            expect(() => new PatternEngine(config)).not.toThrow();
        });
    });

    describe('getVisibility', () => {
        it('liefert baseVisibility ohne Upgrades', () => {
            const engine = new PatternEngine(patrolConfig);
            expect(engine.getVisibility(0)).toBeCloseTo(0.34);
        });

        it('addiert visibilityPerUpgrade kumulativ pro Stufe', () => {
            const engine = new PatternEngine(patrolConfig);
            expect(engine.getVisibility(1)).toBeCloseTo(0.67);
            expect(engine.getVisibility(2)).toBeCloseTo(1);
        });

        it('klemmt bei 1, auch wenn weitere Stufen angefragt werden', () => {
            const engine = new PatternEngine(patrolConfig);
            expect(engine.getVisibility(10)).toBe(1);
        });

        it('behandelt negative Upgrade-Level wie Level 0', () => {
            const engine = new PatternEngine(patrolConfig);
            expect(engine.getVisibility(-3)).toBeCloseTo(0.34);
        });
    });

    describe('getTransitionDistribution', () => {
        it('liefert die volle Verteilung absteigend nach Wahrscheinlichkeit sortiert', () => {
            const engine = new PatternEngine(patrolConfig);
            const distribution = engine.getTransitionDistribution('aggressiv');

            expect(distribution).toEqual([
                { to: 'aggressiv', probability: 0.5 },
                { to: 'defensiv', probability: 0.3 },
                { to: 'finte', probability: 0.2 },
            ]);
        });

        it('liefert eine leere Liste für einen terminalen/unbekannten Zustand', () => {
            const engine = new PatternEngine(patrolConfig);
            expect(engine.getTransitionDistribution('unbekannt')).toEqual([]);
        });
    });

    describe('getVisibleDistribution', () => {
        it('deckt bei Level 0 (baseVisibility 0.34, 3 Einträge) genau einen Eintrag auf', () => {
            const engine = new PatternEngine(patrolConfig);
            const visible = engine.getVisibleDistribution('aggressiv', 0);

            expect(visible.filter((e) => e.revealed)).toHaveLength(1);
            expect(visible[0]).toEqual({ to: 'aggressiv', probability: 0.5, revealed: true });
            expect(visible[1].revealed).toBe(false);
            expect(visible[2].revealed).toBe(false);
        });

        it('deckt bei voller Sichtbarkeit alle Einträge auf', () => {
            const engine = new PatternEngine(patrolConfig);
            const visible = engine.getVisibleDistribution('aggressiv', 2);

            expect(visible.every((e) => e.revealed)).toBe(true);
        });

        it('bevorzugt beim Aufdecken die wahrscheinlichsten Folgezustände zuerst', () => {
            const engine = new PatternEngine(patrolConfig);
            const visible = engine.getVisibleDistribution('defensiv', 0);
            // defensiv hat 2 Einträge (0.6/0.4), visibility 0.34 -> round(0.68) = 1 aufgedeckt
            const revealed = visible.filter((e) => e.revealed);

            expect(revealed).toHaveLength(1);
            expect(revealed[0].to).toBe('aggressiv'); // höhere Wahrscheinlichkeit (0.6)
        });
    });

    describe('sampleNext', () => {
        it('wirft für einen Zustand ohne Übergänge', () => {
            const engine = new PatternEngine(patrolConfig);
            expect(() => engine.sampleNext('unbekannt')).toThrow(RangeError);
        });

        it('wählt anhand injizierter rng-Werte den erwarteten Zustand an den Wahrscheinlichkeits-Grenzen', () => {
            const engine = new PatternEngine(patrolConfig);
            // aggressiv: [0, 0.5) -> aggressiv, [0.5, 0.8) -> defensiv, [0.8, 1) -> finte
            expect(engine.sampleNext('aggressiv', () => 0)).toBe('aggressiv');
            expect(engine.sampleNext('aggressiv', () => 0.49999)).toBe('aggressiv');
            expect(engine.sampleNext('aggressiv', () => 0.5)).toBe('defensiv');
            expect(engine.sampleNext('aggressiv', () => 0.79999)).toBe('defensiv');
            expect(engine.sampleNext('aggressiv', () => 0.8)).toBe('finte');
            expect(engine.sampleNext('aggressiv', () => 0.99999)).toBe('finte');
        });

        it('liefert für einen deterministischen Zustand (Wahrscheinlichkeit 1) immer denselben Folgezustand', () => {
            const engine = new PatternEngine(patrolConfig);
            for (let i = 0; i < 20; i += 1) {
                expect(engine.sampleNext('finte', () => i / 20)).toBe('aggressiv');
            }
        });

        it('nähert sich bei vielen Stichproben der konfigurierten Verteilung an', () => {
            const engine = new PatternEngine(patrolConfig);
            const rng = mulberry32(42);
            const counts: Record<string, number> = { aggressiv: 0, defensiv: 0, finte: 0 };
            const iterations = 20000;

            for (let i = 0; i < iterations; i += 1) {
                counts[engine.sampleNext('aggressiv', rng)] += 1;
            }

            expect(counts.aggressiv / iterations).toBeCloseTo(0.5, 1);
            expect(counts.defensiv / iterations).toBeCloseTo(0.3, 1);
            expect(counts.finte / iterations).toBeCloseTo(0.2, 1);
        });
    });
});
