import { describe, expect, it, vi } from 'vitest';
import Decimal from 'break_infinity.js';
import { EconomyStore } from './EconomyStore';

describe('EconomyStore', () => {
    describe('createInitialState', () => {
        it('startet bei 0 Tickets ohne freigeschaltete Automaten', () => {
            const store = new EconomyStore();

            expect(store.getHallTickets().eq(0)).toBe(true);
            expect(store.getState().unlockedMachines).toEqual([]);
            expect(store.getState().hallUpgrades).toEqual([]);
            expect(store.getState().completedMachines).toEqual([]);
        });
    });

    describe('Automaten-Punkte (lokal pro Automat)', () => {
        it('addiert Automaten-Punkte pro Automat unabhaengig voneinander', () => {
            const store = new EconomyStore();

            store.addMachinePoints('greed-run', 10);
            store.addMachinePoints('greed-run', 5);
            store.addMachinePoints('trap-tunnels', 3);

            expect(store.getMachinePoints('greed-run').toNumber()).toBe(15);
            expect(store.getMachinePoints('trap-tunnels').toNumber()).toBe(3);
        });

        it('liefert 0 Automaten-Punkte fuer einen unbekannten Automaten', () => {
            const store = new EconomyStore();

            expect(store.getMachinePoints('unknown').eq(0)).toBe(true);
        });

        it('wirft bei negativen Betraegen statt still zu ignorieren', () => {
            const store = new EconomyStore();

            expect(() => store.addMachinePoints('greed-run', -1)).toThrow(RangeError);
        });

        it('emittiert machine-points-changed mit dem neuen Stand', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('machine-points-changed', listener);

            store.addMachinePoints('greed-run', 10);

            expect(listener).toHaveBeenCalledOnce();
            const payload = listener.mock.calls[0][0];
            expect(payload.machineId).toBe('greed-run');
            expect(payload.points.toNumber()).toBe(10);
        });
    });

    describe('machinePeakScore (Phase 7e)', () => {
        it('liefert 0 fuer einen Automaten ohne Fortschritt', () => {
            const store = new EconomyStore();
            expect(store.getMachinePeakScore('unknown').eq(0)).toBe(true);
        });

        it('addMachinePoints hebt den Peak mit an', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 30);
            expect(store.getMachinePeakScore('greed-run').toNumber()).toBe(30);
        });

        it('spendMachinePoints senkt den Peak NICHT', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 50);
            store.spendMachinePoints('greed-run', 40);

            expect(store.getMachinePoints('greed-run').toNumber()).toBe(10);
            expect(store.getMachinePeakScore('greed-run').toNumber()).toBe(50);
        });

        it('emittiert machine-peak-score-changed nur, wenn der Peak tatsaechlich steigt', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('machine-peak-score-changed', listener);

            store.addMachinePoints('greed-run', 20); // Peak 0 -> 20
            store.applyMachineScoreDelta('greed-run', -5); // aktuell 15, Peak bleibt 20
            store.addMachinePoints('greed-run', 3); // aktuell 18, Peak bleibt 20 (kein neuer Peak)

            expect(listener).toHaveBeenCalledOnce();
            expect(listener.mock.calls[0][0]).toEqual({ machineId: 'greed-run', peak: expect.anything() });
            expect(store.getMachinePeakScore('greed-run').toNumber()).toBe(20);
        });
    });

    describe('applyMachineScoreDelta (Phase 7e, ersetzt PushYourLuckRun.resolveAction+bank)', () => {
        it('addiert einen positiven Delta direkt und dauerhaft', () => {
            const store = new EconomyStore();
            store.applyMachineScoreDelta('greed-run', 12.5);
            expect(store.getMachinePoints('greed-run').toNumber()).toBeCloseTo(12.5);
        });

        it('zieht einen negativen Delta (Verlust-Fall) direkt ab', () => {
            const store = new EconomyStore();
            store.applyMachineScoreDelta('greed-run', 20);
            store.applyMachineScoreDelta('greed-run', -8);
            expect(store.getMachinePoints('greed-run').toNumber()).toBeCloseTo(12);
        });

        it('klemmt den Punktestand bei 0, wenn ein Verlust ihn sonst negativ machen wuerde', () => {
            const store = new EconomyStore();
            store.applyMachineScoreDelta('greed-run', -10);
            expect(store.getMachinePoints('greed-run').toNumber()).toBe(0);
        });

        it('senkt den Peak nie, auch wenn der aktuelle Wert durch einen Verlust sinkt (Sticky-Fortschritt)', () => {
            const store = new EconomyStore();
            store.applyMachineScoreDelta('greed-run', 25);
            store.applyMachineScoreDelta('greed-run', -15);

            expect(store.getMachinePoints('greed-run').toNumber()).toBeCloseTo(10);
            expect(store.getMachinePeakScore('greed-run').toNumber()).toBe(25);
        });

        it('emittiert machine-points-changed bei jedem Aufruf, auch bei negativem Delta', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('machine-points-changed', listener);

            store.applyMachineScoreDelta('greed-run', -3); // von 0 -> geklemmt auf 0

            expect(listener).toHaveBeenCalledOnce();
            expect(listener.mock.calls[0][0].points.toNumber()).toBe(0);
        });
    });

    describe('spendMachinePoints', () => {
        it('zieht bei ausreichenden Punkten DIESES Automaten ab und gibt true zurueck', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 100);

            const success = store.spendMachinePoints('greed-run', 40);

            expect(success).toBe(true);
            expect(store.getMachinePoints('greed-run').toNumber()).toBe(60);
        });

        it('gibt bei unzureichenden Punkten false zurueck ohne zu mutieren', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 10);

            const success = store.spendMachinePoints('greed-run', 50);

            expect(success).toBe(false);
            expect(store.getMachinePoints('greed-run').toNumber()).toBe(10);
        });

        it('betrifft nur die Punkte des angegebenen Automaten, nicht andere', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 50);
            store.addMachinePoints('trap-tunnels', 50);

            store.spendMachinePoints('greed-run', 20);

            expect(store.getMachinePoints('greed-run').toNumber()).toBe(30);
            expect(store.getMachinePoints('trap-tunnels').toNumber()).toBe(50);
        });

        it('wirft bei negativen Betraegen', () => {
            const store = new EconomyStore();

            expect(() => store.spendMachinePoints('greed-run', -1)).toThrow(RangeError);
        });
    });

    describe('Automaten-interne Upgrades (Phase 7b)', () => {
        it('purchaseMachineUpgrade kauft bei ausreichenden Automaten-Punkten genau einmal', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 100);

            const first = store.purchaseMachineUpgrade('greed-run', 'visibility-1', 30);
            const second = store.purchaseMachineUpgrade('greed-run', 'visibility-1', 30);

            expect(first).toBe(true);
            expect(second).toBe(false);
            expect(store.hasMachineUpgrade('greed-run', 'visibility-1')).toBe(true);
            expect(store.getMachinePoints('greed-run').toNumber()).toBe(70);
        });

        it('purchaseMachineUpgrade schlaegt bei unzureichenden Punkten fehl ohne zu mutieren', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 10);

            const success = store.purchaseMachineUpgrade('greed-run', 'visibility-1', 30);

            expect(success).toBe(false);
            expect(store.hasMachineUpgrade('greed-run', 'visibility-1')).toBe(false);
            expect(store.getMachinePoints('greed-run').toNumber()).toBe(10);
        });

        it('haelt Upgrades verschiedener Automaten unabhaengig auseinander', () => {
            const store = new EconomyStore();
            store.addMachinePoints('greed-run', 100);
            store.addMachinePoints('trap-tunnels', 100);

            store.purchaseMachineUpgrade('greed-run', 'visibility-1', 30);

            expect(store.hasMachineUpgrade('greed-run', 'visibility-1')).toBe(true);
            expect(store.hasMachineUpgrade('trap-tunnels', 'visibility-1')).toBe(false);
            expect(store.getMachineUpgrades('trap-tunnels')).toEqual([]);
        });

        it('liefert eine leere Liste fuer einen Automaten ohne gekaufte Upgrades', () => {
            const store = new EconomyStore();

            expect(store.getMachineUpgrades('unknown')).toEqual([]);
        });
    });

    describe('Tickets (hallenweit)', () => {
        it('addHallTickets erhoeht den Ticket-Stand', () => {
            const store = new EconomyStore();

            store.addHallTickets(50);
            store.addHallTickets(25);

            expect(store.getHallTickets().toNumber()).toBe(75);
        });

        it('spendHallTickets zieht bei ausreichendem Guthaben ab und gibt true zurueck', () => {
            const store = new EconomyStore();
            store.addHallTickets(100);

            const success = store.spendHallTickets(40);

            expect(success).toBe(true);
            expect(store.getHallTickets().toNumber()).toBe(60);
        });

        it('spendHallTickets gibt bei unzureichendem Guthaben false zurueck ohne zu mutieren', () => {
            const store = new EconomyStore();
            store.addHallTickets(10);

            const success = store.spendHallTickets(50);

            expect(success).toBe(false);
            expect(store.getHallTickets().toNumber()).toBe(10);
        });

        it('spendHallTickets erlaubt exakt passendes Guthaben (Grenzfall)', () => {
            const store = new EconomyStore();
            store.addHallTickets(50);

            expect(store.spendHallTickets(50)).toBe(true);
            expect(store.getHallTickets().eq(0)).toBe(true);
        });

        it('wirft bei negativen Ticket-Betraegen', () => {
            const store = new EconomyStore();

            expect(() => store.addHallTickets(-1)).toThrow(RangeError);
            expect(() => store.spendHallTickets(-1)).toThrow(RangeError);
        });

        it('emittiert hall-tickets-changed mit dem neuen Stand', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('hall-tickets-changed', listener);

            store.addHallTickets(10);

            expect(listener).toHaveBeenCalledOnce();
            expect(listener.mock.calls[0][0].tickets.toNumber()).toBe(10);
        });
    });

    describe('Automaten-Freischaltung', () => {
        it('unlockMachine schaltet einen Automaten frei und ist idempotent', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('machine-unlocked', listener);

            store.unlockMachine('greed-run');
            store.unlockMachine('greed-run');

            expect(store.isMachineUnlocked('greed-run')).toBe(true);
            expect(listener).toHaveBeenCalledOnce();
        });

        it('markMachineCompleted markiert einen Automaten als durchgespielt und ist idempotent', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('machine-completed', listener);

            store.markMachineCompleted('greed-run');
            store.markMachineCompleted('greed-run');

            expect(store.isMachineCompleted('greed-run')).toBe(true);
            expect(listener).toHaveBeenCalledOnce();
        });
    });

    describe('Hallen-Upgrades', () => {
        it('purchaseHallUpgrade kauft bei ausreichendem Guthaben genau einmal', () => {
            const store = new EconomyStore();
            store.addHallTickets(100);

            const first = store.purchaseHallUpgrade('faster-conversion', 60);
            const second = store.purchaseHallUpgrade('faster-conversion', 60);

            expect(first).toBe(true);
            expect(second).toBe(false);
            expect(store.hasHallUpgrade('faster-conversion')).toBe(true);
            expect(store.getHallTickets().toNumber()).toBe(40);
        });

        it('purchaseHallUpgrade schlaegt bei unzureichendem Guthaben fehl ohne zu mutieren', () => {
            const store = new EconomyStore();
            store.addHallTickets(10);

            const success = store.purchaseHallUpgrade('faster-conversion', 60);

            expect(success).toBe(false);
            expect(store.hasHallUpgrade('faster-conversion')).toBe(false);
            expect(store.getHallTickets().toNumber()).toBe(10);
        });
    });

    describe('Attendant-Musterkenntnis', () => {
        it('setAttendantKnowledge speichert einen Wert zwischen 0 und 1', () => {
            const store = new EconomyStore();

            store.setAttendantKnowledge('greed-run', 0.42);

            expect(store.getAttendantKnowledge('greed-run')).toBe(0.42);
        });

        it('klemmt Werte ausserhalb von [0, 1]', () => {
            const store = new EconomyStore();

            store.setAttendantKnowledge('greed-run', 1.5);
            expect(store.getAttendantKnowledge('greed-run')).toBe(1);

            store.setAttendantKnowledge('greed-run', -0.5);
            expect(store.getAttendantKnowledge('greed-run')).toBe(0);
        });

        it('liefert 0 fuer einen Automaten ohne Attendant-Fortschritt', () => {
            const store = new EconomyStore();

            expect(store.getAttendantKnowledge('unknown')).toBe(0);
        });
    });

    describe('Attendant-Pool/Zeitstempel (Phase 7d)', () => {
        it('liefert einen leeren Pool fuer einen Automaten ohne Fortschritt', () => {
            const store = new EconomyStore();

            expect(store.getAttendantPool('unknown')).toEqual({ machinePoints: 0, hallTickets: 0, msSincePayout: 0 });
        });

        it('setAttendantPool/getAttendantPool speichern und lesen konsistent', () => {
            const store = new EconomyStore();
            const pool = { machinePoints: 3.5, hallTickets: 1.2, msSincePayout: 800 };

            store.setAttendantPool('greed-run', pool);

            expect(store.getAttendantPool('greed-run')).toEqual(pool);
            expect(store.getAttendantPool('trap-tunnels')).toEqual({ machinePoints: 0, hallTickets: 0, msSincePayout: 0 });
        });

        it('setLastAttendantUpdate/getLastAttendantUpdate speichern und lesen konsistent', () => {
            const store = new EconomyStore();

            store.setLastAttendantUpdate(12345);

            expect(store.getLastAttendantUpdate()).toBe(12345);
        });

        it('createInitialState initialisiert lastAttendantUpdate auf einen aktuellen Zeitstempel', () => {
            const before = Date.now();
            const store = new EconomyStore();
            const after = Date.now();

            expect(store.getLastAttendantUpdate()).toBeGreaterThanOrEqual(before);
            expect(store.getLastAttendantUpdate()).toBeLessThanOrEqual(after);
        });
    });

    describe('loadState', () => {
        it('ersetzt den kompletten State und emittiert state-loaded', () => {
            const store = new EconomyStore();
            store.addHallTickets(10);
            const listener = vi.fn();
            store.events.on('state-loaded', listener);

            const loaded = EconomyStore.createInitialState();
            loaded.tickets = new Decimal(999);
            loaded.unlockedMachines = ['greed-run'];

            store.loadState(loaded);

            expect(store.getHallTickets().toNumber()).toBe(999);
            expect(store.isMachineUnlocked('greed-run')).toBe(true);
            expect(listener).toHaveBeenCalledOnce();
        });
    });

    describe('Instanz-Isolation', () => {
        it('zwei EconomyStore-Instanzen teilen sich keinen State und keine Events', () => {
            const storeA = new EconomyStore();
            const storeB = new EconomyStore();
            const listenerB = vi.fn();
            storeB.events.on('hall-tickets-changed', listenerB);

            storeA.addHallTickets(100);

            expect(storeA.getHallTickets().toNumber()).toBe(100);
            expect(storeB.getHallTickets().toNumber()).toBe(0);
            expect(listenerB).not.toHaveBeenCalled();
        });
    });
});
