# STATUS.md

Wird nach jeder abgeschlossenen Phase aktualiziert. Einzige Quelle der Wahrheit für "wo stehen wir gerade" über Tool-/Session-Grenzen hinweg (Claude Code, Cowork, neue Chats).

## Aktueller Stand

**Zuletzt abgeschlossen:** Phase 7b (Kernmechanik-Revision) — Code steht, 185/185 Tests grün, Lint/Typecheck/Build grün, manuell gegen `npm run dev` verifiziert (siehe Ergebnis-Abschnitt unten). Separater BUG (Rückweg Automat→Halle) ebenfalls behoben.
**Läuft/als Nächstes:** Wartet auf Nutzer-Verifikation/Playtest der Revision. Danach Entscheidung: weiter mit Phase 8 (Politur) oder weitere Balance-Iteration auf Basis von Phase-7b-Feedback.

## BUG (behoben, 2026-07-09) — Rückweg Automat→Halle nach zweitem Durchlauf

**Ursache gefunden:** Es gab bis dahin GAR KEINEN manuellen Weg von einem
Automaten zurück in die Halle — nur das einmalige automatische Reveal
(`TransitionScene`) beim ERSTEN Durchspielen des entryPoint-Automaten setzte
`view` auf `'hall'`. Ein zweiter Durchlauf (Score-Attack) oder jeder Besuch
von Automat 2-4 endete deshalb zwangsläufig in einer Sackgasse — es war nie
ein Bug im `'request-machine'`-Listener, sondern ein von Anfang an fehlender
Rückweg, der nur beim allerersten Mal durch den automatischen Reveal
kaschiert wurde.

**Fix:** Neuer persistenter "Zur Halle"-Button in `MachineScene` (oben links,
`renderBackToHallButton()`, sichtbar sobald der entryPoint-Automat
durchgespielt ist — vorher gäbe es laut game-spec.md Abschnitt 2 noch keine
Meta-UI). Emittiert ein neues EventBus-Event `'return-to-hall'`, das
`App.tsx` genau wie `'hall-reveal'` behandelt (`setView('hall')`), OHNE die
laufende `MachineScene` zu beenden — der Automat läuft im Hintergrund weiter,
exakt wie beim Reveal-Übergang (Phase 5).

**Verifiziert (Playwright-Treiberskript gegen `npm run dev`):** Automat →
Zur Halle → Spielen (zweiter Durchlauf) → Zur Halle erneut — funktioniert
beide Male ohne Reload, keine Konsolenfehler.

## NEUE PHASE 7b: Kernmechanik-Revision (2026-07-09, mit Nutzer abgestimmt)

Nutzer-Playtest-Feedback zu Phase 3-7: die Muster-Vorschau ("Prognose") fühlte
sich wirkungslos an, weil sie nur eine Wahrscheinlichkeit anzeigt statt einer
konkreten, planbaren Entscheidung. Erwartungshaltung des Nutzers: ein festes
Pattern pro Run, von dem man den nächsten Zug sieht, plus zwei Aktionen, die
sich exakt kontern (schere-stein-papier-artig, aber nur EIN Konter-Paar, keine
volle Drei-Wege-Rotation), plus mehrere sicherere Zwischenstufen. Nach
Rückfrage folgende verbindliche Entscheidungen (siehe auch game-spec.md 4.1a
für die spielerseitige Beschreibung):

1. **Fixes Pattern pro Run:** Ganze Zug-Sequenz steht ab Run-Start fest
   (vorab durch wiederholtes `PatternEngine.sampleNext()` generiert und als
   Array eingefroren), nicht mehr live pro Schritt neu gewürfelt.
2. **Zwei harte Konter-Aktionen + mehrere Zwischenstufen:** Ersetzt das
   bisherige generische safe/balanced/risky-Dreiklang. Die zwei harten
   Aktionen sollen PRO AUTOMAT thematisch benannt werden (löst auch den
   vorherigen PM-Befund "alle vier Automaten fühlen sich gleich an").
