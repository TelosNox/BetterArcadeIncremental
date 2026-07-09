import type { Milestone, ResolvedAction } from './types';

// Meilenstein-Schwellen, Banking-Option, Punktestand-Fortschreibung. Laut
// game-spec.md 4.1 (Meilenstein-Entscheidung) und Baukasten 1.12: Banking
// sichert den aktuellen Lauf, Weitermachen riskiert einen Teil davon fuer
// die Chance auf mehr Ertrag. Kennt weder Phaser noch React, noch
// Pattern-Zustaende oder die zyklische Gewinn/Verlust/Treffer-Interpretation
// -- resolveAction() bekommt bereits eine fertig aufgeloeste ResolvedAction
// (siehe machines.config.ts::resolveMachineAction).
//
// Ob die Aktionen eines Automaten einen echten Trade-off ergeben (Baukasten
// 4, Punkt 5 der Pruef-Checkliste), entscheidet die konkrete Config pro
// Automat (machines.config.ts), nicht diese Engine.
//
// Phase 7c (Kernmechanik-Revision v2, siehe STATUS.md): das gesamte
// Erfolg/Fehlschlag-Konzept aus Phase 7b (failureChance-Bernoulli-Rolle +
// FAILURE_PENALTY_FRACTION-Teilstrafe vom AKTUELLEN Punktestand) entfaellt
// ECHT, nicht nur an der Oberflaeche: jede Aktion trifft garantiert, es wird
// nur noch EIN Wert aus einer (ggf. negativen) Payout-Spanne gezogen und auf
// den Punktestand addiert -- ein einziger rng()-Aufruf statt bisher zwei
// (Fehlschlag-Check + Payout-Position). Ein "Verlust" (negative Spanne) ist
// jetzt ein EIGENER, fester Payout-Bereich der jeweiligen Aktion
// (machines.config.ts::CyclicActionDef.payoutLoss), kein Prozentabzug mehr.

export type RunStatus = 'active' | 'banked';

export interface ActionResult {
    payout: number; // kann negativ sein (Verlust-Fall)
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
    // einen Verlust. Meilenstein-Erreichung/Banking-Berechtigung bleibt
    // dadurch bewusst "sticky" (unveraendert aus Phase 7b uebernommen, siehe
    // STATUS.md): ein einmal erreichter (bankbarer) Meilenstein geht nicht
    // verloren, nur weil eine spaetere Aktion mit Verlust-Ausgang den
    // AKTUELLEN Punktestand druecken. `bank()` sichert weiterhin den
    // TATSAECHLICHEN aktuellen Punktestand, nicht den Peak.
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

    // Fuehrt eine bereits aufgeloeste Aktion aus (siehe ResolvedAction):
    // zieht EINEN Wert aus payoutRange (gleichverteilt, kann bei einem
    // Verlust-Ausgang negativ sein) und addiert ihn auf den Punktestand.
    // rng ist injizierbar fuer deterministische Tests. Der Punktestand wird
    // bei 0 nach unten geklemmt (bewusste Design-Entscheidung, nicht
    // explizit in der Vorgabe: ein Verlust ist ein fester Betrag, kein
    // Prozentabzug, und koennte ohne Bodenklemmung den ungebankten
    // Punktestand ins Negative druecken -- `bank()`/`EconomyStore.addTickets`
    // wuerfen dann bei einem negativen Betrag, da Tickets nicht negativ sein
    // duerfen. Ein Boden bei 0 ist die einfachste, unueberraschendste Regel:
    // ein Verlust kann ungebankten Fortschritt bis auf 0 zunichtemachen,
    // aber keine "Schulden" erzeugen).
    resolveAction(tier: ResolvedAction, rng: () => number = Math.random): ActionResult {
        if (this.status !== 'active') {
            throw new Error(`PushYourLuckRun: Aktion nicht möglich, Lauf ist bereits "${this.status}"`);
        }

        const [min, max] = tier.payoutRange;
        const payout = min + rng() * (max - min);
        this.score = Math.max(0, this.score + payout);
        this.peakScore = Math.max(this.peakScore, this.score);
        return { payout, scoreAfter: this.score };
    }

    // Alle Meilensteine, deren Schwellenwert der Lauf JE ERREICHT hat
    // (peakScore, siehe Klassenkommentar -- sticky trotz spaeterer
    // Verluste), aufsteigend sortiert.
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
