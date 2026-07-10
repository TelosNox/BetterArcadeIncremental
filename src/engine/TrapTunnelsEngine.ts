import type { TrapTunnelsRunConfig } from './types';

// Trap Tunnels (Automat 2, Phase 7j Kernmodell-Ersatz, game-spec.md 4.3 v2):
// Zufallsbewegung + Dynamit statt fester Gegner-Pfade + Vorschau-Reichweite
// (Phase 7i). Framework-unabhaengig, kennt weder Phaser noch React noch
// /src/data (Architektur-Kurzregel CLAUDE.md). Dieselbe Konvention wie
// GridRunEngine.ts: injizierbarer `rng: () => number = Math.random` fuer
// deterministische Tests, reine Funktionen wo moeglich, eine
// zustandsbehaftete Klasse fuer den Zustand EINES laufenden Runs.

export interface TunnelNetwork {
    gridSize: number;
    junctionCount: number;
    // Kanonische Kanten (a < b), einmal pro Run generiert und danach fest
    // (game-spec.md 4.3 "Netz-Generierung pro Run einmalig fest, bevor
    // Dynamit zum Einsatz kommt").
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

// Netz-Generierung (game-spec.md 4.3 "Netz-Generierung"): randomisiertes
// Kruskal auf den moeglichen Gitter-Kanten (garantiert einen Spannbaum, also
// Erreichbarkeit ALLER Kreuzungen), danach 3-4 zusaetzliche zufaellige Kanten
// aus den uebrig gebliebenen Kandidaten fuer Schleifen/Alternativrouten.
// Unveraendert aus Phase 7i wiederverwendet (game-spec.md 4.3 "identisch zum
// bisherigen Generierungsverfahren").
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

export function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// Entfernt die uebergebenen Kanten (Dynamit, game-spec.md 4.3) dauerhaft aus
// einem Netz -- reine Ableitung, das Original bleibt unveraendert (die
// Topologie ist immer vollstaendig sichtbar, auch nach dem Sprengen: der
// Spieler soll sehen, WAS gesprengt wurde, nicht nur das reduzierte Ergebnis).
export function removeEdges(network: TunnelNetwork, blastedEdges: ReadonlySet<string>): TunnelNetwork {
    if (blastedEdges.size === 0) return network;
    const edges = network.edges.filter(([a, b]) => !blastedEdges.has(edgeKey(a, b)));
    const adjacency: number[][] = Array.from({ length: network.junctionCount }, () => []);
    for (const [a, b] of edges) {
        adjacency[a].push(b);
        adjacency[b].push(a);
    }
    return { gridSize: network.gridSize, junctionCount: network.junctionCount, edges, adjacency };
}

// Start-Kreuzungen der Gegner (game-spec.md 4.3 "Netz-Generierung", Phase 7j):
// einfach unabhaengig zufaellig aus allen Kreuzungen gezogen, KEIN
// Mindestabstands-Constraint mehr (entfiel mit der alten, jetzt verworfenen
// Kettenreaktions-Planbarkeit aus Phase 7i) -- Doppelbelegung derselben
// Start-Kreuzung durch zwei Gegner ist dabei ausdruecklich moeglich, keine
// Sonderbehandlung noetig.
export function pickEnemyStartJunctions(network: TunnelNetwork, count: number, rng: () => number = Math.random): number[] {
    return Array.from({ length: count }, () => Math.floor(rng() * network.junctionCount));
}

// Waehlt die naechste Kreuzung EINES Gegners fuer EINEN Ausfuehrungsschritt
// (game-spec.md 4.3 "Kernidee", Phase 7j): gleichverteilt aus allen Kanten der
// aktuellen Kreuzung, AUSSER der Kante, ueber die der Gegner gerade gekommen
// ist (`cameFrom === null` beim allerersten Schritt -- keine Einschraenkung).
// Keine Option uebrig (Sackgasse oder nur noch die Rueckwaerts-Verbindung) ->
// `null`, der Aufrufer haelt den Gegner dann fuer den Rest des Runs fest.
export function pickNextJunction(
    network: TunnelNetwork,
    current: number,
    cameFrom: number | null,
    rng: () => number = Math.random,
): number | null {
    const neighbors = network.adjacency[current];
    const options = cameFrom === null ? neighbors : neighbors.filter((n) => n !== cameFrom);
    if (options.length === 0) return null;
    return options[Math.floor(rng() * options.length)];
}

// Loest die komplette Bewegung EINES Gegners ueber `steps`-viele Schritte auf
// (game-spec.md 4.3 Punkt 1, Phase 7j): live gewuerfelt statt vorab fest
// generiert, auf dem UEBERGEBENEN (ggf. per Dynamit reduzierten) Netz.
// `path[0]` ist die Start-Kreuzung, `path.length === steps + 1` IMMER --
// ein eingefrorener Gegner wiederholt seine letzte Position fuer die
// restlichen Schritte, damit `resolveTraps` weiterhin mit gleich langen
// Pfaden aller Gegner arbeiten kann.
export function resolveEnemyPath(network: TunnelNetwork, start: number, steps: number, rng: () => number = Math.random): number[] {
    const path = [start];
    let current = start;
    let cameFrom: number | null = null;
    let frozen = false;
    for (let step = 0; step < steps; step += 1) {
        if (!frozen) {
            const next = pickNextJunction(network, current, cameFrom, rng);
            if (next === null) {
                frozen = true;
            } else {
                cameFrom = current;
                current = next;
            }
        }
        path.push(current);
    }
    return path;
}

// Loest die Bewegung ALLER Gegner ueber `steps`-viele Schritte auf (game-
// spec.md 4.3 "Rundenstruktur": einmal komplett im Voraus berechnet, die
// Animation liest danach nur noch ab).
export function resolveEnemyMovement(
    network: TunnelNetwork,
    starts: readonly number[],
    steps: number,
    rng: () => number = Math.random,
): number[][] {
    return starts.map((start) => resolveEnemyPath(network, start, steps, rng));
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
// (nicht zwei Einzelereignisse). Fallen verbrauchen sich NICHT (game-spec.md
// 4.3 "Fallen") -- dieselbe Falle kann in unterschiedlichen Schritten
// beliebig oft erneut ausloesen, auch wiederholt durch denselben
// eingefrorenen Gegner. Reine Funktion, kennt keine Payout-Mathematik (die
// lebt in drawTrapEventPayout). Unveraendert aus Phase 7i uebernommen (game-
// spec.md 4.3 "resolveTraps-Logik bleibt strukturell bestehen").
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
// ueber viele Seeds statt einer geschlossenen Formel, unveraendert aus Phase
// 7i): simuliert `trials`-viele komplette Runs (Netz-Generierung + live
// gewuerfelte Bewegung, OHNE Dynamit-Einsatz), platziert darin je EINE Falle
// komplett blind (ohne jede genutzte Ueberlegung) auf eine zufaellige
// Kreuzung, und mittelt den resultierenden Payout (Erwartungswert der
// jeweiligen Ereignis-Spanne statt eines gezogenen Zufallswerts, um
// Rausch-Varianz durch die Payout-Ziehung selbst nicht mit der eigentlich zu
// pruefenden Netz-/Bewegungs-Varianz zu vermischen). `enemyCount` ist seit
// Phase 7j ein separater Parameter (kein Config-Feld mehr, siehe
// TrapTunnelsRunConfig-Kommentar).
export function computeBlindTrapExpectedValue(
    config: TrapTunnelsRunConfig,
    enemyCount: number,
    trials: number,
    rng: () => number = Math.random,
): number {
    let total = 0;
    for (let trial = 0; trial < trials; trial += 1) {
        const network = generateNetwork(config, rng);
        const starts = pickEnemyStartJunctions(network, enemyCount, rng);
        const paths = resolveEnemyMovement(network, starts, config.pathLength, rng);
        const blindJunction = Math.floor(rng() * network.junctionCount);
        const events = resolveTraps(paths, new Set([blindJunction]));
        for (const event of events) {
            total += meanRange(event.isChain ? config.chainCatchPayoutRange : config.singleCatchPayoutRange);
        }
    }
    return total / trials;
}

// Haelt den Zustand EINES laufenden Runs (Netz + Fallen-/Dynamit-Planung) --
// bewusst eine Klasse, analog zu GridRunEngine (dieser Automat hat genuin
// ueber die Planungsphase hinweg mutierenden Zustand: Fallen-Platzierung UND
// seit Phase 7j auch Dynamit-Planung). Das Netz ist ab Konstruktion fest
// (game-spec.md 4.3 "pro Run einmalig fest vorab generiert, bevor Dynamit
// zum Einsatz kommt"). Die Gegner-START-Kreuzungen sind seit Phase 7k
// EBENFALLS ab Konstruktion fest und waehrend der gesamten Planungsphase
// bekannt (game-spec.md 4.3 "Start-Kreuzungen muessen waehrend der Planung
// bekannt/sichtbar sein") -- nur der WEITERE Weg ab dort wird weiterhin ERST
// bei `resolve()` live gewuerfelt (Kernaenderung aus Phase 7j bleibt sonst
// unveraendert).
export class TrapTunnelsEngine {
    private readonly network: TunnelNetwork;
    private readonly config: TrapTunnelsRunConfig;
    private readonly maxTraps: number;
    private readonly maxDynamite: number;
    private readonly enemyCount: number;
    private readonly enemyStarts: readonly number[];
    private readonly rng: () => number;
    private readonly placedTraps = new Set<number>();
    private readonly blastedEdges = new Set<string>();
    private lastEnemyPaths: readonly (readonly number[])[] = [];

    constructor(
        config: TrapTunnelsRunConfig,
        maxTraps: number,
        maxDynamite: number,
        enemyCount: number,
        rng: () => number = Math.random,
    ) {
        if (maxTraps <= 0) {
            throw new RangeError('TrapTunnelsEngine: maxTraps muss positiv sein');
        }
        if (enemyCount <= 0) {
            throw new RangeError('TrapTunnelsEngine: enemyCount muss positiv sein');
        }
        this.network = generateNetwork(config, rng);
        this.config = config;
        this.maxTraps = maxTraps;
        this.maxDynamite = maxDynamite;
        this.enemyCount = enemyCount;
        this.rng = rng;
        // Auf dem VOLLEN, noch nicht durch Dynamit reduzierten Netz gezogen --
        // Dynamit kommt strukturell erst NACH der Planung zum Einsatz (game-
        // spec.md 4.3 "Netz-Generierung ... bevor Dynamit zum Einsatz kommt").
        this.enemyStarts = pickEnemyStartJunctions(this.network, enemyCount, rng);
    }

    getNetwork(): TunnelNetwork {
        return this.network;
    }

    getEnemyCount(): number {
        return this.enemyCount;
    }

    // Fest ab Konstruktion, waehrend der GESAMTEN Planungsphase bekannt/
    // sichtbar (Phase 7k, game-spec.md 4.3) -- aendert sich weder durch
    // Fallen-/Dynamit-Planung noch durch `resolve()`.
    getEnemyStartJunctions(): readonly number[] {
        return this.enemyStarts;
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

    getMaxDynamite(): number {
        return this.maxDynamite;
    }

    getBlastedEdges(): ReadonlySet<string> {
        return this.blastedEdges;
    }

    // Ob die Kante (a,b) ueberhaupt existiert UND noch nicht gesprengt wurde
    // UND das Dynamit-Kontingent noch nicht ausgeschoepft ist (game-spec.md
    // 4.3 "Dynamit": keinerlei weitere Einschraenkung -- Zonen isolieren oder
    // Gegner einsperren ist ausdruecklich erlaubt).
    canBlastEdge(a: number, b: number): boolean {
        if (!this.network.adjacency[a]?.includes(b)) return false;
        const key = edgeKey(a, b);
        if (this.blastedEdges.has(key)) return false;
        return this.blastedEdges.size < this.maxDynamite;
    }

    blastEdge(a: number, b: number): boolean {
        if (!this.canBlastEdge(a, b)) return false;
        this.blastedEdges.add(edgeKey(a, b));
        return true;
    }

    unblastEdge(a: number, b: number): boolean {
        return this.blastedEdges.delete(edgeKey(a, b));
    }

    // Die zuletzt bei resolve() live berechneten Gegner-Pfade -- leer, bevor
    // resolve() zum ersten Mal aufgerufen wurde (es gibt vorher schlicht noch
    // keine Bewegung, game-spec.md 4.3 Kernaenderung).
    getLastEnemyPaths(): readonly (readonly number[])[] {
        return this.lastEnemyPaths;
    }

    // Loest die Ausfuehrung auf (game-spec.md 4.3 "Rundenstruktur": sprengt
    // zuerst die gewaehlten Verbindungen, danach wird die Gegnerbewegung
    // Schritt fuer Schritt live auf dem reduzierten Netz gewuerfelt) -- anders
    // als in Phase 7i ist das keine reine Ableitung mehr auf bereits
    // feststehenden Pfaden, sondern wuerfelt bei JEDEM Aufruf neu. Der
    // Aufrufer ruft das genau EINMAL bei "Los" auf (die Fallen-/Dynamit-
    // Platzierung steht zu diesem Zeitpunkt fest) und liest Pfade/Ereignisse
    // danach nur noch ab, um die Animation deterministisch abzuspielen.
    // Seit Phase 7k werden die Start-Kreuzungen NICHT mehr neu gezogen (siehe
    // `this.enemyStarts`, fest ab Konstruktion) -- nur die Bewegungsauflösung
    // ab dort laeuft weiterhin auf dem UM die gesprengten Kanten reduzierten
    // Netz. Eine gesprengte Kante direkt an einer Start-Kreuzung veraendert
    // dadurch nur deren Optionen beim ersten Schritt, nicht die Kreuzung
    // selbst als Startpunkt.
    resolve(): TrapEvent[] {
        const reducedNetwork = removeEdges(this.network, this.blastedEdges);
        this.lastEnemyPaths = resolveEnemyMovement(reducedNetwork, this.enemyStarts, this.config.pathLength, this.rng);
        return resolveTraps(this.lastEnemyPaths, this.placedTraps);
    }
}