3. **Auflösung ohne Engine-Änderung an PatternEngine:** Von den Pattern-
   Zuständen (aktuell 3 pro Automat) werden zwei als "Gegenstück zu harter
   Aktion X" bzw. "Gegenstück zu harter Aktion Y" deklariert, der/die
   übrigen als neutral. Harte Aktion scheitert NUR beim exakten eigenen
   Gegenstück-Zustand, trifft bei JEDEM anderen Zustand (auch beim
   Gegenstück der anderen harten Aktion und bei neutral). Zwischenstufen
   bleiben zustandsunabhängig (eigene feste Fangchance je Stufe, mehrere
   Abstufungen statt nur einer). `PatternEngine`-Klasse selbst bleibt
   unverändert (Rollenzuweisung ist Data-/Scene-Layer-Logik wie schon bei
   `getEffectiveFailureChance`); NUR die Interpretation von `getVisibility`
   ändert sich (Ergebnis wird jetzt als Anzahl vorausschaubarer Züge der
   FESTEN Sequenz interpretiert, nicht als Wahrscheinlichkeits-Reveal-Anteil
   der nächsten Transition).
4. **Fehlschlag = Teilstrafe, KEIN hartes Run-Ende mehr:** Das bisherige
   "busted"-Konzept (`PushYourLuckRun.resolveAction`: Fehlschlag → Status
   'busted', Score auf 0) entfällt. Stattdessen: Fehlschlag zieht einen Teil
   (Richtwert 30–50 %, iterativ zu tunen) des aktuellen, ungebankten
   Punktestands ab, der Run bleibt 'active' und läuft weiter. Das IST eine
   echte Aenderung an `PushYourLuckEngine` (nicht nur Data-Layer) —
   `resolveAction`s Fehlschlag-Semantik muss angepasst werden. Bestehende
   Tests in `PushYourLuckEngine.test.ts`, die das alte busted-Verhalten
   pruefen, muessen entsprechend aktualisiert werden (bewusste, gewollte
   Verhaltensaenderung, keine Regression).
5. **Automaten-interne Upgrades, bezahlt mit den EIGENEN Tickets des
   Automaten (nicht mit Hallen-Credits):** Neue Progression-Achse pro
   Automat — mehr Vorschau auf die feste Sequenz wird direkt mit den
   Tickets DIESES Automaten gekauft. Das erfordert eine neue
   `EconomyStore`-Faehigkeit (`spendTickets` o.ae., symmetrisch zu
   `spendCredits`, aber pro Automat) sowie eine neue Kaufoberflaeche
   (vermutlich in/bei `MachineScene`, nicht im hallenweiten
   `UpgradePanel.tsx` — das bleibt ausschliesslich fuer Hallen-Credits-
   Upgrades). `hall.config.ts`/`UpgradePanel.tsx` selbst bleiben
   unveraendert; dies ist eine PARALLELE, separate Wirtschaft pro
   Automat, keine Erweiterung der Hallen-Wirtschaft.

**Wichtig — Abweichung vom bisherigen Arbeitsmodus:** Bisher galt "Engines
(Phase 1+2) nicht veraendern, nur Data-/Scene-Layer". Fuer DIESE Phase ist das
ausdruecklich aufgehoben fuer `PushYourLuckEngine` (Punkt 4) und `EconomyStore`
(Punkt 5, neue Methode) -- beide Aenderungen sind hier bewusst angeordnet, kein
Abweichen von der Architektur-Kurzregel. `PatternEngine` selbst bleibt
unveraendert (Punkt 3). `AttendantEngine` muss an das neue Aktionsmodell
(harte Aktionen + Zwischenstufen statt generischer RiskTier-Skala) angepasst
werden -- wie der Attendant seine Aktionswahl trifft, ist Teil dieser Phase,
nicht spaeter.

Betroffene Dateien voraussichtlich: `src/engine/types.ts` (RiskTier/UpgradeDef-
Form ueberarbeiten), `src/engine/PushYourLuckEngine.ts` (+Test),
`src/engine/EconomyStore.ts` (+Test, neue Methode),
`src/engine/AttendantEngine.ts` (+Test), `src/data/machines.config.ts`
(komplett neue Aktions-/Rollenzuweisungs-Definitionen je Automat, neue
Resolutionsfunktion statt `getEffectiveFailureChance`), `src/game/scenes/
MachineScene.ts` (Ausfuehrung/Anzeige/neue Kaufoberflaeche fuer automaten-
interne Upgrades), Tests entsprechend ueberall.

