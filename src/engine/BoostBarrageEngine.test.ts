import { describe, expect, it } from 'vitest';
import type { BoostBarrageRunConfig } from './types';
import { BoostBarrageEngine, computeBlindWaveExpectedValue, generateWaveRoster, resolveEncounter } from './BoostBarrageEngine';

// Eigenstaendige Test-Fixture (Konvention wie TrapTunnelsEngine.test.ts):
// 6 Gegner pro Welle, Scout dominiert klar (70%), Bomber/Elite selten.
const FIXTURE_CONFIG: BoostBarrageRunConfig = {
    waveCount: 5,
    enemiesPerWave: 6,
    enemyWeights: { scout: 65, bomber: 20, elite: 15 },
    scoutPayoutRange: [3, 5],
    bomberDestroyPayoutRange: [10, 16],
    bomberHitCostRange: [8, 14],
    elitePayoutRange: [18, 26],
    baseBomberDestroyChance: 0.55,
    baseEliteHitChance: 0.3,
    escalationPerDestroyed: 0.03,
    firepowerDestroyBonusPerLevel: 0.2,
    firepowerScoutBonusPerLevel: 1,
    shieldDamageReductionPerLevel: 0.3,
    focusHitBonusPerLevel: 0.25,
    evadeDurationBaseSteps: 1,
    evadeDurationPerExtraLevel: 1,
    baseWarningMs: 1500,
    warningMsPerLevel: 750,
};

// rng, die einen festen Wert IMMER liefert -- macht Wahrscheinlichkeits-
// Entscheidungen (destroyChance/hitChance-Vergleiche) deterministisch
// steuerbar, waehrend draw() (Payout-Ziehung) denselben Wert innerhalb der
// jeweiligen Spanne nutzt.
function constantRng(value: number): () => number {
    return () => value;
}

