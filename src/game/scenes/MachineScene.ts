import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { PatternEngine } from '../../engine/PatternEngine';
import { PushYourLuckRun } from '../../engine/PushYourLuckEngine';
import type { MachineConfig, RiskTier } from '../../engine/types';
import { getEffectiveFailureChance, getMachineConfig } from '../../data/machines.config';
import { chooseAttendantTier, gainKnowledgeFromManualPlay, getAttendantTier } from '../../engine/AttendantEngine';
import { economyStore, persist } from '../economy';
import { getCurrentView } from '../viewState';

// EINE generische Szene fuer alle vier Automaten (CLAUDE.md Workflow-Regel).
// Liest ausschliesslich machines.config.ts; automatenspezifische Werte
// (Thema, Pattern, Payouts, Meilensteine) kommen nie hart kodiert vor.
// Nur Phaser-Graphics-Primitive als Platzhalter (kein Grafik-/Sound-Asset)
// bis einschliesslich Phase 8.
//
// Rundenstruktur exakt nach game-spec.md 4.1:
//   Planung (Risiko-Tokens queuen) -> Ausfuehrung (automatisch/animiert)
//   -> Ergebnis mit Kausalitaets-Feedback -> Meilenstein-Entscheidung
//   (Banking vs. Weitermachen) -> Abschluss beim letzten Checkpoint.
//
// PatternEngine (Musterzustand/Prognose) und PushYourLuckEngine (Erfolg/
// Fehlschlag/Score) bleiben unveraendert und unabhaengig voneinander
// (Architektur-Kurzregel CLAUDE.md). Die Verzahnung passiert ausschliesslich
// hier: getEffectiveFailureChance() (machines.config.ts) berechnet aus dem
// gesampelten Musterzustand + der Basis-RiskTier eine effektive
// failureChance, mit der resolveAction() aufgerufen wird -- die Prognose
// hat dadurch echten strategischen Wert statt nur Deko zu sein (siehe
// STATUS.md, aufgeloester Blocker "Phase 3 Spec-Abweichung").

