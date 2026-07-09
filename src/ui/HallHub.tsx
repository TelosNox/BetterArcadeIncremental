import { economyStore } from '../game/economy';
import { MACHINES } from '../data/machines.config';
import { getMachineUnlockUpgrade } from '../data/hall.config';
import { AttendantPanel } from './AttendantPanel';
import { UpgradePanel } from './UpgradePanel';
import { useEconomyRevision } from './useEconomyRevision';

// Hallen-Grundgerüst (Layer 1, implementation-plan.md Abschnitt 2/4, Phase 4).
// Zeigt freigeschaltete Automaten + die hallenweite Ticket-Waehrung, erlaubt
// Rueckkehr in einen Automaten, das AttendantPanel pro durchgespieltem
// Automaten (Phase 5), sowie das UpgradePanel (Phase 7) fuer den gesamten
// Hallen-Upgrade-Kauf. Liest EconomyStore nur ueber die definierte
// Schnittstelle (Architektur-Kurzregel CLAUDE.md), kein eigener paralleler
// State.
//
// Phase 7d (siehe STATUS.md): "Credits" und der manuelle "In Tickets
// umwandeln"-Schritt entfallen komplett. Tickets sind seit dieser Phase die
// EINZIGE hallenweite Waehrung und entstehen automatisch beim Spielen (siehe
// MachineScene.ts) -- diese Karten zeigen nur noch die pro Automat lokalen
// Automaten-Punkte (fuer automaten-interne Upgrades) sowie den Status an.

interface HallHubProps {
    onSelectMachine: (machineId: string) => void;
}

export function HallHub({ onSelectMachine }: HallHubProps) {
    useEconomyRevision();

    const state = economyStore.getState();

    return (
        <div className="hall-hub">
            <h1>Spielhalle</h1>
            <p className="hall-hub__tickets">Tickets: {economyStore.getHallTickets().toNumber().toFixed(1)}</p>

            <div className="hall-hub__machines">
                {MACHINES.map((machine) => {
                    const isUnlocked = economyStore.isMachineUnlocked(machine.id);

                    if (!isUnlocked) {
                        const unlockUpgrade = getMachineUnlockUpgrade(machine.id);
                        return (
                            <div className="hall-hub__machine-card hall-hub__machine-card--locked" key={machine.id}>
                                <h2>{machine.name}</h2>
                                <p>Gesperrt ({unlockUpgrade?.cost ?? '?'} Tickets, siehe Hallen-Upgrades unten)</p>
                            </div>
                        );
                    }

                    const isCompleted = state.completedMachines.includes(machine.id);
                    const points = economyStore.getMachinePoints(machine.id);
                    return (
                        <div className="hall-hub__machine-card" key={machine.id}>
                            <h2>{machine.name}</h2>
                            <p>Automaten-Punkte: {points.toNumber().toFixed(1)}</p>
                            <p>{isCompleted ? 'Durchgespielt' : 'Noch nicht durchgespielt'}</p>
                            <button type="button" onClick={() => onSelectMachine(machine.id)}>
                                Spielen
                            </button>
                            {isCompleted && <AttendantPanel machineId={machine.id} />}
                        </div>
                    );
                })}
            </div>

            <UpgradePanel />
        </div>
    );
}
