import type Decimal from 'break_infinity.js';

// Gemeinsame Typdefinitionen fuer die Engine, unabhaengig von Phaser/React.
// Struktur laut implementation-plan.md Abschnitt 3 ("Starter-Datentypen"),
// ueberarbeitet in Phase 7c (Kernmechanik-Revision v2, siehe STATUS.md) fuer
// das neue, rein zyklische Aktionsmodell (ersetzt das "harte Konter-Aktion +
// Zwischenstufe"-Modell aus Phase 7b vollstaendig).

// Phase 7d (Attendant-Rate + Ticket-Oekonomie-Vereinfachung, siehe STATUS.md)
// aendert die EngineState-Form inkompatibel (Credits entfallen, ticketsByMachine
// wird umbenannt, neue Pflichtfelder fuer Attendant-Rate/Pool). Es existieren
// noch keine echten Nutzer-Spielstaende -- statt einer Migration wird ein
// Save mit saveVersion !== CURRENT_SAVE_VERSION beim Laden bewusst als
// inkompatibel abgelehnt (SaveSystem.load() faengt das ab und startet sauber
// neu, siehe SaveSystem.ts). Phase 7e (Erkennbarkeit + Banking-Streichung)
// erhoeht die Version erneut auf 3 (neues Pflichtfeld `machinePeakScore`,
// siehe EngineState unten) -- aus demselben Grund keine Migration.
export const CURRENT_SAVE_VERSION = 3;

export interface MachineConfig {
    id: string;
    name: string;
    theme: string;
    entryPoint: boolean; // true nur beim Layer-0-Automaten
    pattern: PatternConfig;
    actions: MachineAction[];
    milestones: Milestone[];
    // Automaten-interne, mit Automaten-Punkten bezahlte Zwei-Achsen-Vorschau
    // (Phase 7c): zwei UNABHAENGIGE Leitern statt einer einzelnen
    // "visibility"-Leiter aus Phase 7b (siehe MachineUpgradeDef unten).
    depthUpgrades: MachineUpgradeDef[];
    precisionUpgrades: MachineUpgradeDef[];
    // Feste, NICHT kaufbare Normalisierungs-Konstante (Phase 7d, game-spec.md
    // 3.1): gleicht unterschiedliche Rohzahlen-Skalen der vier Automaten
    // (Champion's Ledger deutlich hoeher als Greed Run) fuer einen fairen
    // BASIS-Vergleich beim Beitrag zum gemeinsamen Ticket-Pool aus -- kein
    // Spieler-Hebel, reiner Balance-Wert. Siehe machines.config.ts fuer die
    // konkrete Kalibrierung.
    ticketYieldFactor: number;
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

// Engine-facing: das, womit PushYourLuckEngine.drawPayout() tatsaechlich
// wuerfelt. Phase 7c vereinfacht dies auf eine reine Payout-Spanne (ggf.
// negativ) -- kein failureChance mehr, weil jede Aktion garantiert trifft
// (siehe CyclicActionDef-Kommentar). Kennt weder Pattern-Zustaende noch
// Gewinn/Verlust/Treffer-Unterscheidung -- diese Aufloesung passiert VOR dem
// Aufruf (machines.config.ts::resolveMachineAction).
export interface ResolvedAction {
    id: string;
    payoutRange: [min: number, max: number]; // sichtbare Bandbreite (Baukasten 1.11), kann negativ sein
}

// Phase 7e (Erkennbarkeit + Banking-Streichung, siehe STATUS.md): Banking
// entfaellt, jede Aktion verbucht sich sofort UND dauerhaft direkt im
// EconomyStore (EconomyStore.applyMachineScoreDelta). `bankable` faellt
// damit weg -- es gibt keine Entscheidung "an diesem Meilenstein sichern
// oder weitermachen" mehr, jeder Meilenstein ist nur noch ein reiner
// Fortschritts-Marker (siehe machines.config.ts::getReachedMilestones,
// wertet gegen den PERSISTENTEN Punktestand-Peak eines Automaten aus statt
// gegen einen ephemeren Run wie bis Phase 7c/7d).
export interface Milestone {
    threshold: number; // benoetigte Punkte
}

export type UpgradeEffect =
    | { type: 'attendantSpeed'; value: number } // absoluter Trainings-Multiplikator ab dieser Stufe (hall.config.ts)
    | { type: 'ticketYieldRate'; value: number } // absoluter Multiplikator auf den Ticket-Ertrag pro Aktion ab dieser Stufe, hallenweit (hall.config.ts, Phase 7d)
    | { type: 'unlockMachine'; machineId: string }; // schaltet einen Automaten frei (hall.config.ts)

export interface UpgradeDef {
    id: string;
    name: string;
    description: string;
    cost: number; // in Tickets (hallenweit, Phase 7d -- ersetzt "Credits")
    effect: UpgradeEffect;
}

// Automaten-interne Upgrades (Phase 7b, Zwei-Achsen-Vorschau neu in Phase
// 7c): bezahlt mit den EIGENEN Automaten-Punkten DIESES Automaten (Phase 7d,
// vorher "Tickets" genannt), nicht mit den hallenweiten Tickets -- bewusst
// ein eigener Typ statt Wiederverwendung von UpgradeDef (dessen cost-Feld
// explizit die hallenweite Waehrung meint, und dessen effect-Varianten
// hallenweite Konzepte mitschleppen wuerden, die fuer eine automaten-interne
// Progression keinen Sinn ergeben).
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
    cost: number; // Basispreis in Automaten-Punkten DIESES Automaten, vor Kreuz-Preis-Aufschlag
    effect: MachineUpgradeEffect;
}

