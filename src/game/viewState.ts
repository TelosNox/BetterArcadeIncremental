import { economyStore } from './economy';
import { getEntryPointMachine } from '../data/machines.config';

// Kleinste moegliche geteilte Zelle fuer "welche Ansicht ist gerade sichtbar"
// (React HallHub-Overlay vs. Phaser-Automat). KEIN paralleler State-Speicher
// zu EconomyStore -- es wird kein Spiel-/Wirtschaftsdatum dupliziert, nur ein
// UI-Navigationsflag synchron gehalten.
//
// Grund fuer die Existenz dieser Datei statt reiner EventBus-Events: React
// mountet App.tsx und Phaser bootet MachineScene unabhaengig voneinander
// (Phaser startet erst auf dem naechsten rAF-Tick). Ein 'view-changed'-Event,
// das VOR der MachineScene-Erstellung emittiert wird, ginge sonst spurlos
// verloren (Phaser-EventEmitter puffert nichts). Der Default-Wert hier wird
// deshalb synchron beim Modul-Laden mit derselben Regel wie EconomyStore
// berechnet, nicht erst reaktiv per Event gesetzt -- MachineScene liest ihn
// beim eigenen create() direkt, unabhaengig von Event-Timing.
export type View = 'machine' | 'hall';

let currentView: View = economyStore.isMachineCompleted(getEntryPointMachine().id) ? 'hall' : 'machine';

export function getCurrentView(): View {
    return currentView;
}

export function setCurrentView(view: View): void {
    currentView = view;
}
