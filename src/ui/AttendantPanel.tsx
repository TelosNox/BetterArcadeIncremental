import { economyStore, persist } from '../game/economy';
import { getEffectiveTrainingGain } from '../data/hall.config';

// Attendant-Panel pro Automat (Phase 5, game-spec.md 3.2). Nur sichtbar,
// wenn der Automat bereits durchgespielt ist (Freischalt-Kriterium). Zeigt
// Musterkenntnis + optionales, langsameres Credits-Training. Manuelles
// Spielen bleibt der primaere (schnellere) Weg, siehe MachineScene.
//
// Der Musterkenntnis-Gewinn pro Training kommt seit Phase 7 aus
// hall.config.ts::getEffectiveTrainingGain (Cross-Layer-Feedback: das
// "Schulungsprogramm"-Hallen-Upgrade verbessert diese Rate fuer ALLE
// Automaten, siehe hall.config.ts fuer die Begruendung). AttendantEngine.ts
// selbst bleibt unveraendert -- die Multiplikation passiert hier, ausserhalb
// der Engine, auf dem bereits exportierten TRAINING_KNOWLEDGE_GAIN.
const ATTENDANT_TRAINING_COST = 10;

interface AttendantPanelProps {
    machineId: string;
}

export function AttendantPanel({ machineId }: AttendantPanelProps) {
    const knowledge = economyStore.getAttendantKnowledge(machineId);
    const knowledgePct = Math.round(knowledge * 100);
    const canAfford = economyStore.getCredits().gte(ATTENDANT_TRAINING_COST);

    const handleTrain = () => {
        if (!economyStore.spendCredits(ATTENDANT_TRAINING_COST)) {
            return;
        }
        const gain = getEffectiveTrainingGain(economyStore.getState().hallUpgrades);
        economyStore.setAttendantKnowledge(machineId, Math.min(1, knowledge + gain));
        persist();
    };

    return (
        <div className="attendant-panel">
            <p>Attendant-Musterkenntnis: {knowledgePct}%</p>
            <button type="button" onClick={handleTrain} disabled={!canAfford}>
                Trainieren ({ATTENDANT_TRAINING_COST} Credits)
            </button>
        </div>
    );
}
