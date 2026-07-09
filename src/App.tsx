import { useEffect, useState } from 'react';
import { PhaserGame } from './PhaserGame';
import { HallHub } from './ui/HallHub';
import { EventBus } from './game/EventBus';
import { getCurrentView, setCurrentView, type View } from './game/viewState';

function App()
{
    const [view, setView] = useState<View>(getCurrentView);

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

    // Bruecke React -> Phaser fuer die Attendant-Automatisierung (Phase 5):
    // MachineScene liest getCurrentView() synchron bei der eigenen
    // Erstellung (race-frei, siehe viewState.ts) und reagiert danach live
    // auf dieses Event, statt einen eigenen State parallel zu view zu fuehren.
    useEffect(() => {
        setCurrentView(view);
        EventBus.emit('view-changed', { view });
    }, [view]);

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
