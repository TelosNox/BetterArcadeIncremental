import { economyStore, persist } from '../game/economy';
import { MACHINES } from '../data/machines.config';
import { getMachineUnlockUpgrade, getTicketConversionRate } from '../data/hall.config';
import { AttendantPanel } from './AttendantPanel';
import { UpgradePanel } from './UpgradePanel';
import { useEconomyRevision } from './useEconomyRevision';

// Hallen-Grundgerüst (Layer 1, implementation-plan.md Abschnitt 2/4, Phase 4).
// Zeigt freigeschaltete Automaten + Credits, erlaubt Rueckkehr in einen
// Automaten, das AttendantPanel pro durchgespieltem Automat (Phase 5), sowie
// das UpgradePanel (Phase 7) fuer den gesamten Hallen-Upgrade-Kauf.
// Liest EconomyStore nur ueber die definierte Schnittstelle (Architektur-
// Kurzregel CLAUDE.md), kein eigener paralleler State.
//
// Seit Phase 7 gibt es nur noch EINEN Wirtschaftsmechanismus (PM-Vorgabe,
// siehe STATUS.md): Ticket->Credits-Kurs und Automaten-Freischaltung kommen
// beide aus hall.config.ts (echtes, kaufbares Upgrade-System) statt aus den
// Phase-6-Platzhaltern (fester TICKET_CONVERSION_RATE, fest codierte
// MACHINE_UNLOCK_COST). Das eigentliche Kaufen der Freischalt-Upgrades
// passiert ausschliesslich im UpgradePanel unten, nicht mehr hier direkt --
// diese Karten zeigen nur noch Status/Kosten an.

interface HallHubProps {
    onSelectMachine: (machineId: string) => void;
}

export function HallHub({ onSelectMachine }: HallHubProps) {
    useEconomyRevision();

    const state = economyStore.getState();
    const conversionRate = getTicketConversionRate(state.hallUpgrades);

    const handleConvert = (machineId: string) => {
        economyStore.convertTicketsToCredits(machineId, conversionRate);
        persist();
    };

    return (
        <div className="hall-hub">
            <h1>Spielhalle</h1>
            <p className="hall-hub__credits">Credits: {economyStore.getCredits().toNumber().toFixed(1)}</p>

            <div className="hall-hub__machines">
                {MACHINES.map((machine) => {
                    const isUnlocked = economyStore.isMachineUnlocked(machine.id);

                    if (!isUnlocked) {
                        const unlockUpgrade = getMachineUnlockUpgrade(machine.id);
                        return (
                            <div className="hall-hub__machine-card hall-hub__machine-card--locked" key={machine.id}>
                                <h2>{machine.name}</h2>
                                <p>Gesperrt ({unlockUpgrade?.cost ?? '?'} Credits, siehe Hallen-Upgrades unten)</p>
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
                                In Credits umwandeln ({conversionRate.toFixed(2)}/Ticket)
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
