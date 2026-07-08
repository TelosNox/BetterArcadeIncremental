import type { PatternConfig } from './types';

// Markov-artige Zustandsübergänge mit progressiver Teilaufdeckung.
// Laut game-spec.md 4.1 und Baukasten 1.10: aufgedeckt wird die
// Wahrscheinlichkeitsverteilung selbst (welche Folgezustände wie
// wahrscheinlich sind), niemals das exakte nächste Ereignis. Kennt weder
// Phaser noch React (Architektur-Kurzregel in CLAUDE.md).

const DISTRIBUTION_EPSILON = 1e-6;

export interface DistributionEntry {
    to: string;
    probability: number;
}

export interface VisibleDistributionEntry extends DistributionEntry {
    revealed: boolean;
}

function validatePatternConfig(config: PatternConfig): void {
    if (config.states.length === 0) {
        throw new RangeError('PatternConfig: states darf nicht leer sein');
    }
    const stateSet = new Set(config.states);

    for (const [from, targets] of Object.entries(config.transitions)) {
        if (!stateSet.has(from)) {
            throw new RangeError(`PatternConfig: Übergang von unbekanntem Zustand "${from}"`);
        }
        let sum = 0;
        for (const [to, probability] of Object.entries(targets)) {
            if (!stateSet.has(to)) {
                throw new RangeError(`PatternConfig: Übergang "${from}" -> unbekannter Zustand "${to}"`);
            }
            if (probability < 0) {
                throw new RangeError(`PatternConfig: negative Wahrscheinlichkeit "${from}" -> "${to}"`);
            }
            sum += probability;
        }
        if (Object.keys(targets).length > 0 && Math.abs(sum - 1) > DISTRIBUTION_EPSILON) {
            throw new RangeError(
                `PatternConfig: Übergänge von "${from}" summieren sich auf ${sum}, nicht auf 1`,
            );
        }
    }

    if (config.baseVisibility < 0 || config.baseVisibility > 1) {
        throw new RangeError('PatternConfig: baseVisibility muss zwischen 0 und 1 liegen');
    }
}

export class PatternEngine {
    private readonly config: PatternConfig;

    constructor(config: PatternConfig) {
        validatePatternConfig(config);
        this.config = config;
    }

    getStates(): readonly string[] {
        return this.config.states;
    }

    // Anteil der Verteilung, der bei gegebenem Upgrade-Level sichtbar ist
    // (0-1). visibilityPerUpgrade[i] ist der Zuwachs durch Upgrade-Stufe i+1.
    getVisibility(upgradeLevel: number): number {
        const level = Math.max(0, Math.floor(upgradeLevel));
        const bonus = this.config.visibilityPerUpgrade
            .slice(0, level)
            .reduce((sum, step) => sum + step, 0);
        return Math.min(1, this.config.baseVisibility + bonus);
    }

    // Volle Wahrscheinlichkeitsverteilung der Folgezustände für einen
    // Zustand, absteigend nach Wahrscheinlichkeit sortiert. Unbekannte
    // oder terminale Zustände liefern eine leere Verteilung.
    getTransitionDistribution(state: string): DistributionEntry[] {
        const targets = this.config.transitions[state] ?? {};
        return Object.entries(targets)
            .map(([to, probability]) => ({ to, probability }))
            .sort((a, b) => b.probability - a.probability);
    }

    // Wie getTransitionDistribution, aber markiert je Eintrag, ob er beim
    // gegebenen Upgrade-Level dem Spieler gezeigt werden darf. Aufgedeckt
    // werden zuerst die wahrscheinlichsten Folgezustände (Baukasten 1.10:
    // die Verteilung wird aufgedeckt, nicht das exakte nächste Ereignis).
    getVisibleDistribution(state: string, upgradeLevel: number): VisibleDistributionEntry[] {
        const distribution = this.getTransitionDistribution(state);
        const visibility = this.getVisibility(upgradeLevel);
        const revealedCount = Math.round(visibility * distribution.length);

        return distribution.map((entry, index) => ({
            ...entry,
            revealed: index < revealedCount,
        }));
    }

    // Zieht den nächsten Zustand gemäß der vollen (nicht der sichtbaren)
    // Verteilung. rng ist injizierbar für deterministische Tests.
    sampleNext(state: string, rng: () => number = Math.random): string {
        const distribution = this.getTransitionDistribution(state);
        if (distribution.length === 0) {
            throw new RangeError(`PatternEngine: Zustand "${state}" hat keine Übergänge`);
        }

        const roll = rng();
        let cumulative = 0;
        for (const entry of distribution) {
            cumulative += entry.probability;
            if (roll < cumulative) {
                return entry.to;
            }
        }
        // Rundungsausgleich: faengt roll === 1 bzw. Gleitkomma-Rundung ab.
        return distribution[distribution.length - 1].to;
    }
}
