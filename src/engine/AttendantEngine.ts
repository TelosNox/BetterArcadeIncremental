import type {
    AttendantPoolState,
    BoostBarrageRunConfig,
    CyclicActionDef,
    GridSectorConfig,
    PatternConfig,
    SectorCategory,
    TrapTunnelsRunConfig,
} from './types';
import { computeBlindExpectedValue } from './GridRunEngine';

// Attendant-Automatisierung (game-spec.md 3.2, Baukasten 1.3/1.9). Framework-
// unabhaengig, kennt weder Phaser noch React (Architektur-Kurzregel). Nutzt
// nur die reinen Typdefinitionen aus ./types -- NICHT die Aufloesungs-
// funktionen aus src/data/machines.config.ts, die bleiben Data-Layer
// (Architektur-Kurzregel: Engine importiert nie aus /src/data).
//
// Phase 7d (Attendant-Rate + Ticket-Oekonomie-Vereinfachung, siehe STATUS.md)
// ersetzt das komplette Schritt-fuer-Schritt-Auswahlmodell aus Phase 7c
// (chooseAttendantAction/getAttendantResolvedAction, hier bis Phase 7c
// vorhanden) VOLLSTAENDIG durch eine deterministische ERTRAGSRATE
// (Punkte/Sekunde, Tickets/Sekunde), angewendet ueber verstrichene Echtzeit
// statt ueber einen laufenden Tick-Timer -- der Attendant "spielt" keine
// einzelnen Runden mehr, er produziert einen kontinuierlichen Fluss. Das
// loest zwei Probleme gleichzeitig: (1) kein Ressourcenverbrauch durch echte
// Rundensimulation im Hintergrund, (2) Fortschritt ueberlebt geschlossene
// Tabs (Offline-Ertrag), da nur die Zeitdifferenz zwischen zwei Aufrufen
// zaehlt, nicht ein laufender Prozess.
//
// Der Attendant bleibt an ZWEI Stellschrauben gekoppelt, beide letztlich an
// die Musterkenntnis (0-1, EconomyStore.getAttendantKnowledge):
//   1. Effizienz (unveraendert gegenueber Phase 5/7b/7c): der resultierende
//      Ertrag wird auf ATTENDANT_MAX_EFFICIENCY * knowledge geklemmt --
//      selbst bei perfekter Aktionswahl bleibt der Attendant spuerbar unter
//      der moeglichen Bestleistung (Richtwert 85-90%, game-spec.md 3.2).
//   2. Eigener Anteil an Tiefe UND Praezision (unveraendert): der Attendant
//      nutzt von der TATSAECHLICH gekauften Sichtweite (d) und Praezision
//      (p) -- die gelten fuer Spieler UND Attendant gleich -- jeweils nur
//      einen mit der Musterkenntnis wachsenden Anteil.

export const ATTENDANT_MAX_EFFICIENCY = 0.875;

export const MANUAL_KNOWLEDGE_GAIN = 0.02;
export const TRAINING_KNOWLEDGE_GAIN = 0.01;

// Feste, konfigurierbare Rate-Parameter (STATUS.md, Teil 2 der Konkreten
// Umsetzung): "Aktionen pro Sekunde als fester Parameter".
export const ATTENDANT_ACTIONS_PER_SECOND = 1;

// Pool-Ausschuettungs-Zyklus: "Intervall in der Groessenordnung einer echten
// Spielrunde" (STATUS.md) -- eine manuelle Planungsrunde mit bis zu 6
// Schritten a 700ms (MachineScene.STEP_DELAY_MS) dauert ca. 4.2s, daher 4000ms.
export const ATTENDANT_POOL_CYCLE_MS = 4000;
export const ATTENDANT_POOL_FACTOR_MIN = 0.8;
export const ATTENDANT_POOL_FACTOR_MAX = 1.2;

// Ab dieser verstrichenen Echtzeit gilt ein Aufruf als "Fokussieren/Laden
// nach Abwesenheit" statt als normaler fortlaufender Vordergrund-Tick --
// bewusst deutlich groesser als das tatsaechliche Tick-Intervall der UI
// (siehe economy.ts), damit normale, haeufige Ticks IMMER den Pool-Pfad
// nehmen und nur echte Luecken (Tab im Hintergrund gedrosselt, neu geladen,
// wieder fokussiert) den direkten Offline-Pfad ausloesen.
export const FOREGROUND_TICK_THRESHOLD_MS = 15_000;

