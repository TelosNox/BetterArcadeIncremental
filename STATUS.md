# STATUS.md

Wird nach jeder abgeschlossenen Phase aktualiziert. Einzige Quelle der Wahrheit für "wo stehen wir gerade" über Tool-/Session-Grenzen hinweg (Claude Code, Cowork, neue Chats).

## Aktueller Stand

**Zuletzt abgeschlossen:** Phase 3 (Automat 1 vertikaler Vollschnitt, "Greed Run") — inkl. Nacharbeit zum Blocker "Spec-Abweichung" (siehe Notizen unten)
**Läuft/als Nächstes:** Phase 4 (Reveal + Hallen-Grundgerüst)

## Verlauf

- [x] Phase 0 — Projekt-Setup — abgenommen
- [x] Phase 1 — Engine-Kern ohne UI — abgenommen (EconomyStore, SaveSystem, events.ts; 40 Vitest-Tests grün, Lint sauber, Build ok)
- [x] Phase 2 — PatternEngine + PushYourLuckEngine — abgenommen (39 neue Vitest-Tests grün, 79 Tests insgesamt, Lint + `tsc --noEmit` sauber)
- [x] Phase 3 — Automat 1 vertikaler Vollschnitt ("Greed Run") — abgenommen (Blocker unten aufgelöst)
- [ ] Phase 4 — Reveal + Hallen-Grundgerüst
- [ ] Phase 5 — Attendant-System
- [ ] Phase 6 — Automaten 2–4
- [ ] Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback
- [ ] Phase 8 — Politur / Juice
- [ ] Phase 9 — Abschluss-Erlebnis

## Offene Design-Fragen (noch nicht final entschieden)

- ~~Welcher Automat startet Layer 0~~ — entschieden: "Greed Run" (Automat 1), siehe game-spec.md Abschnitt 6
- Exakte Zahlenbalance (Payout-Tabellen, Schwellenwerte) — wird iterativ während Implementierung/Playtesting getunt

## BLOCKER: Phase 3 Spec-Abweichung — AUFGELÖST (2026-07-09)

~~Im Spiel gibt es zwar eine Muster-Prognose-Anzeige (`getVisibleDistribution`), aber
sie ist wirkungslos: `MachineScene.runQueueStep` sampled den Musterzustand nur zur
Anzeige/Feedback-Text, die tatsächliche Erfolg/Fehlschlag-Entscheidung kommt
ausschließlich aus `PushYourLuckRun.resolveAction(tier)`, die nur mit der fest
angezeigten `tier.failureChance` würfelt — komplett unabhängig vom Musterzustand.~~

**Fix:** Neue reine Funktion `getEffectiveFailureChance(tier, states, currentState, sensitivity)`
in `src/data/machines.config.ts` (nicht in den Engines — siehe Begründung unten).
`MachineScene.runQueueStep` sampled den Musterzustand jetzt VOR dem Aufruf von
`resolveAction`, berechnet daraus die effektive failureChance und ruft
`resolveAction` mit einer abgeleiteten Kopie der RiskTier auf (`{ ...tier,
failureChance: effective }`) — die Engine-Klasse `resolveAction()` selbst bleibt
unverändert und weiß nichts von `PatternEngine`. `PatternEngine`/`PushYourLuckEngine`
kennen sich weiterhin nicht gegenseitig (Architektur-Kurzregel CLAUDE.md); die
Verzahnung ist reine MachineScene-/Data-Layer-Logik.

Mechanik: `pattern.states` ist jetzt als Danger-Achse von sicher (Index 0) nach
gefährlich (letzter Index) definiert (Konvention, dokumentiert in `machines.config.ts`).
`getEffectiveFailureChance` verschiebt `tier.failureChance` um `(dangerFactor - 0.5) *
PATTERN_RISK_SENSITIVITY` (Sensitivity = 0.25, dangerFactor = index/(n-1)), geklemmt
auf [0, 1]. Ausnahme: `failureChance === 0` ("safe") bleibt IMMER exakt 0, unabhängig
vom Muster — sonst gäbe es keine garantiert risikofreie Aktion mehr und der
Trade-off-Check wäre verletzt.

Trade-off-Check (design-toolbox.md Punkt 5), jetzt MIT Musterzustand-Einfluss:

| Tier | fern (eff.) | nah (eff.) | alarm (eff.) | EV fern | EV nah | EV alarm |
|---|---|---|---|---|---|---|
| safe | 0% | 0% | 0% | 3.0 | 3.0 | 3.0 |
| balanced | 2.5% | 15% | 27.5% | 7.8 | 6.8 | 5.8 |
| risky | 22.5% | 35% | 47.5% | 13.95 | 11.7 | 9.45 |

Innerhalb jedes einzelnen Musterzustands gilt weiterhin streng safe < balanced <
risky bei EV UND Risiko (kein Tier dominiert ein anderes) — geprüft zusätzlich per
Vitest (`machines.config.test.ts`, Test "haelt fuer jeden Musterzustand die
Reihenfolge safe < balanced < risky ein"). Neu gegenüber der ursprünglichen Phase-3-
Version: der Musterzustand ist jetzt ein zweiter, aus der Prognose lernbarer
Faktor für die Sicher-vs-Riskant-Entscheidung — "risky" bei "fern" spielen (EV 13.95,
22.5% Fangchance) ist spürbar besser als "risky" bei "alarm" spielen (EV 9.45, 47.5%
Fangchance), die Prognose-Anzeige hat dadurch echten strategischen Wert
(design-toolbox.md 1.10), statt wirkungslose Deko zu sein.

Transparenz (Baukasten 1.11, sichtbares statt verstecktes Risiko): Die Risiko-Tier-
Buttons zeigen jetzt die EFFEKTIVE Fangchance für den aktuellen Musterzustand plus
Basis-Wert und Musterzustand als Begründung (z. B. "Fangchance 28% (Basis 15%,
Muster 'alarm')"), nicht nur die statische Basis-Zahl. Die Fangchance gilt
garantiert nur für den nächsten ausgeführten Schritt (das Muster bewegt sich
während der Ausführung weiter, siehe game-spec.md 4.2 "nur der nächste Schritt ist
vorhersagbar") — das ist eine bewusste Grenze, keine versteckte Varianz: tiefere
Vorschau kommt erst mit Sichtbarkeits-Upgrades (Phase 7).

Manuell im Browser nachgeprüft (Playwright gegen `npm run dev`): Bei Musterzustand
"fern" zeigten die Buttons balanced 2%/risky 22% (Rundungsartefakt durch
Gleitkomma-Subtraktion, korrekte Wahrscheinlichkeit ist 2.5%/22.5%), bei "alarm"
balanced 28%/risky 48% (korrekt 27.5%/47.5%) — die Zahl ändert sich sichtbar mit
dem Musterzustand, safe blieb konstant bei 0% ("musterunabhängig"). Neue Tests:
`src/data/machines.config.test.ts` (12 Tests für `getEffectiveFailureChance`,
u. a. Monotonie pro Zustand, Clamping, safe-Invarianz, unbekannter/einzelner
Zustand). `npm test` (91/91 grün), `npm run lint`, `npx tsc --noEmit` sauber.

## Notizen für den nächsten Agenten

Phase 1 war bei Übernahme dieser Session bereits im Code/Git fertig, aber STATUS.md war nicht aktualisiert worden — nachgeholt. `node_modules` im Projektordner ist Windows-spezifisch installiert (win32-Binaries); `npm install` dort nicht erneut ausführen, sonst können die nativen Bindings auf Windows kaputtgehen. `npm test`/`npm run lint`/`npx tsc --noEmit` liefen in dieser Session direkt im Projektordner (node_modules war bereits vorhanden) problemlos.

**Phase 2 (abgeschlossen):** `src/engine/PatternEngine.ts` (Markov-Übergänge über `PatternConfig`, Validierung der Übergangssummen auf 1, `getVisibility`/`getVisibleDistribution` für progressive Teilaufdeckung — aufgedeckt wird die Verteilung, nicht das exakte nächste Ereignis, `sampleNext` mit injizierbarem `rng`) und `src/engine/PushYourLuckEngine.ts` (`PushYourLuckRun`: `resolveAction` gegen `RiskTier`, Meilenstein-Auswertung über `Milestone[]`, `bank()`/`canBank()`). Design-Entscheidung, die für Phase 3 relevant ist: Ein Fehlschlag (`resolveAction` mit `success: false`) setzt den Punktestand des laufenden Runs komplett auf 0 zurück (kein Teilschutz) — Banking ist der einzige Weg, Punkte zu sichern. Ob safe/balanced/risky pro Automat einen echten EV/Varianz-Trade-off ergeben (Baukasten Checkliste Punkt 5), muss beim Befüllen von `machines.config.ts` in Phase 3 sichergestellt werden, die Engine selbst prüft das nicht.

Bei Beginn von Phase 3: siehe `implementation-plan.md` Abschnitt 4 (`MachineScene.ts` generisch, erste Konfiguration für "Greed Run" in `src/data/machines.config.ts`, Layer-0-Erlebnis ohne Hallen-UI). PatternEngine/PushYourLuckEngine sind fertig und einsatzbereit, aber noch nicht an Phaser/React angebunden.

**Phase 3 (abgeschlossen):** `src/data/machines.config.ts` (Config `GREED_RUN`, id `greed-run`, `entryPoint: true`), `src/game/scenes/MachineScene.ts` (eine generische Szene, liest nur Config), `src/game/economy.ts` (Bruecke: haelt die eine `EconomyStore`-Instanz der Session, laedt/speichert ueber `SaveSystem`). Alter Phaser-Template-Boilerplate entfernt: `MainMenu.ts`, `Game.ts`, `GameOver.ts`, `Preloader.ts` sowie `TestCounter.tsx` geloescht, `Boot.ts` startet jetzt direkt `MachineScene` mit der `entryPoint`-Machine, `App.tsx` mountet nur noch `<PhaserGame />` (kein Demo-UI, kein Hallen-HUD).

Rundenstruktur-Design (generisch für alle 4 Automaten, nicht Greed-Run-spezifisch): Planungsphase = Spieler queued bis zu 6 Risiko-Tokens (safe/balanced/risky); Ausführungsphase spielt die Queue automatisch mit 700ms-Delay pro Schritt ab (kein Input möglich); pro Schritt sample ich zunächst den nächsten Musterzustand via `PatternEngine.sampleNext`, berechne daraus die effektive failureChance (`getEffectiveFailureChance`, siehe aufgelöster Blocker oben) und rufe erst DANN `PushYourLuckRun.resolveAction` mit einer daraus abgeleiteten RiskTier-Kopie auf (Engine-Klassen selbst unverändert, nur konsumiert). Die sichtbare Prognose (`getVisibleDistribution`) zeigt wie in der Engine vorgesehen nur den nächsten Schritt, nicht die ganze Route — passt exakt zu game-spec.md 4.2 ("Patrouillenrouten... nur teilweise sichtbar (nächster Schritt)"). Kausalitäts-Feedback bei Fehlschlag zitiert den beobachteten Musterzustand + die tatsächlich verwendete (musterabhängige) Fangchance (z. B. `Fehlschlag bei "risky" (Fangchance 48% – Muster stand auf "alarm") – der Zug kam zu früh.`). `upgradeLevel` ist in der Szene aktuell fest auf 0 (Sichtbarkeits-Upgrades werden erst als Hallen-Upgrade in Phase 7 kaufbar); `UpgradeDef[]` in der Config ist deshalb bewusst leer.

Trade-off-Check (design-toolbox.md Punkt 5) für die RiskTiers von "Greed Run": ursprünglich nur mit der statischen `failureChance` gerechnet (EV safe/balanced/risky = 3,0/6,8/11,7 bei 0%/15%/35%) — das war unvollständig, siehe aufgelöster Blocker oben für die aktuelle, musterzustandsabhängige Version der Tabelle (jetzt die maßgebliche).

Manuell im Browser verifiziert (Playwright-Treiberskript gegen `npm run dev`, Screenshots geprüft): Planung → Queue → animierte Ausführung mit Kausalitäts-Feedback bei Erfolg und Fehlschlag → Meilenstein-Entscheidung (Banking vs. Weitermachen) → Bust-Screen mit Neustart → finaler Checkpoint (Score 108 bei deterministischem Safe-Spam) löst `completed`-Screen aus, `economyStore.markMachineCompleted('greed-run')` wird gesetzt, und nach "Sichern & beenden" steht `ticketsByMachine.greed-run: "108"` korrekt im `localStorage`-Speicherstand. `npm test` (79/79 grün), `npm run lint` und `npx tsc --noEmit` laufen sauber, `npm run build-nolog` erfolgreich.

Offene Punkte für spätere Phasen, keine Blocker für Phase 3: Zahlenbalance (Payouts/Meilenstein-Schwellen) ist Platzhalter und wird laut game-spec.md Abschnitt 6 iterativ getunt; visuelle Politur (Phase 8) fehlt komplett (nur Phaser-Primitives); Score-Attack-Modus ist aktuell nur "gleiche Config nochmal spielen", kein eigenes High-Score-Tracking.
