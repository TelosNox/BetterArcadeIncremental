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
// siehe EngineState unten). Phase 7f (Greed Run Genre-Rework, siehe
// STATUS.md/game-spec.md 4.2) erhoeht sie erneut auf 4 (neues Pflichtfeld
// `gridFocusPreference`) -- aus demselben Grund keine Migration. Phase 7i
// (Trap Tunnels Genre-Rework, game-spec.md 4.3) erhoeht sie erneut auf 5:
// Automat 2 wechselt von `kind: 'cyclic'` auf `kind: 'trapTunnels'`, alte
// `machineUpgrades['trap-tunnels']`-Eintraege referenzieren Upgrade-ids, die
// es nicht mehr gibt -- ebenfalls keine Migration, alte Saves werden
// abgelehnt statt mit verwaisten Eintraegen weiterzulaufen. Phase 7j (Trap
// Tunnels Kernmodell-Ersatz, game-spec.md 4.3 v2) erhoeht sie erneut auf 6:
// `trapPreviewRangeUpgrades` entfaellt (die Vorschau-Achse gibt es nicht
// mehr), alte `machineUpgrades['trap-tunnels']`-Eintraege koennten auf
// `trap-tunnels-trap-preview-*`-ids zeigen, die es nicht mehr gibt -- erneut
// keine Migration. Phase 7m (Boost Barrage Genre-Ersatz, game-spec.md 4.4)
// erhoeht sie erneut auf 7: Automat 3 wechselt von `kind: 'cyclic'` (vormals
// "Beat Ledger", DDR-Twist, verworfen -- game-spec.md 4.4) auf
// `kind: 'boostBarrage'`, die Automaten-id selbst wechselt von 'beat-ledger'
// zu 'boost-barrage' (komplett andere Mechanik verdient eine eigene id statt
// eine stale Rhythmus-Spiel-id weiterzutragen) -- alte
// `machineUpgrades['beat-ledger']`/`unlockedMachines`/`completedMachines`-
// Eintraege wuerden sonst ins Leere zeigen. Erneut keine Migration.
export const CURRENT_SAVE_VERSION = 7;

// Gemeinsame Felder, die JEDER Automat hat, unabhaengig von seiner
// Kernmechanik (Phase 7f, game-spec.md 4.2: Greed Run bekommt eine
// strukturell andere Mechanik als das gemeinsame zyklische Modell aus
// 4.1/4.1b/4.1c, das Automaten 2-4 weiterhin nutzen). Alles, was die
// Hallen-Oekonomie/Meilenstein-Auswertung MACHINE-AGNOSTISCH braucht
// (getReachedMilestones, hall.config.ts::MACHINE_UNLOCK_UPGRADES, HallHub.tsx),
// lebt hier, damit es fuer BEIDE MachineConfig-Varianten unveraendert
// funktioniert, ohne auf `kind` unterscheiden zu muessen.
export interface MachineIdentity {
    id: string;
    name: string;
    theme: string;
    entryPoint: boolean; // true nur beim Layer-0-Automaten
    milestones: Milestone[];
    // Feste, NICHT kaufbare Normalisierungs-Konstante (Phase 7d, game-spec.md
    // 3.1): gleicht unterschiedliche Rohzahlen-Skalen der vier Automaten
    // (Champion's Ledger deutlich hoeher als Greed Run) fuer einen fairen
    // BASIS-Vergleich beim Beitrag zum gemeinsamen Ticket-Pool aus -- kein
    // Spieler-Hebel, reiner Balance-Wert. Siehe machines.config.ts fuer die
    // konkrete Kalibrierung.
    ticketYieldFactor: number;
}

// Automat 2-4 (game-spec.md 4.1/4.1b/4.1c): rein zyklisches Konter-Modell,
// unveraendert seit Phase 7c/7e.
export interface CyclicMachineConfig extends MachineIdentity {
    kind: 'cyclic';
    pattern: PatternConfig;
    actions: MachineAction[];
    // Automaten-interne, mit Automaten-Punkten bezahlte Zwei-Achsen-Vorschau
    // (Phase 7c): zwei UNABHAENGIGE Leitern statt einer einzelnen
    // "visibility"-Leiter aus Phase 7b (siehe MachineUpgradeDef unten).
    depthUpgrades: MachineUpgradeDef[];
    precisionUpgrades: MachineUpgradeDef[];
}

