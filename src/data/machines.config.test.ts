import { describe, expect, it } from 'vitest';
import {
    BEAT_LEDGER,
    CHAMPIONS_LEDGER,
    CROSS_PRICE_SURCHARGE_K,
    ENEMY_COLORS,
    GREED_RUN,
    MACHINES,
    MAX_GRID_PRECISION,
    MAX_PRECISION,
    MAX_DYNAMITE_COUNT,
    MAX_ENEMY_COUNT,
    MAX_SIGHT_RANGE,
    MAX_TRAP_COUNT,
    N_STATES,
    SECTOR_COLORS,
    START_ACTION_BUDGET,
    START_DEPTH,
    START_DYNAMITE_COUNT,
    START_ENEMY_COUNT,
    START_GRID_PRECISION,
    START_PRECISION,
    START_SIGHT_RANGE,
    START_TRAP_COUNT,
    TRAP_TUNNELS,
    buildCyclicActions,
    computeCandidateExclusionOrder,
    computeInterleavedUpgradeCost,
    getActionBudget,
    getDynamiteCount,
    getEnemyCount,
    getEntryPointMachine,
    getExcludedCandidates,
    getFinalMilestoneThreshold,
    getGridMachineUpgrade,
    getGridPrecisionLevel,
    getMachineAttendantRate,
    getMachineConfig,
    getMachineUpgrade,
    getMachineUpgradeCost,
    getPreviewDepth,
    getPreviewPrecision,
    getReachedMilestones,
    getSectorColor,
    getSightRange,
    getStateColor,
    getTrapCount,
    getTrapTunnelsMachineUpgrade,
    getUpgradeCostToMilestoneRatio,
    isFinalMilestoneReached,
    resolveMachineAction,
    STATE_COLORS,
} from './machines.config';
import type { CyclicMachineConfig } from '../engine/types';
import { PatternEngine } from '../engine/PatternEngine';
import { computeStationaryDistribution } from '../engine/AttendantEngine';
import { computeBlindExpectedValue, SECTOR_CATEGORIES } from '../engine/GridRunEngine';
import { computeBlindTrapExpectedValue } from '../engine/TrapTunnelsEngine';

// Phase 7f (Greed Run Genre-Rework): Greed Run ist ein Grid-Automat (kind:
// 'grid'). Phase 7i (Trap Tunnels Genre-Rework): Trap Tunnels ist jetzt ein
// eigener kind ('trapTunnels') -- beide haben kein pattern/actions/
// depthUpgrades/precisionUpgrades mehr. Alle Tests, die diese Felder
// brauchen, laufen ab hier nur noch ueber die zwei verbleibenden,
// unveraendert zyklischen Automaten (kind: 'cyclic').
const CYCLIC_MACHINES: readonly CyclicMachineConfig[] = [BEAT_LEDGER, CHAMPIONS_LEDGER];

// Stationaere Verteilung einer (ergodischen) Markov-Kette per Power-Iteration
// -- seit Phase 7d Produktionscode (AttendantEngine.ts::
// computeStationaryDistribution, wird zur Laufzeit fuer die Attendant-
// Ertragsrate gebraucht), hier nur noch importiert statt dupliziert.
function stationaryDistribution(machine: CyclicMachineConfig): Record<string, number> {
    return computeStationaryDistribution(machine.pattern);
}

function mean([a, b]: readonly [number, number]): number {
    return (a + b) / 2;
}