// Deckel fuer maximal anrechenbare Abwesenheit (STATUS.md: "z. B. 24h"), um
// absurde Spruenge/Exploits (z. B. Systemuhr manipulieren) zu vermeiden.
export const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function mean([a, b]: readonly [number, number]): number {
    return (a + b) / 2;
}

// Anteil der menschenmoeglichen Leistung, den der Attendant bei gegebener
// Musterkenntnis erreicht (0 bei knowledge 0, ATTENDANT_MAX_EFFICIENCY bei
// knowledge 1).
export function getAttendantEfficiency(knowledge: number): number {
    return ATTENDANT_MAX_EFFICIENCY * clamp01(knowledge);
}

// Wie viele der TATSAECHLICH gekauften Sichtweite-Positionen (previewDepth,
// automaten-weit gleich fuer Spieler und Attendant) der Attendant nutzen
// kann -- 0 bei Musterkenntnis 0 (komplett blind), die volle Tiefe bei
// voller Musterkenntnis (wie ein Spieler).
export function getAttendantLookahead(previewDepth: number, knowledge: number): number {
    return Math.floor(previewDepth * clamp01(knowledge));
}

// Wie viele der TATSAECHLICH gekauften Praezisions-Stufen (previewPrecision)
// der Attendant innerhalb seines Lookaheads nutzen kann -- analog zu
// getAttendantLookahead, aber fuer die zweite Vorschau-Achse.
export function getAttendantPrecision(previewPrecision: number, knowledge: number): number {
    return Math.floor(previewPrecision * clamp01(knowledge));
}

// --- Stationaere Verteilung (Power-Iteration) ---------------------------
//
// Bis Phase 7c war das ein reines Test-Werkzeug (machines.config.test.ts,
// fuer die Blind-EV-Garantie). Phase 7d braucht dieselbe Berechnung zur
// LAUFZEIT (Attendant-Ertragsrate basiert auf derselben Erwartungswert-
// Mathematik, STATUS.md Teil 2) -- deshalb hier zu Produktionscode befoerdert
// und aus dem Test heraus wiederverwendet statt dupliziert.
export function computeStationaryDistribution(
    pattern: Pick<PatternConfig, 'states' | 'transitions'>,
    iterations = 3000,
): Record<string, number> {
    const { states, transitions } = pattern;
    let dist: Record<string, number> = Object.fromEntries(states.map((s) => [s, 1 / states.length]));

    for (let step = 0; step < iterations; step += 1) {
        const next: Record<string, number> = Object.fromEntries(states.map((s) => [s, 0]));
        for (const from of states) {
            const targets = transitions[from] ?? {};
            for (const [to, probability] of Object.entries(targets)) {
                next[to] += dist[from] * probability;
            }
        }
        dist = next;
    }
    return dist;
}

