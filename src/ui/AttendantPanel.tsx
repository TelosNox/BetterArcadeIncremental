import { gainKnowledgeFromTraining } from '../engine/AttendantEngine';
import { economyStore, persist } from '../game/economy';

// Attendant-Panel pro Automat (Phase 5, game-spec.md 3.2). Nur sichtbar,
// wenn der Automat bereits durchgespielt ist (Freischalt-Kriterium). Zeigt
// Musterkenntnis + optionales, langsameres Credits-Training. Manuelles
// Spielen bleibt der primaere (schnellere) Weg, siehe MachineScene.
//
// Hinweis (siehe STATUS.md): Die Tickets->Credits-Umrechnung ist erst ein
// Hallen-Upgrade in Phase 7 -- bis dahin bleiben Credits bei 0 und der
// Trainings-Button ist entsprechend meist deaktiviert. Das ist eine bekannte,
// bewusste Luecke dieser Phase, kein Bug.
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
        economyStore.setAttendantKnowledge(machineId, gainKnowledgeFromTraining(knowledge));
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
