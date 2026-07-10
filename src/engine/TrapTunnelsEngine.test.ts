import { describe, expect, it } from 'vitest';
import type { TrapTunnelsRunConfig } from './types';
import {
    TrapTunnelsEngine,
    bfsDistances,
    computeBlindTrapExpectedValue,
    drawTrapEventPayout,
    generateEnemyPath,
    generateNetwork,
    getVisiblePathPositions,
    junctionId,
    junctionRowCol,
    pickEnemyStartJunctions,
    resolveTraps,
} from './TrapTunnelsEngine';

// Eigenstaendige Test-Fixture (Konvention wie GridRunEngine.test.ts): 4x4-
// Kreuzungs-Raster, Spannbaum (15 Kanten) + 3-4 Zusatzkanten, Pfadlaenge 6,
// 2 Gegner mit Mindestabstand 3.
const FIXTURE_CONFIG: TrapTunnelsRunConfig = {
    gridSize: 4,
    extraEdgeRange: [3, 4],
    pathLength: 6,
    enemyCount: 2,
    minStartDistance: 3,
    singleCatchPayoutRange: [7, 12],
    chainCatchPayoutRange: [24, 34],
};

describe('TrapTunnelsEngine (Phase 7i, game-spec.md 4.3)', () => {
    describe('junctionId / junctionRowCol', () => {
        it('sind zueinander invers', () => {
            for (let row = 0; row < 4; row += 1) {
                for (let col = 0; col < 4; col += 1) {
                    const id = junctionId(row, col, 4);
                    expect(junctionRowCol(id, 4)).toEqual({ row, col });
                }
            }
        });

        it('erzeugt genau 16 eindeutige ids fuer ein 4x4-Raster', () => {
            const ids = new Set<number>();
            for (let row = 0; row < 4; row += 1) {
                for (let col = 0; col < 4; col += 1) {
                    ids.add(junctionId(row, col, 4));
                }
            }
            expect(ids.size).toBe(16);
        });
    });

    describe('generateNetwork', () => {
        it('verbindet alle 16 Kreuzungen (Spannbaum-Garantie, ueber viele Seeds)', () => {
            for (let seed = 0; seed < 100; seed += 1) {
                const network = generateNetwork(FIXTURE_CONFIG, Math.random);
                const distances = bfsDistances(network, 0);
                expect(distances.every((d) => Number.isFinite(d))).toBe(true);
            }
        });

        it('hat mindestens 15 Kanten (Spannbaum) plus 3-4 Zusatzkanten', () => {
            for (let seed = 0; seed < 50; seed += 1) {
                const network = generateNetwork(FIXTURE_CONFIG, Math.random);
                expect(network.edges.length).toBeGreaterThanOrEqual(15 + 3);
                expect(network.edges.length).toBeLessThanOrEqual(15 + 4);
            }
        });

        it('enthaelt keine doppelten oder Selbst-Kanten', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const seen = new Set<string>();
            for (const [a, b] of network.edges) {
                expect(a).not.toBe(b);
                const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                expect(seen.has(key)).toBe(false);
                seen.add(key);
            }
        });

        it('adjacency ist symmetrisch (jede Kante in beide Richtungen eingetragen)', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            for (const [a, b] of network.edges) {
                expect(network.adjacency[a]).toContain(b);
                expect(network.adjacency[b]).toContain(a);
            }
        });

        it('ist deterministisch bei gleichem rng', () => {
            const rngValues = Array.from({ length: 200 }, (_, i) => (i * 0.137) % 1);
            let i = 0;
            const rng = () => rngValues[i++ % rngValues.length];
            i = 0;
            const a = generateNetwork(FIXTURE_CONFIG, rng);
            i = 0;
            const b = generateNetwork(FIXTURE_CONFIG, rng);
            expect(a.edges).toEqual(b.edges);
        });
    });

    describe('bfsDistances', () => {
        it('liefert 0 fuer die Startkreuzung selbst', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            expect(bfsDistances(network, 3)[3]).toBe(0);
        });

        it('liefert endliche Distanzen zu allen erreichbaren Kreuzungen', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const distances = bfsDistances(network, 0);
            expect(distances).toHaveLength(16);
            expect(distances.every((d) => d >= 0 && Number.isFinite(d))).toBe(true);
        });
    });

    describe('pickEnemyStartJunctions', () => {
        it('haelt die Mindestdistanz zwischen 2 Start-Kreuzungen ein (ueber viele Seeds)', () => {
            for (let seed = 0; seed < 200; seed += 1) {
                const network = generateNetwork(FIXTURE_CONFIG, Math.random);
                const [a, b] = pickEnemyStartJunctions(network, 2, FIXTURE_CONFIG.minStartDistance, Math.random);
                const distances = bfsDistances(network, a);
                expect(distances[b]).toBeGreaterThanOrEqual(FIXTURE_CONFIG.minStartDistance);
            }
        });

        it('liefert 2 unterschiedliche Kreuzungen', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const [a, b] = pickEnemyStartJunctions(network, 2, FIXTURE_CONFIG.minStartDistance, Math.random);
            expect(a).not.toBe(b);
        });
    });

    describe('generateEnemyPath', () => {
        it('liefert genau length+1 Positionen, beginnend bei start', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const path = generateEnemyPath(network, 0, 6, Math.random);
            expect(path).toHaveLength(7);
            expect(path[0]).toBe(0);
        });

        it('jeder Schritt folgt einer echten Kante des Netzes', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const path = generateEnemyPath(network, 0, 6, Math.random);
            for (let i = 1; i < path.length; i += 1) {
                expect(network.adjacency[path[i - 1]]).toContain(path[i]);
            }
        });

        it('ist deterministisch bei gleichem rng', () => {
            const network = generateNetwork(FIXTURE_CONFIG, () => 0.3);
            const pathA = generateEnemyPath(network, 2, 6, () => 0.7);
            const pathB = generateEnemyPath(network, 2, 6, () => 0.7);
            expect(pathA).toEqual(pathB);
        });
    });

    describe('getVisiblePathPositions', () => {
        const path = [0, 1, 2, 3, 4, 5, 6];

        it('previewRange 1: Start + 1 Schritt sichtbar', () => {
            expect(getVisiblePathPositions(path, 1)).toEqual([0, 1]);
        });

        it('previewRange 0 zeigt trotzdem mindestens die Start-Kreuzung', () => {
            expect(getVisiblePathPositions(path, 0)).toEqual([0]);
        });

        it('previewRange >= Pfadlaenge zeigt den kompletten Pfad', () => {
            expect(getVisiblePathPositions(path, 99)).toEqual(path);
            expect(getVisiblePathPositions(path, 6)).toEqual(path);
        });
    });

    describe('resolveTraps', () => {
        it('keine Fallen -> keine Ereignisse', () => {
            expect(resolveTraps([[0, 1, 2]], new Set())).toEqual([]);
        });

        it('ein Gegner trifft eine Falle -> Einzelfang-Ereignis', () => {
            const events = resolveTraps([[0, 1, 2]], new Set([1]));
            expect(events).toEqual([{ step: 1, junction: 1, enemyIndices: [0], isChain: false }]);
        });

        it('zwei Gegner treffen im selben Schritt dieselbe Falle -> EIN Kettenreaktions-Ereignis', () => {
            const events = resolveTraps([[0, 1, 2], [5, 1, 6]], new Set([1]));
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual({ step: 1, junction: 1, enemyIndices: [0, 1], isChain: true });
        });

        it('zwei Gegner treffen dieselbe Falle in UNTERSCHIEDLICHEN Schritten -> zwei Einzelfang-Ereignisse, keine Kette', () => {
            const events = resolveTraps([[0, 1, 2], [5, 6, 1]], new Set([1]));
            expect(events).toHaveLength(2);
            expect(events.every((e) => !e.isChain)).toBe(true);
        });

        it('ein Gegner kann dieselbe Falle bei einem Pfad-Loop mehrfach treffen (mehrere Ereignisse)', () => {
            const events = resolveTraps([[0, 1, 2, 1]], new Set([1]));
            expect(events).toHaveLength(2);
            expect(events.map((e) => e.step)).toEqual([1, 3]);
        });
    });

    describe('drawTrapEventPayout', () => {
        it('Einzelfang liegt in singleCatchPayoutRange', () => {
            const event = { step: 0, junction: 0, enemyIndices: [0], isChain: false };
            const value = drawTrapEventPayout(FIXTURE_CONFIG, event, () => 0.5);
            expect(value).toBeGreaterThanOrEqual(FIXTURE_CONFIG.singleCatchPayoutRange[0]);
            expect(value).toBeLessThanOrEqual(FIXTURE_CONFIG.singleCatchPayoutRange[1]);
        });

        it('Kettenreaktion liegt in chainCatchPayoutRange (deutlich hoeher)', () => {
            const event = { step: 0, junction: 0, enemyIndices: [0, 1], isChain: true };
            const value = drawTrapEventPayout(FIXTURE_CONFIG, event, () => 0.5);
            expect(value).toBeGreaterThanOrEqual(FIXTURE_CONFIG.chainCatchPayoutRange[0]);
            expect(value).toBeLessThanOrEqual(FIXTURE_CONFIG.chainCatchPayoutRange[1]);
            expect(value).toBeGreaterThan(FIXTURE_CONFIG.singleCatchPayoutRange[1]);
        });
    });

    describe('computeBlindTrapExpectedValue (Blind-EV-Garantie, game-spec.md 4.3 PFLICHT, per Simulation)', () => {
        it('ist positiv ueber viele simulierte Runs (echter rng, keine feste Sequenz)', () => {
            const ev = computeBlindTrapExpectedValue(FIXTURE_CONFIG, 3000, Math.random);
            expect(ev).toBeGreaterThan(0);
        });

        it('ist 0, wenn die Payout-Spannen komplett auf 0 gesetzt werden (Gegenprobe)', () => {
            const zeroConfig: TrapTunnelsRunConfig = {
                ...FIXTURE_CONFIG,
                singleCatchPayoutRange: [0, 0],
                chainCatchPayoutRange: [0, 0],
            };
            expect(computeBlindTrapExpectedValue(zeroConfig, 500, Math.random)).toBe(0);
        });
    });

    describe('TrapTunnelsEngine', () => {
        it('generiert bei Konstruktion ein festes Netz + genau enemyCount Gegner-Pfade', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, Math.random);
            expect(engine.getNetwork().junctionCount).toBe(16);
            expect(engine.getEnemyPaths()).toHaveLength(2);
            expect(engine.getEnemyPaths()[0]).toHaveLength(FIXTURE_CONFIG.pathLength + 1);
        });

        it('wirft bei nicht-positivem maxTraps', () => {
            expect(() => new TrapTunnelsEngine(FIXTURE_CONFIG, 0, Math.random)).toThrow(RangeError);
        });

        it('placeTrap platziert bis zu maxTraps Fallen, danach nicht mehr', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, Math.random);
            expect(engine.placeTrap(0)).toBe(true);
            expect(engine.placeTrap(1)).toBe(true);
            expect(engine.placeTrap(2)).toBe(false);
            expect(engine.getPlacedTraps().size).toBe(2);
        });

        it('placeTrap auf derselben Kreuzung zweimal ist ein no-op (kein Duplikat)', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, Math.random);
            expect(engine.placeTrap(0)).toBe(true);
            expect(engine.placeTrap(0)).toBe(false);
            expect(engine.getPlacedTraps().size).toBe(1);
        });

        it('removeTrap entfernt eine platzierte Falle und gibt Platz frei', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 1, Math.random);
            engine.placeTrap(0);
            expect(engine.removeTrap(0)).toBe(true);
            expect(engine.getPlacedTraps().size).toBe(0);
            expect(engine.placeTrap(1)).toBe(true);
        });

        it('canPlaceTrap lehnt Kreuzungen ausserhalb des Netzes ab', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, Math.random);
            expect(engine.canPlaceTrap(-1)).toBe(false);
            expect(engine.canPlaceTrap(16)).toBe(false);
        });

        it('resolve() liefert dieselben Ereignisse wie resolveTraps auf denselben Pfaden/Fallen', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 3, Math.random);
            engine.placeTrap(0);
            engine.placeTrap(5);
            const expected = resolveTraps(engine.getEnemyPaths(), engine.getPlacedTraps());
            expect(engine.resolve()).toEqual(expected);
        });

        it('resolve() ohne platzierte Fallen liefert keine Ereignisse', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, Math.random);
            expect(engine.resolve()).toEqual([]);
        });
    });
});
