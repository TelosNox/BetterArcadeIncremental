import type { BoostBarrageBoostType, BoostBarrageEnemyType, BoostBarrageRunConfig } from './types';

// Boost Barrage (Automat 3, Phase 7m, game-spec.md 4.4): Autopilot-Schiff
// kaempft automatisch gegen eine Gegner-Formation, der Spieler aktiviert
// waehrenddessen vier begrenzt verfuegbare Boosts. Framework-unabhaengig,
// kennt weder Phaser noch React noch /src/data (Architektur-Kurzregel
// CLAUDE.md). Dieselbe Konvention wie TrapTunnelsEngine.ts/GridRunEngine.ts:
// injizierbarer `rng: () => number = Math.random` fuer deterministische
// Tests, reine Funktionen wo moeglich, eine zustandsbehaftete Klasse fuer den
// Zustand EINES laufenden Laufs (alle `waveCount`-vielen Wellen).
//
// Die "Vorwarnzeit" (game-spec.md 4.4 "Vorschau/Vorwarnzeit") ist bewusst
// KEIN Engine-Konzept -- sie bestimmt nur, wie lange BoostBarrageScene.ts vor
// jeder Gefechts-Aufloesung in Echtzeit wartet (mehr Zeit zum Reagieren),
// nicht irgendeine Wahrscheinlichkeit hier. Die Engine loest ein Gefecht IMMER
// sofort auf, sobald `resolveNextEncounter()` aufgerufen wird.

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function draw([min, max]: readonly [number, number], rng: () => number): number {
    return min + rng() * (max - min);
}

// --- Roster-Generierung (game-spec.md 4.4 "Gegner-Roster pro Welle fest ---
// generiert") ---------------------------------------------------------------

function pickWeightedEnemyType(weights: Record<BoostBarrageEnemyType, number>, rng: () => number): BoostBarrageEnemyType {
    const entries = Object.entries(weights) as [BoostBarrageEnemyType, number][];
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = rng() * total;
    for (const [type, weight] of entries) {
        if (roll < weight) return type;
        roll -= weight;
    }
    return entries[entries.length - 1][0];
}

// Festes Roster EINER Welle (game-spec.md 4.4 "pro Welle fest generiert",
// dasselbe Prinzip wie das feste Netz/Grid der anderen Genre-Rework-
// Automaten) -- unabhaengig gewuerfelt pro Slot, Scout dominiert deutlich
// ueber `enemyWeights`.
export function generateWaveRoster(config: BoostBarrageRunConfig, rng: () => number = Math.random): BoostBarrageEnemyType[] {
    return Array.from({ length: config.enemiesPerWave }, () => pickWeightedEnemyType(config.enemyWeights, rng));
}

// --- Gefechts-Aufloesung ----------------------------------------------------

export interface EncounterOutcome {
    destroyed: boolean;
    payout: number;
}

// Loest EIN Gefecht auf (game-spec.md 4.4 "Kernidee" + "Vier Boosts" + "Eska-
// lation") -- reine Funktion, kennt keinen Ladungs-/Cooldown-Zustand (der lebt
// in der Klasse unten), nur die aktuell WIRKSAMEN Boosts fuer DIESES Gefecht.
//   - Scout: vom Autopiloten IMMER zuverlaessig zerstoert (traegt die
//     Blind-EV-Garantie), Feuerkraft gibt einen kleinen Bonus-Payout obendrauf
//     ("schnelles Aufraeumen").
//   - Bomber: `destroyChance` (Basis minus Eskalation plus Feuerkraft-Bonus)
//     entscheidet, ob er VOR dem Feuern zerstoert wird (Payout) oder trifft
//     (negativer Payout, Betrag aus bomberHitCostRange) -- Ausweichen negiert
//     einen Treffer VOLLSTAENDIG, Schild nur anteilig (game-spec.md 4.4 Boost-
//     Beschreibungen: Ausweichen "vollstaendig", Schild "reduziert").
//   - Elite: `hitChance` (Basis minus Eskalation, oder GARANTIERT bei aktivem
//     Fokus) entscheidet ueber Treffer (Payout, mit Fokus-Bonus) oder
//     verpasste Gelegenheit (Payout 0, kein negativer Fall -- game-spec.md
//     4.4 nennt fuer Elite keinen Schadensfall, nur "evasiv").
export function resolveEncounter(
    config: BoostBarrageRunConfig,
    type: BoostBarrageEnemyType,
    destroyedCountThisWave: number,
    boostPowerLevel: number,
    activeBoosts: readonly BoostBarrageBoostType[],
    rng: () => number = Math.random,
): EncounterOutcome {
    const escalation = config.escalationPerDestroyed * destroyedCountThisWave;
    const isActive = (boost: BoostBarrageBoostType) => activeBoosts.includes(boost);

    if (type === 'scout') {
        const firepowerBonus = isActive('firepower') ? config.firepowerScoutBonusPerLevel * boostPowerLevel : 0;
        return { destroyed: true, payout: draw(config.scoutPayoutRange, rng) + firepowerBonus };
    }

    if (type === 'bomber') {
        const firepowerBonus = isActive('firepower') ? config.firepowerDestroyBonusPerLevel * boostPowerLevel : 0;
        const destroyChance = clamp01(config.baseBomberDestroyChance - escalation + firepowerBonus);
        if (rng() < destroyChance) {
            return { destroyed: true, payout: draw(config.bomberDestroyPayoutRange, rng) };
        }
        const rawCost = draw(config.bomberHitCostRange, rng);
        if (isActive('evade')) {
            return { destroyed: false, payout: 0 };
        }
        if (isActive('shield')) {
            const reduction = clamp01(config.shieldDamageReductionPerLevel * boostPowerLevel);
            return { destroyed: false, payout: -rawCost * (1 - reduction) };
        }
        return { destroyed: false, payout: -rawCost };
    }

    // elite
    const hitChance = isActive('focus') ? 1 : clamp01(config.baseEliteHitChance - escalation);
    if (rng() < hitChance) {
        const focusBonus = isActive('focus') ? 1 + config.focusHitBonusPerLevel * boostPowerLevel : 1;
        return { destroyed: true, payout: draw(config.elitePayoutRange, rng) * focusBonus };
    }
    return { destroyed: false, payout: 0 };
}

