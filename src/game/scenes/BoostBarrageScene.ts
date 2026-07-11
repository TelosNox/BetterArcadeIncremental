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

// Formation statt flacher Reihe (game-spec.md 4.4 "Visuelle Umsetzung",
// Korrektur nach Playtest-Screenshot 2026-07-11, Punkt 2): Gegner werden in
// einem Space-Invaders-artigen Raster aus Zeilen/Spalten angeordnet.
// `formationPosition` ist eine reine Funktion von (index, count) OHNE
// Zeitabhaengigkeit -- dieselbe Formel wird sowohl fuer das Rendern des
// Rosters als auch fuer das Zielen des Kampf-Effekts (playCombatEffect)
// verwendet, damit Schuss-/Explosions-Effekt garantiert exakt am sichtbaren
// Icon landen, unabhaengig davon, wie oft encounterIndex zwischendurch schon
// weitergerueckt ist.
const FORMATION_ORIGIN = { x: 380, y: 205 };
const FORMATION_MAX_COLUMNS = 3;
const FORMATION_COL_SPACING = 110;
const FORMATION_ROW_SPACING = 68;

// Auswahl-Rahmen ums aktuelle Gefecht -- Konstante statt aus einem Icon-
// Radius abgeleitet, da die Sprite-Silhouetten (siehe unten) je nach Typ
// unterschiedlich breit sind (Bomber/Elite bis 56px), der Rahmen aber fuer
// alle drei gleich gross bleiben soll.
const SELECTION_MARKER_SIZE = 66;

// Eigenes Schiff (game-spec.md 4.4 "Visuelle Umsetzung" Punkt 1) -- feste
// Position in derselben Formations-Spalte, dient als Ausgangspunkt fuer den
// Schuss-Effekt und als Ziel, wenn ein Bomber trifft.
const SHIP_POSITION = { x: FORMATION_ORIGIN.x, y: 370 };

const STAR_COUNT = 80;

// --- Sprite-/Textur-Set (game-spec.md 4.4 "Visuelle Umsetzung", zweite ------
// Playtest-Korrektur 2026-07-11; CLAUDE.md "Ausnahme Automat 3") ------------
// Bewusste, eng auf diesen Automaten begrenzte Ausnahme von der Primitive-
// Only-Regel: Spielerschiff, Schuss-/Laser-Effekt, Explosion und drei Gegner-
// Silhouetten (Scout/Bomber/Elite). Technik-Entscheidung: Texturen werden zur
// LAUFZEIT aus Phaser-Graphics-Polygonen gebacken (this.make.graphics(...)
// .generateTexture(...)), NICHT als mitgelieferte SVG-/Bild-Dateien -- so
// bleibt alles versioniertem TypeScript-Code (kein neuer Binaer-Asset-
// Ladepfad, kein Fehlerfall fuer fehlende Dateien) und laesst sich wie die
// bisherigen Graphics-Primitive direkt mit Werten aus machines.config.ts
// (Farben) parametrisieren. Alle Punktlisten sind bewusst so gewaehlt, dass
// ihre Bounding-Box exakt auf der Canvas-Mitte zentriert ist (siehe Kommentar
// an ensureTextures()) -- sonst wuerde `setOrigin(0.5)` das Sprite sichtbar
// neben der eigentlichen Formations-/Ziel-Position platzieren.
const TEX_SCOUT_SIZE = { width: 40, height: 44 };
const TEX_BOMBER_SIZE = { width: 56, height: 48 };
const TEX_ELITE_SIZE = { width: 56, height: 48 };
const TEX_SHIP_SIZE = { width: 48, height: 56 };
const TEX_LASER_SIZE = { width: 64, height: 16 };
const TEX_EXPLOSION_SIZE = { width: 72, height: 72 };

