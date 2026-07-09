import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { PatternEngine } from '../../engine/PatternEngine';
import { PushYourLuckRun } from '../../engine/PushYourLuckEngine';
import type { MachineAction, MachineConfig } from '../../engine/types';
import {
    getEntryPointMachine,
    getHardActions,
    getIntermediateActions,
    getMachineConfig,
    getVisibleMoveCount,
    resolveMachineAction,
} from '../../data/machines.config';
import {
    chooseAttendantAction,
    gainKnowledgeFromManualPlay,
    getAttendantLookahead,
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
// Rundenstruktur nach game-spec.md 4.1/4.1a (Phase 7b, Kernmechanik-
// Revision, siehe STATUS.md):
//   Planung (Aktionen queuen, gegen eine FESTE, vorab generierte
//   Zug-Sequenz) -> Ausfuehrung (automatisch/animiert) -> Ergebnis mit
//   Kausalitaets-Feedback -> Meilenstein-Entscheidung (Banking vs.
//   Weitermachen) -> Abschluss beim letzten Checkpoint.
//
// Die komplette Zug-Sequenz eines Laufs steht ab Run-Start fest (`sequence`,
// per PatternEngine.sampleNext() erzeugt und danach nie mehr veraendert --
// nur lazy um weitere Eintraege verlaengert, sobald sie gebraucht werden).
// PatternEngine/PushYourLuckEngine bleiben unveraendert und unabhaengig
// voneinander (Architektur-Kurzregel CLAUDE.md); die Verzahnung passiert
// ausschliesslich hier ueber machines.config.ts::resolveMachineAction().

type Phase = 'planning' | 'executing' | 'milestone' | 'completed';
type ViewChangedPayload = { view: 'machine' | 'hall' };

const MAX_QUEUE_LENGTH = 6;
const STEP_DELAY_MS = 700;
const STATE_COLORS = [0x2ecc71, 0xf1c40f, 0xe74c3c, 0x9b59b6, 0x3498db];

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
    // Die feste, vorab generierte Zug-Sequenz dieses Laufs (Phase 7b) --
    // einmal generierte Eintraege werden NIE veraendert, das Array waechst
    // nur lazy (ensureSequenceLength), sobald eine weitere Position
    // gebraucht wird (Vorschau oder Ausfuehrung).
    private sequence: string[] = [];
    // Position in `sequence`, die als naechstes ausgefuehrt wird -- ruekt
    // nach jeder abgeschlossenen Ausfuehrungsrunde um die Anzahl
    // ausgefuehrter Schritte vor.
    private sequenceCursor = 0;
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
            fontFamily: 'Arial', fontSize: 13, color: '#cccccc', align: 'left',
            wordWrap: { width: 220 },
        }).setOrigin(0.5, 0);

        this.feedbackText = this.add.text(512, 190, '', {
            fontFamily: 'Arial', fontSize: 17, color: '#ffffff', align: 'center',
            wordWrap: { width: 720 },
        }).setOrigin(0.5, 0);

        this.queueText = this.add.text(512, 270, '', {
            fontFamily: 'Arial', fontSize: 16, color: '#88ccff', align: 'center',
        }).setOrigin(0.5);

        this.attendantStatusText = this.add.text(20, 730, '', {
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
        this.queue = [];
        this.phase = 'planning';
        this.feedback = '';
    }

    // Verlaengert die feste Zug-Sequenz lazy, bis Position `length - 1`
    // existiert -- bereits generierte Eintraege werden NIE veraendert
    // (Phase 7b: "Fixes Pattern pro Run"). Der erste Eintrag wird als
    // Uebergang vom Referenz-Startzustand (pattern.states[0], Danger-Achse-
    // Konvention aus Phase 3) generiert, jeder weitere als Uebergang vom
    // jeweils vorherigen -- identisch zur alten Live-Sampling-Kette, nur
    // vorab und eingefroren statt live pro Ausfuehrungsschritt.
    private ensureSequenceLength(length: number): void {
        while (this.sequence.length < length) {
            const previous =
                this.sequence.length > 0 ? this.sequence[this.sequence.length - 1] : this.config.pattern.states[0];
            this.sequence.push(this.patternEngine.sampleNext(previous));
        }
    }

    private getUpgradeLevel(): number {
        return economyStore.getMachineUpgrades(this.config.id).length;
    }

    private getVisibleCount(): number {
        return getVisibleMoveCount(this.patternEngine.getVisibility(this.getUpgradeLevel()));
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
                fontFamily: 'Arial', fontSize: 13, color: '#ffffff', align: 'center',
                wordWrap: { width: width - 10 },
            })
            .setOrigin(0.5);
        bg.on('pointerdown', onClick);
        bg.on('pointerover', () => bg.setFillStyle(color, 0.8));
        bg.on('pointerout', () => bg.setFillStyle(color, 1));
        this.dynamicObjects.push(bg, text);
    }

    // Aktualisiert die Vorschau der festen Sequenz: der unmittelbar
    // naechste Zug ist IMMER sichtbar (getVisibleMoveCount liefert
    // mindestens 1), weitere Zuege je nach Sichtbarkeits-Fenster
    // (automaten-interne Upgrades, siehe machines.config.ts). Zeigt bis zu
    // MAX_QUEUE_LENGTH Positionen, unsichtbare als "??".
    private updateSequencePreview(): void {
        const visibleCount = this.getVisibleCount();
        this.ensureSequenceLength(this.sequenceCursor + Math.max(visibleCount, MAX_QUEUE_LENGTH));

        const nextState = this.sequence[this.sequenceCursor];
        const states = this.patternEngine.getStates();
        const colorIndex = states.indexOf(nextState);
        this.patternCircle.setFillStyle(STATE_COLORS[Math.max(0, colorIndex) % STATE_COLORS.length]);
        this.patternLabel.setText(`Naechster Zug:\n${nextState}`);

        const lines: string[] = [];
        for (let i = 0; i < MAX_QUEUE_LENGTH; i += 1) {
            lines.push(i < visibleCount ? this.sequence[this.sequenceCursor + i] : '??');
        }
        this.forecastText.setText(['Feste Sequenz (naechste Zuege):', lines.join(' -> ')].join('\n'));
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

    // Beschreibt eine Aktion fuer die Buttons in der Planungsphase. Bei
    // Zwischenstufen genuegt die feste, musterunabhaengige Fangchance. Bei
    // harten Aktionen wird zusaetzlich geprueft, ob die Position, an der die
    // Aktion (wenn jetzt gequeued) tatsaechlich ausgefuehrt wuerde, bereits
    // sichtbar ist -- wenn ja, wird konkret angezeigt, ob sie dort TRIFFT
    // oder SCHEITERT. Das macht die Vorschau zu einer echten strategischen
    // Entscheidung statt Deko (design-toolbox.md 1.10/1.11).
    private describeAction(action: MachineAction): string {
        if (action.kind === 'intermediate') {
            const pct = Math.round(action.failureChance * 100);
            return `Fangchance ${pct}% (musterunabhängig)`;
        }

        const position = this.sequenceCursor + this.queue.length;
        const visibleCount = this.getVisibleCount();
        const isVisible = position - this.sequenceCursor < visibleCount;
        if (!isVisible) {
            return `Scheitert nur bei "${action.counterState}" (Zug an dieser Position noch nicht sichtbar)`;
        }
        this.ensureSequenceLength(position + 1);
        const upcomingState = this.sequence[position];
        const willFail = upcomingState === action.counterState;
        return `Scheitert nur bei "${action.counterState}" – naechster Zug hier: "${upcomingState}" -> ${willFail ? 'SCHEITERT' : 'TRIFFT'}`;
    }

    private queueAction(action: MachineAction): void {
        if (this.queue.length >= MAX_QUEUE_LENGTH) return;
        this.queue.push(action);
        this.renderPhase();
    }

    private renderActionButtons(): void {
        const hardActions = getHardActions(this.config);
        const intermediateActions = getIntermediateActions(this.config);
        const canAdd = this.queue.length < MAX_QUEUE_LENGTH;

        const hardStartX = 512 - ((hardActions.length - 1) * 340) / 2;
        hardActions.forEach((action, index) => {
            const x = hardStartX + index * 340;
            const label = `${action.id}\nPayout ${action.payoutRange[0]}-${action.payoutRange[1]}\n${this.describeAction(action)}`;
            this.makeButton(x, 340, 320, 100, label, () => this.queueAction(action), canAdd ? 0x2c3e50 : 0x444444);
        });

        const interStartX = 512 - ((intermediateActions.length - 1) * 260) / 2;
        intermediateActions.forEach((action, index) => {
            const x = interStartX + index * 260;
            const label = `${action.id}\nPayout ${action.payoutRange[0]}-${action.payoutRange[1]}\n${this.describeAction(action)}`;
            this.makeButton(x, 450, 240, 80, label, () => this.queueAction(action), canAdd ? 0x34495e : 0x444444);
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

    // Kaufoberflaeche fuer automaten-interne Upgrades (Phase 7b) -- bezahlt
    // mit den EIGENEN Tickets dieses Automaten, NICHT mit Hallen-Credits.
    // Bewusst NICHT im hallenweiten UpgradePanel.tsx (das bleibt exklusiv
    // fuer Credits-Upgrades, siehe STATUS.md/CLAUDE.md).
    private renderInternalUpgradeShop(): void {
        const owned = economyStore.getMachineUpgrades(this.config.id);
        const available = this.config.upgrades.filter((upgrade) => !owned.includes(upgrade.id));
        if (available.length === 0) return;

        const tickets = economyStore.getTickets(this.config.id).toNumber();
        const startX = 512 - ((available.length - 1) * 260) / 2;
        available.forEach((upgrade, index) => {
            const x = startX + index * 260;
            const canAfford = tickets >= upgrade.cost;
            const label = `${upgrade.name}\n${upgrade.description}\nKosten: ${upgrade.cost} Tickets (${tickets.toFixed(1)} vorhanden)`;
            this.makeButton(
                x,
                630,
                240,
                100,
                label,
                () => {
                    if (economyStore.purchaseMachineUpgrade(this.config.id, upgrade.id, upgrade.cost)) {
                        persist();
                        this.renderPhase();
                    }
                },
                canAfford ? 0x8e44ad : 0x444444,
            );
        });
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
            // (game-spec.md 3.2) -- jede manuell aufgeloeste Aktion zaehlt,
            // unabhaengig von Erfolg/Fehlschlag.
            economyStore.setAttendantKnowledge(this.config.id, gainKnowledgeFromManualPlay(knowledge));
        }

        const result = this.run.resolveAction(executed);
        this.scoreText.setText(`Punkte: ${this.run.getScore().toFixed(1)}`);

        const prefix = isAttendant ? '[Attendant] ' : '';
        if (result.success) {
            this.feedback = `${prefix}Schritt ${index + 1}: Erfolg mit "${action.id}" bei Musterzustand "${state}" (+${result.payout.toFixed(1)} Punkte).`;
        } else {
            this.feedback = `${prefix}Schritt ${index + 1}: Fehlschlag mit "${action.id}" bei Musterzustand "${state}" (-${result.penalty.toFixed(1)} Punkte Teilstrafe, Punktestand jetzt ${result.scoreAfter.toFixed(1)}).`;
        }
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

    // Baut die Attendant-Queue fuer eine automatisierte Runde: pro Position
    // wird geprueft, ob der eigene Lookahead (Musterkenntnis-abhaengig,
    // siehe AttendantEngine.getAttendantLookahead) den an dieser Position
    // feststehenden Zustand bereits kennt -- wenn ja, waehlt
    // chooseAttendantAction garantiert eine dort nicht scheiternde harte
    // Aktion, sonst faellt sie auf eine Zwischenstufe zurueck.
    private buildAttendantQueue(): MachineAction[] {
        const knowledge = economyStore.getAttendantKnowledge(this.config.id);
        const lookahead = getAttendantLookahead(this.getVisibleCount(), knowledge);
        this.ensureSequenceLength(this.sequenceCursor + ATTENDANT_QUEUE_LENGTH);

        const hardActions = getHardActions(this.config);
        const intermediateActions = getIntermediateActions(this.config);

        return Array.from({ length: ATTENDANT_QUEUE_LENGTH }, (_, i) => {
            const knownState = i < lookahead ? this.sequence[this.sequenceCursor + i] : undefined;
            return chooseAttendantAction(hardActions, intermediateActions, knownState, knowledge);
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

    // Manuelle Rueckkehr zur Halle (Bugfix, siehe STATUS.md): bis hierhin gab
    // es KEINEN Weg zurueck ausser dem einmaligen automatischen Reveal des
    // entryPoint-Automaten (TransitionScene) -- ein zweiter Durchlauf
    // (Score-Attack) endete daher in einer Sackgasse, nur ein Seiten-Reload
    // half. Der Button emittiert dasselbe Signal wie der Reveal ('return-to-
    // hall' statt 'hall-reveal', App.tsx behandelt beide gleich), aendert
    // aber NICHT die laufende Phaser-Szene -- der Automat laeuft im
    // Hintergrund weiter (Phase 5), exakt wie beim Reveal-Uebergang.
    // Nur sichtbar, sobald die Halle ueberhaupt existiert (entryPoint bereits
    // durchgespielt), sonst wuerde game-spec.md Abschnitt 2 verletzt ("keine
    // sichtbare Meta-UI" vor dem Durchbruch).
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