// Automat 1 "Greed Run" (Phase 7f, game-spec.md 4.2): 5x5-Sektorenfeld statt
// zyklisches Pattern -- nutzt PatternEngine/CyclicActionDef nicht mehr. Siehe
// GridRunEngine.ts fuer die reine Spiellogik.
export interface GridMachineConfig extends MachineIdentity {
    kind: 'grid';
    grid: GridSectorConfig;
    // Drei UNABHAENGIGE, ticket... genauer: automaten-punkte-finanzierte
    // Upgrade-Leitern (game-spec.md 4.2 Punkt "Drei unabhaengige
    // Upgrade-Achsen") -- bewusst KEINE Kreuz-Preis-Kopplung wie beim
    // zyklischen Modell (nicht Teil der Spezifikation fuer dieses Experiment).
    sightRangeUpgrades: MachineUpgradeDef[];
    gridPrecisionUpgrades: MachineUpgradeDef[];
    actionBudgetUpgrades: MachineUpgradeDef[];
}

// Automat 2 "Trap Tunnels" (Phase 7i, game-spec.md 4.3, Kernmodell-Ersatz in
// Phase 7j): Tunnelnetz-Fallen-Modell statt zyklisches Konter-Modell --
// ersetzt die urspruengliche CyclicMachineConfig-Belegung von Automat 2
// vollstaendig. Nutzt PatternEngine/CyclicActionDef nicht mehr (siehe
// TrapTunnelsEngine.ts). Phase 7j entfernt die Vorschau-Achse (es gibt keine
// verborgene Information mehr, siehe game-spec.md 4.3 "Keine Vorschau-
// Mechanik") und ersetzt sie durch zwei neue Achsen: Dynamitanzahl (sprengbare
// Verbindungen pro Run) und Gegneranzahl (reiner Multiplikator-Hebel).
export interface TrapTunnelsMachineConfig extends MachineIdentity {
    kind: 'trapTunnels';
    run: TrapTunnelsRunConfig;
    // Drei UNABHAENGIGE Upgrade-Achsen (game-spec.md 4.3), strukturell analog
    // zu sightRangeUpgrades/actionBudgetUpgrades oben, aber eigener
    // Zahlenbereich (siehe MachineUpgradeEffect unten).
    trapCountUpgrades: MachineUpgradeDef[];
    dynamiteCountUpgrades: MachineUpgradeDef[];
    enemyCountUpgrades: MachineUpgradeDef[];
}

// Automat 3 "Boost Barrage" (Phase 7m, game-spec.md 4.4): Autopilot-
// Space-Shooter statt zyklisches Konter-Modell -- ersetzt die urspruengliche
// CyclicMachineConfig-Belegung von Automat 3 ("Beat Ledger", DDR-Twist,
// verworfen) vollstaendig. Nutzt PatternEngine/CyclicActionDef nicht mehr
// (siehe BoostBarrageEngine.ts). Drei Upgrade-Achsen, aber bewusst KEINE
// davon erhoeht die Wellenanzahl (game-spec.md 4.4 "Bewusstes Design-
// Prinzip": Wellenanzahl pro Lauf ist NICHT upgradebar, alle Achsen erhoehen
// ausschliesslich den Ertrag PRO Welle).
export interface BoostBarrageMachineConfig extends MachineIdentity {
    kind: 'boostBarrage';
    run: BoostBarrageRunConfig;
    // Vorschau/Vorwarnzeit ist bewusst eine reine UI-Timing-Groesse (siehe
    // BoostBarrageRunConfig-Kommentar unten) -- trotzdem eine ganz normale,
    // mit Automaten-Punkten bezahlte Upgrade-Leiter wie die anderen beiden.
    warningUpgrades: MachineUpgradeDef[];
    boostPowerUpgrades: MachineUpgradeDef[];
    chargeUpgrades: MachineUpgradeDef[];
}

export type MachineConfig = CyclicMachineConfig | GridMachineConfig | TrapTunnelsMachineConfig | BoostBarrageMachineConfig;

// --- Boost Barrage / Autopilot-Space-Shooter-Automat (Phase 7m, ----------
// game-spec.md 4.4) --------------------------------------------------------

export type BoostBarrageEnemyType = 'scout' | 'bomber' | 'elite';
export type BoostBarrageBoostType = 'firepower' | 'shield' | 'evade' | 'focus';