// Schlanke, kleine Silhouette -- haeufigster, schwaechster Gegnertyp.
const SCOUT_POINTS: Phaser.Types.Math.Vector2Like[] = [
    { x: 20, y: 4 },
    { x: 34, y: 40 },
    { x: 20, y: 30 },
    { x: 6, y: 40 },
];
// Boxige, breite Silhouette mit stumpfer Nase -- robuster Flaechenangriff-Typ.
const BOMBER_POINTS: Phaser.Types.Math.Vector2Like[] = [
    { x: 20, y: 4 },
    { x: 36, y: 4 },
    { x: 36, y: 14 },
    { x: 52, y: 24 },
    { x: 36, y: 34 },
    { x: 36, y: 44 },
    { x: 20, y: 44 },
    { x: 20, y: 34 },
    { x: 4, y: 24 },
    { x: 20, y: 14 },
];
// Angulare Pfeilform mit weit ausgestellten Fluegeln und Heckspitze -- selten,
// wertvoll, evasiv.
const ELITE_POINTS: Phaser.Types.Math.Vector2Like[] = [
    { x: 28, y: 4 },
    { x: 34, y: 20 },
    { x: 52, y: 32 },
    { x: 30, y: 26 },
    { x: 28, y: 44 },
    { x: 26, y: 26 },
    { x: 4, y: 32 },
    { x: 22, y: 20 },
];
// Interzeptor-Silhouette mit Doppelheck -- unterscheidet sich bewusst von
// allen drei Gegnerformen.
const SHIP_POINTS: Phaser.Types.Math.Vector2Like[] = [
    { x: 24, y: 4 },
    { x: 36, y: 26 },
    { x: 28, y: 38 },
    { x: 32, y: 52 },
    { x: 16, y: 52 },
    { x: 20, y: 38 },
    { x: 12, y: 26 },
];

