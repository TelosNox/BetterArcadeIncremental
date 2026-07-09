import type { UpgradeDef } from '../engine/types';
import { economyStore, persist } from '../game/economy';
import {
    ATTENDANT_SPEED_UPGRADES,
    MACHINE_UNLOCK_UPGRADES,
    TICKET_YIELD_UPGRADES,
    getAttendantTrainingMultiplier,
    getTicketYieldRate,
} from '../data/hall.config';
import { useEconomyRevision } from './useEconomyRevision';

// Hallen-Upgrades (Phase 7, implementation-plan.md Abschnitt 2/4; Ticket-
// Ertragsrate-Kategorie ueberarbeitet in Phase 7d, siehe STATUS.md). Einzige
// Kaufoberflaeche fuer hall.config.ts-Upgrades. Kauft ausschliesslich ueber
// die bestehende `economyStore.purchaseHallUpgrade()`-Schnittstelle
// (Architektur-Kurzregel CLAUDE.md) -- kein eigener paralleler State. Spendet
// seit Phase 7d hallenweite Tickets statt Credits (EconomyStore.ts).

function purchaseUpgrade(upgrade: UpgradeDef): void {
    if (!economyStore.purchaseHallUpgrade(upgrade.id, upgrade.cost)) {
        return;
    }
    // unlockMachine-Upgrades muessen zusaetzlich economyStore.unlockMachine()
    // ausloesen -- purchaseHallUpgrade selbst kennt nur den generischen
    // "gekauft/nicht gekauft"-Zustand, nicht dessen Bedeutung.
    if (upgrade.effect.type === 'unlockMachine') {
        economyStore.unlockMachine(upgrade.effect.machineId);
    }
    persist();
}

interface UpgradeRowProps {
    upgrade: UpgradeDef;
}

function UpgradeRow({ upgrade }: UpgradeRowProps) {
    const owned = economyStore.hasHallUpgrade(upgrade.id);
    const canAfford = economyStore.getHallTickets().gte(upgrade.cost);

    return (
        <div className="upgrade-panel__row">
            <div className="upgrade-panel__row-info">
                <strong>{upgrade.name}</strong>
                <p>{upgrade.description}</p>
            </div>
            <button
                type="button"
                onClick={() => purchaseUpgrade(upgrade)}
                disabled={owned || !canAfford}
            >
                {owned ? 'Gekauft' : `Kaufen (${upgrade.cost} Tickets)`}
            </button>
        </div>
    );
}

export function UpgradePanel() {
    useEconomyRevision();

    const state = economyStore.getState();
    const currentYieldRate = getTicketYieldRate(state.hallUpgrades);
    const currentTrainingMultiplier = getAttendantTrainingMultiplier(state.hallUpgrades);

    return (
        <div className="upgrade-panel">
            <h2>Hallen-Upgrades</h2>

            <section className="upgrade-panel__section">
                <h3>Ticket-Ertragsrate (aktuell: {currentYieldRate.toFixed(2)}x)</h3>
                {TICKET_YIELD_UPGRADES.map((upgrade) => (
                    <UpgradeRow upgrade={upgrade} key={upgrade.id} />
                ))}
            </section>

            <section className="upgrade-panel__section">
                <h3>Automaten freischalten</h3>
                {MACHINE_UNLOCK_UPGRADES.map((upgrade) => (
                    <UpgradeRow upgrade={upgrade} key={upgrade.id} />
                ))}
            </section>

            <section className="upgrade-panel__section">
                <h3>Attendant-Training (aktuell: {currentTrainingMultiplier.toFixed(2)}x Musterkenntnis-Gewinn)</h3>
                {ATTENDANT_SPEED_UPGRADES.map((upgrade) => (
                    <UpgradeRow upgrade={upgrade} key={upgrade.id} />
                ))}
            </section>
        </div>
    );
}
