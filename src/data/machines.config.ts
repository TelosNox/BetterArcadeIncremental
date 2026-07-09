import type { HardActionDef, IntermediateActionDef, MachineAction, MachineConfig, MachineUpgradeDef, ResolvedAction } from '../engine/types';

// Automaten-Konfigurationen. Alle spielspezifischen Zahlen/Parameter leben
// hier (Architektur-Kurzregel in CLAUDE.md), MachineScene.ts liest nur.
//
// Phase 7b (Kernmechanik-Revision, siehe STATUS.md): ersetzt das bisherige
// generische safe/balanced/risky-Dreiklang durch zwei Aktions-Rollen pro
// Automat:
//   - GENAU ZWEI "harte" Aktionen, thematisch benannt, je an einen
//     designierten Pattern-Zustand gekoppelt ("Gegenstueck") -- scheitern
//     NUR dort, treffen bei jedem anderen Zustand (inkl. neutral UND dem
//     Gegenstueck der jeweils anderen harten Aktion).
//   - DREI zustandsunabhaengige "Zwischenstufen" mit gestaffeltem
//     Risiko/Ertrag (die alten safe/balanced/risky-Basiswerte, jetzt OHNE
//     Musterzustand-Modulation -- die gab es nur, weil es noch keine harten
//     Aktionen gab, siehe unten).
//
// pattern.states ist weiterhin wie in Phase 3 definiert (Danger-Achse von
// sicher nach gefaehrlich fuer die Doku/Lesbarkeit), aber diese Reihenfolge
// hat fuer die Aufloesung selbst keine Bedeutung mehr -- resolveMachineAction()
// vergleicht nur noch auf exakte Gleichheit mit dem designierten
// counterState, keine Distanz-/Sensitivity-Rechnung mehr (das war
// PATTERN_RISK_SENSITIVITY/getEffectiveFailureChance aus Phase 3, komplett
// ersetzt).

// Wie viele Zuege der FESTEN, vorab generierten Sequenz maximal sichtbar
// sein koennen (bei voller Sichtbarkeit, PatternEngine.getVisibility === 1).
// PatternEngine selbst bleibt unveraendert (liefert weiterhin einen Anteil
// 0-1, geklemmt auf hoechstens 1) -- NUR die Interpretation dieses Anteils
// aendert sich hier: er wird mit MAX_PREVIEW_MOVES multipliziert und auf
// eine Zug-ANZAHL gerundet, statt (wie bisher) den Anteil der Verteilung zu
// bestimmen, der aufgedeckt wird (STATUS.md Phase 7b, Punkt 3). Alle vier
// Automaten haben 3 Pattern-Zustaende, daher 3 als sinnvolle Obergrenze
// (volle Sichtbarkeit = so viele Zuege im Voraus wie es Zustaende gibt).
export const MAX_PREVIEW_MOVES = 3;

export function getVisibleMoveCount(visibility: number): number {
    return Math.max(1, Math.round(visibility * MAX_PREVIEW_MOVES));
}

// Wandelt eine konfigurierte MachineAction (Config-Zeit, zwei Rollen) in
// eine ResolvedAction (Engine-Zeit, das was PushYourLuckEngine.resolveAction
// tatsaechlich konsumiert) um -- ersetzt getEffectiveFailureChance aus
// Phase 3. Reine Funktion, aufgerufen aus MachineScene kurz vor
// resolveAction(), genau wie zuvor: PatternEngine/PushYourLuckEngine bleiben
// unveraendert und kennen sich weiterhin nicht gegenseitig
// (Architektur-Kurzregel CLAUDE.md).
//
// "Harte" Aktionen: deterministisch pro Zustand (failureChance wird zu 0
// oder 1, kein Zufall bei der Trefferfrage selbst) -- scheitern NUR beim
// exakten counterState, treffen garantiert bei jedem anderen Zustand.
// "Zwischenstufen": unveraendert durchgereicht, da bereits zustandsunabhaengig.
export function resolveMachineAction(action: MachineAction, currentState: string): ResolvedAction {
    if (action.kind === 'intermediate') {
        return { id: action.id, payoutRange: action.payoutRange, failureChance: action.failureChance };
    }
    const failed = currentState === action.counterState;
    return { id: action.id, payoutRange: action.payoutRange, failureChance: failed ? 1 : 0 };
}

