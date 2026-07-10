import type {
    CyclicActionDef,
    CyclicMachineConfig,
    GridMachineConfig,
    GridSectorConfig,
    MachineConfig,
    MachineUpgradeDef,
    Milestone,
    ResolvedAction,
    SectorCategory,
    TrapTunnelsMachineConfig,
    TrapTunnelsRunConfig,
} from '../engine/types';
import {
    type AttendantRate,
    computeStationaryDistribution,
    getAttendantMachinePointsRate,
    getGridAttendantMachinePointsRate,
    getTrapTunnelsAttendantMachinePointsRate,
} from '../engine/AttendantEngine';
import { SECTOR_CATEGORIES } from '../engine/GridRunEngine';

// Automaten-Konfigurationen. Alle spielspezifischen Zahlen/Parameter leben
// hier (Architektur-Kurzregel in CLAUDE.md), MachineScene.ts liest nur.
//
// Phase 7c (Kernmechanik-Revision v2, siehe STATUS.md): ersetzt das
// "zwei harte Aktionen + Zwischenstufen"-Modell aus Phase 7b VOLLSTAENDIG
// durch ein rein zyklisches Konter-Modell (game-spec.md 4.1b):
//   - n=5 Aktionen UND n=5 Pattern-Zustaende, beide in derselben zyklischen
//     Reihenfolge positionell 1:1 zugeordnet (buildCyclicActions leitet
//     counterState/losesToState strukturell aus der Position ab, keine
//     Hand-Transkription -- schliesst Zuordnungsfehler aus).
//   - Jede Aktion trifft IMMER (kein Erfolg/Fehlschlag mehr), nur die
//     Payout-Spanne unterscheidet sich: Grosser Gewinn (1 Zustand),
//     Verlust (1 Zustand, negativ, feste Spanne statt Prozentabzug),
//     Einfacher Treffer (die uebrigen 3 Zustaende).
//   - Zwei-Achsen-Vorschau (depthUpgrades/precisionUpgrades) ersetzt die
//     bisherige einzelne "visibility"-Leiter aus Phase 7b.

export const N_STATES = 5;
export const START_DEPTH = 1; // Spieler startet nie komplett blind (STATUS.md Punkt 7)
export const START_PRECISION = 1;
export const MAX_PRECISION = N_STATES - 1; // p = n-1 => Zustand de facto bekannt
export const CROSS_PRICE_SURCHARGE_K = 0.2; // Kreuz-Preis-Aufschlag pro Stufe des jeweils anderen Pfads

// Phase 7e (Erkennbarkeit + Banking-Streichung, siehe STATUS.md/CLAUDE.md
// "UI-Grundsatz: Barrierefreiheit bei Farbcodierung"): 5 farbenblind-sichere
// Farben (Teilmenge der Okabe-Ito-Palette, https://jfly.uni-koeln.de/color/ --
// paarweise unterscheidbar auch bei den haeufigsten Farbfehlsichtigkeiten),
// EINE gemeinsame Palette fuer alle vier Automaten, da die Kopplung an die
// ZYKLUS-POSITION (0-4) haengt, nicht an ein automaten-spezifisches Thema --
// Zustand i UND Aktion i (positionell 1:1 gekoppelt, siehe buildCyclicActions)
// teilen sich STATE_COLORS[i]. Farbe ist NIE das einzige Unterscheidungs-
// merkmal: jede Position wird zusaetzlich IMMER mit ihrer 1-basierten
// Positionsnummer (1-5) beschriftet (siehe MachineScene.ts) -- ein zweites,
// farbunabhaengiges Merkmal, wie vom CLAUDE.md-Grundsatz gefordert.
export const STATE_COLORS: readonly number[] = [
    0xe69f00, // Orange
    0x56b4e9, // Sky Blue
    0x009e73, // Bluish Green
    0xd55e00, // Vermillion
    0xcc79a7, // Reddish Purple
];
export const UNKNOWN_COLOR = 0x666666; // neutrales Grau fuer "ausserhalb der Sichtweite"/ausgeschlossene Kandidaten

export function getStateColor(index: number): number {
    return STATE_COLORS[((index % STATE_COLORS.length) + STATE_COLORS.length) % STATE_COLORS.length];
}

// Phase 7f (Greed Run Genre-Rework, game-spec.md 4.2): eigene, ebenfalls
// farbenblind-sichere Palette (Teilmenge Okabe-Ito) fuer die 4 Sektor-
// Kategorien des Grid-Automaten -- inhaltlich unabhaengig von STATE_COLORS
// (die an die ZYKLUS-Position gekoppelt ist, hier geht es um Kategorien).
// Wie bei STATE_COLORS gilt CLAUDE.md "Barrierefreiheit bei Farbcodierung":
// Farbe ist nie das einzige Merkmal -- SECTOR_SYMBOLS liefert je Kategorie
// zusaetzlich einen kurzen, farbunabhaengigen Buchstaben (GreedRunScene.ts
// zeichnet Farbe+Symbol immer gemeinsam).
export const SECTOR_COLORS: Readonly<Record<SectorCategory, number>> = {
    ghost: 0xd55e00, // Vermillion -- Gefahr
    points: 0x56b4e9, // Sky Blue -- Standardfall
    bonus: 0xf0e442, // Yellow -- selten, besonders wertvoll
    empty: 0x3a3a3a, // neutrales Dunkelgrau -- kein Payout
};

