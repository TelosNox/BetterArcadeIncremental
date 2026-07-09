import type { CyclicActionDef, ResolvedAction } from './types';

// Attendant-Automatisierung (game-spec.md 3.2, Baukasten 1.3/1.9). Framework-
// unabhaengig, kennt weder Phaser noch React (Architektur-Kurzregel). Nutzt
// nur die reinen Typdefinitionen aus ./types (CyclicActionDef/ResolvedAction)
// -- NICHT die Aufloesungsfunktionen aus src/data/machines.config.ts, die
// bleiben Data-Layer (Architektur-Kurzregel: Engine importiert nie aus
// /src/data).
//
// Phase 7c (Kernmechanik-Revision v2, siehe STATUS.md) ersetzt das
// "harte Aktion vs. Zwischenstufe"-Auswahlmodell aus Phase 7b VOLLSTAENDIG,
// weil es diese Unterscheidung nicht mehr gibt (nur noch EIN zyklischer
// Aktionstyp, siehe CyclicActionDef). Der Attendant bleibt an ZWEI
// Stellschrauben gekoppelt, beide letztlich an die Musterkenntnis
// (0-1, EconomyStore.getAttendantKnowledge):
//   1. Effizienz (unveraendert gegenueber Phase 5/7b): der resultierende
//      Payout wird auf ATTENDANT_MAX_EFFICIENCY * knowledge geklemmt --
//      selbst bei perfekter Aktionswahl bleibt der Attendant spuerbar unter
//      der moeglichen Bestleistung (Richtwert 85-90%, game-spec.md 3.2).
//   2. Eigener Anteil an Tiefe UND Praezision: der Attendant nutzt von der
//      TATSAECHLICH gekauften Sichtweite (d) und Praezision (p) -- die
//      gelten fuer Spieler UND Attendant gleich, siehe
//      machines.config.ts::getPreviewDepth/getPreviewPrecision -- jeweils
//      nur einen mit der Musterkenntnis wachsenden Anteil. Bei Kenntnis 0
//      sieht er effektiv nichts voraus, bei voller Kenntnis nutzt er
//      Tiefe UND Praezision vollstaendig wie ein Spieler.
//
// Aktionswahl (STATUS.md, PM-Risikohinweise + Konkrete Umsetzung Punkt 4):
// kennt der Attendant den Zustand an einer Position EXAKT (seine eigene
// Praezision an dieser Tiefe reicht bis zur Eindeutigkeit -- genau 1
// verbleibender Kandidat), waehlt er IMMER die dort konternde Aktion
// (garantierter Grosser Gewinn). Kennt er ihn nur PARTIELL (mehrere, aber
// nicht alle Kandidaten uebrig), meidet er -- wo eindeutig bestimmbar --
// eine Aktion, deren Verlust-Zustand noch als Kandidat uebrig ist (bewusste
// Ermessensentscheidung, siehe STATUS.md: das ist eine einfache, aber
// wirksame Heuristik, die den Attendant nicht "raten" laesst, wo Information
// verfuegbar ist, ohne dass er dafuer die volle PatternEngine-Verteilung
// kennen muesste). Ist GAR keine Information verfuegbar (Position ausserhalb
// des eigenen Lookaheads, oder Praezision 0 an dieser Position), faellt er
// auf eine feste, einfache Wahl zurueck -- die Blind-EV-Garantie
// (machines.config.test.ts) stellt sicher, dass dabei keine Aktion klar
// benachteiligt ist.

export const ATTENDANT_MAX_EFFICIENCY = 0.875;

export const MANUAL_KNOWLEDGE_GAIN = 0.02;
export const TRAINING_KNOWLEDGE_GAIN = 0.01;

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
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

// Leitet aus einer bereits aufgeloesten ResolvedAction (siehe
// machines.config.ts::resolveMachineAction) die Version ab, mit der der
// Attendant tatsaechlich PushYourLuckEngine.resolveAction() aufruft: die
// gesamte Payout-Spanne wird auf die Effizienz skaliert (einheitlich, auch
// im Verlust-Fall -- ein Attendant, der vorausschauend spielt, vermeidet
// Verluste bereits durch seine Aktionswahl; eine zusaetzliche Sonderregel
// nur fuer negative Payouts wuerde hier unnoetige Komplexitaet fuer einen
// Randfall einfuehren, siehe CLAUDE.md).
export function getAttendantResolvedAction(resolved: ResolvedAction, knowledge: number): ResolvedAction {
    const efficiency = getAttendantEfficiency(knowledge);
    const [min, max] = resolved.payoutRange;
    return { id: resolved.id, payoutRange: [min * efficiency, max * efficiency] };
}

// Zentrale Attendant-Entscheidung fuer EINEN Schritt der geplanten Runde.
// `remainingCandidates` ist die Menge der an dieser Position noch moeglichen
// Pattern-Zustaende (nach Ausschluss durch die eigene Praezision, siehe
// machines.config.ts::getExcludedCandidates), oder `undefined`, wenn die
// Position ausserhalb des eigenen Lookaheads liegt (siehe
// getAttendantLookahead) -- der Aufrufer (MachineScene) entscheidet das
// anhand von stepIndex < eigener Lookahead.
//
// - Genau 1 verbleibender Kandidat (Zustand de facto bekannt): waehlt IMMER
//   die dort konternde Aktion (garantierter Grosser Gewinn).
// - Mehrere, aber nicht alle Kandidaten (partielle Information): meidet,
//   wo moeglich, jede Aktion, deren Verlust-Zustand noch ein Kandidat ist;
//   bevorzugt unter den verbleibenden "sicheren" Aktionen eine, deren
//   Gewinn-Zustand ebenfalls noch moeglich ist.
// - Keine Information (undefined, oder alle n Zustaende noch moeglich):
//   feste Fallback-Wahl (erste Aktion) -- die Blind-EV-Garantie stellt
//   sicher, dass dabei keine Aktion klar benachteiligt ist.
export function chooseAttendantAction(
    actions: readonly CyclicActionDef[],
    remainingCandidates: readonly string[] | undefined,
): CyclicActionDef {
    if (actions.length === 0) {
        throw new RangeError('chooseAttendantAction: actions darf nicht leer sein');
    }

    if (remainingCandidates !== undefined && remainingCandidates.length === 1) {
        const knownState = remainingCandidates[0];
        const winningAction = actions.find((action) => action.counterState === knownState);
        if (winningAction) {
            return winningAction;
        }
    }

    if (remainingCandidates !== undefined && remainingCandidates.length < actions.length) {
        const safeActions = actions.filter((action) => !remainingCandidates.includes(action.losesToState));
        if (safeActions.length > 0) {
            const safeAndWinning = safeActions.find((action) => remainingCandidates.includes(action.counterState));
            return safeAndWinning ?? safeActions[0];
        }
    }

    return actions[0];
}

export function gainKnowledgeFromManualPlay(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + MANUAL_KNOWLEDGE_GAIN);
}

export function gainKnowledgeFromTraining(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + TRAINING_KNOWLEDGE_GAIN);
}
