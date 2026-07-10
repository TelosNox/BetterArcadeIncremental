import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { TrapTunnelsEngine, drawTrapEventPayout, edgeKey, junctionRowCol } from '../../engine/TrapTunnelsEngine';
import { gainKnowledgeFromManualPlay } from '../../engine/AttendantEngine';
import type { MachineUpgradeDef, TrapTunnelsMachineConfig } from '../../engine/types';
import {
    MAX_ENEMY_COUNT,
    TRAP_COLOR,
    getDynamiteCount,
    getEnemyColor,
    getEnemyCount,
    getEnemyLabel,
    getEntryPointMachine,
    getMachineAttendantRate,
    getMachineConfig,
    getReachedMilestones,
    getTrapCount,
    isFinalMilestoneReached,
} from '../../data/machines.config';
import { getTicketYieldRate } from '../../data/hall.config';
import { economyStore, persist } from '../economy';
import { getSceneKeyForMachine } from '../sceneRouting';
import { createMilestonePips, updateMilestonePips } from './milestonePips';

// Eigene Szene fuer Automat 2 "Trap Tunnels" (Phase 7i Genre-Rework, Phase 7j
// Kernmodell-Ersatz: Zufallsbewegung + Dynamit, game-spec.md 4.3 v2) --
// ersetzt die generische MachineScene.ts VOLLSTAENDIG fuer diesen Automaten
// (CLAUDE.md "Workflow-Regeln": eigene, genre-spezifische Szene bei
// strukturell abweichender Mechanik erlaubt). Geteilte Buchhaltung
// (EconomyStore, SaveSystem, Tickets-/Meilenstein-Anbindung) wird NICHT
// dupliziert, sondern exakt wie in GreedRunScene.ts ueber economyStore/
// persist/machines.config.ts angesprochen.
//
// Rundenstruktur (game-spec.md 4.3 "Rundenstruktur", direkt mit der Lektion
// aus Phase 7h gebaut, NICHT erst nachtraeglich korrigiert): ein Run besteht
// aus GENAU EINER Planungsphase (bis zu Fallenanzahl-viele Fallen auf
// Kreuzungen platzieren, bis zu Dynamitanzahl-viele bestehende Verbindungen
// sprengen, beides frei wieder rueckgaengig machbar) + EINER Ausfuehrungsphase
// (alle Gegner laufen live gewuerfelt synchron durchs -- ggf. per Dynamit
// reduzierte -- Netz). "Los" beendet den Run danach IMMER unwiderruflich --
// wie bei Greed Run gibt es hier gar kein Fokus-Popup/keine "beibehalten"-
// Checkbox (game-spec.md 4.3 "Kein Fokus-Wahl-Analogon"), also startet direkt
// nach jeder Ausfuehrung sofort ein neues Netz, ohne Zwischenschritt.
//
// Phase 7j entfernt die Vorschau-Reichweiten-Achse vollstaendig (game-spec.md
// 4.3 "Keine Vorschau-Mechanik" -- die Netz-Topologie ist immer vollstaendig
// sichtbar). Phase 7k korrigiert dabei einen Sichtbarkeits-Fehler: "keine
// Vorschau auf den weiteren Weg" ist etwas anderes als "keine Kenntnis der
// Start-Position" -- die feste Start-Kreuzung jedes Gegners ist seit Phase 7k
// bereits waehrend der Planungsphase sichtbar (game-spec.md 4.3 "Start-
// Kreuzungen muessen waehrend der Planung bekannt/sichtbar sein"), nur der
// WEITERE Weg ab dort wird weiterhin erst bei "Los" live gewuerfelt.

type Phase = 'planning' | 'executing';

const STEP_DELAY_MS = 700;