// --- Erwartungswert pro Aktion (Grundlage der Ertragsrate) ---------------
//
// Der Attendant "spielt" nicht mehr Schritt fuer Schritt (siehe Datei-
// Kommentar oben) -- statt seine tatsaechliche Kandidaten-Ausschluss-
// Heuristik (vormals chooseAttendantAction) exakt nachzubilden (das erfordert
// eine kombinatorische Betrachtung ueber alle moeglichen Ausschluss-
// Reihenfolgen je Praezisions-Stufe), wird eine bewusst einfachere, aber an
// beiden Enden EXAKTE Interpolation verwendet:
//   - attendantLookahead === 0 (Musterkenntnis reicht nicht, um ueberhaupt
//     etwas von der naechsten Position zu sehen): der Attendant spielt
//     durchgehend blind -- EV = EV(actions[0]) unter der stationaeren
//     Verteilung (derselbe feste Fallback wie die vormalige
//     chooseAttendantAction-Blindwahl).
//   - attendantLookahead >= 1: solange previewDepth (bzw. START_DEPTH) >= 1
//     gilt (game-spec.md 4.1b Punkt 7: Spieler UND Attendant starten nie
//     komplett blind), sieht der Attendant bei JEDER Aktion zumindest
//     Teilinformation ueber die UNMITTELBAR naechste Position (der Cursor
//     rueckt nach jeder Aktion um genau 1 vor) -- die EV interpoliert linear
//     zwischen der Blind-EV (Praezision 0) und der Perfekt-Info-EV
//     (Praezision = maxPrecision, Zustand de facto bekannt -> Attendant
//     waehlt immer die konternde Aktion, garantierter Grosser Gewinn),
//     gewichtet mit dem Anteil der genutzten Praezisions-Stufen.
// Das ist eine bewusste, dokumentierte Vereinfachung (keine Monte-Carlo-
// Simulation, kein exaktes kombinatorisches Modell der Kandidatenmengen) --
// beide Endpunkte sind exakt, die Interpolation dazwischen ist monoton
// steigend in der Praezision (mehr Praezision = strikt bessere erwartete
// Auszahlung), was dem Spieler-Mentalmodell entspricht.
export function getAttendantExpectedValuePerAction(
    actions: readonly CyclicActionDef[],
    stationary: Record<string, number>,
    attendantLookahead: number,
    attendantPrecision: number,
    maxPrecision: number,
): number {
    if (actions.length === 0) {
        throw new RangeError('getAttendantExpectedValuePerAction: actions darf nicht leer sein');
    }

    const blindAction = actions[0];
    const pWin = stationary[blindAction.counterState] ?? 0;
    const pLoss = stationary[blindAction.losesToState] ?? 0;
    const pNeutral = Math.max(0, 1 - pWin - pLoss);
    const blindEv = pWin * mean(blindAction.payoutBig) + pLoss * mean(blindAction.payoutLoss) + pNeutral * mean(blindAction.payoutSimple);

    if (attendantLookahead <= 0) {
        return blindEv;
    }

    // Perfekt-Info-EV: bei bekanntem Zustand waehlt der Attendant immer die
    // dort konternde Aktion -> garantierter Grosser Gewinn, gewichtet mit der
    // stationaeren Wahrscheinlichkeit des jeweiligen Zustands (counterState
    // ist pro Automat eine Bijektion Zustand<->Aktion, siehe buildCyclicActions).
    const perfectInfoEv = actions.reduce((sum, action) => sum + (stationary[action.counterState] ?? 0) * mean(action.payoutBig), 0);

    const precisionFraction = maxPrecision > 0 ? clamp01(attendantPrecision / maxPrecision) : 0;
    return blindEv + precisionFraction * (perfectInfoEv - blindEv);
}

export interface AttendantRate {
    machinePointsPerSecond: number;
    hallTicketsPerSecond: number;
}

// Vollstaendige Ertragsrate EINES Automaten -- kombiniert EV/Aktion mit
// Effizienz und Aktionen/Sekunde. `ticketYieldFactor`/`ticketYieldRate`
// werden NICHT hier verrechnet (Data-Layer-Werte, siehe machines.config.ts::
// getMachineAttendantRate) -- diese Funktion bleibt reine Engine-Mathematik.
export function getAttendantMachinePointsRate(
    actions: readonly CyclicActionDef[],
    stationary: Record<string, number>,
    knowledge: number,
    previewDepth: number,
    previewPrecision: number,
    maxPrecision: number,
): number {
    const lookahead = getAttendantLookahead(previewDepth, knowledge);
    const precision = getAttendantPrecision(previewPrecision, knowledge);
    const evPerAction = getAttendantExpectedValuePerAction(actions, stationary, lookahead, precision, maxPrecision);
    const efficiency = getAttendantEfficiency(knowledge);
    return Math.max(0, evPerAction) * efficiency * ATTENDANT_ACTIONS_PER_SECOND;
}

