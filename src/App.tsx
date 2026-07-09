import { useEffect, useState } from 'react';
import { PhaserGame } from './PhaserGame';
import { HallHub } from './ui/HallHub';
import { EventBus } from './game/EventBus';
import { getCurrentView, setCurrentView, type View } from './game/viewState';

function App()
{
    const [view, setView] = useState<View>(getCurrentView);

    useEffect(() => {
        EventBus.on('hall-reveal', () => setView('hall'));
        return () => {
            EventBus.removeListener('hall-reveal');
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
