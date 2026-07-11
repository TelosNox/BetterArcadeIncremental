import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { BoostBarrageEngine } from '../../engine/BoostBarrageEngine';
import { gainKnowledgeFromManualPlay } from '../../engine/AttendantEngine';
import type { BoostBarrageBoostType, BoostBarrageMachineConfig, MachineUpgradeDef } from '../../engine/types';
import {
    getBoostColor,
    getBoostPowerLevel,
    getEntryPointMachine,
    getEnemyTypeColor,
    getEnemyTypeLabel,
    getMachineAttendantRate,
    getMachineConfig,
    getMaxBoostCharges,
    getReachedMilestones,
    getWarningWindowMs,
    isFinalMilestoneReached,
} from '../../data/machines.config';
import { getTicketYieldRate } from '../../data/hall.config';
import { economyStore, persist } from '../economy';
import { getSceneKeyForMachine } from '../sceneRouting';
import { createMilestonePips, updateMilestonePips } from './milestonePips';

// Eigene Szene fuer Automat 3 "Boost Barrage" (Phase 7m Genre-Ersatz, game-
// spec.md 4.4) -- ersetzt die generische MachineScene.ts VOLLSTAENDIG fuer
// diesen Automaten (CLAUDE.md "Workflow-Regeln": eigene, genre-spezifische
// Szene bei strukturell abweichender Mechanik erlaubt). Geteilte Buchhaltung
// (EconomyStore, SaveSystem, Tickets-/Meilenstein-Anbindung) wird NICHT
// dupliziert, sondern exakt wie in GreedRunScene.ts/TrapTunnelsScene.ts ueber
// economyStore/persist/machines.config.ts angesprochen.
//
// Rundenstruktur (game-spec.md 4.4 "Rundenstruktur"): KEINE gesonderte
// Planungsphase -- ein Lauf besteht aus einer festen Wellenanzahl, jede Welle
// laeuft automatisch und live ab. Diese Szene treibt eine kontinuierliche
// Gefechts-Schleife: pro Gefecht wird zuerst das aktuelle Roster mit dem
// naechsten (noch unaufgeloesten) Gegner angezeigt, boost-Buttons bleiben die
// ganze Zeit ueber klickbar, nach `getWarningWindowMs(...)` Echtzeit-
// Verzoegerung (das ist das "grosszuegig bemessene Aktivierungsfenster" aus
// game-spec.md 4.4 -- rein UI-Timing, siehe BoostBarrageEngine.ts-Kommentar)
// wird das Gefecht aufgeloest. Nach der letzten Welle startet sofort ein
// neuer Lauf, ohne Zwischenschritt (wie bei Trap Tunnels/Greed Run).

const RESULT_DISPLAY_MS = 900;
const WAVE_TRANSITION_MS = 700;

const ROSTER_ORIGIN = { x: 380, y: 220 };
const ROSTER_SPACING = 85;
const ROSTER_ICON_RADIUS = 18;

const BOOST_LABELS: Readonly<Record<BoostBarrageBoostType, string>> = {
    firepower: 'Feuerkraft',
    shield: 'Schild',
    evade: 'Ausweichen',
    focus: 'Fokus',
};
const BOOST_ORDER: readonly BoostBarrageBoostType[] = ['firepower', 'shield', 'evade', 'focus'];

export class BoostBarrageScene extends Scene {
    private config!: BoostBarrageMachineConfig;
    private engine: BoostBarrageEngine | null = null;
    private feedback = '';
    private milestonesReachedBeforeRun = 0;
    // Bomber-Blink-Warnung (game-spec.md 4.4 "sichtbar signalisiert (Blink-
    // Warnung)") -- eigens getrackte Tweens, damit clearDynamic() sie VOR dem
    // Zerstoeren der zugehoerigen GameObjects stoppt (ein weiterlaufender
    // Tween auf einem bereits zerstoerten Objekt wuerfe sonst Laufzeitfehler).
    private dynamicTweens: Phaser.Tweens.Tween[] = [];

