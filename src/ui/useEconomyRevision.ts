import { useEffect, useState } from 'react';
import { economyStore } from '../game/economy';

// Re-Render bei relevanten EconomyStore-Events erzwingen, ohne den State
// selbst zu duplizieren -- Komponenten lesen bei jedem Render frisch aus
// economyStore.getState()/getHallTickets()/getMachinePoints() usw. Geteilt
// zwischen HallHub und UpgradePanel (Phase 7), damit die Event-Liste nur an
// einer Stelle gepflegt werden muss.
export function useEconomyRevision(): number {
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const bump = () => setRevision((r) => r + 1);
        const unsubscribers = [
            economyStore.events.on('hall-tickets-changed', bump),
            economyStore.events.on('machine-points-changed', bump),
            economyStore.events.on('machine-unlocked', bump),
            economyStore.events.on('machine-completed', bump),
            economyStore.events.on('attendant-knowledge-changed', bump),
            economyStore.events.on('hall-upgrade-purchased', bump),
            economyStore.events.on('state-loaded', bump),
        ];
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    }, []);

    return revision;
}