### Ergebnis: Phase 7b umgesetzt (2026-07-09)

**`src/engine/types.ts`:** `RiskTier` komplett ersetzt durch drei neue Typen:
`HardActionDef` (`kind:'hard'`, `counterState`), `IntermediateActionDef`
(`kind:'intermediate'`, feste `failureChance`), `MachineAction` (Union
beider, Config-Zeit) und `ResolvedAction` (Engine-Zeit — das, womit
`PushYourLuckEngine.resolveAction()` tatsaechlich wuerfelt, kennt weder
"hart"/"Zwischenstufe" noch Pattern-Zustaende). `MachineConfig.riskTiers` ->
`actions: MachineAction[]`. Neuer `MachineUpgradeDef`-Typ (`cost` in Tickets
DIESES Automaten statt Credits, `effect: {type:'visibility', value}`) —
`MachineConfig.upgrades: MachineUpgradeDef[]` (vorher immer leeres
`UpgradeDef[]`, jetzt erstmals befuellt). `EngineState` um
`machineUpgrades: Record<string, string[]>` erweitert (SaveSystem/
EconomyStore entsprechend mitgezogen, kein Save-Versions-Bump noetig, da
additiv mit sicherem Default).

**`src/engine/PushYourLuckEngine.ts`:** `RunStatus` verliert `'busted'`
(nur noch `'active' | 'banked'`). `resolveAction()` zieht bei Fehlschlag
`FAILURE_PENALTY_FRACTION` (= 0.4, im geforderten Richtwert 30-50%, als
optionaler Parameter ueberschreibbar) vom AKTUELLEN Punktestand ab, Lauf
bleibt `'active'`. Design-Entscheidung (nicht explizit in der Vorgabe,
hier bewusst getroffen): Meilenstein-Erreichung ist jetzt "sticky"
(`peakScore`, historisches Maximum) statt score-basiert — ein einmal
erreichter bankbarer Meilenstein bleibt bankbar, auch wenn ein spaeterer
Fehlschlag den AKTUELLEN Punktestand darunter drueckt. Ohne das haette eine
Teilstrafe denselben Effekt auf die Banking-Berechtigung wie das alte harte
Run-Ende gehabt und die Revision teilweise unterlaufen. `bank()` sichert
weiterhin den tatsaechlichen (reduzierten) Punktestand, nicht den Peak.

**Bewusst geaenderte alte Tests in `PushYourLuckEngine.test.ts`:**
- *"Fehlschlag setzt Punktestand auf 0 zurueck und beendet den Lauf als
  'busted'"* → ersetzt durch *"Fehlschlag zieht FAILURE_PENALTY_FRACTION des
  aktuellen Punktestands ab, Lauf bleibt aktiv"*.
- *"wirft, wenn der Lauf bereits busted ist"* → entfernt (busted existiert
  nicht mehr).
- *"bank() wirft nach einem Fehlschlag (busted, Score bereits 0)"* → ersetzt
  durch *"bank() bleibt nach einem Fehlschlag moeglich, sichert aber nur den
  reduzierten aktuellen Punktestand"* (genau gegenteiliges, gewolltes
  Verhalten).
- Neu hinzugefuegt: Test fuer die Peak-Stickiness der Meilenstein-Erreichung,
  Test fuer mehrere aufeinanderfolgende Fehlschlaege, Test fuer den
  `penaltyFraction`-Parameter.

**`src/engine/EconomyStore.ts`:** Neue Methode `spendTickets(machineId,
amount)`, symmetrisch zu `spendCredits`, aber pro Automat. Neue Methoden
`getMachineUpgrades`/`hasMachineUpgrade`/`purchaseMachineUpgrade` (Pro-
Automat-Muster wie `attendantKnowledge`, Wert hier aber eine Liste gekaufter
Upgrade-ids statt einer Zahl) — kaufen ueber `spendTickets`, nicht
`spendCredits`. Neues Event `machine-upgrade-purchased`.

**`src/data/machines.config.ts`:** Fuer alle vier Automaten neu definiert —
je zwei thematisch benannte harte Aktionen mit Gegenstueck-Zustand + drei
Zwischenstufen (die alten safe/balanced/risky-Basiswerte, jetzt WIRKLICH
musterunabhaengig, keine `getEffectiveFailureChance`-Modulation mehr):