const JUNCTION_ORIGIN = { x: 110, y: 210 };
const JUNCTION_SPACING = 100;
const JUNCTION_RADIUS = 16;
// Bis zu MAX_ENEMY_COUNT (4) gleichzeitig sichtbare Gegner-Marker an
// derselben Kreuzung (game-spec.md 4.3 "Gegneranzahl") -- vier Ecken-Offsets
// statt nur zwei diagonalen Punkten (Phase 7i).
const ENEMY_MARKER_OFFSETS: readonly { x: number; y: number }[] = [
    { x: -16, y: -16 },
    { x: 16, y: -16 },
    { x: -16, y: 16 },
    { x: 16, y: 16 },
];

export class TrapTunnelsScene extends Scene {
    private config!: TrapTunnelsMachineConfig;
    private engine: TrapTunnelsEngine | null = null;
    private phase: Phase = 'planning';
    private executingStepIndex = -1;
    private maxSteps = 0;
    // Alle Fallen-Ereignisse des laufenden Runs, EINMAL bei "Los" ermittelt
    // (Fallen-/Dynamit-Platzierung steht zu diesem Zeitpunkt fest, danach
    // wuerfelt engine.resolve() die Gegnerbewegung live) -- die Animation
    // liest daraus nur noch pro Schritt, ohne erneut aufzuloesen.
    private precomputedEvents: ReturnType<TrapTunnelsEngine['resolve']> = [];
    private feedback = '';
    private milestonesReachedBeforeExecution = 0;