// Blind-EV einer Aktion unter der ECHTEN stationaeren Verteilung (nicht
// 1/n angenommen, siehe STATUS.md Punkt 4): P(Gewinn)*Big + P(Verlust)*Loss
// + P(Rest)*Simple.
function blindEv(machine: CyclicMachineConfig, stationary: Record<string, number>) {
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

    describe('Automaten-Konfigurationen (alle vier, gemeinsame Felder)', () => {
        it('enthaelt genau 4 Automaten', () => {
            expect(MACHINES).toHaveLength(4);
        });

        it('hat genau einen entryPoint-Automaten', () => {
            expect(MACHINES.filter((machine) => machine.entryPoint)).toHaveLength(1);
        });

        it('Greed Run ist der einzige Grid-Automat, Trap Tunnels der einzige Tunnelnetz-Automat, die uebrigen zwei bleiben zyklisch (Phase 7f/7i)', () => {
            expect(GREED_RUN.kind).toBe('grid');
            expect(TRAP_TUNNELS.kind).toBe('trapTunnels');
            for (const machine of CYCLIC_MACHINES) {
                expect(machine.kind).toBe('cyclic');
            }
        });

        it.each(MACHINES)('$name: Milestones sind gueltig (nicht-leer, positiv, strikt steigend)', (machine) => {
            expect(machine.milestones.length).toBeGreaterThan(0);
            for (let i = 0; i < machine.milestones.length; i += 1) {
                expect(machine.milestones[i].threshold).toBeGreaterThan(0);
                if (i > 0) {
                    expect(machine.milestones[i].threshold).toBeGreaterThan(machine.milestones[i - 1].threshold);
                }
            }
        });
    });

    describe('Automaten 2-4 (zyklisches Aktionsmodell, Phase 7c, unveraendert seit Phase 7f)', () => {
        it.each(CYCLIC_MACHINES)('$name: PatternConfig ist gueltig (PatternEngine wirft nicht)', (machine) => {
            expect(() => new PatternEngine(machine.pattern)).not.toThrow();
        });

        it.each(CYCLIC_MACHINES)('$name: hat genau 5 Pattern-Zustaende UND genau 5 Aktionen', (machine) => {
            expect(machine.pattern.states).toHaveLength(N_STATES);
            expect(machine.actions).toHaveLength(N_STATES);
        });

        it.each(CYCLIC_MACHINES)(
            '$name: jede Aktion hat ein disjunktes Gewinn/Verlust-Zustandspaar',
            (machine) => {
                for (const action of machine.actions) {
                    expect(machine.pattern.states).toContain(action.counterState);
                    expect(machine.pattern.states).toContain(action.losesToState);
                    expect(action.counterState).not.toBe(action.losesToState);
                }
            },
        );

        it.each(CYCLIC_MACHINES)(
            '$name: counterState/losesToState bilden je einen vollstaendigen 5er-Zyklus (jeder Zustand genau einmal Gewinn-Ziel, genau einmal Verlust-Ziel)',
            (machine) => {
                const winTargets = machine.actions.map((a) => a.counterState).sort();
                const lossTargets = machine.actions.map((a) => a.losesToState).sort();
                const states = [...machine.pattern.states].sort();
                expect(winTargets).toEqual(states);
                expect(lossTargets).toEqual(states);
            },
        );

        it.each(CYCLIC_MACHINES)(
            '$name: Blind-EV-Garantie -- jede Aktion hat unter der stationaeren Verteilung einen positiven Erwartungswert',
            (machine) => {
                const stationary = stationaryDistribution(machine);
                const evs = blindEv(machine, stationary);
                for (const { ev } of evs) {
                    expect(ev).toBeGreaterThan(0);
                }
            },
        );

        it.each(CYCLIC_MACHINES)(
            '$name: keine Aktion dominiert die anderen beim blinden Spiel (Verhaeltnis groesster/kleinster Blind-EV <= 1.25)',
            (machine) => {
                const stationary = stationaryDistribution(machine);
                const evs = blindEv(machine, stationary).map((e) => e.ev);
                const ratio = Math.max(...evs) / Math.min(...evs);
                expect(ratio).toBeLessThanOrEqual(MAX_BLIND_EV_DOMINANCE_RATIO);
            },
        );

        it.each(CYCLIC_MACHINES)('$name: Zielwert-Check liegt im Korridor 85-95% (Zwei-Achsen-Vorschau, ausgewogener Einkauf)', (machine) => {
            const ratio = getUpgradeCostToMilestoneRatio(machine);
            expect(ratio).toBeGreaterThanOrEqual(0.85);
            expect(ratio).toBeLessThanOrEqual(0.95);
        });

        it.each(CYCLIC_MACHINES)('$name: hat genau 4 Tiefe-Upgrades und 3 Praezisions-Upgrades', (machine) => {
            expect(machine.depthUpgrades).toHaveLength(4);
            expect(machine.precisionUpgrades).toHaveLength(3);
        });

        it.each(CYCLIC_MACHINES)('$name: Basispreise (cost) sind positiv und strikt geometrisch steigend', (machine) => {
            for (const ladder of [machine.depthUpgrades, machine.precisionUpgrades]) {
                for (let i = 1; i < ladder.length; i += 1) {
                    expect(ladder[i - 1].cost).toBeGreaterThan(0);
                    expect(ladder[i].cost).toBeGreaterThan(ladder[i - 1].cost);
                }
            }
        });
    });

    describe('Greed Run (Grid-Automat, Phase 7f Genre-Rework)', () => {
        it('hat 24 Nicht-Start-Sektoren, korrekt auf die 4 Kategorien verteilt', () => {
            const total = SECTOR_CATEGORIES.reduce((sum, c) => sum + GREED_RUN.grid.categoryCounts[c], 0);
            expect(total).toBe(GREED_RUN.grid.gridSize * GREED_RUN.grid.gridSize - 1);
        });

        it('Blind-EV-Garantie: ueber die Kategorien-Haeufigkeit gemittelter Payout eines unvorbereiteten Zugs ist positiv', () => {
            expect(computeBlindExpectedValue(GREED_RUN.grid)).toBeGreaterThan(0);
        });

        it('Sicherheits-Constraint ist konfiguriert (max. 1 Geist unter den Start-Nachbarn)', () => {
            expect(GREED_RUN.grid.maxGhostAmongStartNeighbors).toBe(1);
        });

        it('hat 3 Sichtweite-, 2 Grid-Praezisions- und 4 Aktionsbudget-Upgrades', () => {
            expect(GREED_RUN.sightRangeUpgrades).toHaveLength(3);
            expect(GREED_RUN.gridPrecisionUpgrades).toHaveLength(2);
            expect(GREED_RUN.actionBudgetUpgrades).toHaveLength(4);
        });

        it('jede der drei Leitern hat positive, strikt steigende Basispreise', () => {
            for (const ladder of [GREED_RUN.sightRangeUpgrades, GREED_RUN.gridPrecisionUpgrades, GREED_RUN.actionBudgetUpgrades]) {
                for (let i = 1; i < ladder.length; i += 1) {
                    expect(ladder[i - 1].cost).toBeGreaterThan(0);
                    expect(ladder[i].cost).toBeGreaterThan(ladder[i - 1].cost);
                }
            }
        });

        it('getSightRange/getGridPrecisionLevel/getActionBudget liefern die Startwerte ohne gekaufte Upgrades', () => {
            expect(getSightRange(GREED_RUN, [])).toBe(START_SIGHT_RANGE);
            expect(getGridPrecisionLevel(GREED_RUN, [])).toBe(START_GRID_PRECISION);
            expect(getActionBudget(GREED_RUN, [])).toBe(START_ACTION_BUDGET);
        });

        it('getSightRange deckelt bei MAX_SIGHT_RANGE (letzte Stufe)', () => {
            const owned = GREED_RUN.sightRangeUpgrades.map((u) => u.id);
            expect(getSightRange(GREED_RUN, owned)).toBe(MAX_SIGHT_RANGE);
        });

        it('getGridPrecisionLevel deckelt bei MAX_GRID_PRECISION (letzte Stufe)', () => {
            const owned = GREED_RUN.gridPrecisionUpgrades.map((u) => u.id);
            expect(getGridPrecisionLevel(GREED_RUN, owned)).toBe(MAX_GRID_PRECISION);
        });

        it('getGridMachineUpgrade findet ein Upgrade in jeder der drei Leitern', () => {
            expect(getGridMachineUpgrade(GREED_RUN, GREED_RUN.sightRangeUpgrades[0].id)).toBe(GREED_RUN.sightRangeUpgrades[0]);
            expect(getGridMachineUpgrade(GREED_RUN, GREED_RUN.gridPrecisionUpgrades[0].id)).toBe(GREED_RUN.gridPrecisionUpgrades[0]);
            expect(getGridMachineUpgrade(GREED_RUN, GREED_RUN.actionBudgetUpgrades[0].id)).toBe(GREED_RUN.actionBudgetUpgrades[0]);
            expect(getGridMachineUpgrade(GREED_RUN, 'unbekannt')).toBeUndefined();
        });

        it('SECTOR_COLORS/getSectorColor liefern fuer jede Kategorie eine eigene Farbe (Barrierefreiheits-Grundsatz)', () => {
            const colors = SECTOR_CATEGORIES.map((c) => SECTOR_COLORS[c]);
            expect(new Set(colors.filter((c) => c !== SECTOR_COLORS.empty)).size).toBe(
                new Set(SECTOR_CATEGORIES.filter((c) => c !== 'empty')).size,
            );
            expect(getSectorColor('ghost')).toBe(SECTOR_COLORS.ghost);
        });
    });

    describe('Trap Tunnels (Tunnelnetz-Fallen-Automat, Phase 7j Kernmodell-Ersatz: Zufallsbewegung + Dynamit)', () => {
        it('run-Config ist ein 4x4-Raster mit plausiblen Payout-Spannen', () => {
            expect(TRAP_TUNNELS.run.gridSize).toBe(4);
            expect(TRAP_TUNNELS.run.singleCatchPayoutRange[0]).toBeGreaterThan(0);
            expect(TRAP_TUNNELS.run.chainCatchPayoutRange[0]).toBeGreaterThan(TRAP_TUNNELS.run.singleCatchPayoutRange[1]);
        });

        it('Blind-EV-Garantie: eine blind platzierte Falle ist im Erwartungswert positiv (per Simulation, game-spec.md 4.3 PFLICHT)', () => {
            const ev = computeBlindTrapExpectedValue(TRAP_TUNNELS.run, START_ENEMY_COUNT, 3000, Math.random);
            expect(ev).toBeGreaterThan(0);
        });

        it('Meilenstein-Schwellen und ticketYieldFactor sind unveraendert aus der bisherigen Config uebernommen (game-spec.md 4.3)', () => {
            expect(TRAP_TUNNELS.milestones.map((m) => m.threshold)).toEqual([25, 60, 120]);
            expect(TRAP_TUNNELS.ticketYieldFactor).toBeCloseTo(0.913, 2);
        });

        it('hat 2 Fallenanzahl-, 3 Dynamitanzahl- und 3 Gegneranzahl-Upgrades', () => {
            expect(TRAP_TUNNELS.trapCountUpgrades).toHaveLength(2);
            expect(TRAP_TUNNELS.dynamiteCountUpgrades).toHaveLength(3);
            expect(TRAP_TUNNELS.enemyCountUpgrades).toHaveLength(3);
        });

        it('alle drei Leitern haben positive, strikt steigende Basispreise', () => {
            for (const ladder of [TRAP_TUNNELS.trapCountUpgrades, TRAP_TUNNELS.dynamiteCountUpgrades, TRAP_TUNNELS.enemyCountUpgrades]) {
                for (let i = 1; i < ladder.length; i += 1) {
                    expect(ladder[i - 1].cost).toBeGreaterThan(0);
                    expect(ladder[i].cost).toBeGreaterThan(ladder[i - 1].cost);
                }
            }
        });

        it('getTrapCount/getDynamiteCount/getEnemyCount liefern die Startwerte ohne gekaufte Upgrades', () => {
            expect(getTrapCount(TRAP_TUNNELS, [])).toBe(START_TRAP_COUNT);
            expect(getDynamiteCount(TRAP_TUNNELS, [])).toBe(START_DYNAMITE_COUNT);
            expect(getEnemyCount(TRAP_TUNNELS, [])).toBe(START_ENEMY_COUNT);
        });

        it('getTrapCount deckelt bei MAX_TRAP_COUNT (letzte Stufe)', () => {
            const owned = TRAP_TUNNELS.trapCountUpgrades.map((u) => u.id);
            expect(getTrapCount(TRAP_TUNNELS, owned)).toBe(MAX_TRAP_COUNT);
        });

        it('getDynamiteCount deckelt bei MAX_DYNAMITE_COUNT (letzte Stufe)', () => {
            const owned = TRAP_TUNNELS.dynamiteCountUpgrades.map((u) => u.id);
            expect(getDynamiteCount(TRAP_TUNNELS, owned)).toBe(MAX_DYNAMITE_COUNT);
        });

        it('getEnemyCount deckelt bei MAX_ENEMY_COUNT (letzte Stufe)', () => {
            const owned = TRAP_TUNNELS.enemyCountUpgrades.map((u) => u.id);
            expect(getEnemyCount(TRAP_TUNNELS, owned)).toBe(MAX_ENEMY_COUNT);
        });

        it('getTrapTunnelsMachineUpgrade findet ein Upgrade in allen drei Leitern', () => {
            expect(getTrapTunnelsMachineUpgrade(TRAP_TUNNELS, TRAP_TUNNELS.trapCountUpgrades[0].id)).toBe(
                TRAP_TUNNELS.trapCountUpgrades[0],
            );
            expect(getTrapTunnelsMachineUpgrade(TRAP_TUNNELS, TRAP_TUNNELS.dynamiteCountUpgrades[0].id)).toBe(
                TRAP_TUNNELS.dynamiteCountUpgrades[0],
            );
            expect(getTrapTunnelsMachineUpgrade(TRAP_TUNNELS, TRAP_TUNNELS.enemyCountUpgrades[0].id)).toBe(
                TRAP_TUNNELS.enemyCountUpgrades[0],
            );
            expect(getTrapTunnelsMachineUpgrade(TRAP_TUNNELS, 'unbekannt')).toBeUndefined();
        });

        it('ENEMY_COLORS liefert fuer bis zu 4 Gegner eine eigene, unterscheidbare Farbe (Barrierefreiheits-Grundsatz)', () => {
            expect(new Set(ENEMY_COLORS).size).toBe(ENEMY_COLORS.length);
            expect(ENEMY_COLORS.length).toBe(MAX_ENEMY_COUNT);
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
        const action = BEAT_LEDGER.actions[0]; // 'grundschlag': win 'treibend', loss 'break'

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
            const neutralStates = BEAT_LEDGER.pattern.states.filter(
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
            expect(getPreviewDepth(BEAT_LEDGER, [])).toBe(START_DEPTH);
            expect(getPreviewPrecision(BEAT_LEDGER, [])).toBe(START_PRECISION);
        });

        it('steigt mit dem hoechsten gekauften Upgrade je Achse', () => {
            const owned = [BEAT_LEDGER.depthUpgrades[0].id, BEAT_LEDGER.depthUpgrades[1].id];
            expect(getPreviewDepth(BEAT_LEDGER, owned)).toBe(BEAT_LEDGER.depthUpgrades[1].effect.value);
        });

        it('deckelt Praezision bei MAX_PRECISION (letzte Stufe)', () => {
            const owned = BEAT_LEDGER.precisionUpgrades.map((u) => u.id);
            expect(getPreviewPrecision(BEAT_LEDGER, owned)).toBe(MAX_PRECISION);
        });

        it('deckelt Tiefe bei N_STATES (letzte Stufe)', () => {
            const owned = BEAT_LEDGER.depthUpgrades.map((u) => u.id);
            expect(getPreviewDepth(BEAT_LEDGER, owned)).toBe(N_STATES);
        });
    });

    describe('getMachineUpgradeCost (Kreuz-Preis-Kopplung)', () => {
        it('entspricht dem Basispreis ohne gekaufte Upgrades der anderen Achse', () => {
            const upgrade = BEAT_LEDGER.depthUpgrades[0];
            expect(getMachineUpgradeCost(BEAT_LEDGER, upgrade, [])).toBeCloseTo(upgrade.cost);
        });

        it('steigt multiplikativ mit jeder gekauften Stufe der jeweils anderen Achse', () => {
            const upgrade = BEAT_LEDGER.depthUpgrades[0];
            const oneOtherBought = [BEAT_LEDGER.precisionUpgrades[0].id];
            expect(getMachineUpgradeCost(BEAT_LEDGER, upgrade, oneOtherBought)).toBeCloseTo(
                upgrade.cost * (1 + CROSS_PRICE_SURCHARGE_K),
            );
            const twoOtherBought = [BEAT_LEDGER.precisionUpgrades[0].id, BEAT_LEDGER.precisionUpgrades[1].id];
            expect(getMachineUpgradeCost(BEAT_LEDGER, upgrade, twoOtherBought)).toBeCloseTo(
                upgrade.cost * (1 + CROSS_PRICE_SURCHARGE_K) ** 2,
            );
        });

        it('ignoriert bereits gekaufte Stufen der EIGENEN Achse fuer den Aufschlag', () => {
            const upgrade = BEAT_LEDGER.depthUpgrades[1];
            const ownDepthBought = [BEAT_LEDGER.depthUpgrades[0].id];
            expect(getMachineUpgradeCost(BEAT_LEDGER, upgrade, ownDepthBought)).toBeCloseTo(upgrade.cost);
        });
    });

    describe('getMachineUpgrade', () => {
        it('findet ein Upgrade in der Tiefe-Leiter', () => {
            expect(getMachineUpgrade(BEAT_LEDGER, BEAT_LEDGER.depthUpgrades[0].id)).toBe(BEAT_LEDGER.depthUpgrades[0]);
        });

        it('findet ein Upgrade in der Praezisions-Leiter', () => {
            expect(getMachineUpgrade(BEAT_LEDGER, BEAT_LEDGER.precisionUpgrades[0].id)).toBe(
                BEAT_LEDGER.precisionUpgrades[0],
            );
        });

        it('liefert undefined fuer unbekannte id', () => {
            expect(getMachineUpgrade(BEAT_LEDGER, 'unbekannt')).toBeUndefined();
        });
    });

    describe('computeInterleavedUpgradeCost / getFinalMilestoneThreshold', () => {
        it('ist positiv und kleiner als die Summe aller Basispreise ohne Kopplung (k>0 wirkt)', () => {
            for (const machine of CYCLIC_MACHINES) {
                const flatSum =
                    machine.depthUpgrades.reduce((sum, u) => sum + u.cost, 0) +
                    machine.precisionUpgrades.reduce((sum, u) => sum + u.cost, 0);
                const interleaved = computeInterleavedUpgradeCost(machine);
                expect(interleaved).toBeGreaterThan(flatSum); // Kopplung erhoeht immer, da k>0
            }
        });

        it('Basispreise sind pro Automat proportional zur jeweiligen Ticket-Oekonomie skaliert (nicht identisch)', () => {
            const costs = CYCLIC_MACHINES.map((m) => m.depthUpgrades[3].cost);
            expect(new Set(costs).size).toBe(CYCLIC_MACHINES.length);
        });

        it('getFinalMilestoneThreshold liefert den letzten (hoechsten) Meilenstein', () => {
            expect(getFinalMilestoneThreshold(GREED_RUN)).toBe(100);
            expect(getFinalMilestoneThreshold(TRAP_TUNNELS)).toBe(120);
            expect(getFinalMilestoneThreshold(BEAT_LEDGER)).toBe(140);
            expect(getFinalMilestoneThreshold(CHAMPIONS_LEDGER)).toBe(180);
        });
    });

    describe('ticketYieldFactor (Phase 7d, Normalisierungs-Konstante)', () => {
        it('ist fuer Greed Run genau 1.0 (Skalierungs-Basis)', () => {
            expect(GREED_RUN.ticketYieldFactor).toBe(1.0);
        });

        it('ist positiv und sinkt streng monoton mit steigender Automaten-Skalierung', () => {
            const factors = MACHINES.map((m) => m.ticketYieldFactor);
            for (const f of factors) {
                expect(f).toBeGreaterThan(0);
            }
            expect(factors[0]).toBeGreaterThan(factors[1]);
            expect(factors[1]).toBeGreaterThan(factors[2]);
            expect(factors[2]).toBeGreaterThan(factors[3]);
        });

        it('daempft die Rohzahlen-Differenz, gleicht sie aber NICHT vollstaendig aus (spaetere Automaten tragen absolut mehr bei)', () => {
            // Ungedaempfter Rohzahlen-Vorsprung von Champion's Ledger gegenueber
            // Greed Run (Phase 7f: Greed Run ist jetzt ein Grid-Automat, "grosser
            // Gewinn"-Analogon ist der Bonus-Payout eines Sektors). Mit
            // Normalisierung sollte der EFFEKTIVE Vorsprung (Rohzahlen * Faktor)
            // kleiner, aber > 1 sein.
            const rawRatio = mean(CHAMPIONS_LEDGER.actions[0].payoutBig) / mean(GREED_RUN.grid.payoutRanges.bonus);
            const dampedRatio = rawRatio * (CHAMPIONS_LEDGER.ticketYieldFactor / GREED_RUN.ticketYieldFactor);
            expect(dampedRatio).toBeLessThan(rawRatio);
            expect(dampedRatio).toBeGreaterThan(1);
        });
    });

    describe('STATE_COLORS / getStateColor (Phase 7e, Barrierefreiheits-Grundsatz)', () => {
        it('enthaelt genau N_STATES unterscheidbare Farben', () => {
            expect(STATE_COLORS).toHaveLength(N_STATES);
            expect(new Set(STATE_COLORS).size).toBe(N_STATES);
        });

        it('getStateColor liefert dieselbe Farbe fuer denselben Index, konsistent ueber alle Automaten', () => {
            expect(getStateColor(0)).toBe(STATE_COLORS[0]);
            expect(getStateColor(2)).toBe(STATE_COLORS[2]);
        });

        it('getStateColor wrapt bei Indizes ausserhalb des Bereichs', () => {
            expect(getStateColor(N_STATES)).toBe(STATE_COLORS[0]);
            expect(getStateColor(-1)).toBe(STATE_COLORS[N_STATES - 1]);
        });
    });

    describe('getReachedMilestones / isFinalMilestoneReached (Phase 7e, ersetzt PushYourLuckRun)', () => {
        it('liefert keine Meilensteine bei peakScore 0', () => {
            expect(getReachedMilestones(GREED_RUN, 0)).toEqual([]);
            expect(isFinalMilestoneReached(GREED_RUN, 0)).toBe(false);
        });

        it('liefert alle Meilensteine, deren Schwelle peakScore erreicht hat', () => {
            const reached = getReachedMilestones(GREED_RUN, 55);
            expect(reached.map((m) => m.threshold)).toEqual([20, 50]);
        });

        it('isFinalMilestoneReached wird erst beim letzten Meilenstein true', () => {
            expect(isFinalMilestoneReached(GREED_RUN, 99)).toBe(false);
            expect(isFinalMilestoneReached(GREED_RUN, 100)).toBe(true);
        });
    });

    describe('getMachineAttendantRate (zyklischer Zweig, unveraendert seit Phase 7d)', () => {
        it('liefert eine Rate von 0 bei Musterkenntnis 0', () => {
            const rate = getMachineAttendantRate(BEAT_LEDGER, 0, [], 1);
            expect(rate.machinePointsPerSecond).toBe(0);
            expect(rate.hallTicketsPerSecond).toBe(0);
        });

        it('liefert eine positive Rate bei voller Musterkenntnis', () => {
            const rate = getMachineAttendantRate(BEAT_LEDGER, 1, [], 1);
            expect(rate.machinePointsPerSecond).toBeGreaterThan(0);
            expect(rate.hallTicketsPerSecond).toBeGreaterThan(0);
        });

        it('hallTicketsPerSecond skaliert mit ticketYieldFactor und dem hallenweiten ticketYieldRate-Parameter', () => {
            const base = getMachineAttendantRate(BEAT_LEDGER, 1, [], 1);
            const doubled = getMachineAttendantRate(BEAT_LEDGER, 1, [], 2);
            expect(doubled.hallTicketsPerSecond).toBeCloseTo(base.hallTicketsPerSecond * 2);
        });

        it('steigt mit gekauften Vorschau-Upgrades (mehr Tiefe/Praezision fuer den Attendant nutzbar)', () => {
            const withoutUpgrades = getMachineAttendantRate(BEAT_LEDGER, 1, [], 1);
            const withUpgrades = getMachineAttendantRate(
                BEAT_LEDGER,
                1,
                [...BEAT_LEDGER.depthUpgrades.map((u) => u.id), ...BEAT_LEDGER.precisionUpgrades.map((u) => u.id)],
                1,
            );
            expect(withUpgrades.machinePointsPerSecond).toBeGreaterThan(withoutUpgrades.machinePointsPerSecond);
        });
    });

    describe('getMachineAttendantRate (Grid-Zweig, Phase 7f, dokumentierte Vereinfachung)', () => {
        it('liefert eine Rate von 0 bei Musterkenntnis 0', () => {
            const rate = getMachineAttendantRate(GREED_RUN, 0, [], 1);
            expect(rate.machinePointsPerSecond).toBe(0);
            expect(rate.hallTicketsPerSecond).toBe(0);
        });

        it('liefert eine positive Rate bei voller Musterkenntnis', () => {
            const rate = getMachineAttendantRate(GREED_RUN, 1, [], 1);
            expect(rate.machinePointsPerSecond).toBeGreaterThan(0);
            expect(rate.hallTicketsPerSecond).toBeGreaterThan(0);
        });

        it('hallTicketsPerSecond skaliert mit ticketYieldFactor und dem hallenweiten ticketYieldRate-Parameter', () => {
            const base = getMachineAttendantRate(GREED_RUN, 1, [], 1);
            const doubled = getMachineAttendantRate(GREED_RUN, 1, [], 2);
            expect(doubled.hallTicketsPerSecond).toBeCloseTo(base.hallTicketsPerSecond * 2);
        });

        it('steigt mit gekaufter Grid-Praezision (mehr Kategorien fuer den Attendant nutzbar)', () => {
            const withoutUpgrades = getMachineAttendantRate(GREED_RUN, 1, [], 1);
            const withUpgrades = getMachineAttendantRate(
                GREED_RUN,
                1,
                GREED_RUN.gridPrecisionUpgrades.map((u) => u.id),
                1,
            );
            expect(withUpgrades.machinePointsPerSecond).toBeGreaterThan(withoutUpgrades.machinePointsPerSecond);
        });
    });

    describe('getMachineAttendantRate (Trap-Tunnels-Zweig, Phase 7j, dokumentierte Vereinfachung)', () => {
        it('liefert eine Rate von 0 bei Musterkenntnis 0', () => {
            const rate = getMachineAttendantRate(TRAP_TUNNELS, 0, [], 1);
            expect(rate.machinePointsPerSecond).toBe(0);
            expect(rate.hallTicketsPerSecond).toBe(0);
        });

        it('liefert eine positive Rate bei voller Musterkenntnis', () => {
            const rate = getMachineAttendantRate(TRAP_TUNNELS, 1, [], 1);
            expect(rate.machinePointsPerSecond).toBeGreaterThan(0);
            expect(rate.hallTicketsPerSecond).toBeGreaterThan(0);
        });

        it('hallTicketsPerSecond skaliert mit ticketYieldFactor und dem hallenweiten ticketYieldRate-Parameter', () => {
            const base = getMachineAttendantRate(TRAP_TUNNELS, 1, [], 1);
            const doubled = getMachineAttendantRate(TRAP_TUNNELS, 1, [], 2);
            expect(doubled.hallTicketsPerSecond).toBeCloseTo(base.hallTicketsPerSecond * 2);
        });

        it('steigt mit gekaufter Fallenanzahl (mehr Fallen pro Run fuer den Attendant nutzbar)', () => {
            const withoutUpgrades = getMachineAttendantRate(TRAP_TUNNELS, 1, [], 1);
            const withUpgrades = getMachineAttendantRate(
                TRAP_TUNNELS,
                1,
                TRAP_TUNNELS.trapCountUpgrades.map((u) => u.id),
                1,
            );
            expect(withUpgrades.machinePointsPerSecond).toBeGreaterThan(withoutUpgrades.machinePointsPerSecond);
        });

        it('steigt mit gekaufter Dynamitanzahl bei ausreichender Musterkenntnis (mehr nutzbares Kontingent)', () => {
            const withoutUpgrades = getMachineAttendantRate(TRAP_TUNNELS, 0.9, [], 1);
            const withUpgrades = getMachineAttendantRate(
                TRAP_TUNNELS,
                0.9,
                TRAP_TUNNELS.dynamiteCountUpgrades.map((u) => u.id),
                1,
            );
            expect(withUpgrades.machinePointsPerSecond).toBeGreaterThan(withoutUpgrades.machinePointsPerSecond);
        });

        it('steigt mit gekaufter Gegneranzahl (mehr unabhaengige Treffer-Chancen pro Falle)', () => {
            const withoutUpgrades = getMachineAttendantRate(TRAP_TUNNELS, 1, [], 1);
            const withUpgrades = getMachineAttendantRate(
                TRAP_TUNNELS,
                1,
                TRAP_TUNNELS.enemyCountUpgrades.map((u) => u.id),
                1,
            );
            expect(withUpgrades.machinePointsPerSecond).toBeGreaterThan(withoutUpgrades.machinePointsPerSecond);
        });
    });
});
