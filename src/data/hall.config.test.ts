import { describe, expect, it } from 'vitest';
import { MANUAL_KNOWLEDGE_GAIN, TRAINING_KNOWLEDGE_GAIN } from '../engine/AttendantEngine';
import { MACHINES } from './machines.config';
import {
    ATTENDANT_SPEED_UPGRADES,
    BASE_ATTENDANT_TRAINING_MULTIPLIER,
    BASE_TICKET_YIELD_RATE,
    HALL_UPGRADES,
    MACHINE_UNLOCK_UPGRADES,
    TICKET_YIELD_UPGRADES,
    getAttendantTrainingMultiplier,
    getEffectiveTrainingGain,
    getMachineUnlockUpgrade,
    getTicketYieldRate,
} from './hall.config';

describe('hall.config', () => {
    describe('Ticket-Ertragsrate (ersetzt Ticket->Credits-Umrechnungskurs)', () => {
        it('liefert die Basis-Rate ohne gekaufte Upgrades', () => {
            expect(getTicketYieldRate([])).toBe(BASE_TICKET_YIELD_RATE);
        });

        it('steigt mit jeder gekauften Stufe', () => {
            const rates = TICKET_YIELD_UPGRADES.map((upgrade) => getTicketYieldRate([upgrade.id]));
            const sorted = [...rates].sort((a, b) => a - b);
            expect(rates).toEqual(sorted);
            rates.forEach((rate) => expect(rate).toBeGreaterThan(BASE_TICKET_YIELD_RATE));
        });

        it('nimmt bei mehreren gekauften Stufen die hoechste, unabhaengig von der Reihenfolge', () => {
            const [tier1, tier2] = TICKET_YIELD_UPGRADES;
            expect(getTicketYieldRate([tier2.id, tier1.id])).toBe(getTicketYieldRate([tier1.id, tier2.id]));
        });
    });

    describe('Automaten-Freischaltung (ersetzt MACHINE_UNLOCK_COST)', () => {
        it('deckt alle Nicht-entryPoint-Automaten ab, mit steigenden Schwellen (game-spec.md 3.3)', () => {
            const nonEntryPoint = MACHINES.filter((machine) => !machine.entryPoint);
            expect(MACHINE_UNLOCK_UPGRADES).toHaveLength(nonEntryPoint.length);

            for (const machine of nonEntryPoint) {
                const upgrade = getMachineUnlockUpgrade(machine.id);
                expect(upgrade).toBeDefined();
                expect(upgrade!.cost).toBeGreaterThan(0);
            }

            const costs = MACHINE_UNLOCK_UPGRADES.map((upgrade) => upgrade.cost);
            const sorted = [...costs].sort((a, b) => a - b);
            expect(costs).toEqual(sorted);
        });

        it('liefert undefined fuer den entryPoint-Automaten (nie freischaltbar noetig)', () => {
            const entryPoint = MACHINES.find((machine) => machine.entryPoint)!;
            expect(getMachineUnlockUpgrade(entryPoint.id)).toBeUndefined();
        });
    });

    describe('Attendant-Trainingsgeschwindigkeit (Cross-Layer-Feedback, Baukasten 1.14)', () => {
        it('liefert den Basis-Multiplikator ohne gekaufte Upgrades', () => {
            expect(getAttendantTrainingMultiplier([])).toBe(BASE_ATTENDANT_TRAINING_MULTIPLIER);
        });

        it('steigt spuerbar mit jeder gekauften Stufe', () => {
            const multipliers = ATTENDANT_SPEED_UPGRADES.map((upgrade) => getAttendantTrainingMultiplier([upgrade.id]));
            const sorted = [...multipliers].sort((a, b) => a - b);
            expect(multipliers).toEqual(sorted);
            multipliers.forEach((multiplier) => expect(multiplier).toBeGreaterThan(BASE_ATTENDANT_TRAINING_MULTIPLIER));
        });

        it('bleibt selbst voll gekauft unter dem Verhaeltnis von manuellem Spielen zu Training (game-spec.md 3.2 bleibt gueltig)', () => {
            const maxMultiplier = Math.max(...ATTENDANT_SPEED_UPGRADES.map((upgrade) => getAttendantTrainingMultiplier([upgrade.id])));
            const maxEffectiveGain = TRAINING_KNOWLEDGE_GAIN * maxMultiplier;
            expect(maxEffectiveGain).toBeLessThan(MANUAL_KNOWLEDGE_GAIN);
        });

        it('getEffectiveTrainingGain entspricht TRAINING_KNOWLEDGE_GAIN * Multiplikator', () => {
            const [tier1] = ATTENDANT_SPEED_UPGRADES;
            const tier1Value = tier1.effect.type === 'attendantSpeed' ? tier1.effect.value : NaN;
            expect(getEffectiveTrainingGain([tier1.id])).toBeCloseTo(TRAINING_KNOWLEDGE_GAIN * tier1Value);
        });

        it('ohne Upgrades entspricht getEffectiveTrainingGain exakt TRAINING_KNOWLEDGE_GAIN (unveraendertes AttendantEngine-Verhalten)', () => {
            expect(getEffectiveTrainingGain([])).toBeCloseTo(TRAINING_KNOWLEDGE_GAIN);
        });
    });

    describe('HALL_UPGRADES', () => {
        it('enthaelt alle Upgrades aller drei Kategorien mit eindeutigen ids', () => {
            expect(HALL_UPGRADES).toHaveLength(
                TICKET_YIELD_UPGRADES.length + MACHINE_UNLOCK_UPGRADES.length + ATTENDANT_SPEED_UPGRADES.length,
            );
            const ids = HALL_UPGRADES.map((upgrade) => upgrade.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('jedes Upgrade hat einen positiven Preis und einen nicht-leeren Namen', () => {
            for (const upgrade of HALL_UPGRADES) {
                expect(upgrade.cost).toBeGreaterThan(0);
                expect(upgrade.name.length).toBeGreaterThan(0);
                expect(upgrade.description.length).toBeGreaterThan(0);
            }
        });
    });
});