// "Greed Run" (Automat 1, Layer-0-Einstieg) laut game-spec.md 4.2/4.1a:
// Pac-Man-Twist, Patrouillenrouten teilweise sichtbar (jetzt: eine feste,
// vorab generierte Sequenz statt live gewuerfelter Zustaende).
//
// Harte Aktionen -- Rollenzuweisung (design-toolbox.md Punkt 5, Trade-off-
// Check mit konkreten Zahlen unten): "Blitzlauf" (schneller, riskanter
// Grabversuch) scheitert NUR bei "alarm" (Patrouille bereits alarmiert);
// "Schleichgang" (vorsichtiges Vorruecken) scheitert NUR bei "nah"
// (Patrouille zu nah, wird beim Schleichen entdeckt). "fern" ist fuer BEIDE
// neutral (treffen garantiert).
const GREED_RUN_HARD: HardActionDef[] = [
    { kind: 'hard', id: 'blitzlauf', payoutRange: [12, 19], counterState: 'alarm' },
    { kind: 'hard', id: 'schleichgang', payoutRange: [15, 23], counterState: 'nah' },
];
// Zwischenstufen -- unveraendert gegenueber den alten safe/balanced/risky-
// Basiswerten aus Phase 3, jetzt aber wirklich musterunabhaengig (keine
// getEffectiveFailureChance-Modulation mehr, siehe Dateikommentar oben).
const GREED_RUN_INTERMEDIATE: IntermediateActionDef[] = [
    { kind: 'intermediate', id: 'vorsichtig', payoutRange: [3, 3], failureChance: 0 },
    { kind: 'intermediate', id: 'zuegig', payoutRange: [6, 10], failureChance: 0.15 },
    { kind: 'intermediate', id: 'waghalsig', payoutRange: [14, 22], failureChance: 0.35 },
];

// Trade-off-Check (design-toolbox.md Punkt 5), konkrete Zahlen:
// Stationaere Verteilung des Musters (Markov-Kette, sim. per Power-Iteration
// in machines.config.test.ts verifiziert): fern ~24.1%, nah ~44.4%,
// alarm ~31.5%. Das ist die durchschnittliche Fangchance einer harten
// Aktion, wenn BLIND (ohne Sichtbarkeit der Sequenz) gespielt wird:
//   Aktion        | Gegenstueck | Blind-Fangchance | Blind-EV | Perfekt-EV (100% Erfolg)
//   --------------|-------------|-------------------|----------|---------------------------
//   Blitzlauf     | alarm       | ~31.5%            | 10.62    | 15.5
//   Schleichgang  | nah         | ~44.4%            | 10.56    | 19.0
//   Zwischenstufe (EV bei jeweiliger fester failureChance, unmoduliert):
//   vorsichtig (0%)    -> EV 3.0
//   zuegig (15%)       -> EV 6.8
//   waghalsig (35%)    -> EV 11.7
// Blind-EV beider harten Aktionen liegt UNTER dem EV der besten
// Zwischenstufe ("waghalsig", 11.7) -- blindes Spammen einer harten Aktion
// dominiert die Zwischenstufen NICHT. Perfekt-EV (nur bei sichtbar
// sicherem Zustand gespielt) liegt dagegen klar DARUEBER -- genau darin
// liegt der strategische Wert der Vorschau (Baukasten 1.10): Lesen zahlt
// sich messbar aus, Raten nicht.
export const GREED_RUN: MachineConfig = {
    id: 'greed-run',
    name: 'Greed Run',
    theme: 'pacman-twist',
    entryPoint: true,
    pattern: {
        states: ['fern', 'nah', 'alarm'],
        transitions: {
            fern: { fern: 0.5, nah: 0.4, alarm: 0.1 },
            nah: { fern: 0.2, nah: 0.5, alarm: 0.3 },
            alarm: { fern: 0.1, nah: 0.4, alarm: 0.5 },
        },
        baseVisibility: 0.34,
        visibilityPerUpgrade: [0.33, 0.33],
    },
    actions: [...GREED_RUN_HARD, ...GREED_RUN_INTERMEDIATE],
    milestones: [
        { threshold: 20, bankable: true },
        { threshold: 50, bankable: true },
        { threshold: 100, bankable: true },
    ],
    upgrades: [
        {
            id: 'greed-run-vision-1',
            name: 'Streckenkenntnis I',
            description: 'Zeigt einen weiteren Zug der festen Patrouillen-Sequenz im Voraus.',
            cost: 15,
            effect: { type: 'visibility', value: 1 },
        },
        {
            id: 'greed-run-vision-2',
            name: 'Streckenkenntnis II',
            description: 'Zeigt die volle Sequenz bis zum naechsten Meilenstein im Voraus.',
            cost: 40,
            effect: { type: 'visibility', value: 1 },
        },
    ],
};

