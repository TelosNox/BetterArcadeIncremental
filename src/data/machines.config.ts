import type { CyclicActionDef, MachineConfig, MachineUpgradeDef, ResolvedAction } from '../engine/types';

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
// ResolvedAction (Engine-Zeit, das was PushYourLuckEngine.resolveAction
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

export function getPreviewDepth(machine: MachineConfig, ownedUpgradeIds: readonly string[]): number {
    return machine.depthUpgrades.reduce((max, u) => {
        if (u.effect.type === 'previewDepth' && ownedUpgradeIds.includes(u.id)) {
            return Math.max(max, u.effect.value);
        }
        return max;
    }, START_DEPTH);
}

export function getPreviewPrecision(machine: MachineConfig, ownedUpgradeIds: readonly string[]): number {
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
    machine: MachineConfig,
    upgrade: MachineUpgradeDef,
    ownedUpgradeIds: readonly string[],
): number {
    const isDepth = upgrade.effect.type === 'previewDepth';
    const otherLadder = isDepth ? machine.precisionUpgrades : machine.depthUpgrades;
    const otherBoughtBeyondStart = countOwnedIn(otherLadder, ownedUpgradeIds);
    return upgrade.cost * Math.pow(1 + CROSS_PRICE_SURCHARGE_K, otherBoughtBeyondStart);
}

export function getMachineUpgrade(machine: MachineConfig, upgradeId: string): MachineUpgradeDef | undefined {
    return [...machine.depthUpgrades, ...machine.precisionUpgrades].find((upgrade) => upgrade.id === upgradeId);
}

// --- Zielwert-Check (STATUS.md Punkt 7, PFLICHT) -----------------------

