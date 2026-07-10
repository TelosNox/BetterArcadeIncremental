import { describe, expect, it } from 'vitest';
import type { TrapTunnelsRunConfig } from './types';
import {
    TrapTunnelsEngine,
    bfsDistances,
    computeBlindTrapExpectedValue,
    drawTrapEventPayout,
    edgeKey,
    generateNetwork,
    junctionId,
    junctionRowCol,
    pickEnemyStartJunctions,
    pickNextJunction,
    removeEdges,
    resolveEnemyMovement,
    resolveEnemyPath,
    resolveTraps,
    type TunnelNetwork,
} from './TrapTunnelsEngine';

// Eigenstaendige Test-Fixture (Konvention wie GridRunEngine.test.ts): 4x4-
// Kreuzungs-Raster, Spannbaum (15 Kanten) + 3-4 Zusatzkanten, 6
// Ausfuehrungsschritte pro Run.
const FIXTURE_CONFIG: TrapTunnelsRunConfig = {
    gridSize: 4,
    extraEdgeRange: [3, 4],
    pathLength: 6,
    singleCatchPayoutRange: [7, 12],
    chainCatchPayoutRange: [24, 34],
};

// Kleines, von Hand gebautes Netz fuer deterministische Bewegungs-Tests --
// bewusst NICHT ueber generateNetwork erzeugt, damit die Grad-Struktur exakt
// kontrollierbar ist:
//   0 - 1 - 2
//       |
//       3
// Kreuzung 0 hat Grad 1 (Sackgasse), Kreuzung 1 hat Grad 3 (echte
// Verzweigung), Kreuzung 2/3 haben je Grad 1.
function buildLineNetwork(): TunnelNetwork {
    const edges: [number, number][] = [
        [0, 1],
        [1, 2],
        [1, 3],
    ];
    const adjacency: number[][] = [[], [], [], []];
    for (const [a, b] of edges) {
        adjacency[a].push(b);
        adjacency[b].push(a);
    }
    return { gridSize: 2, junctionCount: 4, edges, adjacency };
}

