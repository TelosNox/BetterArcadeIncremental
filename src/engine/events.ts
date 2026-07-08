import type Decimal from 'break_infinity.js';
import type { EngineState } from './types';

// Einfacher, framework-unabhaengiger EventEmitter/Pub-Sub zwischen Engine
// und Darstellung (Phaser/React). Kennt weder Phaser noch React.

export type Listener<Payload> = (payload: Payload) => void;
export type Unsubscribe = () => void;

export class EventEmitter<EventMap extends Record<string, unknown>> {
    private listeners = new Map<keyof EventMap, Set<Listener<never>>>();

    on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): Unsubscribe {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener as Listener<never>);
        return () => this.off(event, listener);
    }

    off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
        this.listeners.get(event)?.delete(listener as Listener<never>);
    }

    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
        this.listeners.get(event)?.forEach((listener) => (listener as Listener<EventMap[K]>)(payload));
    }

    clear(): void {
        this.listeners.clear();
    }
}

// Konkrete Event-Map der Engine. Jede EconomyStore-Instanz besitzt ihren
// eigenen EventEmitter<EngineEvents> (kein globales Singleton), damit
// mehrere Instanzen (z. B. in Tests) sich nicht gegenseitig stoeren.
export type EngineEvents = {
    'credits-changed': { credits: Decimal };
    'tickets-changed': { machineId: string; tickets: Decimal };
    'machine-unlocked': { machineId: string };
    'machine-completed': { machineId: string };
    'hall-upgrade-purchased': { upgradeId: string };
    'attendant-knowledge-changed': { machineId: string; knowledge: number };
    'state-loaded': { state: EngineState };
};
