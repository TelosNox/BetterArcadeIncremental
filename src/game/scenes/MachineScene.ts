import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { PatternEngine } from '../../engine/PatternEngine';
import { PushYourLuckRun } from '../../engine/PushYourLuckEngine';
import type { MachineAction, MachineConfig, MachineUpgradeDef } from '../../engine/types';
import {
    MAX_PRECISION,
    computeCandidateExclusionOrder,
    getEntryPointMachine,
    getExcludedCandidates,
    getMachineConfig,
    getMachineUpgradeCost,
    getPreviewDepth,
    getPreviewPrecision,
    resolveMachineAction,
} from '../../data/machines.config';
import {
    chooseAttendantAction,
    gainKnowledgeFromManualPlay,
    getAttendantLookahead,
    getAttendantPrecision,
    getAttendantResolvedAction,
} from '../../engine/AttendantEngine';
import { economyStore, persist } from '../economy';
import { getCurrentView } from '../viewState';

// EINE generische Szene fuer alle vier Automaten (CLAUDE.md Workflow-Regel).
// Liest ausschliesslich machines.config.ts; automatenspezifische Werte
// (Thema, Pattern, Payouts, Meilensteine, Aktionen) kommen nie hart kodiert
// vor. Nur Phaser-Graphics-Primitive als Platzhalter (kein Grafik-/
// Sound-Asset) bis einschliesslich Phase 8.
//
// Rundenstruktur nach game-spec.md 4.1/4.1b (Phase 7c, Kernmechanik-
// Revision v2, siehe STATUS.md):
//   Planung (5 zyklische Aktionen queuen, gegen eine FESTE, vorab
//   generierte Zug-Sequenz mit Zwei-Achsen-Vorschau) -> Ausfuehrung
//   (automatisch/animiert) -> Ergebnis mit Kausalitaets-Feedback ->
//   Meilenstein-Entscheidung (Banking vs. Weitermachen) -> Abschluss beim
//   letzten Checkpoint.
//
// Die komplette Zug-Sequenz eines Laufs steht ab Run-Start fest (`sequence`,
// per PatternEngine.sampleNext()-Kette erzeugt und danach nie mehr
// veraendert -- nur lazy um weitere Eintraege verlaengert). Ebenso werden
// die pro Position ausgeschlossenen Kandidaten (Zwei-Achsen-Vorschau,
// `exclusionOrders`) EINMAL pro Position ermittelt und bleiben fuer den
// gesamten Lauf stabil (machines.config.ts::computeCandidateExclusionOrder).
// PatternEngine/PushYourLuckEngine bleiben unveraendert und unabhaengig
// voneinander (Architektur-Kurzregel CLAUDE.md); die Verzahnung passiert
// ausschliesslich hier ueber machines.config.ts::resolveMachineAction().

type Phase = 'planning' | 'executing' | 'milestone' | 'completed';
type ViewChangedPayload = { view: 'machine' | 'hall' };

const MAX_QUEUE_LENGTH = 6;
const STEP_DELAY_MS = 700;
const STATE_COLORS = [0x2ecc71, 0xf1c40f, 0xe74c3c, 0x9b59b6, 0x3498db];
const UNKNOWN_COLOR = 0x666666;

// Attendant-Automatisierung (Phase 5, game-spec.md 3.2): laeuft nur, waehrend
// der Spieler in der Halle ist (view === 'hall', siehe App.tsx), niemals
// waehrend er selbst am Automaten steht -- aktives Spielen bleibt so immer
// die bewusste Wahl des Spielers, nicht etwas, das er "wegklicken" muss.
const ATTENDANT_QUEUE_LENGTH = 3;
const ATTENDANT_TICK_INTERVAL_MS = 1000;

