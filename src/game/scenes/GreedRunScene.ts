import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import {
    GridRunEngine,
    applyDirection,
    drawCategoryPayout,
    resolveSectorKnowledge,
    type Direction,
    type GridPosition,
} from '../../engine/GridRunEngine';
import { gainKnowledgeFromManualPlay } from '../../engine/AttendantEngine';
import type { GridFocus, GridMachineConfig, MachineUpgradeDef, SectorCategory } from '../../engine/types';
import {
    MAX_GRID_PRECISION,
    SECTOR_SYMBOLS,
    UNKNOWN_COLOR,
    getActionBudget,
    getEntryPointMachine,
    getGridPrecisionLevel,
    getMachineAttendantRate,
    getMachineConfig,
    getReachedMilestones,
    getSectorColor,
    getSightRange,
    isFinalMilestoneReached,
} from '../../data/machines.config';
import { getTicketYieldRate } from '../../data/hall.config';
import { economyStore, persist } from '../economy';
import { getSceneKeyForMachine } from '../sceneRouting';
import { createMilestonePips, updateMilestonePips } from './milestonePips';

// Eigene Szene fuer Automat 1 "Greed Run" (Phase 7f Genre-Rework, game-spec.md
// 4.2) -- ersetzt die generische MachineScene.ts VOLLSTAENDIG fuer diesen
// Automaten (CLAUDE.md "Workflow-Regeln": eigene, genre-spezifische Szene bei
// strukturell abweichender Mechanik erlaubt). Automaten 2-4 bleiben
// unveraendert auf MachineScene.ts. Geteilte Buchhaltung (EconomyStore,
// SaveSystem, Tickets-/Meilenstein-Anbindung) wird NICHT dupliziert, sondern
// exakt wie in MachineScene.ts ueber economyStore/persist/machines.config.ts
// angesprochen.
//
// Rundenstruktur (game-spec.md 4.2 "Rundenstruktur"): eine Planungsrunde kann
// 1 bis (verbleibendes Aktionsbudget)-viele Zuege umfassen; danach
// Ausfuehrung/Zusehen/Ergebnis wie bei den anderen Automaten. Ein "Run" endet
// erst, wenn das GESAMTE Aktionsbudget verbraucht ist (nicht nach jeder
// Planungsrunde) -- danach startet automatisch ein neuer Run (Checkbox
// "fuer naechsten Lauf beibehalten") oder das Fokus-Popup erscheint erneut.

type Phase = 'focus-select' | 'planning' | 'executing';

const STEP_DELAY_MS = 700;

const CELL_SIZE = 58;
const CELL_GAP = 6;
const GRID_ORIGIN = { x: 50, y: 170 };
const DPAD_CENTER = { x: 207, y: 545 };

const DIRECTION_LABELS: Record<Direction, string> = { up: 'Hoch', down: 'Runter', left: 'Links', right: 'Rechts' };
const DIRECTION_ARROWS: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const CATEGORY_LABELS: Record<SectorCategory, string> = {
    ghost: 'Geist',
    points: 'Punkte',
    empty: 'Leer',
    bonus: 'Bonus-Frucht',
};

function cellKey(pos: GridPosition): string {
    return `${pos.row},${pos.col}`;
}

export class GreedRunScene extends Scene {
    private config!: GridMachineConfig;
    private runEngine: GridRunEngine | null = null;
    private focus: GridFocus = 'safe';
    private phase: Phase = 'focus-select';
    private plannedMoves: Direction[] = [];
    // Rendering-Hilfszustand: welche Sektoren dieser Spieler in DIESEM Run
    // bereits betreten hat (fuer die "besucht"-Markierung) -- unabhaengig von
    // der Verbrauchsregel im Engine-State selbst (die kennt nur noch 'empty').
    private visitedPositions = new Set<string>();
    private keepForNextRunChecked = true;
    private feedback = '';
    private milestonesReachedBeforeExecution = 0;