// Bewusst EIN Bundle-Objekt (wie TrapTunnelsRunConfig/GridSectorConfig oben)
// -- BoostBarrageEngine.ts nimmt dieses Objekt komplett entgegen. `waveCount`
// ist FEST und wird von KEINEM Upgrade beeinflusst (game-spec.md 4.4
// "Bewusstes Design-Prinzip"). `baseWarningMs`/`warningMsPerLevel` werden
// NICHT von der Engine selbst gelesen -- die Engine kennt kein Echtzeit-
// Konzept (Architektur-Kurzregel CLAUDE.md: Kernlogik kennt weder Phaser noch
// React). Sie leben trotzdem hier im selben Bundle (statt verstreut in der
// Szene), weil sie zur selben automaten-internen Vorwarnzeit-Upgrade-Leiter
// gehoeren wie die uebrigen Werte -- BoostBarrageScene.ts liest sie direkt
// aus `machine.run`, um die Verzoegerung vor jeder Gefechts-Aufloesung zu
// bestimmen (das laengere Aktivierungsfenster selbst, game-spec.md 4.4
// "Vorschau/Vorwarnzeit").
export interface BoostBarrageRunConfig {
    waveCount: number; // fest, z.B. 5 -- NICHT upgradebar (game-spec.md 4.4)
    enemiesPerWave: number; // festes Roster pro Welle, z.B. 6
    enemyWeights: Record<BoostBarrageEnemyType, number>; // relative Gewichte, Scout dominiert deutlich
    scoutPayoutRange: [min: number, max: number];
    bomberDestroyPayoutRange: [min: number, max: number]; // Bomber vor dem Feuern zerstoert
    bomberHitCostRange: [min: number, max: number]; // Betrag (positiv!), wird als negativer Payout angewendet, wenn der Angriff trifft
    elitePayoutRange: [min: number, max: number];
    baseBomberDestroyChance: number; // 0-1, Autopilot allein, vor Eskalation/Boosts
    baseEliteHitChance: number; // 0-1, Autopilot allein, vor Eskalation/Boosts
    escalationPerDestroyed: number; // Bedrohungszuwachs je bereits in DIESER Welle zerstoertem Gegner (game-spec.md 4.4 "Eskalation")
    firepowerDestroyBonusPerLevel: number; // addiert auf baseBomberDestroyChance je Boost-Staerke-Stufe, waehrend Feuerkraft aktiv ist
    firepowerScoutBonusPerLevel: number; // Bonus-Payout auf Scout-Treffer je Stufe, waehrend Feuerkraft aktiv ist
    shieldDamageReductionPerLevel: number; // 0-1 Anteil des Bomber-Schadens, der je Stufe negiert wird, waehrend Schild aktiv ist
    focusHitBonusPerLevel: number; // Payout-Multiplikator-Bonus auf Elite-Treffer je Stufe, waehrend Fokus aktiv ist
    evadeDurationBaseSteps: number; // wie viele Gefechte EIN Ausweich-Einsatz mindestens abdeckt (>=1)
    evadeDurationPerExtraLevel: number; // zusaetzliche Gefechte je Boost-Staerke-Stufe ueber Stufe 1 hinaus
    baseWarningMs: number; // reine UI-Timing-Groesse, siehe Datei-Kommentar oben
    warningMsPerLevel: number; // addiert auf baseWarningMs je Vorschau-Upgrade-Stufe ueber Stufe 1 hinaus
}

// --- Trap Tunnels / Tunnelnetz-Fallen-Automat (Phase 7i, game-spec.md 4.3) -

// Bewusst EIN Bundle-Objekt (wie GridSectorConfig oben) statt einzelner
// Felder direkt auf TrapTunnelsMachineConfig -- TrapTunnelsEngine.ts nimmt
// dieses Objekt komplett entgegen, dieselbe Konvention wie
// GridRunEngine(config.grid, ...). Phase 7j: `enemyCount` wandert von hier in
// einen Konstruktor-/Laufzeit-Parameter von TrapTunnelsEngine (Upgrade-
// abhaengig, game-spec.md 4.3 "Gegneranzahl"), `minStartDistance` entfaellt
// vollstaendig (game-spec.md 4.3 "keine Mindestabstandsregel mehr noetig").
export interface TrapTunnelsRunConfig {
    gridSize: number; // 4 -- quadratisches Kreuzungs-Raster (4x4 = 16 Kreuzungen)
    extraEdgeRange: [min: number, max: number]; // zusaetzliche Kanten ueber den Spannbaum hinaus (3-4)
    pathLength: number; // Ausfuehrungsschritte pro Run, game-spec.md 4.3: fix, z.B. 6
    singleCatchPayoutRange: [min: number, max: number]; // ein Gegner trifft eine Falle
    chainCatchPayoutRange: [min: number, max: number]; // zwei Gegner treffen im selben Schritt dieselbe Falle
}

