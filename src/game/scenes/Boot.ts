import { Scene } from 'phaser';
import { getEntryPointMachine } from '../../data/machines.config';

// Keine Assets zu laden (noch keine Grafik-/Sound-Assets, CLAUDE.md) -- geht
// direkt in die generische MachineScene mit dem Layer-0-Automaten.
export class Boot extends Scene {
    constructor() {
        super('Boot');
    }

    create(): void {
        this.scene.start('Machine', { machineId: getEntryPointMachine().id });
    }
}