// "Trap Tunnels" (Automat 2) laut game-spec.md 4.3: Dig-Dug/Q*bert-Twist.
// "Sprengladung" (grosse, riskante Sprengung) scheitert NUR bei "einsturz"
// (der Tunnel ist bereits am Einsturz -- die Ladung reisst einen mit);
// "Stuetzpfeiler" (Tunnel abstuetzen) scheitert NUR bei "wackelig" (der
// Pfeiler bricht genau dann, wenn der Tunnel schon wackelt). "stabil" ist
// fuer beide neutral.
const TRAP_TUNNELS_HARD: HardActionDef[] = [
    { kind: 'hard', id: 'sprengladung', payoutRange: [18, 27], counterState: 'einsturz' },
    { kind: 'hard', id: 'stuetzpfeiler', payoutRange: [12, 20], counterState: 'wackelig' },
];
const TRAP_TUNNELS_INTERMEDIATE: IntermediateActionDef[] = [
    { kind: 'intermediate', id: 'fruehzuender', payoutRange: [4, 4], failureChance: 0 },
    { kind: 'intermediate', id: 'zeitzuender', payoutRange: [8, 13], failureChance: 0.18 },
    { kind: 'intermediate', id: 'kettenreaktion', payoutRange: [20, 30], failureChance: 0.4 },
];

// Trade-off-Check: stationaere Verteilung stabil ~45.2%, wackelig ~12.9%,
// einsturz ~41.9%.
//   Aktion         | Gegenstueck | Blind-Fangchance | Blind-EV | Perfekt-EV
//   ---------------|-------------|-------------------|----------|------------
//   Sprengladung   | einsturz    | ~41.9%            | 13.06    | 22.5
//   Stuetzpfeiler  | wackelig    | ~12.9%            | 13.94    | 16.0
//   Zwischenstufen: fruehzuender (0%) EV 4.0, zeitzuender (18%) EV 8.61,
//   kettenreaktion (40%) EV 15.0.
// Beide Blind-EVs < 15.0 (beste Zwischenstufe) -> keine Dominanz beim
// blinden Spielen. Beide Perfekt-EVs > 15.0 -> Vorschau lohnt sich
// (Stuetzpfeiler mit nur +1.0 knapper Vorsprung, da "wackelig" ohnehin
// selten ist und die Aktion daher auch blind schon fast immer trifft --
// bewusst so belassen: das ist thematisch stimmig, ein Stuetzpfeiler soll
// selten versagen).
export const TRAP_TUNNELS: MachineConfig = {
    id: 'trap-tunnels',
    name: 'Trap Tunnels',
    theme: 'digdug-twist',
    entryPoint: false,
    pattern: {
        states: ['stabil', 'wackelig', 'einsturz'],
        transitions: {
            stabil: { stabil: 0.85, wackelig: 0.15, einsturz: 0 },
            wackelig: { stabil: 0.2, wackelig: 0.15, einsturz: 0.65 },
            einsturz: { stabil: 0.1, wackelig: 0.1, einsturz: 0.8 },
        },
        baseVisibility: 0.8,
        visibilityPerUpgrade: [0.2],
    },
    actions: [...TRAP_TUNNELS_HARD, ...TRAP_TUNNELS_INTERMEDIATE],
    milestones: [
        { threshold: 25, bankable: true },
        { threshold: 60, bankable: true },
        { threshold: 120, bankable: true },
    ],
    upgrades: [
        {
            id: 'trap-tunnels-vision-1',
            name: 'Tunnelkarte',
            description: 'Zeigt die volle feste Tunnel-Sequenz im Voraus (passend zu "am wenigsten Zufall").',
            cost: 20,
            effect: { type: 'visibility', value: 1 },
        },
    ],
};