export const SECTOR_SYMBOLS: Readonly<Record<SectorCategory, string>> = {
    ghost: 'G',
    points: 'P',
    bonus: 'B',
    empty: '',
};

export function getSectorColor(category: SectorCategory): number {
    return SECTOR_COLORS[category];
}

// Phase 7i (Trap Tunnels Genre-Rework, game-spec.md 4.3): eigene, ebenfalls
// farbenblind-sichere Palette (Teilmenge Okabe-Ito) fuer die beiden Gegner
// UND die Fallen -- CLAUDE.md "Barrierefreiheit bei Farbcodierung": Farbe ist
// nie das einzige Merkmal. Gegner unterscheiden sich zusaetzlich ueber
// ENEMY_LABELS (Buchstabe A/B), Fallen zusaetzlich ueber ihre FORM (Raute
// statt Kreis, siehe TrapTunnelsScene.ts) statt nur ueber TRAP_COLOR.
export const ENEMY_COLORS: readonly number[] = [
    0x56b4e9, // Sky Blue -- Gegner A
    0xe69f00, // Orange -- Gegner B
];
export const ENEMY_LABELS: readonly string[] = ['A', 'B'];
export const TRAP_COLOR = 0xd55e00; // Vermillion -- Fallen (Form: Raute)

export function getEnemyColor(index: number): number {
    return ENEMY_COLORS[((index % ENEMY_COLORS.length) + ENEMY_COLORS.length) % ENEMY_COLORS.length];
}

export function getEnemyLabel(index: number): string {
    return ENEMY_LABELS[((index % ENEMY_LABELS.length) + ENEMY_LABELS.length) % ENEMY_LABELS.length];
}

// Feste, NICHT kaufbare Normalisierungs-Konstante pro Automat (game-spec.md
// 3.1, Phase 7d): gleicht die unterschiedlichen Rohzahlen-Skalen der vier
// Automaten NICHT vollstaendig aus (spaetere Automaten duerfen absolut
// weiterhin mehr beitragen, normales Incremental-Verhalten laut STATUS.md),
// sondern daempft sie auf einen fairen BASIS-Vergleich: factor =
// 1/sqrt(scalingFactor), wobei scalingFactor derselbe Meilenstein-
// Skalierungsfaktor gegenueber Greed Run ist, der bereits die Payout-Ranges
// und Meilenstein-Schwellen aller vier Automaten bestimmt (1.0/1.2/1.4/1.8,
// siehe die einzelnen Automaten-Definitionen unten). Ohne Normalisierung
// wuerde Champion's Ledger bei sonst identischer Spielweise ca. 1.8x mehr
// Tickets pro Aktion erzeugen als Greed Run (reine Folge der 1.8x hoeheren
// Rohzahlen); mit der sqrt-Daempfung sind es noch ca. 1.8 * (1/sqrt(1.8)) =
// sqrt(1.8) ~= 1.34x -- immer noch spuerbar mehr (passend zum spaeteren,
// schwierigeren Automaten), aber nicht mehr proportional zur vollen
// Rohzahlen-Skalierung.
function ticketYieldFactorFor(scalingFactor: number): number {
    return Math.round((1 / Math.sqrt(scalingFactor)) * 1000) / 1000;
}

// --- Zyklisches Aktionsmodell -----------------------------------------

export interface CyclicActionTemplate {
    id: string;
    payoutBig: [number, number];
    payoutSimple: [number, number];
    payoutLoss: [number, number];
}

// Leitet counterState (naechster Zustand im Zyklus) und losesToState
// (vorheriger Zustand im Zyklus) strukturell aus der Position in `states`
// ab -- `states` und `templates` muessen dieselbe Laenge UND dieselbe
// zyklische Reihenfolge haben (game-spec.md 4.1b: "Pattern-Zustaende =
// Aktionen 1:1"). Das macht die 1-Gewinn/1-Verlust/3-Neutral-Struktur pro
// Aktion strukturell garantiert statt von Hand transkribiert.
export function buildCyclicActions(
    states: readonly string[],
    templates: readonly CyclicActionTemplate[],
): CyclicActionDef[] {
    if (states.length !== templates.length) {
        throw new RangeError(
            `buildCyclicActions: Anzahl states (${states.length}) muss der Anzahl Aktions-Templates (${templates.length}) entsprechen`,
        );
    }
    const n = states.length;
    return templates.map((template, i) => ({
        id: template.id,
        counterState: states[(i + 1) % n],
        losesToState: states[(i - 1 + n) % n],
        payoutBig: template.payoutBig,
        payoutSimple: template.payoutSimple,
        payoutLoss: template.payoutLoss,
    }));
}

// Wandelt eine konfigurierte CyclicActionDef (Config-Zeit) in eine
// ResolvedAction (Engine-Zeit, das was PushYourLuckEngine.drawPayout
// tatsaechlich konsumiert) um. Deterministisch: welche der drei Payout-
// Spannen gilt, haengt nur vom aktuellen festen Zustand ab -- kein
// Zufall bei der "Trefferfrage" mehr (die gibt es seit Phase 7c nicht mehr,
// siehe PushYourLuckEngine.ts).
export function resolveMachineAction(action: CyclicActionDef, currentState: string): ResolvedAction {
    if (currentState === action.counterState) {
        return { id: action.id, payoutRange: action.payoutBig };
    }
    if (currentState === action.losesToState) {
        return { id: action.id, payoutRange: action.payoutLoss };
    }
    return { id: action.id, payoutRange: action.payoutSimple };
}

