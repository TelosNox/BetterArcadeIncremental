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

// "Trap Tunnels" (Automat 2) laut game-spec.md 4.3: Dig-Dug/Q*bert-Twist,
// Fallen vorab in einem Tunnel platziert. "Am wenigsten Zufall der vier ...
// nahezu vollstaendig aus dem Tunnellayout ableitbar" -> hohe baseVisibility
// (0.8, mit einem Upgrade-Schritt auf volle 1.0), da es der "reinste"
// Skill-Test sein soll. Risiko-Achse: frueh/sicher platzieren vs. auf
// Ketten-Reaktionen warten (hoeherer Multiplikator, hoeheres Risiko).
//
// Trade-off-Check (design-toolbox.md Punkt 5) je Musterzustand (stabil ->
// einsturz ist die Danger-Achse), mit PATTERN_RISK_SENSITIVITY = 0.25:
//   Tier      | stabil (eff.) | wackelig (eff.) | einsturz (eff.) | EV stabil | EV wackelig | EV einsturz
//   ----------|----------------|-----------------|-----------------|-----------|-------------|-------------
//   safe      | 0 %            | 0 %             | 0 %             | 4.0       | 4.0         | 4.0
//   balanced  | 5.5 %          | 18 %            | 30.5 %          | 9.92      | 8.61        | 7.30
//   risky     | 27.5 %         | 40 %            | 52.5 %          | 18.125    | 15.0        | 11.875
// safe < balanced < risky bei EV UND Risiko in jedem Musterzustand -> kein
// Tier dominiert (siehe machines.config.test.ts).
export const TRAP_TUNNELS: MachineConfig = {
    id: 'trap-tunnels',
    name: 'Trap Tunnels',
    theme: 'digdug-twist',
    entryPoint: false,
    pattern: {
        // Danger-Achse: "stabil" = am wenigsten gefaehrlich, "einsturz" = am
        // gefaehrlichsten. Transitionen bewusst stark skewed (ein dominanter
        // Folgezustand je Ausgangszustand) -- passend zu "am wenigsten
        // Zufall, nahezu vollstaendig ableitbar".
        states: ['stabil', 'wackelig', 'einsturz'],
        transitions: {
            stabil: { stabil: 0.85, wackelig: 0.15, einsturz: 0 },
            wackelig: { stabil: 0.2, wackelig: 0.15, einsturz: 0.65 },
            einsturz: { stabil: 0.1, wackelig: 0.1, einsturz: 0.8 },
        },
        baseVisibility: 0.8,
        visibilityPerUpgrade: [0.2],
    },
    riskTiers: [
        { id: 'safe', payoutRange: [4, 4], failureChance: 0 },
        { id: 'balanced', payoutRange: [8, 13], failureChance: 0.18 },
        { id: 'risky', payoutRange: [20, 30], failureChance: 0.4 },
    ],
    milestones: [
        { threshold: 25, bankable: true },
        { threshold: 60, bankable: true },
        { threshold: 120, bankable: true },
    ],
    upgrades: [],
};

// "Beat Ledger" (Automat 3) laut game-spec.md 4.4: DDR/Whac-a-Mole-Twist,
// Rhythmus ist von Anfang an bekannt ("wie Noten") -> baseVisibility 1
// (volle Sichtbarkeit von Beginn an, kein visibilityPerUpgrade noetig).
// Die Herausforderung liegt in der Umsetzung, nicht im Erraten der Umgebung
// (game-spec.md 4.4) -- der Musterzustand bleibt trotzdem ein Risikofaktor,
// nur eben ein STETS SICHTBARER. Risiko-Achse: enge Kombo-Fenster (hoher
// Multiplikator) vs. entspannte Abstaende (sicher, geringerer Multiplikator).
//
// Trade-off-Check je Musterzustand (ruhig -> doppelschlag ist die Danger-
// Achse), mit PATTERN_RISK_SENSITIVITY = 0.25:
//   Tier      | ruhig (eff.) | treibend (eff.) | doppelschlag (eff.) | EV ruhig | EV treibend | EV doppelschlag
//   ----------|--------------|------------------|---------------------|----------|-------------|------------------
//   safe      | 0 %          | 0 %              | 0 %                 | 5.0      | 5.0         | 5.0
//   balanced  | 7.5 %        | 20 %             | 32.5 %              | 12.025   | 10.4        | 8.775
//   risky     | 29.5 %       | 42 %             | 54.5 %              | 21.15    | 17.4        | 13.65
// safe < balanced < risky bei EV UND Risiko in jedem Musterzustand.
export const BEAT_LEDGER: MachineConfig = {
    id: 'beat-ledger',
    name: 'Beat Ledger',
    theme: 'ddr-twist',
    entryPoint: false,
    pattern: {
        // Danger-Achse: "ruhig" = am wenigsten gefaehrlich, "doppelschlag"
        // (Doppelschlag-Passage) = am gefaehrlichsten/schwersten zu treffen.
        states: ['ruhig', 'treibend', 'doppelschlag'],
        transitions: {
            ruhig: { ruhig: 0.4, treibend: 0.5, doppelschlag: 0.1 },
            treibend: { ruhig: 0.2, treibend: 0.4, doppelschlag: 0.4 },
            doppelschlag: { ruhig: 0.1, treibend: 0.3, doppelschlag: 0.6 },
        },
        baseVisibility: 1,
        visibilityPerUpgrade: [],
    },
    riskTiers: [
        { id: 'safe', payoutRange: [5, 5], failureChance: 0 },
        { id: 'balanced', payoutRange: [10, 16], failureChance: 0.2 },
        { id: 'risky', payoutRange: [24, 36], failureChance: 0.42 },
    ],
    milestones: [
        { threshold: 30, bankable: true },
        { threshold: 70, bankable: true },
        { threshold: 140, bankable: true },
    ],
    upgrades: [],
};

