import { describe, expect, it } from 'vitest';
import {
    ATTENDANT_MAX_EFFICIENCY,
    ATTENDANT_POOL_FACTOR_MAX,
    ATTENDANT_POOL_FACTOR_MIN,
    MANUAL_KNOWLEDGE_GAIN,
    MAX_OFFLINE_MS,
    TRAINING_KNOWLEDGE_GAIN,
    applyAttendantElapsed,
    computeStationaryDistribution,
    createInitialAttendantPool,
    gainKnowledgeFromManualPlay,
    gainKnowledgeFromTraining,
    getAttendantEfficiency,
    getAttendantExpectedValuePerAction,
    getAttendantLookahead,
    getAttendantMachinePointsRate,
    getAttendantPrecision,
    getGridAttendantExpectedValuePerMove,
    getGridAttendantMachinePointsRate,
    getGridPerfectInfoExpectedValue,
    getTrapTunnelsAttendantExpectedValuePerTrap,
    getTrapTunnelsAttendantMachinePointsRate,
    getTrapTunnelsBlindExpectedValuePerTrap,
    type AttendantRate,
} from './AttendantEngine';
import type { CyclicActionDef, GridSectorConfig, TrapTunnelsRunConfig } from './types';

// Handgebaute Fixture statt Import aus src/data/machines.config.ts -- die
// Engine-Tests bleiben damit unabhaengig von der konkreten Automaten-
// Konfiguration (wie schon vor Phase 7c/7d). 5 Zustaende/Aktionen im selben
// Zyklus wie "Greed Run" (machines.config.ts): actions[i] gewinnt bei
// states[i+1], verliert bei states[i-1].
const states = ['fern', 'nah', 'alarm', 'sichtkontakt', 'rueckzug'];
const payouts = { payoutBig: [16, 22] as [number, number], payoutSimple: [5, 8] as [number, number], payoutLoss: [-10, -7] as [number, number] };
const actions: CyclicActionDef[] = ['sprint', 'schleicher', 'ablenker', 'versteck', 'vorstoss'].map((id, i) => ({
    id,
    counterState: states[(i + 1) % states.length],
    losesToState: states[(i - 1 + states.length) % states.length],
    ...payouts,
}));
// actions[0] = sprint: win 'nah', loss 'rueckzug'

const uniformStationary = Object.fromEntries(states.map((s) => [s, 1 / states.length]));

function mean([a, b]: readonly [number, number]): number {
    return (a + b) / 2;
}

