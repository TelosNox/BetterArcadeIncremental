import type { Scene } from 'phaser';
import type { MachineConfig } from '../../engine/types';
import { getReachedMilestones } from '../../data/machines.config';

// Kleiner, geteilter Rendering-Helfer (Phase 7f): MachineScene.ts UND die
// neue GreedRunScene.ts zeigen beide dieselbe Meilenstein-Pip-Reihe (Phase
// 7e, game-spec.md 4.1c/4.2) -- ein Pip pro Nicht-End-Meilenstein + eine um
// 45 Grad gedrehte Raute fuer den letzten ("Durchgespielt"), andere FORM statt
// nur andere Farbe (CLAUDE.md-Barrierefreiheits-Grundsatz). EINMAL erzeugt,
// danach nur umgefaerbt (kein Neuaufbau pro Render, vermeidet Flackern).
// Reine Phaser-Zeichenlogik ohne Wirtschaftslogik -- `getReachedMilestones`
// (die eigentliche Meilenstein-Auswertung) bleibt in machines.config.ts.

export function createMilestonePips(scene: Scene, config: MachineConfig, x: number, y: number): Phaser.GameObjects.Shape[] {
    const count = config.milestones.length;
    const spacing = 26;
    const startX = x - ((count - 1) * spacing) / 2;
    const pips: Phaser.GameObjects.Shape[] = [];
    for (let i = 0; i < count; i += 1) {
        const px = startX + i * spacing;
        const isFinal = i === count - 1;
        const pip = isFinal
            ? scene.add.rectangle(px, y, 15, 15, 0x444444).setAngle(45).setStrokeStyle(1, 0xffffff)
            : scene.add.circle(px, y, 8, 0x444444).setStrokeStyle(1, 0xffffff);
        pips.push(pip);
    }
    return pips;
}

export function updateMilestonePips(pips: readonly Phaser.GameObjects.Shape[], config: MachineConfig, peakScore: number): void {
    const reachedCount = getReachedMilestones(config, peakScore).length;
    pips.forEach((pip, i) => {
        pip.setFillStyle(i < reachedCount ? 0xffe066 : 0x444444);
    });
}
