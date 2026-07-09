import type { MachineConfig, RiskTier } from '../engine/types';

// Automaten-Konfigurationen. Alle spielspezifischen Zahlen/Parameter leben
// hier (Architektur-Kurzregel in CLAUDE.md), MachineScene.ts liest nur.
//
// "Greed Run" (Automat 1, Layer-0-Einstieg) laut game-spec.md 4.2:
// Pac-Man-Twist, Patrouillenrouten teilweise sichtbar, Risiko-Achse = wie
// weit der Spieler plant, bevor er sichert/umkehrt.
//
// WICHTIG: pattern.states ist bewusst von "ruhig/sicher" (Index 0) nach
// "gefaehrlich" (letzter Index) geordnet. getEffectiveFailureChance()
// (unten) nutzt genau diese Reihenfolge, um den Musterzustand tatsaechlich
// auf die failureChance einer Aktion wirken zu lassen -- sonst waere die
// Prognose-Anzeige (getVisibleDistribution) wirkungslose Deko (siehe
// STATUS.md, aufgeloester Blocker "Phase 3 Spec-Abweichung").
//
// Trade-off-Check (design-toolbox.md Abschnitt 4, Punkt 5) fuer die
// RiskTiers unten, MIT Musterzustand-Einfluss geprueft (siehe auch
// STATUS.md fuer die volle Herleitung). EV pro Aktion je nach aktuellem
// Musterzustand (fern/nah/alarm), payout jeweils Erwartungswert der Spanne:
//
//   Tier      | fern (eff. %) | nah (eff. %) | alarm (eff. %) | EV fern | EV nah | EV alarm
//   ----------|---------------|--------------|----------------|---------|--------|----------
//   safe      | 0 %           | 0 %          | 0 %            | 3.0     | 3.0    | 3.0
//   balanced  | 2.5 %         | 15 %         | 27.5 %         | 7.8     | 6.8    | 5.8
//   risky     | 22.5 %        | 35 %         | 47.5 %         | 13.95   | 11.7   | 9.45
//
// "safe" bleibt IMMER bei failureChance 0 (siehe getEffectiveFailureChance:
// eine Basis-failureChance von 0 wird nie durch den Musterzustand veraendert
// -- sonst gaebe es keine garantiert risikofreie Aktion mehr). Innerhalb
// jedes einzelnen Musterzustands gilt weiterhin streng: safe < balanced <
// risky, sowohl bei EV als auch beim Risiko -> kein Tier ist bei gleichem
// oder geringerem Risiko strikt besser als ein anderes, JE Musterzustand.
// Da ein Fehlschlag den GESAMTEN Punktestand des laufenden Runs auf 0
// zurücksetzt (PushYourLuckEngine), wird "safe" mit wachsendem, noch nicht
// gebanktem Punktestand zunehmend attraktiver -- der eigentliche Sicher-vs-
// Riskant-Strategiewechsel entsteht aus der Situation (Baukasten 1.12).
// Neu (nach Blocker-Fix): Der Musterzustand selbst ist jetzt ein zweiter,
// aus der (teilweise sichtbaren) Prognose lernbarer Faktor fuer diese
// Entscheidung -- "risky" bei "fern" spielen ist spuerbar besser als
// "risky" bei "alarm" spielen, die Prognose hat dadurch echten
// strategischen Wert (design-toolbox.md 1.10).
export const GREED_RUN: MachineConfig = {
    id: 'greed-run',
    name: 'Greed Run',
    theme: 'pacman-twist',
    entryPoint: true,
    pattern: {
        // Reihenfolge ist die Danger-Achse fuer getEffectiveFailureChance:
        // "fern" = am wenigsten gefaehrlich, "alarm" = am gefaehrlichsten.
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

// Wie stark der aktuelle Musterzustand die failureChance einer Aktion
// verschiebt (0 = kein Einfluss, siehe getEffectiveFailureChance). Bewusst
// als eigener Wert statt Teil von MachineConfig/RiskTier, damit die
// Engine-Typen (src/engine/types.ts) unangetastet bleiben -- die
// Verzahnung von PatternEngine und PushYourLuckEngine ist reine
// MachineScene-/Data-Layer-Logik, keine Engine-Aenderung.
export const PATTERN_RISK_SENSITIVITY = 0.25;

// Verzahnt Musterzustand (PatternEngine) und Risiko-Tier (PushYourLuckEngine)
// zu einer einzigen effektiven failureChance, OHNE die beiden Engines
// aneinander zu koppeln: reine Funktion auf den bereits vorhandenen
// Daten (PatternConfig.states, RiskTier), aufgerufen aus MachineScene kurz
// vor resolveAction(). Nimmt an, dass `states` von sicher (Index 0) nach
// gefaehrlich (letzter Index) geordnet ist (siehe GREED_RUN.pattern.states).
//
// "safe" (failureChance 0) bleibt IMMER absolut sicher, unabhaengig vom
// Musterzustand -- sonst gaebe es keine garantiert risikofreie Aktion mehr
// und der Trade-off-Check (design-toolbox.md Punkt 5) waere verletzt
// (siehe PushYourLuckEngine.ts: "safe hat per Definition failureChance 0
// und kann daher nie scheitern").
export function getEffectiveFailureChance(
    tier: RiskTier,
    states: readonly string[],
    currentState: string,
    sensitivity: number = PATTERN_RISK_SENSITIVITY,
): number {
    if (tier.failureChance <= 0) {
        return 0;
    }

    const index = states.indexOf(currentState);
    // Unbekannter Zustand oder ein einzelner Zustand: neutral (kein Aus-
    // schlag), statt eine Richtung zu erfinden.
    const dangerFactor = index >= 0 && states.length > 1 ? index / (states.length - 1) : 0.5;
    const modifier = (dangerFactor - 0.5) * sensitivity;

    return Math.min(1, Math.max(0, tier.failureChance + modifier));
}
