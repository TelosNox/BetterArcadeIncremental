import type { MachineConfig } from '../engine/types';

// Automaten-Konfigurationen. Alle spielspezifischen Zahlen/Parameter leben
// hier (Architektur-Kurzregel in CLAUDE.md), MachineScene.ts liest nur.
//
// "Greed Run" (Automat 1, Layer-0-Einstieg) laut game-spec.md 4.2:
// Pac-Man-Twist, Patrouillenrouten teilweise sichtbar, Risiko-Achse = wie
// weit der Spieler plant, bevor er sichert/umkehrt.
//
// Trade-off-Check (design-toolbox.md Abschnitt 4, Punkt 5) fuer die
// RiskTiers unten, mit konkreten Beispielzahlen (siehe auch STATUS.md):
//   safe:     failureChance 0    * payout 3         -> EV 3.0,  Varianz 0
//   balanced: failureChance 0.15 * payout U[6,10]    -> EV 6.8,  Varianz mittel
//   risky:    failureChance 0.35 * payout U[14,22]   -> EV 11.7, Varianz hoch
// EV und Risiko (failureChance) steigen gemeinsam an -> kein Tier ist bei
// gleichem oder geringerem Risiko strikt besser als ein anderes. Da ein
// Fehlschlag den GESAMTEN Punktestand des laufenden Runs auf 0 zurücksetzt
// (PushYourLuckEngine), wird "safe" mit wachsendem, noch nicht gebanktem
// Punktestand zunehmend attraktiver -- der eigentliche Sicher-vs-Riskant-
// Strategiewechsel entsteht aus der Situation (Baukasten 1.12), nicht aus
// gescripteten Zahlen.
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
    riskTiers: [
        { id: 'safe', payoutRange: [3, 3], failureChance: 0 },
        { id: 'balanced', payoutRange: [6, 10], failureChance: 0.15 },
        { id: 'risky', payoutRange: [14, 22], failureChance: 0.35 },
    ],
    milestones: [
        { threshold: 20, bankable: true },
        { threshold: 50, bankable: true },
        { threshold: 100, bankable: true },
    ],
    upgrades: [],
};

export const MACHINES: readonly MachineConfig[] = [GREED_RUN];

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
