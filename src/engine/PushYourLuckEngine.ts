import type { Milestone, ResolvedAction } from './types';

// Meilenstein-Schwellen, Banking-Option, Erfolg/Fehlschlag-Aufloesung.
// Laut game-spec.md 4.1 (Meilenstein-Entscheidung) und Baukasten 1.12:
// Banking sichert den aktuellen Lauf, Weitermachen riskiert einen Teil davon
// fuer die Chance auf mehr Ertrag. Kennt weder Phaser noch React, noch die
// Unterscheidung "harte Aktion"/"Zwischenstufe" oder Pattern-Zustaende --
// resolveAction() bekommt bereits eine fertig aufgeloeste ResolvedAction
// (siehe machines.config.ts::resolveMachineAction).
//
// Ob die Aktionen eines Automaten einen echten Trade-off ergeben (Baukasten
// 4, Punkt 5 der Pruef-Checkliste), entscheidet die konkrete Config pro
// Automat (machines.config.ts), nicht diese Engine.
//
// Phase 7b (Kernmechanik-Revision, siehe STATUS.md): Das fruehere harte
// Run-Ende bei Fehlschlag ("busted", Score auf 0, Lauf vorbei) entfaellt
// bewusst. Ein Fehlschlag ist jetzt eine TEILSTRAFE -- ein Teil (Richtwert
// 30-50%, FAILURE_PENALTY_FRACTION) des aktuellen, ungebankten Punktestands
// geht verloren, der Lauf bleibt 'active' und laeuft weiter. `RunStatus`
// kennt daher kein 'busted' mehr, nur noch 'active' | 'banked'.

export type RunStatus = 'active' | 'banked';

// Anteil des aktuellen Punktestands, der bei einem Fehlschlag verloren geht
// (Richtwert 30-50%, STATUS.md Phase 7b). Als optionaler Parameter von
// resolveAction() ueberschreibbar (wie schon `sensitivity` bei
// machines.config.ts::getEffectiveFailureChance), damit die Zahl iterativ
// tunbar bleibt, ohne die Aufrufstellen anzufassen.
export const FAILURE_PENALTY_FRACTION = 0.4;

export interface ActionResult {
    success: boolean;
    payout: number; // > 0 bei Erfolg, sonst 0
    penalty: number; // > 0 bei Fehlschlag, sonst 0
    scoreAfter: number;
}

function validateMilestones(milestones: Milestone[]): void {
    if (milestones.length === 0) {
        throw new RangeError('PushYourLuckEngine: milestones darf nicht leer sein');
    }
    for (const milestone of milestones) {
        if (milestone.threshold < 0) {
            throw new RangeError(
                `PushYourLuckEngine: negativer Meilenstein-Schwellenwert (${milestone.threshold})`,
            );
        }
    }
}

export class PushYourLuckRun {
    private readonly milestones: Milestone[];
    private score = 0;
    // Hoechster je in diesem Lauf erreichter Punktestand -- steigt NIE durch
    // eine Teilstrafe. Meilenstein-Erreichung/Banking-Berechtigung bleibt
    // dadurch bewusst "sticky": ein einmal erreichter (bankbarer) Meilenstein
    // geht nicht verloren, nur weil ein spaeterer Fehlschlag den aktuellen
    // Punktestand druecken. Sonst wuerde die Teilstrafe die eigentliche
    // Absicht der Revision (Fehlschlag als Rueckschlag, nicht als Bestrafung
    // fuer bereits Erreichtes) unterlaufen -- ein Spieler, der Meilenstein 20
    // erreicht hat und danach einen Fehlschlag kassiert, soll trotzdem noch
    // sichern koennen. `bank()` sichert weiterhin den TATSAECHLICHEN
    // aktuellen Punktestand, nicht den Peak.
    private peakScore = 0;
    private status: RunStatus = 'active';

    constructor(milestones: Milestone[]) {
        validateMilestones(milestones);
        this.milestones = [...milestones].sort((a, b) => a.threshold - b.threshold);
    }

    getScore(): number {
        return this.score;
    }

    getStatus(): RunStatus {
        return this.status;
    }

    // Fuehrt eine bereits aufgeloeste Aktion aus (siehe ResolvedAction).
    // Bei Fehlschlag (Wahrscheinlichkeit tier.failureChance) verliert der
    // Lauf `penaltyFraction` des AKTUELLEN Punktestands, bleibt aber
    // 'active' (Phase 7b, siehe Klassenkommentar oben) -- "failureChance 0"
    // kann daher nie scheitern, "failureChance 1" (harte Aktion an ihrem
    // exakten Gegenstueck-Zustand) scheitert garantiert. rng ist injizierbar
    // fuer deterministische Tests.
    resolveAction(
        tier: ResolvedAction,
        rng: () => number = Math.random,
        penaltyFraction: number = FAILURE_PENALTY_FRACTION,
    ): ActionResult {
        if (this.status !== 'active') {
            throw new Error(`PushYourLuckRun: Aktion nicht möglich, Lauf ist bereits "${this.status}"`);
        }

        const failed = rng() < tier.failureChance;
        if (failed) {
            const penalty = this.score * penaltyFraction;
            this.score -= penalty;
            return { success: false, payout: 0, penalty, scoreAfter: this.score };
        }

        const [min, max] = tier.payoutRange;
        const payout = min + rng() * (max - min);
        this.score += payout;
        this.peakScore = Math.max(this.peakScore, this.score);
        return { success: true, payout, penalty: 0, scoreAfter: this.score };
    }

    // Alle Meilensteine, deren Schwellenwert der Lauf JE ERREICHT hat
    // (peakScore, siehe Klassenkommentar -- sticky trotz spaeterer
    // Teilstrafen), aufsteigend sortiert.
    getReachedMilestones(): Milestone[] {
        return this.milestones.filter((m) => this.peakScore >= m.threshold);
    }

    // Naechster noch nicht erreichter Meilenstein (bezogen auf peakScore),
    // oder undefined, wenn bereits alle erreicht sind.
    getNextMilestone(): Milestone | undefined {
        return this.milestones.find((m) => this.peakScore < m.threshold);
    }

    // Ob an der aktuellen Position gebankt werden darf: der Lauf muss aktiv
    // sein und mindestens ein je erreichter Meilenstein muss bankable sein.
    canBank(): boolean {
        return this.status === 'active' && this.getReachedMilestones().some((m) => m.bankable);
    }

    // Sichert den aktuellen (nicht den Peak-)Punktestand und beendet den
    // Lauf erfolgreich. Wirft, wenn an der aktuellen Position nicht gebankt
    // werden darf.
    bank(): number {
        if (!this.canBank()) {
            throw new Error('PushYourLuckRun: Banking an dieser Position nicht möglich');
        }
        this.status = 'banked';
        return this.score;
    }
}
