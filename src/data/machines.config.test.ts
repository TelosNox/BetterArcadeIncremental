import { describe, expect, it } from 'vitest';
import { GREED_RUN, getEffectiveFailureChance, getEntryPointMachine, getMachineConfig } from './machines.config';
import type { RiskTier } from '../engine/types';

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
