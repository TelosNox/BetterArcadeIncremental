import { describe, expect, it } from 'vitest';
import type { GridSectorConfig, SectorCategory } from './types';
import {
    GridRunEngine,
    SECTOR_CATEGORIES,
    applyDirection,
    computeBlindExpectedValue,
    drawCategoryPayout,
    generateGrid,
    getFocusResolutionOrder,
    getNeighbors,
    getStartPosition,
    getVisibleSectors,
    resolveSectorKnowledge,
} from './GridRunEngine';

// Eigenstaendige Test-Fixture (Konvention wie AttendantEngine.test.ts: Engine-
// Tests bleiben unabhaengig von machines.config.ts). 5x5, 24 Nicht-Start-
// Sektoren: 5 Geist, 14 Punkte, 3 Leer, 2 Bonus.
const FIXTURE_CONFIG: GridSectorConfig = {
    gridSize: 5,
    categoryCounts: { ghost: 5, points: 14, empty: 3, bonus: 2 },
    payoutRanges: {
        ghost: [-10, -6],
        points: [3, 6],
        empty: [0, 0],
        bonus: [15, 22],
    },
    maxGhostAmongStartNeighbors: 1,
};

function countCategories(grid: SectorCategory[][]): Record<SectorCategory, number> {
    const counts: Record<SectorCategory, number> = { ghost: 0, points: 0, empty: 0, bonus: 0 };
    for (const row of grid) {
        for (const cell of row) {
            counts[cell] += 1;
        }
    }
    return counts;
}

