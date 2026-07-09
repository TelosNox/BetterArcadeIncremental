import type { RiskTier } from './types';

// Attendant-Automatisierung (game-spec.md 3.2, Baukasten 1.3/1.9). Framework-
// unabhaengig, kennt weder Phaser noch React (Architektur-Kurzregel).
//
// Der Attendant nutzt EXAKT dieselbe Planungslogik wie ein Spieler --
// dieselben RiskTier/PatternEngine-Mechanismen, kein separater unerklaerter
// Zufallsfaktor (Baukasten 1.9/1.10). Zwei Stellschrauben, beide an den
// "Musterkenntnis"-Wert (0-1, siehe EconomyStore.getAttendantKnowledge)
// gekoppelt:
//   1. Effizienz: der Payout eines erfolgreichen Attendant-Zugs ist auf
//      ATTENDANT_MAX_EFFICIENCY * knowledge geklemmt -- selbst bei voller
//      Musterkenntnis bleibt der Attendant spuerbar unter der moeglichen
//      Bestleistung (Richtwert 85-90%, game-spec.md 3.2). Aktives Spielen
//      bleibt dadurch immer ueberlegen (Baukasten 1.3).
//   2. Zusaetzliches Risiko: bei niedriger Musterkenntnis schaetzt der
//      Attendant die Gefahr schlechter ein als noetig -- ein Aufschlag auf
//      die (musterzustandsabhaengige) failureChance, der mit wachsender
//      Musterkenntnis gegen 0 geht (bei voller Musterkenntnis entspricht
//      die Fangchance exakt der eines Spielers mit vollem Musterwissen).
//
// "safe" (failureChance 0) bleibt fuer den Attendant genauso risikofrei
// wie fuer einen Spieler -- dieselbe Invariante wie in
// machines.config.ts::getEffectiveFailureChance.

export const ATTENDANT_MAX_EFFICIENCY = 0.875;
export const ATTENDANT_MAX_KNOWLEDGE_GAP = 0.3;

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

// Effektive Fangchance des Attendant fuer eine Aktion: dieselbe (musterzu-
// standsabhaengige) Basis-Fangchance eines Spielers PLUS ein mit wachsender
// Musterkenntnis schrumpfender Aufschlag. "safe" (0) bleibt immer 0.
export function getAttendantFailureChance(patternEffectiveFailureChance: number, knowledge: number): number {
    if (patternEffectiveFailureChance <= 0) {
        return 0;
    }
    const gap = ATTENDANT_MAX_KNOWLEDGE_GAP * (1 - clamp01(knowledge));
    return Math.min(1, patternEffectiveFailureChance + gap);
}

// Leitet aus einer Basis-RiskTier + Musterzustands-Fangchance (siehe
// machines.config.ts::getEffectiveFailureChance) die RiskTier ab, mit der
// der Attendant tatsaechlich resolveAction() aufruft. PushYourLuckEngine
// selbst bleibt unveraendert -- wie schon beim Phase-3-Blocker-Fix wird nur
// eine abgeleitete Kopie der RiskTier uebergeben.
export function getAttendantTier(
    tier: RiskTier,
    knowledge: number,
    patternEffectiveFailureChance: number,
): RiskTier {
    const efficiency = getAttendantEfficiency(knowledge);
    return {
        id: tier.id,
        payoutRange: [tier.payoutRange[0] * efficiency, tier.payoutRange[1] * efficiency],
        failureChance: getAttendantFailureChance(patternEffectiveFailureChance, knowledge),
    };
}

// Einfache, deterministische Attendant-Strategie: waehlt aus den nach
// Risiko aufsteigend sortiert angenommenen `tiers` (Konvention wie
// pattern.states in machines.config.ts: sicher -> riskant) einen Tier
// passend zur Musterkenntnis -- bei knowledge 0 den sichersten, bei
// knowledge nahe 1 den riskantesten.
export function chooseAttendantTier(tiers: readonly RiskTier[], knowledge: number): RiskTier {
    if (tiers.length === 0) {
        throw new RangeError('chooseAttendantTier: tiers darf nicht leer sein');
    }
    const index = Math.min(tiers.length - 1, Math.floor(clamp01(knowledge) * tiers.length));
    return tiers[index];
}

export function gainKnowledgeFromManualPlay(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + MANUAL_KNOWLEDGE_GAIN);
}

export function gainKnowledgeFromTraining(currentKnowledge: number): number {
    return Math.min(1, clamp01(currentKnowledge) + TRAINING_KNOWLEDGE_GAIN);
}
