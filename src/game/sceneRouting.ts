import { BOOST_BARRAGE, GREED_RUN, TRAP_TUNNELS } from '../data/machines.config';

// Phase 7f (Greed Run Genre-Rework, CLAUDE.md "Workflow-Regeln"): Automat 1
// bekommt eine eigene Phaser-Szene (Szenen-Key 'GreedRun') statt weiterhin
// ueber die generische 'Machine'-Szene zu laufen. Phase 7i (Trap Tunnels
// Genre-Rework, game-spec.md 4.3) erweitert das um Automat 2 (Szenen-Key
// 'TrapTunnels'). Phase 7m (Boost Barrage Genre-Ersatz, game-spec.md 4.4)
// erweitert das um Automat 3 (Szenen-Key 'BoostBarrage') -- Automat 4 bleibt
// unveraendert auf 'Machine'. Diese Zuordnung wird an mehreren Stellen
// gebraucht (Boot.ts, TransitionScene.ts, MachineScene.ts UND jede genre-
// eigene Szene selbst fuer ihren 'request-machine'-Listener, wenn der Spieler
// in der Halle einen ANDEREN Automaten anwaehlt, auch wenn der andere in
// einer anderen Szenen-Familie lebt) -- deshalb hier EINMAL zentral, statt an
// jeder Stelle den Automaten-id-Vergleich zu duplizieren.
export function getSceneKeyForMachine(machineId: string): string {
    if (machineId === GREED_RUN.id) return 'GreedRun';
    if (machineId === TRAP_TUNNELS.id) return 'TrapTunnels';
    if (machineId === BOOST_BARRAGE.id) return 'BoostBarrage';
    return 'Machine';
}
