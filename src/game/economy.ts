import { EconomyStore } from '../engine/EconomyStore';
import { SaveSystem } from '../engine/SaveSystem';

// Bruecke zwischen der framework-unabhaengigen Engine (/src/engine) und dem
// Phaser-Teil (/src/game). Haelt genau eine EconomyStore-Instanz fuer die
// laufende Session, geladen aus dem letzten Speicherstand falls vorhanden.
// Phaser-Szenen greifen nur ueber diese Datei auf die Engine zu, nie direkt
// auf localStorage (Architektur-Kurzregel in CLAUDE.md).

export const saveSystem = new SaveSystem();

const loaded = saveSystem.load();
export const economyStore = loaded ? new EconomyStore(loaded) : new EconomyStore();

export function persist(): void {
    saveSystem.save(economyStore.getState());
}
