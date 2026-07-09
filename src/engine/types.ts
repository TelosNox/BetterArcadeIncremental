import type Decimal from 'break_infinity.js';

// Gemeinsame Typdefinitionen fuer die Engine, unabhaengig von Phaser/React.
// Struktur laut implementation-plan.md Abschnitt 3 ("Starter-Datentypen"),
// ueberarbeitet in Phase 7c (Kernmechanik-Revision v2, siehe STATUS.md) fuer
// das neue, rein zyklische Aktionsmodell (ersetzt das "harte Konter-Aktion +
// Zwischenstufe"-Modell aus Phase 7b vollstaendig).

export const CURRENT_SAVE_VERSION = 1;

export interface MachineConfig {
    id: string;
    name: string;
    theme: string;
    entryPoint: boolean; // true nur beim Layer-0-Automaten
    pattern: PatternConfig;
    actions: MachineAction[];
    milestones: Milestone[];
    // Automaten-interne, ticket-bezahlte Zwei-Achsen-Vorschau (Phase 7c):
    // zwei UNABHAENGIGE Leitern statt einer einzelnen "visibility"-Leiter
    // aus Phase 7b (siehe MachineUpgradeDef unten).
    depthUpgrades: MachineUpgradeDef[];
    precisionUpgrades: MachineUpgradeDef[];
}

export interface PatternConfig {
    states: string[];
    transitions: Record<string, Record<string, number>>; // state -> state -> Wahrscheinlichkeit
    // baseVisibility/visibilityPerUpgrade bleiben Teil des Typs, weil
    // PatternEngine sie unveraendert validiert (CLAUDE.md-Vorgabe: die
    // Klasse selbst wird in Phase 7c NICHT angefasst) -- funktional aber
    // ungenutzt, seit die Zwei-Achsen-Vorschau (depthUpgrades/
    // precisionUpgrades oben) direkt ueber die eigenen Tickets gesteuert
    // wird statt ueber PatternEngine.getVisibility()/getVisibleDistribution().
    baseVisibility: number; // 0-1, von PatternEngine.validatePatternConfig gefordert, sonst ungenutzt
    visibilityPerUpgrade: number[]; // ungenutzt, siehe oben; bewusst leer in allen vier Configs
}

// Rein zyklisches Konter-Modell (game-spec.md 4.1b, Kernmechanik-Revision
// v2): n=5 Aktionen UND n=5 Pattern-Zustaende, beide in derselben
// zyklischen Reihenfolge positionell 1:1 zugeordnet. Jede Aktion kontert
// GENAU einen Zustand (Grosser Gewinn) und wird von GENAU einem anderen
// Zustand gekontert (Verlust, der Vorgaenger im Zyklus) -- die uebrigen drei
// Zustaende sind neutral (Einfacher Treffer). Es gibt kein Erfolg/Fehlschlag-
// Konzept mehr: jede Aktion trifft IMMER, nur die Payout-Spanne variiert
// (kann beim Verlust-Fall negativ sein). counterState/losesToState werden in
// machines.config.ts strukturell aus der Zustands-Zyklusposition abgeleitet
// (buildCyclicActions), nicht von Hand transkribiert -- das schliesst
// Uebertragungsfehler in der zyklischen Zuordnung aus.
//
// Reine Data-/Scene-Layer-Konvention -- PatternEngine kennt "counterState"/
// "losesToState" nicht, PushYourLuckEngine kennt weder sie noch
// Pattern-Zustaende ueberhaupt (Architektur-Kurzregel CLAUDE.md). Die
// Aufloesung passiert in machines.config.ts::resolveMachineAction(), die
// daraus ein ResolvedAction fuer PushYourLuckEngine.resolveAction() ableitet.
export interface CyclicActionDef {
    id: string;
    counterState: string; // Zustand, bei dem GENAU diese Aktion einen Grossen Gewinn erzielt
    losesToState: string; // Zustand, bei dem GENAU diese Aktion einen Verlust erzielt (Vorgaenger im Zyklus)
    payoutBig: [min: number, max: number]; // Grosser Gewinn (positiv)
    payoutSimple: [min: number, max: number]; // Einfacher Treffer, die uebrigen 3 Zustaende (positiv)
    payoutLoss: [min: number, max: number]; // Verlust (negativ, fester Payout-Bereich statt Prozentabzug)
}

