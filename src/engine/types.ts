import type Decimal from 'break_infinity.js';

// Gemeinsame Typdefinitionen fuer die Engine, unabhaengig von Phaser/React.
// Struktur laut implementation-plan.md Abschnitt 3 ("Starter-Datentypen"),
// ueberarbeitet in Phase 7b (Kernmechanik-Revision, siehe STATUS.md) fuer
// das neue Aktionsmodell (harte Konter-Aktionen + Zwischenstufen statt
// generischem safe/balanced/risky).

export const CURRENT_SAVE_VERSION = 1;

export interface MachineConfig {
    id: string;
    name: string;
    theme: string;
    entryPoint: boolean; // true nur beim Layer-0-Automaten
    pattern: PatternConfig;
    actions: MachineAction[];
    milestones: Milestone[];
    upgrades: MachineUpgradeDef[]; // automaten-interne, ticket-bezahlte Upgrades (Phase 7b)
}

export interface PatternConfig {
    states: string[];
    transitions: Record<string, Record<string, number>>; // state -> state -> Wahrscheinlichkeit
    baseVisibility: number; // 0-1, initial sichtbarer Anteil
    visibilityPerUpgrade: number[]; // Freischalt-Stufen je Upgrade-Level
}

// Zwei Aktions-Rollen (game-spec.md 4.1a, Kernmechanik-Revision Phase 7b):
//
// "Harte" Aktionen kontern GENAU einen designierten Pattern-Zustand -- sie
// scheitern NUR, wenn der aktuelle feste Zug exakt dieser counterState ist,
// und treffen bei JEDEM anderen Zustand (inkl. neutral UND dem Gegenstueck
// der jeweils anderen harten Aktion). Kein Zufall bei der Trefferfrage selbst
// (nur beim Payout innerhalb der Spanne) -- die "Ungewissheit" liegt darin,
// ob der Spieler den bevorstehenden Zustand bereits sehen konnte
// (Sichtbarkeits-Fenster der fest eingefrorenen Sequenz, siehe
// machines.config.ts::getVisibleMoveCount).
//
// "Zwischenstufen" sind zustandsunabhaengig: eigene feste Fangchance je
// Stufe (mehrere Abstufungen, klassisches sicher-vs-riskant ohne
// Musterbezug).
//
// Beide Rollen sind reine Data-/Scene-Layer-Konvention -- PatternEngine
// kennt "counterState" nicht, PushYourLuckEngine kennt weder "hart" noch
// "Zwischenstufe" (Architektur-Kurzregel CLAUDE.md). Die Aufloesung passiert
// in machines.config.ts::resolveMachineAction(), die daraus ein
// ResolvedAction fuer PushYourLuckEngine.resolveAction() ableitet.
export interface HardActionDef {
    kind: 'hard';
    id: string;
    payoutRange: [min: number, max: number];
    counterState: string; // Pattern-Zustand, bei dem GENAU diese Aktion scheitert
}

export interface IntermediateActionDef {
    kind: 'intermediate';
    id: string;
    payoutRange: [min: number, max: number];
    failureChance: number; // fest, unabhaengig vom Musterzustand
}

export type MachineAction = HardActionDef | IntermediateActionDef;

// Engine-facing: das, womit PushYourLuckEngine.resolveAction() tatsaechlich
// wuerfelt. Kennt weder "hart"/"Zwischenstufe" noch Pattern-Zustaende --
// diese Aufloesung passiert VOR dem Aufruf (machines.config.ts, analog zum
// bisherigen getEffectiveFailureChance-Muster aus Phase 3).
export interface ResolvedAction {
    id: string;
    payoutRange: [min: number, max: number]; // sichtbare Bandbreite (Baukasten 1.11)
    failureChance: number; // 0 = garantiert sicher, 1 = garantiert Fehlschlag
}

export interface Milestone {
    threshold: number; // benoetigte Punkte
    bankable: boolean; // an diesem Punkt sicherbar
}

export type UpgradeEffect =
    | { type: 'visibility'; value: number }
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

// Automaten-interne Upgrades (neu, Phase 7b): bezahlt mit den EIGENEN
// Tickets DIESES Automaten, nicht mit Hallen-Credits -- bewusst ein eigener
// Typ statt Wiederverwendung von UpgradeDef (dessen cost-Feld laut Kommentar
// oben explizit "in Credits" ist, und dessen effect-Varianten hallenweite
// Konzepte wie unlockMachine/ticketConversionRate mitschleppen wuerden, die
// fuer eine automaten-interne Progression keinen Sinn ergeben). Aktuell
// einzige Wirkung: mehr Vorschau auf die feste Zug-Sequenz (siehe
// machines.config.ts::getVisibleMoveCount) -- die frueher immer leeren
// MachineConfig.upgrades-Arrays (Phase 3-7, nie befuellt) werden hiermit
// erstmals genutzt.
export interface MachineUpgradeDef {
    id: string;
    name: string;
    description: string;
    cost: number; // in Tickets DIESES Automaten
    effect: { type: 'visibility'; value: number };
}

export interface EngineState {
    saveVersion: number;
    credits: Decimal;
    ticketsByMachine: Record<string, Decimal>;
    unlockedMachines: string[];
    attendantKnowledge: Record<string, number>; // 0-1 pro Automat
    hallUpgrades: string[];
    completedMachines: string[]; // "durchgespielt" laut game-spec.md 4.1
    machineUpgrades: Record<string, string[]>; // pro Automat gekaufte MachineUpgradeDef-ids (Phase 7b)
}
