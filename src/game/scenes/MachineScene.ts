import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { PatternEngine } from '../../engine/PatternEngine';
import { drawPayout } from '../../engine/PushYourLuckEngine';
import type { MachineAction, MachineConfig, MachineUpgradeDef } from '../../engine/types';
import {
    MAX_PRECISION,
    N_STATES,
    UNKNOWN_COLOR,
    computeCandidateExclusionOrder,
    getEntryPointMachine,
    getExcludedCandidates,
    getMachineAttendantRate,
    getMachineConfig,
    getMachineUpgradeCost,
    getPreviewDepth,
    getPreviewPrecision,
    getReachedMilestones,
    getStateColor,
    isFinalMilestoneReached,
    resolveMachineAction,
} from '../../data/machines.config';
import { gainKnowledgeFromManualPlay } from '../../engine/AttendantEngine';
import { getTicketYieldRate } from '../../data/hall.config';
import { economyStore, persist } from '../economy';

// EINE generische Szene fuer alle vier Automaten (CLAUDE.md Workflow-Regel).
// Liest ausschliesslich machines.config.ts; automatenspezifische Werte
// (Thema, Pattern, Payouts, Meilensteine, Aktionen) kommen nie hart kodiert
// vor. Nur Phaser-Graphics-Primitive als Platzhalter (kein Grafik-/
// Sound-Asset) bis einschliesslich Phase 8.
//
// Rundenstruktur nach game-spec.md 4.1/4.1b/4.1c:
//   Planung (5 zyklische Aktionen im Fuenfeck queuen, gegen eine FESTE,
//   vorab generierte Zug-Sequenz mit farbcodierter Zwei-Achsen-Vorschau) ->
//   Ausfuehrung (automatisch/animiert) -> Ergebnis mit Kausalitaets-Feedback.
//
// Phase 7e (Erkennbarkeit + Banking-Streichung, siehe STATUS.md/game-spec.md
// 4.1c): KEIN Banking/Meilenstein-Entscheidungsbildschirm mehr -- jede
// aufgeloeste Aktion verbucht sich sofort und dauerhaft direkt im
// EconomyStore (economyStore.applyMachineScoreDelta). Meilenstein-Fortschritt
// wird nur noch als dezente Pip-Reihe angezeigt (peakScore-basiert, sticky).
// Die 5 Aktions-Buttons stehen im Fuenfeck (Kreisanordnung, Nachbarschaft =
// Konter-Beziehung), Zustand/Aktion an Position i teilen sich eine feste,
// farbenblind-sichere Farbe (STATE_COLORS) PLUS eine Positionsnummer
// (CLAUDE.md "UI-Grundsatz: Barrierefreiheit bei Farbcodierung" -- Farbe ist
// nie alleiniges Unterscheidungsmerkmal). Die Konter-Reihenfolge selbst zeigt
// eine statische, nie neu gezeichnete Referenz-Grafik (Fuenfeck mit Pfeilen);
// die Aktions-Buttons selbst zeigen bewusst KEINE live berechnete Auflösung
// gegen den aktuell bekannten Zustand mehr (nur Name, Farbe/Nummer,
// generische Payout-Spannen) -- der Spieler muss Vorschau + Referenz-Grafik
// selbst kombinieren (design-toolbox.md 1.5).
//
// Die komplette Zug-Sequenz steht fest sobald sie generiert wird (`sequence`,
// per PatternEngine.sampleNext()-Kette erzeugt und danach nie mehr
// veraendert -- nur lazy um weitere Eintraege verlaengert, waechst fuer die
// gesamte Lebensdauer der Szene, da es seit Phase 7e keine "Runs" mehr gibt,
// die neu gestartet werden koennten). Ebenso werden die pro Position
// ausgeschlossenen Kandidaten (`exclusionOrders`) EINMAL pro Position
// ermittelt und bleiben stabil (machines.config.ts::
// computeCandidateExclusionOrder). PatternEngine bleibt unveraendert und
// unabhaengig (Architektur-Kurzregel CLAUDE.md); die Verzahnung passiert
// ausschliesslich hier ueber machines.config.ts::resolveMachineAction().
//
// Der Attendant "spielt" seit Phase 7d keine Runden mehr Schritt fuer
// Schritt -- er laeuft global und GLEICHZEITIG fuer alle durchgespielten
// Automaten in economy.ts::tickAttendants(), unabhaengig davon, welcher
// Automat gerade in dieser Szene geladen ist.

type Phase = 'planning' | 'executing';