// --- Grid-Automaten-Ertragsrate (Phase 7f, game-spec.md 4.2, STATUS.md ---
// Phase 7f Punkt 10) -----------------------------------------------------
//
// Das Rate-Modell oben (computeStationaryDistribution/
// getAttendantExpectedValuePerAction/getAttendantMachinePointsRate) setzt
// ein zyklisches Markov-Pattern voraus, das der neue 5x5-Sektorenfeld-
// Automat ("Greed Run") nicht mehr hat -- er nutzt PatternEngine/
// CyclicActionDef nicht mehr (siehe GridRunEngine.ts). Game-spec.md 4.2
// erlaubt dafuer ausdruecklich eine GROB VEREINFACHTE Platzhalter-Schaetzung
// OHNE echte Pfadplanung und OHNE Beruecksichtigung der Sichtweite -- bewusst
// dieselbe Interpolations-IDEE wie oben (linear zwischen Blind-EV und
// Perfekt-Info-EV, gewichtet mit dem Anteil genutzter Praezisions-Stufen),
// nur mit einer KATEGORIEN- statt ZUSTANDS-basierten Perfekt-Info-Definition:
// bei vollstaendiger Kenntnis weicht der Attendant jedem bekannten
// Geist-Sektor aus, die uebrigen drei Kategorien werden proportional zu
// ihrem urspruenglichen Anteil unter den NICHT-Geist-Sektoren neu gewichtet
// (keine echte "geht dorthin, wo der naechste Bonus liegt"-Planung).

const NON_GHOST_CATEGORIES: readonly Exclude<SectorCategory, 'ghost'>[] = ['points', 'empty', 'bonus'];

export function getGridPerfectInfoExpectedValue(config: GridSectorConfig): number {
    const totalNonStart = config.gridSize * config.gridSize - 1;
    const ghostWeight = (config.categoryCounts.ghost ?? 0) / totalNonStart;
    const nonGhostWeight = 1 - ghostWeight;
    if (nonGhostWeight <= 0) {
        return 0;
    }
    return NON_GHOST_CATEGORIES.reduce((sum, category) => {
        const weight = (config.categoryCounts[category] ?? 0) / totalNonStart / nonGhostWeight;
        return sum + weight * mean(config.payoutRanges[category]);
    }, 0);
}

export function getGridAttendantExpectedValuePerMove(
    config: GridSectorConfig,
    attendantPrecision: number,
    maxPrecision: number,
): number {
    const blindEv = computeBlindExpectedValue(config);
    const perfectInfoEv = getGridPerfectInfoExpectedValue(config);
    const precisionFraction = maxPrecision > 0 ? clamp01(attendantPrecision / maxPrecision) : 0;
    return blindEv + precisionFraction * (perfectInfoEv - blindEv);
}

// Vollstaendige Ertragsrate des Grid-Automaten -- Komposition wie
// getAttendantMachinePointsRate oben (Praezision skaliert mit Musterkenntnis
// via getAttendantPrecision, dann Effizienz + Aktionen/Sekunde), aber ohne
// Lookahead-Faktor (keine feste Sequenz, an der eine Sichtweite haengen
// koennte -- siehe Datei-Kommentar).
export function getGridAttendantMachinePointsRate(
    config: GridSectorConfig,
    knowledge: number,
    previewPrecision: number,
    maxPrecision: number,
): number {
    const precision = getAttendantPrecision(previewPrecision, knowledge);
    const evPerMove = getGridAttendantExpectedValuePerMove(config, precision, maxPrecision);
    const efficiency = getAttendantEfficiency(knowledge);
    return Math.max(0, evPerMove) * efficiency * ATTENDANT_ACTIONS_PER_SECOND;
}

