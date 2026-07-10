import type { TrapTunnelsRunConfig } from './types';

// Trap Tunnels (Automat 2, Phase 7i Genre-Rework, game-spec.md 4.3):
// Tunnelnetz-Fallen-Modell statt zyklisches Pattern. Framework-unabhaengig,
// kennt weder Phaser noch React noch /src/data (Architektur-Kurzregel
// CLAUDE.md). Ersetzt PatternEngine/CyclicActionDef fuer Automat 2
// vollstaendig. Dieselbe Konvention wie GridRunEngine.ts: injizierbarer
// `rng: () => number = Math.random` fuer deterministische Tests, reine
// Funktionen wo moeglich, eine zustandsbehaftete Klasse fuer den Zustand
// EINES laufenden Runs (Netz + feste Gegner-Pfade + Fallen-Platzierung).

export interface TunnelNetwork {
    gridSize: number;
    junctionCount: number;
    // Kanonische Kanten (a < b), einmal pro Run generiert und danach fest
    // (game-spec.md 4.3 "pro Run einmalig fest").
    edges: readonly (readonly [number, number])[];
    adjacency: readonly (readonly number[])[];
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export function junctionId(row: number, col: number, gridSize: number): number {
    return row * gridSize + col;
}

export function junctionRowCol(id: number, gridSize: number): { row: number; col: number } {
    return { row: Math.floor(id / gridSize), col: id % gridSize };
}

function buildGridEdges(gridSize: number): [number, number][] {
    const edges: [number, number][] = [];
    for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
            const id = junctionId(row, col, gridSize);
            if (col + 1 < gridSize) edges.push([id, junctionId(row, col + 1, gridSize)]);
            if (row + 1 < gridSize) edges.push([id, junctionId(row + 1, col, gridSize)]);
        }
    }
    return edges;
}

// Minimal-Union-Find nur fuer generateNetwork (randomisiertes Kruskal) --
// keine eigene Datei, da ausschliesslich hier gebraucht.
class UnionFind {
    private readonly parent: number[];

    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, i) => i);
    }

    find(x: number): number {
        let root = x;
        while (this.parent[root] !== root) root = this.parent[root];
        let current = x;
        while (this.parent[current] !== root) {
            const next = this.parent[current];
            this.parent[current] = root;
            current = next;
        }
        return root;
    }

    union(a: number, b: number): boolean {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra === rb) return false;
        this.parent[ra] = rb;
        return true;
    }
}

// Netz-Generierung (game-spec.md 4.3 "Tunnelnetz-Generierung"): randomisiertes
// Kruskal auf den moeglichen Gitter-Kanten (garantiert einen Spannbaum, also
// Erreichbarkeit ALLER Kreuzungen), danach 3-4 zusaetzliche zufaellige Kanten
// aus den uebrig gebliebenen Kandidaten fuer Schleifen/Alternativrouten.
export function generateNetwork(config: TrapTunnelsRunConfig, rng: () => number = Math.random): TunnelNetwork {
    const { gridSize } = config;
    const junctionCount = gridSize * gridSize;
    const candidateEdges = shuffle(buildGridEdges(gridSize), rng);

    const unionFind = new UnionFind(junctionCount);
    const treeEdges: [number, number][] = [];
    const remainingEdges: [number, number][] = [];
    for (const edge of candidateEdges) {
        if (unionFind.union(edge[0], edge[1])) {
            treeEdges.push(edge);
        } else {
            remainingEdges.push(edge);
        }
    }

    const [minExtra, maxExtra] = config.extraEdgeRange;
    const extraCount = Math.min(remainingEdges.length, minExtra + Math.floor(rng() * (maxExtra - minExtra + 1)));
    const extraEdges = shuffle(remainingEdges, rng).slice(0, extraCount);

    const edges = [...treeEdges, ...extraEdges];
    const adjacency: number[][] = Array.from({ length: junctionCount }, () => []);
    for (const [a, b] of edges) {
        adjacency[a].push(b);
        adjacency[b].push(a);
    }

    return { gridSize, junctionCount, edges, adjacency };
}

export function bfsDistances(network: TunnelNetwork, from: number): number[] {
    const distances = new Array(network.junctionCount).fill(Number.POSITIVE_INFINITY);
    distances[from] = 0;
    const queue = [from];
    let head = 0;
    while (head < queue.length) {
        const current = queue[head];
        head += 1;
        for (const neighbor of network.adjacency[current]) {
            if (distances[neighbor] === Number.POSITIVE_INFINITY) {
                distances[neighbor] = distances[current] + 1;
                queue.push(neighbor);
            }
        }
    }
    return distances;
}

