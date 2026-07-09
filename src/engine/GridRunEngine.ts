import type { GridFocus, GridSectorConfig, SectorCategory } from './types';

// Greed Run (Automat 1, Phase 7f Genre-Rework, game-spec.md 4.2): 5x5-
// Sektorenfeld statt zyklisches Pattern-Modell. Framework-unabhaengig, kennt
// weder Phaser noch React noch /src/data (Architektur-Kurzregel CLAUDE.md).
// PatternEngine/PushYourLuckEngine bleiben fuer Automat 2-4 unveraendert --
// dieses Modul ersetzt sie fuer Automat 1 vollstaendig, nutzt aber dieselbe
// Konvention (injizierbares `rng: () => number = Math.random` fuer
// deterministische Tests, reine Funktionen wo moeglich).

export const SECTOR_CATEGORIES: readonly SectorCategory[] = ['ghost', 'points', 'empty', 'bonus'];

export interface GridPosition {
    row: number;
    col: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_DELTAS: Record<Direction, { row: number; col: number }> = {
    up: { row: -1, col: 0 },
    down: { row: 1, col: 0 },
    left: { row: 0, col: -1 },
    right: { row: 0, col: 1 },
};

function meanRange([min, max]: readonly [number, number]): number {
    return (min + max) / 2;
}

function positionKey(pos: GridPosition): string {
    return `${pos.row},${pos.col}`;
}

// Fisher-Yates mit injizierbarem rng -- dieselbe Konvention wie
// machines.config.ts::computeCandidateExclusionOrder.
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export function getStartPosition(gridSize: number): GridPosition {
    const center = Math.floor(gridSize / 2);
    return { row: center, col: center };
}

export function getNeighbors(position: GridPosition, gridSize: number): GridPosition[] {
    const candidates = [
        { row: position.row - 1, col: position.col },
        { row: position.row + 1, col: position.col },
        { row: position.row, col: position.col - 1 },
        { row: position.row, col: position.col + 1 },
    ];
    return candidates.filter((p) => p.row >= 0 && p.row < gridSize && p.col >= 0 && p.col < gridSize);
}

export function applyDirection(position: GridPosition, direction: Direction, gridSize: number): GridPosition | null {
    const delta = DIRECTION_DELTAS[direction];
    const next = { row: position.row + delta.row, col: position.col + delta.col };
    if (next.row < 0 || next.row >= gridSize || next.col < 0 || next.col >= gridSize) {
        return null;
    }
    return next;
}

// Manhattan-Distanz-Radius um `position`, neu zentriert bei jedem Aufruf
// (game-spec.md 4.2 "Sichtweite"). Schliesst `position` selbst nicht ein
// (dieser Sektor ist per Definition bereits betreten/bekannt).
export function getVisibleSectors(position: GridPosition, sightRadius: number, gridSize: number): GridPosition[] {
    const result: GridPosition[] = [];
    for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
            const distance = Math.abs(row - position.row) + Math.abs(col - position.col);
            if (distance > 0 && distance <= sightRadius) {
                result.push({ row, col });
            }
        }
    }
    return result;
}

// Weiche->lokal harte Sicherheits-Korrektur (game-spec.md 4.2 "Sicherheits-
// Constraint"): tauscht ueberzaehlige Geister-Nachbarn des Startfelds mit
// einer zufaelligen Nicht-Geist-Zelle ausserhalb der Nachbarschaft, bis das
// Limit eingehalten wird. Der Rest des Feldes bleibt unangetastet -- bewusst
// KEINE Garantie ausserhalb dieser bis zu 4 Zellen.
function enforceStartNeighborSafety(
    grid: SectorCategory[][],
    start: GridPosition,
    config: GridSectorConfig,
    rng: () => number,
): void {
    const { gridSize, maxGhostAmongStartNeighbors } = config;
    const neighbors = getNeighbors(start, gridSize);
    const neighborKeys = new Set(neighbors.map(positionKey));
    const isGhostAt = (pos: GridPosition) => grid[pos.row][pos.col] === 'ghost';

    let ghostNeighbors = neighbors.filter(isGhostAt);
    while (ghostNeighbors.length > maxGhostAmongStartNeighbors) {
        const swapSource = ghostNeighbors[0];
        const candidates: GridPosition[] = [];
        for (let row = 0; row < gridSize; row += 1) {
            for (let col = 0; col < gridSize; col += 1) {
                if (row === start.row && col === start.col) continue;
                if (neighborKeys.has(`${row},${col}`)) continue;
                if (grid[row][col] === 'ghost') continue;
                candidates.push({ row, col });
            }
        }
        if (candidates.length === 0) {
            // Bei extremen Configs (z.B. fast nur Geister) nicht loesbar --
            // dann bleibt es beim Best-Effort statt einer Endlosschleife.
            break;
        }
        const target = candidates[Math.floor(rng() * candidates.length)];
        const tmp = grid[swapSource.row][swapSource.col];
        grid[swapSource.row][swapSource.col] = grid[target.row][target.col];
        grid[target.row][target.col] = tmp;
        ghostNeighbors = neighbors.filter(isGhostAt);
    }
}