// Blind-Erwartungswert-Garantie (game-spec.md 4.4 PFLICHT, PER SIMULATION
// ueber viele Seeds, gleiches Prinzip wie computeBlindTrapExpectedValue/
// computeBlindExpectedValue): eine komplette Welle OHNE jeden Boost-Einsatz
// muss im Schnitt positiv bleiben -- getragen v.a. durch die zuverlaessig
// getroffenen Scouts (game-spec.md 4.4 "Blind-Erwartungswert-Garantie").
export function computeBlindWaveExpectedValue(config: BoostBarrageRunConfig, trials: number, rng: () => number = Math.random): number {
    let total = 0;
    for (let trial = 0; trial < trials; trial += 1) {
        const roster = generateWaveRoster(config, rng);
        let destroyedCount = 0;
        let waveTotal = 0;
        for (const type of roster) {
            const outcome = resolveEncounter(config, type, destroyedCount, 1, [], rng);
            if (outcome.destroyed) destroyedCount += 1;
            waveTotal += outcome.payout;
        }
        total += waveTotal;
    }
    return total / trials;
}

export interface EncounterResult extends EncounterOutcome {
    waveIndex: number;
    encounterIndex: number;
    type: BoostBarrageEnemyType;
    boostsActive: readonly BoostBarrageBoostType[];
}

const ALL_BOOST_TYPES: readonly BoostBarrageBoostType[] = ['firepower', 'shield', 'evade', 'focus'];

// Haelt den Zustand EINES kompletten Laufs (alle `waveCount`-vielen Wellen) --
// bewusst eine Klasse, analog zu TrapTunnelsEngine/GridRunEngine (genuin
// mutierender Zustand: Ladungen, aktive Boost-Dauer, Fortschritt innerhalb
// der aktuellen Welle). `maxCharges`/`boostPowerLevel` gelten fuer den
// GESAMTEN Lauf als fest (anders als Trap Tunnels' Phase-7l-Sonderfall "Live-
// Wirkung waehrend der Planungsphase" -- game-spec.md 4.4 nennt keine solche
// Korrektur fuer Boost Barrage, ein waehrend eines laufenden Laufs gekauftes
// Upgrade wirkt hier bewusst wie bei Greed Runs Aktionsbudget erst ab dem
// NAECHSTEN Lauf).
export class BoostBarrageEngine {
    private readonly config: BoostBarrageRunConfig;
    private readonly boostPowerLevel: number;
    private readonly maxCharges: number;
    private readonly rng: () => number;

    private waveIndex = 0;
    private roster: BoostBarrageEnemyType[] = [];
    private encounterIndex = 0;
    private destroyedCount = 0;
    private charges: Record<BoostBarrageBoostType, number> = { firepower: 0, shield: 0, evade: 0, focus: 0 };
    private activeDuration: Record<BoostBarrageBoostType, number> = { firepower: 0, shield: 0, evade: 0, focus: 0 };
    private waveResults: EncounterResult[] = [];
    private runComplete = false;

    constructor(config: BoostBarrageRunConfig, boostPowerLevel: number, maxCharges: number, rng: () => number = Math.random) {
        if (config.waveCount <= 0) {
            throw new RangeError('BoostBarrageEngine: waveCount muss positiv sein');
        }
        if (config.enemiesPerWave <= 0) {
            throw new RangeError('BoostBarrageEngine: enemiesPerWave muss positiv sein');
        }
        if (boostPowerLevel <= 0) {
            throw new RangeError('BoostBarrageEngine: boostPowerLevel muss positiv sein');
        }
        if (maxCharges <= 0) {
            throw new RangeError('BoostBarrageEngine: maxCharges muss positiv sein');
        }
        this.config = config;
        this.boostPowerLevel = boostPowerLevel;
        this.maxCharges = maxCharges;
        this.rng = rng;
        this.startWaveInternal();
    }