describe('BoostBarrageEngine (Phase 7m, game-spec.md 4.4)', () => {
    describe('generateWaveRoster', () => {
        it('liefert genau enemiesPerWave-viele Gegner, alle gueltigen Typs', () => {
            const roster = generateWaveRoster(FIXTURE_CONFIG, Math.random);
            expect(roster).toHaveLength(FIXTURE_CONFIG.enemiesPerWave);
            for (const type of roster) {
                expect(['scout', 'bomber', 'elite']).toContain(type);
            }
        });

        it('ist deterministisch bei gleichem rng', () => {
            const rngValues = Array.from({ length: 50 }, (_, i) => (i * 0.173) % 1);
            let i = 0;
            const rng = () => rngValues[i++ % rngValues.length];
            i = 0;
            const a = generateWaveRoster(FIXTURE_CONFIG, rng);
            i = 0;
            const b = generateWaveRoster(FIXTURE_CONFIG, rng);
            expect(a).toEqual(b);
        });

        it('Scout ist ueber viele Ziehungen klar der haeufigste Typ (Gewichtung wirkt)', () => {
            const counts = { scout: 0, bomber: 0, elite: 0 };
            for (let i = 0; i < 5000; i += 1) {
                const roster = generateWaveRoster(FIXTURE_CONFIG, Math.random);
                for (const type of roster) counts[type] += 1;
            }
            expect(counts.scout).toBeGreaterThan(counts.bomber + counts.elite);
        });
    });

    describe('resolveEncounter', () => {
        it('Scout: immer zerstoert, Payout innerhalb der Spanne', () => {
            const outcome = resolveEncounter(FIXTURE_CONFIG, 'scout', 0, 1, [], constantRng(0.5));
            expect(outcome.destroyed).toBe(true);
            expect(outcome.payout).toBeGreaterThanOrEqual(FIXTURE_CONFIG.scoutPayoutRange[0]);
            expect(outcome.payout).toBeLessThanOrEqual(FIXTURE_CONFIG.scoutPayoutRange[1]);
        });

        it('Scout: Feuerkraft gibt einen Bonus-Payout obendrauf', () => {
            const without = resolveEncounter(FIXTURE_CONFIG, 'scout', 0, 1, [], constantRng(0));
            const withFirepower = resolveEncounter(FIXTURE_CONFIG, 'scout', 0, 1, ['firepower'], constantRng(0));
            expect(withFirepower.payout).toBeCloseTo(without.payout + FIXTURE_CONFIG.firepowerScoutBonusPerLevel);
        });

        it('Bomber: wird bei niedrigem Roll VOR dem Feuern zerstoert (positiver Payout)', () => {
            const outcome = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, [], constantRng(0));
            expect(outcome.destroyed).toBe(true);
            expect(outcome.payout).toBeGreaterThan(0);
        });

        it('Bomber: feuert bei hohem Roll (negativer Payout ohne Verteidigungs-Boost)', () => {
            const outcome = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, [], constantRng(0.999));
            expect(outcome.destroyed).toBe(false);
            expect(outcome.payout).toBeLessThan(0);
        });

        it('Bomber: Ausweichen negiert einen Treffer VOLLSTAENDIG', () => {
            const outcome = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, ['evade'], constantRng(0.999));
            expect(outcome.destroyed).toBe(false);
            expect(outcome.payout).toBe(0);
        });

        it('Bomber: Schild reduziert einen Treffer nur ANTEILIG (weiterhin negativ, aber kleinerer Betrag)', () => {
            const withoutShield = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, [], constantRng(0.999));
            const withShield = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, ['shield'], constantRng(0.999));
            expect(withShield.payout).toBeLessThan(0);
            expect(withShield.payout).toBeGreaterThan(withoutShield.payout);
        });

        it('Bomber: Feuerkraft erhoeht die Zerstoerungswahrscheinlichkeit VOR dem Feuern', () => {
            // Roll knapp ueber der Basis-Zerstoerungschance -- ohne Feuerkraft
            // feuert der Bomber, mit Feuerkraft-Bonus wird er noch zerstoert.
            const roll = FIXTURE_CONFIG.baseBomberDestroyChance + 0.05;
            const without = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, [], constantRng(roll));
            const withFirepower = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, ['firepower'], constantRng(roll));
            expect(without.destroyed).toBe(false);
            expect(withFirepower.destroyed).toBe(true);
        });

        it('Elite: ohne Fokus nur bei niedrigem Roll getroffen, sonst Payout 0 (kein negativer Fall)', () => {
            const hit = resolveEncounter(FIXTURE_CONFIG, 'elite', 0, 1, [], constantRng(0));
            expect(hit.destroyed).toBe(true);
            expect(hit.payout).toBeGreaterThan(0);

            const miss = resolveEncounter(FIXTURE_CONFIG, 'elite', 0, 1, [], constantRng(0.999));
            expect(miss.destroyed).toBe(false);
            expect(miss.payout).toBe(0);
        });

        it('Elite: Fokus garantiert einen Treffer (auch bei hohem Roll) mit Bonus-Payout', () => {
            const withFocus = resolveEncounter(FIXTURE_CONFIG, 'elite', 0, 1, ['focus'], constantRng(0.999));
            expect(withFocus.destroyed).toBe(true);
            const bareHit = resolveEncounter(FIXTURE_CONFIG, 'elite', 0, 1, [], constantRng(0));
            expect(withFocus.payout).toBeGreaterThan(0);
            // Fokus-Bonus multipliziert die Spanne, Ergebnis liegt daher ueber der reinen Spanne.
            expect(withFocus.payout).toBeGreaterThanOrEqual(bareHit.payout * (1 + FIXTURE_CONFIG.focusHitBonusPerLevel) * 0.99);
        });

        it('Eskalation senkt die Bomber-Zerstoerungschance mit steigender destroyedCount', () => {
            const roll = FIXTURE_CONFIG.baseBomberDestroyChance - 0.01;
            const early = resolveEncounter(FIXTURE_CONFIG, 'bomber', 0, 1, [], constantRng(roll));
            const late = resolveEncounter(FIXTURE_CONFIG, 'bomber', 10, 1, [], constantRng(roll));
            expect(early.destroyed).toBe(true);
            expect(late.destroyed).toBe(false);
        });
    });

    describe('computeBlindWaveExpectedValue (Blind-EV-Garantie, game-spec.md 4.4 PFLICHT)', () => {
        it('ist positiv ueber viele simulierte Wellen OHNE jeden Boost-Einsatz', () => {
            const ev = computeBlindWaveExpectedValue(FIXTURE_CONFIG, 4000, Math.random);
            expect(ev).toBeGreaterThan(0);
        });
    });

    describe('BoostBarrageEngine: Konstruktor-Validierung', () => {
        it('wirft bei nicht-positivem waveCount/enemiesPerWave/boostPowerLevel/maxCharges', () => {
            expect(() => new BoostBarrageEngine({ ...FIXTURE_CONFIG, waveCount: 0 }, 1, 1, Math.random)).toThrow(RangeError);
            expect(() => new BoostBarrageEngine({ ...FIXTURE_CONFIG, enemiesPerWave: 0 }, 1, 1, Math.random)).toThrow(RangeError);
            expect(() => new BoostBarrageEngine(FIXTURE_CONFIG, 0, 1, Math.random)).toThrow(RangeError);
            expect(() => new BoostBarrageEngine(FIXTURE_CONFIG, 1, 0, Math.random)).toThrow(RangeError);
        });
    });

    describe('BoostBarrageEngine: Ladungen/Aktivierung', () => {
        it('startet mit maxCharges Ladungen fuer alle vier Boost-Typen', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 2, Math.random);
            for (const boost of ['firepower', 'shield', 'evade', 'focus'] as const) {
                expect(engine.getCharges(boost)).toBe(2);
            }
        });

        it('activateBoost verbraucht genau eine Ladung, canActivateBoost wird false bei 0', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 1, Math.random);
            expect(engine.canActivateBoost('firepower')).toBe(true);
            expect(engine.activateBoost('firepower')).toBe(true);
            expect(engine.getCharges('firepower')).toBe(0);
            expect(engine.canActivateBoost('firepower')).toBe(false);
            expect(engine.activateBoost('firepower')).toBe(false);
        });

        it('aktivierter Boost erscheint in getActiveBoosts bis er im naechsten Gefecht verbraucht ist', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 1, Math.random);
            engine.activateBoost('shield');
            expect(engine.getActiveBoosts()).toContain('shield');
            engine.resolveNextEncounter();
            expect(engine.getActiveBoosts()).not.toContain('shield');
        });

        it('Ausweichen mit Boost-Staerke > 1 deckt mehrere aufeinanderfolgende Gefechte ab', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 2, 1, Math.random);
            engine.activateBoost('evade');
            expect(engine.getActiveBoosts()).toContain('evade');
            engine.resolveNextEncounter();
            expect(engine.getActiveBoosts()).toContain('evade');
            engine.resolveNextEncounter();
            expect(engine.getActiveBoosts()).not.toContain('evade');
        });

        it('ein waehrend eines aktiven Boosts erneut aktivierter Boost verlaengert die Dauer nicht rueckwaerts (max statt addiert)', () => {
            const engine = new BoostBarrageEngine({ ...FIXTURE_CONFIG, evadeDurationBaseSteps: 2 }, 1, 3, Math.random);
            engine.activateBoost('evade');
            engine.resolveNextEncounter();
            engine.activateBoost('evade');
            expect(engine.getActiveBoosts()).toContain('evade');
        });
    });

    describe('BoostBarrageEngine: Gefechts-/Wellen-/Lauf-Fortschritt', () => {
        it('resolveNextEncounter rueckt den Index vor und sammelt Ergebnisse in getWaveResults', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 1, Math.random);
            expect(engine.getCurrentEncounterIndex()).toBe(0);
            engine.resolveNextEncounter();
            expect(engine.getCurrentEncounterIndex()).toBe(1);
            expect(engine.getWaveResults()).toHaveLength(1);
        });

        it('wirft bei resolveNextEncounter, wenn die Welle bereits vollstaendig ist', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 1, Math.random);
            for (let i = 0; i < FIXTURE_CONFIG.enemiesPerWave; i += 1) engine.resolveNextEncounter();
            expect(engine.isWaveComplete()).toBe(true);
            expect(() => engine.resolveNextEncounter()).toThrow(RangeError);
        });

        it('wirft bei startNextWave, solange die aktuelle Welle noch nicht vollstaendig ist', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 1, Math.random);
            expect(() => engine.startNextWave()).toThrow(RangeError);
        });

        it('startNextWave erhoeht waveIndex, generiert ein neues Roster und setzt Ladungen zurueck', () => {
            const engine = new BoostBarrageEngine(FIXTURE_CONFIG, 1, 1, Math.random);
            engine.activateBoost('focus');
            for (let i = 0; i < FIXTURE_CONFIG.enemiesPerWave; i += 1) engine.resolveNextEncounter();
            expect(engine.getWaveIndex()).toBe(0);
            engine.startNextWave();
            expect(engine.getWaveIndex()).toBe(1);
            expect(engine.getCurrentEncounterIndex()).toBe(0);
            expect(engine.getCharges('focus')).toBe(1);
            expect(engine.getRoster()).toHaveLength(FIXTURE_CONFIG.enemiesPerWave);
        });

        it('der Lauf gilt automatisch als beendet, sobald die letzte Welle vollstaendig aufgeloest ist', () => {
            const engine = new BoostBarrageEngine({ ...FIXTURE_CONFIG, waveCount: 2 }, 1, 1, Math.random);
            for (let wave = 0; wave < 2; wave += 1) {
                for (let i = 0; i < FIXTURE_CONFIG.enemiesPerWave; i += 1) engine.resolveNextEncounter();
                if (wave === 0) {
                    expect(engine.isRunComplete()).toBe(false);
                    engine.startNextWave();
                }
            }
            expect(engine.isRunComplete()).toBe(true);
        });

        it('wirft bei resolveNextEncounter/startNextWave, nachdem der Lauf beendet ist', () => {
            const engine = new BoostBarrageEngine({ ...FIXTURE_CONFIG, waveCount: 1 }, 1, 1, Math.random);
            for (let i = 0; i < FIXTURE_CONFIG.enemiesPerWave; i += 1) engine.resolveNextEncounter();
            expect(engine.isRunComplete()).toBe(true);
            expect(() => engine.resolveNextEncounter()).toThrow(RangeError);
            expect(() => engine.startNextWave()).toThrow(RangeError);
        });

        it('canActivateBoost ist false, sobald der Lauf beendet ist', () => {
            const engine = new BoostBarrageEngine({ ...FIXTURE_CONFIG, waveCount: 1 }, 1, 1, Math.random);
            for (let i = 0; i < FIXTURE_CONFIG.enemiesPerWave; i += 1) engine.resolveNextEncounter();
            expect(engine.canActivateBoost('firepower')).toBe(false);
        });
    });
});
