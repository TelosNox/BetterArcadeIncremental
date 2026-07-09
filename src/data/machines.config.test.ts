import { describe, expect, it } from 'vitest';
import {
    BEAT_LEDGER,
    CHAMPIONS_LEDGER,
    GREED_RUN,
    MACHINES,
    MAX_PREVIEW_MOVES,
    TRAP_TUNNELS,
    getEntryPointMachine,
    getHardActions,
    getIntermediateActions,
    getMachineConfig,
    getVisibleMoveCount,
    resolveMachineAction,
} from './machines.config';
import type { HardActionDef, MachineConfig } from '../engine/types';
import { PatternEngine } from '../engine/PatternEngine';
import { PushYourLuckRun } from '../engine/PushYourLuckEngine';

// Stationaere Verteilung einer (ergodischen) Markov-Kette per
// Power-Iteration -- reines Test-Werkzeug fuer den Trade-off-Check
// (design-toolbox.md Punkt 5), nicht Teil der Produktions-/Engine-Logik
// (die kennt "stationaer" nicht, siehe machines.config.ts). Nach genuegend
// Iterationen konvergiert eine Gleichverteilung gegen die stationaere
// Verteilung, fuer alle vier Automaten-Konfigurationen (3 Zustaende, alle
// Uebergaenge > 0 innerhalb weniger Schritte erreichbar).
function stationaryDistribution(machine: MachineConfig): Record<string, number> {
    const { states, transitions } = machine.pattern;
    let dist: Record<string, number> = Object.fromEntries(states.map((s) => [s, 1 / states.length]));

    for (let step = 0; step < 2000; step += 1) {
        const next: Record<string, number> = Object.fromEntries(states.map((s) => [s, 0]));
        for (const from of states) {
            const targets = transitions[from] ?? {};
            for (const [to, probability] of Object.entries(targets)) {
                next[to] += dist[from] * probability;
            }
        }
        dist = next;
    }
    return dist;
}