    private startWaveInternal(): void {
        this.roster = generateWaveRoster(this.config, this.rng);
        this.encounterIndex = 0;
        this.destroyedCount = 0;
        this.charges = { firepower: this.maxCharges, shield: this.maxCharges, evade: this.maxCharges, focus: this.maxCharges };
        this.activeDuration = { firepower: 0, shield: 0, evade: 0, focus: 0 };
        this.waveResults = [];
    }

    getWaveIndex(): number {
        return this.waveIndex;
    }

    getWaveCount(): number {
        return this.config.waveCount;
    }

    isRunComplete(): boolean {
        return this.runComplete;
    }

    getRoster(): readonly BoostBarrageEnemyType[] {
        return this.roster;
    }

    getCurrentEncounterIndex(): number {
        return this.encounterIndex;
    }

    isWaveComplete(): boolean {
        return this.encounterIndex >= this.roster.length;
    }

    getDestroyedCount(): number {
        return this.destroyedCount;
    }

    getCharges(boost: BoostBarrageBoostType): number {
        return this.charges[boost];
    }

    getActiveBoosts(): readonly BoostBarrageBoostType[] {
        return ALL_BOOST_TYPES.filter((boost) => this.activeDuration[boost] > 0);
    }

    getWaveResults(): readonly EncounterResult[] {
        return this.waveResults;
    }

    canActivateBoost(boost: BoostBarrageBoostType): boolean {
        if (this.runComplete || this.isWaveComplete()) return false;
        return this.charges[boost] > 0;
    }

    // Verbraucht eine Ladung und macht den Boost fuer das NAECHSTE (noch
    // unaufgeloeste) Gefecht wirksam. Ausweichen deckt bei hoeherer Boost-
    // Staerke mehrere aufeinanderfolgende Gefechte ab (game-spec.md 4.4
    // "Boost-Staerke ... mehr Wirkung pro Aktivierung"); die uebrigen drei
    // wirken bewusst genau ein Gefecht lang (ihre Staerke skaliert stattdessen
    // die Wirkungs-GROESSE, nicht die Dauer, siehe resolveEncounter).
    activateBoost(boost: BoostBarrageBoostType): boolean {
        if (!this.canActivateBoost(boost)) return false;
        this.charges[boost] -= 1;
        const duration =
            boost === 'evade'
                ? this.config.evadeDurationBaseSteps + (this.boostPowerLevel - 1) * this.config.evadeDurationPerExtraLevel
                : 1;
        this.activeDuration[boost] = Math.max(this.activeDuration[boost], duration);
        return true;
    }

    // Loest genau EIN Gefecht auf (das naechste im festen Roster dieser
    // Welle) und rueckt danach vor. Aktive Boost-Dauern klingen um 1 Schritt
    // ab. Wird die Welle dabei komplett UND war es die letzte Welle des
    // Laufs, gilt der gesamte Lauf als beendet (`isRunComplete()`) -- der
    // Aufrufer muss danach `startNextWave()` NICHT mehr aufrufen.
    resolveNextEncounter(): EncounterResult {
        if (this.runComplete) {
            throw new RangeError('BoostBarrageEngine.resolveNextEncounter: Lauf bereits beendet');
        }
        if (this.isWaveComplete()) {
            throw new RangeError('BoostBarrageEngine.resolveNextEncounter: Welle bereits vollstaendig, startNextWave() zuerst aufrufen');
        }

        const type = this.roster[this.encounterIndex];
        const activeBoosts = this.getActiveBoosts();
        const outcome = resolveEncounter(this.config, type, this.destroyedCount, this.boostPowerLevel, activeBoosts, this.rng);

        const result: EncounterResult = {
            waveIndex: this.waveIndex,
            encounterIndex: this.encounterIndex,
            type,
            boostsActive: activeBoosts,
            ...outcome,
        };

        if (outcome.destroyed) this.destroyedCount += 1;
        this.waveResults.push(result);
        this.encounterIndex += 1;

        ALL_BOOST_TYPES.forEach((boost) => {
            if (this.activeDuration[boost] > 0) this.activeDuration[boost] -= 1;
        });

        if (this.isWaveComplete() && this.waveIndex + 1 >= this.config.waveCount) {
            this.runComplete = true;
        }

        return result;
    }

    startNextWave(): void {
        if (this.runComplete) {
            throw new RangeError('BoostBarrageEngine.startNextWave: Lauf bereits beendet');
        }
        if (!this.isWaveComplete()) {
            throw new RangeError('BoostBarrageEngine.startNextWave: aktuelle Welle noch nicht abgeschlossen');
        }
        this.waveIndex += 1;
        this.startWaveInternal();
    }
}