describe('TrapTunnelsEngine (Phase 7j, game-spec.md 4.3 v2: Zufallsbewegung + Dynamit)', () => {
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
                const key = edgeKey(a, b);
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

    describe('removeEdges (Dynamit-Auswirkung auf ein Netz)', () => {
        it('entfernt genau die angegebene Kante aus edges UND adjacency', () => {
            const network = buildLineNetwork();
            const reduced = removeEdges(network, new Set([edgeKey(1, 2)]));
            expect(reduced.edges).toHaveLength(2);
            expect(reduced.adjacency[1]).not.toContain(2);
            expect(reduced.adjacency[2]).not.toContain(1);
            // Uebrige Kanten bleiben unberuehrt.
            expect(reduced.adjacency[0]).toContain(1);
            expect(reduced.adjacency[1]).toContain(3);
        });

        it('laesst das Original-Netz unveraendert (reine Ableitung)', () => {
            const network = buildLineNetwork();
            removeEdges(network, new Set([edgeKey(1, 2)]));
            expect(network.edges).toHaveLength(3);
            expect(network.adjacency[1]).toContain(2);
        });

        it('ohne gesprengte Kanten wird dasselbe Netz zurueckgegeben', () => {
            const network = buildLineNetwork();
            expect(removeEdges(network, new Set())).toBe(network);
        });
    });

    describe('pickEnemyStartJunctions (Phase 7j: kein Mindestabstand mehr)', () => {
        it('liefert count-viele Kreuzungen aus dem gueltigen Bereich', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const starts = pickEnemyStartJunctions(network, 4, Math.random);
            expect(starts).toHaveLength(4);
            expect(starts.every((s) => s >= 0 && s < network.junctionCount)).toBe(true);
        });

        it('ist deterministisch bei gleichem rng', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const rng = () => 0.42;
            expect(pickEnemyStartJunctions(network, 3, rng)).toEqual(pickEnemyStartJunctions(network, 3, rng));
        });
    });

    describe('pickNextJunction', () => {
        it('erste Bewegung (cameFrom=null) schliesst keine Kante aus, auch nicht bei Grad 1', () => {
            const network = buildLineNetwork();
            // Kreuzung 0 hat nur Nachbar 1 -- ohne cameFrom-Ausschluss trotzdem waehlbar.
            expect(pickNextJunction(network, 0, null, () => 0)).toBe(1);
        });

        it('schliesst die Rueckwaerts-Kante aus, sobald cameFrom gesetzt ist', () => {
            const network = buildLineNetwork();
            // An Kreuzung 1 (Nachbarn 0,2,3), Rueckweg nach 0 ausgeschlossen -> nur 2 oder 3.
            for (let trial = 0; trial < 20; trial += 1) {
                const rng = () => trial / 20;
                const next = pickNextJunction(network, 1, 0, rng);
                expect(next).not.toBe(0);
                expect([2, 3]).toContain(next);
            }
        });

        it('liefert null, wenn die einzige Option die Rueckwaerts-Kante waere (Sackgasse)', () => {
            const network = buildLineNetwork();
            // An Kreuzung 2 (Grad 1, einziger Nachbar 1), cameFrom=1 -> keine Option mehr.
            expect(pickNextJunction(network, 2, 1, Math.random)).toBeNull();
        });

        it('liefert null bei einer isolierten Kreuzung ganz ohne Nachbarn', () => {
            const network = buildLineNetwork();
            const reduced = removeEdges(network, new Set([edgeKey(1, 2)]));
            expect(pickNextJunction(reduced, 2, null, Math.random)).toBeNull();
        });
    });

    describe('resolveEnemyPath', () => {
        it('liefert genau steps+1 Positionen, beginnend bei start', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const path = resolveEnemyPath(network, 0, 6, Math.random);
            expect(path).toHaveLength(7);
            expect(path[0]).toBe(0);
        });

        it('jeder Schritt folgt einer echten Kante des Netzes (solange nicht eingefroren)', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const path = resolveEnemyPath(network, 0, 6, Math.random);
            for (let i = 1; i < path.length; i += 1) {
                if (path[i] === path[i - 1]) continue; // eingefroren
                expect(network.adjacency[path[i - 1]]).toContain(path[i]);
            }
        });

        it('ein Gegner ohne gueltige Weiterverbindung friert fuer den Rest des Runs ein', () => {
            const network = buildLineNetwork();
            // Start an Kreuzung 2 (Grad 1) -> erster Schritt zwingend nach 1,
            // danach ist der Rueckweg nach 2 ausgeschlossen, also nach 0 oder 3.
            // Wenn die Ziehung auf 0 faellt (Grad 1, cameFrom=1 -> keine Option),
            // muss der Gegner ab dort fuer immer auf 0 stehen bleiben.
            const rng = () => 0; // waehlt jeweils die erste Option
            const path = resolveEnemyPath(network, 2, 6, rng);
            expect(path[0]).toBe(2);
            expect(path[1]).toBe(1);
            // Ab hier eingefroren -- alle folgenden Positionen identisch.
            const frozenPosition = path[2];
            expect(path.slice(2)).toEqual(Array(path.length - 2).fill(frozenPosition));
        });

        it('ist deterministisch bei gleichem rng', () => {
            const network = generateNetwork(FIXTURE_CONFIG, () => 0.3);
            const pathA = resolveEnemyPath(network, 2, 6, () => 0.7);
            const pathB = resolveEnemyPath(network, 2, 6, () => 0.7);
            expect(pathA).toEqual(pathB);
        });

        it('respektiert ein per Dynamit reduziertes Netz (gesprengte Kante wird nie benutzt)', () => {
            const network = buildLineNetwork();
            const reduced = removeEdges(network, new Set([edgeKey(1, 2)]));
            // Start an 0, kann ueber 1 nie mehr nach 2 gelangen.
            for (let trial = 0; trial < 30; trial += 1) {
                const rng = () => trial / 30;
                const path = resolveEnemyPath(reduced, 0, 6, rng);
                expect(path).not.toContain(2);
            }
        });
    });

    describe('resolveEnemyMovement', () => {
        it('liefert fuer jeden Start-Eintrag einen eigenen Pfad gleicher Laenge', () => {
            const network = generateNetwork(FIXTURE_CONFIG, Math.random);
            const paths = resolveEnemyMovement(network, [0, 1, 2], 6, Math.random);
            expect(paths).toHaveLength(3);
            expect(paths.every((p) => p.length === 7)).toBe(true);
            expect(paths.map((p) => p[0])).toEqual([0, 1, 2]);
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

        it('eine Falle faengt mehrfach hintereinander verschiedene Gegner, ohne sich zu verbrauchen', () => {
            const events = resolveTraps([[0, 1, 9], [5, 9, 1], [9, 9, 9]], new Set([1, 9]));
            // Kreuzung 1: Gegner 0 (Schritt 1), Gegner 1 (Schritt 2) -- zwei
            // Einzelfaenge in unterschiedlichen Schritten.
            // Kreuzung 9: Gegner 2 (Schritt 0,1,2), Gegner 0 (Schritt 2), Gegner 1 (Schritt 0).
            expect(events.length).toBeGreaterThan(2);
            const junction9Events = events.filter((e) => e.junction === 9);
            expect(junction9Events.length).toBeGreaterThanOrEqual(3);
        });

        it('ein eingefrorener Gegner auf einer Falle loest die Falle in JEDEM verbleibenden Schritt erneut aus', () => {
            const frozenPath = [0, 1, 1, 1, 1];
            const events = resolveTraps([frozenPath], new Set([1]));
            expect(events).toHaveLength(4);
            expect(events.every((e) => e.junction === 1 && !e.isChain)).toBe(true);
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
            const ev = computeBlindTrapExpectedValue(FIXTURE_CONFIG, 2, 3000, Math.random);
            expect(ev).toBeGreaterThan(0);
        });

        it('ist 0, wenn die Payout-Spannen komplett auf 0 gesetzt werden (Gegenprobe)', () => {
            const zeroConfig: TrapTunnelsRunConfig = {
                ...FIXTURE_CONFIG,
                singleCatchPayoutRange: [0, 0],
                chainCatchPayoutRange: [0, 0],
            };
            expect(computeBlindTrapExpectedValue(zeroConfig, 2, 500, Math.random)).toBe(0);
        });

        it('bleibt auch mit mehr Gegnern positiv', () => {
            const ev = computeBlindTrapExpectedValue(FIXTURE_CONFIG, 4, 2000, Math.random);
            expect(ev).toBeGreaterThan(0);
        });
    });

    describe('TrapTunnelsEngine', () => {
        it('generiert bei Konstruktion ein festes Netz, aber NOCH KEINE Gegner-Pfade (live erst bei resolve())', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 0, 2, Math.random);
            expect(engine.getNetwork().junctionCount).toBe(16);
            expect(engine.getLastEnemyPaths()).toEqual([]);
        });

        it('wirft bei nicht-positivem maxTraps', () => {
            expect(() => new TrapTunnelsEngine(FIXTURE_CONFIG, 0, 0, 2, Math.random)).toThrow(RangeError);
        });

        it('wirft bei nicht-positivem enemyCount', () => {
            expect(() => new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 0, 0, Math.random)).toThrow(RangeError);
        });

        it('placeTrap platziert bis zu maxTraps Fallen, danach nicht mehr', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 0, 2, Math.random);
            expect(engine.placeTrap(0)).toBe(true);
            expect(engine.placeTrap(1)).toBe(true);
            expect(engine.placeTrap(2)).toBe(false);
            expect(engine.getPlacedTraps().size).toBe(2);
        });

        it('placeTrap auf derselben Kreuzung zweimal ist ein no-op (kein Duplikat)', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 0, 2, Math.random);
            expect(engine.placeTrap(0)).toBe(true);
            expect(engine.placeTrap(0)).toBe(false);
            expect(engine.getPlacedTraps().size).toBe(1);
        });

        it('removeTrap entfernt eine platzierte Falle und gibt Platz frei', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 1, 0, 2, Math.random);
            engine.placeTrap(0);
            expect(engine.removeTrap(0)).toBe(true);
            expect(engine.getPlacedTraps().size).toBe(0);
            expect(engine.placeTrap(1)).toBe(true);
        });

        it('canPlaceTrap lehnt Kreuzungen ausserhalb des Netzes ab', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 0, 2, Math.random);
            expect(engine.canPlaceTrap(-1)).toBe(false);
            expect(engine.canPlaceTrap(16)).toBe(false);
        });

        it('blastEdge sprengt bis zu maxDynamite echte Kanten, danach nicht mehr', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 1, 2, Math.random);
            const [a, b] = engine.getNetwork().edges[0];
            const [c, d] = engine.getNetwork().edges[1];
            expect(engine.blastEdge(a, b)).toBe(true);
            expect(engine.blastEdge(c, d)).toBe(false);
            expect(engine.getBlastedEdges().size).toBe(1);
        });

        it('blastEdge lehnt nicht-existierende Kanten ab', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 5, 2, Math.random);
            // Kreuzung 0 und 15 sind im 4x4-Raster nie direkt benachbart.
            expect(engine.canBlastEdge(0, 15)).toBe(false);
        });

        it('unblastEdge macht eine Sprengung rueckgaengig und gibt Dynamit-Kontingent frei', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 1, 2, Math.random);
            const [a, b] = engine.getNetwork().edges[0];
            engine.blastEdge(a, b);
            expect(engine.unblastEdge(a, b)).toBe(true);
            expect(engine.getBlastedEdges().size).toBe(0);
        });

        it('resolve() liefert enemyCount-viele Pfade der Laenge pathLength+1', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 3, 0, 3, Math.random);
            engine.resolve();
            const paths = engine.getLastEnemyPaths();
            expect(paths).toHaveLength(3);
            expect(paths.every((p) => p.length === FIXTURE_CONFIG.pathLength + 1)).toBe(true);
        });

        it('resolve() ohne platzierte Fallen liefert keine Ereignisse', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 2, 0, 2, Math.random);
            expect(engine.resolve()).toEqual([]);
        });

        it('resolve() liefert dieselben Ereignisse wie resolveTraps auf den zuletzt berechneten Pfaden', () => {
            const engine = new TrapTunnelsEngine(FIXTURE_CONFIG, 3, 0, 2, () => 0.5);
            engine.placeTrap(0);
            engine.placeTrap(5);
            const events = engine.resolve();
            expect(events).toEqual(resolveTraps(engine.getLastEnemyPaths(), engine.getPlacedTraps()));
        });

        it('eine gesprengte Verbindung wird in der Bewegungsauflösung tatsaechlich nicht mehr benutzt', () => {
            // Kleines Netz mit vollstaendiger Kontrolle: alle Gegner starten an
            // Kreuzung 0, einzige Verbindung 0-1 wird gesprengt -> jeder Gegner
            // muss ab Start eingefroren bleiben (keine Kante mehr vorhanden).
            const engine = new TrapTunnelsEngine({ ...FIXTURE_CONFIG, gridSize: 2 }, 1, 4, 2, Math.random);
            const network = engine.getNetwork();
            for (const [a, b] of network.edges) {
                engine.blastEdge(a, b);
            }
            engine.resolve();
            for (const path of engine.getLastEnemyPaths()) {
                const start = path[0];
                expect(path.every((junction) => junction === start)).toBe(true);
            }
        });
    });
});