    private scoreText!: Phaser.GameObjects.Text;
    private feedbackText!: Phaser.GameObjects.Text;
    private planText!: Phaser.GameObjects.Text;
    private statusText!: Phaser.GameObjects.Text;
    private attendantStatusText!: Phaser.GameObjects.Text;
    private milestonePips: Phaser.GameObjects.Shape[] = [];
    private dynamicObjects: Phaser.GameObjects.GameObject[] = [];

    constructor() {
        super('GreedRun');
    }

    init(data: { machineId: string }): void {
        const config = getMachineConfig(data.machineId);
        if (!config) {
            throw new Error(`GreedRunScene: unbekannte machineId "${data.machineId}"`);
        }
        if (config.kind !== 'grid') {
            throw new Error(
                `GreedRunScene: Automat "${data.machineId}" ist kein Grid-Automat (kind="${config.kind}") -- gehoert in MachineScene.ts, siehe sceneRouting.ts`,
            );
        }
        this.config = config;
        this.runEngine = null;
        this.focus = 'safe';
        this.phase = 'focus-select';
        this.plannedMoves = [];
        this.visitedPositions = new Set();
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

        this.planText = this.add.text(DPAD_CENTER.x, 630, '', {
            fontFamily: 'Arial', fontSize: 15, color: '#88ccff', align: 'center',
        }).setOrigin(0.5);

        this.statusText = this.add.text(430, 450, '', {
            fontFamily: 'Arial', fontSize: 14, color: '#cccccc',
        });

        this.attendantStatusText = this.add.text(20, 750, '', {
            fontFamily: 'Arial', fontSize: 13, color: '#999999',
        });

        this.renderLegend();

        EventBus.emit('current-scene-ready', this);

        // Selbe Bruecken-Konvention wie MachineScene.ts (siehe dort fuer die
        // ausfuehrliche Begruendung) -- Routing ueber sceneRouting.ts, damit
        // die Auswahl eines ANDEREN Automaten aus der Halle korrekt entweder
        // in dieser Szene (Greed Run erneut) oder in 'Machine' (Automat 2-4)
        // landet.
        const handleRequestMachine = ({ machineId }: { machineId: string }) => {
            this.scene.start(getSceneKeyForMachine(machineId), { machineId });
        };
        EventBus.on('request-machine', handleRequestMachine);
        this.events.once('shutdown', () => EventBus.off('request-machine', handleRequestMachine));

        const preference = economyStore.getGridFocusPreference(this.config.id);
        this.keepForNextRunChecked = preference?.keepForNextRun ?? true;
        if (preference?.keepForNextRun) {
            this.startNewRun(preference.focus);
        } else {
            this.phase = 'focus-select';
            this.renderPhase();
        }
    }

