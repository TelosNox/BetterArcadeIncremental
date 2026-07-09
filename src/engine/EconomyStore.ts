import Decimal, { type DecimalSource } from 'break_infinity.js';
import { CURRENT_SAVE_VERSION, type AttendantPoolState, type EngineState, type GridFocusPreference } from './types';
import { EventEmitter, type EngineEvents } from './events';

// Tickets (hallenweit), Automaten-Punkte (pro Automat), Hallen-Upgrades.
// Waehrungsfluss laut game-spec.md 3.1 (Phase 7d, ersetzt das fruehere
// Tickets->Credits-Modell VOLLSTAENDIG):
//   Automat (Skill-Score) -> gleichzeitig zwei Ausgaben pro Aktion:
//     1. Automaten-Punkte (lokal pro Automat, NICHT uebertragbar)
//     2. Tickets (hallenweit gepoolt) -- die EINZIGE Hallen-Waehrung
// Kein manueller Umwandlungsschritt mehr zwischen zwei Waehrungen (das
// war "Credits") -- siehe STATUS.md, Abschnitt Phase 7d.

function assertNonNegative(amount: Decimal, context: string): void {
    if (amount.lt(0)) {
        throw new RangeError(`${context}: Betrag darf nicht negativ sein (${amount.toString()})`);
    }
}

const EMPTY_POOL: AttendantPoolState = { machinePoints: 0, hallTickets: 0, msSincePayout: 0 };

export class EconomyStore {
    readonly events = new EventEmitter<EngineEvents>();
    private state: EngineState;

    constructor(initialState: EngineState = EconomyStore.createInitialState()) {
        this.state = initialState;
    }

    static createInitialState(): EngineState {
        return {
            saveVersion: CURRENT_SAVE_VERSION,
            tickets: new Decimal(0),
            machinePoints: {},
            machinePeakScore: {},
            unlockedMachines: [],
            attendantKnowledge: {},
            hallUpgrades: [],
            completedMachines: [],
            machineUpgrades: {},
            attendantPools: {},
            lastAttendantUpdate: Date.now(),
            gridFocusPreference: {},
        };
    }

    getState(): Readonly<EngineState> {
        return this.state;
    }

    // --- Tickets (hallenweit, ersetzt "Credits") ---------------------------

    getHallTickets(): Decimal {
        return this.state.tickets;
    }

    addHallTickets(amount: DecimalSource): void {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'addHallTickets');