    private scoreText!: Phaser.GameObjects.Text;
    private feedbackText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private attendantStatusText!: Phaser.GameObjects.Text;
    private milestonePips: Phaser.GameObjects.Shape[] = [];
    private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super('TrapTunnels');
    }

    init(data: { machineId: string }): void {
        const config = getMachineConfig(data.machineId);
        if (!config) {
            throw new Error(`TrapTunnelsScene: unbekannte machineId "${data.machineId}"`);
        }
        if (config.kind !== 'trapTunnels') {
            throw new Error(
                `TrapTunnelsScene: Automat "${data.machineId}" ist kein Trap-Tunnels-Automat (kind="${config.kind}") -- gehoert in eine andere Szene, siehe sceneRouting.ts`,
            );
        }
        this.config = config;
        this.engine = null;
        this.phase = 'planning';
        this.executingStepIndex = -1;
        this.precomputedEvents = [];
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

        this.statusText = this.add.text(100, 640, '', {
            fontFamily: 'Arial', fontSize: 14, color: '#cccccc',
        });

        this.attendantStatusText = this.add.text(20, 750, '', {
            fontFamily: 'Arial', fontSize: 13, color: '#999999',
        });

        this.renderLegend();

        EventBus.emit('current-scene-ready', this);

        // Selbe Bruecken-Konvention wie GreedRunScene.ts (siehe dort fuer die
        // ausfuehrliche Begruendung) -- Routing ueber sceneRouting.ts.
        const handleRequestMachine = ({ machineId }: { machineId: string }) => {
            this.scene.start(getSceneKeyForMachine(machineId), { machineId });
        };
        EventBus.on('request-machine', handleRequestMachine);
        this.events.once('shutdown', () => EventBus.off('request-machine', handleRequestMachine));

        // Kein Fokus-Popup/keine "beibehalten"-Checkbox in dieser Version
        // (game-spec.md 4.3) -- ein Run startet immer sofort.
        this.startNewRun();
    }

    private junctionCenter(id: number): { x: number; y: number } {
        const { row, col } = junctionRowCol(id, this.config.run.gridSize);
        return { x: JUNCTION_ORIGIN.x + col * JUNCTION_SPACING, y: JUNCTION_ORIGIN.y + row * JUNCTION_SPACING };
    }

    private getOwnedUpgradeIds(): readonly string[] {
        return economyStore.getMachineUpgrades(this.config.id);
    }

    private clearDynamic(): void {
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

    // --- Statische Legende (einmalig, game-spec.md 4.3 + CLAUDE.md ---------
    // Barrierefreiheits-Grundsatz: Fallen ueber FORM, Gegner ueber Farbe UND
    // Buchstabe, gesprengte Verbindungen ueber Farbe UND Kreuz-Symbol
    // unterschieden, nie ueber Farbe allein) --------------------------------

    private renderLegend(): void {
        const x = 640;
        let y = 150;
        this.add.text(x, y, 'Legende:', { fontFamily: 'Arial', fontSize: 13, color: '#999999' });
        y += 26;

        this.add.circle(x + 10, y, 8, 0x2c3e50).setStrokeStyle(1, 0x888888);
        this.add.text(x + 26, y, 'Kreuzung (klickbar: Falle setzen)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 26;

        this.add.rectangle(x + 10, y, 16, 16, TRAP_COLOR).setAngle(45).setStrokeStyle(1, 0xffffff);
        this.add.text(x + 26, y, 'Platzierte Falle (Form: Raute)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 26;

        this.add.rectangle(x + 10, y, 20, 5, 0x555a66).setStrokeStyle(1, 0xd55e00);
        this.add.text(x + 26, y, 'Gesprengte Verbindung (Kreuz-Symbol, klickbar)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 26;

        // Zeigt immer ALLE moeglichen Gegner-Label (A-D), unabhaengig von der
        // aktuell gekauften Gegneranzahl -- die Legende wird nur einmalig
        // erzeugt (statisches Element), waehrend die Gegneranzahl per Upgrade
        // waehrenddessen steigen kann (game-spec.md 4.3 "Gegneranzahl").
        for (let i = 0; i < MAX_ENEMY_COUNT; i += 1) {
            const label = getEnemyLabel(i);
            this.add.circle(x + 10, y, 8, getEnemyColor(i)).setStrokeStyle(1, 0x000000);
            this.add.text(x + 10, y, label, { fontFamily: 'Arial Black', fontSize: 8, color: '#000000' }).setOrigin(0.5);
            this.add
                .text(x + 26, y, `Gegner ${label} (Start-Kreuzung bereits waehrend der Planung sichtbar)`, { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' })
                .setOrigin(0, 0.5);
            y += 26;
        }

        const { singleCatchPayoutRange, chainCatchPayoutRange } = this.config.run;
        this.add.text(x, y, `Einzelfang: ${singleCatchPayoutRange[0]}-${singleCatchPayoutRange[1]} Punkte`, {
            fontFamily: 'Arial', fontSize: 12, color: '#cccccc', wordWrap: { width: 320 },
        });
        y += 20;
        this.add.text(x, y, `Kettenreaktion (2+ Gegner, selber Schritt, selbe Falle): ${chainCatchPayoutRange[0]}-${chainCatchPayoutRange[1]} Punkte`, {
            fontFamily: 'Arial', fontSize: 12, color: '#cccccc', wordWrap: { width: 320 },
        });
    }

    // --- Netz-Darstellung ----------------------------------------------------

    private drawEdge(a: number, b: number, blasted: boolean, interactive: boolean): void {
        const pa = this.junctionCenter(a);
        const pb = this.junctionCenter(b);
        const midX = (pa.x + pb.x) / 2;
        const midY = (pa.y + pb.y) / 2;
        const fullDistance = Phaser.Math.Distance.Between(pa.x, pa.y, pb.x, pb.y);
        const length = Math.max(4, fullDistance - 2 * JUNCTION_RADIUS);
        const angle = Phaser.Math.Angle.Between(pa.x, pa.y, pb.x, pb.y);

        const bar = this.add
            .rectangle(midX, midY, length, blasted ? 5 : 3, blasted ? 0x555a66 : 0x444444)
            .setRotation(angle);
        this.dynamicObjects.push(bar);

        if (blasted) {
            // Zweites, farbunabhaengiges Merkmal (CLAUDE.md-Grundsatz): ein
            // Kreuz-Symbol am Mittelpunkt statt die Kante nur auszublenden
            // (game-spec.md 4.3 "visuell klar als entfernt/durchgestrichen
            // markieren, nicht nur ausblenden").
            const crossSize = 9;
            const cross1 = this.add
                .line(0, 0, midX - crossSize, midY - crossSize, midX + crossSize, midY + crossSize, 0xd55e00)
                .setOrigin(0, 0)
                .setLineWidth(3);
            const cross2 = this.add
                .line(0, 0, midX - crossSize, midY + crossSize, midX + crossSize, midY - crossSize, 0xd55e00)
                .setOrigin(0, 0)
                .setLineWidth(3);
            this.dynamicObjects.push(cross1, cross2);
        }

        if (interactive) {
            bar.setInteractive({ useHandCursor: true });
            bar.on('pointerdown', () => {
                if (blasted) {
                    this.engine?.unblastEdge(a, b);
                } else {
                    this.engine?.blastEdge(a, b);
                }
                this.renderPhase();
            });
        }
    }

    private renderNetwork(): void {
        if (!this.engine) return;
        const network = this.engine.getNetwork();
        const blastedEdges = this.engine.getBlastedEdges();

        for (const [a, b] of network.edges) {
            const blasted = blastedEdges.has(edgeKey(a, b));
            const interactive = this.phase === 'planning' && (blasted || this.engine.canBlastEdge(a, b));
            this.drawEdge(a, b, blasted, interactive);
        }

        const placedTraps = this.engine.getPlacedTraps();
        for (let id = 0; id < network.junctionCount; id += 1) {
            const { x, y } = this.junctionCenter(id);
            if (placedTraps.has(id)) {
                const diamond = this.add.rectangle(x, y, 22, 22, TRAP_COLOR).setAngle(45).setStrokeStyle(2, 0xffffff);
                this.dynamicObjects.push(diamond);
                if (this.phase === 'planning') {
                    diamond.setInteractive({ useHandCursor: true });
                    diamond.on('pointerdown', () => {
                        this.engine?.removeTrap(id);
                        this.renderPhase();
                    });
                }
            } else {
                const canPlace = this.phase === 'planning' && this.engine.canPlaceTrap(id);
                const circle = this.add
                    .circle(x, y, JUNCTION_RADIUS, canPlace ? 0x2c3e50 : 0x333333)
                    .setStrokeStyle(1, 0x888888);
                this.dynamicObjects.push(circle);
                if (this.phase === 'planning') {
                    circle.setInteractive({ useHandCursor: true });
                    circle.on('pointerdown', () => {
                        if (this.engine?.placeTrap(id)) this.renderPhase();
                    });
                }
            }
        }

        this.renderEnemyMarkers();
    }

    private drawEnemyMarker(x: number, y: number, color: number, label: string): void {
        const circle = this.add.circle(x, y, 10, color).setStrokeStyle(1, 0x000000);
        const text = this.add.text(x, y, label, { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.dynamicObjects.push(circle, text);
    }

    // Waehrend der Planungsphase ist nur die feste START-Kreuzung jedes
    // Gegners bekannt (game-spec.md 4.3 "Start-Kreuzungen muessen waehrend
    // der Planung bekannt/sichtbar sein", Phase-7k-Fix) -- EIN Marker pro
    // Gegner, kein Schritt-Text noetig, da es nur die eine bekannte Position
    // gibt, keinen Pfad.
    private renderPlanningEnemyMarkers(): void {
        if (!this.engine) return;
        this.engine.getEnemyStartJunctions().forEach((junction, enemyIndex) => {
            const color = getEnemyColor(enemyIndex);
            const label = getEnemyLabel(enemyIndex);
            const offset = ENEMY_MARKER_OFFSETS[enemyIndex % ENEMY_MARKER_OFFSETS.length];
            const { x, y } = this.junctionCenter(junction);
            this.drawEnemyMarker(x + offset.x, y + offset.y, color, label);
        });
    }

    // Waehrend der Ausfuehrungsphase zeigt jeder Marker die AKTUELLE Position
    // im laufenden Schritt, gelesen aus den bei "Los" live gewuerfelten
    // Pfaden (game-spec.md 4.3 Kernaenderung, Phase 7j) -- der weitere Weg AB
    // der in der Planungsphase bekannten Start-Kreuzung bleibt echte
    // Zufallsbewegung.
    private renderExecutingEnemyMarkers(): void {
        if (!this.engine) return;
        const paths = this.engine.getLastEnemyPaths();

        paths.forEach((path, enemyIndex) => {
            const color = getEnemyColor(enemyIndex);
            const label = getEnemyLabel(enemyIndex);
            const offset = ENEMY_MARKER_OFFSETS[enemyIndex % ENEMY_MARKER_OFFSETS.length];
            const stepIndex = Math.max(0, Math.min(this.executingStepIndex, path.length - 1));
            const { x, y } = this.junctionCenter(path[stepIndex]);
            this.drawEnemyMarker(x + offset.x, y + offset.y, color, label);
        });
    }

    private renderEnemyMarkers(): void {
        if (this.phase === 'planning') {
            this.renderPlanningEnemyMarkers();
        } else {
            this.renderExecutingEnemyMarkers();
        }
    }

    // --- Run-Steuerung + automaten-interne Upgrade-Achsen -------------------

    private renderRunControls(): void {
        const canExecute = !!this.engine && this.engine.getPlacedTraps().size > 0;
        this.makeButton(
            250,
            600,
            220,
            50,
            'Los!',
            () => {
                if (!canExecute) return;
                this.executeRun();
            },
            canExecute ? 0x27ae60 : 0x444444,
        );
    }

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
        this.renderUpgradeLadderShop(560, this.config.trapCountUpgrades, owned);
        this.renderUpgradeLadderShop(620, this.config.dynamiteCountUpgrades, owned);
        this.renderUpgradeLadderShop(680, this.config.enemyCountUpgrades, owned);
    }

    // --- Statustexte (persistente Objekte, nur Text wird aktualisiert) -----

    private updateStatusText(): void {
        if (!this.engine) {
            this.statusText.setText('');
            return;
        }
        const owned = this.getOwnedUpgradeIds();
        const trapCount = getTrapCount(this.config, owned);
        const dynamiteCount = getDynamiteCount(this.config, owned);
        const enemyCount = getEnemyCount(this.config, owned);
        const placedTraps = this.engine.getPlacedTraps().size;
        const blastedEdges = this.engine.getBlastedEdges().size;
        this.statusText.setText(
            `Fallen ${placedTraps}/${trapCount} platziert | Dynamit ${blastedEdges}/${dynamiteCount} gesprengt | Gegner: ${enemyCount}`,
        );
    }

    // Rein informative Anzeige, dieselbe Konvention wie GreedRunScene.ts.
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
            `Attendant: laeuft im Hintergrund (vereinfachte Schaetzung ohne Netzwerk-/Dynamit-Optimierung) – Musterkenntnis ${knowledgePct}%, ~${rate.machinePointsPerSecond.toFixed(2)} Automaten-Punkte/s, ~${rate.hallTicketsPerSecond.toFixed(2)} Tickets/s`,
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
        this.updateStatusText();

        this.renderNetwork();

        if (this.phase === 'planning') {
            this.renderRunControls();
            this.renderUpgradeShop();
        }
        // 'executing': bewusst keine interaktiven Elemente (kein Reflex-Input, game-spec.md 4.1)
    }

    // --- Run-Lebenszyklus ----------------------------------------------------

    private startNewRun(): void {
        const owned = this.getOwnedUpgradeIds();
        const trapCount = getTrapCount(this.config, owned);
        const dynamiteCount = getDynamiteCount(this.config, owned);
        const enemyCount = getEnemyCount(this.config, owned);
        this.engine = new TrapTunnelsEngine(this.config.run, trapCount, dynamiteCount, enemyCount, Math.random);
        this.phase = 'planning';
        this.executingStepIndex = -1;
        this.precomputedEvents = [];
        this.renderPhase();
    }

    private executeRun(): void {
        if (!this.engine || this.engine.getPlacedTraps().size === 0) return;
        this.phase = 'executing';
        this.feedback = '';
        this.milestonesReachedBeforeExecution = getReachedMilestones(
            this.config,
            economyStore.getMachinePeakScore(this.config.id).toNumber(),
        ).length;

        // "Los" sprengt (bereits waehrend der Planung uebernommene) Verbindungen
        // und wuerfelt danach die komplette Gegnerbewegung EINMALIG live aus
        // (game-spec.md 4.3 "Rundenstruktur", Phase 7j Kernaenderung) -- die
        // Animation liest pro Schritt nur noch aus precomputedEvents/
        // getLastEnemyPaths() ab, ohne erneut zu wuerfeln.
        this.precomputedEvents = this.engine.resolve();
        const paths = this.engine.getLastEnemyPaths();
        this.maxSteps = paths.length > 0 ? Math.max(...paths.map((path) => path.length)) : 0;

        // Musterkenntnis steigt primaer durch manuelles Spielen (game-spec.md
        // 3.2) -- die Anzahl platzierter Fallen ist bei diesem Automaten die
        // sinnvollste Entsprechung zu "Anzahl manueller Aktionen dieses Runs"
        // (es gibt keine einzelnen Spieler-Zuege wie bei Greed Run). Der
        // Attendant durchlaeuft diese Methode nicht (er laeuft als reine
        // Ertragsrate global in economy.ts::tickAttendants).
        let knowledge = economyStore.getAttendantKnowledge(this.config.id);
        for (let i = 0; i < this.engine.getPlacedTraps().size; i += 1) {
            knowledge = gainKnowledgeFromManualPlay(knowledge);
        }
        economyStore.setAttendantKnowledge(this.config.id, knowledge);

        this.renderPhase();
        this.runExecutionStep(0);
    }

    private runExecutionStep(step: number): void {
        if (!this.engine || step >= this.maxSteps) {
            this.finishExecution();
            return;
        }
        this.executingStepIndex = step;

        const eventsAtStep = this.precomputedEvents.filter((event) => event.step === step);
        if (eventsAtStep.length === 0) {
            this.feedback = `Schritt ${step + 1}: keine Falle ausgeloest.`;
        } else {
            const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
            const parts = eventsAtStep.map((event) => {
                const payout = drawTrapEventPayout(this.config.run, event, Math.random);
                economyStore.applyMachineScoreDelta(this.config.id, payout);
                const hallTicketsGained = Math.max(0, payout) * this.config.ticketYieldFactor * ticketYieldRate;
                if (hallTicketsGained > 0) {
                    economyStore.addHallTickets(hallTicketsGained);
                }
                const enemyLabels = event.enemyIndices.map((i) => getEnemyLabel(i)).join('+');
                const kind = event.isChain ? 'KETTENREAKTION' : 'Einzelfang';
                return `${kind} (${enemyLabels}) an Kreuzung ${event.junction}: +${payout.toFixed(1)} Punkte, +${hallTicketsGained.toFixed(2)} Tickets`;
            });
            this.feedback = `Schritt ${step + 1}: ${parts.join('; ')}.`;
        }

        this.renderPhase();
        this.time.delayedCall(STEP_DELAY_MS, () => this.runExecutionStep(step + 1));
    }

    // Rundenstruktur (game-spec.md 4.3, direkt mit der Phase-7h-Lektion
    // gebaut): der Run endet nach der Ausfuehrung IMMER unwiderruflich, es
    // gibt kein Fortfuehren/keine Checkbox -- direkt danach startet immer ein
    // neues Netz mit neuen Gegner-Startpunkten.
    private finishExecution(): void {
        if (!this.engine) return;

        const peak = economyStore.getMachinePeakScore(this.config.id).toNumber();
        const reachedNow = getReachedMilestones(this.config, peak).length;
        const isFinal = isFinalMilestoneReached(this.config, peak);
        const isFirstCompletion = isFinal && !economyStore.isMachineCompleted(this.config.id);

        if (isFirstCompletion) {
            economyStore.markMachineCompleted(this.config.id);
            persist();
        }

        if (reachedNow > this.milestonesReachedBeforeExecution) {
            this.feedback += isFinal ? ' Durchgespielt! Letzter Meilenstein erreicht.' : ' Meilenstein erreicht!';
        }
        this.feedback += ' Lauf beendet.';

        this.startNewRun();
    }
}