function meanPayout(range: [number, number]): number {
    return (range[0] + range[1]) / 2;
}

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

    describe('Automaten-Konfigurationen (alle vier, Phase 7b Aktionsmodell)', () => {
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

        it.each(MACHINES)('$name: hat genau zwei harte Aktionen', (machine) => {
            expect(getHardActions(machine)).toHaveLength(2);
        });

        it.each(MACHINES)('$name: hat mindestens zwei Zwischenstufen', (machine) => {
            expect(getIntermediateActions(machine).length).toBeGreaterThanOrEqual(2);
        });

        it.each(MACHINES)(
            '$name: beide harten Aktionen kontern unterschiedliche, tatsaechlich existierende Pattern-Zustaende',
            (machine) => {
                const [first, second] = getHardActions(machine);
                expect(machine.pattern.states).toContain(first.counterState);
                expect(machine.pattern.states).toContain(second.counterState);
                expect(first.counterState).not.toBe(second.counterState);
            },
        );

        it.each(MACHINES)(
            '$name: mindestens ein Pattern-Zustand ist fuer BEIDE harten Aktionen neutral (kein Gegenstueck)',
            (machine) => {
                const hard = getHardActions(machine);
                const counterStates = new Set(hard.map((action) => action.counterState));
                const neutralStates = machine.pattern.states.filter((state) => !counterStates.has(state));
                expect(neutralStates.length).toBeGreaterThanOrEqual(1);
            },
        );

        it.each(MACHINES)(
            '$name: Zwischenstufen halten safe < balanced < risky bei EV UND Risiko ein (Trade-off-Check)',
            (machine) => {
                const intermediate = getIntermediateActions(machine);
                for (let i = 1; i < intermediate.length; i += 1) {
                    const prev = intermediate[i - 1];
                    const curr = intermediate[i];
                    expect(prev.failureChance).toBeLessThan(curr.failureChance);
                    const evPrev = (1 - prev.failureChance) * meanPayout(prev.payoutRange);
                    const evCurr = (1 - curr.failureChance) * meanPayout(curr.payoutRange);
                    expect(evPrev).toBeLessThan(evCurr);
                }
            },
        );

        it.each(MACHINES)(
            '$name: Blind-EV einer harten Aktion (stationaere Fangchance ihres Gegenstuecks) dominiert nicht die beste Zwischenstufe',
            (machine) => {
                const stationary = stationaryDistribution(machine);
                const intermediate = getIntermediateActions(machine);
                const bestIntermediateEv = Math.max(
                    ...intermediate.map((tier) => (1 - tier.failureChance) * meanPayout(tier.payoutRange)),
                );

                for (const hard of getHardActions(machine)) {
                    const blindFailureChance = stationary[hard.counterState];
                    const blindEv = (1 - blindFailureChance) * meanPayout(hard.payoutRange);
                    expect(blindEv).toBeLessThan(bestIntermediateEv);
                }
            },
        );

        it.each(MACHINES)(
            '$name: Perfekt-Info-EV einer harten Aktion (immer nur bei sichtbar sicherem Zustand gespielt) schlaegt die beste Zwischenstufe',
            (machine) => {
                const intermediate = getIntermediateActions(machine);
                const bestIntermediateEv = Math.max(
                    ...intermediate.map((tier) => (1 - tier.failureChance) * meanPayout(tier.payoutRange)),
                );

                for (const hard of getHardActions(machine)) {
                    const perfectInfoEv = meanPayout(hard.payoutRange); // 100% Erfolg, siehe resolveMachineAction
                    expect(perfectInfoEv).toBeGreaterThan(bestIntermediateEv);
                }
            },
        );

        it.each(MACHINES)(
            '$name: Anzahl automaten-interner Upgrades entspricht der Anzahl visibilityPerUpgrade-Stufen',
            (machine) => {
                expect(machine.upgrades).toHaveLength(machine.pattern.visibilityPerUpgrade.length);
            },
        );

        it.each(MACHINES)('$name: automaten-interne Upgrades kosten Tickets (>0), nicht Credits', (machine) => {
            for (const upgrade of machine.upgrades) {
                expect(upgrade.cost).toBeGreaterThan(0);
                expect(upgrade.effect.type).toBe('visibility');
            }
        });
    });

    describe('resolveMachineAction', () => {
        const states = ['fern', 'nah', 'alarm'];
        const hard: HardActionDef = { kind: 'hard', id: 'blitzlauf', payoutRange: [12, 19], counterState: 'alarm' };

        it('harte Aktion scheitert garantiert (failureChance 1) am exakten Gegenstueck-Zustand', () => {
            expect(resolveMachineAction(hard, 'alarm').failureChance).toBe(1);
        });

        it('harte Aktion trifft garantiert (failureChance 0) bei jedem anderen Zustand', () => {
            expect(resolveMachineAction(hard, 'fern').failureChance).toBe(0);
            expect(resolveMachineAction(hard, 'nah').failureChance).toBe(0);
        });

        it('behaelt id und payoutRange der harten Aktion bei', () => {
            const resolved = resolveMachineAction(hard, 'fern');
            expect(resolved.id).toBe('blitzlauf');
            expect(resolved.payoutRange).toEqual([12, 19]);
        });

        it('Zwischenstufe wird unveraendert (musterunabhaengig) durchgereicht, unabhaengig vom Zustand', () => {
            const intermediate = GREED_RUN.actions.find((a) => a.id === 'waghalsig')!;
            for (const state of states) {
                const resolved = resolveMachineAction(intermediate, state);
                expect(resolved.failureChance).toBe(0.35);
                expect(resolved.payoutRange).toEqual([14, 22]);
            }
        });
    });

    describe('getVisibleMoveCount', () => {
        it('liefert mindestens 1 Zug, auch bei minimaler Sichtbarkeit', () => {
            expect(getVisibleMoveCount(0)).toBeGreaterThanOrEqual(1);
            expect(getVisibleMoveCount(0.01)).toBeGreaterThanOrEqual(1);
        });

        it('liefert MAX_PREVIEW_MOVES bei voller Sichtbarkeit (1)', () => {
            expect(getVisibleMoveCount(1)).toBe(MAX_PREVIEW_MOVES);
        });

        it('rundet Zwischenwerte auf eine ganze Zug-Anzahl', () => {
            expect(getVisibleMoveCount(1 / 3)).toBe(1);
            expect(getVisibleMoveCount(2 / 3)).toBe(2);
        });
    });
});
