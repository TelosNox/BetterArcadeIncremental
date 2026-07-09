import Decimal, { type DecimalSource } from 'break_infinity.js';
import { CURRENT_SAVE_VERSION, type EngineState } from './types';
import { EventEmitter, type EngineEvents } from './events';

// Tickets, Credits, Umrechnung, Hallen-Upgrades.
// Waehrungsfluss laut game-spec.md 3.1:
//   Automat (Skill-Score) -> Tickets -> Credits (Hallen-Waehrung)
//   Credits -> Hallen-Upgrades / Attendant-Training
//
// Die Umrechnungsrate Tickets->Credits ist selbst ein Hallen-Upgrade
// (siehe hall.config.ts, Phase 7) und wird daher hier als Parameter
// uebergeben statt hart codiert.

function assertNonNegative(amount: Decimal, context: string): void {
    if (amount.lt(0)) {
        throw new RangeError(`${context}: Betrag darf nicht negativ sein (${amount.toString()})`);
    }
}

export class EconomyStore {
    readonly events = new EventEmitter<EngineEvents>();
    private state: EngineState;

    constructor(initialState: EngineState = EconomyStore.createInitialState()) {
        this.state = initialState;
    }

    static createInitialState(): EngineState {
        return {
            saveVersion: CURRENT_SAVE_VERSION,
            credits: new Decimal(0),
            ticketsByMachine: {},
            unlockedMachines: [],
            attendantKnowledge: {},
            hallUpgrades: [],
            completedMachines: [],
            machineUpgrades: {},
        };
    }

    getState(): Readonly<EngineState> {
        return this.state;
    }

    getCredits(): Decimal {
        return this.state.credits;
    }

    getTickets(machineId: string): Decimal {
        return this.state.ticketsByMachine[machineId] ?? new Decimal(0);
    }

    addTickets(machineId: string, amount: DecimalSource): void {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'addTickets');