// --- Trap-Tunnels-Automaten-Ertragsrate (Phase 7i, game-spec.md 4.3, --------
// STATUS.md Phase 7i Punkt 5; Phase 7j Kernmodell-Ersatz passt die Formeln an
// enemyCount/dynamiteCount als Laufzeit-Parameter statt einer Vorschau-
// Reichweite an) ------------------------------------------------------------
//
// Wie beim Grid-Automaten oben passt weder das zyklische Markov-Modell noch
// die kategorien-basierte Naeherung -- Trap Tunnels hat weder Pattern-
// Zustaende noch Sektor-Kategorien, sondern ein zufaellig generiertes
// Tunnelnetz mit live gewuerfelter Gegnerbewegung (siehe TrapTunnelsEngine.ts).
// Game-spec.md 4.3 "Attendant-Automatisierung" erlaubt ausdruecklich eine
// GROB VEREINFACHTE Platzhalter-Schaetzung OHNE echte Pfad-/Dynamit-
// Optimierung.
//
// Bewusst KEINE Wiederverwendung von TrapTunnelsEngine.computeBlindTrapExpected
// Value hier: diese Funktion simuliert viele komplette Netz-/Bewegungs-Runs
// per Monte-Carlo (das ist ein TEST-Werkzeug fuer die Blind-EV-GARANTIE, siehe
// TrapTunnelsEngine.test.ts) -- fuer einen bei jedem Tick aufgerufenen
// Ertragsraten-Pfad waere das viel zu teuer. Stattdessen eine geschlossene
// Naeherung: jede der (enemyCount * (pathLength+1)) Gegner-Positionen ueber
// den gesamten Run gilt als unabhaengig GLEICHVERTEILT unter den
// gridSize*gridSize Kreuzungen (grobe Annahme, ignoriert die tatsaechliche
// Graph-/Bewegungsstruktur) -- daraus ergeben sich Treffer-/Kettenwahrschein-
// lichkeit einer EINZELNEN blind platzierten Falle in geschlossener Form.
// `enemyCount` ist seit Phase 7j ein separater Parameter (Upgrade-Laufzeitwert,
// kein Config-Feld mehr).
function trapHitProbability(run: TrapTunnelsRunConfig, enemyCount: number): number {
    const positionsPerEnemy = run.pathLength + 1;
    const totalPositions = enemyCount * positionsPerEnemy;
    const junctionCount = run.gridSize * run.gridSize;
    return 1 - (1 - 1 / junctionCount) ** totalPositions;
}

// Naeherung fuer eine Kettenreaktion: zwei Gegner muessen im SELBEN Schritt
// auf derselben Falle stehen -- ueber alle (pathLength+1) Schritte gemittelt.
// Bei enemyCount < 2 strukturell 0 (keine Kettenreaktion ohne einen zweiten
// Gegner moeglich).
function trapChainProbability(run: TrapTunnelsRunConfig, enemyCount: number): number {
    if (enemyCount < 2) return 0;
    const positionsPerEnemy = run.pathLength + 1;
    const junctionCount = run.gridSize * run.gridSize;
    return positionsPerEnemy * (1 / junctionCount) * (1 / junctionCount);
}

// Blind-EV EINER platzierten Falle (Naeherung, siehe Datei-Kommentar oben,
// OHNE Dynamit-Einsatz) -- die Kettenwahrscheinlichkeit wird von der Gesamt-
// Trefferwahrscheinlichkeit abgezogen, damit ein Kettentreffer nicht
// gleichzeitig als Einzelfang UND als Kette gezaehlt wird.
export function getTrapTunnelsBlindExpectedValuePerTrap(run: TrapTunnelsRunConfig, enemyCount: number): number {
    const chainProbability = trapChainProbability(run, enemyCount);
    const singleProbability = Math.max(0, trapHitProbability(run, enemyCount) - chainProbability);
    return singleProbability * mean(run.singleCatchPayoutRange) + chainProbability * mean(run.chainCatchPayoutRange);
}

// Perfekt-Info-EV (Naeherung, OHNE echte Netzwerk-/Kettenoptimierung, wie in
// game-spec.md 4.3 gefordert): mit vollstaendig ausgenutztem Dynamit kann der
// Attendant Gegner effektiv auf eine Falle zwingen -> ein garantierter
// Einzelfang pro Falle. Keine Chain-Optimierung (das erfordert echtes
// Koordinieren mehrerer Gegner-Bewegungen, explizit ausserhalb der
// dokumentierten Vereinfachung).
function getTrapTunnelsPerfectInfoExpectedValuePerTrap(run: TrapTunnelsRunConfig): number {
    return mean(run.singleCatchPayoutRange);
}

// EV/Falle, linear interpoliert zwischen Blind-EV und Perfekt-Info-EV,
// gewichtet mit dem Anteil des vom Attendant tatsaechlich genutzten Dynamit-
// Kontingents (Phase 7j: ersetzt die bisherige Vorschau-Reichweiten-
// Gewichtung -- es gibt keine Vorschau-Achse mehr, game-spec.md 4.3 "Keine
// Vorschau-Mechanik"). Dieselbe Interpolations-IDEE wie
// getAttendantExpectedValuePerAction/getGridAttendantExpectedValuePerMove
// oben, nur mit einer netzwerk-/dynamit-basierten Blind-/Perfekt-Info-
// Definition -- weiterhin eine bewusst dokumentierte Vereinfachung ohne
// echte Pfad-/Netzwerk-Optimierung.
export function getTrapTunnelsAttendantExpectedValuePerTrap(
    run: TrapTunnelsRunConfig,
    enemyCount: number,
    attendantDynamiteCount: number,
    maxDynamiteCount: number,
): number {
    const blindEv = getTrapTunnelsBlindExpectedValuePerTrap(run, enemyCount);
    const perfectInfoEv = getTrapTunnelsPerfectInfoExpectedValuePerTrap(run);
    const controlFraction = maxDynamiteCount > 0 ? clamp01(attendantDynamiteCount / maxDynamiteCount) : 0;
    return blindEv + controlFraction * (perfectInfoEv - blindEv);
}

