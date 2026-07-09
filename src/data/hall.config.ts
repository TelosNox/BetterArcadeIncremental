import type { UpgradeDef } from '../engine/types';
import { TRAINING_KNOWLEDGE_GAIN } from '../engine/AttendantEngine';
import { MACHINES } from './machines.config';

// Hallen-Upgrades (Phase 7, implementation-plan.md Abschnitt 2/4).
//
// Ersetzt VOLLSTAENDIG die Platzhalter-Wirtschaft aus Phase 6 (PM-Vorgabe,
// STATUS.md "PM-Entscheidungen", Punkt 1: "muss dort VOLLSTAENDIG durch
// hall.config.ts ersetzt werden, nicht nur ergaenzt -- sonst existieren zwei
// Wirtschaftssysteme parallel"):
//   - `TICKET_CONVERSION_RATE = 1` (HallHub.tsx)      -> TICKET_CONVERSION_UPGRADES
//   - `MACHINE_UNLOCK_COST` (machines.config.ts)       -> MACHINE_UNLOCK_UPGRADES
// Die dritte Saeule ist neu in Phase 7 (game-spec.md 3.1 "Credits ->
// Hallen-Upgrades -> verbessern Ticket-Rate & schalten neue Automaten frei",
// implementation-plan.md Phase 7 "Hallen-Upgrades verbessern Ticket-
// Umrechnung UND Attendant-Trainingsgeschwindigkeit"):
//   - ATTENDANT_SPEED_UPGRADES (Cross-Layer-Feedback, Baukasten 1.14)
//
// UpgradeDef-Struktur kommt unveraendert aus src/engine/types.ts
// (implementation-plan.md Abschnitt 3) -- diese Datei ist reine Daten plus
// kleine reine Ableitungsfunktionen (wie getEffectiveFailureChance in
// machines.config.ts), keine Engine-Aenderung. EconomyStore/AttendantEngine
// bleiben unangetastet; UpgradePanel.tsx kauft ausschliesslich ueber die
// bestehende `economyStore.purchaseHallUpgrade(id, cost)`-Schnittstelle.
//
// Konvention fuer alle drei Kategorien: jede Stufe traegt einen ABSOLUTEN
// Wert (nicht additiv zur vorherigen Stufe). Die get*()-Funktionen unten
// nehmen jeweils den hoechsten bereits gekauften Wert (Math.max), damit ein
// theoretisches Ueberspringen einer Stufe nicht zu einem niedrigeren Wert
// fuehrt als eine spaeter gekaufte hoehere Stufe. Kosten steigen bewusst mit
// jeder Stufe, sodass ein rationaler Spieler ohnehin der Reihe nach kauft --
// eine zusaetzliche "requires"-Sperre ist fuer den in game-spec.md 3.1/3.3
// beschriebenen Umfang nicht noetig (kein Blocker, siehe STATUS.md).

// --- 1. Ticket -> Credits Umrechnungskurs (ersetzt TICKET_CONVERSION_RATE) ---
//
// Ohne jedes Upgrade bewusst SCHWAECHER als der bisherige Platzhalter (1.0),
// damit die drei Stufen eine spuerbare, echte Verbesserung sind (sonst waere
// das "Upgrade" nur ein Reskin eines bereits vorhandenen Werts).
export const BASE_TICKET_CONVERSION_RATE = 0.5;

export const TICKET_CONVERSION_UPGRADES: readonly UpgradeDef[] = [
    {
        id: 'ticket-conversion-1',
        name: 'Wechselstube I',
        description: 'Ticket->Credits-Kurs steigt von 0.5 auf 0.75 Credits pro Ticket.',
        cost: 30,
        effect: { type: 'ticketConversionRate', value: 0.75 },
    },
    {
        id: 'ticket-conversion-2',
        name: 'Wechselstube II',
        description: 'Ticket->Credits-Kurs steigt auf 1.1 Credits pro Ticket.',
        cost: 120,
        effect: { type: 'ticketConversionRate', value: 1.1 },
    },
    {
        id: 'ticket-conversion-3',
        name: 'Wechselstube III',
        description: 'Ticket->Credits-Kurs steigt auf 1.5 Credits pro Ticket.',
        cost: 350,
        effect: { type: 'ticketConversionRate', value: 1.5 },
    },
];

export function getTicketConversionRate(ownedHallUpgrades: readonly string[]): number {
    return TICKET_CONVERSION_UPGRADES.reduce((rate, upgrade) => {
        if (upgrade.effect.type === 'ticketConversionRate' && ownedHallUpgrades.includes(upgrade.id)) {
            return Math.max(rate, upgrade.effect.value);
        }
        return rate;
    }, BASE_TICKET_CONVERSION_RATE);
}

// --- 2. Freischalt-Schwellen Automat 2-4 (ersetzt MACHINE_UNLOCK_COST) ---
//
// game-spec.md 3.3: "Automat 2 schaltet frei nach Hallen-Upgrade-Schwelle X
// (basierend auf Credits aus Automat 1), Automat 3/4 analog mit steigenden
// Schwellen". Kosten unveraendert gegenueber der Phase-6-Platzhalterloesung
// uebernommen (bereits manuell verifiziert, siehe STATUS.md Phase 6:
// "700 -> 100 Credits, exakt 50+150+400 abgezogen") -- nur der Mechanismus
// (fest codierte Konstante -> hall.config.ts-Upgrade) aendert sich, nicht
// die Zahlenbalance selbst.
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

// --- 3. Attendant-Trainingsgeschwindigkeit (neu, Cross-Layer-Feedback) ---
//
// Baukasten 1.14: "Hoehere Ebenen sollten rueckwirkend niedrigere
// verbessern". Ein Hallen-Upgrade (gekauft mit Credits, typischerweise aus
// spaeteren Automaten) erhoeht den Musterkenntnis-Gewinn pro Training fuer
// ALLE Automaten gleichzeitig (inkl. Automat 1) -- ohne dieses Upgrade
// bliebe Automat 1s Attendant nach Freischaltung von Automat 2-4 eine
// "stillgelegte Zahl" (Baukasten 1.14), die niemand mehr anfasst.
//
// AttendantEngine.ts bleibt unveraendert (Vorgabe fuer diese Phase): die
// Multiplikation passiert hier, ausserhalb der Engine, auf dem bereits
// exportierten TRAINING_KNOWLEDGE_GAIN, genau wie machines.config.ts schon
// getEffectiveFailureChance ausserhalb von PushYourLuckEngine/PatternEngine
// verzahnt (siehe STATUS.md, "aufgeloester Blocker Phase 3").
//
// Obergrenze bewusst < (MANUAL_KNOWLEDGE_GAIN / TRAINING_KNOWLEDGE_GAIN),
// damit selbst bei voll gekauftem Training manuelles Spielen weiterhin
// schneller Musterkenntnis aufbaut als Credits-Training (game-spec.md 3.2:
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
    ...TICKET_CONVERSION_UPGRADES,
    ...MACHINE_UNLOCK_UPGRADES,
    ...ATTENDANT_SPEED_UPGRADES,
];