// Generiert das feste Sektorinhalt-Layout fuer EINEN Run (game-spec.md 4.2:
// "pro Run einmalig fest vorab generiert", dasselbe Prinzip wie die feste
// Zug-Sequenz der zyklischen Automaten). Der Startsektor selbst traegt keine
// Kategorie (er gilt von Beginn an als betreten).
export function generateGrid(config: GridSectorConfig, rng: () => number = Math.random): SectorCategory[][] {
    const { gridSize, categoryCounts } = config;
    const start = getStartPosition(gridSize);
    const totalNonStart = gridSize * gridSize - 1;
    const totalCategoryCount = SECTOR_CATEGORIES.reduce((sum, category) => sum + (categoryCounts[category] ?? 0), 0);
    if (totalCategoryCount !== totalNonStart) {
        throw new RangeError(
            `generateGrid: categoryCounts summieren sich auf ${totalCategoryCount}, erwartet ${totalNonStart} (gridSize*gridSize - 1)`,
        );
    }

    const pool: SectorCategory[] = [];
    for (const category of SECTOR_CATEGORIES) {
        for (let i = 0; i < (categoryCounts[category] ?? 0); i += 1) {
            pool.push(category);
        }
    }
    const shuffledPool = shuffle(pool, rng);

    const grid: SectorCategory[][] = Array.from({ length: gridSize }, () => Array<SectorCategory>(gridSize).fill('empty'));
    let poolIndex = 0;
    for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
            if (row === start.row && col === start.col) continue;
            grid[row][col] = shuffledPool[poolIndex];
            poolIndex += 1;
        }
    }

    enforceStartNeighborSafety(grid, start, config, rng);

    return grid;
}

// Blind-Erwartungswert-Garantie (game-spec.md 4.2, automatisiert zu
// pruefen): Payout eines komplett unvorbereiteten Zugs, gemittelt ueber die
// tatsaechliche Kategorien-HAEUFIGKEIT der Nicht-Start-Sektoren (nicht 1/4
// je Kategorie) -- analoges Prinzip zur Blind-EV der zyklischen Automaten
// (dort ueber die stationaere Markov-Verteilung gemittelt).
export function computeBlindExpectedValue(config: GridSectorConfig): number {
    const totalNonStart = config.gridSize * config.gridSize - 1;
    return SECTOR_CATEGORIES.reduce((sum, category) => {
        const weight = (config.categoryCounts[category] ?? 0) / totalNonStart;
        return sum + weight * meanRange(config.payoutRanges[category]);
    }, 0);
}

// Fokus-abhaengige Aufloesungs-Reihenfolge (game-spec.md 4.2): bei Praezision
// p werden die ersten p Kategorien dieser Liste zuverlaessig geprueft (Treffer
// -> Kategorie bekannt, kein Treffer -> Kategorie ausgeschlossen). 'points'
// erscheint nie explizit -- es ergibt sich bei Praezision === Laenge dieser
// Liste durch Ausschluss der anderen drei ("bei Praezision 3 vollstaendig
// bekannt").
export function getFocusResolutionOrder(focus: GridFocus): SectorCategory[] {
    return focus === 'safe' ? ['ghost', 'bonus', 'empty'] : ['bonus', 'ghost', 'empty'];
}

export interface SectorKnowledge {
    known: SectorCategory | null;
    excluded: SectorCategory[];
}