// Vordergrund-Optik-Zustand des Attendant-Ausschuettungs-Pools EINES
// Automaten (Phase 7d, game-spec.md 3.2). Reine Zahlen (nicht Decimal), weil
// die zugrunde liegende Ertragsrate selbst eine kontinuierliche
// Erwartungswert-Groesse ist, keine diskrete Spielwaehrung -- erst beim
// tatsaechlichen Ausschuetten (applyAttendantElapsed, AttendantEngine.ts)
// wird ueber EconomyStore.addMachinePoints/addHallTickets in die echte
// (Decimal-basierte) Waehrung ueberfuehrt. msSincePayout trackt, wie viel
// Echtzeit seit der letzten Zyklus-Ausschuettung vergangen ist (siehe
// AttendantEngine.ts::applyAttendantElapsed).
export interface AttendantPoolState {
    machinePoints: number;
    hallTickets: number;
    msSincePayout: number;
}

export interface EngineState {
    saveVersion: number;
    // Hallenweit gepoolte Waehrung (Phase 7d, ersetzt "Credits" komplett,
    // siehe game-spec.md 3.1) -- kauft Hallen-Upgrades, Freischaltung
    // Automat 2/3/4, Attendant-Training.
    tickets: Decimal;
    // Automaten-Punkte: lokal pro Automat, NICHT uebertragbar (Phase 7d,
    // vorher "ticketsByMachine" genannt -- umbenannt, um die Verwechslung
    // mit der neuen hallenweiten "tickets"-Waehrung oben auszuschliessen).
    // Kauft ausschliesslich Tiefe-/Praezisions-Upgrades DES EIGENEN Automaten.
    machinePoints: Record<string, Decimal>;
    // Hoechster je fuer diesen Automaten erreichter `machinePoints`-Wert
    // (Phase 7e) -- STEIGT NIE durch Ausgeben (spendMachinePoints) oder
    // einen Verlust (applyMachineScoreDelta klemmt machinePoints bei 0,
    // laesst den Peak aber unangetastet). Ersetzt die "sticky"
    // Peak-Score-Logik, die bis Phase 7c/7d in PushYourLuckRun lebte, jetzt
    // auf Ebene des PERSISTENTEN, automaten-uebergreifenden Punktestands
    // statt eines ephemeren Runs. Treibt sowohl die Meilenstein-Pip-Anzeige
    // als auch die "Durchgespielt"-Erkennung (siehe machines.config.ts::
    // getReachedMilestones/isFinalMilestoneReached).
    machinePeakScore: Record<string, Decimal>;
    unlockedMachines: string[];
    attendantKnowledge: Record<string, number>; // 0-1 pro Automat
    hallUpgrades: string[];
    completedMachines: string[]; // "durchgespielt" laut game-spec.md 4.1
    machineUpgrades: Record<string, string[]>; // pro Automat gekaufte MachineUpgradeDef-ids (Phase 7b/7c, beide Leitern gemeinsam)
    // Attendant-Rate-Modell (Phase 7d): Pool-Zustand pro Automat (reine
    // Vordergrund-Optik) + EIN globaler Zeitstempel (ms epoch) fuer die
    // zuletzt angewendete Echtzeit-Differenz, siehe AttendantEngine.ts.
    attendantPools: Record<string, AttendantPoolState>;
    lastAttendantUpdate: number;
}
