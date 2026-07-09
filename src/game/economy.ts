import { EconomyStore } from '../engine/EconomyStore';
import { SaveSystem } from '../engine/SaveSystem';
import { applyAttendantElapsed } from '../engine/AttendantEngine';
import { MACHINES, getMachineAttendantRate } from '../data/machines.config';
import { getTicketYieldRate } from '../data/hall.config';

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

// Attendant-Rate-Anwendung (Phase 7d, game-spec.md 3.2): laeuft fuer ALLE
// freigeschalteten UND durchgespielten Automaten GLEICHZEITIG, unabhaengig
// davon, welche Phaser-Szene aktuell geladen ist oder ob der Spieler in der
// Halle oder an einem Automaten steht -- loest damit das "stillgelegte
// Zahl"-Problem aus Phase 5 (dort lief der Attendant nur fuer den einen
// Automaten, dessen MachineScene gerade instanziert war). Wird periodisch
// von App.tsx aufgerufen (siehe dort), NICHT an Phasers Szenen-Lifecycle
// gebunden.
//
// Verwendet VERSTRICHENE ECHTZEIT (EconomyStore.getLastAttendantUpdate())
// statt eines Tick-Zaehlers -- ein Aufruf nach langer Abwesenheit (Tab
// geschlossen, neu geladen) wendet automatisch den korrekten Offline-Ertrag
// an (applyAttendantElapsed waehlt selbst den passenden Pfad, siehe
// AttendantEngine.ts).
export function tickAttendants(now: number = Date.now()): void {
    const lastUpdate = economyStore.getLastAttendantUpdate();
    const elapsedMs = now - lastUpdate;
    economyStore.setLastAttendantUpdate(now);

    if (elapsedMs <= 0) {
        return;
    }

    const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
    let totalHallTicketsGained = 0;
    let anyGain = false;

    for (const machine of MACHINES) {
        if (!economyStore.isMachineUnlocked(machine.id) || !economyStore.isMachineCompleted(machine.id)) {
            continue;
        }

        const knowledge = economyStore.getAttendantKnowledge(machine.id);
        const ownedUpgradeIds = economyStore.getMachineUpgrades(machine.id);
        const rate = getMachineAttendantRate(machine, knowledge, ownedUpgradeIds, ticketYieldRate);

        const pool = economyStore.getAttendantPool(machine.id);
        const result = applyAttendantElapsed(pool, rate, elapsedMs);
        economyStore.setAttendantPool(machine.id, result.pool);

        if (result.machinePointsGained > 0) {
            economyStore.addMachinePoints(machine.id, result.machinePointsGained);
            anyGain = true;
        }
        totalHallTicketsGained += result.hallTicketsGained;
    }

    if (totalHallTicketsGained > 0) {
        economyStore.addHallTickets(totalHallTicketsGained);
        anyGain = true;
    }

    if (anyGain) {
        persist();
    }
}