export type MachineAction = CyclicActionDef;

// Engine-facing: das, womit PushYourLuckEngine.resolveAction() tatsaechlich
// wuerfelt. Phase 7c vereinfacht dies auf eine reine Payout-Spanne (ggf.
// negativ) -- kein failureChance mehr, weil jede Aktion garantiert trifft
// (siehe CyclicActionDef-Kommentar). Kennt weder Pattern-Zustaende noch
// Gewinn/Verlust/Treffer-Unterscheidung -- diese Aufloesung passiert VOR dem
// Aufruf (machines.config.ts::resolveMachineAction).
export interface ResolvedAction {
    id: string;
    payoutRange: [min: number, max: number]; // sichtbare Bandbreite (Baukasten 1.11), kann negativ sein
}

export interface Milestone {
    threshold: number; // benoetigte Punkte
    bankable: boolean; // an diesem Punkt sicherbar
}

export type UpgradeEffect =
    | { type: 'attendantSpeed'; value: number } // absoluter Trainings-Multiplikator ab dieser Stufe (hall.config.ts)
    | { type: 'ticketConversionRate'; value: number } // absoluter Ticket->Credits-Kurs ab dieser Stufe (hall.config.ts)
    | { type: 'unlockMachine'; machineId: string }; // schaltet einen Automaten frei (hall.config.ts)

export interface UpgradeDef {
    id: string;
    name: string;
    description: string;
    cost: number; // in Credits
    effect: UpgradeEffect;
}

// Automaten-interne Upgrades (Phase 7b, Zwei-Achsen-Vorschau neu in Phase
// 7c): bezahlt mit den EIGENEN Tickets DIESES Automaten, nicht mit
// Hallen-Credits -- bewusst ein eigener Typ statt Wiederverwendung von
// UpgradeDef (dessen cost-Feld explizit "in Credits" ist, und dessen
// effect-Varianten hallenweite Konzepte mitschleppen wuerden, die fuer eine
// automaten-interne Progression keinen Sinn ergeben).
//
// ZWEI unabhaengige Effekt-Varianten statt der bisherigen einzelnen
// "visibility" (Phase 7b) -- eine je Vorschau-Achse:
//   - previewDepth: Sichtweite d (1-5), wie viele kommende Positionen
//     ueberhaupt eine Teilinformation zeigen.
//   - previewPrecision: Praezision p (0-4), wie viele garantiert falsche
//     Kandidaten pro sichtbarer Position ausgeschlossen werden.
// `value` ist wie bei hall.config.ts ein ABSOLUTER Wert ab dieser Stufe
// (nicht additiv), siehe machines.config.ts::getPreviewDepth/getPreviewPrecision.
// `cost` ist der BASISPREIS vor dem Kreuz-Preis-Aufschlag (siehe
// machines.config.ts::getMachineUpgradeCost).
export type MachineUpgradeEffect =
    | { type: 'previewDepth'; value: number }
    | { type: 'previewPrecision'; value: number };

export interface MachineUpgradeDef {
    id: string;
    name: string;
    description: string;
    cost: number; // Basispreis in Tickets DIESES Automaten, vor Kreuz-Preis-Aufschlag
    effect: MachineUpgradeEffect;
}

export interface EngineState {
    saveVersion: number;
    credits: Decimal;
    ticketsByMachine: Record<string, Decimal>;
    unlockedMachines: string[];
    attendantKnowledge: Record<string, number>; // 0-1 pro Automat
    hallUpgrades: string[];
    completedMachines: string[]; // "durchgespielt" laut game-spec.md 4.1
    machineUpgrades: Record<string, string[]>; // pro Automat gekaufte MachineUpgradeDef-ids (Phase 7b/7c, beide Leitern gemeinsam)
}