// Deterministischer rng fuer stabile Tests: liefert eine feste Sequenz von
// Werten, faellt danach auf einen einfachen LCG zurueck.
function sequenceRng(values: readonly number[]): () => number {
    let i = 0;
    let state = 42;
    return () => {
        if (i < values.length) {
            return values[i++];
        }
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

describe('GridRunEngine (Phase 7f, game-spec.md 4.2)', () => {
    describe('getStartPosition', () => {
        it('liefert das Mittelfeld eines 5x5-Rasters (2,2 0-indiziert)', () => {
            expect(getStartPosition(5)).toEqual({ row: 2, col: 2 });
        });
    });

    describe('getNeighbors', () => {
        it('liefert alle 4 Nachbarn fuer eine zentrale Position', () => {
            const neighbors = getNeighbors({ row: 2, col: 2 }, 5);
            expect(neighbors).toHaveLength(4);
            expect(neighbors).toEqual(
                expect.arrayContaining([
                    { row: 1, col: 2 },
                    { row: 3, col: 2 },
                    { row: 2, col: 1 },
                    { row: 2, col: 3 },
                ]),
            );
        });

        it('filtert Nachbarn ausserhalb des Feldrands (Eckposition)', () => {
            const neighbors = getNeighbors({ row: 0, col: 0 }, 5);
            expect(neighbors).toHaveLength(2);
        });
    });

    describe('applyDirection', () => {
        it('bewegt sich korrekt in alle 4 Richtungen', () => {
            const center = { row: 2, col: 2 };
            expect(applyDirection(center, 'up', 5)).toEqual({ row: 1, col: 2 });
            expect(applyDirection(center, 'down', 5)).toEqual({ row: 3, col: 2 });
            expect(applyDirection(center, 'left', 5)).toEqual({ row: 2, col: 1 });
            expect(applyDirection(center, 'right', 5)).toEqual({ row: 2, col: 3 });
        });

        it('liefert null, wenn der Zug aus dem Feld hinausfuehrt', () => {
            expect(applyDirection({ row: 0, col: 0 }, 'up', 5)).toBeNull();
            expect(applyDirection({ row: 4, col: 4 }, 'right', 5)).toBeNull();
        });
    });

    describe('getVisibleSectors', () => {
        it('liefert alle Zellen innerhalb des Manhattan-Radius, ohne die Position selbst', () => {
            const visible = getVisibleSectors({ row: 2, col: 2 }, 1, 5);
            expect(visible).toHaveLength(4);
            expect(visible).not.toContainEqual({ row: 2, col: 2 });
        });

        it('bei Sichtweite 4 ab der Mitte sind alle 4 Ecken eines 5x5-Feldes sichtbar (game-spec.md 4.2)', () => {
            const visible = getVisibleSectors({ row: 2, col: 2 }, 4, 5);
            expect(visible).toContainEqual({ row: 0, col: 0 });
            expect(visible).toContainEqual({ row: 0, col: 4 });
            expect(visible).toContainEqual({ row: 4, col: 0 });
            expect(visible).toContainEqual({ row: 4, col: 4 });
        });

        it('rezentriert sich um eine neue Position (nicht mehr um den Start)', () => {
            const visible = getVisibleSectors({ row: 0, col: 0 }, 1, 5);
            expect(visible).toEqual(
                expect.arrayContaining([
                    { row: 1, col: 0 },
                    { row: 0, col: 1 },
                ]),
            );
            expect(visible).toHaveLength(2);
        });
    });

    describe('generateGrid', () => {
        it('erzeugt genau die konfigurierten Kategorien-Anzahlen', () => {
            const grid = generateGrid(FIXTURE_CONFIG, () => 0.5);
            const counts = countCategories(grid);
            // +1 fuer das Startfeld selbst, das als 'empty' initialisiert wird
            expect(counts.ghost).toBe(5);
            expect(counts.points).toBe(14);
            expect(counts.bonus).toBe(2);
            expect(counts.empty).toBe(3 + 1);
        });

        it('wirft, wenn categoryCounts nicht zu gridSize passt', () => {
            const bad: GridSectorConfig = {
                ...FIXTURE_CONFIG,
                categoryCounts: { ghost: 1, points: 1, empty: 1, bonus: 1 },
            };
            expect(() => generateGrid(bad, Math.random)).toThrow(RangeError);
        });

        it('haelt das Sicherheits-Constraint ein: max. 1 Geist unter den Start-Nachbarn (ueber viele Seeds)', () => {
            for (let seed = 0; seed < 200; seed += 1) {
                const grid = generateGrid(FIXTURE_CONFIG, Math.random);
                const start = getStartPosition(FIXTURE_CONFIG.gridSize);
                const neighbors = getNeighbors(start, FIXTURE_CONFIG.gridSize);
                const ghostNeighbors = neighbors.filter((n) => grid[n.row][n.col] === 'ghost');
                expect(ghostNeighbors.length).toBeLessThanOrEqual(FIXTURE_CONFIG.maxGhostAmongStartNeighbors);
            }
        });

        it('das Startfeld selbst traegt keine Kategorie (bleibt "empty")', () => {
            const grid = generateGrid(FIXTURE_CONFIG, () => 0.99);
            const start = getStartPosition(FIXTURE_CONFIG.gridSize);
            expect(grid[start.row][start.col]).toBe('empty');
        });
    });

    describe('computeBlindExpectedValue (Blind-EV-Garantie, game-spec.md 4.2 PFLICHT)', () => {
        it('ist positiv fuer die Fixture-Verteilung', () => {
            expect(computeBlindExpectedValue(FIXTURE_CONFIG)).toBeGreaterThan(0);
        });

        it('ist negativ, wenn Geister die Verteilung dominieren (Gegenprobe)', () => {
            const ghostHeavy: GridSectorConfig = {
                ...FIXTURE_CONFIG,
                categoryCounts: { ghost: 20, points: 2, empty: 1, bonus: 1 },
            };
            expect(computeBlindExpectedValue(ghostHeavy)).toBeLessThan(0);
        });
    });

    describe('getFocusResolutionOrder', () => {
        it('Sicher-Fokus prueft zuerst Geist', () => {
            expect(getFocusResolutionOrder('safe')[0]).toBe('ghost');
        });

        it('Gier-Fokus prueft zuerst Bonus', () => {
            expect(getFocusResolutionOrder('greedy')[0]).toBe('bonus');
        });
    });

    describe('resolveSectorKnowledge', () => {
        it('Praezision 0: nichts bekannt, nichts ausgeschlossen', () => {
            const result = resolveSectorKnowledge('points', 0, 'safe');
            expect(result).toEqual({ known: null, excluded: [] });
        });

        it('Sicher-Fokus, Praezision 1, wahre Kategorie ist Geist -> sofort bekannt', () => {
            const result = resolveSectorKnowledge('ghost', 1, 'safe');
            expect(result.known).toBe('ghost');
            expect(result.excluded).toEqual([]);
        });

        it('Sicher-Fokus, Praezision 1, wahre Kategorie ist NICHT Geist -> Geist ausgeschlossen, noch unbekannt', () => {
            const result = resolveSectorKnowledge('points', 1, 'safe');
            expect(result.known).toBeNull();
            expect(result.excluded).toEqual(['ghost']);
        });

        it('Gier-Fokus, Praezision 1, wahre Kategorie ist Bonus -> sofort bekannt', () => {
            const result = resolveSectorKnowledge('bonus', 1, 'greedy');
            expect(result.known).toBe('bonus');
        });

        it('Praezision 2 schliesst kumulativ eine weitere Kategorie aus', () => {
            const result = resolveSectorKnowledge('points', 2, 'safe');
            expect(result.known).toBeNull();
            expect(result.excluded).toEqual(['ghost', 'bonus']);
        });

        it('Praezision 3 (MAX) macht jede Kategorie de facto bekannt, auch "points" durch Ausschluss', () => {
            const result = resolveSectorKnowledge('points', 3, 'safe');
            expect(result.known).toBe('points');
            expect(result.excluded).toEqual(['ghost', 'bonus', 'empty']);
        });

        it('ist monoton: hoehere Praezision widerspricht nie einer niedrigeren (excluded ist Teilmengenkette)', () => {
            const at1 = resolveSectorKnowledge('empty', 1, 'safe');
            const at2 = resolveSectorKnowledge('empty', 2, 'safe');
            expect(at2.excluded.slice(0, at1.excluded.length)).toEqual(at1.excluded);
        });

        it('Praezision oberhalb von 3 verhaelt sich wie Praezision 3 (geklemmt)', () => {
            expect(resolveSectorKnowledge('bonus', 99, 'safe')).toEqual(resolveSectorKnowledge('bonus', 3, 'safe'));
        });
    });

    describe('drawCategoryPayout', () => {
        it('liefert immer exakt 0 fuer "empty"', () => {
            expect(drawCategoryPayout(FIXTURE_CONFIG, 'empty', () => 0.7)).toBe(0);
        });

        it('liefert einen Wert innerhalb der konfigurierten Spanne', () => {
            const value = drawCategoryPayout(FIXTURE_CONFIG, 'ghost', () => 0.5);
            const [min, max] = FIXTURE_CONFIG.payoutRanges.ghost;
            expect(value).toBeGreaterThanOrEqual(min);
            expect(value).toBeLessThanOrEqual(max);
        });

        it('rng=0 liefert das Minimum, rng nahe 1 liefert nahe dem Maximum', () => {
            expect(drawCategoryPayout(FIXTURE_CONFIG, 'bonus', () => 0)).toBe(FIXTURE_CONFIG.payoutRanges.bonus[0]);
            expect(drawCategoryPayout(FIXTURE_CONFIG, 'bonus', () => 0.999999)).toBeCloseTo(
                FIXTURE_CONFIG.payoutRanges.bonus[1],
                1,
            );
        });
    });

    describe('GridRunEngine', () => {
        it('startet im Mittelfeld mit vollem Aktionsbudget', () => {
            const engine = new GridRunEngine(FIXTURE_CONFIG, 4, () => 0.5);
            expect(engine.getPosition()).toEqual({ row: 2, col: 2 });
            expect(engine.getActionsRemaining()).toBe(4);
            expect(engine.isFinished()).toBe(false);
        });

        it('wirft bei nicht-positivem Aktionsbudget', () => {
            expect(() => new GridRunEngine(FIXTURE_CONFIG, 0, Math.random)).toThrow(RangeError);
        });

        it('move() bewegt die Position und verbraucht das Aktionsbudget', () => {
            const engine = new GridRunEngine(FIXTURE_CONFIG, 4, () => 0.5);
            const result = engine.move('up');
            expect(result.position).toEqual({ row: 1, col: 2 });
            expect(engine.getPosition()).toEqual({ row: 1, col: 2 });
            expect(engine.getActionsRemaining()).toBe(3);
        });

        it('Verbrauchsregel: ein betretener Sektor wird fuer den Rest des Runs zu "empty" (auch Geist)', () => {
            // Deterministischer rng, der beim Shuffle eine feste Reihenfolge
            // erzeugt -- wir pruefen nur strukturell: nach dem Zug entspricht
            // getCategoryAt(neuePosition) === 'empty', unabhaengig vom
            // urspruenglichen Inhalt.
            const engine = new GridRunEngine(FIXTURE_CONFIG, 4, sequenceRng([0.1, 0.2, 0.3, 0.4, 0.5]));
            const result = engine.move('right');
            expect(engine.getCategoryAt(result.position)).toBe('empty');
        });

        it('wirft bei einem Zug ausserhalb des Feldrands', () => {
            const engine = new GridRunEngine(FIXTURE_CONFIG, 10, () => 0.5);
            for (let i = 0; i < 2; i += 1) engine.move('up');
            expect(() => engine.move('up')).toThrow(RangeError);
        });

        it('wirft, wenn move() nach Budget-Erschoepfung aufgerufen wird', () => {
            const engine = new GridRunEngine(FIXTURE_CONFIG, 1, () => 0.5);
            engine.move('down');
            expect(engine.isFinished()).toBe(true);
            expect(() => engine.move('down')).toThrow(RangeError);
        });

        it('getVisibleSectors delegiert an die freie Funktion um die AKTUELLE Position', () => {
            const engine = new GridRunEngine(FIXTURE_CONFIG, 4, () => 0.5);
            engine.move('up');
            expect(engine.getVisibleSectors(1)).toEqual(getVisibleSectors({ row: 1, col: 2 }, 1, 5));
        });

        it('SECTOR_CATEGORIES enthaelt genau die 4 game-spec.md-Kategorien', () => {
            expect(SECTOR_CATEGORIES).toEqual(['ghost', 'points', 'empty', 'bonus']);
        });
    });
});
