import { GREED_RUN } from '../data/machines.config';

// Phase 7f (Greed Run Genre-Rework, CLAUDE.md "Workflow-Regeln"): Automat 1
// bekommt eine eigene Phaser-Szene (Szenen-Key 'GreedRun') statt weiterhin
// ueber die generische 'Machine'-Szene zu laufen -- Automaten 2-4 bleiben
// unveraendert auf 'Machine'. Diese Zuordnung wird an mehreren Stellen
// gebraucht (Boot.ts, TransitionScene.ts, MachineScene.ts UND GreedRunScene.ts
// selbst fuer den 'request-machine'-Listener, wenn der Spieler in der Halle
// einen ANDEREN Automaten anwaehlt) -- deshalb hier EINMAL zentral, statt an
// jeder Stelle den Automaten-id-Vergleich zu duplizieren. Sollte spaeter ein
// zweiter Grid-Automat entstehen, bekommt er hier einen eigenen Zweig (siehe
// game-spec.md 4.2, "ein bewusstes Genre-Rework-Experiment").
export function getSceneKeyForMachine(machineId: string): string {
    return machineId === GREED_RUN.id ? 'GreedRun' : 'Machine';
}