const STEP_DELAY_MS = 700;

// Geometrie-Helfer (reine Pixel-Mathematik, keine Domain-Logik) -- liefert
// den i-ten von `count` Punkten gleichmaessig auf einem Kreis, beginnend
// oben (12-Uhr-Position), im Uhrzeigersinn. Wird sowohl fuer die
// interaktiven Aktions-Buttons als auch die statische Referenz-Grafik
// verwendet, damit beide dieselbe raeumliche Sprache sprechen.
function pentagonPoint(cx: number, cy: number, radius: number, index: number, count: number): { x: number; y: number } {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export class MachineScene extends Scene {
    private config!: MachineConfig;
    private patternEngine!: PatternEngine;
    // Die feste Zug-Sequenz -- einmal generierte Eintraege werden NIE
    // veraendert, das Array waechst nur lazy (ensureSequenceLength).
    private sequence: string[] = [];
    private sequenceCursor = 0;
    private exclusionOrders = new Map<number, string[]>();
    private phase: Phase = 'planning';
    private queue: MachineAction[] = [];
    private feedback = '';
    // Anzahl erreichter Meilensteine VOR der aktuell laufenden Ausfuehrung --
    // Vergleichsbasis fuer die "Meilenstein erreicht"-Fortschritts-Meldung
    // (siehe finishExecution).
    private milestonesReachedBeforeExecution = 0;

    private scoreText!: Phaser.GameObjects.Text;
    private feedbackText!: Phaser.GameObjects.Text;
    private queueText!: Phaser.GameObjects.Text;
    private forecastHeaderText!: Phaser.GameObjects.Text;
    private attendantStatusText!: Phaser.GameObjects.Text;
    // Meilenstein-Pips (Phase 7e): persistente Objekte, EINMAL erzeugt,
    // nur ihr Fuellzustand wird aktualisiert (kein Neuaufbau pro Render,
    // vermeidet Flackern). Letzter Pip ("Durchgespielt") ist ein um 45°
    // gedrehtes Quadrat (Raute) statt eines Kreises -- andere FORM, nicht
    // nur andere Farbe (Barrierefreiheits-Grundsatz).
    private milestonePips: Phaser.GameObjects.Shape[] = [];
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
        this.sequence = [];
        this.sequenceCursor = 0;
        this.exclusionOrders = new Map();
        this.queue = [];
        this.phase = 'planning';
        this.feedback = '';
    }

    create(): void {
        economyStore.unlockMachine(this.config.id);

        this.cameras.main.setBackgroundColor(0x101018);

        this.add.text(512, 28, this.config.name, {
            fontFamily: 'Arial Black', fontSize: 28, color: '#ffffff',
        }).setOrigin(0.5);

        // Einziger sichtbarer Zaehler in Layer 0 (game-spec.md Abschnitt 2):
        // der persistente Automaten-Punktestand, keine Tickets-Anzeige.
        this.scoreText = this.add.text(512, 58, '', {
            fontFamily: 'Arial', fontSize: 20, color: '#ffe066',
        }).setOrigin(0.5);

        this.createMilestonePips();

        this.feedbackText = this.add.text(512, 106, '', {
            fontFamily: 'Arial', fontSize: 15, color: '#ffffff', align: 'center',
            wordWrap: { width: 640 },
        }).setOrigin(0.5, 0);

        this.queueText = this.add.text(512, 172, '', {
            fontFamily: 'Arial', fontSize: 15, color: '#88ccff', align: 'center',
        }).setOrigin(0.5);

        this.add.text(900, 85, 'Konter-Reihenfolge:', {
            fontFamily: 'Arial', fontSize: 12, color: '#999999', align: 'center',
        }).setOrigin(0.5);
        this.renderReferencePentagon();

        this.forecastHeaderText = this.add.text(845, 228, '', {
            fontFamily: 'Arial', fontSize: 12, color: '#cccccc',
        }).setOrigin(0, 0.5);

        this.attendantStatusText = this.add.text(20, 750, '', {
            fontFamily: 'Arial', fontSize: 13, color: '#999999',
        });

        EventBus.emit('current-scene-ready', this);

        // Bruecke React (HallHub) -> Phaser: die Halle laesst den Spieler
        // einen Automaten anwaehlen, ohne dass React die Phaser-Szenen-API
        // direkt kennen muss (EventBus als einzige Bruecke). Bewusst HIER
        // registriert (auf der eigenen, aktiven ScenePlugin-Instanz) statt
        // global in main.ts ueber game.scene.start() -- letzteres crasht
        // Phasers SceneManager, wenn es von ausserhalb des Update-Loops auf
        // eine bereits laufende Szene angewendet wird. Listener wird beim
        // Szenenwechsel wieder entfernt.
        const handleRequestMachine = ({ machineId }: { machineId: string }) => {
            this.scene.start('Machine', { machineId });
        };
        EventBus.on('request-machine', handleRequestMachine);
        this.events.once('shutdown', () => EventBus.off('request-machine', handleRequestMachine));

        this.renderPhase();
    }

    // Verlaengert die feste Zug-Sequenz lazy, bis Position `length - 1`
    // existiert -- bereits generierte Eintraege werden NIE veraendert. Der
    // erste Eintrag wird als Uebergang vom Referenz-Startzustand
    // (pattern.states[0]) generiert, jeder weitere als Uebergang vom
    // jeweils vorherigen.
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

    // --- Meilenstein-Pips (Phase 7e) ---------------------------------------

    // Ein Pip pro Meilenstein-Schwelle, EINMAL erzeugt (persistent, kein
    // Neuaufbau pro Render). Letzter Pip = Raute (45°-gedrehtes Quadrat)
    // statt Kreis -- eine andere FORM markiert "Durchgespielt" distinkt,
    // nicht nur eine andere Farbe (CLAUDE.md-Barrierefreiheits-Grundsatz).
    // Exakte Schwellenwerte werden bewusst NICHT angezeigt (design-toolbox.md
    // 1.13, Opt-in-Tiefe: einfaches qualitatives Signal per Default).
    private createMilestonePips(): void {
        const count = this.config.milestones.length;
        const spacing = 26;
        const startX = 512 - ((count - 1) * spacing) / 2;
        for (let i = 0; i < count; i += 1) {
            const x = startX + i * spacing;
            const isFinal = i === count - 1;
            const pip = isFinal
                ? this.add.rectangle(x, 82, 15, 15, 0x444444).setAngle(45).setStrokeStyle(1, 0xffffff)
                : this.add.circle(x, 82, 8, 0x444444).setStrokeStyle(1, 0xffffff);
            this.milestonePips.push(pip);
        }
    }

    private updateMilestonePips(): void {
        const peak = economyStore.getMachinePeakScore(this.config.id).toNumber();
        const reachedCount = getReachedMilestones(this.config, peak).length;
        this.milestonePips.forEach((pip, i) => {
            pip.setFillStyle(i < reachedCount ? 0xffe066 : 0x444444);
        });
    }

    // --- Statische Referenz-Grafik (Phase 7e, game-spec.md 4.1c) ----------
    // Immer sichtbar, wird NIE neu gezeichnet (reine Nachschlage-Info, siehe
    // Datei-Kommentar) -- zeigt die Konter-Reihenfolge als Fuenfeck mit
    // Pfeilen (Aktion an Position i kontert Position i+1 im Zyklus).

    private drawArrow(
        graphics: Phaser.GameObjects.Graphics,
        from: { x: number; y: number },
        to: { x: number; y: number },
        color: number,
    ): void {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / len;
        const uy = dy / len;
        const startGap = 14;
        const endGap = 16;
        const sx = from.x + ux * startGap;
        const sy = from.y + uy * startGap;
        const ex = to.x - ux * endGap;
        const ey = to.y - uy * endGap;

        graphics.lineStyle(2, color, 1);
        graphics.beginPath();
        graphics.moveTo(sx, sy);
        graphics.lineTo(ex, ey);
        graphics.strokePath();

        const headLen = 8;
        const angle = Math.atan2(uy, ux);
        const leftX = ex - headLen * Math.cos(angle - Math.PI / 6);
        const leftY = ey - headLen * Math.sin(angle - Math.PI / 6);
        const rightX = ex - headLen * Math.cos(angle + Math.PI / 6);
        const rightY = ey - headLen * Math.sin(angle + Math.PI / 6);
        graphics.fillStyle(color, 1);
        graphics.fillTriangle(ex, ey, leftX, leftY, rightX, rightY);
    }

    private renderReferencePentagon(): void {
        const cx = 900;
        const cy = 150;
        const radius = 50;
        const n = this.config.pattern.states.length;
        const points = Array.from({ length: n }, (_, i) => pentagonPoint(cx, cy, radius, i, n));
        const graphics = this.add.graphics();

        for (let i = 0; i < n; i += 1) {
            this.drawArrow(graphics, points[i], points[(i + 1) % n], getStateColor(i));
        }
        points.forEach((p, i) => {
            this.add.circle(p.x, p.y, 11, getStateColor(i));
            this.add.text(p.x, p.y, `${i + 1}`, {
                fontFamily: 'Arial Black', fontSize: 12, color: '#000000',
            }).setOrigin(0.5);
        });
    }

    // --- Zwei-Achsen-Vorschau als farbige Chips (Phase 7e, ersetzt die
    // dichte Text-Liste aus Phase 7c) ---------------------------------------
    // Pro sichtbarer Position (bis zur gekauften Tiefe): eine Reihe aus
    // N_STATES kleinen Kreisen (einer je Pattern-Zustand, feste Reihenfolge),
    // gefuellt+farbig+nummeriert fuer noch moegliche Kandidaten, blass/grau
    // fuer bereits ausgeschlossene -- macht "ausgeschlossen" ueber Fuellung
    // UND Farbe UND Nummer sichtbar, nicht nur ueber Text. Ausserhalb der
    // Sichtweite: ein einzelner grauer "?"-Chip.
    private renderPreviewChips(): void {
        const depthLevel = this.getPreviewDepthLevel();
        const precisionLevel = this.getPreviewPrecisionLevel();
        this.forecastHeaderText.setText(`Vorschau (Tiefe ${depthLevel}, Praezision ${precisionLevel}/${MAX_PRECISION}):`);
        this.ensureSequenceLength(this.sequenceCursor + N_STATES);

        const states = this.patternEngine.getStates();
        const baseX = 845;
        const chipSpacing = 24;
        const rowSpacing = 30;
        const startY = 255;

        for (let offset = 0; offset < N_STATES; offset += 1) {
            const y = startY + offset * rowSpacing;
            const rowLabel = this.add
                .text(baseX - 22, y, `${offset + 1}`, { fontFamily: 'Arial Black', fontSize: 12, color: '#ffffff' })
                .setOrigin(0.5);
            this.dynamicObjects.push(rowLabel);

            if (offset >= depthLevel) {
                const cx = baseX + 2 * chipSpacing;
                const chip = this.add.circle(cx, y, 9, UNKNOWN_COLOR);
                const q = this.add
                    .text(cx, y, '?', { fontFamily: 'Arial Black', fontSize: 11, color: '#ffffff' })
                    .setOrigin(0.5);
                this.dynamicObjects.push(chip, q);
                continue;
            }

            const position = this.sequenceCursor + offset;
            const remaining = this.getRemainingCandidates(position, precisionLevel);
            states.forEach((state, i) => {
                const cx = baseX + i * chipSpacing;
                const isCandidate = remaining.includes(state);
                const circle = this.add.circle(cx, y, 9, isCandidate ? getStateColor(i) : UNKNOWN_COLOR, isCandidate ? 1 : 0.25);
                if (!isCandidate) circle.setStrokeStyle(1, UNKNOWN_COLOR);
                const number = this.add
                    .text(cx, y, `${i + 1}`, {
                        fontFamily: 'Arial', fontSize: 9, color: isCandidate ? '#000000' : '#cccccc',
                    })
                    .setOrigin(0.5);
                this.dynamicObjects.push(circle, number);
            });
        }
    }

    private renderPhase(): void {
        this.clearDynamic();
        this.scoreText.setText(`Punkte: ${economyStore.getMachinePoints(this.config.id).toNumber().toFixed(1)}`);
        this.updateMilestonePips();
        this.renderPreviewChips();
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
        }
        // 'executing': bewusst keine interaktiven Elemente (kein Reflex-Input, game-spec.md 4.1)
    }

    private queueAction(action: MachineAction): void {
        if (this.queue.length >= N_STATES) return;
        this.queue.push(action);
        this.renderPhase();
    }

    // Fuenfeck-Anordnung der 5 Aktions-Buttons (game-spec.md 4.1c): Position
    // i im Kreis entspricht Zustand i im Pattern -- Nachbarschaft im Kreis
    // macht die Konter-Beziehung raeumlich lernbar (siehe Referenz-Grafik).
    // Buttons zeigen bewusst NUR Name, Farbe/Nummer und generische Payout-
    // Spannen -- KEINE live berechnete Auflösung gegen den aktuell bekannten
    // Zustand mehr (Phase 7e, game-spec.md 4.1c Punkt "Keine Live-
    // Verhaltensanzeige").
    private renderActionButtons(): void {
        const actions = this.config.actions;
        const canAdd = this.queue.length < N_STATES;
        const cx = 512;
        const cy = 415;
        const radius = 145;
        const n = actions.length;

        actions.forEach((action, index) => {
            const { x, y } = pentagonPoint(cx, cy, radius, index, n);
            const label = [
                `${index + 1}. ${action.id}`,
                `Gross ${action.payoutBig[0]}-${action.payoutBig[1]}`,
                `Einfach ${action.payoutSimple[0]}-${action.payoutSimple[1]}`,
                `Verlust ${action.payoutLoss[0]}-${action.payoutLoss[1]}`,
            ].join('\n');
            this.makeButton(x, y, 120, 80, label, () => this.queueAction(action), canAdd ? getStateColor(index) : 0x444444);
        });
    }

    private renderPlanningControls(): void {
        this.makeButton(512 - 160, 615, 220, 50, 'Letzten entfernen', () => {
            this.queue.pop();
            this.renderPhase();
        }, 0x555555);

        const canExecute = this.queue.length > 0;
        this.makeButton(
            512 + 160,
            615,
            220,
            50,
            'Los!',
            () => {
                if (this.queue.length === 0) return;
                this.executeQueue();
            },
            canExecute ? 0x27ae60 : 0x444444,
        );
    }

    // Kaufoberflaeche fuer EINE der beiden automaten-internen Vorschau-
    // Leitern (Tiefe ODER Praezision) -- zeigt die naechste noch nicht
    // gekaufte Stufe mit ihrem aktuellen, kreuz-preis-abhaengigen Preis
    // (siehe machines.config.ts::getMachineUpgradeCost). Bezahlt mit den
    // EIGENEN Automaten-Punkten dieses Automaten, NICHT mit hallenweiten
    // Tickets. Bewusst NICHT im hallenweiten UpgradePanel.tsx.
    private renderUpgradeLadderShop(y: number, ladder: readonly MachineUpgradeDef[], owned: readonly string[]): void {
        const nextUpgrade = ladder.find((upgrade) => !owned.includes(upgrade.id));
        if (!nextUpgrade) return;

        const cost = getMachineUpgradeCost(this.config, nextUpgrade, owned);
        const points = economyStore.getMachinePoints(this.config.id).toNumber();
        const canAfford = points >= cost;
        const label = `${nextUpgrade.name}\n${nextUpgrade.description}\nKosten: ${cost.toFixed(1)} Automaten-Punkte (${points.toFixed(1)} vorhanden)`;
        this.makeButton(
            512,
            y,
            440,
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

    private renderInternalUpgradeShop(): void {
        const owned = this.getOwnedUpgradeIds();
        this.renderUpgradeLadderShop(670, this.config.depthUpgrades, owned);
        this.renderUpgradeLadderShop(730, this.config.precisionUpgrades, owned);
    }

    private executeQueue(): void {
        this.phase = 'executing';
        this.feedback = '';
        this.milestonesReachedBeforeExecution = getReachedMilestones(
            this.config,
            economyStore.getMachinePeakScore(this.config.id).toNumber(),
        ).length;
        this.renderPhase();
        this.runQueueStep(0);
    }

    private runQueueStep(index: number): void {
        if (index >= this.queue.length) {
            this.finishExecution();
            return;
        }

        const action = this.queue[index];
        const position = this.sequenceCursor + index;
        this.ensureSequenceLength(position + 1);
        const state = this.sequence[position];

        const resolved = resolveMachineAction(action, state);
        // Musterkenntnis steigt primaer durch manuelles Spielen (game-spec.md
        // 3.2) -- jede manuell aufgeloeste Aktion zaehlt. Der Attendant
        // durchlaeuft diese Methode nicht (er laeuft als reine Ertragsrate
        // global in economy.ts::tickAttendants).
        const knowledge = economyStore.getAttendantKnowledge(this.config.id);
        economyStore.setAttendantKnowledge(this.config.id, gainKnowledgeFromManualPlay(knowledge));

        // Sofortige, dauerhafte Verbuchung (Phase 7e, ersetzt PushYourLuckRun/
        // Banking): der Payout wirkt direkt und permanent auf den
        // persistenten Automaten-Punktestand.
        const payout = drawPayout(resolved);
        economyStore.applyMachineScoreDelta(this.config.id, payout);
        const scoreAfter = economyStore.getMachinePoints(this.config.id).toNumber();
        this.scoreText.setText(`Punkte: ${scoreAfter.toFixed(1)}`);
        this.updateMilestonePips();

        // Zweite, ebenfalls sofortige Ausschuettung (game-spec.md 3.1, Phase
        // 7d): jede Aktion erzeugt gleichzeitig hallenweite Tickets,
        // proportional zum tatsaechlich gezogenen (bei 0 gekappten) Payout.
        const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
        const hallTicketsGained = Math.max(0, payout) * this.config.ticketYieldFactor * ticketYieldRate;
        if (hallTicketsGained > 0) {
            economyStore.addHallTickets(hallTicketsGained);
        }

        const outcome =
            state === action.counterState ? 'GROSSER GEWINN' : state === action.losesToState ? 'VERLUST' : 'Treffer';
        const sign = payout >= 0 ? '+' : '';
        this.feedback = `Schritt ${index + 1}: ${outcome} mit "${action.id}" bei Musterzustand "${state}" (${sign}${payout.toFixed(1)} Punkte, Punktestand jetzt ${scoreAfter.toFixed(1)}, +${hallTicketsGained.toFixed(2)} Tickets).`;
        this.feedbackText.setText(this.feedback);

        this.time.delayedCall(STEP_DELAY_MS, () => this.runQueueStep(index + 1));
    }

    // Phase 7e (game-spec.md 4.1c): kein Entscheidungsbildschirm mehr.
    // "Meilenstein erreicht" ist nur noch eine passive Fortschritts-Meldung,
    // "Durchgespielt" (persistenter Punktestand-Peak hat einmalig die letzte
    // Schwelle erreicht) schaltet weiterhin den Attendant frei bzw. loest
    // beim entryPoint-Automaten den Durchbruch aus -- danach geht es NAHTLOS
    // mit derselben Planungsphase weiter (kein separater "Score-Attack"-Modus
    // mehr noetig, da Fortschritt ohnehin immer kontinuierlich/persistent ist).
    private finishExecution(): void {
        const executedSteps = this.queue.length;
        this.queue = [];
        this.sequenceCursor += executedSteps;

        const peak = economyStore.getMachinePeakScore(this.config.id).toNumber();
        const reachedNow = getReachedMilestones(this.config, peak).length;
        const isFinal = isFinalMilestoneReached(this.config, peak);
        const isFirstCompletion = isFinal && !economyStore.isMachineCompleted(this.config.id);

        if (isFirstCompletion) {
            economyStore.markMachineCompleted(this.config.id);
            persist();

            if (this.config.entryPoint) {
                // Durchbruch-Moment (game-spec.md Abschnitt 2): das erstmalige
                // Durchspielen des Layer-0-Automaten IST der Durchbruch. Der
                // Punktestand ist bereits persistent verbucht (kein
                // gesonderter Bank-Schritt mehr noetig).
                this.scene.start('Transition', { machineId: this.config.id });
                return;
            }
        }

        if (reachedNow > this.milestonesReachedBeforeExecution) {
            this.feedback += isFinal ? ' Durchgespielt! Letzter Meilenstein erreicht.' : ' Meilenstein erreicht!';
            this.feedbackText.setText(this.feedback);
        }

        this.phase = 'planning';
        this.renderPhase();
    }

    // Rein informative Anzeige: der Attendant laeuft global und unabhaengig
    // von dieser Szene (economy.ts::tickAttendants) -- hier wird nur die
    // aktuell geltende Ertragsrate DIESES Automaten angezeigt (dieselbe
    // Formel wie economy.ts verwendet, machines.config.ts::
    // getMachineAttendantRate), keine eigene Ticklogik.
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
            `Attendant: laeuft im Hintergrund (alle Automaten gleichzeitig) – Musterkenntnis ${knowledgePct}%, ~${rate.machinePointsPerSecond.toFixed(2)} Automaten-Punkte/s, ~${rate.hallTicketsPerSecond.toFixed(2)} Tickets/s`,
        );
    }

    // Manuelle Rueckkehr zur Halle: emittiert dasselbe Signal wie der Reveal
    // ('return-to-hall' statt 'hall-reveal', App.tsx behandelt beide
    // gleich), aendert aber NICHT die laufende Phaser-Szene -- der Automat
    // laeuft im Hintergrund weiter. Nur sichtbar, sobald die Halle
    // ueberhaupt existiert (entryPoint bereits durchgespielt).
    private renderBackToHallButton(): void {
        if (!economyStore.isMachineCompleted(getEntryPointMachine().id)) return;
        this.makeButton(100, 24, 160, 40, 'Zur Halle', () => EventBus.emit('return-to-hall'), 0x34495e);
    }
}
