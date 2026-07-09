import type { HardActionDef, IntermediateActionDef, MachineAction, ResolvedAction } from './types';

// Attendant-Automatisierung (game-spec.md 3.2, Baukasten 1.3/1.9). Framework-
// unabhaengig, kennt weder Phaser noch React (Architektur-Kurzregel). Nutzt
// nur die reinen Typdefinitionen aus ./types (HardActionDef/
// IntermediateActionDef/MachineAction/ResolvedAction) -- NICHT die
// Aufloesungsfunktion `resolveMachineAction` aus src/data/machines.config.ts,
// die bleibt Data-Layer (Architektur-Kurzregel: Engine importiert nie aus
// /src/data).
//
// Phase 7b (Kernmechanik-Revision, siehe STATUS.md) hat das alte generische
// RiskTier/safe-balanced-risky-Modell durch zwei Aktions-Rollen ersetzt.
// Der Attendant braucht daher ein neues Auswahlmodell, an ZWEI
// Stellschrauben gekoppelt, beide letztlich an die Musterkenntnis
// (0-1, EconomyStore.getAttendantKnowledge):
//   1. Effizienz (unveraendert gegenueber Phase 5): Payout eines
//      erfolgreichen Zugs wird auf ATTENDANT_MAX_EFFICIENCY * knowledge
//      geklemmt -- selbst bei perfekter Aktionswahl bleibt der Attendant
//      spuerbar unter der moeglichen Bestleistung (Richtwert 85-90%,
//      game-spec.md 3.2). Aktives Spielen bleibt dadurch immer ueberlegen
//      (Baukasten 1.3).
//   2. Eigener Lookahead in die feste Zug-Sequenz: der Attendant nutzt vom
//      SICHTBAREN Fenster (das haengt an automaten-internen Upgrades und
//      gilt fuer Spieler UND Attendant gleich, siehe
//      machines.config.ts::getVisibleMoveCount) nur einen mit der
//      Musterkenntnis wachsenden Anteil -- bei Kenntnis 0 sieht er
//      effektiv nichts voraus (faellt auf Zwischenstufen zurueck), bei
//      voller Kenntnis nutzt er das komplette sichtbare Fenster wie ein
//      Spieler.
//
// Harte Aktionen werden NUR gewaehlt, wenn der Attendant den an dieser
// Position feststehenden Musterzustand ueber seinen eigenen Lookahead
// bereits kennt -- er waehlt dann IMMER die (per Konstruktion garantiert
// existierende, siehe machines.config.test.ts) harte Aktion, die an diesem
// Zustand nicht scheitert. Ausserhalb des eigenen Lookaheads faellt er auf
// eine Zwischenstufe zurueck (chooseAttendantIntermediateTier) -- er rät nie
// blind auf eine harte Aktion.

export const ATTENDANT_MAX_EFFICIENCY = 0.875;

export const MANUAL_KNOWLEDGE_GAIN = 0.02;
export const TRAINING_KNOWLEDGE_GAIN = 0.01;

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function meanPayout(range: readonly [number, number]): number {
    return (range[0] + range[1]) / 2;
}

// Anteil der menschenmoeglichen Leistung, den der Attendant bei gegebener
// Musterkenntnis erreicht (0 bei knowledge 0, ATTENDANT_MAX_EFFICIENCY bei
// knowledge 1).
export function getAttendantEfficiency(knowledge: number): number {
    return ATTENDANT_MAX_EFFICIENCY * clamp01(knowledge);
}

// Wie viele der TATSAECHLICH sichtbaren, festen Zuege (visibleMoveCount,
// automaten-weit gleich fuer Spieler und Attendant) der Attendant nutzen
// kann -- 0 bei Musterkenntnis 0 (komplett blind), das volle sichtbare
// Fenster bei voller Musterkenntnis (wie ein Spieler).
export function getAttendantLookahead(visibleMoveCount: number, knowledge: number): number {
    return Math.floor(visibleMoveCount * clamp01(knowledge));
}

// Leitet aus einer bereits aufgeloesten ResolvedAction (siehe
// machines.config.ts::resolveMachineAction) die Version ab, mit der der
// Attendant tatsaechlich PushYourLuckEngine.resolveAction() aufruft: nur der
// Payout wird auf die Effizienz skaliert, die failureChance bleibt
// unveraendert (sowohl fuer harte Aktionen -- die der Attendant ohnehin nur
// bei garantiertem Erfolg waehlt, siehe chooseAttendantAction -- als auch
// fuer Zwischenstufen, deren Fangchance definitionsgemaess unabhaengig
// davon ist, wer spielt).
export function getAttendantResolvedAction(resolved: ResolvedAction, knowledge: number): ResolvedAction {
    const efficiency = getAttendantEfficiency(knowledge);
    return {
        id: resolved.id,
        payoutRange: [resolved.payoutRange[0] * efficiency, resolved.payoutRange[1] * efficiency],
        failureChance: resolved.failureChance,
    };
}

// Waehlt aus den Zwischenstufen (aufsteigend sortiert angenommen: sicher ->
// riskant, wie schon in Phase 5) eine passend zur Musterkenntnis -- bei
// Kenntnis 0 die sicherste, bei Kenntnis nahe 1 die riskanteste. Faellt der
// Attendant ausserhalb seines eigenen Lookaheads auf eine Aktion zurueck,
// landet er hier (siehe chooseAttendantAction).
export function chooseAttendantIntermediateTier(
    tiers: readonly IntermediateActionDef[],
    knowledge: number,
): IntermediateActionDef {
    if (tiers.length === 0) {
        throw new RangeError('chooseAttendantIntermediateTier: tiers darf nicht leer sein');
    }
    const index = Math.min(tiers.length - 1, Math.floor(clamp01(knowledge) * tiers.length));
    return tiers[index];
}

// Zentrale Attendant-Entscheidung fuer EINEN Schritt der geplanten Runde.
// `knownState` ist der an dieser Position bereits feststehende
// Musterzustand, WENN der Attendant so weit vorausschauen kann (siehe
// getAttendantLookahead) -- sonst `undefined` (der Aufrufer, MachineScene,
// entscheidet das anhand von stepIndex < eigener Lookahead).
//
// Ist der Zustand bekannt, waehlt der Attendant IMMER eine an diesem
// Zustand garantiert nicht scheiternde harte Aktion (bevorzugt die mit dem
// hoeheren Payout, falls -- wie am neutralen Zustand -- beide sicher sind).
// Ist der Zustand unbekannt, faellt er auf eine Zwischenstufe zurueck --
// er raet nie blind auf eine harte Aktion.
export function chooseAttendantAction(
    hardActions: readonly HardActionDef[],
    intermediateActions: readonly IntermediateActionDef[],
    knownState: string | undefined,
    knowledge: number,
): MachineAction {
    if (knownState !== undefined) {
        const safeHardActions = hardActions.filter((action) => action.counterState !== knownState);
        if (safeHardActions.length > 0) {
            return safeHardActions.reduce((best, action) =>
                meanPayout(action.payoutRange) > meanPayout(best.payoutRange) ? action : best,
            );
        }
    }
    return chooseAttendantIntermediateTier(intermediateActions, knowledge);
}

export function gainKnowledgeFromManualPlay(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + MANUAL_KNOWLEDGE_GAIN);
}

export function gainKnowledgeFromTraining(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + TRAINING_KNOWLEDGE_GAIN);
}