    private scoreText!: Phaser.GameObjects.Text;
    private feedbackText!: Phaser.GameObjects.Text;
    private waveText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private attendantStatusText!: Phaser.GameObjects.Text;
    private milestonePips: Phaser.GameObjects.Shape[] = [];
    private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super('BoostBarrage');
    }

    init(data: { machineId: string }): void {
        const config = getMachineConfig(data.machineId);
        if (!config) {
            throw new Error(`BoostBarrageScene: unbekannte machineId "${data.machineId}"`);
        }
        if (config.kind !== 'boostBarrage') {
            throw new Error(
                `BoostBarrageScene: Automat "${data.machineId}" ist kein Boost-Barrage-Automat (kind="${config.kind}") -- gehoert in eine andere Szene, siehe sceneRouting.ts`,
            );
        }
        this.config = config;
        this.engine = null;
        this.feedback = '';
    }

    create(): void {
        economyStore.unlockMachine(this.config.id);
        this.cameras.main.setBackgroundColor(0x101018);

        this.add.text(512, 28, this.config.name, {
            fontFamily: 'Arial Black', fontSize: 28, color: '#ffffff',
        }).setOrigin(0.5);

        this.scoreText = this.add.text(512, 58, '', {
            fontFamily: 'Arial', fontSize: 20, color: '#ffe066',
        }).setOrigin(0.5);

        this.milestonePips = createMilestonePips(this, this.config, 512, 82);

        this.feedbackText = this.add.text(512, 106, '', {
            fontFamily: 'Arial', fontSize: 15, color: '#ffffff', align: 'center',
            wordWrap: { width: 900 },
        }).setOrigin(0.5, 0);

        this.waveText = this.add.text(512, 150, '', {
            fontFamily: 'Arial', fontSize: 16, color: '#88ccff',
        }).setOrigin(0.5);

        this.statusText = this.add.text(100, 500, '', {
            fontFamily: 'Arial', fontSize: 14, color: '#cccccc',
        });

        this.attendantStatusText = this.add.text(20, 750, '', {
            fontFamily: 'Arial', fontSize: 13, color: '#999999',
        });

        this.renderLegend();

        EventBus.emit('current-scene-ready', this);

        // Selbe Bruecken-Konvention wie GreedRunScene.ts/TrapTunnelsScene.ts.
        const handleRequestMachine = ({ machineId }: { machineId: string }) => {
            this.scene.start(getSceneKeyForMachine(machineId), { machineId });
        };
        EventBus.on('request-machine', handleRequestMachine);
        this.events.once('shutdown', () => EventBus.off('request-machine', handleRequestMachine));

        this.startNewRun();
    }

    private getOwnedUpgradeIds(): readonly string[] {
        return economyStore.getMachineUpgrades(this.config.id);
    }

    private clearDynamic(): void {
        this.dynamicTweens.forEach((tween) => tween.stop());
        this.dynamicTweens = [];
        this.dynamicObjects.forEach((obj) => obj.destroy());
        this.dynamicObjects = [];
    }

    private makeButton(
        x: number,
        y: number,
        width: number,
        height: number,
        label: string,
        onClick: () => void,
        color = 0x2c3e50,
    ): void {
        const bg = this.add
            .rectangle(x, y, width, height, color)
            .setStrokeStyle(2, 0xffffff)
            .setInteractive({ useHandCursor: true });
        const text = this.add
            .text(x, y, label, {
                fontFamily: 'Arial', fontSize: 12, color: '#ffffff', align: 'center',
                wordWrap: { width: width - 10 },
            })
            .setOrigin(0.5);
        bg.on('pointerdown', onClick);
        bg.on('pointerover', () => bg.setFillStyle(color, 0.8));
        bg.on('pointerout', () => bg.setFillStyle(color, 1));
        this.dynamicObjects.push(bg, text);
    }

    // --- Statische Legende (einmalig, game-spec.md 4.4 + CLAUDE.md ---------
    // Barrierefreiheits-Grundsatz: Form/Symbol UND Farbe, nie Farbe allein) --

    private renderLegend(): void {
        const x = 720;
        let y = 150;
        this.add.text(x, y, 'Gegner:', { fontFamily: 'Arial', fontSize: 13, color: '#999999' });
        y += 24;

        this.add.circle(x + 10, y, 9, getEnemyTypeColor('scout')).setStrokeStyle(1, 0x000000);
        this.add.text(x + 10, y, getEnemyTypeLabel('scout'), { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.add.text(x + 26, y, 'Scout (Kreis, zuverlaessig getroffen)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 24;

        this.add.rectangle(x + 10, y, 16, 16, getEnemyTypeColor('bomber')).setStrokeStyle(1, 0x000000);
        this.add.text(x + 10, y, getEnemyTypeLabel('bomber'), { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.add.text(x + 26, y, 'Bomber (Quadrat, blinkt vor Feuern)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 24;

        this.add.triangle(x + 10, y, 0, 10, 9, -9, 18, 10, getEnemyTypeColor('elite')).setStrokeStyle(1, 0x000000);
        this.add.text(x + 10, y + 1, getEnemyTypeLabel('elite'), { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.add.text(x + 26, y, 'Elite (Dreieck, evasiv)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 32;

        this.add.text(x, y, 'Boosts:', { fontFamily: 'Arial', fontSize: 13, color: '#999999' });
        y += 24;
        for (const boost of BOOST_ORDER) {
            this.add.rectangle(x + 10, y, 16, 16, getBoostColor(boost)).setStrokeStyle(1, 0xffffff);
            this.add.text(x + 26, y, BOOST_LABELS[boost], { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
            y += 24;
        }
    }

    // --- Roster-Darstellung ---------------------------------------------------

    private rosterCenter(index: number, count: number): { x: number; y: number } {
        const startX = ROSTER_ORIGIN.x - ((count - 1) * ROSTER_SPACING) / 2;
        return { x: startX + index * ROSTER_SPACING, y: ROSTER_ORIGIN.y };
    }

    private drawEnemyIcon(x: number, y: number, type: 'scout' | 'bomber' | 'elite', dimmed: boolean): Phaser.GameObjects.Shape {
        const color = getEnemyTypeColor(type);
        const alpha = dimmed ? 0.35 : 1;
        let shape: Phaser.GameObjects.Shape;
        if (type === 'scout') {
            shape = this.add.circle(x, y, ROSTER_ICON_RADIUS, color);
        } else if (type === 'bomber') {
            shape = this.add.rectangle(x, y, ROSTER_ICON_RADIUS * 1.7, ROSTER_ICON_RADIUS * 1.7, color);
        } else {
            shape = this.add.triangle(
                x,
                y,
                0,
                ROSTER_ICON_RADIUS,
                ROSTER_ICON_RADIUS,
                -ROSTER_ICON_RADIUS,
                ROSTER_ICON_RADIUS * 2,
                ROSTER_ICON_RADIUS,
                color,
            );
        }
        shape.setStrokeStyle(2, 0x000000).setAlpha(alpha);
        this.dynamicObjects.push(shape);
        const label = this.add
            .text(x, y, getEnemyTypeLabel(type), { fontFamily: 'Arial Black', fontSize: 12, color: '#000000' })
            .setOrigin(0.5)
            .setAlpha(alpha);
        this.dynamicObjects.push(label);
        return shape;
    }

    private renderRoster(): void {
        if (!this.engine) return;
        const roster = this.engine.getRoster();
        const currentIndex = this.engine.getCurrentEncounterIndex();

        roster.forEach((type, index) => {
            const { x, y } = this.rosterCenter(index, roster.length);
            const isCurrent = index === currentIndex;
            const shape = this.drawEnemyIcon(x, y, type, index < currentIndex);

            if (isCurrent) {
                const marker = this.add
                    .rectangle(x, y, ROSTER_ICON_RADIUS * 2 + 14, ROSTER_ICON_RADIUS * 2 + 14)
                    .setStrokeStyle(3, 0xffffff);
                this.dynamicObjects.push(marker);

                // Bomber-Blink-Warnung (game-spec.md 4.4 "sichtbar signalisiert
                // (Blink-Warnung) bevor er ausloest") -- zusaetzlich zur eigenen
                // Form/Farbe, kein alleiniges Farbmerkmal.
                if (type === 'bomber') {
                    const tween = this.tweens.add({
                        targets: shape,
                        alpha: 0.3,
                        duration: 350,
                        yoyo: true,
                        repeat: -1,
                    });
                    this.dynamicTweens.push(tween);
                }
            }
        });
    }

    // --- Boost-Aktivierung -----------------------------------------------

    private renderBoostButtons(): void {
        if (!this.engine) return;
        const engine = this.engine;
        const activeBoosts = engine.getActiveBoosts();
        const totalWidth = BOOST_ORDER.length * 190;
        const startX = 512 - totalWidth / 2 + 95;

        BOOST_ORDER.forEach((boost, index) => {
            const x = startX + index * 190;
            const charges = engine.getCharges(boost);
            const canActivate = engine.canActivateBoost(boost);
            const isActive = activeBoosts.includes(boost);
            const label = `${BOOST_LABELS[boost]}${isActive ? ' (AKTIV)' : ''}\nLadungen: ${charges}`;
            const baseColor = getBoostColor(boost);
            const color = canActivate ? baseColor : 0x333333;

            this.makeButton(
                x,
                420,
                170,
                60,
                label,
                () => {
                    if (!engine.activateBoost(boost)) return;
                    const knowledge = economyStore.getAttendantKnowledge(this.config.id);
                    economyStore.setAttendantKnowledge(this.config.id, gainKnowledgeFromManualPlay(knowledge));
                    this.renderPhase();
                },
                color,
            );
        });
    }

    // --- Automaten-interne Upgrade-Achsen (game-spec.md 4.4, drei ----------
    // unabhaengige Leitern, bewusst OHNE Kreuz-Preis-Kopplung, analog zu ------
    // Trap Tunnels/Greed Run) ------------------------------------------------

    private renderUpgradeLadderShop(y: number, ladder: readonly MachineUpgradeDef[], owned: readonly string[]): void {
        const nextUpgrade = ladder.find((upgrade) => !owned.includes(upgrade.id));
        if (!nextUpgrade) return;

        const cost = nextUpgrade.cost;
        const points = economyStore.getMachinePoints(this.config.id).toNumber();
        const canAfford = points >= cost;
        const label = `${nextUpgrade.name}\n${nextUpgrade.description}\nKosten: ${cost.toFixed(1)} Automaten-Punkte (${points.toFixed(1)} vorhanden)`;
        this.makeButton(
            650,
            y,
            460,
            55,
            label,
            () => {
                if (economyStore.purchaseMachineUpgrade(this.config.id, nextUpgrade.id, cost)) {
                    persist();
                    this.renderPhase();
                }
            },
            canAfford ? 0x8e44ad : 0x444444,
        );
    }

    private renderUpgradeShop(): void {
        const owned = this.getOwnedUpgradeIds();
        this.renderUpgradeLadderShop(560, this.config.warningUpgrades, owned);
        this.renderUpgradeLadderShop(620, this.config.boostPowerUpgrades, owned);
        this.renderUpgradeLadderShop(680, this.config.chargeUpgrades, owned);
    }

    // --- Statustexte (persistente Objekte, nur Text wird aktualisiert) -----

    private updateWaveText(): void {
        if (!this.engine) {
            this.waveText.setText('');
            return;
        }
        this.waveText.setText(
            `Welle ${this.engine.getWaveIndex() + 1}/${this.engine.getWaveCount()} | Gefecht ${Math.min(
                this.engine.getCurrentEncounterIndex() + 1,
                this.engine.getRoster().length,
            )}/${this.engine.getRoster().length}`,
        );
    }

    private updateStatusText(): void {
        const owned = this.getOwnedUpgradeIds();
        const warningMs = getWarningWindowMs(this.config, owned);
        const boostPower = getBoostPowerLevel(this.config, owned);
        const maxCharges = getMaxBoostCharges(this.config, owned);
        this.statusText.setText(
            `Aktivierungsfenster ~${(warningMs / 1000).toFixed(1)}s | Boost-Staerke ${boostPower} | Ladungen je Boost ${maxCharges}`,
        );
    }

    // Rein informative Anzeige, dieselbe Konvention wie GreedRunScene.ts/TrapTunnelsScene.ts.
    private updateAttendantStatusText(): void {
        if (!economyStore.isMachineCompleted(this.config.id)) {
            this.attendantStatusText.setText('Attendant: noch nicht freigeschaltet (erst durchspielen)');
            return;
        }
        const knowledge = economyStore.getAttendantKnowledge(this.config.id);
        const knowledgePct = Math.round(knowledge * 100);
        const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
        const rate = getMachineAttendantRate(this.config, knowledge, this.getOwnedUpgradeIds(), ticketYieldRate);
        this.attendantStatusText.setText(
            `Attendant: laeuft im Hintergrund (vereinfachte Schaetzung ohne Timing-Simulation) – Musterkenntnis ${knowledgePct}%, ~${rate.machinePointsPerSecond.toFixed(2)} Automaten-Punkte/s, ~${rate.hallTicketsPerSecond.toFixed(2)} Tickets/s`,
        );
    }

    private renderBackToHallButton(): void {
        if (!economyStore.isMachineCompleted(getEntryPointMachine().id)) return;
        this.makeButton(100, 24, 160, 40, 'Zur Halle', () => EventBus.emit('return-to-hall'), 0x34495e);
    }

    // --- Master-Render ---------------------------------------------------

    private renderPhase(): void {
        this.clearDynamic();
        const peak = economyStore.getMachinePeakScore(this.config.id).toNumber();
        this.scoreText.setText(`Punkte: ${economyStore.getMachinePoints(this.config.id).toNumber().toFixed(1)}`);
        updateMilestonePips(this.milestonePips, this.config, peak);
        this.updateAttendantStatusText();
        this.renderBackToHallButton();
        this.feedbackText.setText(this.feedback);
        this.updateWaveText();
        this.updateStatusText();

        this.renderRoster();
        this.renderBoostButtons();
        this.renderUpgradeShop();
    }

    // --- Lauf-/Wellen-/Gefechts-Lebenszyklus --------------------------------

    private startNewRun(): void {
        const owned = this.getOwnedUpgradeIds();
        const boostPowerLevel = getBoostPowerLevel(this.config, owned);
        const maxCharges = getMaxBoostCharges(this.config, owned);
        this.engine = new BoostBarrageEngine(this.config.run, boostPowerLevel, maxCharges, Math.random);
        this.feedback = '';
        this.milestonesReachedBeforeRun = getReachedMilestones(
            this.config,
            economyStore.getMachinePeakScore(this.config.id).toNumber(),
        ).length;
        this.renderPhase();
        this.runLoop();
    }

    private runLoop(): void {
        if (!this.engine) return;
        const engine = this.engine;

        if (engine.isRunComplete()) {
            this.finishRun();
            return;
        }
        if (engine.isWaveComplete()) {
            engine.startNextWave();
            this.renderPhase();
            this.time.delayedCall(WAVE_TRANSITION_MS, () => this.runLoop());
            return;
        }

        this.renderPhase();
        const owned = this.getOwnedUpgradeIds();
        const delay = getWarningWindowMs(this.config, owned);
        this.time.delayedCall(delay, () => {
            const result = engine.resolveNextEncounter();
            this.applyEncounterResult(result);
            this.renderPhase();
            this.time.delayedCall(RESULT_DISPLAY_MS, () => this.runLoop());
        });
    }

    private applyEncounterResult(result: ReturnType<BoostBarrageEngine['resolveNextEncounter']>): void {
        economyStore.applyMachineScoreDelta(this.config.id, result.payout);

        const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
        const hallTicketsGained = Math.max(0, result.payout) * this.config.ticketYieldFactor * ticketYieldRate;
        if (hallTicketsGained > 0) {
            economyStore.addHallTickets(hallTicketsGained);
        }

        const typeLabel = getEnemyTypeLabel(result.type);
        const boostSuffix = result.boostsActive.length > 0 ? ` [${result.boostsActive.map((b) => BOOST_LABELS[b]).join('+')} aktiv]` : '';
        const sign = result.payout >= 0 ? '+' : '';
        const outcomeLabel = result.destroyed ? 'zerstoert' : result.payout < 0 ? 'trifft' : 'entkommt';
        this.feedback = `${typeLabel}-Gegner ${outcomeLabel} (${sign}${result.payout.toFixed(1)} Punkte, +${hallTicketsGained.toFixed(2)} Tickets)${boostSuffix}.`;
    }

    // Rundenstruktur (game-spec.md 4.4): der Lauf endet nach der letzten
    // Welle IMMER unwiderruflich, direkt danach startet automatisch der
    // naechste Lauf -- kein Fokus-Popup/keine "beibehalten"-Checkbox (analog
    // zu Trap Tunnels/Greed Run).
    private finishRun(): void {
        const peak = economyStore.getMachinePeakScore(this.config.id).toNumber();
        const reachedNow = getReachedMilestones(this.config, peak).length;
        const isFinal = isFinalMilestoneReached(this.config, peak);
        const isFirstCompletion = isFinal && !economyStore.isMachineCompleted(this.config.id);

        if (isFirstCompletion) {
            economyStore.markMachineCompleted(this.config.id);
            persist();
        }

        if (reachedNow > this.milestonesReachedBeforeRun) {
            this.feedback += isFinal ? ' Durchgespielt! Letzter Meilenstein erreicht.' : ' Meilenstein erreicht!';
        }
        this.feedback += ' Lauf beendet.';

        this.startNewRun();
    }
}