const ENEMY_TEXTURE_KEYS: Readonly<Record<'scout' | 'bomber' | 'elite', string>> = {
    scout: 'bb-scout',
    bomber: 'bb-bomber',
    elite: 'bb-elite',
};

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
    // Statisches Spielerschiff (game-spec.md 4.4 "Visuelle Umsetzung" Punkt 1)
    // -- bleibt ueber die gesamte Szenen-Lebensdauer bestehen, wird NICHT ueber
    // clearDynamic() entfernt, nur kurz angeflackert bei einem Bomber-Treffer.
    private shipShape!: Phaser.GameObjects.Image;

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
        this.ensureTextures();
        this.cameras.main.setBackgroundColor(0x101018);
        this.renderStarfield();

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
        this.renderShip();

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

    // --- Weltraum-Kulisse + Schiff (einmalig, game-spec.md 4.4 -------------
    // "Visuelle Umsetzung" Punkte 1+4) ---------------------------------------

    private renderStarfield(): void {
        for (let i = 0; i < STAR_COUNT; i += 1) {
            const x = Math.random() * 1024;
            const y = Math.random() * 768;
            const radius = 0.6 + Math.random() * 1.8;
            const brightness = 0.25 + Math.random() * 0.65;
            this.add.circle(x, y, radius, 0xffffff).setAlpha(brightness);
        }
    }

    private renderShip(): void {
        const { x, y } = SHIP_POSITION;
        this.shipShape = this.add.image(x, y, 'bb-ship').setOrigin(0.5);
    }

    // --- Sprite-/Textur-Erzeugung (siehe Kommentar beim Sprite-Set oben) -----

    // Baeckt alle sechs Texturen genau EINMAL pro Game-Instanz -- der Guard
    // ueber `textures.exists()` verhindert erneutes Backen bei jedem Szenen-
    // Neustart (neuer Lauf/Automat-Wechsel-und-zurueck erzeugt dieselbe Szene
    // wiederholt, die Phaser-TextureManager-Registry ueberlebt das aber).
    private ensureTextures(): void {
        if (this.textures.exists('bb-ship')) return;
        this.bakeSilhouette('bb-scout', SCOUT_POINTS, TEX_SCOUT_SIZE);
        this.bakeSilhouette('bb-bomber', BOMBER_POINTS, TEX_BOMBER_SIZE);
        this.bakeSilhouette('bb-elite', ELITE_POINTS, TEX_ELITE_SIZE);
        this.bakeShipTexture();
        this.bakeLaserTexture();
        this.bakeExplosionTexture();
    }

    // Neutrale weisse Silhouette mit schwarzem Rand -- wird beim Platzieren
    // per setTint(getEnemyTypeColor(...)) eingefaerbt. Tint ist multiplikativ,
    // der schwarze Rand (0x000000 * jede Farbe = 0x000000) bleibt dabei immer
    // schwarz, exakt wie zuvor die feste `.setStrokeStyle(2, 0x000000)` auf
    // den Primitive-Shapes.
    private bakeSilhouette(key: string, points: Phaser.Types.Math.Vector2Like[], size: { width: number; height: number }): void {
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffffff, 1);
        g.fillPoints(points, true);
        g.lineStyle(2, 0x000000, 0.85);
        g.strokePoints(points, true, true);
        g.generateTexture(key, size.width, size.height);
        g.destroy();
    }

    private bakeShipTexture(): void {
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        // Triebwerks-Glow zuerst (liegt hinter dem Rumpf).
        g.fillStyle(0x4fd1ff, 0.55);
        g.fillEllipse(24, 48, 16, 14);
        g.fillStyle(0xdcdcdc, 1);
        g.fillPoints(SHIP_POINTS, true);
        g.lineStyle(2, 0x4fd1ff, 1);
        g.strokePoints(SHIP_POINTS, true, true);
        g.generateTexture('bb-ship', TEX_SHIP_SIZE.width, TEX_SHIP_SIZE.height);
        g.destroy();
    }

    // Neutraler, weisser Leucht-Bolzen (drei ueberlagerte Ellipsen fuer einen
    // weichen Glow-zu-Kern-Verlauf) -- wird pro Gefechts-Ausgang unterschied-
    // lich eingefaerbt (siehe fireShotLine()) und beim Platzieren per
    // setDisplaySize() auf die tatsaechliche Schuss-Distanz gestreckt.
    private bakeLaserTexture(): void {
        const { width, height } = TEX_LASER_SIZE;
        const cx = width / 2;
        const cy = height / 2;
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffffff, 0.25);
        g.fillEllipse(cx, cy, width - 4, height - 2);
        g.fillStyle(0xffffff, 0.6);
        g.fillEllipse(cx, cy, width - 20, height - 8);
        g.fillStyle(0xffffff, 1);
        g.fillEllipse(cx, cy, width - 38, height - 12);
        g.generateTexture('bb-laser', width, height);
        g.destroy();
    }

    // Sternfoermiger Blitz (Glow-Kreis + gezackter Burst + hell gluehender
    // Kern) -- nur fuer den "zerstoert"-Fall, daher bereits fest eingefaerbt
    // statt neutral+tintbar.
    private bakeExplosionTexture(): void {
        const { width } = TEX_EXPLOSION_SIZE;
        const center = width / 2;
        const g = this.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffd700, 0.35);
        g.fillCircle(center, center, center - 2);
        const spikePoints: Phaser.Types.Math.Vector2Like[] = [];
        const spikeCount = 10;
        for (let i = 0; i < spikeCount * 2; i += 1) {
            const radius = i % 2 === 0 ? center - 10 : center - 24;
            const angle = (Math.PI * i) / spikeCount;
            spikePoints.push({ x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius });
        }
        g.fillStyle(0xffffff, 0.9);
        g.fillPoints(spikePoints, true);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(center, center, 8);
        g.generateTexture('bb-explosion', width, width);
        g.destroy();
    }

    // --- Statische Legende (einmalig, game-spec.md 4.4 + CLAUDE.md ---------
    // Barrierefreiheits-Grundsatz: Form/Symbol UND Farbe, nie Farbe allein) --

    private renderLegend(): void {
        const x = 720;
        let y = 150;
        this.add.text(x, y, 'Gegner:', { fontFamily: 'Arial', fontSize: 13, color: '#999999' });
        y += 24;

        this.add.image(x + 10, y, 'bb-scout').setTint(getEnemyTypeColor('scout')).setDisplaySize(20, 22);
        this.add.text(x + 10, y, getEnemyTypeLabel('scout'), { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.add.text(x + 26, y, 'Scout (schlank, zuverlaessig getroffen)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 24;

        this.add.image(x + 10, y, 'bb-bomber').setTint(getEnemyTypeColor('bomber')).setDisplaySize(22, 19);
        this.add.text(x + 10, y, getEnemyTypeLabel('bomber'), { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.add.text(x + 26, y, 'Bomber (boxig, blinkt vor Feuern)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
        y += 24;

        this.add.image(x + 10, y, 'bb-elite').setTint(getEnemyTypeColor('elite')).setDisplaySize(22, 19);
        this.add.text(x + 10, y, getEnemyTypeLabel('elite'), { fontFamily: 'Arial Black', fontSize: 9, color: '#000000' }).setOrigin(0.5);
        this.add.text(x + 26, y, 'Elite (Pfeilform, evasiv)', { fontFamily: 'Arial', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5);
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

    // Space-Invaders-artiges Raster statt flacher Reihe (siehe Kommentar bei
    // FORMATION_ORIGIN oben) -- fuellt Zeilen der Reihe nach, letzte Zeile wird
    // eigenstaendig zentriert, falls sie nicht komplett gefuellt ist.
    private formationPosition(index: number, count: number): { x: number; y: number } {
        const columns = Math.min(FORMATION_MAX_COLUMNS, count);
        const rows = Math.ceil(count / columns);
        const row = Math.floor(index / columns);
        const col = index % columns;
        const itemsInRow = row === rows - 1 ? count - columns * (rows - 1) : columns;
        const rowStartX = FORMATION_ORIGIN.x - ((itemsInRow - 1) * FORMATION_COL_SPACING) / 2;
        return {
            x: rowStartX + col * FORMATION_COL_SPACING,
            y: FORMATION_ORIGIN.y + row * FORMATION_ROW_SPACING,
        };
    }

    private drawEnemyIcon(x: number, y: number, type: 'scout' | 'bomber' | 'elite', dimmed: boolean): Phaser.GameObjects.Image {
        const color = getEnemyTypeColor(type);
        const alpha = dimmed ? 0.35 : 1;
        const image = this.add.image(x, y, ENEMY_TEXTURE_KEYS[type]).setTint(color).setAlpha(alpha);
        this.dynamicObjects.push(image);
        const label = this.add
            .text(x, y, getEnemyTypeLabel(type), { fontFamily: 'Arial Black', fontSize: 12, color: '#000000' })
            .setOrigin(0.5)
            .setAlpha(alpha);
        this.dynamicObjects.push(label);
        return image;
    }

    private renderRoster(): void {
        if (!this.engine) return;
        const roster = this.engine.getRoster();
        const currentIndex = this.engine.getCurrentEncounterIndex();

        roster.forEach((type, index) => {
            const { x, y } = this.formationPosition(index, roster.length);
            const isCurrent = index === currentIndex;
            const shape = this.drawEnemyIcon(x, y, type, index < currentIndex);

            if (isCurrent) {
                const marker = this.add
                    .rectangle(x, y, SELECTION_MARKER_SIZE, SELECTION_MARKER_SIZE)
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

    // --- Kampf-Feedback pro Gefecht (game-spec.md 4.4 "Visuelle Umsetzung" -
    // Punkt 3) -- ausgeloest von runLoop() direkt NACH renderPhase(), damit
    // formationPosition() denselben Index/Count-Stand nutzt wie die gerade neu
    // gezeichneten (bereits abgedunkelten) Roster-Icons. Alle erzeugten
    // Objekte/Tweens landen in dynamicObjects/dynamicTweens und werden von der
    // naechsten renderPhase()-clearDynamic() wieder entfernt -- bewusst KEINE
    // eigene Aufraeum-Logik noetig.

    // Laser-Sprite statt Linien-Primitiv (game-spec.md 4.4 "Schuss-/Laser-
    // Effekt") -- auf die Schuss-Distanz gestreckt (setDisplaySize) und um den
    // Schusswinkel rotiert, dieselbe neutrale Textur wird per Tint pro
    // Gefechts-Ausgang unterschiedlich eingefaerbt (aufgerufen mit Gold/Rot/
    // Silber, siehe playCombatEffect()).
    private fireShotLine(from: { x: number; y: number }, to: { x: number; y: number }, color: number): void {
        const angle = Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y);
        const distance = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
        const bolt = this.add
            .image((from.x + to.x) / 2, (from.y + to.y) / 2, 'bb-laser')
            .setTint(color)
            .setRotation(angle)
            .setDisplaySize(Math.max(distance, TEX_LASER_SIZE.width), TEX_LASER_SIZE.height);
        this.dynamicObjects.push(bolt);
        const tween = this.tweens.add({ targets: bolt, alpha: 0, duration: 450, delay: 120 });
        this.dynamicTweens.push(tween);
    }

    // "Zerstoert" -- Explosions-Sprite (game-spec.md 4.4) + expandierender
    // Ring, farblich UND formal (gefuellter Burst vs. reiner Ring) unter-
    // scheidbar vom Ausweich-Effekt unten.
    private spawnExplosion(pos: { x: number; y: number }): void {
        const burst = this.add.image(pos.x, pos.y, 'bb-explosion').setScale(0.5);
        const ring = this.add.circle(pos.x, pos.y, 10).setStrokeStyle(3, 0xffd700);
        this.dynamicObjects.push(burst, ring);
        const burstTween = this.tweens.add({ targets: burst, scale: 1.5, alpha: 0, duration: 400 });
        const ringTween = this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 450 });
        this.dynamicTweens.push(burstTween, ringTween);
    }

    // "Bomber trifft" -- Einschlag-Burst am Schiff plus kurzes Anflackern des
    // Schiffs selbst (Schiff bleibt bestehen, nur ein sichtbarer Treffer).
    // Flacker-Dauer bewusst deutlich unter WAVE_TRANSITION_MS gehalten, damit
    // sie sicher durchlaeuft, bevor die naechste clearDynamic() sie stoppt.
    private spawnShipHitFlash(): void {
        const burst = this.add.circle(SHIP_POSITION.x, SHIP_POSITION.y, 14, 0xff3333).setAlpha(0.85);
        this.dynamicObjects.push(burst);
        const burstTween = this.tweens.add({ targets: burst, scale: 2.2, alpha: 0, duration: 400 });
        this.dynamicTweens.push(burstTween);
        const shipTween = this.tweens.add({
            targets: this.shipShape,
            alpha: 0.25,
            duration: 90,
            yoyo: true,
            repeat: 1,
        });
        this.dynamicTweens.push(shipTween);
    }

    // "Elite entkommt"/Angriff ausgewichen -- reiner, kuehler Ring OHNE
    // Fuellung, bewusst deutlich von der Explosion (gefuellter Blitz) und dem
    // Treffer-Burst (am Schiff, nicht am Ziel) unterscheidbar.
    private spawnEscapeRing(pos: { x: number; y: number }): void {
        const ring = this.add.circle(pos.x, pos.y, 12).setStrokeStyle(3, 0xaad4ff);
        this.dynamicObjects.push(ring);
        const tween = this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 500 });
        this.dynamicTweens.push(tween);
    }

    private playCombatEffect(result: ReturnType<BoostBarrageEngine['resolveNextEncounter']>, rosterLength: number): void {
        const target = this.formationPosition(result.encounterIndex, rosterLength);

        if (result.destroyed) {
            this.fireShotLine(SHIP_POSITION, target, 0xffe066);
            this.spawnExplosion(target);
        } else if (result.payout < 0) {
            this.fireShotLine(target, SHIP_POSITION, 0xff5555);
            this.spawnShipHitFlash();
        } else {
            this.fireShotLine(SHIP_POSITION, target, 0x9fb4c7);
            this.spawnEscapeRing(target);
        }
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
            const rosterLength = engine.getRoster().length;
            const result = engine.resolveNextEncounter();
            this.applyEncounterResult(result);
            this.renderPhase();
            this.playCombatEffect(result, rosterLength);
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
