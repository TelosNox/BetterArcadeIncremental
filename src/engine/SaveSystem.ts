import Decimal from 'break_infinity.js';
import { CURRENT_SAVE_VERSION, type EngineState } from './types';

// localStorage + JSON Export/Import. Kennt weder Phaser noch React.
// Decimal-Werte (break_infinity.js) werden als String serialisiert, da sie
// nicht JSON-nativ sind, und beim Laden ueber `new Decimal(string)` restauriert.

interface SerializedEngineState {
    saveVersion: number;
    credits: string;
    ticketsByMachine: Record<string, string>;
    unlockedMachines: string[];
    attendantKnowledge: Record<string, number>;
    hallUpgrades: string[];
    completedMachines: string[];
    machineUpgrades: Record<string, string[]>;
}

const DEFAULT_SAVE_KEY = 'arcade-incremental-save';

export function serializeState(state: EngineState): string {
    const serialized: SerializedEngineState = {
        saveVersion: state.saveVersion,
        credits: state.credits.toString(),
        ticketsByMachine: Object.fromEntries(
            Object.entries(state.ticketsByMachine).map(([machineId, tickets]) => [machineId, tickets.toString()]),
        ),
        unlockedMachines: [...state.unlockedMachines],
        attendantKnowledge: { ...state.attendantKnowledge },
        hallUpgrades: [...state.hallUpgrades],
        completedMachines: [...state.completedMachines],
        machineUpgrades: Object.fromEntries(
            Object.entries(state.machineUpgrades).map(([machineId, upgrades]) => [machineId, [...upgrades]]),
        ),
    };
    return JSON.stringify(serialized);
}

export function deserializeState(json: string): EngineState {
    let parsed: Partial<SerializedEngineState>;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error('Speicherstand ist kein gueltiges JSON');
    }

    if (typeof parsed.saveVersion !== 'number' || typeof parsed.credits !== 'string') {
        throw new Error('Speicherstand hat ein ungueltiges Format');
    }
    if (parsed.saveVersion > CURRENT_SAVE_VERSION) {
        throw new Error(`Speicherstand-Version ${parsed.saveVersion} wird nicht unterstuetzt (aktuell: ${CURRENT_SAVE_VERSION})`);
    }
    // Es gibt bisher nur Version 1 -> keine Migrationsschritte noetig.
    // Kuenftige Versionen wandern hier als zusaetzliche Migrationsstufen rein.

    return {
        saveVersion: parsed.saveVersion,
        credits: new Decimal(parsed.credits),
        ticketsByMachine: Object.fromEntries(
            Object.entries(parsed.ticketsByMachine ?? {}).map(([machineId, tickets]) => [machineId, new Decimal(tickets)]),
        ),
        unlockedMachines: [...(parsed.unlockedMachines ?? [])],
        attendantKnowledge: { ...(parsed.attendantKnowledge ?? {}) },
        hallUpgrades: [...(parsed.hallUpgrades ?? [])],
        completedMachines: [...(parsed.completedMachines ?? [])],
        machineUpgrades: Object.fromEntries(
            Object.entries(parsed.machineUpgrades ?? {}).map(([machineId, upgrades]) => [machineId, [...upgrades]]),
        ),
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

    // Gibt null zurueck, wenn kein Speicherstand existiert oder er korrupt ist,
    // statt zu crashen.
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