    private cellCenter(row: number, col: number): { x: number; y: number } {
        return {
            x: GRID_ORIGIN.x + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
            y: GRID_ORIGIN.y + row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
        };
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

    // --- Statische Legende (einmalig, game-spec.md 4.2 + CLAUDE.md ---------
    // Barrierefreiheits-Grundsatz: Farbe + Symbol/Text, nie Farbe allein) ---

    private renderLegend(): void {
        const x = 430;
        this.add.text(x, 150, 'Kategorien:', { fontFamily: 'Arial', fontSize: 13, color: '#999999' });

        let y = 172;
        const rowGap = 28;
        const swatch = (category: SectorCategory, label: string) => {
            this.add.rectangle(x, y, 20, 20, getSectorColor(category)).setStrokeStyle(1, 0x000000);
            this.add
                .text(x, y, SECTOR_SYMBOLS[category], { fontFamily: 'Arial Black', fontSize: 11, color: '#000000' })
                .setOrigin(0.5);
            this.add.text(x + 16, y, label, { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
            y += rowGap;
        };

        const ranges = this.config.grid.payoutRanges;
        swatch('ghost', `Geist (${ranges.ghost[0]} bis ${ranges.ghost[1]})`);
        swatch('points', `Punkte (${ranges.points[0]} bis ${ranges.points[1]})`);
        swatch('bonus', `Bonus (${ranges.bonus[0]} bis ${ranges.bonus[1]})`);
        swatch('empty', 'Leer (0)');

        this.add.rectangle(x, y, 20, 20, UNKNOWN_COLOR);
        this.add.text(x, y, '?', { fontFamily: 'Arial Black', fontSize: 11, color: '#ffffff' }).setOrigin(0.5);
        this.add.text(x + 16, y, 'Unbekannt (ausser Sichtweite)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += rowGap;

        this.add.rectangle(x, y, 20, 20, 0x2a2a2a).setStrokeStyle(2, 0xffffff);
        this.add.text(x + 16, y, 'Aktuelle Position', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += rowGap;

        this.add.circle(x, y, 4, 0x555555);
        this.add.text(x + 16, y, 'Bereits besucht', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
    }

    // --- Feld-Darstellung ---------------------------------------------------

    private drawCellBase(x: number, y: number, color: number): void {
        const rect = this.add.rectangle(x, y, CELL_SIZE, CELL_SIZE, color).setStrokeStyle(1, 0x000000);
        this.dynamicObjects.push(rect);
    }

    private addCellLabel(x: number, y: number, label: string, color: string): void {
        if (!label) return;
        const text = this.add
            .text(x, y, label, { fontFamily: 'Arial Black', fontSize: 18, color })
            .setOrigin(0.5);
        this.dynamicObjects.push(text);
    }

    // Zeichnet die 5x5-Sektoren gemaess Sichtweite/Praezision (game-spec.md
    // 4.2). Drei Zustaende pro Sektor, IMMER Farbe+Symbol gekoppelt (CLAUDE.md
    // Barrierefreiheits-Grundsatz):
    //   - ausserhalb der Sichtweite (und nie besucht): grauer "?"-Sektor.
    //   - sichtbar, aber Praezision reicht nicht fuer vollstaendige Kenntnis:
    //     neutraler Sektor mit "?" PLUS kleinen farbigen Ecken-Punkten fuer
    //     jede bereits ausgeschlossene Kategorie.
    //   - sichtbar UND (per Praezision oder Ausschluss) bekannt: voll
    //     eingefaerbter Sektor mit dem Kategorie-Buchstaben.
    // Bereits besuchte Sektoren zeigen unabhaengig davon nur noch eine dezente
    // "besucht"-Markierung (Verbrauchsregel: ihr urspruenglicher Inhalt ist
    // im Engine-State bereits zu 'empty' geworden).
    private renderGrid(): void {
        if (!this.runEngine) return;
        const owned = this.getOwnedUpgradeIds();
        const sightRange = getSightRange(this.config, owned);
        const precision = getGridPrecisionLevel(this.config, owned);
        const visibleKeys = new Set(this.runEngine.getVisibleSectors(sightRange).map(cellKey));
        const currentPos = this.runEngine.getPosition();
        const gridSize = this.config.grid.gridSize;

        for (let row = 0; row < gridSize; row += 1) {
            for (let col = 0; col < gridSize; col += 1) {
                const pos: GridPosition = { row, col };
                const key = cellKey(pos);
                const { x, y } = this.cellCenter(row, col);
                const isCurrent = pos.row === currentPos.row && pos.col === currentPos.col;

                if (this.visitedPositions.has(key)) {
                    this.drawCellBase(x, y, 0x222222);
                    const dot = this.add.circle(x, y, 4, 0x555555);
                    this.dynamicObjects.push(dot);
                } else if (!visibleKeys.has(key)) {
                    this.drawCellBase(x, y, UNKNOWN_COLOR);
                    this.addCellLabel(x, y, '?', '#ffffff');
                } else {
                    const trueCategory = this.runEngine.getCategoryAt(pos);
                    const knowledge = resolveSectorKnowledge(trueCategory, precision, this.focus);
                    if (knowledge.known !== null) {
                        this.drawCellBase(x, y, getSectorColor(knowledge.known));
                        this.addCellLabel(x, y, SECTOR_SYMBOLS[knowledge.known], '#000000');
                    } else {
                        this.drawCellBase(x, y, 0x2a2a2a);
                        this.addCellLabel(x, y, '?', '#ffffff');
                        knowledge.excluded.forEach((category, i) => {
                            const tickX = x - CELL_SIZE / 2 + 8 + i * 11;
                            const tickY = y - CELL_SIZE / 2 + 8;
                            const tick = this.add.circle(tickX, tickY, 4, getSectorColor(category));
                            this.dynamicObjects.push(tick);
                        });
                    }
                }

                if (isCurrent) {
                    const marker = this.add.rectangle(x, y, CELL_SIZE, CELL_SIZE).setStrokeStyle(3, 0xffffff);
                    this.dynamicObjects.push(marker);
                }
            }
        }
    }

    // --- Fokus-Wahl (game-spec.md 4.2 "UI-Ablauf") --------------------------

    private renderFocusPopup(): void {
        const dim = this.add.rectangle(512, 384, 1024, 768, 0x000000, 0.75);
        const title = this.add
            .text(512, 260, 'Fokus fuer diesen Lauf waehlen', {
                fontFamily: 'Arial Black', fontSize: 24, color: '#ffffff', align: 'center',
            })
            .setOrigin(0.5);
        this.dynamicObjects.push(dim, title);

        this.makeButton(
            512 - 170,
            420,
            300,
            130,
            'Sicher\n\nPraezision 1 erkennt zuerst zuverlaessig Geister.',
            () => this.startNewRun('safe'),
            0x2c6e9e,
        );
        this.makeButton(
            512 + 170,
            420,
            300,
            130,
            'Gier\n\nPraezision 1 erkennt zuerst zuverlaessig Bonus-Fruechte.',
            () => this.startNewRun('greedy'),
            0xb8860b,
        );
    }

    private renderFocusChip(): void {
        const label = this.focus === 'safe' ? 'Fokus: Sicher' : 'Fokus: Gier';
        const color = this.focus === 'safe' ? 0x2c6e9e : 0xb8860b;
        const chipBg = this.add.rectangle(750, 360, 300, 40, color).setStrokeStyle(2, 0xffffff);
        const chipText = this.add
            .text(750, 360, label, { fontFamily: 'Arial Black', fontSize: 14, color: '#ffffff' })
            .setOrigin(0.5);
        this.dynamicObjects.push(chipBg, chipText);

        const checkboxLabel = `${this.keepForNextRunChecked ? '[x]' : '[ ]'} Fuer naechsten Lauf beibehalten`;
        this.makeButton(
            750,
            405,
            300,
            34,
            checkboxLabel,
            () => {
                this.keepForNextRunChecked = !this.keepForNextRunChecked;
                economyStore.setGridFocusPreference(this.config.id, {
                    focus: this.focus,
                    keepForNextRun: this.keepForNextRunChecked,
                });
                persist();
                this.renderPhase();
            },
            0x3a3a3a,
        );
    }

    // --- Bewegungsplanung ----------------------------------------------------

    private getProjectedPosition(): GridPosition {
        let pos = this.runEngine!.getPosition();
        for (const direction of this.plannedMoves) {
            const next = applyDirection(pos, direction, this.config.grid.gridSize);
            if (!next) break;
            pos = next;
        }
        return pos;
    }

    private canQueueDirection(direction: Direction): boolean {
        if (!this.runEngine) return false;
        if (this.plannedMoves.length >= this.runEngine.getActionsRemaining()) return false;
        return applyDirection(this.getProjectedPosition(), direction, this.config.grid.gridSize) !== null;
    }

    private queueMove(direction: Direction): void {
        if (!this.canQueueDirection(direction)) return;
        this.plannedMoves.push(direction);
        this.renderPhase();
    }

    private renderMovementButtons(): void {
        const layout: Record<Direction, { x: number; y: number }> = {
            up: { x: DPAD_CENTER.x, y: DPAD_CENTER.y - 45 },
            down: { x: DPAD_CENTER.x, y: DPAD_CENTER.y + 45 },
            left: { x: DPAD_CENTER.x - 80, y: DPAD_CENTER.y },
            right: { x: DPAD_CENTER.x + 80, y: DPAD_CENTER.y },
        };
        (Object.keys(layout) as Direction[]).forEach((direction) => {
            const allowed = this.canQueueDirection(direction);
            const { x, y } = layout[direction];
            this.makeButton(
                x,
                y,
                70,
                40,
                `${DIRECTION_ARROWS[direction]} ${DIRECTION_LABELS[direction]}`,
                () => this.queueMove(direction),
                allowed ? 0x2c3e50 : 0x333333,
            );
        });
    }

    private renderRunControls(): void {
        this.makeButton(
            130,
            675,
            200,
            45,
            'Letzten entfernen',
            () => {
                this.plannedMoves.pop();
                this.renderPhase();
            },
            0x555555,
        );

        const canExecute = this.plannedMoves.length > 0;
        this.makeButton(
            340,
            675,
            160,
            45,
            'Los!',
            () => {
                if (this.plannedMoves.length === 0) return;
                this.executeQueue();
            },
            canExecute ? 0x27ae60 : 0x444444,
        );
    }

    // --- Automaten-interne Upgrade-Achsen (game-spec.md 4.2, drei ----------
    // unabhaengige Leitern, bewusst OHNE Kreuz-Preis-Kopplung) --------------

    private renderGridUpgradeLadderShop(y: number, ladder: readonly MachineUpgradeDef[], owned: readonly string[]): void {
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
        this.renderGridUpgradeLadderShop(520, this.config.sightRangeUpgrades, owned);
        this.renderGridUpgradeLadderShop(580, this.config.gridPrecisionUpgrades, owned);
        this.renderGridUpgradeLadderShop(640, this.config.actionBudgetUpgrades, owned);
    }

    // --- Statustexte (persistente Objekte, nur Text wird aktualisiert) -----

    private updateStatusText(): void {
        if (!this.runEngine) {
            this.statusText.setText('');
            return;
        }
        const owned = this.getOwnedUpgradeIds();
        const sightRange = getSightRange(this.config, owned);
        const precision = getGridPrecisionLevel(this.config, owned);
        const focusLabel = this.focus === 'safe' ? 'Sicher' : 'Gier';
        this.statusText.setText(
            `Sichtweite ${sightRange} | Praezision ${precision}/${MAX_GRID_PRECISION} | Aktionen ${this.runEngine.getActionsRemaining()} verbleibend | Fokus: ${focusLabel}`,
        );
    }

    private updatePlanText(): void {
        this.planText.setText(
            this.plannedMoves.length > 0
                ? `Plan: ${this.plannedMoves.map((d) => DIRECTION_ARROWS[d]).join(' ')}`
                : 'Plan: (leer)',
        );
    }

    // Rein informative Anzeige, dieselbe Konvention wie MachineScene.ts: der
    // Attendant laeuft global (economy.ts::tickAttendants), hier nur Anzeige
    // der aktuell geltenden Rate. Bewusst als "vereinfachte Schaetzung"
    // beschriftet (game-spec.md 4.2 "Attendant-Automatisierung", AttendantEngine.ts).
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
            `Attendant: laeuft im Hintergrund (vereinfachte Schaetzung ohne Pfadplanung) – Musterkenntnis ${knowledgePct}%, ~${rate.machinePointsPerSecond.toFixed(2)} Automaten-Punkte/s, ~${rate.hallTicketsPerSecond.toFixed(2)} Tickets/s`,
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

        if (this.phase === 'focus-select' || !this.runEngine) {
            this.updatePlanText();
            this.updateStatusText();
            this.renderFocusPopup();
            return;
        }

        this.renderGrid();
        this.renderFocusChip();
        this.updateStatusText();
        this.updatePlanText();

        if (this.phase === 'planning') {
            this.renderMovementButtons();
            this.renderRunControls();
            this.renderUpgradeShop();
        }
        // 'executing': bewusst keine interaktiven Elemente (kein Reflex-Input, game-spec.md 4.1)
    }

    // --- Run-Lebenszyklus ----------------------------------------------------

    private startNewRun(focus: GridFocus): void {
        this.focus = focus;
        const budget = getActionBudget(this.config, this.getOwnedUpgradeIds());
        this.runEngine = new GridRunEngine(this.config.grid, budget, Math.random);
        this.visitedPositions = new Set([cellKey(this.runEngine.getPosition())]);
        this.plannedMoves = [];
        this.phase = 'planning';
        economyStore.setGridFocusPreference(this.config.id, { focus, keepForNextRun: this.keepForNextRunChecked });
        persist();
        this.renderPhase();
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
        if (!this.runEngine || index >= this.plannedMoves.length) {
            this.finishExecution();
            return;
        }

        const direction = this.plannedMoves[index];
        const result = this.runEngine.move(direction);
        this.visitedPositions.add(cellKey(result.position));

        // Musterkenntnis steigt primaer durch manuelles Spielen (game-spec.md
        // 3.2), wie bei den zyklischen Automaten -- der Attendant durchlaeuft
        // diese Methode nicht (er laeuft als reine Ertragsrate global in
        // economy.ts::tickAttendants).
        const knowledge = economyStore.getAttendantKnowledge(this.config.id);
        economyStore.setAttendantKnowledge(this.config.id, gainKnowledgeFromManualPlay(knowledge));

        const payout = drawCategoryPayout(this.config.grid, result.category);
        economyStore.applyMachineScoreDelta(this.config.id, payout);
        const scoreAfter = economyStore.getMachinePoints(this.config.id).toNumber();

        const ticketYieldRate = getTicketYieldRate(economyStore.getState().hallUpgrades);
        const hallTicketsGained = Math.max(0, payout) * this.config.ticketYieldFactor * ticketYieldRate;
        if (hallTicketsGained > 0) {
            economyStore.addHallTickets(hallTicketsGained);
        }

        const sign = payout >= 0 ? '+' : '';
        this.feedback = `Schritt ${index + 1}: ${DIRECTION_LABELS[direction]} -> ${CATEGORY_LABELS[result.category]} (${sign}${payout.toFixed(1)} Punkte, Punktestand jetzt ${scoreAfter.toFixed(1)}, +${hallTicketsGained.toFixed(2)} Tickets).`;
        this.renderPhase();

        this.time.delayedCall(STEP_DELAY_MS, () => this.runQueueStep(index + 1));
    }

    // Analog zu MachineScene.finishExecution: keine Bank-/Meilenstein-
    // Entscheidungsbildschirme mehr (Phase 7e gilt automaten-uebergreifend).
    // Zusaetzlich fuer den Grid-Automaten: sobald das Aktionsbudget des Runs
    // erschoepft ist, startet entweder direkt ein neuer Run (Checkbox aktiv)
    // oder das Fokus-Popup erscheint erneut.
    private finishExecution(): void {
        if (!this.runEngine) return;
        this.plannedMoves = [];

        const peak = economyStore.getMachinePeakScore(this.config.id).toNumber();
        const reachedNow = getReachedMilestones(this.config, peak).length;
        const isFinal = isFinalMilestoneReached(this.config, peak);
        const isFirstCompletion = isFinal && !economyStore.isMachineCompleted(this.config.id);

        if (isFirstCompletion) {
            economyStore.markMachineCompleted(this.config.id);
            persist();

            if (this.config.entryPoint) {
                // Durchbruch-Moment (game-spec.md Abschnitt 2): identisch zu
                // MachineScene.ts, der Automaten-Punktestand ist bereits
                // persistent verbucht.
                this.scene.start('Transition', { machineId: this.config.id });
                return;
            }
        }

        if (reachedNow > this.milestonesReachedBeforeExecution) {
            this.feedback += isFinal ? ' Durchgespielt! Letzter Meilenstein erreicht.' : ' Meilenstein erreicht!';
        }

        if (this.runEngine.isFinished()) {
            this.feedback += ' Lauf beendet.';
            if (this.keepForNextRunChecked) {
                this.startNewRun(this.focus);
                return;
            }
            this.runEngine = null;
            this.phase = 'focus-select';
            this.renderPhase();
            return;
        }

        this.phase = 'planning';
        this.renderPhase();
    }
}
