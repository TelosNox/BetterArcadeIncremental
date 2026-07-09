# STATUS.md

Wird nach jeder abgeschlossenen Phase aktualiziert. Einzige Quelle der Wahrheit für "wo stehen wir gerade" über Tool-/Session-Grenzen hinweg (Claude Code, Cowork, neue Chats).

## Aktueller Stand

**Zuletzt abgeschlossen:** Phase 6 (Automaten 2–4: Trap Tunnels, Beat Ledger, Champion's Ledger)
**Läuft/als Nächstes:** WARTET AUF PM-REVIEW (siehe Abschnitt "PM-Review: Phase 4–6" unten). Ab Phase 7 gilt die normale CLAUDE.md-Regel wieder (anhalten nach jeder Phase) — siehe "Workflow-Abweichung" unten.

## Verlauf

- [x] Phase 0 — Projekt-Setup — abgenommen
- [x] Phase 1 — Engine-Kern ohne UI — abgenommen (EconomyStore, SaveSystem, events.ts; 40 Vitest-Tests grün, Lint sauber, Build ok)
- [x] Phase 2 — PatternEngine + PushYourLuckEngine — abgenommen (39 neue Vitest-Tests grün, 79 Tests insgesamt, Lint + `tsc --noEmit` sauber)
- [x] Phase 3 — Automat 1 vertikaler Vollschnitt ("Greed Run") — abgenommen (Blocker unten aufgelöst)
- [x] Phase 4 — Reveal + Hallen-Grundgerüst — Code steht, Tests/Build grün, verifiziert; wartet auf PM-Review
- [x] Phase 5 — Attendant-System — Code steht, Tests/Build grün, verifiziert; wartet auf PM-Review
- [x] Phase 6 — Automaten 2–4 — Code steht, Tests/Build grün, verifiziert; wartet auf PM-Review
- [ ] Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback
- [ ] Phase 8 — Politur / Juice
- [ ] Phase 9 — Abschluss-Erlebnis

## Workflow-Abweichung von CLAUDE.md (mit Nutzer abgestimmt, 2026-07-09)

Bis einschließlich Phase 6 gibt es für den Nutzer kaum sinnvoll manuell
testbare Ergebnisse (echte Upgrades/Cross-Layer-Feedback kommen erst in
Phase 7). Deshalb: Cowork (PM/Architekt-Rolle) prüft nach jeder Phase Spec-
Konformität, Architektur-Regeln und Tests/Build eigenständig und gibt bei
bestandener Prüfung den nächsten Claude-Code-Prompt direkt weiter, OHNE
jedes Mal auf explizites Nutzer-Go zu warten. Der Nutzer wird nur bei echten
Abweichungen (wie dem Phase-3-Blocker oben) oder offenen Design-Entscheidungen
einbezogen. Ab Phase 7 (erstes echtes Playtesting-Ergebnis für den Nutzer)
gilt die normale CLAUDE.md-Regel wieder: nach Phasenabschluss anhalten und
auf Rückmeldung warten.

## PM-Review: Phase 4–6 (2026-07-09)

Laut Workflow-Abweichung oben wurde nach Phase 4 und Phase 5 NICHT angehalten,
sondern direkt weitergearbeitet. Hier die Gesamtzusammenfassung aller drei
Phasen für die PM-Review. Alle drei liefen durch dieselbe Verifikationskette:
`npm test` / `npm run lint` / `npx tsc --noEmit` / `npm run build-nolog`
grün, plus manuelle Playwright-Treiberskripte gegen `npm run dev` mit
Screenshots (nicht Teil des Repos, nur zur Verifikation in der Session
verwendet). Aktueller Testcount: **128 Vitest-Tests, alle grün.**

### Phase 4 — Reveal + Hallen-Grundgerüst

**Design-Entscheidung (von dir als PM festgelegt, hier dokumentiert):**
Der Durchbruch aus game-spec.md Abschnitt 2 (dort als "TBD, Richtwert
10-20 Minuten" offengelassen) wird NICHT über eine neue Zeitmessung
ausgelöst, sondern ist ein und dasselbe Ereignis wie das Abschluss-Kriterium
aus game-spec.md 4.1 (erstmaliges Durchspielen von Automat 1). Umgesetzt in
`MachineScene.finishExecution()`: bei der ERSTEN Erreichung des letzten
Meilensteins für den `entryPoint`-Automaten wird der Lauf automatisch
gebankt und direkt `TransitionScene` gestartet, statt die normale
Banking/Score-Attack-Entscheidung anzuzeigen (die gibt es für Automat 2-4
weiterhin normal, siehe Phase 6).

**Neu:** `src/game/scenes/TransitionScene.ts` (Kamerazoom + Fade-Text
"Ein Blick hinter die Fassade...", ~2.2s, reine Phaser-Primitives), Reveal
wird via `EventBus.emit('hall-reveal')` an React gemeldet.
`src/ui/HallHub.tsx` (React, `/src/ui` wie in implementation-plan.md
vorgesehen): zeigt freigeschaltete Automaten, Credits, Rückkehr-Button.
`App.tsx` haelt jetzt einen `view`-State (`'machine' | 'hall'`) und rendert
`HallHub` als volldeckendes Overlay ÜBER dem Phaser-Canvas (`.game-shell`
mit `position: relative`, `HallHub` `position: absolute; inset: 0`) --
Phaser laeuft dabei WEITER im Hintergrund (wichtig fuer Phase 5).

**Stolperfalle (gefunden + behoben):** `game.scene.start(key, data)` auf der
globalen Phaser-SceneManager-Instanz crasht ("Cannot read properties of
null"), wenn er von AUSSERHALB des Phaser-Update-Loops aufgerufen wird (hier:
ein React-Klick-Handler in `HallHub`) und die Zielszene bereits laeuft.
Fix: Der `'request-machine'`-Listener sitzt jetzt IN `MachineScene.create()`
und ruft `this.scene.start(...)` auf der eigenen, garantiert gueltigen
ScenePlugin-Instanz auf, statt global in `main.ts` auf `game.scene`.

**Verifiziert:** Erstdurchspielen von Greed Run loest sichtbar Transition ->
HallHub aus; Reload mit bereits abgeschlossenem Save landet direkt in der
Halle (kein Replay der Reveal-Sequenz, Baukasten 1.8); "Spielen" aus der
Halle wechselt zurueck zum Automaten ohne Fehler.

### Phase 5 — Attendant-System

**Neu:** `src/engine/AttendantEngine.ts` + `AttendantEngine.test.ts` (21
Tests, framework-unabhaengig). Zwei Stellschrauben, beide an "Musterkenntnis"
(0-1, gespeichert in EconomyStore, existierte bereits seit Phase 1) gekoppelt:
- **Effizienz** (`getAttendantEfficiency`): Payout bei Erfolg wird auf
  `ATTENDANT_MAX_EFFICIENCY (0.875) * knowledge` geklemmt -- game-spec.md 3.2
  Richtwert "85-90% der Bestleistung bei voller Musterkenntnis" exakt
  getroffen und per Test abgesichert.
- **Zusatzrisiko** (`getAttendantFailureChance`): bei niedriger
  Musterkenntnis ein Aufschlag auf die (musterzustandsabhaengige)
  failureChance, der bei voller Musterkenntnis auf 0 sinkt (Attendant
  faengt dann exakt die failureChance eines Spielers). "safe" bleibt
  fuer den Attendant immer risikofrei, wie fuer einen Spieler.
- `getAttendantTier()` leitet daraus (wie beim Phase-3-Blocker-Fix) nur eine
  abgeleitete RiskTier-Kopie ab -- `PushYourLuckEngine.resolveAction`
  selbst unveraendert, keine Kopplung von PatternEngine/PushYourLuckEngine
  aneinander.
- `chooseAttendantTier()`: einfache Strategie, waehlt Tier-Index proportional
  zur Musterkenntnis (sicherster Tier bei 0, riskantester bei voller
  Musterkenntnis).
- Musterkenntnis-Wachstum: `gainKnowledgeFromManualPlay` (+0.02/Aktion,
  primaer) vs. `gainKnowledgeFromTraining` (+0.01/Kauf, sekundaer/langsamer)
  -- game-spec.md 3.2 explizit gefordertes Verhaeltnis, per Test geprueft.

**MachineScene-Integration:** `runQueueStep`/`finishExecution` bekamen einen
`isAttendant`-Parameter. Manuelles Spielen erhoeht Musterkenntnis, Attendant-
Runs nicht (sonst Feedback-Loop-Risiko: Attendant spielt sich selbst besser).
Attendant trifft Meilenstein-/Bust-Entscheidungen unbeaufsichtigt immer sicher
(Bank statt weiterspielen). Ein wiederkehrender Timer (`ATTENDANT_TICK_INTERVAL_MS
= 1000`) startet automatisiert neue Runden, SOLANGE `attendantTicking === true`.

**`attendantTicking` haengt an `view` aus App.tsx** (`'hall'` = Attendant
aktiv, `'machine'` = pausiert -- Baukasten 1.3, aktives Spielen bleibt die
bewusste Wahl). Kommuniziert per `EventBus`-Event `'view-changed'`.

**Stolperfalle (gefunden + behoben):** Ein rein event-basierter Ansatz fuer
den Anfangszustand von `attendantTicking` hat eine Race Condition: React
(App.tsx, mountet sofort) kann `'view-changed'` emittieren, BEVOR Phaser
(bootet ueber eigenen rAF-Tick) die `MachineScene` ueberhaupt erzeugt und
ihren Listener registriert hat -- das erste Event geht dann spurlos verloren
(Phaser-EventEmitter puffert nichts), Attendant blieb dauerhaft inaktiv.
**Fix:** `src/game/viewState.ts`, eine minimale geteilte Zelle (kein
State-Speicher parallel zu EconomyStore -- dupliziert keine Wirtschafts-
daten, haelt nur das UI-Navigationsflag "welche Ansicht ist sichtbar").
Ihr Default wird SYNCHRON beim Modul-Laden aus `economyStore.isMachineCompleted(...)`
berechnet (dieselbe Regel wie zuvor in `App.tsx`), nicht erst reaktiv per
Event gesetzt. `MachineScene.create()` liest `getCurrentView()` direkt,
race-frei; das Event bleibt fuer alle SPÄTEREN Wechsel zustaendig.

**Bekannte, bewusste Lücke:** Der Trainings-Button in `AttendantPanel.tsx`
kostet Credits, aber die Tickets->Credits-Umrechnung ist laut
implementation-plan.md ein Hallen-Upgrade (Phase 7). Bis Phase 6 (siehe
unten) waren Credits daher permanent 0 und der Button entsprechend meist
deaktiviert -- kein Bug, sondern eine erwartete Konsequenz der
Phasenreihenfolge, jetzt durch die Phase-6-Platzhalterloesung entschärft.

**Verifiziert:** Mit hoher Musterkenntnis (0.9, per Save-Injection) erzeugte
der Attendant in der Halle **83.9 Tickets in 20s ohne einen einzigen Klick**;
nach Rueckwechsel zum Automaten blieb der Ticketstand exakt eingefroren
(0 neue Tickets in weiteren 5s) -- Automatisierung pausiert korrekt.
Training verifiziert: 25 Credits -> 15 Credits, Musterkenntnis 0.42 -> 0.43.

### Phase 6 — Automaten 2–4

**Neu in `machines.config.ts`:** `TRAP_TUNNELS` ("Trap Tunnels", Dig-Dug-
Twist), `BEAT_LEDGER` ("Beat Ledger", DDR-Twist), `CHAMPIONS_LEDGER`
("Champion's Ledger", Street-Fighter-Twist) -- alle `entryPoint: false`.
**Keine Code-Aenderung an `MachineScene.ts` noetig** -- die Szene war seit
Phase 3 tatsaechlich vollstaendig generisch, das war der Praxistest dafuer.

Trade-off-Check je Musterzustand fuer alle drei (Formel identisch zu Greed
Run, siehe Kommentare in `machines.config.ts`, automatisiert geprueft in
`machines.config.test.ts` per `it.each(MACHINES)` ueber alle 4 Automaten):

| Automat | Pattern-Philosophie (game-spec.md) | baseVisibility | Milestones |
|---|---|---|---|
| Trap Tunnels | "am wenigsten Zufall, nahezu vollstaendig ableitbar" | 0.8 (+0.2 Upgrade) | 25/60/120 |
| Beat Ledger | "von Anfang an bekannt wie Noten" | 1.0 (voll sichtbar, kein Upgrade noetig) | 30/70/140 |
| Champion's Ledger | komplexester/letzter Automat | 0.3 (+0.35+0.35 Upgrades) | 40/90/180 |

Fuer alle drei gilt je Musterzustand streng safe < balanced < risky bei EV
UND Risiko (kein Tier dominiert) -- exakte Zahlen als Kommentar in
`machines.config.ts`, automatisiert verifiziert.

**Bewusst NICHT abgebildet:** Champion's Ledger's "gelegentliche klar
angekündigte Spezialmoves" (game-spec.md 4.5) wurde als reine Fiktions-Farbe
ausgelassen, nicht als eigener Mechanismus. Eine "klare Ankündigung" wuerde
eine PRO-ZUSTAND-Sichtbarkeit in `PatternEngine` voraussetzen
(`getVisibility` ist aktuell global pro Upgrade-Level, nicht pro Zustand) --
das ist eine echte Engine-Luecke, kein Implementierungsdetail. Statt sie zu
umgehen oder die Engine dafuer zu erweitern, habe ich sie ausgelassen und
melde sie hiermit: falls "angekündigte Spezialmoves" mechanisch wichtig
sind, braucht `PatternEngine` eine neue Faehigkeit (z. B. `states` mit
individueller Sichtbarkeit), das waere ein Engine-Change und keine reine
Config-/Scene-Arbeit mehr.

**Freischalt-Logik + PLATZHALTER-Wirtschaft (bewusste Vorgriff-Entscheidung,
bitte gegenpruefen):** game-spec.md 3.3 verlangt "Automat 2 schaltet frei
nach Hallen-Upgrade-Schwelle X (basierend auf Credits aus Automat 1)". Genau
wie beim Attendant-Training in Phase 5 gilt: Credits sind ohne
IRGENDEINE Tickets->Credits-Umrechnung permanent 0, und ohne Credits waeren
Automat 2-4 fuer immer unerreichbar -- Phase 6 liesse sich dann nicht wie
gefordert durchspielen ("Alle 4 Automaten einzeln spielbar"). Deshalb, klar
als PROVISORISCH markiert (Kommentare in `machines.config.ts`/`HallHub.tsx`):
- `MACHINE_UNLOCK_COST` (`machines.config.ts`): feste Credit-Kosten pro
  Automat, steigend: trap-tunnels 50, beat-ledger 150, champions-ledger 400.
  Nutzt `economyStore.purchaseHallUpgrade()` (existierte bereits seit
  Phase 1, ungenutzt) fuer den eigentlichen Kauf.
- `HallHub.tsx`: fester Umrechnungskurs `TICKET_CONVERSION_RATE = 1` ueber
  einen neuen "In Credits umwandeln"-Button, nutzt
  `economyStore.convertTicketsToCredits()` (ebenfalls bereits seit Phase 1
  vorhanden).
Beides ist explizit als Uebergangsloesung dokumentiert und soll in Phase 7
durch das echte, konfigurierbare Hallen-Upgrade-System (`hall.config.ts`,
`UpgradePanel.tsx`) ersetzt werden (z. B. Umrechnungskurs selbst als
Upgrade, wie game-spec.md 3.1 es vorsieht). **Bitte als PM bestaetigen, dass
dieser Vorgriff so in Ordnung ist**, sonst muesste Phase 6 ohne echten
Freischalt-Test abgenommen werden.

**Verifiziert:** Mit 700 Credits (Save-Injection) alle drei Automaten nach-
einander freigeschaltet (700 -> 100 Credits, exakt 50+150+400 abgezogen);
alle vier Automaten-Karten korrekt in der Halle sichtbar/gesperrt; "Trap
Tunnels" gespielt -- Szene zeigt korrekt eigenen Namen, eigene
Musterzustaende (stabil/wackelig/einsturz) mit 85%/15%-Prognose (passend zu
baseVisibility 0.8) und die exakt konfigurierten Payout-/Fangchance-Werte;
Meilenstein-Erreichen bei Trap Tunnels zeigt korrekt die normale
Bank/Weitermachen-Entscheidung OHNE die grosse Reveal-Sequenz auszuloesen
(die ist `entryPoint`-exklusiv, Baukasten 1.8).

### Offene Punkte fuer spaetere Phasen (keine Blocker, nur Merkposten)

- Phase 7 muss die PLATZHALTER-Wirtschaft (Umrechnungskurs, Freischalt-
  Kosten) durch ein echtes `hall.config.ts`-Upgrade-System ersetzen.
- Attendant-Automatisierung laeuft aktuell nur fuer den GERADE AKTIVEN
  Automaten (ein einzelnes MachineScene-Objekt fuer alle 4 Automaten,
  Architektur-Kurzregel). "Mehrere Automaten gleichzeitig im Hintergrund"
  (impliziert von game-spec.md 3.1 fuer eine ausgereifte Idle-Erfahrung)
  ist damit noch nicht abgebildet -- Phase 5s Abnahmekriterium
  ("Automat 1 laeuft im Hintergrund weiter, waehrend der Spieler in der
  Halle ist") ist erfuellt, eine echte Mehrfach-Idle-Simulation waere aber
  ein groesseres architektonisches Thema fuer eine spaetere Phase.
- Champion's Ledger "angekündigte Spezialmoves" -- siehe oben, echte
  Engine-Luecke (pro-Zustand-Sichtbarkeit), aktuell nicht abgebildet.
- Score-Attack-Modus weiterhin nur "gleiche Config nochmal spielen", kein
  eigenes High-Score-Tracking (bereits aus Phase 3 bekannt).

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
