import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { getEntryPointMachine } from '../../data/machines.config';

// Durchbruch-Sequenz Layer 0 -> Layer 1 (game-spec.md Abschnitt 2). Wird
// GENAU EINMAL ausgeloest, beim erstmaligen Durchspielen des entryPoint-
// Automaten (siehe MachineScene.finishExecution). Baukasten 1.8: dieser
// grosse Ueberraschungseffekt wird bewusst nur hier verwendet -- fuer
// Automat 2-4 (Phase 6) werden KEINE Kopien dieser Szene gebaut, nur
// kleine eigene Hooks.
//
// Nur Phaser-Graphics-Primitive/Kamera-Effekte als Platzhalter (kein
// Grafik-/Sound-Asset, CLAUDE.md).
export class TransitionScene extends Scene {
    constructor() {
        super('Transition');
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x000000);

        const label = this.add
            .text(512, 384, 'Ein Blick hinter die Fassade...', {
                fontFamily: 'Arial Black', fontSize: 30, color: '#ffffff', align: 'center',
                wordWrap: { width: 700 },
            })
            .setOrigin(0.5)
            .setAlpha(0);

        this.cameras.main.zoomTo(1.4, 2200, 'Sine.easeInOut');

        this.tweens.add({
            targets: label,
            alpha: 1,
            duration: 700,
            onComplete: () => {
                this.tweens.add({
                    targets: label,
                    alpha: 0,
                    delay: 900,
                    duration: 600,
                    onComplete: () => this.finishReveal(),
                });
            },
        });
    }

    private finishReveal(): void {
        // Automat laeuft im Hintergrund weiter (Phase 5: Attendant-
        // Automatisierung); die Halle wird als React-Overlay ueber dem
        // Phaser-Canvas angezeigt (App.tsx hoert auf 'hall-reveal').
        EventBus.emit('hall-reveal');
        this.scene.start('Machine', { machineId: getEntryPointMachine().id });
    }
}