// Wendet die Zwei-Achsen-Vorschau (game-spec.md 4.2 "Praezision") auf EINEN
// Sektor an. `precision` >= Laenge der Aufloesungs-Reihenfolge (3) macht den
// Sektor de facto bekannt (die 4. Kategorie ergibt sich durch Ausschluss).
export function resolveSectorKnowledge(
    trueCategory: SectorCategory,
    precision: number,
    focus: GridFocus,
): SectorKnowledge {
    const order = getFocusResolutionOrder(focus);
    const excluded: SectorCategory[] = [];
    const steps = Math.max(0, Math.min(precision, order.length));

    for (let i = 0; i < steps; i += 1) {
        const candidate = order[i];
        if (candidate === trueCategory) {
            return { known: candidate, excluded };
        }
        excluded.push(candidate);
    }

    if (steps >= order.length) {
        const remaining = SECTOR_CATEGORIES.find((category) => !excluded.includes(category));
        return { known: remaining ?? trueCategory, excluded };
    }

    return { known: null, excluded };
}

// Zieht EINEN Wert aus der Payout-Spanne einer Kategorie (leer ist immer
// exakt [0,0]). Dieselbe Ziehungs-Mathematik wie
// PushYourLuckEngine.drawPayout, hier direkt auf Kategorien statt auf einer
// ResolvedAction, da es fuer den Grid-Automaten keine
// Gross/Einfach/Verlust-Dreiteilung mehr gibt.
export function drawCategoryPayout(
    config: GridSectorConfig,
    category: SectorCategory,
    rng: () => number = Math.random,
): number {
    const [min, max] = config.payoutRanges[category];
    return min + rng() * (max - min);
}

export interface MoveResult {
    position: GridPosition;
    category: SectorCategory;
}

// Haelt den Zustand EINES laufenden Runs (Feld, Position, Restbudget) --
// bewusst eine Klasse (anders als das zustandslose PatternEngine/
// PushYourLuckEngine-Duo), weil dieser Automat im Gegensatz zum zyklischen
// Modell genuin ueber mehrere Zuege hinweg mutierenden Zustand hat (Nebel des
// Krieges, Verbrauchsregel). Kennt weder Phaser noch EconomyStore.
export class GridRunEngine {
    private readonly gridSize: number;
    private readonly grid: SectorCategory[][];
    private position: GridPosition;
    private actionsRemaining: number;

    constructor(config: GridSectorConfig, actionBudget: number, rng: () => number = Math.random) {
        if (actionBudget <= 0) {
            throw new RangeError('GridRunEngine: actionBudget muss positiv sein');
        }
        this.gridSize = config.gridSize;
        this.grid = generateGrid(config, rng);
        this.position = getStartPosition(this.gridSize);
        this.actionsRemaining = actionBudget;
    }

    getPosition(): GridPosition {
        return this.position;
    }

    getActionsRemaining(): number {
        return this.actionsRemaining;
    }

    isFinished(): boolean {
        return this.actionsRemaining <= 0;
    }

    getCategoryAt(position: GridPosition): SectorCategory {
        return this.grid[position.row][position.col];
    }

    getVisibleSectors(sightRadius: number): GridPosition[] {
        return getVisibleSectors(this.position, sightRadius, this.gridSize);
    }

    // Bewegt sich in eine Richtung, loest den betretenen Sektor auf und
    // verbraucht ihn (game-spec.md 4.2 "Verbrauchsregel": wird fuer den Rest
    // des Runs zu 'empty', einheitlich fuer alle vier Kategorien inklusive
    // Geist). Zieht das Aktionsbudget um 1 ab. Wirft bei einem Zug ausserhalb
    // des Feldrands oder ohne verbleibendes Budget.
    move(direction: Direction): MoveResult {
        if (this.isFinished()) {
            throw new RangeError('GridRunEngine.move: kein Aktionsbudget mehr uebrig');
        }
        const next = applyDirection(this.position, direction, this.gridSize);
        if (!next) {
            throw new RangeError(`GridRunEngine.move: Zug "${direction}" fuehrt aus dem Feld hinaus`);
        }
        const category = this.grid[next.row][next.col];
        this.grid[next.row][next.col] = 'empty';
        this.position = next;
        this.actionsRemaining -= 1;
        return { position: next, category };
    }
}