// Vollstaendige Ertragsrate des Trap-Tunnels-Automaten -- Komposition wie
// getGridAttendantMachinePointsRate oben: nutzbares Dynamit-Kontingent
// skaliert mit Musterkenntnis (getAttendantLookahead, wiederverwendet statt
// dupliziert -- derselbe "wie viel von der eigenen Kapazitaet nutzt der
// Attendant tatsaechlich"-Mechanismus wie bei der Vorschau-Reichweite der
// anderen Automaten), EV/Falle * platzierte Fallenanzahl, dann Effizienz +
// Aktionen/Sekunde. EINE "Aktion" des Attendant entspricht hier einem
// kompletten Run (Dynamit-Einsatz + Platzierung + Ausfuehrung aller trapCount
// Fallen) -- game-spec.md 4.3 "Attendant-Automatisierung" fordert kein
// eigenes Zeitmodell dafuer.
export function getTrapTunnelsAttendantMachinePointsRate(
    run: TrapTunnelsRunConfig,
    knowledge: number,
    trapCount: number,
    enemyCount: number,
    dynamiteCount: number,
    maxDynamiteCount: number,
): number {
    const attendantDynamiteCount = getAttendantLookahead(dynamiteCount, knowledge);
    const evPerTrap = getTrapTunnelsAttendantExpectedValuePerTrap(run, enemyCount, attendantDynamiteCount, maxDynamiteCount);
    const efficiency = getAttendantEfficiency(knowledge);
    return Math.max(0, evPerTrap) * trapCount * efficiency * ATTENDANT_ACTIONS_PER_SECOND;
}

// --- Boost-Barrage-Automaten-Ertragsrate (Phase 7m, game-spec.md 4.4, ------
// "Attendant-Automatisierung": grob vereinfachte Platzhalter-Schaetzung, ----
// keine echte Timing-Simulation) ---------------------------------------------
//
// Wie bei Grid/Trap-Tunnels oben passt weder das zyklische Markov-Modell noch
// eine Netzwerk-Naeherung -- Boost Barrage hat weder Pattern-Zustaende noch
// ein Tunnelnetz, sondern eine pro Welle live aufgeloeste Gegner-Sequenz
// (siehe BoostBarrageEngine.ts). Dieselbe Interpolations-IDEE wie bei den
// anderen drei Automaten: linear zwischen einer Blind-EV (kein Boost-Einsatz)
// und einer Perfekt-Info-EV (voller, optimaler Boost-Einsatz auf jedes
// Gefecht), gewichtet mit dem vom Attendant tatsaechlich nutzbaren Anteil des
// Ladungs-Kontingents (skaliert mit Musterkenntnis, getAttendantLookahead
// wiederverwendet -- derselbe Mechanismus wie bei Trap Tunnels' Dynamit-
// Kontingent). Bewusst OHNE Eskalations-Modellierung und OHNE echtes
// Timing/Ladungsmanagement -- geschlossene Naeherung statt Monte-Carlo-
// Simulation (die waere fuer einen bei jedem Tick aufgerufenen Ertragsraten-
// Pfad zu teuer, siehe computeBlindWaveExpectedValue-Kommentar in
// BoostBarrageEngine.ts, dort bewusst nur als TEST-Werkzeug fuer die
// Blind-EV-GARANTIE gedacht).
function boostBarrageEnemyShares(run: BoostBarrageRunConfig): { scout: number; bomber: number; elite: number } {
    const { scout, bomber, elite } = run.enemyWeights;
    const total = scout + bomber + elite;
    if (total <= 0) return { scout: 0, bomber: 0, elite: 0 };
    return { scout: scout / total, bomber: bomber / total, elite: elite / total };
}