        const next = this.getTickets(machineId).plus(value);
        this.state.ticketsByMachine[machineId] = next;
        this.events.emit('tickets-changed', { machineId, tickets: next });
    }

    // Gibt false zurueck (ohne Mutation), wenn nicht genug Tickets DIESES
    // Automaten vorhanden sind. Symmetrisch zu spendCredits, aber pro
    // machineId -- fuer automaten-interne Upgrades (Phase 7b, bezahlt mit
    // den eigenen Tickets statt Hallen-Credits, siehe purchaseMachineUpgrade).
    spendTickets(machineId: string, amount: DecimalSource): boolean {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'spendTickets');

        const current = this.getTickets(machineId);
        if (current.lt(value)) {
            return false;
        }

        const next = current.minus(value);
        this.state.ticketsByMachine[machineId] = next;
        this.events.emit('tickets-changed', { machineId, tickets: next });
        return true;
    }

    // Wandelt alle gebankten Tickets eines Automaten zum uebergebenen Kurs
    // in Credits um und setzt den Ticket-Stand des Automaten zurueck.
    // Gibt die gutgeschriebene Credit-Menge zurueck.
    convertTicketsToCredits(machineId: string, rate: DecimalSource): Decimal {
        const rateValue = Decimal.fromValue(rate);
        assertNonNegative(rateValue, 'convertTicketsToCredits: rate');

        const tickets = this.getTickets(machineId);
        const gained = tickets.times(rateValue);

        this.state.ticketsByMachine[machineId] = new Decimal(0);
        this.state.credits = this.state.credits.plus(gained);

        this.events.emit('tickets-changed', { machineId, tickets: new Decimal(0) });
        this.events.emit('credits-changed', { credits: this.state.credits });

        return gained;
    }

    addCredits(amount: DecimalSource): void {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'addCredits');

        this.state.credits = this.state.credits.plus(value);
        this.events.emit('credits-changed', { credits: this.state.credits });
    }

    // Gibt false zurueck (ohne Mutation), wenn nicht genug Credits vorhanden sind.
    spendCredits(amount: DecimalSource): boolean {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'spendCredits');

        if (this.state.credits.lt(value)) {
            return false;
        }

        this.state.credits = this.state.credits.minus(value);
        this.events.emit('credits-changed', { credits: this.state.credits });
        return true;
    }

    isMachineUnlocked(machineId: string): boolean {
        return this.state.unlockedMachines.includes(machineId);
    }

    unlockMachine(machineId: string): void {
        if (this.isMachineUnlocked(machineId)) {
            return;
        }
        this.state.unlockedMachines.push(machineId);
        this.events.emit('machine-unlocked', { machineId });
    }

    isMachineCompleted(machineId: string): boolean {
        return this.state.completedMachines.includes(machineId);
    }

    markMachineCompleted(machineId: string): void {
        if (this.isMachineCompleted(machineId)) {
            return;
        }
        this.state.completedMachines.push(machineId);
        this.events.emit('machine-completed', { machineId });
    }

    hasHallUpgrade(upgradeId: string): boolean {
        return this.state.hallUpgrades.includes(upgradeId);
    }

    // Kauft ein Hallen-Upgrade genau einmal. Gibt false zurueck, wenn es
    // bereits gekauft wurde oder die Credits nicht ausreichen (keine Mutation).
    purchaseHallUpgrade(upgradeId: string, cost: DecimalSource): boolean {
        if (this.hasHallUpgrade(upgradeId)) {
            return false;
        }
        if (!this.spendCredits(cost)) {
            return false;
        }

        this.state.hallUpgrades.push(upgradeId);
        this.events.emit('hall-upgrade-purchased', { upgradeId });
        return true;
    }

    // Automaten-interne Upgrades (Phase 7b): analog zu hallUpgrades/
    // hasHallUpgrade/purchaseHallUpgrade, aber PRO AUTOMAT gespeichert und
    // mit den eigenen Tickets DIESES Automaten bezahlt (spendTickets statt
    // spendCredits) -- folgt derselben Pro-Automat-Struktur wie
    // attendantKnowledge (Record<string, ...> keyed by machineId), nur mit
    // einer Liste gekaufter Upgrade-ids als Wert statt einer einzelnen Zahl.
    getMachineUpgrades(machineId: string): readonly string[] {
        return this.state.machineUpgrades[machineId] ?? [];
    }

    hasMachineUpgrade(machineId: string, upgradeId: string): boolean {
        return this.getMachineUpgrades(machineId).includes(upgradeId);
    }

    // Kauft ein automaten-internes Upgrade genau einmal, bezahlt mit den
    // Tickets DIESES Automaten. Gibt false zurueck, wenn es bereits gekauft
    // wurde oder die Tickets nicht ausreichen (keine Mutation).
    purchaseMachineUpgrade(machineId: string, upgradeId: string, cost: DecimalSource): boolean {
        if (this.hasMachineUpgrade(machineId, upgradeId)) {
            return false;
        }
        if (!this.spendTickets(machineId, cost)) {
            return false;
        }

        const owned = this.state.machineUpgrades[machineId] ?? [];
        this.state.machineUpgrades[machineId] = [...owned, upgradeId];
        this.events.emit('machine-upgrade-purchased', { machineId, upgradeId });
        return true;
    }

    getAttendantKnowledge(machineId: string): number {
        return this.state.attendantKnowledge[machineId] ?? 0;
    }

    // Musterkenntnis wird hier nur gespeichert/geklemmt (0-1). Wie sie steigt
    // (manuelles Spielen primaer, Credits-Training sekundaer) regelt die
    // AttendantEngine (Phase 5), nicht der EconomyStore.
    setAttendantKnowledge(machineId: string, value: number): void {
        const clamped = Math.min(1, Math.max(0, value));
        this.state.attendantKnowledge[machineId] = clamped;
        this.events.emit('attendant-knowledge-changed', { machineId, knowledge: clamped });
    }

    // Ersetzt den kompletten State, z. B. nach SaveSystem.load().
    loadState(state: EngineState): void {
        this.state = state;
        this.events.emit('state-loaded', { state });
    }
}