type Phase = 'planning' | 'executing' | 'busted' | 'milestone' | 'completed';
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
    private patternState!: string;
    // Feste Sichtbarkeits-Stufe: Upgrades zum Aufdecken weiterer Prognose
    // werden erst als Hallen-Upgrade in Phase 7 kaufbar.
    private readonly upgradeLevel = 0;
    private phase: Phase = 'planning';
    private queue: RiskTier[] = [];
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
        }).setOrigin(0.5, 0);

        this.feedbackText = this.add.text(512, 190, '', {
            fontFamily: 'Arial', fontSize: 17, color: '#ffffff', align: 'center',
            wordWrap: { width: 720 },
        }).setOrigin(0.5, 0);

        this.queueText = this.add.text(512, 320, '', {
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
        this.patternState = this.config.pattern.states[0];
        this.queue = [];
        this.phase = 'planning';
        this.feedback = '';
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
                fontFamily: 'Arial', fontSize: 14, color: '#ffffff', align: 'center',
                wordWrap: { width: width - 10 },
            })
            .setOrigin(0.5);
        bg.on('pointerdown', onClick);
        bg.on('pointerover', () => bg.setFillStyle(color, 0.8));
        bg.on('pointerout', () => bg.setFillStyle(color, 1));
        this.dynamicObjects.push(bg, text);
    }

    private updatePatternDisplay(): void {
        const states = this.patternEngine.getStates();
        const colorIndex = states.indexOf(this.patternState);
        this.patternCircle.setFillStyle(STATE_COLORS[Math.max(0, colorIndex) % STATE_COLORS.length]);
        this.patternLabel.setText(`Muster:\n${this.patternState}`);

        const visible = this.patternEngine.getVisibleDistribution(this.patternState, this.upgradeLevel);
        const lines = visible.map((entry) =>
            entry.revealed ? `${entry.to}: ${Math.round(entry.probability * 100)}%` : `${entry.to}: ??`,
        );
        this.forecastText.setText(['Prognose (naechster Schritt):', ...lines].join('\n'));
    }

    private renderPhase(): void {
        this.clearDynamic();
        this.scoreText.setText(`Punkte: ${this.run.getScore().toFixed(1)}`);
        this.updatePatternDisplay();
        this.updateAttendantStatusText();
        this.feedbackText.setText(this.feedback);
        this.queueText.setText(
            this.queue.length > 0 ? `Plan: ${this.queue.map((tier) => tier.id).join(' -> ')}` : 'Plan: (leer)',
        );

        if (this.phase === 'planning') {
            this.renderTierButtons();
            this.renderPlanningControls();
        } else if (this.phase === 'milestone') {
            this.renderMilestoneControls();
        } else if (this.phase === 'busted') {
            this.renderBustedControls();
        } else if (this.phase === 'completed') {
            this.renderCompletedControls();
        }
        // 'executing': bewusst keine interaktiven Elemente (kein Reflex-Input, game-spec.md 4.1)
    }

    // Effektive, musterzustandsabhaengige Fangchance fuer den JETZT aktuellen
    // Musterzustand -- gilt garantiert nur fuer den naechsten ausgefuehrten
    // Schritt (das Muster kann sich waehrend der Ausfuehrung weiterbewegen,
    // siehe game-spec.md 4.2: nur der naechste Schritt ist vorhersagbar).
    private describeTier(tier: RiskTier): string {
        const effective = getEffectiveFailureChance(tier, this.patternEngine.getStates(), this.patternState);
        const effectivePct = Math.round(effective * 100);

        if (tier.failureChance <= 0) {
            return `Fangchance ${effectivePct}% (musterunabhängig)`;
        }
        const basePct = Math.round(tier.failureChance * 100);
        if (effectivePct === basePct) {
            return `Fangchance ${effectivePct}% (Basis, Muster "${this.patternState}" neutral)`;
        }
        return `Fangchance ${effectivePct}% (Basis ${basePct}%, Muster "${this.patternState}")`;
    }

    private renderTierButtons(): void {
        const tiers = this.config.riskTiers;
        const startX = 512 - ((tiers.length - 1) * 300) / 2;
        const canAdd = this.queue.length < MAX_QUEUE_LENGTH;

        tiers.forEach((tier, index) => {
            const x = startX + index * 300;
            const label = `${tier.id}\nPayout ${tier.payoutRange[0]}-${tier.payoutRange[1]}\n${this.describeTier(tier)}`;
            this.makeButton(
                x,
                420,
                280,
                90,
                label,
                () => {
                    if (this.queue.length >= MAX_QUEUE_LENGTH) return;
                    this.queue.push(tier);
                    this.renderPhase();
                },
                canAdd ? 0x2c3e50 : 0x444444,
            );
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
        if (index >= this.queue.length || this.run.getStatus() !== 'active') {
            this.finishExecution(isAttendant);
            return;
        }

        const tier = this.queue[index];
        // Muster zuerst einen Schritt weiterbewegen (das ist die "Position
        // der Patrouille" fuer diesen Schritt), DANACH die daraus folgende
        // effektive failureChance berechnen und erst damit resolveAction
        // aufrufen -- so wirkt der (teilweise vorhersagbare) Musterzustand
        // tatsaechlich auf das Ergebnis, statt nur im Feedback-Text zu
        // stehen (siehe STATUS.md, aufgeloester Blocker).
        this.patternState = this.patternEngine.sampleNext(this.patternState);
        const patternFailureChance = getEffectiveFailureChance(
            tier,
            this.patternEngine.getStates(),
            this.patternState,
        );

        let resolvedTier: RiskTier;
        if (isAttendant) {
            const knowledge = economyStore.getAttendantKnowledge(this.config.id);
            resolvedTier = getAttendantTier(tier, knowledge, patternFailureChance);
        } else {
            resolvedTier = { ...tier, failureChance: patternFailureChance };
            // Musterkenntnis steigt primaer durch manuelles Spielen
            // (game-spec.md 3.2) -- jede manuell aufgeloeste Aktion zaehlt,
            // unabhaengig von Erfolg/Fehlschlag.
            const knowledge = economyStore.getAttendantKnowledge(this.config.id);
            economyStore.setAttendantKnowledge(this.config.id, gainKnowledgeFromManualPlay(knowledge));
        }
        const result = this.run.resolveAction(resolvedTier);

        this.updatePatternDisplay();
        this.scoreText.setText(`Punkte: ${this.run.getScore().toFixed(1)}`);

        const prefix = isAttendant ? '[Attendant] ' : '';
        const effectivePct = Math.round(resolvedTier.failureChance * 100);
        if (result.success) {
            this.feedback = `${prefix}Schritt ${index + 1}: Erfolg mit "${tier.id}" (+${result.payout.toFixed(1)} Punkte, Fangchance war ${effectivePct}% bei Muster "${this.patternState}").`;
        } else {
            this.feedback = `${prefix}Schritt ${index + 1}: Fehlschlag bei "${tier.id}" (Fangchance ${effectivePct}% – Muster stand auf "${this.patternState}") – der Zug kam zu früh. Punktestand auf 0 zurückgesetzt.`;
        }
        this.feedbackText.setText(this.feedback);

        this.time.delayedCall(STEP_DELAY_MS, () => this.runQueueStep(index + 1, isAttendant));
    }

    private finishExecution(isAttendant: boolean): void {
        this.queue = [];

        if (this.run.getStatus() === 'busted') {
            this.phase = 'busted';
            if (isAttendant) {
                this.startNewRun();
            }
            this.renderPhase();
            return;
        }

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

    // Startet -- ausschliesslich waehrend der Spieler in der Halle ist
    // (attendantTicking) und der Attendant fuer diesen Automaten
    // freigeschaltet ist (game-spec.md 3.2: freischaltbar nach erstmaligem
    // Durchspielen) -- automatisiert eine neue Runde, oder loest eine vom
    // Spieler offen gelassene Meilenstein-/Bust-Entscheidung sicher auf,
    // damit der Automat nicht einfach haengen bleibt, waehrend niemand
    // zusieht.
    private tickAttendant(): void {
        if (!this.attendantTicking) return;
        if (!economyStore.isMachineCompleted(this.config.id)) return;
        if (this.phase === 'executing') return;

        if (this.phase === 'busted') {
            this.startNewRun();
            this.renderPhase();
            return;
        }
        if (this.phase === 'milestone' || this.phase === 'completed') {
            this.bankRun();
            return;
        }
        if (this.phase === 'planning' && this.queue.length === 0) {
            const knowledge = economyStore.getAttendantKnowledge(this.config.id);
            const chosenTier = chooseAttendantTier(this.config.riskTiers, knowledge);
            this.queue = Array.from({ length: ATTENDANT_QUEUE_LENGTH }, () => chosenTier);
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

    private renderBustedControls(): void {
        this.feedback = this.feedback || 'Lauf gescheitert – Punktestand verloren.';
        this.feedbackText.setText(this.feedback);

        this.makeButton(512, 460, 260, 70, 'Neuer Versuch', () => {
            this.startNewRun();
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