// Blind-EV/Gefecht OHNE Boost-Einsatz und OHNE Eskalation (grobe Naeherung,
// anders als die Monte-Carlo-Simulation in BoostBarrageEngine.ts).
export function getBoostBarrageBlindExpectedValuePerEncounter(run: BoostBarrageRunConfig): number {
    const shares = boostBarrageEnemyShares(run);
    const scoutEv = mean(run.scoutPayoutRange);
    const bomberEv =
        run.baseBomberDestroyChance * mean(run.bomberDestroyPayoutRange) -
        (1 - run.baseBomberDestroyChance) * mean(run.bomberHitCostRange);
    const eliteEv = run.baseEliteHitChance * mean(run.elitePayoutRange);
    return shares.scout * scoutEv + shares.bomber * bomberEv + shares.elite * eliteEv;
}

// Perfekt-Info-Naeherung: voller Boost-Einsatz auf jedes Gefecht -- Bomber
// wird IMMER vor dem Feuern zerstoert (destroyChance faktisch 1), Elite wird
// IMMER per Fokus getroffen (hitChance 1, mit Fokus-Bonus), Scout profitiert
// vom Feuerkraft-Bonus. OHNE echtes Ladungs-/Timing-Management (game-spec.md
// 4.4 "Attendant-Automatisierung" fordert explizit keine echte Simulation).
function getBoostBarragePerfectInfoExpectedValuePerEncounter(run: BoostBarrageRunConfig, boostPowerLevel: number): number {
    const shares = boostBarrageEnemyShares(run);
    const scoutEv = mean(run.scoutPayoutRange) + run.firepowerScoutBonusPerLevel * boostPowerLevel;
    const bomberEv = mean(run.bomberDestroyPayoutRange);
    const eliteEv = mean(run.elitePayoutRange) * (1 + run.focusHitBonusPerLevel * boostPowerLevel);
    return shares.scout * scoutEv + shares.bomber * bomberEv + shares.elite * eliteEv;
}

// EV/Gefecht, linear interpoliert zwischen Blind-EV und Perfekt-Info-EV,
// gewichtet mit dem vom Attendant nutzbaren Anteil des Ladungs-Kontingents
// (Musterkenntnis-skaliert, analog zu getTrapTunnelsAttendantExpectedValuePerTrap).
export function getBoostBarrageAttendantExpectedValuePerEncounter(
    run: BoostBarrageRunConfig,
    boostPowerLevel: number,
    attendantCharges: number,
    maxCharges: number,
): number {
    const blindEv = getBoostBarrageBlindExpectedValuePerEncounter(run);
    const perfectInfoEv = getBoostBarragePerfectInfoExpectedValuePerEncounter(run, boostPowerLevel);
    const controlFraction = maxCharges > 0 ? clamp01(attendantCharges / maxCharges) : 0;
    return blindEv + controlFraction * (perfectInfoEv - blindEv);
}

// Vollstaendige Ertragsrate des Boost-Barrage-Automaten -- Komposition wie
// getTrapTunnelsAttendantMachinePointsRate oben: nutzbares Ladungs-
// Kontingent skaliert mit Musterkenntnis (getAttendantLookahead
// wiederverwendet), EV/Gefecht, dann Effizienz + Aktionen/Sekunde. EINE
// "Aktion" des Attendant entspricht hier einem einzelnen Gefecht (game-spec.md
// 4.4 fordert kein eigenes Zeitmodell dafuer -- die reale Vorwarnzeit ist
// ohnehin reine UI-Timing-Groesse, siehe BoostBarrageEngine.ts).
export function getBoostBarrageAttendantMachinePointsRate(
    run: BoostBarrageRunConfig,
    knowledge: number,
    boostPowerLevel: number,
    maxCharges: number,
): number {
    const attendantCharges = getAttendantLookahead(maxCharges, knowledge);
    const evPerEncounter = getBoostBarrageAttendantExpectedValuePerEncounter(run, boostPowerLevel, attendantCharges, maxCharges);
    const efficiency = getAttendantEfficiency(knowledge);
    return Math.max(0, evPerEncounter) * efficiency * ATTENDANT_ACTIONS_PER_SECOND;
}

