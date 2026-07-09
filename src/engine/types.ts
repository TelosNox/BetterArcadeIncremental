import type Decimal from 'break_infinity.js';

// Gemeinsame Typdefinitionen fuer die Engine, unabhaengig von Phaser/React.
// Struktur laut implementation-plan.md Abschnitt 3 ("Starter-Datentypen").

export const CURRENT_SAVE_VERSION = 1;

export interface MachineConfig {
    id: string;
    name: string;
    theme: string;
    entryPoint: boolean; // true nur beim Layer-0-Automaten
    pattern: PatternConfig;
    riskTiers: RiskTier[];
    milestones: Milestone[];
    upgrades: UpgradeDef[];
}

export interface PatternConfig {
    states: string[];
    transitions: Record<string, Record<string, number>>; // state -> state -> Wahrscheinlichkeit
    baseVisibility: number; // 0-1, initial sichtbarer Anteil
    visibilityPerUpgrade: number[]; // Freischalt-Stufen je Upgrade-Level
}

export interface RiskTier {
    id: 'safe' | 'balanced' | 'risky';
    payoutRange: [min: number, max: number]; // sichtbare Bandbreite (Baukasten 1.11)
    failureChance: number; // 0 bei "safe"
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

export interface EngineState {
    saveVersion: number;
    credits: Decimal;
    ticketsByMachine: Record<string, Decimal>;
    unlockedMachines: string[];
    attendantKnowledge: Record<string, number>; // 0-1 pro Automat
    hallUpgrades: string[];
    completedMachines: string[]; // "durchgespielt" laut game-spec.md 4.1
}
