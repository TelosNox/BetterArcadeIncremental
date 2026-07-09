import { useEffect, useState } from 'react';
import { economyStore, persist } from '../game/economy';
import { MACHINES, MACHINE_UNLOCK_COST } from '../data/machines.config';
import { AttendantPanel } from './AttendantPanel';

// Hallen-Grundgerüst (Layer 1, implementation-plan.md Abschnitt 2/4, Phase 4).
// Zeigt freigeschaltete Automaten + Credits, erlaubt Rueckkehr in einen
// Automaten, das AttendantPanel pro durchgespieltem Automat (Phase 5), sowie
// (Phase 6) Freischalt-Logik fuer Automat 2-4 gegen Credits.
// Liest EconomyStore nur ueber die definierte Schnittstelle (Architektur-
// Kurzregel CLAUDE.md), kein eigener paralleler State.
//
// PLATZHALTER (siehe STATUS.md): Die Tickets->Credits-Umrechnung ist laut
// implementation-plan.md eigentlich ein Hallen-Upgrade (Phase 7, eigenes
// hall.config.ts). Ohne IRGENDEINE Umrechnung waeren Automat 2-4 aber nie
// erreichbar (Credits blieben für immer 0) und Phase 6 liesse sich nicht
// durchspielen -- deshalb hier ein fester, klar als vorlaeufig markierter
// Kurs, der in Phase 7 durch das echte Upgrade-System ersetzt wird.
const TICKET_CONVERSION_RATE = 1;

interface HallHubProps {
    onSelectMachine: (machineId: string) => void;
}

// Re-Render bei relevanten EconomyStore-Events erzwingen, ohne den State
// selbst zu duplizieren -- HallHub liest bei jedem Render frisch aus
// economyStore.getState()/getCredits()/getTickets().
function useEconomyRevision(): number {
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const bump = () => setRevision((r) => r + 1);
        const unsubscribers = [
            economyStore.events.on('credits-changed', bump),
            economyStore.events.on('tickets-changed', bump),
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

export function HallHub({ onSelectMachine }: HallHubProps) {
    useEconomyRevision();

    const state = economyStore.getState();

    const handleConvert = (machineId: string) => {
        economyStore.convertTicketsToCredits(machineId, TICKET_CONVERSION_RATE);
        persist();
    };

    const handleUnlock = (machineId: string) => {
        const cost = MACHINE_UNLOCK_COST[machineId];
        if (economyStore.purchaseHallUpgrade(`unlock-${machineId}`, cost)) {
            economyStore.unlockMachine(machineId);
            persist();
        }
    };

    return (
        <div className="hall-hub">
            <h1>Spielhalle</h1>
            <p className="hall-hub__credits">Credits: {economyStore.getCredits().toNumber().toFixed(1)}</p>

            <div className="hall-hub__machines">
                {MACHINES.map((machine) => {
                    const isUnlocked = economyStore.isMachineUnlocked(machine.id);

                    if (!isUnlocked) {
                        const cost = MACHINE_UNLOCK_COST[machine.id];
                        const canAfford = economyStore.getCredits().gte(cost);
                        return (
                            <div className="hall-hub__machine-card hall-hub__machine-card--locked" key={machine.id}>
                                <h2>{machine.name}</h2>
                                <p>Gesperrt</p>
                                <button type="button" onClick={() => handleUnlock(machine.id)} disabled={!canAfford}>
                                    Freischalten ({cost} Credits)
                                </button>
                            </div>
                        );
                    }

                    const isCompleted = state.completedMachines.includes(machine.id);
                    const tickets = economyStore.getTickets(machine.id);
                    return (
                        <div className="hall-hub__machine-card" key={machine.id}>
                            <h2>{machine.name}</h2>
                            <p>Tickets: {tickets.toNumber().toFixed(1)}</p>
                            <p>{isCompleted ? 'Durchgespielt' : 'Noch nicht durchgespielt'}</p>
                            <button type="button" onClick={() => onSelectMachine(machine.id)}>
                                Spielen
                            </button>
                            <button type="button" onClick={() => handleConvert(machine.id)} disabled={tickets.lte(0)}>
                                In Credits umwandeln
                            </button>
                            {isCompleted && <AttendantPanel machineId={machine.id} />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
