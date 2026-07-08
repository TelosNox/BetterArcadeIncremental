import { describe, expect, it, vi } from 'vitest';
import Decimal from 'break_infinity.js';
import { EconomyStore } from './EconomyStore';

describe('EconomyStore', () => {
    describe('createInitialState', () => {
        it('startet bei 0 Credits ohne freigeschaltete Automaten', () => {
            const store = new EconomyStore();

            expect(store.getCredits().eq(0)).toBe(true);
            expect(store.getState().unlockedMachines).toEqual([]);
            expect(store.getState().hallUpgrades).toEqual([]);
            expect(store.getState().completedMachines).toEqual([]);
        });
    });

    describe('Tickets', () => {
        it('addiert Tickets pro Automat unabhaengig voneinander', () => {
            const store = new EconomyStore();

            store.addTickets('greed-run', 10);
            store.addTickets('greed-run', 5);
            store.addTickets('trap-tunnels', 3);

            expect(store.getTickets('greed-run').toNumber()).toBe(15);
            expect(store.getTickets('trap-tunnels').toNumber()).toBe(3);
        });

        it('liefert 0 Tickets fuer einen unbekannten Automaten', () => {
            const store = new EconomyStore();

            expect(store.getTickets('unknown').eq(0)).toBe(true);
        });

        it('wirft bei negativen Ticket-Betraegen statt still zu ignorieren', () => {
            const store = new EconomyStore();

            expect(() => store.addTickets('greed-run', -1)).toThrow(RangeError);
        });

        it('emittiert tickets-changed mit dem neuen Stand', () => {
            const store = new EconomyStore();
            const listener = vi.fn();
            store.events.on('tickets-changed', listener);

            store.addTickets('greed-run', 10);

            expect(listener).toHaveBeenCalledOnce();
            const payload = listener.mock.calls[0][0];
            expect(payload.machineId).toBe('greed-run');
            expect(payload.tickets.toNumber()).toBe(10);
        });
    });

    describe('convertTicketsToCredits', () => {
        it('wandelt Tickets zum angegebenen Kurs in Credits um und setzt Tickets zurueck', () => {
            const store = new EconomyStore();
            store.addTickets('greed-run', 100);

            const gained = store.convertTicketsToCredits('greed-run', 1.5);

            expect(gained.toNumber()).toBe(150);
            expect(store.getCredits().toNumber()).toBe(150);
            expect(store.getTickets('greed-run').eq(0)).toBe(true);
        });

        it('rechnet mehrere Automaten unabhaengig auf dieselbe Credit-Summe', () => {
            const store = new EconomyStore();
            store.addTickets('greed-run', 10);
            store.addTickets('trap-tunnels', 20);

            store.convertTicketsToCredits('greed-run', 1);
            store.convertTicketsToCredits('trap-tunnels', 1);

            expect(store.getCredits().toNumber()).toBe(30);
        });
    });

    describe('Credits', () => {
        it('addCredits erhoeht den Credit-Stand', () => {
            const store = new EconomyStore();

            store.addCredits(50);
            store.addCredits(25);

            expect(store.getCredits().toNumber()).toBe(75);
        });

        it('spendCredits zieht bei ausreichendem Guthaben ab und gibt true zurueck', () => {
            const store = new EconomyStore();
            store.addCredits(100);

            const success = store.spendCredits(40);

            expect(success).toBe(true);
            expect(store.getCredits().toNumber()).toBe(60);
        });

        it('spendCredits gibt bei unzureichendem Guthaben false zurueck ohne zu mutieren', () => {
            const store = new EconomyStore();
            store.addCredits(10);

            const success = store.spendCredits(50);

            expect(success).toBe(false);
            expect(store.getCredits().toNumber()).toBe(10);
        });

        it('spendCredits erlaubt exakt passendes Guthaben (Grenzfall)', () => {
            const store = new EconomyStore();
            store.addCredits(50);

            expect(store.spendCredits(50)).toBe(true);
            expect(store.getCredits().eq(0)).toBe(true);
        });

        it('wirft bei negativen Credit-Betraegen', () => {
            const store = new EconomyStore();

            expect(() => store.addCredits(-1)).toThrow(RangeError);
            expect(() => store.spendCredits(-1)).toThrow(RangeError);
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
            store.addCredits(100);

            const first = store.purchaseHallUpgrade('faster-conversion', 60);
            const second = store.purchaseHallUpgrade('faster-conversion', 60);

            expect(first).toBe(true);
            expect(second).toBe(false);
            expect(store.hasHallUpgrade('faster-conversion')).toBe(true);
            expect(store.getCredits().toNumber()).toBe(40);
        });

        it('purchaseHallUpgrade schlaegt bei unzureichendem Guthaben fehl ohne zu mutieren', () => {
            const store = new EconomyStore();
            store.addCredits(10);

            const success = store.purchaseHallUpgrade('faster-conversion', 60);

            expect(success).toBe(false);
            expect(store.hasHallUpgrade('faster-conversion')).toBe(false);
            expect(store.getCredits().toNumber()).toBe(10);
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

    describe('loadState', () => {
        it('ersetzt den kompletten State und emittiert state-loaded', () => {
            const store = new EconomyStore();
            store.addCredits(10);
            const listener = vi.fn();
            store.events.on('state-loaded', listener);

            const loaded = EconomyStore.createInitialState();
            loaded.credits = new Decimal(999);
            loaded.unlockedMachines = ['greed-run'];

            store.loadState(loaded);

            expect(store.getCredits().toNumber()).toBe(999);
            expect(store.isMachineUnlocked('greed-run')).toBe(true);
            expect(listener).toHaveBeenCalledOnce();
        });
    });

    describe('Instanz-Isolation', () => {
        it('zwei EconomyStore-Instanzen teilen sich keinen State und keine Events', () => {
            const storeA = new EconomyStore();
            const storeB = new EconomyStore();
            const listenerB = vi.fn();
            storeB.events.on('credits-changed', listenerB);

            storeA.addCredits(100);

            expect(storeA.getCredits().toNumber()).toBe(100);
            expect(storeB.getCredits().toNumber()).toBe(0);
            expect(listenerB).not.toHaveBeenCalled();
        });
    });
});