// --- Pool-Dynamik (Vordergrund-Optik) + Offline-Anwendung -----------------

export function createInitialAttendantPool(): AttendantPoolState {
    return { machinePoints: 0, hallTickets: 0, msSincePayout: 0 };
}

export interface AttendantElapsedResult {
    pool: AttendantPoolState;
    machinePointsGained: number;
    hallTicketsGained: number;
}

export interface ApplyAttendantElapsedOptions {
    cycleMs?: number;
    foregroundThresholdMs?: number;
    rng?: () => number;
}

// Wendet eine Ertragsrate ueber eine verstrichene Echtzeitspanne an (STATUS.md
// Teil 2). Zwei Pfade, je nach Groesse von `elapsedMs`:
//
// - GROSSE Luecke (> foregroundThresholdMs, z. B. Tab war geschlossen/im
//   Hintergrund gedrosselt): Rate * verstrichene Zeit wird DIREKT auf die
//   echte Waehrung angewendet, der Pool bleibt UNVERAENDERT (STATUS.md: "Fuer
//   Offline-Berechnung NICHT den Pool-Mechanismus mit vielen Einzelzyklen
//   durchrechnen"). Sobald der Spieler wieder da ist, setzt der Pool-Pfad
//   exakt dort fort, wo er vor der Luecke stand.
// - KLEINE Luecke (normaler fortlaufender Vordergrund-Tick): die Rate fliesst
//   in den Pool, bei ueberschrittener Zyklusdauer (ggf. mehrfach, falls ein
//   einzelner Aufruf mehrere Zyklen ueberspannt) wird mit einem zufaelligen
//   Faktor 0.8-1.2 ausgeschuettet. Die Abweichung vom Faktor 1 bleibt im Pool
//   (auch negativ moeglich -- naechste Ausschuettung wird dann kleiner) --
//   Ausschuettung selbst nie negativ (bei 0 gekappt).
export function applyAttendantElapsed(
    pool: AttendantPoolState,
    rate: AttendantRate,
    elapsedMs: number,
    options: ApplyAttendantElapsedOptions = {},
): AttendantElapsedResult {
    const cycleMs = options.cycleMs ?? ATTENDANT_POOL_CYCLE_MS;
    const foregroundThresholdMs = options.foregroundThresholdMs ?? FOREGROUND_TICK_THRESHOLD_MS;
    const rng = options.rng ?? Math.random;
    const clampedElapsedMs = Math.max(0, Math.min(elapsedMs, MAX_OFFLINE_MS));

    if (clampedElapsedMs > foregroundThresholdMs) {
        const seconds = clampedElapsedMs / 1000;
        return {
            pool,
            machinePointsGained: rate.machinePointsPerSecond * seconds,
            hallTicketsGained: rate.hallTicketsPerSecond * seconds,
        };
    }

    const seconds = clampedElapsedMs / 1000;
    let machinePointsPool = pool.machinePoints + rate.machinePointsPerSecond * seconds;
    let hallTicketsPool = pool.hallTickets + rate.hallTicketsPerSecond * seconds;
    let msSincePayout = pool.msSincePayout + clampedElapsedMs;

    let machinePointsGained = 0;
    let hallTicketsGained = 0;

    while (msSincePayout >= cycleMs) {
        const factor = ATTENDANT_POOL_FACTOR_MIN + rng() * (ATTENDANT_POOL_FACTOR_MAX - ATTENDANT_POOL_FACTOR_MIN);
        const pointsPayout = Math.max(0, machinePointsPool * factor);
        const ticketsPayout = Math.max(0, hallTicketsPool * factor);
        machinePointsPool -= pointsPayout;
        hallTicketsPool -= ticketsPayout;
        machinePointsGained += pointsPayout;
        hallTicketsGained += ticketsPayout;
        msSincePayout -= cycleMs;
    }

    return {
        pool: { machinePoints: machinePointsPool, hallTickets: hallTicketsPool, msSincePayout },
        machinePointsGained,
        hallTicketsGained,
    };
}

export function gainKnowledgeFromManualPlay(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + MANUAL_KNOWLEDGE_GAIN);
}

export function gainKnowledgeFromTraining(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + TRAINING_KNOWLEDGE_GAIN);
}