// --- Greed Run / Grid-Automat (Phase 7f, game-spec.md 4.2) ----------------

export type SectorCategory = 'ghost' | 'points' | 'empty' | 'bonus';

export type GridFocus = 'safe' | 'greedy';

export interface GridSectorConfig {
    gridSize: number; // 5
    // Anzahl Sektoren je Kategorie unter den (gridSize*gridSize - 1)
    // Nicht-Start-Sektoren -- muss sich exakt darauf aufsummieren
    // (GridRunEngine.generateGrid wirft sonst).
    categoryCounts: Record<SectorCategory, number>;
    payoutRanges: Record<SectorCategory, [min: number, max: number]>;
    // Weiche->tatsaechlich lokal harte Sicherheits-Korrektur NUR fuer die
    // direkten Nachbarn des Startfelds (game-spec.md 4.2 "Sicherheits-
    // Constraint") -- keine Garantie fuer den Rest des Feldes.
    maxGhostAmongStartNeighbors: number;
}

export interface GridFocusPreference {
    focus: GridFocus;
    keepForNextRun: boolean;
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
// Phase 7f (game-spec.md 4.2): drei weitere Effekt-Varianten fuer die
// Grid-Automaten-Upgrade-Achsen, strukturell analog zu previewDepth/
// previewPrecision (absoluter Zielwert ab dieser Stufe), aber bewusst
// eigene Typen statt Wiederverwendung -- previewDepth/previewPrecision
// gelten fuer das zyklische Zwei-Achsen-Modell (Automat 2-4), waehrend
// gridSightRange/gridPrecision/gridActionBudget einen eigenen, unabhaengigen
// Zahlenbereich haben (siehe machines.config.ts). Phase 7i (game-spec.md 4.3)
// erweiterte um trapPreviewRange/trapCount fuer Trap Tunnels' Upgrade-Achsen;
// Phase 7j (game-spec.md 4.3 v2, Kernmodell-Ersatz) entfernt trapPreviewRange
// wieder (keine Vorschau-Achse mehr) und ergaenzt dynamiteCount (sprengbare
// Verbindungen pro Run) und enemyCount (gleichzeitig laufende Gegner) --
// trapCount (gleichzeitig platzierbare Fallen) bleibt unveraendert. Phase 7m
// (game-spec.md 4.4) ergaenzt drei weitere Varianten fuer Boost Barrages
// Upgrade-Achsen: warningWindow (Vorwarnzeit in ms, reine UI-Timing-Groesse),
// boostPower (Boost-Staerke-Stufe 1-3) und boostCharges (Ladungen je Boost-
// Typ und Welle, 1-3, siehe BoostBarrageEngine.ts).
export type MachineUpgradeEffect =
    | { type: 'previewDepth'; value: number }
    | { type: 'previewPrecision'; value: number }
    | { type: 'gridSightRange'; value: number }
    | { type: 'gridPrecision'; value: number }
    | { type: 'gridActionBudget'; value: number }
    | { type: 'trapCount'; value: number }
    | { type: 'dynamiteCount'; value: number }
    | { type: 'enemyCount'; value: number }
    | { type: 'warningWindow'; value: number }
    | { type: 'boostPower'; value: number }
    | { type: 'boostCharges'; value: number };

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
    // Fokus-Wahl Sicher/Gier des Grid-Automaten (Phase 7f, game-spec.md 4.2
    // "UI-Ablauf"), pro Automat-id gespeichert (Record statt Einzelfeld, damit
    // ein spaeterer zweiter Grid-Automat dasselbe Feld mitnutzen kann, ohne
    // erneut die Save-Version zu erhoehen). `keepForNextRun` steuert, ob der
    // naechste Run das Fokus-Popup ueberspringt und `focus` direkt uebernimmt.
    gridFocusPreference: Record<string, GridFocusPreference>;
}
