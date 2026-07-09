import Decimal from 'break_infinity.js';
import { CURRENT_SAVE_VERSION, type AttendantPoolState, type EngineState } from './types';

// localStorage + JSON Export/Import. Kennt weder Phaser noch React.
// Decimal-Werte (break_infinity.js) werden als String serialisiert, da sie
// nicht JSON-nativ sind, und beim Laden ueber `new Decimal(string)` restauriert.

interface SerializedEngineState {
    saveVersion: number;
    tickets: string;
    machinePoints: Record<string, string>;
    machinePeakScore: Record<string, string>;
    unlockedMachines: string[];
    attendantKnowledge: Record<string, number>;
    hallUpgrades: string[];
    completedMachines: string[];
    machineUpgrades: Record<string, string[]>;
    attendantPools: Record<string, AttendantPoolState>;
    lastAttendantUpdate: number;
}

const DEFAULT_SAVE_KEY = 'arcade-incremental-save';

export function serializeState(state: EngineState): string {
    const serialized: SerializedEngineState = {
        saveVersion: state.saveVersion,
        tickets: state.tickets.toString(),
        machinePoints: Object.fromEntries(
            Object.entries(state.machinePoints).map(([machineId, points]) => [machineId, points.toString()]),
        ),
        machinePeakScore: Object.fromEntries(
            Object.entries(state.machinePeakScore).map(([machineId, peak]) => [machineId, peak.toString()]),
        ),
        unlockedMachines: [...state.unlockedMachines],
        attendantKnowledge: { ...state.attendantKnowledge },
        hallUpgrades: [...state.hallUpgrades],
        completedMachines: [...state.completedMachines],
        machineUpgrades: Object.fromEntries(
            Object.entries(state.machineUpgrades).map(([machineId, upgrades]) => [machineId, [...upgrades]]),
        ),
        attendantPools: Object.fromEntries(
            Object.entries(state.attendantPools).map(([machineId, pool]) => [machineId, { ...pool }]),
        ),
        lastAttendantUpdate: state.lastAttendantUpdate,
    };
    return JSON.stringify(serialized);
}

// Phase 7d/7e aendern die EngineState-Form wiederholt inkompatibel (Credits
// entfallen, ticketsByMachine->machinePoints umbenannt, neue Pflichtfelder
// fuer Attendant-Rate/Pool bzw. den Meilenstein-Peak). Da noch keine echten
// Nutzer-Spielstaende existieren, gibt es bewusst KEINE Migration -- jeder
// Save, dessen Version nicht EXAKT der aktuellen entspricht, wird als
// inkompatibel abgelehnt (wirft hier), was SaveSystem.load() abfaengt und
// dadurch sauber in einen frischen EconomyStore.createInitialState() faellt,
// statt abzustuerzen oder mit halb-migrierten/undefined-Feldern weiterzulaufen.
export function deserializeState(json: string): EngineState {
    let parsed: Partial<SerializedEngineState>;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error('Speicherstand ist kein gueltiges JSON');
    }

    if (typeof parsed.saveVersion !== 'number' || typeof parsed.tickets !== 'string') {
        throw new Error('Speicherstand hat ein ungueltiges Format');
    }
    if (parsed.saveVersion !== CURRENT_SAVE_VERSION) {
        throw new Error(
            `Speicherstand-Version ${parsed.saveVersion} wird nicht unterstuetzt (aktuell: ${CURRENT_SAVE_VERSION}, keine Migration vorhanden)`,
        );
    }

    return {
        saveVersion: parsed.saveVersion,
        tickets: new Decimal(parsed.tickets),
        machinePoints: Object.fromEntries(
            Object.entries(parsed.machinePoints ?? {}).map(([machineId, points]) => [machineId, new Decimal(points)]),
        ),
        machinePeakScore: Object.fromEntries(
            Object.entries(parsed.machinePeakScore ?? {}).map(([machineId, peak]) => [machineId, new Decimal(peak)]),
        ),
        unlockedMachines: [...(parsed.unlockedMachines ?? [])],
        attendantKnowledge: { ...(parsed.attendantKnowledge ?? {}) },
        hallUpgrades: [...(parsed.hallUpgrades ?? [])],
        completedMachines: [...(parsed.completedMachines ?? [])],
        machineUpgrades: Object.fromEntries(
            Object.entries(parsed.machineUpgrades ?? {}).map(([machineId, upgrades]) => [machineId, [...upgrades]]),
        ),
        attendantPools: Object.fromEntries(
            Object.entries(parsed.attendantPools ?? {}).map(([machineId, pool]) => [machineId, { ...pool }]),
        ),
        lastAttendantUpdate: parsed.lastAttendantUpdate ?? Date.now(),
    };
}

export class SaveSystem {
    private storage: Storage;
    private key: string;

    constructor(storage?: Storage, key: string = DEFAULT_SAVE_KEY) {
        this.storage = storage ?? SaveSystem.resolveDefaultStorage();
        this.key = key;
    }

    private static resolveDefaultStorage(): Storage {
        if (typeof localStorage === 'undefined') {
            throw new Error('localStorage ist in dieser Umgebung nicht verfuegbar');
        }
        return localStorage;
    }

    save(state: EngineState): void {
        this.storage.setItem(this.key, serializeState(state));
    }

    // Gibt null zurueck, wenn kein Speicherstand existiert oder er korrupt
    // ODER inkompatibel-veraltet ist (siehe deserializeState), statt zu
    // crashen -- der Aufrufer (economy.ts) faellt dann auf einen frischen
    // EconomyStore.createInitialState() zurueck (sauberer Reset bevorzugt
    // gegenueber Absturz, siehe STATUS.md Phase 7d).
    load(): EngineState | null {
        const raw = this.storage.getItem(this.key);
        if (raw === null) {
            return null;
        }
        try {
            return deserializeState(raw);
        } catch {
            return null;
        }
    }

    clear(): void {
        this.storage.removeItem(this.key);
    }

    exportToString(state: EngineState): string {
        return serializeState(state);
    }

    // Wirft bei ungueltigem Format - der Aufrufer entscheidet ueber UI-Feedback.
    importFromString(json: string): EngineState {
        return deserializeState(json);
    }
}