// --- Zwei-Achsen-Vorschau: Kandidaten-Ausschluss -----------------------

// Reine, testbare Funktion (STATUS.md Punkt 3 der Konkreten Umsetzung):
// liefert eine STABILE, zufaellige Reihenfolge der "falschen" Kandidaten
// (alle Zustaende ausser dem wahren) fuer EINE Position. Bei Praezision p
// werden die ersten p Eintraege dieser Reihenfolge ausgeschlossen (siehe
// getExcludedCandidates) -- die Reihenfolge selbst wird nur EINMAL pro
// Position gewuerfelt und danach nie neu gezogen (Baukasten 1.11: keine
// zusaetzliche versteckte Zufallsebene bei wiederholtem Hinsehen). Steigt
// die Praezision spaeter (automaten-internes Upgrade gekauft), werden
// einfach mehr Eintraege derselben Reihenfolge aufgedeckt -- das reveal ist
// dadurch monoton (nie widerspruechlich zu vorher gezeigter Information).
export function computeCandidateExclusionOrder(
    states: readonly string[],
    trueState: string,
    rng: () => number = Math.random,
): string[] {
    const wrongCandidates = states.filter((s) => s !== trueState);
    const shuffled = [...wrongCandidates];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function getExcludedCandidates(exclusionOrder: readonly string[], precision: number): string[] {
    const count = Math.max(0, Math.min(precision, exclusionOrder.length));
    return exclusionOrder.slice(0, count);
}

// --- Automaten-interne Upgrades (Zwei-Achsen-Vorschau) -----------------

const DEPTH_NUMERALS = ['I', 'II', 'III', 'IV'];
const PRECISION_NUMERALS = ['I', 'II', 'III'];

// baseCosts[0] = Preis fuer Stufe START_DEPTH+1 (=2), usw. -- absolute
// Zielwerte (value), keine additiven Schritte (Konvention wie in
// hall.config.ts). `cost` ist der BASISPREIS vor Kreuz-Preis-Aufschlag
// (siehe getMachineUpgradeCost).
function buildDepthUpgrades(idPrefix: string, namePrefix: string, baseCosts: readonly number[]): MachineUpgradeDef[] {
    return baseCosts.map((cost, i) => {
        const value = START_DEPTH + i + 1;
        return {
            id: `${idPrefix}-depth-${value}`,
            name: `${namePrefix} ${DEPTH_NUMERALS[i]}`,
            description: `Zeigt ${value} kommende Positionen der festen Sequenz mit Teilinformation (statt ${value - 1}).`,
            cost,
            effect: { type: 'previewDepth', value },
        };
    });
}

function buildPrecisionUpgrades(
    idPrefix: string,
    namePrefix: string,
    baseCosts: readonly number[],
): MachineUpgradeDef[] {
    return baseCosts.map((cost, i) => {
        const value = START_PRECISION + i + 1;
        return {
            id: `${idPrefix}-precision-${value}`,
            name: `${namePrefix} ${PRECISION_NUMERALS[i]}`,
            description: `Schliesst ${value} von ${N_STATES - 1} falschen Kandidaten pro sichtbarer Position aus (statt ${value - 1}).`,
            cost,
            effect: { type: 'previewPrecision', value },
        };
    });
}

function countOwnedIn(upgrades: readonly MachineUpgradeDef[], ownedUpgradeIds: readonly string[]): number {
    return upgrades.filter((u) => ownedUpgradeIds.includes(u.id)).length;
}

export function getPreviewDepth(machine: CyclicMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.depthUpgrades.reduce((max, u) => {
        if (u.effect.type === 'previewDepth' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_DEPTH);
}

export function getPreviewPrecision(machine: CyclicMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.precisionUpgrades.reduce((max, u) => {
        if (u.effect.type === 'previewPrecision' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_PRECISION);
}

// Kreuz-Preis-Kopplung (STATUS.md Punkt 7): der Preis der naechsten Stufe
// EINER Achse steigt multiplikativ mit der Anzahl bereits gekaufter Stufen
// der JEWEILS ANDEREN Achse (ueber deren Startwert hinaus). Kein harter
// Ausschluss -- nur eine Bremse gegen einseitiges Rushen.
export function getMachineUpgradeCost(
    machine: CyclicMachineConfig,
    upgrade: MachineUpgradeDef,
    ownedUpgradeIds: readonly string[],
): number {
    const isDepth = upgrade.effect.type === 'previewDepth';
    const otherLadder = isDepth ? machine.precisionUpgrades : machine.depthUpgrades;
    const otherBoughtBeyondStart = countOwnedIn(otherLadder, ownedUpgradeIds);
    return upgrade.cost * Math.pow(1 + CROSS_PRICE_SURCHARGE_K, otherBoughtBeyondStart);
}

export function getMachineUpgrade(machine: CyclicMachineConfig, upgradeId: string): MachineUpgradeDef | undefined {
    return [...machine.depthUpgrades, ...machine.precisionUpgrades].find((upgrade) => upgrade.id === upgradeId);
}

// --- Grid-Automat: drei unabhaengige Upgrade-Achsen (Phase 7f, game-spec.md
// 4.2 "Drei unabhaengige Upgrade-Achsen") ---------------------------------
//
// Bewusst KEINE Kreuz-Preis-Kopplung wie beim zyklischen Modell (nicht Teil
// der Spezifikation dieses Experiments, siehe STATUS.md) -- jede Achse hat
// ihre eigene, unabhaengige Kostenleiter. Bezahlt wie depthUpgrades/
// precisionUpgrades mit den EIGENEN Automaten-Punkten dieses Automaten
// (MachineUpgradeDef.cost), nicht mit hallenweiten Tickets.

export const START_SIGHT_RANGE = 1;
export const MAX_SIGHT_RANGE = 4;
export const START_GRID_PRECISION = 1;
export const MAX_GRID_PRECISION = SECTOR_CATEGORIES.length - 1; // = 3, "bei Praezision 3 vollstaendig bekannt"
export const START_ACTION_BUDGET = 4;

const SIGHT_NUMERALS = ['I', 'II', 'III'];
const GRID_PRECISION_NUMERALS = ['I', 'II'];
const ACTION_BUDGET_NUMERALS = ['I', 'II', 'III', 'IV'];

function buildSightRangeUpgrades(
    idPrefix: string,
    namePrefix: string,
    values: readonly number[],
    baseCosts: readonly number[],
): MachineUpgradeDef[] {
    return values.map((value, i) => ({
        id: `${idPrefix}-sight-${value}`,
        name: `${namePrefix} ${SIGHT_NUMERALS[i]}`,
        description: `Sichtweite (Manhattan-Radius um die aktuelle Position, neu zentriert nach jedem Zug) steigt auf ${value}.`,
        cost: baseCosts[i],
        effect: { type: 'gridSightRange', value },
    }));
}

function buildGridPrecisionUpgrades(
    idPrefix: string,
    namePrefix: string,
    values: readonly number[],
    baseCosts: readonly number[],
): MachineUpgradeDef[] {
    return values.map((value, i) => ({
        id: `${idPrefix}-grid-precision-${value}`,
        name: `${namePrefix} ${GRID_PRECISION_NUMERALS[i]}`,
        description: `Loest ${value} von ${MAX_GRID_PRECISION} Kategorien pro sichtbarem Sektor zweifelsfrei auf (fokus-abhaengige Reihenfolge).`,
        cost: baseCosts[i],
        effect: { type: 'gridPrecision', value },
    }));
}

function buildActionBudgetUpgrades(
    idPrefix: string,
    namePrefix: string,
    values: readonly number[],
    baseCosts: readonly number[],
): MachineUpgradeDef[] {
    return values.map((value, i) => ({
        id: `${idPrefix}-action-budget-${value}`,
        name: `${namePrefix} ${ACTION_BUDGET_NUMERALS[i]}`,
        description: `Aktionsbudget (Zuege pro Run, unabhaengig von der Sichtweite) steigt auf ${value}.`,
        cost: baseCosts[i],
        effect: { type: 'gridActionBudget', value },
    }));
}

export function getSightRange(machine: GridMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.sightRangeUpgrades.reduce((max, u) => {
        if (u.effect.type === 'gridSightRange' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_SIGHT_RANGE);
}

export function getGridPrecisionLevel(machine: GridMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.gridPrecisionUpgrades.reduce((max, u) => {
        if (u.effect.type === 'gridPrecision' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_GRID_PRECISION);
}

export function getActionBudget(machine: GridMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.actionBudgetUpgrades.reduce((max, u) => {
        if (u.effect.type === 'gridActionBudget' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_ACTION_BUDGET);
}

export function getGridMachineUpgrade(machine: GridMachineConfig, upgradeId: string): MachineUpgradeDef | undefined {
    return [...machine.sightRangeUpgrades, ...machine.gridPrecisionUpgrades, ...machine.actionBudgetUpgrades].find(
        (upgrade) => upgrade.id === upgradeId,
    );
}

// --- Trap-Tunnels-Automat: zwei unabhaengige Upgrade-Achsen (Phase 7i, -----
// game-spec.md 4.3 "Zwei unabhaengige Upgrade-Achsen") ----------------------
//
// Bewusst KEINE Kreuz-Preis-Kopplung, wie schon beim Grid-Automaten oben --
// jede Achse hat ihre eigene, unabhaengige Kostenleiter, bezahlt mit den
// eigenen Automaten-Punkten dieses Automaten.

export const START_TRAP_PREVIEW_RANGE = 1;
// Deckt sich bewusst mit TRAP_TUNNELS.run.pathLength (siehe unten) -- bei
// voller Stufe ist der komplette restliche Gegner-Pfad sichtbar (game-spec.md
// 4.3 "Vorschau-Reichweite").
export const MAX_TRAP_PREVIEW_RANGE = 6;
export const START_TRAP_COUNT = 1;
export const MAX_TRAP_COUNT = 3;

const TRAP_PREVIEW_NUMERALS = ['I', 'II', 'III'];
const TRAP_COUNT_NUMERALS = ['I', 'II'];

function buildTrapPreviewRangeUpgrades(
    idPrefix: string,
    namePrefix: string,
    values: readonly number[],
    baseCosts: readonly number[],
): MachineUpgradeDef[] {
    return values.map((value, i) => ({
        id: `${idPrefix}-trap-preview-${value}`,
        name: `${namePrefix} ${TRAP_PREVIEW_NUMERALS[i]}`,
        description: `Zeigt die naechsten ${value} Schritte JEDES Gegner-Pfads (statt ${
            i === 0 ? START_TRAP_PREVIEW_RANGE : values[i - 1]
        }).`,
        cost: baseCosts[i],
        effect: { type: 'trapPreviewRange', value },
    }));
}

function buildTrapCountUpgrades(
    idPrefix: string,
    namePrefix: string,
    values: readonly number[],
    baseCosts: readonly number[],
): MachineUpgradeDef[] {
    return values.map((value, i) => ({
        id: `${idPrefix}-trap-count-${value}`,
        name: `${namePrefix} ${TRAP_COUNT_NUMERALS[i]}`,
        description: `Erlaubt ${value} gleichzeitig platzierte Fallen (statt ${i === 0 ? START_TRAP_COUNT : values[i - 1]}).`,
        cost: baseCosts[i],
        effect: { type: 'trapCount', value },
    }));
}

export function getTrapPreviewRange(machine: TrapTunnelsMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.trapPreviewRangeUpgrades.reduce((max, u) => {
        if (u.effect.type === 'trapPreviewRange' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_TRAP_PREVIEW_RANGE);
}

export function getTrapCount(machine: TrapTunnelsMachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.trapCountUpgrades.reduce((max, u) => {
        if (u.effect.type === 'trapCount' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_TRAP_COUNT);
}

export function getTrapTunnelsMachineUpgrade(machine: TrapTunnelsMachineConfig, upgradeId: string): MachineUpgradeDef | undefined {
    return [...machine.trapPreviewRangeUpgrades, ...machine.trapCountUpgrades].find((upgrade) => upgrade.id === upgradeId);
}

// --- Attendant-Ertragsrate (Phase 7d, STATUS.md Teil 2; Phase 7f erweitert
// um den Grid-Automaten-Zweig, Phase 7i um den Trap-Tunnels-Zweig) --------
//
// Komposition der reinen Engine-Mathematik (AttendantEngine.ts) mit den
// Data-Layer-Werten dieses Automaten (Pattern/Aktionen/Vorschau-Upgrades ODER
// Grid-Kategorien/Praezisions-Upgrade, je nach `kind`) UND dem hallenweiten
// Ticket-Ertragsrate-Multiplikator (hall.config.ts) -- lebt hier statt in
// AttendantEngine.ts, weil letztere laut Architektur-Kurzregel nie aus
// /src/data importieren darf (dieselbe Konvention wie
// resolveMachineAction/getEffectiveTrainingGain). Einziger Ort, an dem
// zwischen den beiden MachineConfig-Varianten unterschieden werden muss --
// alle Aufrufer (economy.ts::tickAttendants, AttendantPanel.tsx,
// MachineScene.ts) bleiben dadurch kind-agnostisch.
export function getMachineAttendantRate(
    machine: MachineConfig,
    knowledge: number,
    ownedUpgradeIds: readonly string[],
    ticketYieldRate: number,
): AttendantRate {
    let machinePointsPerSecond: number;
    if (machine.kind === 'grid') {
        machinePointsPerSecond = getGridAttendantMachinePointsRate(
            machine.grid,
            knowledge,
            getGridPrecisionLevel(machine, ownedUpgradeIds),
            MAX_GRID_PRECISION,
        );
    } else if (machine.kind === 'trapTunnels') {
        machinePointsPerSecond = getTrapTunnelsAttendantMachinePointsRate(
            machine.run,
            knowledge,
            getTrapCount(machine, ownedUpgradeIds),
            getTrapPreviewRange(machine, ownedUpgradeIds),
            MAX_TRAP_PREVIEW_RANGE,
        );
    } else {
        machinePointsPerSecond = getAttendantMachinePointsRate(
            machine.actions,
            computeStationaryDistribution(machine.pattern),
            knowledge,
            getPreviewDepth(machine, ownedUpgradeIds),
            getPreviewPrecision(machine, ownedUpgradeIds),
            MAX_PRECISION,
        );
    }
    return {
        machinePointsPerSecond,
        hallTicketsPerSecond: machinePointsPerSecond * machine.ticketYieldFactor * ticketYieldRate,
    };
}

// --- Zielwert-Check (STATUS.md Punkt 7, PFLICHT) -----------------------

// Gesamtkosten beider Leitern bei AUSGEWOGENEM (interleaved) Einkauf:
// D1, P1, D2, P2, D3, P3, D4 (Tiefe hat eine Stufe mehr als Praezision,
// daher am Ende ohne Partner). Reine, testbare Funktion -- reproduziert
// exakt die Kreuz-Preis-Formel oben, nur als Summe ueber eine konkrete
// Kaufreihenfolge statt inkrementell zur Laufzeit.
export function computeInterleavedUpgradeCost(machine: CyclicMachineConfig): number {
    const depthCosts = machine.depthUpgrades.map((u) => u.cost);
    const precisionCosts = machine.precisionUpgrades.map((u) => u.cost);
    let depthBought = 0;
    let precisionBought = 0;
    let total = 0;
    let di = 0;
    let pi = 0;
    while (di < depthCosts.length || pi < precisionCosts.length) {
        if (di < depthCosts.length) {
            total += depthCosts[di] * Math.pow(1 + CROSS_PRICE_SURCHARGE_K, precisionBought);
            di += 1;
            depthBought += 1;
        }
        if (pi < precisionCosts.length) {
            total += precisionCosts[pi] * Math.pow(1 + CROSS_PRICE_SURCHARGE_K, depthBought);
            pi += 1;
            precisionBought += 1;
        }
    }
    return total;
}

export function getFinalMilestoneThreshold(machine: MachineConfig): number {
    return machine.milestones[machine.milestones.length - 1].threshold;
}

// Verhaeltnis von Gesamtkosten beider Leitern (ausgewogener Einkauf) zum
// erwarteten Automaten-Punkte-Ertrag bis zum ERSTEN Erreichen des letzten
// Meilensteins. Der letzte Meilenstein-Schwellenwert selbst ist eine gute
// Naeherung fuer diesen erwarteten Ertrag, da der Punktestand seit Phase 7d/
// 7e ohnehin sofort und dauerhaft verbucht wird (kein Banking-Ueberschuss
// mehr einzukalkulieren, siehe Blind-EV-Werte im Test). Zielkorridor
// 85-95%, per Test verifiziert (machines.config.test.ts). Wert historisch
// unter Phase-7c-Annahmen kalibriert (siehe STATUS.md) -- bleibt in Phase 7e
// gueltig, da sich an den Payout-/Meilenstein-Zahlen nichts aendert.
export function getUpgradeCostToMilestoneRatio(machine: CyclicMachineConfig): number {
    return computeInterleavedUpgradeCost(machine) / getFinalMilestoneThreshold(machine);
}

// --- Meilenstein-Auswertung gegen den persistenten Punktestand-Peak -----
// (Phase 7e, ersetzt PushYourLuckRun.getReachedMilestones/canBank/bank; siehe
// STATUS.md "Banking-Streichung"). `peakScore` kommt aus
// EconomyStore.getMachinePeakScore(machineId) -- reine Ableitungsfunktion,
// kennt selbst keinen State.
export function getReachedMilestones(machine: MachineConfig, peakScore: number): Milestone[] {
    return machine.milestones.filter((m) => peakScore >= m.threshold);
}

export function isFinalMilestoneReached(machine: MachineConfig, peakScore: number): boolean {
    return peakScore >= getFinalMilestoneThreshold(machine);
}

// ========================================================================
// "Greed Run" (Automat 1, Layer-0-Einstieg) laut game-spec.md 4.2 (Phase 7f
// Genre-Rework, 2026-07-10): 5x5-Sektorenfeld statt zyklisches Pattern.
// Ersetzt das vorherige 5-Zustands-Zyklus-Modell VOLLSTAENDIG -- nutzt
// PatternEngine/CyclicActionDef nicht mehr (siehe GridRunEngine.ts).
// ========================================================================

// 24 Nicht-Start-Sektoren: 5 Geist, 14 Punkte (Standardfall), 3 Leer,
// 2 Bonus-Frucht (selten, game-spec.md 4.2 "Sektorinhalt"). Blind-EV-
// Garantie (per Test in machines.config.test.ts verifiziert, gleiches
// Prinzip wie bei den zyklischen Automaten, nur ueber die Kategorien-
// Haeufigkeit statt einer stationaeren Markov-Verteilung gemittelt):
// 5/24*(-8) + 14/24*4.5 + 3/24*0 + 2/24*18.5 = 2.5 > 0.
const GREED_RUN_GRID: GridSectorConfig = {
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

export const GREED_RUN: GridMachineConfig = {
    kind: 'grid',
    id: 'greed-run',
    name: 'Greed Run',
    theme: 'pacman-twist',
    entryPoint: true,
    // Meilensteine UNVERAENDERT gegenueber dem alten Zyklus-Modell (bleiben
    // die Skalierungs-Basis fuer Trap Tunnels/Beat Ledger/Champion's Ledger,
    // siehe deren ticketYieldFactor-Kommentare unten).
    milestones: [{ threshold: 20 }, { threshold: 50 }, { threshold: 100 }],
    grid: GREED_RUN_GRID,
    sightRangeUpgrades: buildSightRangeUpgrades('greed-run', 'Weitblick', [2, 3, 4], [3, 7, 15]),
    gridPrecisionUpgrades: buildGridPrecisionUpgrades('greed-run', 'Spuersinn', [2, 3], [4, 10]),
    actionBudgetUpgrades: buildActionBudgetUpgrades('greed-run', 'Ausdauer', [6, 9, 13, 18], [3, 6, 12, 24]),
    ticketYieldFactor: ticketYieldFactorFor(1.0), // = 1.0, Skalierungs-Basis (unveraendert)
};

// ========================================================================
// "Trap Tunnels" (Automat 2) laut game-spec.md 4.3 (Phase 7i Genre-Rework,
// 2026-07-10): Tunnelnetz-Fallen-Modell statt zyklisches Konter-Modell.
// Ersetzt das vorherige 5-Zustands-Zyklus-Modell VOLLSTAENDIG -- nutzt
// PatternEngine/CyclicActionDef nicht mehr (siehe TrapTunnelsEngine.ts).
// Meilenstein-Schwellen (25/60/120) und ticketYieldFactor (~0.913, Skalierungs-
// faktor 1.2 gegenueber Greed Run) UNVERAENDERT aus der bisherigen Config
// uebernommen (game-spec.md 4.3 Punkt 9) -- nur Zug-/Ausfuehrungslogik und
// Vorschau sind neu.
// ========================================================================

// 4x4-Kreuzungs-Raster (16 Kreuzungen), Spannbaum + 3-4 Zusatzkanten,
// Pfadlaenge 6 pro Gegner (7 Positionen inkl. Start), 2 Gegner mit
// Mindestabstand 3 (game-spec.md 4.3 "Tunnelnetz-Generierung"). Kein
// negativer Payout-Fall (game-spec.md 4.3 "Payout") -- die Blind-EV-Garantie
// ist dadurch strukturell erfuellt, solange die Trefferwahrscheinlichkeit > 0
// ist (per Simulation ueber viele Seeds verifiziert, siehe
// TrapTunnelsEngine.test.ts).
const TRAP_TUNNELS_RUN: TrapTunnelsRunConfig = {
    gridSize: 4,
    extraEdgeRange: [3, 4],
    pathLength: 6,
    enemyCount: 2,
    minStartDistance: 3,
    singleCatchPayoutRange: [7, 12],
    chainCatchPayoutRange: [24, 34],
};

export const TRAP_TUNNELS: TrapTunnelsMachineConfig = {
    kind: 'trapTunnels',
    id: 'trap-tunnels',
    name: 'Trap Tunnels',
    theme: 'digdug-twist',
    entryPoint: false,
    milestones: [{ threshold: 25 }, { threshold: 60 }, { threshold: 120 }],
    run: TRAP_TUNNELS_RUN,
    // 3 Vorschau-Reichweite-Stufen (1 -> 2 -> 4 -> 6, letzte Stufe deckt sich
    // mit run.pathLength) + 2 Fallenanzahl-Stufen (1 -> 2 -> 3) -- Basispreise
    // = Greed Runs Grid-Upgrade-Basispreise * 1.2 (Skalierungsfaktor),
    // gerundet, analog zum bisherigen Vorgehen bei den zyklischen Automaten.
    trapPreviewRangeUpgrades: buildTrapPreviewRangeUpgrades('trap-tunnels', 'Tunnelkarte', [2, 4, 6], [4, 8, 18]),
    trapCountUpgrades: buildTrapCountUpgrades('trap-tunnels', 'Fallenwerkstatt', [2, 3], [5, 12]),
    ticketYieldFactor: ticketYieldFactorFor(1.2), // ~= 0.913
};

// ========================================================================
// "Beat Ledger" (Automat 3) laut game-spec.md 4.4: DDR/Whac-a-Mole-Twist.
// Skalierungsfaktor gegenueber Greed Run: 140/100 = 1.4.
// ========================================================================

const BEAT_LEDGER_STATES = ['ruhig', 'treibend', 'doppelschlag', 'synkope', 'break'];

const BEAT_LEDGER_ACTIONS = buildCyclicActions(BEAT_LEDGER_STATES, [
    { id: 'grundschlag', payoutBig: [26, 36], payoutSimple: [8, 13], payoutLoss: [-15, -10] },
    { id: 'doppelkombo', payoutBig: [26, 36], payoutSimple: [8, 13], payoutLoss: [-15, -10] },
    { id: 'synkopenkombo', payoutBig: [26, 36], payoutSimple: [8, 13], payoutLoss: [-15, -10] },
    { id: 'breakbeat', payoutBig: [26, 36], payoutSimple: [8, 13], payoutLoss: [-15, -10] },
    { id: 'standakkord', payoutBig: [26, 36], payoutSimple: [8, 13], payoutLoss: [-15, -10] },
]);

// Blind-EV-Garantie: stationaere Verteilung ruhig ~21.3%, treibend ~20.3%,
// doppelschlag ~18.8%, synkope ~19.7%, break ~19.8%. Blind-EV zwischen
// ~9.46 (b2/doppelkombo) und ~10.33 (b5/standakkord), Verhaeltnis ~1.09.
export const BEAT_LEDGER: CyclicMachineConfig = {
    kind: 'cyclic',
    id: 'beat-ledger',
    name: 'Beat Ledger',
    theme: 'ddr-twist',
    entryPoint: false,
    pattern: {
        states: BEAT_LEDGER_STATES,
        transitions: {
            ruhig: { ruhig: 0.35, treibend: 0.35, doppelschlag: 0.1, synkope: 0.1, break: 0.1 },
            treibend: { ruhig: 0.15, treibend: 0.3, doppelschlag: 0.3, synkope: 0.15, break: 0.1 },
            doppelschlag: { ruhig: 0.1, treibend: 0.15, doppelschlag: 0.3, synkope: 0.3, break: 0.15 },
            synkope: { ruhig: 0.1, treibend: 0.1, doppelschlag: 0.15, synkope: 0.3, break: 0.35 },
            break: { ruhig: 0.35, treibend: 0.1, doppelschlag: 0.1, synkope: 0.15, break: 0.3 },
        },
        baseVisibility: 1,
        visibilityPerUpgrade: [],
    },
    actions: BEAT_LEDGER_ACTIONS,
    milestones: [{ threshold: 30 }, { threshold: 70 }, { threshold: 140 }],
    // Basispreise = Greed Run * 1.4. Total interleaved Kosten ~123.6 Tickets
    // bei Schwelle 140 -> 88.3%.
    depthUpgrades: buildDepthUpgrades('beat-ledger', 'Vorlauf', [3, 6, 11, 25]),
    precisionUpgrades: buildPrecisionUpgrades('beat-ledger', 'Notenschaerfe', [4, 8, 22]),
    ticketYieldFactor: ticketYieldFactorFor(1.4), // ~= 0.845
};

// ========================================================================
// "Champion's Ledger" (Automat 4) laut game-spec.md 4.5: Street-Fighter-
// Twist, letzter/komplexester Automat. Skalierungsfaktor: 180/100 = 1.8.
// Bewusst die flachste stationaere Verteilung der vier Automaten (am
// wenigsten vorhersehbares Muster, passend zu "komplexester Automat").
// ========================================================================

const CHAMPIONS_LEDGER_STATES = ['finte', 'aggressiv', 'defensiv', 'ermuedet', 'spezialmove'];

const CHAMPIONS_LEDGER_ACTIONS = buildCyclicActions(CHAMPIONS_LEDGER_STATES, [
    { id: 'angriff', payoutBig: [34, 46], payoutSimple: [10, 16], payoutLoss: [-19, -13] },
    { id: 'konter', payoutBig: [34, 46], payoutSimple: [10, 16], payoutLoss: [-19, -13] },
    { id: 'ausdauerschlag', payoutBig: [34, 46], payoutSimple: [10, 16], payoutLoss: [-19, -13] },
    { id: 'spezialkonter', payoutBig: [34, 46], payoutSimple: [10, 16], payoutLoss: [-19, -13] },
    { id: 'tempowechsel', payoutBig: [34, 46], payoutSimple: [10, 16], payoutLoss: [-19, -13] },
]);

// Blind-EV-Garantie: stationaere Verteilung fast gleichverteilt (finte
// ~19.9%, aggressiv ~20.1%, defensiv ~21.1%, ermuedet ~20.1%, spezialmove
// ~18.9%). Blind-EV zwischen ~11.98 (c4/spezialkonter) und ~12.94
// (c2/konter), Verhaeltnis ~1.08 -- am ausgeglichensten aller vier
// Automaten (passend zum letzten/komplexesten Automaten: kein Pattern-
// Ausreisser, den man blind ausnutzen koennte).
export const CHAMPIONS_LEDGER: CyclicMachineConfig = {
    kind: 'cyclic',
    id: 'champions-ledger',
    name: "Champion's Ledger",
    theme: 'street-fighter-twist',
    entryPoint: false,
    pattern: {
        states: CHAMPIONS_LEDGER_STATES,
        transitions: {
            finte: { finte: 0.25, aggressiv: 0.25, defensiv: 0.2, ermuedet: 0.15, spezialmove: 0.15 },
            aggressiv: { finte: 0.2, aggressiv: 0.25, defensiv: 0.25, ermuedet: 0.15, spezialmove: 0.15 },
            defensiv: { finte: 0.15, aggressiv: 0.2, defensiv: 0.25, ermuedet: 0.25, spezialmove: 0.15 },
            ermuedet: { finte: 0.15, aggressiv: 0.15, defensiv: 0.2, ermuedet: 0.25, spezialmove: 0.25 },
            spezialmove: { finte: 0.25, aggressiv: 0.15, defensiv: 0.15, ermuedet: 0.2, spezialmove: 0.25 },
        },
        baseVisibility: 1,
        visibilityPerUpgrade: [],
    },
    actions: CHAMPIONS_LEDGER_ACTIONS,
    milestones: [{ threshold: 40 }, { threshold: 90 }, { threshold: 180 }],
    // Basispreise = Greed Run * 1.8. Total interleaved Kosten ~159.8 Tickets
    // bei Schwelle 180 -> 88.8%.
    depthUpgrades: buildDepthUpgrades('champions-ledger', 'Kampfanalyse', [4, 7, 14, 32]),
    precisionUpgrades: buildPrecisionUpgrades('champions-ledger', 'Tell-Erkennung', [5, 11, 29]),
    ticketYieldFactor: ticketYieldFactorFor(1.8), // ~= 0.745
};

export const MACHINES: readonly MachineConfig[] = [GREED_RUN, TRAP_TUNNELS, BEAT_LEDGER, CHAMPIONS_LEDGER];

// Freischalt-Schwellen fuer Automat 2-4 (game-spec.md 3.3) leben seit
// Phase 7 als echtes Hallen-Upgrade-System in src/data/hall.config.ts
// (MACHINE_UNLOCK_UPGRADES) -- unveraendert durch Phase 7b/7c.

export function getMachineConfig(id: string): MachineConfig | undefined {
    return MACHINES.find((machine) => machine.id === id);
}

export function getEntryPointMachine(): MachineConfig {
    const entryPoint = MACHINES.find((machine) => machine.entryPoint);
    if (!entryPoint) {
        throw new Error('machines.config.ts: kein Automat mit entryPoint: true konfiguriert');
    }
    return entryPoint;
}