export class MachineScene extends Scene {
    private config!: MachineConfig;
    private patternEngine!: PatternEngine;
    private run!: PushYourLuckRun;
    // Die feste, vorab generierte Zug-Sequenz dieses Laufs -- einmal
    // generierte Eintraege werden NIE veraendert, das Array waechst nur lazy
    // (ensureSequenceLength), sobald eine weitere Position gebraucht wird
    // (Vorschau oder Ausfuehrung).
    private sequence: string[] = [];
    // Position in `sequence`, die als naechstes ausgefuehrt wird -- ruekt
    // nach jeder abgeschlossenen Ausfuehrungsrunde um die Anzahl
    // ausgefuehrter Schritte vor.
    private sequenceCursor = 0;
    // Zwei-Achsen-Vorschau (Phase 7c): pro Position die STABILE, einmal
    // gewuerfelte Reihenfolge der auszuschliessenden Kandidaten (siehe
    // machines.config.ts::computeCandidateExclusionOrder). Wird bei jedem
    // neuen Lauf verworfen (Positionen sind sonst nicht mehr gueltig, da
    // `sequence` neu generiert wird).
    private exclusionOrders = new Map<number, string[]>();
    private phase: Phase = 'planning';
    private queue: MachineAction[] = [];
    private feedback = '';
    // true nur, waehrend der Spieler in der Halle ist (App.tsx emittiert
    // 'view-changed'), siehe tickAttendant().
    private attendantTicking = false;