describe('AttendantEngine', () => {
    describe('getAttendantEfficiency', () => {
        it('ist 0 bei Musterkenntnis 0', () => {
            expect(getAttendantEfficiency(0)).toBe(0);
        });

        it('erreicht ATTENDANT_MAX_EFFICIENCY bei voller Musterkenntnis, nie mehr', () => {
            expect(getAttendantEfficiency(1)).toBeCloseTo(ATTENDANT_MAX_EFFICIENCY);
            expect(ATTENDANT_MAX_EFFICIENCY).toBeLessThan(1);
        });

        it('liegt im Richtwert 85-90% bei voller Musterkenntnis (game-spec.md 3.2)', () => {
            expect(getAttendantEfficiency(1)).toBeGreaterThanOrEqual(0.85);
            expect(getAttendantEfficiency(1)).toBeLessThanOrEqual(0.9);
        });

        it('klemmt Musterkenntnis ausserhalb [0, 1]', () => {
            expect(getAttendantEfficiency(-1)).toBe(0);
            expect(getAttendantEfficiency(2)).toBeCloseTo(ATTENDANT_MAX_EFFICIENCY);
        });

        it('skaliert linear mit der Musterkenntnis', () => {
            expect(getAttendantEfficiency(0.5)).toBeCloseTo(ATTENDANT_MAX_EFFICIENCY * 0.5);
        });
    });

    describe('getAttendantLookahead', () => {
        it('ist 0 bei Musterkenntnis 0, unabhaengig von der gekauften Tiefe', () => {
            expect(getAttendantLookahead(3, 0)).toBe(0);
        });

        it('entspricht bei voller Musterkenntnis genau der gekauften Tiefe (wie ein Spieler)', () => {
            expect(getAttendantLookahead(3, 1)).toBe(3);
            expect(getAttendantLookahead(1, 1)).toBe(1);
        });

        it('rundet auf ganze Zug-Anzahl ab', () => {
            expect(getAttendantLookahead(3, 0.5)).toBe(1); // floor(1.5)
        });

        it('klemmt Musterkenntnis ausserhalb [0, 1]', () => {
            expect(getAttendantLookahead(3, -1)).toBe(0);
            expect(getAttendantLookahead(3, 2)).toBe(3);
        });
    });

    describe('getAttendantPrecision', () => {
        it('ist 0 bei Musterkenntnis 0, unabhaengig von der gekauften Praezision', () => {
            expect(getAttendantPrecision(4, 0)).toBe(0);
        });

        it('entspricht bei voller Musterkenntnis genau der gekauften Praezision', () => {
            expect(getAttendantPrecision(4, 1)).toBe(4);
        });

        it('rundet auf eine ganze Kandidatenzahl ab', () => {
            expect(getAttendantPrecision(4, 0.5)).toBe(2);
        });
    });

    describe('computeStationaryDistribution', () => {
        it('liefert eine gueltige Verteilung (summiert zu 1) fuer eine gleichverteilte Zyklus-Kette', () => {
            const transitions = Object.fromEntries(
                states.map((s, i) => [s, { [states[(i + 1) % states.length]]: 1 }]),
            );
            const dist = computeStationaryDistribution({ states, transitions });
            const sum = Object.values(dist).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1);
            for (const s of states) {
                expect(dist[s]).toBeCloseTo(1 / states.length, 2);
            }
        });

        it('konvergiert bei einer geskewten Kette auf eine nicht-uniforme Verteilung', () => {
            const transitions = {
                fern: { fern: 0.9, nah: 0.1 },
                nah: { fern: 0.9, nah: 0.1 },
            };
            const dist = computeStationaryDistribution({ states: ['fern', 'nah'], transitions });
            expect(dist.fern).toBeGreaterThan(dist.nah);
        });
    });

    describe('getAttendantExpectedValuePerAction', () => {
        it('wirft bei leerer actions-Liste', () => {
            expect(() => getAttendantExpectedValuePerAction([], uniformStationary, 1, 1, 4)).toThrow(RangeError);
        });

        it('liefert bei Lookahead 0 exakt die Blind-EV von actions[0]', () => {
            const ev = getAttendantExpectedValuePerAction(actions, uniformStationary, 0, 3, 4);
            const expected =
                uniformStationary['nah'] * mean(actions[0].payoutBig) +
                uniformStationary['rueckzug'] * mean(actions[0].payoutLoss) +
                (1 - uniformStationary['nah'] - uniformStationary['rueckzug']) * mean(actions[0].payoutSimple);
            expect(ev).toBeCloseTo(expected);
        });

        it('liefert bei Praezision 0 (aber Lookahead > 0) dieselbe Blind-EV wie bei Lookahead 0', () => {
            const blind = getAttendantExpectedValuePerAction(actions, uniformStationary, 0, 0, 4);
            const withLookaheadNoPrecision = getAttendantExpectedValuePerAction(actions, uniformStationary, 2, 0, 4);
            expect(withLookaheadNoPrecision).toBeCloseTo(blind);
        });

        it('liefert bei maximaler Praezision die Perfekt-Info-EV (immer Grosser Gewinn)', () => {
            const ev = getAttendantExpectedValuePerAction(actions, uniformStationary, 1, 4, 4);
            const expected = actions.reduce((sum, a) => sum + uniformStationary[a.counterState] * mean(a.payoutBig), 0);
            expect(ev).toBeCloseTo(expected);
        });

        it('ist streng monoton steigend in der Praezision (mehr Info ist nie schlechter)', () => {
            const evs = [0, 1, 2, 3, 4].map((p) => getAttendantExpectedValuePerAction(actions, uniformStationary, 1, p, 4));
            for (let i = 1; i < evs.length; i += 1) {
                expect(evs[i]).toBeGreaterThan(evs[i - 1]);
            }
        });

        it('Perfekt-Info-EV liegt ueber der Blind-EV (Vorschau lohnt sich, design-toolbox.md 1.10)', () => {
            const blind = getAttendantExpectedValuePerAction(actions, uniformStationary, 0, 0, 4);
            const perfect = getAttendantExpectedValuePerAction(actions, uniformStationary, 1, 4, 4);
            expect(perfect).toBeGreaterThan(blind);
        });
    });

    describe('getAttendantMachinePointsRate', () => {
        it('ist 0 bei Musterkenntnis 0 (Effizienz 0)', () => {
            expect(getAttendantMachinePointsRate(actions, uniformStationary, 0, 3, 3, 4)).toBe(0);
        });

        it('steigt mit der Musterkenntnis (mehr Effizienz UND mehr Lookahead/Praezision)', () => {
            const low = getAttendantMachinePointsRate(actions, uniformStationary, 0.2, 3, 3, 4);
            const high = getAttendantMachinePointsRate(actions, uniformStationary, 0.9, 3, 3, 4);
            expect(high).toBeGreaterThan(low);
        });

        it('ist niemals negativ, selbst bei entartetem Input', () => {
            const skewed = { fern: 1, nah: 0, alarm: 0, sichtkontakt: 0, rueckzug: 0 };
            expect(getAttendantMachinePointsRate(actions, skewed, 1, 3, 3, 4)).toBeGreaterThanOrEqual(0);
        });
    });

    describe('applyAttendantElapsed', () => {
        const rate: AttendantRate = { machinePointsPerSecond: 2, hallTicketsPerSecond: 1 };

        it('offline-Pfad (grosse Luecke): wendet Rate * Zeit direkt an, Pool bleibt unveraendert', () => {
            const pool = createInitialAttendantPool();
            const result = applyAttendantElapsed(pool, rate, 60_000, { foregroundThresholdMs: 15_000 });

            expect(result.machinePointsGained).toBeCloseTo(2 * 60);
            expect(result.hallTicketsGained).toBeCloseTo(1 * 60);
            expect(result.pool).toEqual(pool);
        });

        it('deckelt die angerechnete Abwesenheit bei MAX_OFFLINE_MS', () => {
            const pool = createInitialAttendantPool();
            const result = applyAttendantElapsed(pool, rate, MAX_OFFLINE_MS * 10, { foregroundThresholdMs: 15_000 });

            expect(result.machinePointsGained).toBeCloseTo(2 * (MAX_OFFLINE_MS / 1000));
        });

        it('Vordergrund-Pfad (kleine Luecke, kein voller Zyklus): fuellt den Pool ohne Ausschuettung', () => {
            const pool = createInitialAttendantPool();
            const result = applyAttendantElapsed(pool, rate, 1000, { cycleMs: 4000, foregroundThresholdMs: 15_000 });

            expect(result.machinePointsGained).toBe(0);
            expect(result.hallTicketsGained).toBe(0);
            expect(result.pool.machinePoints).toBeCloseTo(2 * 1);
            expect(result.pool.hallTickets).toBeCloseTo(1 * 1);
            expect(result.pool.msSincePayout).toBe(1000);
        });

        it('schuettet bei ueberschrittener Zyklusdauer mit Faktor aus dem Bereich [0.8, 1.2] aus', () => {
            const pool = createInitialAttendantPool();
            const fixedRng = () => 0.5; // Faktor exakt 1.0
            const result = applyAttendantElapsed(pool, rate, 4000, { cycleMs: 4000, foregroundThresholdMs: 15_000, rng: fixedRng });

            // Pool nach Fill: 2*4=8 Punkte, 1*4=4 Tickets. Faktor 1.0 -> alles ausgeschuettet.
            expect(result.machinePointsGained).toBeCloseTo(8);
            expect(result.hallTicketsGained).toBeCloseTo(4);
            expect(result.pool.machinePoints).toBeCloseTo(0);
            expect(result.pool.msSincePayout).toBe(0);
        });

        it('verarbeitet mehrere Zyklen in einem Aufruf (grosser, aber unter der Schwelle liegender Sprung)', () => {
            const pool = createInitialAttendantPool();
            const fixedRng = () => 0.5; // Faktor 1.0 -> voller Ausgleich pro Zyklus
            const result = applyAttendantElapsed(pool, rate, 12_000, { cycleMs: 4000, foregroundThresholdMs: 15_000, rng: fixedRng });

            // 3 volle Zyklen a 4s, Faktor 1 -> Gesamtausschuettung = 3 * (2*4) = 24
            expect(result.machinePointsGained).toBeCloseTo(24);
            expect(result.pool.msSincePayout).toBe(0);
        });

        it('behaelt eine Abweichung vom Faktor 1 im Pool (Defizit bei Faktor < 1)', () => {
            const pool = createInitialAttendantPool();
            const lowRng = () => 0; // Faktor exakt ATTENDANT_POOL_FACTOR_MIN (0.8)
            const result = applyAttendantElapsed(pool, rate, 4000, { cycleMs: 4000, foregroundThresholdMs: 15_000, rng: lowRng });

            expect(result.machinePointsGained).toBeCloseTo(8 * ATTENDANT_POOL_FACTOR_MIN);
            expect(result.pool.machinePoints).toBeCloseTo(8 * (1 - ATTENDANT_POOL_FACTOR_MIN));
        });

        it('Ausschuettung ist nie negativ, auch wenn der Pool durch vorherigen Ueberschuss negativ startet', () => {
            const negativePool = { machinePoints: -5, hallTickets: -2, msSincePayout: 0 };
            const result = applyAttendantElapsed(negativePool, rate, 4000, { cycleMs: 4000, foregroundThresholdMs: 15_000 });

            expect(result.machinePointsGained).toBeGreaterThanOrEqual(0);
            expect(result.hallTicketsGained).toBeGreaterThanOrEqual(0);
        });

        it('konvergiert ueber viele Zyklen zur zugrunde liegenden Rate (Teleskopsumme, STATUS.md)', () => {
            let pool = createInitialAttendantPool();
            let totalGained = 0;
            let seed = 1;
            const pseudoRng = () => {
                // Deterministischer, aber ueber viele Aufrufe gut verteilter Pseudo-Zufall.
                seed = (seed * 9301 + 49297) % 233280;
                return seed / 233280;
            };
            const cycles = 500;
            for (let i = 0; i < cycles; i += 1) {
                const result = applyAttendantElapsed(pool, rate, 4000, { cycleMs: 4000, foregroundThresholdMs: 15_000, rng: pseudoRng });
                pool = result.pool;
                totalGained += result.machinePointsGained;
            }
            const expectedTotal = rate.machinePointsPerSecond * (cycles * 4000) / 1000;
            // Nach vielen Zyklen bleibt nur der (kleine, beschraenkte) Pool-Rest als Abweichung.
            expect(Math.abs(totalGained - expectedTotal)).toBeLessThan(rate.machinePointsPerSecond * 5);
        });
    });

    describe('createInitialAttendantPool', () => {
        it('liefert einen leeren Pool', () => {
            expect(createInitialAttendantPool()).toEqual({ machinePoints: 0, hallTickets: 0, msSincePayout: 0 });
        });
    });

    describe('ATTENDANT_POOL_FACTOR_MIN/MAX', () => {
        it('bildet einen Bereich um 1.0 (0.8-1.2 laut STATUS.md)', () => {
            expect(ATTENDANT_POOL_FACTOR_MIN).toBe(0.8);
            expect(ATTENDANT_POOL_FACTOR_MAX).toBe(1.2);
        });
    });

    describe('gainKnowledgeFromManualPlay / gainKnowledgeFromTraining', () => {
        it('erhoeht die Musterkenntnis um MANUAL_KNOWLEDGE_GAIN bzw. TRAINING_KNOWLEDGE_GAIN', () => {
            expect(gainKnowledgeFromManualPlay(0.5)).toBeCloseTo(0.5 + MANUAL_KNOWLEDGE_GAIN);
            expect(gainKnowledgeFromTraining(0.5)).toBeCloseTo(0.5 + TRAINING_KNOWLEDGE_GAIN);
        });

        it('klemmt bei 1', () => {
            expect(gainKnowledgeFromManualPlay(0.999)).toBe(1);
            expect(gainKnowledgeFromTraining(0.999)).toBe(1);
        });

        it('manuelles Spielen steigert die Musterkenntnis schneller als Tickets-Training (game-spec.md 3.2)', () => {
            expect(MANUAL_KNOWLEDGE_GAIN).toBeGreaterThan(TRAINING_KNOWLEDGE_GAIN);
        });
    });

    // Eigenstaendige Grid-Fixture (Phase 7f, game-spec.md 4.2) -- dieselbe
    // Unabhaengigkeit von machines.config.ts wie oben. 24 Nicht-Start-Sektoren:
    // 5 Geist, 14 Punkte, 3 Leer, 2 Bonus.
    const gridConfig: GridSectorConfig = {
        gridSize: 5,
        categoryCounts: { ghost: 5, points: 14, empty: 3, bonus: 2 },
        payoutRanges: { ghost: [-10, -6], points: [3, 6], empty: [0, 0], bonus: [15, 22] },
        maxGhostAmongStartNeighbors: 1,
    };

    describe('getGridPerfectInfoExpectedValue (Phase 7f, dokumentierte Vereinfachung)', () => {
        it('ist positiv und liegt ueber der Blind-EV (Geister werden bei perfekter Kenntnis vollstaendig vermieden)', () => {
            const perfect = getGridPerfectInfoExpectedValue(gridConfig);
            expect(perfect).toBeGreaterThan(0);
        });

        it('ist 0, wenn ausschliesslich Geister konfiguriert sind (kein Nicht-Geist-Sektor uebrig)', () => {
            const onlyGhosts: GridSectorConfig = {
                ...gridConfig,
                categoryCounts: { ghost: 24, points: 0, empty: 0, bonus: 0 },
            };
            expect(getGridPerfectInfoExpectedValue(onlyGhosts)).toBe(0);
        });
    });

    describe('getGridAttendantExpectedValuePerMove', () => {
        it('entspricht bei Praezision 0 der Blind-EV', () => {
            const ev = getGridAttendantExpectedValuePerMove(gridConfig, 0, 3);
            // Blind-EV der Fixture (siehe GridRunEngine.test.ts): 5/24*(-8) + 14/24*4.5 + 3/24*0 + 2/24*18.5 = 2.5
            expect(ev).toBeCloseTo(2.5, 1);
        });

        it('entspricht bei maximaler Praezision der Perfekt-Info-EV', () => {
            const ev = getGridAttendantExpectedValuePerMove(gridConfig, 3, 3);
            expect(ev).toBeCloseTo(getGridPerfectInfoExpectedValue(gridConfig));
        });

        it('ist streng monoton steigend in der Praezision (mehr Info ist nie schlechter)', () => {
            const evs = [0, 1, 2, 3].map((p) => getGridAttendantExpectedValuePerMove(gridConfig, p, 3));
            for (let i = 1; i < evs.length; i += 1) {
                expect(evs[i]).toBeGreaterThanOrEqual(evs[i - 1]);
            }
            expect(evs[3]).toBeGreaterThan(evs[0]);
        });
    });

    describe('getGridAttendantMachinePointsRate', () => {
        it('ist 0 bei Musterkenntnis 0 (Effizienz 0)', () => {
            expect(getGridAttendantMachinePointsRate(gridConfig, 0, 3, 3)).toBe(0);
        });

        it('steigt mit der Musterkenntnis (mehr Effizienz UND mehr nutzbare Praezision)', () => {
            const low = getGridAttendantMachinePointsRate(gridConfig, 0.2, 3, 3);
            const high = getGridAttendantMachinePointsRate(gridConfig, 0.9, 3, 3);
            expect(high).toBeGreaterThan(low);
        });

        it('ist niemals negativ, selbst bei entarteter (rein negativer) Konfiguration', () => {
            const allGhost: GridSectorConfig = {
                ...gridConfig,
                categoryCounts: { ghost: 24, points: 0, empty: 0, bonus: 0 },
            };
            expect(getGridAttendantMachinePointsRate(allGhost, 1, 3, 3)).toBeGreaterThanOrEqual(0);
        });
    });

    // Eigenstaendige Trap-Tunnels-Fixture (Phase 7i, game-spec.md 4.3) --
    // dieselbe Unabhaengigkeit von machines.config.ts wie oben.
    const trapTunnelsConfig: TrapTunnelsRunConfig = {
        gridSize: 4,
        extraEdgeRange: [3, 4],
        pathLength: 6,
        enemyCount: 2,
        minStartDistance: 3,
        singleCatchPayoutRange: [7, 12],
        chainCatchPayoutRange: [24, 34],
    };

    describe('getTrapTunnelsBlindExpectedValuePerTrap (Phase 7i, dokumentierte Vereinfachung)', () => {
        it('ist positiv (Blind-EV-Garantie gilt auch fuer die geschlossene Naeherung, nicht nur die Simulation)', () => {
            expect(getTrapTunnelsBlindExpectedValuePerTrap(trapTunnelsConfig)).toBeGreaterThan(0);
        });

        it('ist 0, wenn kein zweiter Gegner existiert UND die Payout-Spannen 0 sind (Gegenprobe)', () => {
            const zeroConfig: TrapTunnelsRunConfig = {
                ...trapTunnelsConfig,
                singleCatchPayoutRange: [0, 0],
                chainCatchPayoutRange: [0, 0],
            };
            expect(getTrapTunnelsBlindExpectedValuePerTrap(zeroConfig)).toBe(0);
        });
    });

    describe('getTrapTunnelsAttendantExpectedValuePerTrap', () => {
        it('entspricht bei Vorschau-Reichweite 0 der Blind-EV', () => {
            const ev = getTrapTunnelsAttendantExpectedValuePerTrap(trapTunnelsConfig, 0, 6);
            expect(ev).toBeCloseTo(getTrapTunnelsBlindExpectedValuePerTrap(trapTunnelsConfig));
        });

        it('naehert sich bei maximaler Vorschau-Reichweite dem garantierten Einzelfang-Mittelwert an', () => {
            const ev = getTrapTunnelsAttendantExpectedValuePerTrap(trapTunnelsConfig, 6, 6);
            const expectedSingleMean = (trapTunnelsConfig.singleCatchPayoutRange[0] + trapTunnelsConfig.singleCatchPayoutRange[1]) / 2;
            expect(ev).toBeCloseTo(expectedSingleMean);
        });
    });

    describe('getTrapTunnelsAttendantMachinePointsRate', () => {
        it('ist 0 bei Musterkenntnis 0 (Effizienz 0)', () => {
            expect(getTrapTunnelsAttendantMachinePointsRate(trapTunnelsConfig, 0, 3, 6, 6)).toBe(0);
        });

        it('steigt mit der Musterkenntnis (mehr Effizienz UND mehr nutzbare Vorschau-Reichweite)', () => {
            const low = getTrapTunnelsAttendantMachinePointsRate(trapTunnelsConfig, 0.2, 3, 6, 6);
            const high = getTrapTunnelsAttendantMachinePointsRate(trapTunnelsConfig, 0.9, 3, 6, 6);
            expect(high).toBeGreaterThan(low);
        });

        it('steigt mit der Fallenanzahl (linear, keine Pfad-Interaktion in der Naeherung)', () => {
            const oneTrap = getTrapTunnelsAttendantMachinePointsRate(trapTunnelsConfig, 1, 1, 6, 6);
            const threeTraps = getTrapTunnelsAttendantMachinePointsRate(trapTunnelsConfig, 1, 3, 6, 6);
            expect(threeTraps).toBeCloseTo(oneTrap * 3);
        });

        it('ist niemals negativ', () => {
            expect(getTrapTunnelsAttendantMachinePointsRate(trapTunnelsConfig, 1, 3, 6, 6)).toBeGreaterThanOrEqual(0);
        });
    });
});
