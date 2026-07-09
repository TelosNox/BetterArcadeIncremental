import type { ResolvedAction } from './types';

// Phase 7e (Erkennbarkeit + Banking-Streichung, siehe STATUS.md): Banking
// entfaellt komplett, damit auch der gesamte Zweck von `PushYourLuckRun`
// (ephemerer Run mit Score/Peak/Bank/Milestone-Status). Da jede Aktion
// seit Phase 7d ohnehin sofort und dauerhaft im EconomyStore verbucht wird
// (EconomyStore.applyMachineScoreDelta), gibt es keinen "ungesicherten Lauf"
// mehr, den ein Run-Objekt verwalten muesste -- Meilenstein-Auswertung lebt
// jetzt in machines.config.ts (gegen den PERSISTENTEN Punktestand-Peak),
// Banking existiert nicht mehr.
//
// Was WEITERHIN gebraucht wird (bewusst NICHT als Klasse, siehe STATUS.md
// "falls die Klasse komplett ueberfluessig wird, entfernen, nicht kuenstlich
// am Leben halten"): das Ziehen EINES Zufallswerts aus einer (ggf.
// negativen) Payout-Spanne. Bleibt eine eigene, winzige Datei statt inline
// in MachineScene.ts, damit diese reine Zufalls-Mathematik weiterhin isoliert
// mit Vitest testbar bleibt (CLAUDE.md: "Neue Engine-Logik zuerst mit Vitest
// absichern") und die Engine/Scene-Trennung (Architektur-Kurzregel) bestehen
// bleibt. Kennt weder Pattern-Zustaende noch Gewinn/Verlust/Treffer-
// Unterscheidung -- diese Aufloesung passiert VOR dem Aufruf
// (machines.config.ts::resolveMachineAction).

// Zieht EINEN Wert gleichverteilt aus payoutRange (kann negativ sein, siehe
// CyclicActionDef.payoutLoss). rng ist injizierbar fuer deterministische Tests.
export function drawPayout(tier: ResolvedAction, rng: () => number = Math.random): number {
    const [min, max] = tier.payoutRange;
    return min + rng() * (max - min);
}