// "Beat Ledger" (Automat 3) laut game-spec.md 4.4: DDR/Whac-a-Mole-Twist,
// Rhythmus von Anfang an voll sichtbar (baseVisibility 1, kein internes
// Upgrade noetig -- "wie Noten", siehe machines.config.ts Kommentar Phase 3).
// "Powermove" (grosser, flaechiger Treffer) scheitert NUR bei
// "doppelschlag" (die Doppelschlag-Passage ist zu komplex fuer den grossen
// Move); "Punktlandung" (praezise) scheitert NUR bei "treibend" (der Antrieb
// wirft die Praezision aus dem Takt). "ruhig" ist fuer beide neutral.
const BEAT_LEDGER_HARD: HardActionDef[] = [
    { kind: 'hard', id: 'powermove', payoutRange: [22, 32], counterState: 'doppelschlag' },
    { kind: 'hard', id: 'punktlandung', payoutRange: [19, 29], counterState: 'treibend' },
];
const BEAT_LEDGER_INTERMEDIATE: IntermediateActionDef[] = [
    { kind: 'intermediate', id: 'grundschlag', payoutRange: [5, 5], failureChance: 0 },
    { kind: 'intermediate', id: 'kombo', payoutRange: [10, 16], failureChance: 0.2 },
    { kind: 'intermediate', id: 'doppelkombo', payoutRange: [24, 36], failureChance: 0.42 },
];

// Trade-off-Check: stationaere Verteilung ruhig ~19.7%, treibend ~37.7%,
// doppelschlag ~42.6%.
//   Aktion        | Gegenstueck  | Blind-Fangchance | Blind-EV | Perfekt-EV
//   --------------|--------------|-------------------|----------|------------
//   Powermove     | doppelschlag | ~42.6%            | 15.49    | 27.0
//   Punktlandung  | treibend     | ~37.7%            | 14.95    | 24.0
//   Zwischenstufen: grundschlag (0%) EV 5.0, kombo (20%) EV 10.4,
//   doppelkombo (42%) EV 17.4.
// Beide Blind-EVs < 17.4, beide Perfekt-EVs > 17.4.
export const BEAT_LEDGER: MachineConfig = {
    id: 'beat-ledger',
    name: 'Beat Ledger',
    theme: 'ddr-twist',
    entryPoint: false,
    pattern: {
        states: ['ruhig', 'treibend', 'doppelschlag'],
        transitions: {
            ruhig: { ruhig: 0.4, treibend: 0.5, doppelschlag: 0.1 },
            treibend: { ruhig: 0.2, treibend: 0.4, doppelschlag: 0.4 },
            doppelschlag: { ruhig: 0.1, treibend: 0.3, doppelschlag: 0.6 },
        },
        baseVisibility: 1,
        visibilityPerUpgrade: [],
    },
    actions: [...BEAT_LEDGER_HARD, ...BEAT_LEDGER_INTERMEDIATE],
    milestones: [
        { threshold: 30, bankable: true },
        { threshold: 70, bankable: true },
        { threshold: 140, bankable: true },
    ],
    upgrades: [],
};

