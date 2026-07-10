import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { deserializeState, SaveSystem, serializeState } from './SaveSystem';
import { CURRENT_SAVE_VERSION, type EngineState } from './types';

// Minimales, In-Memory Storage-Double (kein Browser/jsdom noetig) --
// haelt die Engine ohne Browser testbar, wie in implementation-plan.md gefordert.
class MemoryStorage implements Storage {
    private map = new Map<string, string>();

    get length(): number {
        return this.map.size;
    }

    clear(): void {
        this.map.clear();
    }

    getItem(key: string): string | null {
        return this.map.has(key) ? this.map.get(key)! : null;
    }

    key(index: number): string | null {
        return [...this.map.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }

    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

function stateWithSomeData(): EngineState {
    return {
        saveVersion: CURRENT_SAVE_VERSION,
        tickets: new Decimal(1234.5),
        machinePoints: {
            'greed-run': new Decimal(42),
            'trap-tunnels': new Decimal(1e50),
        },
        machinePeakScore: {
            'greed-run': new Decimal(50),
            'trap-tunnels': new Decimal(1e50),
        },
        unlockedMachines: ['greed-run', 'trap-tunnels'],
        attendantKnowledge: { 'greed-run': 0.75 },
        hallUpgrades: ['faster-conversion'],
        completedMachines: ['greed-run'],
        machineUpgrades: { 'greed-run': ['visibility-1'] },
        attendantPools: { 'greed-run': { machinePoints: 1.5, hallTickets: 0.5, msSincePayout: 1200 } },
        lastAttendantUpdate: 1_700_000_000_000,
        gridFocusPreference: { 'greed-run': { focus: 'safe', keepForNextRun: true } },
    };
}

describe('serializeState / deserializeState', () => {
    it('rekonstruiert einen gleichwertigen EngineState (Round-Trip)', () => {
        const original = stateWithSomeData();

        const restored = deserializeState(serializeState(original));

        expect(restored.saveVersion).toBe(original.saveVersion);
        expect(restored.tickets.eq(original.tickets)).toBe(true);
        expect(restored.machinePoints['greed-run'].eq(42)).toBe(true);
        expect(restored.machinePeakScore['greed-run'].eq(50)).toBe(true);
        expect(restored.unlockedMachines).toEqual(original.unlockedMachines);
        expect(restored.attendantKnowledge).toEqual(original.attendantKnowledge);
        expect(restored.hallUpgrades).toEqual(original.hallUpgrades);
        expect(restored.completedMachines).toEqual(original.completedMachines);
        expect(restored.machineUpgrades).toEqual(original.machineUpgrades);
        expect(restored.attendantPools).toEqual(original.attendantPools);
        expect(restored.lastAttendantUpdate).toBe(original.lastAttendantUpdate);
        expect(restored.gridFocusPreference).toEqual(original.gridFocusPreference);
    });

    it('erhaelt Zahlen jenseits von Number.MAX_SAFE_INTEGER ueber den Round-Trip', () => {
        const original = stateWithSomeData();

        const restored = deserializeState(serializeState(original));

        expect(restored.machinePoints['trap-tunnels'].eq(new Decimal(1e50))).toBe(true);
    });

    it('wirft bei kaputtem JSON', () => {
        expect(() => deserializeState('{nicht json')).toThrow();
    });

    it('wirft bei fehlenden Pflichtfeldern', () => {
        expect(() => deserializeState(JSON.stringify({ foo: 'bar' }))).toThrow();
    });

    it('wirft bei einer neueren, nicht unterstuetzten saveVersion', () => {
        const future = { ...stateWithSomeData(), saveVersion: CURRENT_SAVE_VERSION + 1 };

        expect(() => deserializeState(serializeState(future))).toThrow();
    });

    it('wirft bei einer AELTEREN saveVersion (Phase 7d/7e: bewusst KEINE Migration, siehe STATUS.md)', () => {
        const old = { ...stateWithSomeData(), saveVersion: CURRENT_SAVE_VERSION - 1 };

        expect(() => deserializeState(serializeState(old))).toThrow();
    });
});

describe('SaveSystem', () => {
    it('load() gibt null zurueck, wenn noch nichts gespeichert wurde', () => {
        const saveSystem = new SaveSystem(new MemoryStorage());

        expect(saveSystem.load()).toBeNull();
    });

    it('speichert und laedt einen State (Round-Trip ueber echtes Storage-Interface)', () => {
        const saveSystem = new SaveSystem(new MemoryStorage());
        const state = stateWithSomeData();

        saveSystem.save(state);
        const loaded = saveSystem.load();

        expect(loaded).not.toBeNull();
        expect(loaded!.tickets.eq(state.tickets)).toBe(true);
        expect(loaded!.unlockedMachines).toEqual(state.unlockedMachines);
    });

    it('load() gibt bei korruptem Inhalt null zurueck statt zu werfen', () => {
        const storage = new MemoryStorage();
        storage.setItem('arcade-incremental-save', 'das ist kein json');
        const saveSystem = new SaveSystem(storage);

        expect(saveSystem.load()).toBeNull();
    });

    it('load() gibt bei einem alten (Phase<7d) Speicherstand null zurueck -- sauberer Reset statt Absturz', () => {
        const storage = new MemoryStorage();
        const legacyState = {
            saveVersion: 1,
            credits: '100',
            ticketsByMachine: { 'greed-run': '5' },
            unlockedMachines: [],
            attendantKnowledge: {},
            hallUpgrades: [],
            completedMachines: [],
            machineUpgrades: {},
        };
        storage.setItem('arcade-incremental-save', JSON.stringify(legacyState));
        const saveSystem = new SaveSystem(storage);

        expect(saveSystem.load()).toBeNull();
    });

    it('load() gibt bei einem Phase-7d-Speicherstand (saveVersion 2, ohne machinePeakScore) null zurueck', () => {
        const storage = new MemoryStorage();
        const phase7dState = {
            saveVersion: 2,
            tickets: '100',
            machinePoints: { 'greed-run': '5' },
            unlockedMachines: [],
            attendantKnowledge: {},
            hallUpgrades: [],
            completedMachines: [],
            machineUpgrades: {},
            attendantPools: {},
            lastAttendantUpdate: Date.now(),
        };
        storage.setItem('arcade-incremental-save', JSON.stringify(phase7dState));
        const saveSystem = new SaveSystem(storage);

        expect(saveSystem.load()).toBeNull();
    });

    it('load() gibt bei einem Phase-7e-Speicherstand (saveVersion 3, ohne gridFocusPreference) null zurueck', () => {
        const storage = new MemoryStorage();
        const phase7eState = {
            saveVersion: 3,
            tickets: '100',
            machinePoints: { 'greed-run': '5' },
            machinePeakScore: { 'greed-run': '5' },
            unlockedMachines: [],
            attendantKnowledge: {},
            hallUpgrades: [],
            completedMachines: [],
            machineUpgrades: {},
            attendantPools: {},
            lastAttendantUpdate: Date.now(),
        };
        storage.setItem('arcade-incremental-save', JSON.stringify(phase7eState));
        const saveSystem = new SaveSystem(storage);

        expect(saveSystem.load()).toBeNull();
    });

    it('load() gibt bei einem Phase-7f-Speicherstand (saveVersion 4, vor dem Trap-Tunnels-Genre-Rework) null zurueck', () => {
        const storage = new MemoryStorage();
        const phase7fState = {
            saveVersion: 4,
            tickets: '100',
            machinePoints: { 'greed-run': '5', 'trap-tunnels': '3' },
            machinePeakScore: { 'greed-run': '5', 'trap-tunnels': '3' },
            unlockedMachines: [],
            attendantKnowledge: {},
            hallUpgrades: [],
            completedMachines: [],
            // Alte, jetzt bedeutungslose depthUpgrades/precisionUpgrades-ids fuer
            // 'trap-tunnels' (Phase 7i wechselt diesen Automaten auf kind:
            // 'trapTunnels' mit eigenen Upgrade-ids) -- genau der Fall, den
            // die fehlende Migration bewusst abfangen soll (STATUS.md Phase 7i).
            machineUpgrades: { 'trap-tunnels': ['trap-tunnels-depth-2'] },
            attendantPools: {},
            lastAttendantUpdate: Date.now(),
            gridFocusPreference: {},
        };
        storage.setItem('arcade-incremental-save', JSON.stringify(phase7fState));
        const saveSystem = new SaveSystem(storage);

        expect(saveSystem.load()).toBeNull();
    });

    it('clear() entfernt den gespeicherten Stand', () => {
        const saveSystem = new SaveSystem(new MemoryStorage());
        saveSystem.save(stateWithSomeData());

        saveSystem.clear();

        expect(saveSystem.load()).toBeNull();
    });

    it('mehrere Speicherstaende unter verschiedenen Keys stoeren sich nicht', () => {
        const storage = new MemoryStorage();
        const slotA = new SaveSystem(storage, 'slot-a');
        const slotB = new SaveSystem(storage, 'slot-b');

        slotA.save(stateWithSomeData());

        expect(slotA.load()).not.toBeNull();
        expect(slotB.load()).toBeNull();
    });

    it('exportToString / importFromString ermoeglichen manuelles Backup', () => {
        const saveSystem = new SaveSystem(new MemoryStorage());
        const state = stateWithSomeData();

        const exported = saveSystem.exportToString(state);
        const imported = saveSystem.importFromString(exported);

        expect(imported.tickets.eq(state.tickets)).toBe(true);
    });

    it('importFromString wirft bei ungueltigem Text (Aufrufer entscheidet UI-Feedback)', () => {
        const saveSystem = new SaveSystem(new MemoryStorage());

        expect(() => saveSystem.importFromString('kein gueltiger export-string')).toThrow();
    });
});