| Automat | Harte Aktion 1 (Gegenstueck) | Harte Aktion 2 (Gegenstueck) | Neutraler Zustand |
|---|---|---|---|
| Greed Run | Blitzlauf (alarm) | Schleichgang (nah) | fern |
| Trap Tunnels | Sprengladung (einsturz) | Stuetzpfeiler (wackelig) | stabil |
| Beat Ledger | Powermove (doppelschlag) | Punktlandung (treibend) | ruhig |
| Champion's Ledger | Angriff (defensiv) | Konter (aggressiv) | finte |

Neue Resolutionsfunktion `resolveMachineAction(action, currentState)`
ersetzt `getEffectiveFailureChance` vollstaendig (deterministisch: harte
Aktion → failureChance 0 oder 1 je nach Zustandsvergleich; Zwischenstufe →
unveraendert durchgereicht). `getVisibleMoveCount(visibility)` reinterpretiert
`PatternEngine.getVisibility()` (unveraendert, weiterhin 0-1) als Zug-Anzahl
(`* MAX_PREVIEW_MOVES=3`, gerundet, mindestens 1) — `PatternEngine`-Klasse
selbst dabei nicht angefasst, wie gefordert.

Trade-off-Check (design-toolbox.md Punkt 5) neu hergeleitet, da die alte
zustandsabhaengige EV-Tabelle nicht mehr passt: stationaere Verteilung jedes
Patterns per Power-Iteration bestimmt (Test-Hilfsfunktion, nicht Teil der
Produktions-Logik) als Proxy fuer die "Blind-EV" einer harten Aktion (ohne
Sichtbarkeit gespielt) — die liegt fuer beide harten Aktionen aller vier
Automaten NACHWEISLICH unter der besten Zwischenstufen-EV (keine Dominanz
beim Raten), waehrend die "Perfekt-Info-EV" (nur bei sichtbar sicherem
Zustand gespielt) darueber liegt (Vorschau lohnt sich echt, design-
toolbox.md 1.10) — beides per `it.each`-Test ueber alle vier Automaten
automatisiert geprueft, konkrete Zahlen als Kommentar in `machines.config.ts`.

Automaten-interne Upgrades (ticket-bezahlt): Greed Run 2 Stufen (15/40
Tickets), Trap Tunnels 1 Stufe (20 Tickets), Beat Ledger keine (schon volle
Sichtbarkeit), Champion's Ledger 2 Stufen (25/60 Tickets) — Anzahl
entspricht jeweils der Laenge von `pattern.visibilityPerUpgrade` (per Test
abgesichert).

**`src/engine/AttendantEngine.ts`:** `getAttendantFailureChance`/
`getAttendantTier` entfernt (basierten auf dem alten kontinuierlichen
Fangchance-Modell). Neu: `getAttendantLookahead(visibleMoveCount,
knowledge)` — wie viele der TATSAECHLICH sichtbaren Zuege der Attendant
nutzen kann (0 bei Musterkenntnis 0, das volle Fenster bei voller Kenntnis).
`chooseAttendantAction(hardActions, intermediateActions, knownState,
knowledge)` — kennt der Attendant den Zustand an dieser Position (innerhalb
seines Lookaheads), waehlt er IMMER eine dort garantiert sichere harte
Aktion (bevorzugt die mit hoeherem Payout, falls beide sicher sind); sonst
faellt er auf eine Zwischenstufe zurueck (rät nie blind auf eine harte
Aktion). `getAttendantResolvedAction` skaliert wie bisher nur noch den
Payout mit der Effizienz (`ATTENDANT_MAX_EFFICIENCY`, unveraendert) — die
Fangchance bleibt unveraendert (0/1 bei harten Aktionen, die er ohnehin nur
bei Erfolg spielt; fest bei Zwischenstufen, unabhaengig davon wer spielt).

