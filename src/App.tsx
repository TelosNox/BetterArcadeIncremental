import { useEffect, useState } from 'react';
import { PhaserGame } from './PhaserGame';
import { HallHub } from './ui/HallHub';
import { EventBus } from './game/EventBus';
import { economyStore, tickAttendants } from './game/economy';
import { getEntryPointMachine } from './data/machines.config';

type View = 'machine' | 'hall';

// Attendant-Rate-Tick (Phase 7d, siehe economy.ts::tickAttendants): laeuft
// unabhaengig von der aktuellen Ansicht (Halle vs. Automat) und unabhaengig
// davon, welcher Automat gerade in Phaser geladen ist -- ALLE freigeschalteten
// Automaten produzieren gleichzeitig im Hintergrund. Das Intervall bestimmt
// nur, wie oft die (Pool-basierte) Vordergrund-Optik aktualisiert wird;
// grosse Luecken (Tab im Hintergrund gedrosselt, neu geladen) werden von
// tickAttendants selbst korrekt als Offline-Ertrag erkannt und angewendet
// (siehe AttendantEngine.ts::applyAttendantElapsed).
const ATTENDANT_TICK_INTERVAL_MS = 2000;

function App()
{
    const [view, setView] = useState<View>(() =>
        economyStore.isMachineCompleted(getEntryPointMachine().id) ? 'hall' : 'machine',
    );

    // 'hall-reveal' feuert einmalig beim Durchbruch (TransitionScene),
    // 'return-to-hall' bei jeder spaeteren manuellen Rueckkehr aus einem
    // Automaten (MachineScene-Button) -- beide fuehren zur selben Hallen-
    // Ansicht, siehe Bugfix in STATUS.md ("Rueckweg Automat->Halle nach
    // zweitem Durchlauf").
    useEffect(() => {
        const toHall = () => setView('hall');
        EventBus.on('hall-reveal', toHall);
        EventBus.on('return-to-hall', toHall);
        return () => {
            EventBus.off('hall-reveal', toHall);
            EventBus.off('return-to-hall', toHall);
        };
    }, []);

    // Sofortiger Tick beim Mounten (wendet z. B. Offline-Ertrag seit dem
    // letzten Speichern sofort an) + periodischer Tick danach, unabhaengig
    // von `view` (Phase 7d loest die fruehere View-Kopplung des Attendants
    // bewusst auf, siehe STATUS.md).
    useEffect(() => {
        tickAttendants();
        const interval = setInterval(() => tickAttendants(), ATTENDANT_TICK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    const handleSelectMachine = (machineId: string) => {
        EventBus.emit('request-machine', { machineId });
        setView('machine');
    };

    return (
        <div id="app">
            <div className="game-shell">
                <PhaserGame />
                {view === 'hall' && <HallHub onSelectMachine={handleSelectMachine} />}
            </div>
        </div>
    )
}

export default App