// Gesamtkosten beider Leitern bei AUSGEWOGENEM (interleaved) Einkauf:
// D1, P1, D2, P2, D3, P3, D4 (Tiefe hat eine Stufe mehr als Praezision,
// daher am Ende ohne Partner). Reine, testbare Funktion -- reproduziert
// exakt die Kreuz-Preis-Formel oben, nur als Summe ueber eine konkrete
// Kaufreihenfolge statt inkrementell zur Laufzeit.
export function computeInterleavedUpgradeCost(machine: MachineConfig): number {
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
// erwarteten Ticket-Ertrag bis zum ERSTEN Erreichen des letzten
// Meilensteins. 1 Punkt Score = 1 Ticket (Banking sichert den Punktestand
// direkt als Tickets, siehe MachineScene.ts::finishExecution/bankRun) --
// der erwartete Ticket-Ertrag eines abgeschlossenen Laufs ist daher
// naeherungsweise der letzte Meilenstein-Schwellenwert selbst (ein Spieler
// bankt kurz NACH Erreichen der Schwelle, der Ueberschuss pro Schritt ist
// klein relativ zur Schwelle, siehe Blind-EV-Werte im Test). Zielkorridor
// 85-95%, per Test verifiziert (machines.config.test.ts).
export function getUpgradeCostToMilestoneRatio(machine: MachineConfig): number {
    return computeInterleavedUpgradeCost(machine) / getFinalMilestoneThreshold(machine);
}

// ========================================================================
// "Greed Run" (Automat 1, Layer-0-Einstieg) laut game-spec.md 4.2/4.1b:
// Pac-Man-Twist, Patrouillen-Bedrohungslevel als 5-Zustands-Zyklus.
// ========================================================================

const GREED_RUN_STATES = ['fern', 'nah', 'alarm', 'sichtkontakt', 'rueckzug'];

const GREED_RUN_ACTIONS = buildCyclicActions(GREED_RUN_STATES, [
    { id: 'sprint', payoutBig: [16, 22], payoutSimple: [5, 8], payoutLoss: [-10, -7] },
    { id: 'schleicher', payoutBig: [16, 22], payoutSimple: [5, 8], payoutLoss: [-10, -7] },
    { id: 'ablenker', payoutBig: [16, 22], payoutSimple: [5, 8], payoutLoss: [-10, -7] },
    { id: 'versteck', payoutBig: [16, 22], payoutSimple: [5, 8], payoutLoss: [-10, -7] },
    { id: 'vorstoss', payoutBig: [16, 22], payoutSimple: [5, 8], payoutLoss: [-10, -7] },
]);

// Blind-EV-Garantie (STATUS.md Punkt 4, per it.each-Test in
// machines.config.test.ts verifiziert): stationaere Verteilung per
// Power-Iteration (Testwerkzeug) -- fern ~18.7%, nah ~21.7%, alarm ~21.8%,
// sichtkontakt ~20.7%, rueckzug ~17.2%. Blind-EV je Aktion (P(Gewinn)*19 +
// P(Verlust)*(-8.5) + P(Rest)*6.5): sprint ~6.64, schleicher ~6.41,
// ablenker ~5.82, versteck ~5.38, vorstoss ~5.74 -- alle > 0, groesste/
// kleinste im Verhaeltnis ~1.23 (keine Dominanz, Schwelle 1.25 siehe Test).
export const GREED_RUN: MachineConfig = {
    id: 'greed-run',
    name: 'Greed Run',
    theme: 'pacman-twist',
    entryPoint: true,
    pattern: {
        states: GREED_RUN_STATES,
        transitions: {
            fern: { fern: 0.3, nah: 0.4, alarm: 0.15, sichtkontakt: 0.1, rueckzug: 0.05 },
            nah: { fern: 0.15, nah: 0.3, alarm: 0.35, sichtkontakt: 0.15, rueckzug: 0.05 },
            alarm: { fern: 0.05, nah: 0.15, alarm: 0.3, sichtkontakt: 0.35, rueckzug: 0.15 },
            sichtkontakt: { fern: 0.05, nah: 0.05, alarm: 0.15, sichtkontakt: 0.3, rueckzug: 0.45 },
            rueckzug: { fern: 0.45, nah: 0.2, alarm: 0.1, sichtkontakt: 0.1, rueckzug: 0.15 },
        },
        baseVisibility: 1,
        visibilityPerUpgrade: [],
    },
    actions: GREED_RUN_ACTIONS,
    milestones: [
        { threshold: 20, bankable: true },
        { threshold: 50, bankable: true },
        { threshold: 100, bankable: true },
    ],
    // Basispreise (STATUS.md Punkt 7, Ausgangsbasis fuer die Skalierung der
    // anderen drei Automaten): total interleaved Kosten ~89.3 Tickets bei
    // Schwelle 100 -> 89.3% (Zielkorridor 85-95%, per Test verifiziert).
    depthUpgrades: buildDepthUpgrades('greed-run', 'Streckenkenntnis', [2, 4, 8, 18]),
    precisionUpgrades: buildPrecisionUpgrades('greed-run', 'Scharfblick', [3, 6, 16]),
};

// ========================================================================
// "Trap Tunnels" (Automat 2) laut game-spec.md 4.3: Dig-Dug/Q*bert-Twist.
// Skalierungsfaktor gegenueber Greed Run: 120/100 = 1.2 (Meilenstein-Verhaeltnis).
// ========================================================================

const TRAP_TUNNELS_STATES = ['stabil', 'wackelig', 'einsturz', 'verschuettet', 'freigelegt'];

const TRAP_TUNNELS_ACTIONS = buildCyclicActions(TRAP_TUNNELS_STATES, [
    { id: 'sprengladung', payoutBig: [22, 30], payoutSimple: [7, 11], payoutLoss: [-13, -9] },
    { id: 'stuetzpfeiler', payoutBig: [22, 30], payoutSimple: [7, 11], payoutLoss: [-13, -9] },
    { id: 'schaufelzug', payoutBig: [22, 30], payoutSimple: [7, 11], payoutLoss: [-13, -9] },
    { id: 'tunnelblick', payoutBig: [22, 30], payoutSimple: [7, 11], payoutLoss: [-13, -9] },
    { id: 'notausstieg', payoutBig: [22, 30], payoutSimple: [7, 11], payoutLoss: [-13, -9] },
]);

// Blind-EV-Garantie: stationaere Verteilung stabil ~22.7%, wackelig ~20.5%,
// einsturz ~18.9%, verschuettet ~19.5%, freigelegt ~18.4%. Blind-EV je
// Aktion zwischen ~7.68 (a2/stuetzpfeiler) und ~8.96 (a5/notausstieg),
// Verhaeltnis ~1.17 -- alle > 0, keine Dominanz.
export const TRAP_TUNNELS: MachineConfig = {
    id: 'trap-tunnels',
    name: 'Trap Tunnels',
    theme: 'digdug-twist',
    entryPoint: false,
    pattern: {
        states: TRAP_TUNNELS_STATES,
        transitions: {
            stabil: { stabil: 0.5, wackelig: 0.3, einsturz: 0.1, verschuettet: 0.05, freigelegt: 0.05 },
            wackelig: { stabil: 0.1, wackelig: 0.35, einsturz: 0.35, verschuettet: 0.15, freigelegt: 0.05 },
            einsturz: { stabil: 0.05, wackelig: 0.1, einsturz: 0.3, verschuettet: 0.4, freigelegt: 0.15 },
            verschuettet: { stabil: 0.05, wackelig: 0.05, einsturz: 0.1, verschuettet: 0.3, freigelegt: 0.5 },
            freigelegt: { stabil: 0.4, wackelig: 0.2, einsturz: 0.1, verschuettet: 0.1, freigelegt: 0.2 },
        },
        baseVisibility: 1,
        visibilityPerUpgrade: [],
    },
    actions: TRAP_TUNNELS_ACTIONS,
    milestones: [
        { threshold: 25, bankable: true },
        { threshold: 60, bankable: true },
        { threshold: 120, bankable: true },
    ],
    // Basispreise = Greed Run * 1.2 (Skalierungsfaktor), gerundet. Total
    // interleaved Kosten ~108.1 Tickets bei Schwelle 120 -> 90.1%.
    depthUpgrades: buildDepthUpgrades('trap-tunnels', 'Tunnelkarte', [2, 5, 10, 22]),
    precisionUpgrades: buildPrecisionUpgrades('trap-tunnels', 'Erdlesung', [4, 7, 19]),
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
export const BEAT_LEDGER: MachineConfig = {
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
    milestones: [
        { threshold: 30, bankable: true },
        { threshold: 70, bankable: true },
        { threshold: 140, bankable: true },
    ],
    // Basispreise = Greed Run * 1.4. Total interleaved Kosten ~123.6 Tickets
    // bei Schwelle 140 -> 88.3%.
    depthUpgrades: buildDepthUpgrades('beat-ledger', 'Vorlauf', [3, 6, 11, 25]),
    precisionUpgrades: buildPrecisionUpgrades('beat-ledger', 'Notenschaerfe', [4, 8, 22]),
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
export const CHAMPIONS_LEDGER: MachineConfig = {
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
    milestones: [
        { threshold: 40, bankable: true },
        { threshold: 90, bankable: true },
        { threshold: 180, bankable: true },
    ],
    // Basispreise = Greed Run * 1.8. Total interleaved Kosten ~159.8 Tickets
    // bei Schwelle 180 -> 88.8%.
    depthUpgrades: buildDepthUpgrades('champions-ledger', 'Kampfanalyse', [4, 7, 14, 32]),
    precisionUpgrades: buildPrecisionUpgrades('champions-ledger', 'Tell-Erkennung', [5, 11, 29]),
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
