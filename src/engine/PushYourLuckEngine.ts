import type { Milestone, RiskTier } from './types';

// Meilenstein-Schwellen, Banking-Option, Safe/Balanced/Risky-Payouts.
// Laut game-spec.md 4.1 (Meilenstein-Entscheidung) und Baukasten 1.12:
// Banking sichert den aktuellen Lauf, Weitermachen riskiert ihn komplett
// für die Chance auf mehr Ertrag. Kennt weder Phaser noch React.
//
// Ob safe/balanced/risky einen echten Trade-off ergeben (Baukasten 4,
// Punkt 5 der Prüf-Checkliste), entscheidet die konkrete RiskTier-Config
// pro Automat (machines.config.ts), nicht diese Engine.

export type RunStatus = 'active' | 'banked' | 'busted';

export interface ActionResult {
    success: boolean;
    payout: number;
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

    // Führt eine Aktion mit dem gewählten Risiko-Tier aus. Bei Fehlschlag
    // (Wahrscheinlichkeit tier.failureChance) verliert der Lauf den
    // kompletten Punktestand (Baukasten 1.12) - "safe" hat per Definition
    // failureChance 0 und kann daher nie scheitern. rng ist injizierbar für
    // deterministische Tests.
    resolveAction(tier: RiskTier, rng: () => number = Math.random): ActionResult {
        if (this.status !== 'active') {
            throw new Error(`PushYourLuckRun: Aktion nicht möglich, Lauf ist bereits "${this.status}"`);
        }

        const failed = rng() < tier.failureChance;
        if (failed) {
            this.status = 'busted';
            this.score = 0;
            return { success: false, payout: 0, scoreAfter: 0 };
        }

        const [min, max] = tier.payoutRange;
        const payout = min + rng() * (max - min);
        this.score += payout;
        return { success: true, payout, scoreAfter: this.score };
    }

    // Alle Meilensteine, deren Schwellenwert der aktuelle Punktestand
    // erreicht oder überschritten hat, aufsteigend sortiert.
    getReachedMilestones(): Milestone[] {
        return this.milestones.filter((m) => this.score >= m.threshold);
    }

    // Nächster noch nicht erreichter Meilenstein, oder undefined, wenn
    // bereits alle erreicht sind.
    getNextMilestone(): Milestone | undefined {
        return this.milestones.find((m) => this.score < m.threshold);
    }

    // Ob an der aktuellen Position gebankt werden darf: der Lauf muss aktiv
    // sein und mindestens ein erreichter Meilenstein muss bankable sein.
    canBank(): boolean {
        return this.status === 'active' && this.getReachedMilestones().some((m) => m.bankable);
    }

    // Sichert den aktuellen Punktestand und beendet den Lauf erfolgreich.
    // Wirft, wenn an der aktuellen Position nicht gebankt werden darf.
    bank(): number {
        if (!this.canBank()) {
            throw new Error('PushYourLuckRun: Banking an dieser Position nicht möglich');
        }
        this.status = 'banked';
        return this.score;
    }
}