// "Champion's Ledger" (Automat 4) laut game-spec.md 4.5: Street-Fighter-
// Twist, letzter und komplexester Automat vor dem Hallen-Abschluss. Gegner
// rotiert durch Stances aggressiv/defensiv/Finte (Zustaende wortwoertlich
// aus der Spezifikation uebernommen). "Gelegentliche klar angekuendigte
// Spezialmoves" aus game-spec.md 4.5 wird in dieser Phase bewusst NICHT als
// eigener Mechanismus abgebildet: das wuerde eine pro-Zustand-Sichtbarkeit
// in PatternEngine voraussetzen, die die Engine aktuell nicht kennt
// (getVisibility ist global pro Upgrade-Level, nicht pro Zustand) -- siehe
// STATUS.md. Statt die Engine dafuer zu erweitern oder es in der Szene zu
// umgehen, wird dieses Detail als reine Fiktions-Farbe ausgelassen; die
// Kernmechanik (drei Stances mit probabilistischen Uebergaengen) ist
// unveraendert vollstaendig ueber PatternConfig abbildbar.
//
// Danger-Achse: "defensiv" (schwer zu punkten) gilt als am gefaehrlichsten,
// "finte" (Oeffnung) als am wenigsten gefaehrlich -- Standard-Fighting-Game-
// Konvention, dass eine gute Verteidigung am schwersten zu durchbrechen ist.
//
// Trade-off-Check je Musterzustand, mit PATTERN_RISK_SENSITIVITY = 0.25:
//   Tier      | finte (eff.) | aggressiv (eff.) | defensiv (eff.) | EV finte | EV aggressiv | EV defensiv
//   ----------|---------------|-------------------|------------------|----------|--------------|-------------
//   safe      | 0 %           | 0 %               | 0 %              | 6.0      | 6.0          | 6.0
//   balanced  | 7.5 %         | 20 %              | 32.5 %           | 14.8     | 12.8         | 10.8
//   risky     | 32.5 %        | 45 %              | 57.5 %           | 25.3125  | 20.625       | 15.9375
// safe < balanced < risky bei EV UND Risiko in jedem Musterzustand.
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
        // Niedrigste baseVisibility der vier Automaten -- passend zur
        // Positionierung als komplexester/letzter Automat vor dem
        // Hallen-Abschluss (game-spec.md 4.5).
        baseVisibility: 0.3,
        visibilityPerUpgrade: [0.35, 0.35],
    },
    riskTiers: [
        { id: 'safe', payoutRange: [6, 6], failureChance: 0 },
        { id: 'balanced', payoutRange: [12, 20], failureChance: 0.2 },
        { id: 'risky', payoutRange: [30, 45], failureChance: 0.45 },
    ],
    milestones: [
        { threshold: 40, bankable: true },
        { threshold: 90, bankable: true },
        { threshold: 180, bankable: true },
    ],
    upgrades: [],
};

export const MACHINES: readonly MachineConfig[] = [GREED_RUN, TRAP_TUNNELS, BEAT_LEDGER, CHAMPIONS_LEDGER];

// Freischalt-Schwellen fuer Automat 2-4 (game-spec.md 3.3) leben ab Phase 7
// als echtes Hallen-Upgrade-System in src/data/hall.config.ts
// (MACHINE_UNLOCK_UPGRADES) -- der fruehere PLATZHALTER hier (fest codierte
// MACHINE_UNLOCK_COST-Konstante, Phase 6) wurde vollstaendig ersetzt, nicht
// nur ergaenzt (PM-Vorgabe, siehe STATUS.md "PM-Entscheidungen").

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
