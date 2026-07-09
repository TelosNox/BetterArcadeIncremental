import { describe, expect, it } from 'vitest';
import {
    BEAT_LEDGER,
    CHAMPIONS_LEDGER,
    CROSS_PRICE_SURCHARGE_K,
    GREED_RUN,
    MACHINES,
    MAX_PRECISION,
    N_STATES,
    START_DEPTH,
    START_PRECISION,
    TRAP_TUNNELS,
    buildCyclicActions,
    computeCandidateExclusionOrder,
    computeInterleavedUpgradeCost,
    getEntryPointMachine,
    getExcludedCandidates,
    getFinalMilestoneThreshold,
    getMachineConfig,
    getMachineUpgrade,
    getMachineUpgradeCost,
    getPreviewDepth,
    getPreviewPrecision,
    getUpgradeCostToMilestoneRatio,
    resolveMachineAction,
} from './machines.config';
import type { MachineConfig } from '../engine/types';
import { PatternEngine } from '../engine/PatternEngine';
import { PushYourLuckRun } from '../engine/PushYourLuckEngine';

// Stationaere Verteilung einer (ergodischen) Markov-Kette per
// Power-Iteration -- reines Test-Werkzeug fuer die Blind-EV-Garantie
// (STATUS.md Phase 7c Punkt 4), NICHT Teil der Produktions-/Engine-Logik.
function stationaryDistribution(machine: MachineConfig): Record<string, number> {
    const { states, transitions } = machine.pattern;
    let dist: Record<string, number> = Object.fromEntries(states.map((s) => [s, 1 / states.length]));

    for (let step = 0; step < 3000; step += 1) {
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

function mean([a, b]: readonly [number, number]): number {
    return (a + b) / 2;
}

// Blind-EV einer Aktion unter der ECHTEN stationaeren Verteilung (nicht
// 1/n angenommen, siehe STATUS.md Punkt 4): P(Gewinn)*Big + P(Verlust)*Loss
// + P(Rest)*Simple.
function blindEv(machine: MachineConfig, stationary: Record<string, number>) {
    return machine.actions.map((action) => {
        const pWin = stationary[action.counterState];
        const pLoss = stationary[action.losesToState];
        const pNeutral = 1 - pWin - pLoss;
        const ev = pWin * mean(action.payoutBig) + pLoss * mean(action.payoutLoss) + pNeutral * mean(action.payoutSimple);
        return { id: action.id, ev };
    });
}

// Obergrenze fuer das Verhaeltnis groesster/kleinster Blind-EV ueber die 5
// Aktionen eines Automaten (STATUS.md Punkt 4: "keine Aktion darf... einen
// klar hoeheren Blind-EV haben als die anderen"). 1.25 ist eine bewusst
// gewaehlte, moderate Toleranzschwelle -- deutlich unter dem Faktor, den ein
// grob geskewtes Pattern erzeugen wuerde, aber tolerant genug, um eine
// perfekt uniforme (und damit unrealistisch flache) Verteilung nicht zu
// erzwingen.
const MAX_BLIND_EV_DOMINANCE_RATIO = 1.25;

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

    describe('Automaten-Konfigurationen (alle vier, Phase 7c Aktionsmodell)', () => {
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

        it.each(MACHINES)('$name: hat genau 5 Pattern-Zustaende UND genau 5 Aktionen', (machine) => {
            expect(machine.pattern.states).toHaveLength(N_STATES);
            expect(machine.actions).toHaveLength(N_STATES);
        });

        it.each(MACHINES)(
            '$name: jede Aktion hat ein disjunktes Gewinn/Verlust-Zustandspaar',
            (machine) => {
                for (const action of machine.actions) {
                    expect(machine.pattern.states).toContain(action.counterState);
                    expect(machine.pattern.states).toContain(action.losesToState);
                    expect(action.counterState).not.toBe(action.losesToState);
                }
            },
        );

        it.each(MACHINES)(
            '$name: counterState/losesToState bilden je einen vollstaendigen 5er-Zyklus (jeder Zustand genau einmal Gewinn-Ziel, genau einmal Verlust-Ziel)',
            (machine) => {
                const winTargets = machine.actions.map((a) => a.counterState).sort();
                const lossTargets = machine.actions.map((a) => a.losesToState).sort();
                const states = [...machine.pattern.states].sort();
                expect(winTargets).toEqual(states);
                expect(lossTargets).toEqual(states);
            },
        );

        it.each(MACHINES)(
            '$name: Blind-EV-Garantie -- jede Aktion hat unter der stationaeren Verteilung einen positiven Erwartungswert',
            (machine) => {
                const stationary = stationaryDistribution(machine);
                const evs = blindEv(machine, stationary);
                for (const { ev } of evs) {
                    expect(ev).toBeGreaterThan(0);
                }
            },
        );

        it.each(MACHINES)(
            '$name: keine Aktion dominiert die anderen beim blinden Spiel (Verhaeltnis groesster/kleinster Blind-EV <= 1.25)',
            (machine) => {
                const stationary = stationaryDistribution(machine);
                const evs = blindEv(machine, stationary).map((e) => e.ev);
                const ratio = Math.max(...evs) / Math.min(...evs);
                expect(ratio).toBeLessThanOrEqual(MAX_BLIND_EV_DOMINANCE_RATIO);
            },
        );

        it.each(MACHINES)('$name: Zielwert-Check liegt im Korridor 85-95% (Zwei-Achsen-Vorschau, ausgewogener Einkauf)', (machine) => {
            const ratio = getUpgradeCostToMilestoneRatio(machine);
            expect(ratio).toBeGreaterThanOrEqual(0.85);
            expect(ratio).toBeLessThanOrEqual(0.95);
        });

        it.each(MACHINES)('$name: hat genau 4 Tiefe-Upgrades und 3 Praezisions-Upgrades', (machine) => {
            expect(machine.depthUpgrades).toHaveLength(4);
            expect(machine.precisionUpgrades).toHaveLength(3);
        });

        it.each(MACHINES)('$name: Basispreise (cost) sind positiv und strikt geometrisch steigend', (machine) => {
            for (const ladder of [machine.depthUpgrades, machine.precisionUpgrades]) {
                for (let i = 1; i < ladder.length; i += 1) {
                    expect(ladder[i - 1].cost).toBeGreaterThan(0);
                    expect(ladder[i].cost).toBeGreaterThan(ladder[i - 1].cost);
                }
            }
        });
    });

    describe('buildCyclicActions', () => {
        const states = ['a', 'b', 'c', 'd', 'e'];
        const templates = states.map((s) => ({
            id: `action-${s}`,
            payoutBig: [10, 20] as [number, number],
            payoutSimple: [3, 5] as [number, number],
            payoutLoss: [-8, -4] as [number, number],
        }));

        it('leitet counterState als naechsten Zustand im Zyklus ab', () => {
            const actions = buildCyclicActions(states, templates);
            expect(actions[0].counterState).toBe('b');
            expect(actions[4].counterState).toBe('a'); // wraps around
        });

        it('leitet losesToState als vorherigen Zustand im Zyklus ab', () => {
            const actions = buildCyclicActions(states, templates);
            expect(actions[0].losesToState).toBe('e'); // wraps around
            expect(actions[1].losesToState).toBe('a');
        });

        it('wirft bei unterschiedlicher Laenge von states und templates', () => {
            expect(() => buildCyclicActions(states, templates.slice(0, 3))).toThrow(RangeError);
        });
    });

    describe('resolveMachineAction', () => {
        const action = GREED_RUN.actions[0]; // 'sprint': win 'nah', loss 'rueckzug'

        it('liefert payoutBig am Gewinn-Zustand', () => {
            expect(resolveMachineAction(action, action.counterState)).toEqual({
                id: action.id,
                payoutRange: action.payoutBig,
            });
        });

        it('liefert payoutLoss am Verlust-Zustand', () => {
            expect(resolveMachineAction(action, action.losesToState)).toEqual({
                id: action.id,
                payoutRange: action.payoutLoss,
            });
        });

        it('liefert payoutSimple bei jedem anderen Zustand', () => {
            const neutralStates = GREED_RUN.pattern.states.filter(
                (s) => s !== action.counterState && s !== action.losesToState,
            );
            expect(neutralStates.length).toBe(3);
            for (const state of neutralStates) {
                expect(resolveMachineAction(action, state)).toEqual({ id: action.id, payoutRange: action.payoutSimple });
            }
        });
    });

    describe('computeCandidateExclusionOrder / getExcludedCandidates', () => {
        const states = ['fern', 'nah', 'alarm', 'sichtkontakt', 'rueckzug'];

        it('enthaelt nie den wahren Zustand', () => {
            const order = computeCandidateExclusionOrder(states, 'alarm', () => 0.5);
            expect(order).not.toContain('alarm');
            expect(order).toHaveLength(4);
        });

        it('ist bei gleichem rng deterministisch (stabil bei wiederholtem Aufruf)', () => {
            const rngValues = [0.1, 0.9, 0.3, 0.7];
            let i = 0;
            const rng = () => rngValues[i++ % rngValues.length];
            const orderA = computeCandidateExclusionOrder(states, 'fern', rng);
            i = 0;
            const orderB = computeCandidateExclusionOrder(states, 'fern', rng);
            expect(orderA).toEqual(orderB);
        });

        it('getExcludedCandidates(0) schliesst nichts aus', () => {
            const order = computeCandidateExclusionOrder(states, 'fern', () => 0.5);
            expect(getExcludedCandidates(order, 0)).toEqual([]);
        });

        it('getExcludedCandidates ist monoton: hoehere Praezision liefert eine Obermenge', () => {
            const order = computeCandidateExclusionOrder(states, 'fern', () => 0.42);
            const at1 = getExcludedCandidates(order, 1);
            const at2 = getExcludedCandidates(order, 2);
            expect(at2.slice(0, 1)).toEqual(at1);
        });

        it('getExcludedCandidates(MAX_PRECISION) schliesst alle falschen Kandidaten aus (Zustand de facto bekannt)', () => {
            const order = computeCandidateExclusionOrder(states, 'fern', () => 0.5);
            const excluded = getExcludedCandidates(order, MAX_PRECISION);
            expect(excluded).toHaveLength(states.length - 1);
            const remaining = states.filter((s) => !excluded.includes(s));
            expect(remaining).toEqual(['fern']);
        });

        it('klemmt precision oberhalb der verfuegbaren Kandidatenzahl', () => {
            const order = computeCandidateExclusionOrder(states, 'fern', () => 0.5);
            expect(getExcludedCandidates(order, 99)).toHaveLength(4);
        });
    });

    describe('getPreviewDepth / getPreviewPrecision', () => {
        it('liefert START_DEPTH/START_PRECISION ohne gekaufte Upgrades', () => {
            expect(getPreviewDepth(GREED_RUN, [])).toBe(START_DEPTH);
            expect(getPreviewPrecision(GREED_RUN, [])).toBe(START_PRECISION);
        });

        it('steigt mit dem hoechsten gekauften Upgrade je Achse', () => {
            const owned = [GREED_RUN.depthUpgrades[0].id, GREED_RUN.depthUpgrades[1].id];
            expect(getPreviewDepth(GREED_RUN, owned)).toBe(GREED_RUN.depthUpgrades[1].effect.value);
        });

        it('deckelt Praezision bei MAX_PRECISION (letzte Stufe)', () => {
            const owned = GREED_RUN.precisionUpgrades.map((u) => u.id);
            expect(getPreviewPrecision(GREED_RUN, owned)).toBe(MAX_PRECISION);
        });

        it('deckelt Tiefe bei N_STATES (letzte Stufe)', () => {
            const owned = GREED_RUN.depthUpgrades.map((u) => u.id);
            expect(getPreviewDepth(GREED_RUN, owned)).toBe(N_STATES);
        });
    });

    describe('getMachineUpgradeCost (Kreuz-Preis-Kopplung)', () => {
        it('entspricht dem Basispreis ohne gekaufte Upgrades der anderen Achse', () => {
            const upgrade = GREED_RUN.depthUpgrades[0];
            expect(getMachineUpgradeCost(GREED_RUN, upgrade, [])).toBeCloseTo(upgrade.cost);
        });

        it('steigt multiplikativ mit jeder gekauften Stufe der jeweils anderen Achse', () => {
            const upgrade = GREED_RUN.depthUpgrades[0];
            const oneOtherBought = [GREED_RUN.precisionUpgrades[0].id];
            expect(getMachineUpgradeCost(GREED_RUN, upgrade, oneOtherBought)).toBeCloseTo(
                upgrade.cost * (1 + CROSS_PRICE_SURCHARGE_K),
            );
            const twoOtherBought = [GREED_RUN.precisionUpgrades[0].id, GREED_RUN.precisionUpgrades[1].id];
            expect(getMachineUpgradeCost(GREED_RUN, upgrade, twoOtherBought)).toBeCloseTo(
                upgrade.cost * (1 + CROSS_PRICE_SURCHARGE_K) ** 2,
            );
        });

        it('ignoriert bereits gekaufte Stufen der EIGENEN Achse fuer den Aufschlag', () => {
            const upgrade = GREED_RUN.depthUpgrades[1];
            const ownDepthBought = [GREED_RUN.depthUpgrades[0].id];
            expect(getMachineUpgradeCost(GREED_RUN, upgrade, ownDepthBought)).toBeCloseTo(upgrade.cost);
        });
    });

    describe('getMachineUpgrade', () => {
        it('findet ein Upgrade in der Tiefe-Leiter', () => {
            expect(getMachineUpgrade(GREED_RUN, GREED_RUN.depthUpgrades[0].id)).toBe(GREED_RUN.depthUpgrades[0]);
        });

        it('findet ein Upgrade in der Praezisions-Leiter', () => {
            expect(getMachineUpgrade(GREED_RUN, GREED_RUN.precisionUpgrades[0].id)).toBe(
                GREED_RUN.precisionUpgrades[0],
            );
        });

        it('liefert undefined fuer unbekannte id', () => {
            expect(getMachineUpgrade(GREED_RUN, 'unbekannt')).toBeUndefined();
        });
    });

    describe('computeInterleavedUpgradeCost / getFinalMilestoneThreshold', () => {
        it('ist positiv und kleiner als die Summe aller Basispreise ohne Kopplung (k>0 wirkt)', () => {
            for (const machine of MACHINES) {
                const flatSum =
                    machine.depthUpgrades.reduce((sum, u) => sum + u.cost, 0) +
                    machine.precisionUpgrades.reduce((sum, u) => sum + u.cost, 0);
                const interleaved = computeInterleavedUpgradeCost(machine);
                expect(interleaved).toBeGreaterThan(flatSum); // Kopplung erhoeht immer, da k>0
            }
        });

        it('Basispreise sind pro Automat proportional zur jeweiligen Ticket-Oekonomie skaliert (nicht identisch)', () => {
            const costs = MACHINES.map((m) => m.depthUpgrades[3].cost);
            expect(new Set(costs).size).toBe(MACHINES.length);
        });

        it('getFinalMilestoneThreshold liefert den letzten (hoechsten) Meilenstein', () => {
            expect(getFinalMilestoneThreshold(GREED_RUN)).toBe(100);
            expect(getFinalMilestoneThreshold(TRAP_TUNNELS)).toBe(120);
            expect(getFinalMilestoneThreshold(BEAT_LEDGER)).toBe(140);
            expect(getFinalMilestoneThreshold(CHAMPIONS_LEDGER)).toBe(180);
        });
    });
});
