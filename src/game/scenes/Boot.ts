import { Scene } from 'phaser';
import { getEntryPointMachine } from '../../data/machines.config';
import { getSceneKeyForMachine } from '../sceneRouting';

// Keine Assets zu laden (noch keine Grafik-/Sound-Assets, CLAUDE.md) -- geht
// direkt in die (je nach Automat generische ODER eigene, siehe sceneRouting.ts)
// Szene des Layer-0-Automaten.
export class Boot extends Scene {
    constructor() {
        super('Boot');
    }

    create(): void {
        const entryPointId = getEntryPointMachine().id;
        this.scene.start(getSceneKeyForMachine(entryPointId), { machineId: entryPointId });
    }
}