        this.state.tickets = this.state.tickets.plus(value);
        this.events.emit('hall-tickets-changed', { tickets: this.state.tickets });
    }

    // Gibt false zurueck (ohne Mutation), wenn nicht genug hallenweite
    // Tickets vorhanden sind.
    spendHallTickets(amount: DecimalSource): boolean {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'spendHallTickets');

        if (this.state.tickets.lt(value)) {
            return false;
        }

        this.state.tickets = this.state.tickets.minus(value);
        this.events.emit('hall-tickets-changed', { tickets: this.state.tickets });
        return true;
    }

    // --- Automaten-Punkte (lokal pro Automat, vorher "ticketsByMachine") ---

    getMachinePoints(machineId: string): Decimal {
        return this.state.machinePoints[machineId] ?? new Decimal(0);
    }

    // Hoechster je erreichter machinePoints-Wert dieses Automaten (Phase 7e,
    // siehe types.ts::EngineState.machinePeakScore) -- steigt nie durch
    // Ausgeben oder einen Verlust, treibt Meilenstein-Pips/"Durchgespielt".
    getMachinePeakScore(machineId: string): Decimal {
        return this.state.machinePeakScore[machineId] ?? new Decimal(0);
    }

    private bumpMachinePeakScore(machineId: string, value: Decimal): void {
        if (value.gt(this.getMachinePeakScore(machineId))) {
            this.state.machinePeakScore[machineId] = value;
            this.events.emit('machine-peak-score-changed', { machineId, peak: value });
        }
    }

    // Nicht-negative Gutschrift (z. B. Attendant-Ertragsrate, siehe
    // economy.ts::tickAttendants). Aktualisiert bei Bedarf auch den Peak.
    addMachinePoints(machineId: string, amount: DecimalSource): void {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'addMachinePoints');

        const next = this.getMachinePoints(machineId).plus(value);
        this.state.machinePoints[machineId] = next;
        this.events.emit('machine-points-changed', { machineId, points: next });
        this.bumpMachinePeakScore(machineId, next);
    }

    // Gibt false zurueck (ohne Mutation), wenn nicht genug Automaten-Punkte
    // DIESES Automaten vorhanden sind -- fuer automaten-interne Upgrades
    // (Phase 7b, bezahlt mit den eigenen Punkten statt Hallen-Tickets, siehe
    // purchaseMachineUpgrade). Senkt bewusst NIE den Peak (siehe
    // getMachinePeakScore-Kommentar) -- Ausgeben darf Meilenstein-Fortschritt
    // nicht rueckgaengig machen.
    spendMachinePoints(machineId: string, amount: DecimalSource): boolean {
        const value = Decimal.fromValue(amount);
        assertNonNegative(value, 'spendMachinePoints');

        const current = this.getMachinePoints(machineId);
        if (current.lt(value)) {
            return false;
        }

        const next = current.minus(value);
        this.state.machinePoints[machineId] = next;
        this.events.emit('machine-points-changed', { machineId, points: next });
        return true;
    }

    // Signierte Gutschrift/Abzug (Phase 7e, ersetzt PushYourLuckRun.
    // resolveAction+bank): jede aufgeloeste Aktion verbucht ihren Payout
    // SOFORT und DAUERHAFT hier -- kein ephemerer Run mehr, kein Banking.
    // `delta` kann negativ sein (Verlust-Fall des zyklischen Aktionsmodells,
    // siehe machines.config.ts::resolveMachineAction) -- der resultierende
    // Punktestand wird bei 0 geklemmt (uebernommen aus der alten
    // PushYourLuckRun-Logik: ein Verlust kann Fortschritt bis auf 0
    // zunichtemachen, aber keine "Schulden" erzeugen). Der Peak (siehe oben)
    // wird dabei nie gesenkt, auch wenn der aktuelle Wert durch einen
    // Verlust sinkt -- das ist die "Sticky"-Eigenschaft, die Meilenstein-
    // Fortschritt/"Durchgespielt" unumkehrbar macht.
    applyMachineScoreDelta(machineId: string, delta: number): void {
        const next = this.getMachinePoints(machineId).plus(delta).clampMin(0);
        this.state.machinePoints[machineId] = next;
        this.events.emit('machine-points-changed', { machineId, points: next });
        this.bumpMachinePeakScore(machineId, next);
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
    // bereits gekauft wurde oder die Tickets nicht ausreichen (keine Mutation).
    purchaseHallUpgrade(upgradeId: string, cost: DecimalSource): boolean {
        if (this.hasHallUpgrade(upgradeId)) {
            return false;
        }
        if (!this.spendHallTickets(cost)) {
            return false;
        }

        this.state.hallUpgrades.push(upgradeId);
        this.events.emit('hall-upgrade-purchased', { upgradeId });
        return true;
    }

    // Automaten-interne Upgrades (Phase 7b): analog zu hallUpgrades/
    // hasHallUpgrade/purchaseHallUpgrade, aber PRO AUTOMAT gespeichert und
    // mit den eigenen Automaten-Punkten DIESES Automaten bezahlt
    // (spendMachinePoints statt spendHallTickets) -- folgt derselben
    // Pro-Automat-Struktur wie attendantKnowledge (Record<string, ...> keyed
    // by machineId), nur mit einer Liste gekaufter Upgrade-ids als Wert
    // statt einer einzelnen Zahl.
    getMachineUpgrades(machineId: string): readonly string[] {
        return this.state.machineUpgrades[machineId] ?? [];
    }

    hasMachineUpgrade(machineId: string, upgradeId: string): boolean {
        return this.getMachineUpgrades(machineId).includes(upgradeId);
    }

    // Kauft ein automaten-internes Upgrade genau einmal, bezahlt mit den
    // Automaten-Punkten DIESES Automaten. Gibt false zurueck, wenn es
    // bereits gekauft wurde oder die Punkte nicht ausreichen (keine Mutation).
    purchaseMachineUpgrade(machineId: string, upgradeId: string, cost: DecimalSource): boolean {
        if (this.hasMachineUpgrade(machineId, upgradeId)) {
            return false;
        }
        if (!this.spendMachinePoints(machineId, cost)) {
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
    // (manuelles Spielen primaer, Tickets-Training sekundaer) regelt die
    // AttendantEngine (Phase 5), nicht der EconomyStore.
    setAttendantKnowledge(machineId: string, value: number): void {
        const clamped = Math.min(1, Math.max(0, value));
        this.state.attendantKnowledge[machineId] = clamped;
        this.events.emit('attendant-knowledge-changed', { machineId, knowledge: clamped });
    }

    // --- Attendant-Rate-Modell (Phase 7d) -----------------------------------
    // Reiner State-Zugriff, keine Rate-/Pool-MATHEMATIK hier (die lebt als
    // reine, testbare Funktionen in AttendantEngine.ts -- Architektur-
    // Kurzregel: EconomyStore speichert nur, rechnet nicht).

    getAttendantPool(machineId: string): AttendantPoolState {
        return this.state.attendantPools[machineId] ?? EMPTY_POOL;
    }

    setAttendantPool(machineId: string, pool: AttendantPoolState): void {
        this.state.attendantPools[machineId] = pool;
    }

    getLastAttendantUpdate(): number {
        return this.state.lastAttendantUpdate;
    }

    setLastAttendantUpdate(timestampMs: number): void {
        this.state.lastAttendantUpdate = timestampMs;
    }

    // --- Fokus-Wahl Grid-Automat (Phase 7f, game-spec.md 4.2) ---------------
    // Reiner State-Zugriff, kein Event noetig (analog zu getAttendantPool/
    // setAttendantPool oben) -- ausschliesslich von der jeweiligen Grid-
    // Automaten-Szene selbst gelesen/geschrieben, kein React-UI-Konsument.

    getGridFocusPreference(machineId: string): GridFocusPreference | undefined {
        return this.state.gridFocusPreference[machineId];
    }

    setGridFocusPreference(machineId: string, preference: GridFocusPreference): void {
        this.state.gridFocusPreference[machineId] = preference;
    }

    // Ersetzt den kompletten State, z. B. nach SaveSystem.load().
    loadState(state: EngineState): void {
        this.state = state;
        this.events.emit('state-loaded', { state });
    }
}