**`src/game/scenes/MachineScene.ts`:** Feste Zug-Sequenz (`sequence: string[]`,
`sequenceCursor`) wird lazy per `PatternEngine.sampleNext()`-Kette erzeugt
und NIE mehr veraendert (nur verlaengert). Vorschau zeigt bis zu
`MAX_QUEUE_LENGTH` (6) kommende Positionen, davon `getVisibleMoveCount()`
viele als konkrete Zustandsnamen, der Rest als "??". Aktions-Buttons zeigen
bei harten Aktionen live, ob die Position (falls sichtbar) TRIFFT oder
SCHEITERT. Neue Kaufoberflaeche fuer automaten-interne Upgrades direkt in
der Szene (NICHT in `UpgradePanel.tsx`, das bleibt exklusiv Hallen-Credits).
"Busted"-Phase/-Controls vollstaendig entfernt — `finishExecution()` prueft
nur noch Meilenstein/Abschluss, kein `RunStatus`-Check auf Fehlschlag mehr
noetig. Zusaetzlich: `renderBackToHallButton()` (Bugfix, siehe oben).

**Verifiziert:** `npm test` (185/185 gruen, +46 gegenueber Phase 7), `npm run
lint` sauber, `npx tsc --noEmit` sauber, `npm run build` erfolgreich.
Manuell per Playwright-Treiberskript gegen `npm run dev` (Screenshots nicht
Teil des Repos, nur Session-interne Verifikation): Greed Run UND Champion's
Ledger geprueft — Vorschau zeigt konkrete kommende Zuege statt Wahrscheinlichkeit
("Naechster Zug: nah", "Feste Sequenz: nah -> ?? -> ..."); harte Aktionen
zeigen korrekt TRIFFT/SCHEITERT live im Button-Text und das tatsaechliche
Ausfuehrungsergebnis stimmt IMMER mit dieser Vorschau ueberein (deterministisch,
kein Zufall bei der Trefferfrage); mehrfache Fehlschlaege in Folge reduzieren
den Punktestand nur graduell (kein Reset auf 0, kein Busted-Screen); Meilenstein/
Score-Attack/automatischer Hallen-Uebergang bei Erstdurchspielen funktionieren
unveraendert; automaten-internes Upgrade "Streckenkenntnis I" fuer 15 Tickets
gekauft (100 -> 85 Tickets), Vorschau-Fenster wuchs sofort von 1 auf 2 Zuege;
Attendant lief mit dem neuen Aktionsmodell fehlerfrei automatisiert (Tickets
100 -> 146.9 nach 25s Leerlauf in der Halle, keine Konsolenfehler).

## Offene Design-Fragen (noch nicht final entschieden)

## Verlauf

- [x] Phase 0 — Projekt-Setup — abgenommen
- [x] Phase 1 — Engine-Kern ohne UI — abgenommen (EconomyStore, SaveSystem, events.ts; 40 Vitest-Tests grün, Lint sauber, Build ok)
- [x] Phase 2 — PatternEngine + PushYourLuckEngine — abgenommen (39 neue Vitest-Tests grün, 79 Tests insgesamt, Lint + `tsc --noEmit` sauber)
- [x] Phase 3 — Automat 1 vertikaler Vollschnitt ("Greed Run") — abgenommen (Blocker unten aufgelöst)
- [x] Phase 4 — Reveal + Hallen-Grundgerüst — abgenommen (PM-Review 2026-07-09)
- [x] Phase 5 — Attendant-System — abgenommen (PM-Review 2026-07-09)
- [x] Phase 6 — Automaten 2–4 — abgenommen (PM-Review 2026-07-09, siehe Bedingungen unten)
- [x] Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Phase 7" unten)
- [x] Phase 7b — Kernmechanik-Revision — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Ergebnis: Phase 7b umgesetzt" oben)
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

### PM-Entscheidungen (2026-07-09, nach unabhaengiger Verifikation: 128/128 Tests, Lint, tsc --noEmit, Build alle gruen in isolierter Kopie; Engine-Dateien seit Phase 3 nur additiv veraendert, keine Phaser/React-Importe in /src/engine)

1. **Platzhalter-Wirtschaft (Freischalt-Kosten, Umrechnungskurs) genehmigt.**
   Bedingung fuer Phase 7: muss dort VOLLSTAENDIG durch `hall.config.ts`
   ersetzt werden, nicht nur ergaenzt -- sonst existieren zwei
   Wirtschaftssysteme parallel.
