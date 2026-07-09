import { describe, expect, it } from 'vitest';
import {
    BEAT_LEDGER,
    CHAMPIONS_LEDGER,
    GREED_RUN,
    MACHINES,
    TRAP_TUNNELS,
    getEffectiveFailureChance,
    getEntryPointMachine,
    getMachineConfig,
} from './machines.config';
import type { RiskTier } from '../engine/types';
import { PatternEngine } from '../engine/PatternEngine';
import { PushYourLuckRun } from '../engine/PushYourLuckEngine';

const states = ['fern', 'nah', 'alarm']; // sicher -> gefaehrlich

describe('machines.config', () => {
    describe('getMachineConfig / getEntryPointMachine', () => {
        it('findet Greed Run ueber die id', () => {
            expect(getMachineConfig('greed-run')).toBe(GREED_RUN);
        });

        it('liefert undefined fuer unbekannte id', () => {
            expect(getMachineConfig('unbekannt')).toBeUndefined();
        });

        it('liefert Greed Run als entryPoint-Automat', () => {
            expect(getEntryPointMachine()).toBe(GREED_RUN);
        });

        it('findet Automat 2-4 ueber ihre id', () => {
            expect(getMachineConfig('trap-tunnels')).toBe(TRAP_TUNNELS);
            expect(getMachineConfig('beat-ledger')).toBe(BEAT_LEDGER);
            expect(getMachineConfig('champions-ledger')).toBe(CHAMPIONS_LEDGER);
        });
    });

    describe('Automaten-Konfigurationen (alle vier, Phase 6)', () => {
        it('enthaelt genau 4 Automaten', () => {
            expect(MACHINES).toHaveLength(4);
        });

        it('hat genau einen entryPoint-Automaten', () => {
            expect(MACHINES.filter((machine) => machine.entryPoint)).toHaveLength(1);
        });

        it.each(MACHINES)('$name: PatternConfig ist gueltig (PatternEngine wirft nicht)', (machine) => {
            expect(() => new PatternEngine(machine.pattern)).not.toThrow();
        });

        it.each(MACHINES)('$name: Milestones sind gueltig (PushYourLuckRun wirft nicht)', (machine) => {
            expect(() => new PushYourLuckRun(machine.milestones)).not.toThrow();
        });

        it.each(MACHINES)(
            '$name: safe < balanced < risky bei EV UND Risiko in jedem Musterzustand (Trade-off-Check)',
            (machine) => {
                const [safeTier, balancedTier, riskyTier] = machine.riskTiers;
                for (const state of machine.pattern.states) {
                    const safeChance = getEffectiveFailureChance(safeTier, machine.pattern.states, state);
                    const balancedChance = getEffectiveFailureChance(balancedTier, machine.pattern.states, state);
                    const riskyChance = getEffectiveFailureChance(riskyTier, machine.pattern.states, state);
                    expect(safeChance).toBeLessThan(balancedChance);
                    expect(balancedChance).toBeLessThan(riskyChance);

                    const meanPayout = (tier: RiskTier) => (tier.payoutRange[0] + tier.payoutRange[1]) / 2;
                    const evSafe = (1 - safeChance) * meanPayout(safeTier);
                    const evBalanced = (1 - balancedChance) * meanPayout(balancedTier);
                    const evRisky = (1 - riskyChance) * meanPayout(riskyTier);
                    expect(evSafe).toBeLessThan(evBalanced);
                    expect(evBalanced).toBeLessThan(evRisky);
                }
            },
        );
    });

    describe('getEffectiveFailureChance', () => {
        const safe: RiskTier = { id: 'safe', payoutRange: [3, 3], failureChance: 0 };
        const balanced: RiskTier = { id: 'balanced', payoutRange: [6, 10], failureChance: 0.15 };
        const risky: RiskTier = { id: 'risky', payoutRange: [14, 22], failureChance: 0.35 };

        it('laesst "safe" (failureChance 0) unabhaengig vom Musterzustand immer bei 0', () => {
            expect(getEffectiveFailureChance(safe, states, 'fern')).toBe(0);
            expect(getEffectiveFailureChance(safe, states, 'nah')).toBe(0);
            expect(getEffectiveFailureChance(safe, states, 'alarm')).toBe(0);
        });

        it('laesst die Basis-failureChance beim mittleren Zustand ("nah") unveraendert', () => {
            expect(getEffectiveFailureChance(balanced, states, 'nah')).toBeCloseTo(0.15);
            expect(getEffectiveFailureChance(risky, states, 'nah')).toBeCloseTo(0.35);
        });

        it('senkt die failureChance beim sichersten Zustand ("fern")', () => {
            expect(getEffectiveFailureChance(balanced, states, 'fern')).toBeCloseTo(0.025);
            expect(getEffectiveFailureChance(risky, states, 'fern')).toBeCloseTo(0.225);
        });

        it('erhoeht die failureChance beim gefaehrlichsten Zustand ("alarm")', () => {
            expect(getEffectiveFailureChance(balanced, states, 'alarm')).toBeCloseTo(0.275);
            expect(getEffectiveFailureChance(risky, states, 'alarm')).toBeCloseTo(0.475);
        });

        it('haelt fuer jeden Musterzustand die Reihenfolge safe < balanced < risky ein (kein dominiertes Tier)', () => {
            for (const state of states) {
                const safeEff = getEffectiveFailureChance(safe, states, state);
                const balancedEff = getEffectiveFailureChance(balanced, states, state);
                const riskyEff = getEffectiveFailureChance(risky, states, state);
                expect(safeEff).toBeLessThan(balancedEff);
                expect(balancedEff).toBeLessThan(riskyEff);
            }
        });

        it('klemmt auf [0, 1] bei extremer sensitivity', () => {
            expect(getEffectiveFailureChance(risky, states, 'alarm', 5)).toBe(1);
            expect(getEffectiveFailureChance(balanced, states, 'fern', 5)).toBe(0);
        });

        it('behandelt einen unbekannten Zustand neutral (Basis-failureChance unveraendert)', () => {
            expect(getEffectiveFailureChance(balanced, states, 'unbekannt')).toBeCloseTo(0.15);
        });

        it('behandelt ein Pattern mit nur einem Zustand neutral (Basis-failureChance unveraendert)', () => {
            expect(getEffectiveFailureChance(balanced, ['einziger'], 'einziger')).toBeCloseTo(0.15);
        });

        it('nutzt PATTERN_RISK_SENSITIVITY als Default, wenn keine sensitivity uebergeben wird', () => {
            const withDefault = getEffectiveFailureChance(risky, states, 'alarm');
            const withExplicit = getEffectiveFailureChance(risky, states, 'alarm', 0.25);
            expect(withDefault).toBeCloseTo(withExplicit);
        });
    });
});