// "Champion's Ledger" (Automat 4) laut game-spec.md 4.5: Street-Fighter-
// Twist, letzter und komplexester Automat. "Angriff" scheitert NUR bei
// "defensiv" (blockiert); "Konter" scheitert NUR bei "aggressiv" (der
// Konter wird ueberrannt, bevor er greift). "finte" (Oeffnung) ist fuer
// beide neutral -- thematisch passend, eine Finte laesst beide Aktionen
// treffen.
const CHAMPIONS_LEDGER_HARD: HardActionDef[] = [
    { kind: 'hard', id: 'angriff', payoutRange: [22, 32], counterState: 'defensiv' },
    { kind: 'hard', id: 'konter', payoutRange: [26, 38], counterState: 'aggressiv' },
];
const CHAMPIONS_LEDGER_INTERMEDIATE: IntermediateActionDef[] = [
    { kind: 'intermediate', id: 'deckung', payoutRange: [6, 6], failureChance: 0 },
    { kind: 'intermediate', id: 'kombo-schlag', payoutRange: [12, 20], failureChance: 0.2 },
    { kind: 'intermediate', id: 'risikoschlag', payoutRange: [30, 45], failureChance: 0.45 },
];

// Trade-off-Check: stationaere Verteilung finte ~28.8%, aggressiv ~44.1%,
// defensiv ~27.1%.
//   Aktion   | Gegenstueck | Blind-Fangchance | Blind-EV | Perfekt-EV
//   ---------|-------------|-------------------|----------|------------
//   Angriff  | defensiv    | ~27.1%            | 19.68    | 27.0
//   Konter   | aggressiv   | ~44.1%            | 17.90    | 32.0
//   Zwischenstufen: deckung (0%) EV 6.0, kombo-schlag (20%) EV 12.8,
//   risikoschlag (45%) EV 20.625.
// Beide Blind-EVs < 20.625 (Angriff mit nur ~0.9 knapper Marge, da
// "defensiv" seltener ist als die anderen beiden Zustaende -- bewusst so
// belassen, siehe Trap Tunnels fuer dieselbe Argumentation). Beide
// Perfekt-EVs > 20.625.
export const CHAMPIONS_LEDGER: MachineConfig = {
    id: 'champions-ledger',
    name: "Champion's Ledger",
    theme: 'street-fighter-twist',
    entryPoint: false,
    pattern: {
        states: ['finte', 'aggressiv', 'defensiv'],
        transitions: {
            finte: { finte: 0.2, aggressiv: 0.6, defensiv: 0.2 },
            aggressiv: { finte: 0.4, aggressiv: 0.3, defensiv: 0.3 },
            defensiv: { finte: 0.2, aggressiv: 0.5, defensiv: 0.3 },
        },
        baseVisibility: 0.3,
        visibilityPerUpgrade: [0.35, 0.35],
    },
    actions: [...CHAMPIONS_LEDGER_HARD, ...CHAMPIONS_LEDGER_INTERMEDIATE],
    milestones: [
        { threshold: 40, bankable: true },
        { threshold: 90, bankable: true },
        { threshold: 180, bankable: true },
    ],
    upgrades: [
        {
            id: 'champions-ledger-vision-1',
            name: 'Kampfanalyse I',
            description: 'Zeigt einen weiteren Zug der festen Stance-Sequenz im Voraus.',
            cost: 25,
            effect: { type: 'visibility', value: 1 },
        },
        {
            id: 'champions-ledger-vision-2',
            name: 'Kampfanalyse II',
            description: 'Zeigt die volle Sequenz bis zum naechsten Meilenstein im Voraus.',
            cost: 60,
            effect: { type: 'visibility', value: 1 },
        },
    ],
};

export const MACHINES: readonly MachineConfig[] = [GREED_RUN, TRAP_TUNNELS, BEAT_LEDGER, CHAMPIONS_LEDGER];

// Freischalt-Schwellen fuer Automat 2-4 (game-spec.md 3.3) leben seit
// Phase 7 als echtes Hallen-Upgrade-System in src/data/hall.config.ts
// (MACHINE_UNLOCK_UPGRADES) -- unveraendert durch Phase 7b.

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

export function getHardActions(machine: MachineConfig): HardActionDef[] {
    return machine.actions.filter((action): action is HardActionDef => action.kind === 'hard');
}

export function getIntermediateActions(machine: MachineConfig): IntermediateActionDef[] {
    return machine.actions.filter((action): action is IntermediateActionDef => action.kind === 'intermediate');
}

export function getMachineUpgrade(machine: MachineConfig, upgradeId: string): MachineUpgradeDef | undefined {
    return machine.upgrades.find((upgrade) => upgrade.id === upgradeId);
}
