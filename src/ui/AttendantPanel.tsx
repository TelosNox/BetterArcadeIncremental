import { economyStore, persist } from '../game/economy';
import { getEffectiveTrainingGain, getTicketYieldRate } from '../data/hall.config';
import { getMachineAttendantRate, getMachineConfig } from '../data/machines.config';

// Attendant-Panel pro Automat (Phase 5, game-spec.md 3.2). Nur sichtbar,
// wenn der Automat bereits durchgespielt ist (Freischalt-Kriterium). Zeigt
// Musterkenntnis + optionales, langsameres Tickets-Training sowie die
// aktuell geltende Ertragsrate (Phase 7d: der Attendant laeuft global im
// Hintergrund fuer ALLE durchgespielten Automaten gleichzeitig, siehe
// economy.ts::tickAttendants -- dieses Panel zeigt nur den Status an,
// tickt selbst nichts). Manuelles Spielen bleibt der primaere (schnellere)
// Weg, Musterkenntnis zu steigern, siehe MachineScene.
//
// Der Musterkenntnis-Gewinn pro Training kommt seit Phase 7 aus
// hall.config.ts::getEffectiveTrainingGain (Cross-Layer-Feedback: das
// "Schulungsprogramm"-Hallen-Upgrade verbessert diese Rate fuer ALLE
// Automaten). Trainingskosten sind seit Phase 7d hallenweite Tickets statt
// Credits (EconomyStore.ts).
const ATTENDANT_TRAINING_COST = 10;

interface AttendantPanelProps {
    machineId: string;
}

export function AttendantPanel({ machineId }: AttendantPanelProps) {
    const knowledge = economyStore.getAttendantKnowledge(machineId);
    const knowledgePct = Math.round(knowledge * 100);
    const canAfford = economyStore.getHallTickets().gte(ATTENDANT_TRAINING_COST);

    const handleTrain = () => {
        if (!economyStore.spendHallTickets(ATTENDANT_TRAINING_COST)) {
            return;
        }
        const gain = getEffectiveTrainingGain(economyStore.getState().hallUpgrades);
        economyStore.setAttendantKnowledge(machineId, Math.min(1, knowledge + gain));
        persist();
    };

    const machine = getMachineConfig(machineId);
    const ownedUpgradeIds = economyStore.getMachineUpgrades(machineId);
    const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
    const rate = machine ? getMachineAttendantRate(machine, knowledge, ownedUpgradeIds, ticketYieldRate) : null;

    return (
        <div className="attendant-panel">
            <p>Attendant-Musterkenntnis: {knowledgePct}%</p>
            {rate && (
                <p>
                    Laeuft im Hintergrund: ~{rate.machinePointsPerSecond.toFixed(2)} Automaten-Punkte/s, ~
                    {rate.hallTicketsPerSecond.toFixed(2)} Tickets/s
                </p>
            )}
            <button type="button" onClick={handleTrain} disabled={!canAfford}>
                Trainieren ({ATTENDANT_TRAINING_COST} Tickets)
            </button>
        </div>
    );
}
