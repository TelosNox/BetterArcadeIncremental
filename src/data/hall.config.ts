import type { UpgradeDef } from '../engine/types';
import { TRAINING_KNOWLEDGE_GAIN } from '../engine/AttendantEngine';
import { MACHINES } from './machines.config';

// Hallen-Upgrades (Phase 7, implementation-plan.md Abschnitt 2/4; Ticket-
// Ertragsrate-Kategorie ueberarbeitet in Phase 7d, siehe STATUS.md).
//
// Drei Saeulen, alle bezahlt mit der EINEN hallenweiten Ticket-Waehrung
// (Phase 7d, "Credits" entfaellt komplett):
//   - TICKET_YIELD_UPGRADES (ersetzt TICKET_CONVERSION_UPGRADES/
//     getTicketConversionRate aus Phase 7): direkter Multiplikator auf den
//     Ticket-Ertrag pro Aktion, hallenweit, wirkt auf alle Automaten
//     gleichzeitig (Cross-Layer-Feedback, Baukasten 1.14). Phase 7d loest
//     damit die fruehere zweistufige "Tickets (pro Automat) -> Credits
//     (Kurs) -> Hallen-Upgrades"-Kette durch eine Ebene weniger ab: ein
//     Umrechnungskurs zwischen zwei Waehrungen, die nur nacheinander
//     verwendet wurden, ist mathematisch identisch mit einer direkten
//     Ertragsrate-Erhoehung in der Zielwaehrung (game-spec.md 3.1).
//   - MACHINE_UNLOCK_UPGRADES (unveraendert gegenueber Phase 7, nur die
//     Waehrung heisst jetzt "Tickets" statt "Credits")
//   - ATTENDANT_SPEED_UPGRADES (unveraendert gegenueber Phase 7)
//
// UpgradeDef-Struktur kommt unveraendert aus src/engine/types.ts -- diese
// Datei ist reine Daten plus kleine reine Ableitungsfunktionen, keine
// Engine-Aenderung. EconomyStore/AttendantEngine bleiben unangetastet;
// UpgradePanel.tsx kauft ausschliesslich ueber die bestehende
// `economyStore.purchaseHallUpgrade(id, cost)`-Schnittstelle (spendet jetzt
// intern Tickets statt Credits, siehe EconomyStore.ts).
//
// Konvention fuer alle drei Kategorien: jede Stufe traegt einen ABSOLUTEN
// Wert (nicht additiv zur vorherigen Stufe). Die get*()-Funktionen unten
// nehmen jeweils den hoechsten bereits gekauften Wert (Math.max), damit ein
// theoretisches Ueberspringen einer Stufe nicht zu einem niedrigeren Wert
// fuehrt als eine spaeter gekaufte hoehere Stufe. Kosten steigen bewusst mit
// jeder Stufe, sodass ein rationaler Spieler ohnehin der Reihe nach kauft --
// eine zusaetzliche "requires"-Sperre ist fuer den in game-spec.md 3.1/3.3
// beschriebenen Umfang nicht noetig (kein Blocker, siehe STATUS.md).

// --- 1. Ticket-Ertragsrate (ersetzt Ticket->Credits-Umrechnungskurs) -------
//
// Basis 1.0 = kein Multiplikator (neutral) -- anders als der fruehere
// Umrechnungskurs (Basis 0.5, siehe Phase 7), weil es jetzt keine
// Zwischenwaehrung mehr gibt, die "abgewertet" gestartet werden muesste: der
// Ticket-Ertrag selbst ist bereits der volle, direkte Ausdruck des Spiel-
// Ergebnisses (siehe machines.config.ts::getMachineAttendantRate/
// MachineScene.ts fuer die Anwendung). Kosten-Stufen unveraendert aus Phase 7
// uebernommen (30/120/350) -- die relative Progression bleibt gleich
// sinnvoll, exakte Zahlenbalance wird laut game-spec.md Abschnitt 6 iterativ
// beim Playtesting getunt, nicht in dieser Phase neu simuliert.
export const BASE_TICKET_YIELD_RATE = 1.0;

export const TICKET_YIELD_UPGRADES: readonly UpgradeDef[] = [
    {
        id: 'ticket-yield-1',
        name: 'Kassenautomat I',
        description: 'Ticket-Ertrag pro Aktion steigt auf das 1.5-fache (alle Automaten).',
        cost: 30,
        effect: { type: 'ticketYieldRate', value: 1.5 },
    },
    {
        id: 'ticket-yield-2',
        name: 'Kassenautomat II',
        description: 'Ticket-Ertrag pro Aktion steigt auf das 2.25-fache (alle Automaten).',
        cost: 120,
        effect: { type: 'ticketYieldRate', value: 2.25 },
    },
    {
        id: 'ticket-yield-3',
        name: 'Kassenautomat III',
        description: 'Ticket-Ertrag pro Aktion steigt auf das 3.0-fache (alle Automaten).',
        cost: 350,
        effect: { type: 'ticketYieldRate', value: 3.0 },
    },
];

export function getTicketYieldRate(ownedHallUpgrades: readonly string[]): number {
    return TICKET_YIELD_UPGRADES.reduce((rate, upgrade) => {
        if (upgrade.effect.type === 'ticketYieldRate' && ownedHallUpgrades.includes(upgrade.id)) {
            return Math.max(rate, upgrade.effect.value);
        }
        return rate;
    }, BASE_TICKET_YIELD_RATE);
}