// Start-Kreuzungen der Gegner mit Mindestabstand (game-spec.md 4.3
// "Tunnelnetz-Generierung"). Weiche->tatsaechlich harte Korrektur analog zu
// GridRunEngine.enforceStartNeighborSafety: durchsucht eine zufaellig
// gemischte Reihenfolge der Kreuzungen nach dem ERSTEN Paar, das die
// Mindestdistanz einhaelt, faellt sonst auf das am weitesten entfernte
// gefundene Paar zurueck (Best-Effort, z.B. bei extremen Configs). Nur fuer
// `count === 2` exakt (die einzige in dieser Version genutzte Groesse,
// game-spec.md 4.3 "ausdruecklich noch nicht Teil dieser Version: mehr als 2
// Gegner") -- bei anderen Groessen bewusst vereinfacht (keine kombinatorische
// Suche ueber mehr als 2 Kreuzungen).
export function pickEnemyStartJunctions(
    network: TunnelNetwork,
    count: number,
    minDistance: number,
    rng: () => number = Math.random,
): number[] {
    const order = shuffle(
        Array.from({ length: network.junctionCount }, (_, i) => i),
        rng,
    );

    if (count !== 2) {
        return order.slice(0, count);
    }

    let bestPair: [number, number] = [order[0], order[1]];
    let bestDistance = -1;
    for (let i = 0; i < order.length; i += 1) {
        const distances = bfsDistances(network, order[i]);
        for (let j = i + 1; j < order.length; j += 1) {
            const distance = distances[order[j]];
            if (distance >= minDistance) {
                return [order[i], order[j]];
            }
            if (distance > bestDistance) {
                bestDistance = distance;
                bestPair = [order[i], order[j]];
            }
        }
    }
    return bestPair;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// Fester Pfad EINES Gegners per Zufalls-Walk (game-spec.md 4.3), nach
// Moeglichkeit ohne Kantenwiederholung -- an einer Sackgasse (alle
// Nachbarkanten bereits genutzt) wird eine Kante zwangslaeufig erneut
// genutzt (Best-Effort, kein Deadlock). `path[0]` ist die Start-Kreuzung
// (immer bekannt, analog zu Greed Runs Startsektor), `path.length ===
// length + 1`.
export function generateEnemyPath(
    network: TunnelNetwork,
    start: number,
    length: number,
    rng: () => number = Math.random,
): number[] {
    const path = [start];
    const usedEdges = new Set<string>();
    let current = start;
    for (let step = 0; step < length; step += 1) {
        const neighbors = network.adjacency[current];
        if (neighbors.length === 0) break;
        const unused = neighbors.filter((n) => !usedEdges.has(edgeKey(current, n)));
        const candidates = unused.length > 0 ? unused : neighbors;
        const next = candidates[Math.floor(rng() * candidates.length)];
        usedEdges.add(edgeKey(current, next));
        path.push(next);
        current = next;
    }
    return path;
}

// Wie viele Schritte (inkl. der immer bekannten Start-Kreuzung, Index 0)
// eines Gegner-Pfads bei gegebener Vorschau-Reichweite sichtbar sind
// (game-spec.md 4.3 "Vorschau-Reichweite") -- bei `previewRange >=
// path.length - 1` ist der komplette restliche Pfad sichtbar.
export function getVisiblePathPositions(path: readonly number[], previewRange: number): readonly number[] {
    const visibleCount = Math.max(1, Math.min(previewRange, path.length - 1) + 1);
    return path.slice(0, visibleCount);
}

export interface TrapEvent {
    step: number;
    junction: number;
    // Welche Gegner (Index in `paths`) diese Falle in DIESEM Schritt treffen
    // -- Laenge 1 = Einzelfang, Laenge >= 2 = Kettenreaktion (game-spec.md
    // 4.3 "Kernidee").
    enemyIndices: readonly number[];
    isChain: boolean;
}

// Fallen-Ausloesung (game-spec.md 4.3): fuer jeden Ausfuehrungsschritt wird
// geprueft, welche Gegner auf einer Falle stehen -- stehen ZWEI Gegner im
// SELBEN Schritt auf DERSELBEN Falle, ist das EIN Kettenreaktions-Ereignis
// (nicht zwei Einzelereignisse). Reine Funktion, kennt keine
// Payout-Mathematik (die lebt in drawTrapEventPayout).
export function resolveTraps(paths: readonly (readonly number[])[], trapJunctions: ReadonlySet<number>): TrapEvent[] {
    if (trapJunctions.size === 0) return [];
    const maxSteps = Math.max(...paths.map((p) => p.length));
    const events: TrapEvent[] = [];
    for (let step = 0; step < maxSteps; step += 1) {
        const hitsByJunction = new Map<number, number[]>();
        paths.forEach((path, enemyIndex) => {
            if (step >= path.length) return;
            const junction = path[step];
            if (!trapJunctions.has(junction)) return;
            const list = hitsByJunction.get(junction) ?? [];
            list.push(enemyIndex);
            hitsByJunction.set(junction, list);
        });
        for (const [junction, enemyIndices] of hitsByJunction) {
            events.push({ step, junction, enemyIndices, isChain: enemyIndices.length >= 2 });
        }
    }
    return events;
}

function meanRange([min, max]: readonly [number, number]): number {
    return (min + max) / 2;
}

// Zieht EINEN Wert aus der Payout-Spanne eines aufgeloesten Fallen-Ereignisses
// (game-spec.md 4.3 "Payout"): Kettenreaktion = deutlich groesserer Wert als
// Einzelfang, kein negativer Fall in dieser Version.
export function drawTrapEventPayout(
    config: Pick<TrapTunnelsRunConfig, 'singleCatchPayoutRange' | 'chainCatchPayoutRange'>,
    event: TrapEvent,
    rng: () => number = Math.random,
): number {
    const [min, max] = event.isChain ? config.chainCatchPayoutRange : config.singleCatchPayoutRange;
    return min + rng() * (max - min);
}

// Blind-Erwartungswert-Garantie (game-spec.md 4.3 PFLICHT, PER SIMULATION
// ueber viele Seeds statt einer geschlossenen Formel -- dieselbe Konvention
// wie GridRunEngine.computeBlindExpectedValue fuer Kategorien-Haeufigkeiten,
// hier aber ueber die Netz-/Pfad-Zufallsstruktur selbst, die sich nicht
// geschlossen berechnen laesst): simuliert `trials`-viele komplette Runs,
// platziert darin je EINE Falle komplett blind (ohne jede genutzte Vorschau)
// auf eine zufaellige Kreuzung, und mittelt den resultierenden Payout
// (Erwartungswert der jeweiligen Ereignis-Spanne statt eines gezogenen
// Zufallswerts, um Rausch-Varianz durch die Payout-Ziehung selbst nicht mit
// der eigentlich zu pruefenden Netz-/Pfad-Varianz zu vermischen).
export function computeBlindTrapExpectedValue(
    config: TrapTunnelsRunConfig,
    trials: number,
    rng: () => number = Math.random,
): number {
    let total = 0;
    for (let trial = 0; trial < trials; trial += 1) {
        const network = generateNetwork(config, rng);
        const starts = pickEnemyStartJunctions(network, config.enemyCount, config.minStartDistance, rng);
        const paths = starts.map((start) => generateEnemyPath(network, start, config.pathLength, rng));
        const blindJunction = Math.floor(rng() * network.junctionCount);
        const events = resolveTraps(paths, new Set([blindJunction]));
        for (const event of events) {
            total += meanRange(event.isChain ? config.chainCatchPayoutRange : config.singleCatchPayoutRange);
        }
    }
    return total / trials;
}

// Haelt den Zustand EINES laufenden Runs (Netz + feste Gegner-Pfade + aktuell
// platzierte Fallen) -- bewusst eine Klasse, analog zu GridRunEngine (dieser
// Automat hat genuin ueber die Planungsphase hinweg mutierenden Zustand: die
// Fallen-Platzierung). Netz UND Gegner-Pfade sind ab Konstruktion fest
// (game-spec.md 4.3 "pro Run einmalig fest vorab generiert").
export class TrapTunnelsEngine {
    private readonly network: TunnelNetwork;
    private readonly enemyPaths: readonly number[][];
    private readonly maxTraps: number;
    private readonly placedTraps = new Set<number>();

    constructor(config: TrapTunnelsRunConfig, maxTraps: number, rng: () => number = Math.random) {
        if (maxTraps <= 0) {
            throw new RangeError('TrapTunnelsEngine: maxTraps muss positiv sein');
        }
        this.network = generateNetwork(config, rng);
        const starts = pickEnemyStartJunctions(this.network, config.enemyCount, config.minStartDistance, rng);
        this.enemyPaths = starts.map((start) => generateEnemyPath(this.network, start, config.pathLength, rng));
        this.maxTraps = maxTraps;
    }

    getNetwork(): TunnelNetwork {
        return this.network;
    }

    getEnemyPaths(): readonly (readonly number[])[] {
        return this.enemyPaths;
    }

    getMaxTraps(): number {
        return this.maxTraps;
    }

    getPlacedTraps(): ReadonlySet<number> {
        return this.placedTraps;
    }

    canPlaceTrap(junction: number): boolean {
        if (junction < 0 || junction >= this.network.junctionCount) return false;
        if (this.placedTraps.has(junction)) return false;
        return this.placedTraps.size < this.maxTraps;
    }

    placeTrap(junction: number): boolean {
        if (!this.canPlaceTrap(junction)) return false;
        this.placedTraps.add(junction);
        return true;
    }

    removeTrap(junction: number): boolean {
        return this.placedTraps.delete(junction);
    }

    // Loest die Ausfuehrung anhand der final platzierten Fallen auf (game-
    // spec.md 4.3 "Los loest die Ausfuehrung aus") -- reine Ableitung, keine
    // Mutation, kann daher auch vor der eigentlichen Animation aufgerufen
    // werden, um alle Ereignisse im Voraus zu kennen.
    resolve(): TrapEvent[] {
        return resolveTraps(this.enemyPaths, this.placedTraps);
    }
}