2. **Champion's Ledger "angekuendigte Spezialmoves" -- Auslassen bestaetigt.**
   Kein Blocker. Backlog-Punkt fuer Phase 8 oder spaeter, keine
   PatternEngine-Erweiterung jetzt noetig.
3. **Neuer Befund (PM):** Alle vier Automaten nutzen aktuell identische,
   generische Risiko-Tier-Labels ("safe"/"balanced"/"risky") statt
   thematischer Bezeichnungen (z. B. Angriffs-/Block-/Konter-Tokens fuer
   Champion's Ledger laut game-spec.md 4.5). Mechanisch korrekt
   unterschiedlich (Zahlen, Sichtbarkeit), aber fuer den Spieler fuehlen
   sich alle vier Automaten aktuell gleich an -- nur die Zahlen drumherum
   unterscheiden sich. Kein Blocker fuer Phase 7 (Kernstruktur ist laut
   game-spec.md 4.1 bewusst geteilt), aber VERBINDLICHER Punkt fuer
   Phase 8 (Politur): thematische Beschriftung der Tokens/Tiers pro
   Automat, sonst Redundanz-Risiko (Baukasten 1.4/4.2).

### Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback (2026-07-09)

Neu: `src/data/hall.config.ts` (reine Daten + kleine Ableitungsfunktionen,
analog zu `getEffectiveFailureChance` in `machines.config.ts` -- keine
Aenderung an EconomyStore/PatternEngine/PushYourLuckEngine/AttendantEngine).
`UpgradeDef`/`UpgradeEffect` (`src/engine/types.ts`) um `name`/`description`
sowie die Effect-Varianten `ticketConversionRate` und `unlockMachine`
erweitert (reine Typ-Erweiterung, keine Engine-Logik). Drei Upgrade-Kategorien,
alle ueber die bereits seit Phase 1 vorhandene
`economyStore.purchaseHallUpgrade(id, cost)` gekauft:

1. **Ticket->Credits-Umrechnung** (`TICKET_CONVERSION_UPGRADES`, 3 Stufen,
   0.5 Basis -> 0.75 -> 1.1 -> 1.5 Credits/Ticket). Ersetzt
   `TICKET_CONVERSION_RATE = 1` aus `HallHub.tsx` VOLLSTAENDIG -- die Basis-
   rate ohne jedes Upgrade ist bewusst niedriger als der alte Platzhalter
   (0.5 statt 1), damit die Stufen eine echte, spuerbare Verbesserung sind
   statt nur ein Reskin des alten Fixwerts.
2. **Automaten-Freischaltung** (`MACHINE_UNLOCK_UPGRADES`, aus `MACHINES`
   generiert). Ersetzt `MACHINE_UNLOCK_COST` aus `machines.config.ts`
   VOLLSTAENDIG -- Kosten unveraendert uebernommen (50/150/400, bereits in
   Phase 6 verifiziert), nur der Mechanismus wandert von einer fest
   codierten Konstante in ein echtes Upgrade. Kein Symbol/keine Konstante
   mit diesem Namen existiert mehr in `machines.config.ts`.
3. **Attendant-Trainingsgeschwindigkeit** (`ATTENDANT_SPEED_UPGRADES`, 2
   Stufen, Multiplikator 1x -> 1.4x -> 1.8x auf
   `AttendantEngine.TRAINING_KNOWLEDGE_GAIN`, hallenweit fuer ALLE Automaten
   gleichzeitig). Neu in Phase 7, kein Platzhalter-Vorgaenger.
   Cross-Layer-Feedback (Baukasten 1.14): ein mit Credits aus
   Automat 2-4 gekauftes Hallen-Upgrade verbessert rueckwirkend Automat 1s
   Attendant-Training -- Automat 1 bleibt dadurch nach Freischaltung der
   anderen drei relevant statt eine "stillgelegte Zahl" zu werden.
   Obergrenze bewusst < `MANUAL_KNOWLEDGE_GAIN / TRAINING_KNOWLEDGE_GAIN`
   (1.8x < 2x), per Test abgesichert (`hall.config.test.ts`), damit
   manuelles Spielen laut game-spec.md 3.2 auch bei voll gekauftem Training
   weiterhin schneller Musterkenntnis aufbaut als Credits-Training.

**AttendantEngine.ts/EconomyStore.ts/PatternEngine.ts/PushYourLuckEngine.ts
unveraendert** (Vorgabe fuer diese Phase). Die Verzahnung passiert an den
Aufrufstellen: `AttendantPanel.tsx` multipliziert
`AttendantEngine.TRAINING_KNOWLEDGE_GAIN` mit dem gekauften Multiplikator
(`hall.config.ts::getEffectiveTrainingGain`), genau wie schon
`machines.config.ts::getEffectiveFailureChance` PatternEngine/
PushYourLuckEngine verzahnt, ohne sie aneinander zu koppeln.

**UI:** Neues `src/ui/UpgradePanel.tsx` -- einzige Kaufoberflaeche fuer alle
drei Kategorien, in `HallHub.tsx` unterhalb der Automaten-Karten eingebettet.
`HallHub.tsx` selbst kauft nichts mehr direkt (der alte
`handleUnlock`-Button pro gesperrter Karte ist entfernt) -- gesperrte Karten
zeigen nur noch Status/Kosten und verweisen aufs UpgradePanel. Damit gibt es
nur noch EINEN Kaufpfad pro Upgrade-Typ (PM-Vorgabe: "am Ende darf es nur
noch einen Wirtschafts-Mechanismus geben, keine zwei parallelen").
Gemeinsamer `useEconomyRevision`-Hook aus `HallHub.tsx` nach
`src/ui/useEconomyRevision.ts` extrahiert (wird jetzt von `HallHub` UND
`UpgradePanel` genutzt, Event-Liste nur an einer Stelle zu pflegen).

**Bewusst NICHT Teil dieser Phase:** Pattern-Sichtbarkeits-Upgrades
(`MachineConfig.upgrades`, `visibilityPerUpgrade`) bleiben weiterhin leere
Arrays -- der PM-Auftrag fuer Phase 7 nannte explizit nur die drei Kategorien
oben (Umrechnungskurs, Freischalt-Schwellen, Attendant-Trainingsgeschwindigkeit).
`MachineScene.ts` hat dafuer keinen Platzhalter, der zu ersetzen waere (die
feste `upgradeLevel = 0` betrifft Sichtbarkeit, nicht Umrechnung/Training) --
deshalb bleibt `MachineScene.ts` in dieser Phase unveraendert. Falls
Sichtbarkeits-Upgrades gewuenscht sind, waere das ein eigener,
noch nicht spezifizierter Kaufmechanismus (pro Automat statt hallenweit) fuer
eine spaetere Phase.

**Verifiziert:** `npm test` (139/139 gruen, 11 neue Tests in
`hall.config.test.ts`), `npm run lint` sauber, `npx tsc --noEmit` sauber,
`npm run build` erfolgreich. Manuell per Playwright-Treiberskript gegen
`npm run dev` (Save-Injection: 1000 Credits, 200 Tickets bei Greed Run,
Greed Run durchgespielt): Wechselstube I gekauft (1000 -> 970 Credits, Kurs
0.50 -> 0.75 im UI sichtbar) -> 200 Tickets zum NEUEN Kurs umgewandelt (970
-> 1120 Credits, exakt +150 = 200*0.75) -> Trap Tunnels ueber das
UpgradePanel freigeschaltet (Karte wechselt von "Gesperrt" zu spielbar) ->
Schulungsprogramm I gekauft (Multiplikator-Anzeige 1.00x -> 1.40x) ->
Training bei Greed Run ausgefuehrt (Musterkenntnis 50% -> 51%, +1.4% statt
vorher +1%) -- kompletter Kreislauf Tickets -> Credits -> Hallen-Upgrades ->
spuerbar verbesserte Automaten (Automat 1 UND neu freigeschalteter Automat 2)
bestaetigt lauffaehig. Screenshots nicht Teil des Repos (nur Session-interne
Verifikation, wie in Phase 4-6).

### Offene Punkte fuer spaetere Phasen (keine Blocker, nur Merkposten)

- Pattern-Sichtbarkeits-Upgrades (`MachineConfig.upgrades`) sind weiterhin
  ueberall leere Arrays -- kein Kaufmechanismus fuer
  `visibilityPerUpgrade` existiert bisher (bewusst ausserhalb des Phase-7-
  Auftrags, siehe Abschnitt "Phase 7" oben).
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
