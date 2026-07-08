import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events';

type TestEvents = {
    ping: { value: number };
    pong: { message: string };
};

describe('EventEmitter', () => {
    it('ruft registrierte Listener mit dem Payload auf', () => {
        const emitter = new EventEmitter<TestEvents>();
        const listener = vi.fn();

        emitter.on('ping', listener);
        emitter.emit('ping', { value: 42 });

        expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 42 });
    });

    it('unterscheidet zwischen verschiedenen Event-Typen', () => {
        const emitter = new EventEmitter<TestEvents>();
        const pingListener = vi.fn();
        const pongListener = vi.fn();

        emitter.on('ping', pingListener);
        emitter.on('pong', pongListener);
        emitter.emit('pong', { message: 'hallo' });

        expect(pingListener).not.toHaveBeenCalled();
        expect(pongListener).toHaveBeenCalledExactlyOnceWith({ message: 'hallo' });
    });

    it('erlaubt mehrere Listener fuer dasselbe Event', () => {
        const emitter = new EventEmitter<TestEvents>();
        const first = vi.fn();
        const second = vi.fn();

        emitter.on('ping', first);
        emitter.on('ping', second);
        emitter.emit('ping', { value: 1 });

        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it('entfernt einen Listener ueber die von on() zurueckgegebene Unsubscribe-Funktion', () => {
        const emitter = new EventEmitter<TestEvents>();
        const listener = vi.fn();

        const unsubscribe = emitter.on('ping', listener);
        unsubscribe();
        emitter.emit('ping', { value: 1 });

        expect(listener).not.toHaveBeenCalled();
    });

    it('entfernt einen Listener ueber off()', () => {
        const emitter = new EventEmitter<TestEvents>();
        const listener = vi.fn();

        emitter.on('ping', listener);
        emitter.off('ping', listener);
        emitter.emit('ping', { value: 1 });

        expect(listener).not.toHaveBeenCalled();
    });

    it('clear() entfernt alle Listener', () => {
        const emitter = new EventEmitter<TestEvents>();
        const pingListener = vi.fn();
        const pongListener = vi.fn();

        emitter.on('ping', pingListener);
        emitter.on('pong', pongListener);
        emitter.clear();
        emitter.emit('ping', { value: 1 });
        emitter.emit('pong', { message: 'hallo' });

        expect(pingListener).not.toHaveBeenCalled();
        expect(pongListener).not.toHaveBeenCalled();
    });

    it('emit ohne registrierte Listener wirft nicht', () => {
        const emitter = new EventEmitter<TestEvents>();

        expect(() => emitter.emit('ping', { value: 1 })).not.toThrow();
    });
});