// --- 2. Freischalt-Schwellen Automat 2-4 (ersetzt MACHINE_UNLOCK_COST) ---
//
// game-spec.md 3.3: "Automat 2 schaltet frei nach Hallen-Upgrade-Schwelle X
// (basierend auf Tickets aus Automat 1), Automat 3/4 analog mit steigenden
// Schwellen". Kosten unveraendert gegenueber Phase 7 (nur die Waehrung heisst
// jetzt "Tickets" statt "Credits", siehe STATUS.md Phase 7d).
const MACHINE_UNLOCK_COSTS: Readonly<Record<string, number>> = {
    'trap-tunnels': 50,
    'beat-ledger': 150,
    'champions-ledger': 400,
};

export const MACHINE_UNLOCK_UPGRADES: readonly UpgradeDef[] = MACHINES.filter((machine) => !machine.entryPoint).map(
    (machine) => ({
        id: `unlock-${machine.id}`,
        name: `${machine.name} freischalten`,
        description: `Schaltet den Automaten "${machine.name}" in der Halle frei.`,
        cost: MACHINE_UNLOCK_COSTS[machine.id],
        effect: { type: 'unlockMachine', machineId: machine.id },
    }),
);

export function getMachineUnlockUpgrade(machineId: string): UpgradeDef | undefined {
    return MACHINE_UNLOCK_UPGRADES.find(
        (upgrade) => upgrade.effect.type === 'unlockMachine' && upgrade.effect.machineId === machineId,
    );
}

// --- 3. Attendant-Trainingsgeschwindigkeit (Cross-Layer-Feedback) ---------
//
// Baukasten 1.14: "Hoehere Ebenen sollten rueckwirkend niedrigere
// verbessern". Ein Hallen-Upgrade (gekauft mit Tickets, typischerweise aus
// spaeteren Automaten) erhoeht den Musterkenntnis-Gewinn pro Training fuer
// ALLE Automaten gleichzeitig (inkl. Automat 1) -- ohne dieses Upgrade
// bliebe Automat 1s Attendant nach Freischaltung von Automat 2-4 eine
// "stillgelegte Zahl" (Baukasten 1.14), die niemand mehr anfasst.
//
// AttendantEngine.ts bleibt unveraendert (Vorgabe fuer diese Phase): die
// Multiplikation passiert hier, ausserhalb der Engine, auf dem bereits
// exportierten TRAINING_KNOWLEDGE_GAIN.
//
// Obergrenze bewusst < (MANUAL_KNOWLEDGE_GAIN / TRAINING_KNOWLEDGE_GAIN),
// damit selbst bei voll gekauftem Training manuelles Spielen weiterhin
// schneller Musterkenntnis aufbaut als Tickets-Training (game-spec.md 3.2:
// Training bleibt "sekundaer, langsamer als eigenes Spielen") -- per Test
// abgesichert (hall.config.test.ts).
export const BASE_ATTENDANT_TRAINING_MULTIPLIER = 1;

export const ATTENDANT_SPEED_UPGRADES: readonly UpgradeDef[] = [
    {
        id: 'attendant-speed-1',
        name: 'Schulungsprogramm I',
        description: 'Musterkenntnis-Gewinn pro Training steigt auf das 1.4-fache (alle Automaten).',
        cost: 40,
        effect: { type: 'attendantSpeed', value: 1.4 },
    },
    {
        id: 'attendant-speed-2',
        name: 'Schulungsprogramm II',
        description: 'Musterkenntnis-Gewinn pro Training steigt auf das 1.8-fache (alle Automaten).',
        cost: 150,
        effect: { type: 'attendantSpeed', value: 1.8 },
    },
];

export function getAttendantTrainingMultiplier(ownedHallUpgrades: readonly string[]): number {
    return ATTENDANT_SPEED_UPGRADES.reduce((multiplier, upgrade) => {
        if (upgrade.effect.type === 'attendantSpeed' && ownedHallUpgrades.includes(upgrade.id)) {
            return Math.max(multiplier, upgrade.effect.value);
        }
        return multiplier;
    }, BASE_ATTENDANT_TRAINING_MULTIPLIER);
}

// Effektiver Musterkenntnis-Gewinn pro Training-Klick, MIT Hallen-Upgrade
// beruecksichtigt. Reine Komposition aus AttendantEngine.TRAINING_KNOWLEDGE_GAIN
// (unveraendert) und dem hier gekauften Multiplikator -- AttendantPanel.tsx
// ruft ausschliesslich diese Funktion auf, statt die Multiplikation selbst
// zu duplizieren.
export function getEffectiveTrainingGain(ownedHallUpgrades: readonly string[]): number {
    return TRAINING_KNOWLEDGE_GAIN * getAttendantTrainingMultiplier(ownedHallUpgrades);
}

export const HALL_UPGRADES: readonly UpgradeDef[] = [
    ...TICKET_YIELD_UPGRADES,
    ...MACHINE_UNLOCK_UPGRADES,
    ...ATTENDANT_SPEED_UPGRADES,
];