    private scoreText!: Phaser.GameObjects.Text;
    private feedbackText!: Phaser.GameObjects.Text;
    private patternCircle!: Phaser.GameObjects.Arc;
    private patternLabel!: Phaser.GameObjects.Text;
    private forecastText!: Phaser.GameObjects.Text;
    private queueText!: Phaser.GameObjects.Text;
    private attendantStatusText!: Phaser.GameObjects.Text;
    private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super('Machine');
    }

    init(data: { machineId: string }): void {
        const config = getMachineConfig(data.machineId);
        if (!config) {
            throw new Error(`MachineScene: unbekannte machineId "${data.machineId}"`);
        }
        this.config = config;
        this.patternEngine = new PatternEngine(config.pattern);
        this.startNewRun();
    }

    create(): void {
        economyStore.unlockMachine(this.config.id);

        this.cameras.main.setBackgroundColor(0x101018);

        this.add.text(512, 40, this.config.name, {
            fontFamily: 'Arial Black', fontSize: 32, color: '#ffffff',
        }).setOrigin(0.5);

        // Einziger sichtbarer Zaehler in Layer 0 (game-spec.md Abschnitt 2):
        // der In-Run-Punktestand, keine Tickets/Credits-Anzeige.
        this.scoreText = this.add.text(512, 88, '', {
            fontFamily: 'Arial', fontSize: 22, color: '#ffe066',
        }).setOrigin(0.5);

        this.patternLabel = this.add.text(900, 55, '', {
            fontFamily: 'Arial', fontSize: 15, color: '#ffffff', align: 'center',
        }).setOrigin(0.5);
        this.patternCircle = this.add.circle(900, 95, 18, STATE_COLORS[0]);

        this.forecastText = this.add.text(900, 130, '', {
            fontFamily: 'Arial', fontSize: 12, color: '#cccccc', align: 'left',
            wordWrap: { width: 230 },
        }).setOrigin(0.5, 0);

        this.feedbackText = this.add.text(512, 190, '', {
            fontFamily: 'Arial', fontSize: 17, color: '#ffffff', align: 'center',
            wordWrap: { width: 720 },
        }).setOrigin(0.5, 0);

        this.queueText = this.add.text(512, 270, '', {
            fontFamily: 'Arial', fontSize: 16, color: '#88ccff', align: 'center',
        }).setOrigin(0.5);

        this.attendantStatusText = this.add.text(20, 745, '', {
            fontFamily: 'Arial', fontSize: 13, color: '#999999',
        });

        EventBus.emit('current-scene-ready', this);

        // Bruecke React (HallHub) -> Phaser: die Halle laesst den Spieler
        // einen Automaten anwaehlen, ohne dass React die Phaser-Szenen-API
        // direkt kennen muss (EventBus als einzige Bruecke, keine neue
        // globale State-Loesung parallel zu EconomyStore). Bewusst HIER
        // registriert (auf der eigenen, aktiven ScenePlugin-Instanz) statt
        // global in main.ts ueber game.scene.start() -- letzteres crasht
        // Phasers SceneManager, wenn es von ausserhalb des Update-Loops
        // (ein React-Klick-Handler) auf eine bereits laufende Szene
        // angewendet wird. Listener wird beim Szenenwechsel wieder entfernt,
        // damit sich beim naechsten create() kein zweiter aufbaut.
        const handleRequestMachine = ({ machineId }: { machineId: string }) => {
            this.scene.start('Machine', { machineId });
        };
        EventBus.on('request-machine', handleRequestMachine);
        this.events.once('shutdown', () => EventBus.off('request-machine', handleRequestMachine));

        // Attendant-Automatisierung (Phase 5): Initialwert synchron aus
        // viewState.ts lesen (race-frei, siehe dortiger Kommentar -- ein rein
        // event-basierter Ansatz kann das erste 'view-changed' verpassen,
        // falls React frueher emittiert als Phaser diese Szene erzeugt).
        // App.tsx emittiert 'view-changed' bei jedem weiteren Wechsel
        // zwischen Automat-Ansicht und Halle. Nur waehrend 'hall' laeuft der
        // Automat automatisiert weiter (implementation-plan.md Phase-5-
        // Abnahme).
        this.attendantTicking = getCurrentView() === 'hall';
        const handleViewChanged = ({ view }: ViewChangedPayload) => {
            this.attendantTicking = view === 'hall';
            this.updateAttendantStatusText();
            if (this.attendantTicking) {
                this.tickAttendant();
            }
        };
        EventBus.on('view-changed', handleViewChanged);
        this.events.once('shutdown', () => EventBus.off('view-changed', handleViewChanged));

        this.time.addEvent({ delay: ATTENDANT_TICK_INTERVAL_MS, loop: true, callback: () => this.tickAttendant() });

        this.renderPhase();
    }

    private startNewRun(): void {
        this.run = new PushYourLuckRun(this.config.milestones);
        this.sequence = [];
        this.sequenceCursor = 0;
        this.exclusionOrders = new Map();
        this.queue = [];
        this.phase = 'planning';
        this.feedback = '';
    }

    // Verlaengert die feste Zug-Sequenz lazy, bis Position `length - 1`
    // existiert -- bereits generierte Eintraege werden NIE veraendert
    // ("Fixes Pattern pro Run"). Der erste Eintrag wird als Uebergang vom
    // Referenz-Startzustand (pattern.states[0]) generiert, jeder weitere als
    // Uebergang vom jeweils vorherigen.
    private ensureSequenceLength(length: number): void {
        while (this.sequence.length < length) {
            const previous =
                this.sequence.length > 0 ? this.sequence[this.sequence.length - 1] : this.config.pattern.states[0];
            this.sequence.push(this.patternEngine.sampleNext(previous));
        }
    }

    // Ermittelt (falls noch nicht geschehen) die stabile Kandidaten-
    // Ausschluss-Reihenfolge fuer eine Position und cached sie -- wird
    // garantiert nur EINMAL pro Position gewuerfelt (Baukasten 1.11, siehe
    // machines.config.ts::computeCandidateExclusionOrder).
    private ensureExclusionOrder(position: number): void {
        if (this.exclusionOrders.has(position)) return;
        this.ensureSequenceLength(position + 1);
        const trueState = this.sequence[position];
        const order = computeCandidateExclusionOrder(this.patternEngine.getStates(), trueState);
        this.exclusionOrders.set(position, order);
    }

    // Die an einer Position bei gegebener Praezision noch moeglichen
    // Pattern-Zustaende (Zwei-Achsen-Vorschau) -- Laenge 1, wenn die
    // Praezision ausreicht, um den Zustand eindeutig zu bestimmen.
    private getRemainingCandidates(position: number, precision: number): string[] {
        this.ensureExclusionOrder(position);
        const excluded = getExcludedCandidates(this.exclusionOrders.get(position)!, precision);
        return this.patternEngine.getStates().filter((state) => !excluded.includes(state));
    }

    private getOwnedUpgradeIds(): readonly string[] {
        return economyStore.getMachineUpgrades(this.config.id);
    }

    private getPreviewDepthLevel(): number {
        return getPreviewDepth(this.config, this.getOwnedUpgradeIds());
    }

    private getPreviewPrecisionLevel(): number {
        return getPreviewPrecision(this.config, this.getOwnedUpgradeIds());
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

    // Beschreibt eine einzelne Vorschau-Position (Zwei-Achsen-Vorschau,
    // Phase 7c): ausserhalb der Sichtweite (Tiefe d) komplett unbekannt,
    // sonst die bei aktueller Praezision (p) noch moeglichen Kandidaten,
    // durchgestrichen/ausgeschlossen explizit benannt (design-toolbox.md
    // 1.10/1.11: aufgedeckt wird die eingeschraenkte Kandidatenmenge, nie
    // "einfach so" der exakte Zustand, ausser p reicht bis zur Eindeutigkeit).
    private describePreviewPosition(offset: number): string {
        const depthLevel = this.getPreviewDepthLevel();
        if (offset >= depthLevel) {
            return `Position ${offset + 1}: ?? (ausserhalb der Sichtweite)`;
        }
        const position = this.sequenceCursor + offset;
        const precisionLevel = this.getPreviewPrecisionLevel();
        const remaining = this.getRemainingCandidates(position, precisionLevel);
        if (remaining.length === 1) {
            return `Position ${offset + 1}: "${remaining[0]}" (Zustand bekannt)`;
        }
        const excluded = this.patternEngine.getStates().filter((state) => !remaining.includes(state));
        return `Position ${offset + 1}: moeglich [${remaining.join(', ')}] (ausgeschlossen: ${excluded.join(', ')})`;
    }

    // Aktualisiert die Zwei-Achsen-Vorschau: die grosse Anzeige oben rechts
    // zeigt Position 0 (bekannt, sobald Praezision ausreicht), die Liste
    // darunter bis zu MAX_QUEUE_LENGTH Positionen im selben Format wie
    // describePreviewPosition.
    private updateSequencePreview(): void {
        const depthLevel = this.getPreviewDepthLevel();
        const precisionLevel = this.getPreviewPrecisionLevel();
        this.ensureSequenceLength(this.sequenceCursor + Math.max(depthLevel, MAX_QUEUE_LENGTH));

        const states = this.patternEngine.getStates();
        const nextRemaining = this.getRemainingCandidates(this.sequenceCursor, precisionLevel);
        if (nextRemaining.length === 1) {
            const colorIndex = states.indexOf(nextRemaining[0]);
            this.patternCircle.setFillStyle(STATE_COLORS[Math.max(0, colorIndex) % STATE_COLORS.length]);
            this.patternLabel.setText(`Naechster Zug:\n${nextRemaining[0]}`);
        } else {
            this.patternCircle.setFillStyle(UNKNOWN_COLOR);
            this.patternLabel.setText(`Naechster Zug:\n${nextRemaining.length} moeglich`);
        }

        const lines: string[] = [`Vorschau (Tiefe ${depthLevel}, Praezision ${precisionLevel}/${MAX_PRECISION}):`];
        for (let i = 0; i < MAX_QUEUE_LENGTH; i += 1) {
            lines.push(this.describePreviewPosition(i));
        }
        this.forecastText.setText(lines.join('\n'));
    }

    private renderPhase(): void {
        this.clearDynamic();
        this.scoreText.setText(`Punkte: ${this.run.getScore().toFixed(1)}`);
        this.updateSequencePreview();
        this.updateAttendantStatusText();
        this.renderBackToHallButton();
        this.feedbackText.setText(this.feedback);
        this.queueText.setText(
            this.queue.length > 0 ? `Plan: ${this.queue.map((action) => action.id).join(' -> ')}` : 'Plan: (leer)',
        );

        if (this.phase === 'planning') {
            this.renderActionButtons();
            this.renderPlanningControls();
            this.renderInternalUpgradeShop();
        } else if (this.phase === 'milestone') {
            this.renderMilestoneControls();
        } else if (this.phase === 'completed') {
            this.renderCompletedControls();
        }
        // 'executing': bewusst keine interaktiven Elemente (kein Reflex-Input, game-spec.md 4.1)
    }

    // Beschreibt eine Aktion fuer ihren Button in der Planungsphase (Phase
    // 7c, zyklisches Modell): zeigt, ob die Position, an der die Aktion (wenn
    // jetzt gequeued) tatsaechlich ausgefuehrt wuerde, den Grossen Gewinn
    // oder Verlust dieser Aktion aus der Vorschau bereits ausschliessen oder
    // bestaetigen kann. Macht die Vorschau zu einer echten strategischen
    // Entscheidung statt Deko (design-toolbox.md 1.10/1.11).
    private describeAction(action: MachineAction): string {
        const offset = this.queue.length;
        const depthLevel = this.getPreviewDepthLevel();
        if (offset >= depthLevel) {
            return `Gewinn bei "${action.counterState}" / Verlust bei "${action.losesToState}" (Position noch nicht sichtbar)`;
        }

        const position = this.sequenceCursor + offset;
        const precisionLevel = this.getPreviewPrecisionLevel();
        const remaining = this.getRemainingCandidates(position, precisionLevel);

        if (remaining.length === 1) {
            const trueState = remaining[0];
            if (trueState === action.counterState) return `GROSSER GEWINN sicher (Zustand "${trueState}")`;
            if (trueState === action.losesToState) return `VERLUST sicher (Zustand "${trueState}")`;
            return `Treffer sicher (Zustand "${trueState}")`;
        }

        const winPossible = remaining.includes(action.counterState);
        const lossPossible = remaining.includes(action.losesToState);
        if (!lossPossible && winPossible) return 'Verlust ausgeschlossen, Gewinn möglich';
        if (!lossPossible) return 'Verlust ausgeschlossen';
        if (!winPossible) return 'Gewinn ausgeschlossen, Verlust möglich';
        return 'Gewinn und Verlust beide noch möglich';
    }

    private queueAction(action: MachineAction): void {
        if (this.queue.length >= MAX_QUEUE_LENGTH) return;
        this.queue.push(action);
        this.renderPhase();
    }

    private renderActionButtons(): void {
        const actions = this.config.actions;
        const canAdd = this.queue.length < MAX_QUEUE_LENGTH;
        const spacing = 185;
        const startX = 512 - ((actions.length - 1) * spacing) / 2;

        actions.forEach((action, index) => {
            const x = startX + index * spacing;
            const label = [
                action.id,
                `Gross ${action.payoutBig[0]}-${action.payoutBig[1]} | Einfach ${action.payoutSimple[0]}-${action.payoutSimple[1]} | Verlust ${action.payoutLoss[0]}-${action.payoutLoss[1]}`,
                this.describeAction(action),
            ].join('\n');
            this.makeButton(x, 350, 175, 140, label, () => this.queueAction(action), canAdd ? 0x2c3e50 : 0x444444);
        });
    }

    private renderPlanningControls(): void {
        this.makeButton(512 - 160, 540, 220, 60, 'Letzten entfernen', () => {
            this.queue.pop();
            this.renderPhase();
        }, 0x555555);

        const canExecute = this.queue.length > 0;
        this.makeButton(
            512 + 160,
            540,
            220,
            60,
            'Los!',
            () => {
                if (this.queue.length === 0) return;
                this.executeQueue();
            },
            canExecute ? 0x27ae60 : 0x444444,
        );
    }

    // Kaufoberflaeche fuer EINE der beiden automaten-internen Vorschau-
    // Leitern (Tiefe ODER Praezision, Phase 7c) -- zeigt die naechste noch
    // nicht gekaufte Stufe mit ihrem aktuellen, kreuz-preis-abhaengigen Preis
    // (siehe machines.config.ts::getMachineUpgradeCost). Bezahlt mit den
    // EIGENEN Tickets dieses Automaten, NICHT mit Hallen-Credits. Bewusst
    // NICHT im hallenweiten UpgradePanel.tsx (das bleibt exklusiv fuer
    // Credits-Upgrades, siehe STATUS.md/CLAUDE.md).
    private renderUpgradeLadderShop(y: number, ladder: readonly MachineUpgradeDef[], owned: readonly string[]): void {
        const nextUpgrade = ladder.find((upgrade) => !owned.includes(upgrade.id));
        if (!nextUpgrade) return;

        const cost = getMachineUpgradeCost(this.config, nextUpgrade, owned);
        const tickets = economyStore.getTickets(this.config.id).toNumber();
        const canAfford = tickets >= cost;
        const label = `${nextUpgrade.name}\n${nextUpgrade.description}\nKosten: ${cost.toFixed(1)} Tickets (${tickets.toFixed(1)} vorhanden)`;
        this.makeButton(
            512,
            y,
            460,
            80,
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

    private renderInternalUpgradeShop(): void {
        const owned = this.getOwnedUpgradeIds();
        this.renderUpgradeLadderShop(605, this.config.depthUpgrades, owned);
        this.renderUpgradeLadderShop(690, this.config.precisionUpgrades, owned);
    }

    private executeQueue(): void {
        this.phase = 'executing';
        this.feedback = '';
        this.renderPhase();
        this.runQueueStep(0, false);
    }

    private executeAttendantQueue(): void {
        this.phase = 'executing';
        this.feedback = '';
        this.renderPhase();
        this.runQueueStep(0, true);
    }

    private runQueueStep(index: number, isAttendant: boolean): void {
        if (index >= this.queue.length) {
            this.finishExecution(isAttendant);
            return;
        }

        const action = this.queue[index];
        const position = this.sequenceCursor + index;
        this.ensureSequenceLength(position + 1);
        const state = this.sequence[position];

        const resolved = resolveMachineAction(action, state);
        const knowledge = economyStore.getAttendantKnowledge(this.config.id);
        const executed = isAttendant ? getAttendantResolvedAction(resolved, knowledge) : resolved;
        if (!isAttendant) {
            // Musterkenntnis steigt primaer durch manuelles Spielen
            // (game-spec.md 3.2) -- jede manuell aufgeloeste Aktion zaehlt.
            economyStore.setAttendantKnowledge(this.config.id, gainKnowledgeFromManualPlay(knowledge));
        }

        const result = this.run.resolveAction(executed);
        this.scoreText.setText(`Punkte: ${this.run.getScore().toFixed(1)}`);

        const outcome =
            state === action.counterState ? 'GROSSER GEWINN' : state === action.losesToState ? 'VERLUST' : 'Treffer';
        const prefix = isAttendant ? '[Attendant] ' : '';
        const sign = result.payout >= 0 ? '+' : '';
        this.feedback = `${prefix}Schritt ${index + 1}: ${outcome} mit "${action.id}" bei Musterzustand "${state}" (${sign}${result.payout.toFixed(1)} Punkte, Punktestand jetzt ${result.scoreAfter.toFixed(1)}).`;
        this.feedbackText.setText(this.feedback);

        this.time.delayedCall(STEP_DELAY_MS, () => this.runQueueStep(index + 1, isAttendant));
    }

    private finishExecution(isAttendant: boolean): void {
        const executedSteps = this.queue.length;
        this.queue = [];
        this.sequenceCursor += executedSteps;

        const isFinal = this.run.getReachedMilestones().length >= this.config.milestones.length;
        const isFirstCompletion = isFinal && !economyStore.isMachineCompleted(this.config.id);
        if (isFirstCompletion) {
            economyStore.markMachineCompleted(this.config.id);
            persist();

            if (this.config.entryPoint) {
                // Durchbruch-Moment (game-spec.md Abschnitt 2): das erstmalige
                // Durchspielen des Layer-0-Automaten IST der Durchbruch (PM-
                // Design-Entscheidung, siehe STATUS.md). Baukasten 1.8: dieser
                // grosse Ueberraschungseffekt wird NUR hier ausgeloest, nicht
                // fuer Automat 2-4 (die sind nie entryPoint). Lauf wird
                // automatisch gesichert, da der Spieler ab hier die Kontrolle
                // an die Reveal-Sequenz abgibt statt selbst zu entscheiden.
                if (this.run.canBank()) {
                    const banked = this.run.bank();
                    economyStore.addTickets(this.config.id, banked);
                    persist();
                }
                this.scene.start('Transition', { machineId: this.config.id });
                return;
            }
        }

        if (this.run.canBank()) {
            this.phase = isFinal ? 'completed' : 'milestone';
            if (isAttendant) {
                // Attendant trifft Meilenstein-Entscheidungen unbeaufsichtigt
                // immer sicher: Sichern statt weiter zu riskieren (der
                // Spieler ist ja gerade nicht am Automaten).
                this.bankRun();
                return;
            }
            this.renderPhase();
            return;
        }

        this.phase = 'planning';
        this.renderPhase();
    }

    // Baut die Attendant-Queue fuer eine automatisierte Runde (Phase 7c):
    // pro Position wird geprueft, ob der eigene Lookahead (Musterkenntnis-
    // abhaengig, AttendantEngine.getAttendantLookahead) diese Position
    // ueberhaupt erreicht -- wenn ja, wird die bei der eigenen (ebenfalls
    // Musterkenntnis-abhaengigen) Praezision noch moegliche Kandidatenmenge
    // ermittelt und chooseAttendantAction waehlt darauf basierend.
    private buildAttendantQueue(): MachineAction[] {
        const knowledge = economyStore.getAttendantKnowledge(this.config.id);
        const depthLevel = this.getPreviewDepthLevel();
        const precisionLevel = this.getPreviewPrecisionLevel();
        const attendantLookahead = getAttendantLookahead(depthLevel, knowledge);
        const attendantPrecision = getAttendantPrecision(precisionLevel, knowledge);
        this.ensureSequenceLength(this.sequenceCursor + ATTENDANT_QUEUE_LENGTH);

        return Array.from({ length: ATTENDANT_QUEUE_LENGTH }, (_, i) => {
            if (i >= attendantLookahead) {
                return chooseAttendantAction(this.config.actions, undefined);
            }
            const position = this.sequenceCursor + i;
            const remaining = this.getRemainingCandidates(position, attendantPrecision);
            return chooseAttendantAction(this.config.actions, remaining);
        });
    }

    // Startet -- ausschliesslich waehrend der Spieler in der Halle ist
    // (attendantTicking) und der Attendant fuer diesen Automaten
    // freigeschaltet ist (game-spec.md 3.2: freischaltbar nach erstmaligem
    // Durchspielen) -- automatisiert eine neue Runde, oder loest eine vom
    // Spieler offen gelassene Meilenstein-Entscheidung sicher auf, damit der
    // Automat nicht einfach haengen bleibt, waehrend niemand zusieht.
    private tickAttendant(): void {
        if (!this.attendantTicking) return;
        if (!economyStore.isMachineCompleted(this.config.id)) return;
        if (this.phase === 'executing') return;

        if (this.phase === 'milestone' || this.phase === 'completed') {
            this.bankRun();
            return;
        }
        if (this.phase === 'planning' && this.queue.length === 0) {
            this.queue = this.buildAttendantQueue();
            this.executeAttendantQueue();
        }
    }

    private updateAttendantStatusText(): void {
        if (!economyStore.isMachineCompleted(this.config.id)) {
            this.attendantStatusText.setText('Attendant: noch nicht freigeschaltet (erst durchspielen)');
            return;
        }
        const knowledgePct = Math.round(economyStore.getAttendantKnowledge(this.config.id) * 100);
        const status = this.attendantTicking ? 'aktiv (Spieler in der Halle)' : 'pausiert (Spieler am Automaten)';
        this.attendantStatusText.setText(`Attendant: ${status} – Musterkenntnis ${knowledgePct}%`);
    }

    // Manuelle Rueckkehr zur Halle: emittiert dasselbe Signal wie der Reveal
    // ('return-to-hall' statt 'hall-reveal', App.tsx behandelt beide
    // gleich), aendert aber NICHT die laufende Phaser-Szene -- der Automat
    // laeuft im Hintergrund weiter (Phase 5), exakt wie beim
    // Reveal-Uebergang. Nur sichtbar, sobald die Halle ueberhaupt existiert
    // (entryPoint bereits durchgespielt), sonst wuerde game-spec.md
    // Abschnitt 2 verletzt ("keine sichtbare Meta-UI" vor dem Durchbruch).
    private renderBackToHallButton(): void {
        if (!economyStore.isMachineCompleted(getEntryPointMachine().id)) return;
        this.makeButton(100, 24, 160, 40, 'Zur Halle', () => EventBus.emit('return-to-hall'), 0x34495e);
    }

    private bankRun(): void {
        const banked = this.run.bank();
        economyStore.addTickets(this.config.id, banked);
        persist();
        this.feedback = `Gebankt: ${banked.toFixed(1)} Punkte gesichert.`;
        this.startNewRun();
        this.renderPhase();
    }

    private renderMilestoneControls(): void {
        this.feedback = `Meilenstein erreicht! Aktueller Punktestand: ${this.run.getScore().toFixed(1)}.`;
        this.feedbackText.setText(this.feedback);

        this.makeButton(512 - 160, 460, 260, 70, 'Sichern (Banking)', () => this.bankRun(), 0x27ae60);
        this.makeButton(512 + 160, 460, 260, 70, 'Weitermachen', () => {
            this.phase = 'planning';
            this.renderPhase();
        }, 0xc0392b);
    }

    private renderCompletedControls(): void {
        this.feedback = `Durchgespielt! Letzter Checkpoint erreicht (Punktestand ${this.run.getScore().toFixed(1)}).`;
        this.feedbackText.setText(this.feedback);

        this.makeButton(512 - 160, 460, 260, 70, 'Sichern & beenden', () => this.bankRun(), 0x27ae60);
        this.makeButton(512 + 160, 460, 260, 70, 'Score-Attack fortsetzen', () => {
            this.phase = 'planning';
            this.renderPhase();
        }, 0xc0392b);
    }
}
