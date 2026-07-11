# Spielspezifikation: Arcade-Incremental (Arbeitstitel)

Scope dieses Dokuments: **Layer 0 (Reveal) und Layer 1 (Spielhalle mit 4 Automaten)**. Layer 2 (Stadt/mehrere Hallen) ist bewusst nicht Teil dieser Spezifikation und wird erst nach Fertigstellung von Layer 1 geplant.

Dieses Dokument ist gegen `design-toolbox.md` geprüft. Bei Widersprüchen zwischen Spezifikation und Baukasten gilt: Baukasten hat Vorrang, Rücksprache mit dem Team.

---

## 1. Elevator Pitch

Der Spieler startet in einem scheinbar gewöhnlichen Arcade-Minispiel. Nach einem Fortschritts-Durchbruch offenbart sich: Er befindet sich in einer Spielhalle mit mehreren Automaten. Die Spielhalle wird zum Haupt-Layer, in dem der Spieler mit der gesammelten Automaten-Währung die Halle verbessert und weitere Automaten freischaltet – jeder mit einer eigenen, komplett anderen Mini-Spiel-Mechanik.

Kernprinzip aller Automaten: **Plan → Ausführung beobachten → Ergebnis.** Keiner der vier Automaten verlangt Echtzeit-Reflexe; alle basieren auf Vorab-Entscheidungen gegen ein teilweise bekanntes, teilweise unbekanntes Verhaltensmuster.

---

## 2. Layer 0: Der Durchbruch (Reveal)

- Spieler startet direkt im Minispiel von **Automat 1** ("Greed Run", siehe 4.2 – bestätigt wegen der intuitivsten Kernidee als Einstieg)
- Keine sichtbare Meta-UI zu Beginn (kein Hallen-HUD, kein Token-Zähler sichtbar oder nur minimal als "Punkte")
- Nach Erreichen eines Fortschritts-Schwellenwerts (konkreter Wert: TBD, Richtwert 10–20 Minuten Spielzeit) löst der Durchbruch aus: kurze Übergangs-Sequenz/Kamerafahrt, danach Wechsel in die `HallScene`
- **Wichtig laut Baukasten (1.8):** Dieser Überraschungseffekt wird nur hier verwendet. Automaten 2–4 bekommen jeweils einen eigenen kleinen Hook (siehe 4.x), keine Wiederholung des großen Reveals.

---

## 3. Layer 1: Die Spielhalle

### 3.1 Währungsfluss (überarbeitet 2026-07-09, ersetzt Tickets→Credits-Modell)

```
Automat (Skill-Score) → gleichzeitig zwei Ausgaben pro Aktion:
  1. Automaten-Punkte (lokal, NICHT übertragbar) → Tiefe-/Präzisions-Upgrades DIESES Automaten
  2. Tickets (hallenweit gepoolt) → Hallen-Upgrades, Freischaltung Automat 2/3/4, Attendant-Training
```

- **Kein "Credits"-Begriff mehr.** Frühere Version hatte Tickets (pro Automat) → Credits (Hallenweit) mit explizitem Umrechnungskurs als eigenem Hallen-Upgrade. Das ist redundant: ein Umrechnungskurs zwischen zwei Währungen, die nur nacheinander verwendet werden, ist mathematisch identisch mit einer direkten Ertragsrate-Erhöhung in der Zielwährung — eine Ebene weniger, gleiche Tiefe.
- **Zwei getrennte Ausschüttungen pro Aktion, kein manueller Umwandlungsschritt:** Jede erfolgreiche Aktion (manuell oder Attendant) erzeugt gleichzeitig automaten-lokale Punkte UND hallenweite Tickets. Keine sichtbare Zwischenwährung, kein "Umwandeln"-Button.
- **Feste, nicht kaufbare Normalisierungs-Konstante pro Automat** sorgt dafür, dass alle vier Automaten trotz unterschiedlicher Rohzahlen-Skalen fair zum gemeinsamen Ticket-Pool beitragen (kein direkter Vergleich zwischen Automaten nötig, wie ursprünglich intendiert) — das ist ein interner Balance-Wert in der Config, kein Spieler-Hebel.
- **Ertragsrate-Upgrade statt Umrechnungskurs:** Der frühere "Umrechnungskurs verbessern"-Hebel wird zu einem Hallen-Upgrade, das die Ticket-Ertragsrate direkt erhöht (hallenweit, wirkt auf alle Automaten gleichzeitig — Cross-Layer-Feedback, Baukasten 1.14).
- Tickets kaufen: Hallen-Upgrades (Ticket-Ertragsrate), Freischaltung Automat 2/3/4, Attendant-Training pro Automat
- Automaten-Punkte kaufen: ausschließlich Tiefe-/Präzisions-Upgrades DES EIGENEN Automaten (siehe 4.1b, "Zwei-Achsen-Vorschau") — bewusst nicht übertragbar, damit ein Automat nicht durch im Vorgänger-Automaten gefarmte Punkte "erkauft" leichter wird

### 3.2 Attendant-System (Automatisierung, überarbeitet 2026-07-09)

- Pro Automat gibt es einen eigenen **Attendant** (diegetisch: Hallenaufsicht)
- Attendant wird freischaltbar, sobald der Spieler den Automaten einmal "durchgespielt" hat (siehe 4.1, Abschluss-Kriterium)
- **Alle freigeschalteten Attendants laufen GLEICHZEITIG im Hintergrund**, nicht nur der des gerade geöffneten Automaten — sonst würden früher freigeschaltete Automaten zu "stillgelegten Zahlen" verkommen, sobald man zu späteren wechselt (Baukasten 1.14). Ein Automat, den man nicht mehr aktiv spielt, bleibt trotzdem ein kleiner, laufender Beitrag zum Ticket-Ertrag.
- **Rate statt Einzelsimulation:** Der Attendant führt nicht mehr einzelne Spielrunden Schritt für Schritt aus. Stattdessen wird eine deterministische Ertragsrate (Tickets bzw. Automaten-Punkte pro Sekunde) aus derselben Erwartungswert-Mathematik hergeleitet, die auch für die Blind-EV-Garantie verwendet wird (Musterkenntnis + eigener Tiefe/Präzision-Zugriff bestimmen den erwarteten Ertrag pro Aktion; Aktionen pro Sekunde als fester Parameter). Angewendet über verstrichene Echtzeit (nicht über einen laufenden Tick-Timer) — das ermöglicht auch Fortschritt, während die Seite geschlossen ist ("Offline-Ertrag").
- **Pool-Ausschüttung für die sichtbare Optik:** Damit der Attendant im Vordergrund weiterhin wie ein echt spielender Akteur wirkt (nicht wie eine glatte Zahl, die hochzählt), wird die Rate in einen Pool eingezahlt, der zyklisch mit einem zufälligen Faktor (0,8–1,2) teilweise ausgeschüttet wird. Die Abweichung vom Faktor 1 verbleibt im Pool (positiv wie negativ) — dadurch pendelt sich der langfristige Durchschnitt exakt auf die zugrunde liegende Rate ein (mathematisch garantiert, nicht nur ungefähr), eine große Ausschüttung macht die nächste kleinere automatisch wahrscheinlicher. Für Offline-/Hintergrund-Berechnung wird NICHT der Pool-Mechanismus wiederholt durchgerechnet, sondern direkt die lineare Rate über die verstrichene Zeit angewendet (der Pool ist reine Vordergrund-Optik).
- Attendant-Erfolgsquote/-Ertrag basiert auf einem **"Musterkenntnis"-Wert** (0–100 %), der die tatsächliche, für diesen Automaten gelernte Wahrscheinlichkeitsverteilung repräsentiert – kein separater, unerklärter Zufallsfaktor (Baukasten 1.10 gilt auch für die Automatisierungs-Ebene)
- Musterkenntnis steigt durch: manuelles Spielen (primär) + optionales Tickets-Training (sekundär, langsamer als eigenes Spielen)
- Attendant-Output ist immer spürbar geringer als optimales manuelles Spiel (Richtwert: max. ~85–90 % der Bestleistung bei voller Musterkenntnis) – aktives Spielen bleibt überlegen (Baukasten 1.3)
- Für dem Spieler zugängliche Framing/Namen der Upgrades (z. B. "Strategielevel") können sich anders anfühlen, als sie unter der Haube berechnet werden (reiner Rate-Multiplikator) — das ist bewusst, solange die zugrunde liegende Mathematik konsistent bleibt

### 3.3 Hallen-Fortschritt

- 4 Automaten-Slots, initial nur Automat 1 sichtbar/spielbar
- Automat 2 schaltet frei nach Hallen-Upgrade-Schwelle X (basierend auf Tickets aus Automat 1)
- Automat 3 und 4 analog, mit steigenden Schwellen
- Nach Freischaltung + Durchspielen aller 4 Automaten: Hallen-weiter Abschlussmoment, der den Übergang zu Layer 2 andeutet (Layer 2 selbst: **nicht Teil dieser Spezifikation**)
- **Vorgemerkt für Layer-2-Planung (nicht jetzt umsetzen):** Ein Prestige-/Reset-Mechanismus ("alles zurücksetzen, dafür mit dauerhaftem Multiplikator neu starten", Baukasten 1.2) wäre ein zusätzliches, sauberes Werkzeug gegen das "früherer Automat wird irrelevant"-Problem — passt aber inhaltlich genau zu dem oben angedeuteten Übergang zu Layer 2 und wird dort geplant, nicht als Ergänzung zu Layer 1.

---

## 4. Die 4 Automaten

Nur noch Automat 4 nutzt die gemeinsamen Kernsysteme aus 4.1/4.1b/4.1c unverändert (Details siehe `implementation-plan.md`, Abschnitt Engine):
- **PatternEngine** – probabilistische Zustandsübergänge, progressive Teilaufdeckung durch Upgrades
- **AttendantEngine** – automatisierte Ausführung nach Musterkenntnis-Wert

**Automaten 1–3 haben jeweils eigene, genre-spezifische Mechaniken** (5×5-Sektorenfeld bei Greed Run, Tunnelnetz-Graph bei Trap Tunnels, Autopilot+Boosts bei Boost Barrage — siehe 4.2/4.3/4.4) und nutzen `PatternEngine` nicht mehr. Jeweils ein bewusstes Genre-Rework-Experiment, siehe CLAUDE.md für die zugehörige Architektur-Konsequenz (eigene Szene statt der generischen `MachineScene.ts`). Gemeinsam bleibt für alle vier Automaten die Hallen-Ökonomie (`EconomyStore`, Tickets/Automaten-Punkte, Meilensteine, Speicherstand).

### 4.1 Gemeinsame Rundenstruktur (gilt für alle 4 Automaten)

1. **Planungsphase:** Spieler wählt eine Sequenz von Aktionen/Tokens gegen ein teilweise sichtbares Verhaltensmuster
2. **Ausführungsphase:** Plan läuft automatisch/animiert ab (kein Reflex-Input nötig)
3. **Ergebnis + Kausalitäts-Feedback:** Punkte/Tickets, plus sichtbare Begründung bei Fehlschlag ("Block kam zu früh" statt nur "Fehlschlag")
4. **Meilenstein-Entscheidung:** An Checkpoints: Banking (Lauf sichern) oder Weitermachen (höheres Risiko für höheren Ertrag)
5. **Abschluss-Kriterium:** Erreichen des letzten Checkpoints = "durchgespielt" → schaltet Attendant für diesen Automaten frei. Danach optionaler Score-Attack-Modus für wiederholtes Spielen (Baukasten 1.6)

### 4.1a Kernmechanik-Revision v1 (2026-07-09, TEILWEISE ERSETZT durch 4.1b unten)

~~Zwei Konter-Aktionen + mehrere Zwischenstufen, Fehlschlag = Teilstrafe vom
aktuellen Punktestand~~ — dieses Aktionsmodell ist durch 4.1b unten ersetzt.
Die folgenden Punkte aus v1 gelten weiterhin unverändert:

- **Festes Pattern pro Run:** Die komplette Zug-Sequenz eines Automaten-Runs
  steht bei Run-Start fest (wie ein vorab generiertes Level-/Tunnellayout),
  nicht mehr live neu gewürfelt pro Ausführungsschritt.
- **Vorschau als In-Automat-Progression:** Wie viele Züge der festen Sequenz
  im Voraus sichtbar sind, ist über automaten-EIGENE Upgrades erweiterbar,
  die mit den eigenen Tickets DIESES Automaten bezahlt werden (nicht mit
  Hallen-Credits) — echte Fortschritts-Achse innerhalb eines einzelnen
  Automaten, unabhängig von der Hallen-Wirtschaft.

### 4.1b Kernmechanik-Revision v2 (2026-07-09, ersetzt das Aktionsmodell aus 4.1a)

Nach weiterem Playtesting: das "zwei harte Aktionen + Zwischenstufen"-Modell
fühlte sich immer noch nicht wie eine planbare Entscheidung an. Neues,
verbindliches Aktionsmodell — ein reiner zyklischer Konter ohne sichere Option:

- **n=5 Aktionen pro Automat, zyklisch angeordnet** (A, B, C, D, E als
  Platzhalter-Namen — pro Automat thematisch zu benennen). Jede Aktion
  kontert GENAU die nächste in der Zyklus-Reihenfolge (A kontert B, B kontert
  C, C kontert D, D kontert E, E kontert A).
- **Pattern-Zustände = Aktionen 1:1.** Jeder Automat hat jetzt 5 Pattern-
  Zustände (vorher 3) in derselben zyklischen Reihenfolge wie die Aktionen.
- **Drei Ergebnis-Stufen pro Aktion, abhängig vom aktuellen festen
  Pattern-Zustand:**
  1. **Großer Gewinn:** wenn der aktuelle Zustand genau der ist, den die
     gewählte Aktion kontert (1 von 5 Zuständen)
  2. **Verlust:** wenn der aktuelle Zustand genau der ist, der die gewählte
     Aktion kontert, also die Vorgänger-Aktion im Zyklus (1 von 5 Zuständen)
  3. **Einfacher Treffer:** bei jedem der übrigen 3 Zustände — spürbar
     kleiner als der große Gewinn, aber immer positiv
  - Kein "Fehlschlag/Erfolg" mehr als Konzept — jede Aktion trifft immer,
    nur die Payout-Spanne unterscheidet sich (groß positiv / normal positiv /
    negativ) je nach Zustandstreffer. Verlust ist ein eigener, fester Payout-
    Bereich (z. B. -8 bis -12), kein Prozentabzug vom aktuellen Punktestand.
- **Kein sicherer Hafen:** Ohne jede Vorschau sind alle 5 Aktionen exakt
  gleichwertig (je 1 Gewinn-, 1 Verlust-, 3 Neutral-Zustand) — die gesamte
  Entscheidungsqualität hängt an der Vorschau auf die feste Sequenz.
- **Blind-Erwartungswert-Garantie (verbindlich, automatisiert zu prüfen):**
  Für jede Aktion jedes Automaten muss unter der TATSÄCHLICHEN (nicht
  angenommenen) stationären Verteilung des Patterns gelten:
  `EV = P(Gewinn-Zustand)·Großer_Gewinn + P(Verlust-Zustand)·Verlust + P(Rest)·Einfacher_Treffer > 0`.
  Blindes Spiel muss im Erwartungswert immer positiv bleiben; Vorschau
  beschleunigt nur, sie ist keine Voraussetzung für Netto-Fortschritt. Sobald
  der Spieler den aktuellen Zustand sieht, kann er den Verlust-Fall trivial
  vermeiden (jede andere Aktion als die gerade gekonterte wählen) — Verlust
  passiert nur bei bewusstem blindem Risiko für den großen Gewinn, nicht
  durch Pech bei aufmerksamem Spiel.

- **Zwei-Achsen-Vorschau statt binärem "bekannt/unbekannt" (Ergänzung
  2026-07-09):** Statt eine Position entweder exakt zu zeigen oder komplett
  zu verbergen, gibt es eine Präzisions-Stufe `p` (0 bis n−1, bei n=5 also
  0–4). Bei Präzision `p` werden `p` garantiert falsche Kandidaten aus den
  n möglichen Zuständen ausgeschlossen ("definitiv nicht X, nicht Y, ..."),
  der wahre Zustand bleibt unter den verbleibenden `n−p` Kandidaten
  versteckt. `p=0` = komplett blind, `p=n−1` = nur noch 1 Kandidat übrig =
  Zustand de facto bekannt. Separat davon bestimmt die Sichtweite `d` (1 bis
  n), für wie viele der kommenden Positionen überhaupt eine (durch `p`
  bestimmte) Teilinformation gezeigt wird. Beides sind unabhängige,
  wiederholt kaufbare, im Preis steigende automaten-interne Upgrade-Leitern
  (ticket-finanziert, siehe 4.1a) — `p` gilt einheitlich für alle sichtbaren
  Positionen, keine dritte Dimension "Präzision variiert mit Tiefe". Die
  ausgeschlossenen Kandidaten pro Position werden EINMAL bei Run-Start (wenn
  auch die feste Zug-Sequenz feststeht) ermittelt und bleiben für den Rest
  des Runs stabil, keine erneute Zufallsziehung bei wiederholtem Hinsehen.
  Ersetzt die einfache "reveal genau `d` Positionen exakt"-Vorschau aus dem
  ersten 4.1b-Entwurf.

Technische Details/Begründung: siehe STATUS.md, Abschnitt zur Kernmechanik-
Revision v2.

### 4.1c Erkennbarkeit + Banking-Streichung (Ergänzung 2026-07-09, aus erstem Playtest)

Playtest der 5-Zyklus-Mechanik ergab: Aktionen waren visuell kaum zu
unterscheiden, die Konter-Beziehungen nicht erkennbar, und die Aktions-
Buttons verrieten direkt das Ergebnis gegen den aktuell bekannten Zustand
("GROSSER GEWINN sicher") — der Spieler musste die Vorschau dadurch gar nicht
mehr selbst auswerten. Verbindliche Korrekturen:

- **Kreisanordnung statt Reihe:** Die 5 Aktions-Buttons werden im Fünfeck
  angeordnet, in derselben Zyklus-Reihenfolge wie die Pattern-Zustände.
  Nachbarschaft im Kreis entspricht der Konter-Beziehung (räumlich lernbar,
  statt eine Text-Tabelle nachschlagen zu müssen).
- **Konsistente Farbcodierung:** Zustand i und Aktion i teilen sich eine
  feste Farbe (5 unterscheidbare Farben pro Automat). Preview-Anzeige nutzt
  dieselben Farben statt reinem Text, damit die Sequenz auf einen Blick
  erfassbar ist.
- **Statische Referenz-Grafik:** Eine immer sichtbare, sich nie ändernde
  Übersicht (z. B. Fünfeck mit Pfeilen), die zeigt, welche Aktion welchen
  Zustand kontert — reine Nachschlage-Information, keine live berechnete
  Auflösung.
- **Keine Live-Verhaltensanzeige auf den Buttons (initial):** Buttons zeigen
  nur Name, Farbe und die generischen Payout-Spannen (Groß/Einfach/Verlust),
  KEINE Berechnung gegen den aktuell bekannten Zustand. Der Spieler muss
  Vorschau + Referenz-Grafik selbst gedanklich kombinieren (Baukasten 1.5,
  echte Entscheidung statt vorgekauter Antwort).
- **"Hilfe"-Modus als späteres, freischaltbares QoL-Feature vorgemerkt**
  (nicht jetzt bauen, Backlog für Phase 8/Politur): zeigt optional genau die
  jetzt entfernte Live-Verhaltensanzeige. Opt-in-Tiefe (Baukasten 1.13) —
  einfacher, denkender Einstieg standardmäßig, Komfort als spätere Wahl.
- **Banking entfällt komplett.** Seit jede Aktion sofort Automaten-Punkte UND
  Tickets gleichzeitig auszahlt (3.1), gibt es keinen "ungesicherten Lauf"
  mehr, den man verlieren könnte — der ursprüngliche Zweck von Banking
  (Absicherung vor Totalverlust) ist bereits durch die kontinuierliche,
  persistente Verbuchung erledigt. "Meilenstein erreicht" ist nur noch eine
  Fortschritts-Meldung, kein Entscheidungspunkt. "Durchgespielt" bedeutet:
  der dauerhafte, dem Automaten zugeordnete Punktestand hat einmalig die
  letzte Meilenstein-Schwelle erreicht.
- **Depth/Warteschlangen-Länge vereinheitlicht:** Die maximale Anzahl
  planbarer Aktionen pro Runde muss exakt der maximalen Tiefe entsprechen —
  bei voller Tiefe muss die GESAMTE geplante Warteschlange sichtbar sein,
  keine strukturell immer-blinde letzte Position.

### 4.2 Automat 1 — "Greed Run" (Pac-Man-Twist, ab 2026-07-10 eigene Mechanik — Genre-Rework-Experiment)

**Ersetzt ab hier die gemeinsame Zyklus-Mechanik aus 4.1/4.1b/4.1c vollständig für Automat 1.** Automaten 2–4 bleiben vorerst unverändert bei 4.1/4.1b/4.1c, bis sich dieses Experiment im Playtest bewährt hat — bewusst nur EIN Automat auf einmal umgebaut, nicht alle vier gleichzeitig.

**Kernidee:** 5×5-Sektorenfeld (25 Sektoren), Spieler startet im Mittelfeld (Sektor 3,3 bei 1-indizierter Zählung), bewegt sich pro Zug in eine von 4 Richtungen (kein Diagonal-, kein Stehenbleiben-Zug in dieser Version).

**Sektorinhalt:** Pro Run einmalig fest vorab generiert (das bestehende Prinzip "festes Pattern pro Run" bleibt erhalten). Jeder der 24 Nicht-Start-Sektoren ist genau eine von vier Kategorien: Geist (negativer Payout), Punkte (kleiner positiver Payout, der Standard-/Mehrheitsfall), Leer (kein Payout), Bonus-Frucht (größerer positiver Payout, selten). Kein Powerpille-Mechanismus in dieser Version.

**Verbrauchsregel:** Sobald ein Sektor betreten wird, gilt sein ursprünglicher Inhalt als ausgelöst und wandelt sich für den Rest des Runs zu Leer — einheitlich für alle vier Kategorien inklusive Geist (keine zweite Strafe an derselben Stelle).

**Sicherheits-Constraint bei der Generierung:** Unter den bis zu 4 direkten Nachbarn des Startfelds befindet sich höchstens 1 Geist. Das ist eine weiche Wahrscheinlichkeits-Reduktion, keine harte Garantie für den Rest des Felds.

**Blind-Erwartungswert-Garantie (automatisiert zu prüfen, gleiches Prinzip wie bei den anderen Automaten):** Über die gewählte Kategorien-Häufigkeit der 24 Nicht-Start-Sektoren gemittelt muss der erwartete Payout eines komplett unvorbereiteten Zugs (ganz ohne genutzte Vorschau-Information) positiv bleiben.

**Drei unabhängige, ticket-finanzierte automaten-interne Upgrade-Achsen** (ersetzen depthUpgrades/precisionUpgrades aus dem gemeinsamen Modell konzeptionell — technisch ggf. weiterhin ähnliche Interfaces mit anderem Zahlenbereich, Ermessen von Claude Code):

1. **Sichtweite** (1–4, Start bei 1): Manhattan-Distanz-Radius, FEST um den Startsektor verankert (Korrektur nach Playtest 2026-07-10 — ursprünglich um die aktuelle Position zentriert und bei jedem Zug neu berechnet, das war im Spiel verwirrend, weil sich der sichtbare Bereich beim Laufen ständig mitverschoben hat). Der sichtbare Bereich bleibt für den gesamten Run identisch, unabhängig davon, wohin sich der Spieler bewegt — wer den sichtbaren Bereich verlässt, läuft komplett blind weiter. Bei Sichtweite 4 sind ab der Mitte des 5×5-Felds alle Ecken sichtbar (Manhattan-Distanz Mitte→Ecke = 4).
2. **Präzision** (0–3, Start bei 1): wie viele der vier Kategorien pro sichtbarem Sektor bereits zweifelsfrei aufgelöst sind. Die Reihenfolge der Auflösung ist NICHT neutral/zufällig, sondern richtet sich nach dem gewählten Fokus (siehe unten). Bei Präzision 3 ist der Inhalt vollständig bekannt, unabhängig vom Fokus. **Anzeige-Konvention (Korrektur nach Playtest 2026-07-10):** Solange ein Sektor noch nicht vollständig bekannt ist, zeigen die kleinen Symbole im Sektor die noch MÖGLICHEN (nicht ausgeschlossenen) Kategorien, nicht die bereits ausgeschlossenen — das war zuvor mehrdeutig. Mit steigender Präzision wird die Menge der gezeigten möglichen Kategorien kleiner, bis nur noch eine übrig bleibt (= bekannt). Bei Präzision 0 (noch nichts ausgeschlossen) wird kein Symbol gezeigt, nur das neutrale "?" — sonst nichts gewonnen, nur Unordnung.
3. **Aktionsbudget** (Start bei 4, Obergrenze vorerst offen/iterativ zu bestimmen): wie viele Züge insgesamt pro Run möglich sind — unabhängig von der Sichtweite. Das ist eine bewusste Abweichung von der in 4.1c für die anderen Automaten festgelegten Regel "Warteschlangenlänge = Sichtweite": hier sinnvoll, weil man in einem Raster weiter laufen kann, als man aktuell sieht (Nebel-des-Krieges-Situation).

**Fokus-Wahl (Sicher vs. Gier):** Pro Run genau einmal vor Rundenstart festgelegt, gilt für den gesamten Lauf, kein Wechsel während eines laufenden Runs.

- **Sicher-Fokus:** Bei Präzision 1 wird zuerst zuverlässig aufgedeckt, ob ein sichtbarer Sektor ein Geist ist oder nicht.
- **Gier-Fokus:** Bei Präzision 1 wird zuerst zuverlässig aufgedeckt, ob ein sichtbarer Sektor eine Bonus-Frucht ist oder nicht.
- Bei Präzision 2/3 werden schrittweise weitere Kategorien in einer festen, fokus-abhängigen Reihenfolge zusätzlich aufgelöst (Ermessen von Claude Code für die genaue Sekundär-Reihenfolge, z. B. Sicher-Fokus: Geist → Bonus → Leer; Gier-Fokus: Bonus → Geist → Leer — Punkte ergibt sich jeweils durch Ausschluss der anderen drei).
- Fokus-Wechsel ist kostenlos (kein Ticket-/Punktepreis), damit keine der beiden Strategien strukturell bevorzugt wird.
- **UI-Ablauf:** Vor Rundenstart erscheint ein Popup mit den zwei Fokus-Optionen (keine Checkbox im Popup selbst). Sobald gewählt, zeigt ein permanenter HUD-Chip während des Laufs den aktiven Fokus inklusive einer Checkbox "für nächsten Lauf beibehalten" (Standard: aktiviert). Ist die Checkbox aktiv, startet der nächste Run direkt mit demselben Fokus ohne erneutes Popup; wird sie deaktiviert, erscheint das Popup beim nächsten Rundenstart erneut.

**Ausdrücklich noch nicht Teil dieser Version** (bewusst zurückgestellt, nicht vergessen — Backlog für eine mögliche spätere Erweiterung): Powerpille/Geister-fressen-Mechanik, bewegliche Geister, Zeitlimit in der Planungsphase.

**Rundenstruktur (korrigiert nach Playtest 2026-07-10, Phase 7h):** Ein Run besteht aus GENAU EINER Planungs- + Ausführungsphase, nicht aus mehreren aufeinanderfolgenden Planungsrunden. Der Spieler plant 1 bis zu (aktuelles Aktionsbudget) Schritte, drückt "Los" — das führt die geplanten Schritte aus UND beendet damit den Run unwiderruflich, egal ob das volle Aktionsbudget genutzt wurde oder nicht. Nicht genutztes Budget verfällt ersatzlos (kein Fortführen mit Restbudget aus der aktuellen Position). Direkt danach startet der nächste Run — IMMER wieder im Mittelfeld, mit frisch generiertem Feld (Fokus-Popup oder automatischer Neustart je nach "beibehalten"-Checkbox, wie bisher). Das schafft eine echte Entscheidung on top: früh abbrechen (weniger Risiko, kürzerer Weg vom bekannten Zentrum) vs. das volle Budget ausreizen (mehr Ertrag, aber tiefer in ungesicherte Zonen). Weiterhin kein Echtzeit-Reflex nötig, frei einteilbare Bedenkzeit.

**Attendant-Automatisierung:** Die bestehende `AttendantEngine`-Mathematik (Erwartungswert über die stationäre Markov-Verteilung des zyklischen Patterns) passt nicht mehr direkt, da es kein zyklisches Pattern mehr gibt. Für diese Experimentierphase reicht eine grob vereinfachte Platzhalter-Schätzung (z. B. erwarteter Payout pro Zug basierend auf den Kategorien-Grundwahrscheinlichkeiten und dem aktuellen Fokus/Präzision, ohne echte Pfadplanung) — bitte in STATUS.md klar als bewusste Vereinfachung dokumentieren, keine perfekte Nachbildung erzwingen.

**Ökonomie-Anbindung** (Tickets/Automaten-Punkte-Ausschüttung pro Zug, Meilenstein-Pips, Speicherstand-Mechanik) bleibt technisch unverändert (`EconomyStore`, Meilenstein-Logik) — nur die Zug-Auflösung und die Vorschau sind neu.

**Speicherstand:** Da sich die interne Struktur für Automat 1 grundlegend ändert, `CURRENT_SAVE_VERSION` erneut erhöhen, alte Spielstände beim Laden ablehnen statt migrieren (etabliertes Vorgehen aus Phase 7d/7e).

- **Warum Layer-0-Kandidat:** Kernidee (Risiko vs. Gier beim Sammeln) ist ohne Erklärung sofort verständlich — gilt mit dem neuen Feld-Modell unverändert weiter.

### 4.3 Automat 2 — "Trap Tunnels" (Dig-Dug/Q*bert-Twist, ab 2026-07-10 eigene Mechanik — Genre-Rework v2: Zufallsbewegung + Dynamit)

**Ersetzt ab hier vollständig sowohl die gemeinsame Zyklus-Mechanik aus 4.1/4.1b/4.1c als auch das erste Trap-Tunnels-Genre-Rework (feste, vorab generierte Gegner-Pfade mit Vorschau-Reichweite) für Automat 2.** Grund für die zweite Überarbeitung: das erste Rework degenerierte bei voller Vorschau zu einer reinen "wo überschneiden sich die Farben"-Ablesübung ohne echte Entscheidung, weil (a) platzierte Fallen sich nie verbrauchten und (b) es keinerlei Verlust-/Risikofall gab. Automaten 3–4 bleiben unverändert bei 4.1/4.1b/4.1c.

**Kernidee:** Ein Tunnelnetz aus Kreuzungen (Graph). Der Spieler bewegt sich nicht selbst. Pro Run bewegen sich mehrere Gegner (Anzahl upgradeable) SCHRITT FÜR SCHRITT tatsächlich zufällig durch das Netz — nicht mehr als vorab feststehender Pfad, sondern live bei der Ausführung gewürfelt: an jeder Kreuzung wird zufällig (gleichverteilt) eine der verfügbaren Verbindungen gewählt, AUSSER der Verbindung, über die der Gegner gerade gekommen ist (kein unmittelbares Zurücklaufen; beim allerersten Schritt gilt diese Einschränkung nicht). Gibt es keine gültige Option (Sackgasse oder nur noch die Rückwärts-Verbindung übrig), bleibt der Gegner für den Rest der Runde auf seiner aktuellen Kreuzung stehen. Das macht Kreuzungen mit nur einer Weiterverbindung (Grad 2 inklusive Rückweg) faktisch deterministisch vorhersagbar, während echte Verzweigungen (Grad 3+) genuine Unsicherheit bleiben — der Spieler muss diese Struktur selbst durchdenken, es gibt dafür keine Aufdeckungs-Mechanik.

**Fallen:** Spieler platziert vor der Ausführung bis zu (Fallenanzahl) Fallen auf beliebigen Kreuzungen. Läuft ein Gegner in eine Falle, wird er gefangen (Payout, Gegner verschwindet aus der laufenden Runde). **Fallen verbrauchen sich NICHT** — eine Falle bleibt für den Rest des Runs aktiv und kann beliebig viele weitere Gegner fangen, die später (oder gleichzeitig) dort vorbeikommen. Das ist bewusst so: dadurch wird die Gegner-Anzahl zu einem eigenständigen, unabhängigen Steigerungsfaktor (mehr Gegner = mehr unabhängige Chancen, in bereits gut abgedeckte Kreuzungen zu laufen), statt von der Fallenanzahl überlagert zu werden.

**Dynamit:** Separate, per Upgrade freischaltbare Ressource (Start bei 0 — muss erst freigeschaltet werden). Vor der Ausführung kann der Spieler bis zu (Dynamitanzahl) bestehende Verbindungen sprengen — diese existieren für den Rest des Runs nicht mehr. **Keinerlei Einschränkung durch das Spiel:** das gezielte Isolieren ganzer Zonen oder das Einsperren von Gegnern in unerreichbare oder fallenlose Bereiche ist ausdrücklich erlaubt und kann Teil einer bewusst optimalen Strategie sein (z. B. einen unsicheren Ast komplett kappen und die verbleibende Bewegung in Richtung gut abgedeckter Fallen erzwingen, bis Kreuzungen faktisch deterministisch werden). Das ist gewollt, kein zu behebendes Degenerations-Risiko — dieser Automat SOLL bei genug Investition "brechbar" werden, genau wie die anderen drei auch (verdiente Meisterschaft, kein Bug).

**Keine Vorschau-Mechanik.** Die Tunnelnetz-Topologie ist immer vollständig sichtbar (kein Fog darauf) — es gibt schlicht keine verborgene Information mehr, die eine Vorschau aufdecken könnte. Die Herausforderung liegt komplett in der eigenen Wahrscheinlichkeits-/Strategieüberlegung des Spielers, nicht im Freischalten von Sicht.

**Netz-Generierung (pro Run einmalig fest, bevor Dynamit zum Einsatz kommt):** 4×4-Kreuzungs-Raster (16 Kreuzungen). Zufälliger Spannbaum (garantiert: JEDE Kreuzung von JEDEM Startpunkt aus erreichbar) + 3–4 zusätzliche zufällige Kanten für Schleifen/Alternativrouten — identisch zum bisherigen Generierungsverfahren (`generateNetwork` bleibt wiederverwendbar). Start-Kreuzungen der Gegner: einfach zufällig und unabhängig gezogen, KEINE Mindestabstandsregel mehr nötig (die diente nur der alten, jetzt verworfenen Kettenreaktions-Planbarkeit).

**Start-Kreuzungen müssen während der Planung bekannt/sichtbar sein (Korrektur nach Nutzer-Feedback, 2026-07-10, verbindlich):** Die Start-Kreuzung jedes Gegners wird EINMALIG zusammen mit dem Netz gezogen (nicht erst bei Ausführung) und ist während der gesamten Planungsphase am Netz sichtbar dargestellt (Farbe + Buchstabe je Gegner, wie am übrigen Netz). Nur der WEITERE Weg ab dieser bekannten Start-Kreuzung bleibt echte, erst bei "Los" live gewürfelte Zufallsbewegung (Punkt "Kernidee" oben). Ohne bekannte Start-Kreuzung gäbe es während der Planung überhaupt keinen Bezugspunkt für Fallen-/Dynamit-Platzierung — die Planungsphase wäre dann reines Raten statt eine Entscheidung auf Basis von Netz-Topologie + Startpunkt, was dem Kernanspruch dieses Automaten widerspricht.

**Kettenreaktion:** bleibt als seltener Bonus-Fall bestehen (zwei Gegner exakt im selben Ausführungsschritt an derselben Falle = zusätzlicher Bonus-Payout), ist aber NICHT mehr das Kernziel — bei echter Zufallsbewegung ist das reiner Glücksfall, kein planbares Ziel. Die Kernökonomie muss auch ganz ohne Kettenreaktionen tragfähig sein.

**Payout:** Einzelfang = kleiner positiver Payout, Kettenreaktion = größerer Bonus obendrauf, eine bis Run-Ende nie getroffene Falle zahlt 0 (kein negativer Payout-Fall, unverändert aus dem ersten Rework übernommen).

**Drei unabhängige, ticket-finanzierte Upgrade-Achsen:**

1. **Fallenanzahl** (Start bei 1): wie viele Fallen gleichzeitig platzierbar sind.
2. **Dynamitanzahl** (Start bei 0, muss freigeschaltet werden): wie viele Verbindungen pro Run sprengbar sind.
3. **Gegneranzahl** (Start bei 1, z. B. bis 4): wie viele Gegner gleichzeitig durch das Netz laufen — jede Stufe skaliert den Ertrag aus bereits vorhandener Fallen-/Dynamit-Infrastruktur, ohne dass dafür neue Entscheidungen nötig wären (reiner Multiplikator-Hebel, bewusst anders geartet als die anderen beiden Achsen).

**Live-Wirkung von Upgrades während der Planungsphase (Korrektur nach Nutzer-Feedback, 2026-07-10, verbindlich):** Fallenanzahl- und Dynamitanzahl-Upgrades wirken SOFORT, sobald sie im Shop gekauft werden — auch mitten in einer bereits laufenden Planungsphase. Kauft der Spieler z. B. während der Planung ein Dynamit-Upgrade, steht das zusätzliche Dynamit-Kontingent sofort für den GERADE laufenden Run zur Verfügung, nicht erst für den nächsten. Gegneranzahl-Upgrades wirken dagegen weiterhin erst ab dem NÄCHSTEN Run — analog zu Greed Runs Aktionsbudget (game-spec.md 4.2, dort dieselbe Begründung): die Gegner-Start-Kreuzungen werden einmalig bei Run-Start gezogen und bleiben während der gesamten Planungsphase sichtbar und fix (siehe Korrektur "Start-Kreuzungen müssen während der Planung bekannt/sichtbar sein" oben). Eine mitten in der Planung erhöhte Gegneranzahl müsste zusätzliche Start-Kreuzungen nachträglich ziehen, was diese Fixierung bricht — deshalb bewusst erst ab dem nächsten Run wirksam, im Code entsprechend zu dokumentieren.

**Blind-Erwartungswert-Garantie (automatisiert per Simulation über viele Seeds, unverändert aus dem ersten Rework):** eine Falle komplett blind (ohne Dynamit, ohne jede Überlegung) auf eine zufällige Kreuzung gesetzt muss im Schnitt positiv bleiben — das ist die Grundlage, NICHT die Obergrenze; mit klugem Dynamit-/Fallen-Einsatz darf und soll der tatsächliche Ertrag weit darüber hinauswachsen.

**Rundenstruktur (Lektion aus Phase 7h bleibt gültig):** Ein Run besteht aus GENAU EINER Planungs- (Fallen platzieren, optional Dynamit sprengen) + Ausführungsphase. "Los" sprengt zuerst die gewählten Verbindungen, danach lösen sich alle Gegnerbewegungen Schritt für Schritt live auf (einmal komplett im Voraus berechnet analog zum bisherigen `resolve()`-Muster, damit die Animation nur noch abspielt statt selbst zu würfeln) und beendet den Run danach unwiderruflich. Direkt danach startet immer ein neues Netz mit neuen Gegner-Startpunkten.

**Attendant-Automatisierung:** weiterhin eine grob vereinfachte Platzhalter-Schätzung (kein echtes Dynamit-/Fallen-Optimieren durch den Attendant), analog zum bisherigen Vorgehen, als bewusste Vereinfachung dokumentieren.

**Ökonomie-Anbindung, Architektur, Barrierefreiheit, Speicherstand:** unverändert aus dem ersten Rework (Meilenstein-Schwellen 25/60/120 und `ticketYieldFactor` ~0.913 bleiben, eigene Szene `TrapTunnelsScene.ts`, `milestonePips.ts` geteilt, Fallen als eigene Form/Raute, Gegner über Farbe UND Buchstabe unterschieden, `CURRENT_SAVE_VERSION` erneut erhöhen).

**Ausdrücklich noch nicht Teil dieser Version:** Fokus-Wahl-Analogon, größeres/anderes Netz als 4×4, mehr als eine Dynamit-"Sorte". Als möglicher Backlog vorgemerkt, nicht jetzt bauen.

### 4.4 Automat 3 — "Boost Barrage" (Space-Shooter-Twist, ersetzt den verworfenen "Beat Ledger"/DDR-Ansatz)

**Ersetzt ab hier vollständig die gemeinsame Zyklus-Mechanik aus 4.1/4.1b/4.1c für Automat 3.** Automat 4 bleibt unverändert bei 4.1/4.1b/4.1c.

**Verworfene Vorgänger-Ideen (Begründung, zur Nachvollziehbarkeit):** Ein Rhythmus-/DDR-Automat ("Beat Ledger") wurde verworfen, weil das Genre strukturell von Musik lebt — gute, abwechslungsreiche Musik ohne Lizenzkosten ist praktisch nicht leistbar, und ein Rhythmusspiel ohne Musik trägt sich nicht (Baukasten Abschnitt 2, "Genre-Versprechen brechen"). Eine Zwischenidee (Football-Manager-Spielzugplanung: Run/Pass-Calls gegen eine Verteidigungs-Tendenz) wurde ebenfalls verworfen, weil sie sich zu weit vom klassischen Arcade-Automaten-Gefühl entfernt hätte, das die anderen drei Automaten prägt.

**Kernidee:** Das Schiff steuert und feuert automatisch gegen eine anrückende Gegner-Formation (Autopilot). Der Spieler beobachtet den Ablauf live und aktiviert dabei begrenzt verfügbare Boosts, wenn er eine günstige Gelegenheit erkennt. Aktivierungsfenster sind großzügig bemessen (mehrere Sekunden) — verpasstes Timing bedeutet suboptimale Nutzung, keine Katastrophe. Das ist bewusst KEIN Echtzeit-Reflex im Sinne von Abschnitt 1: kein Millisekunden-Druck, nur eine informierte Entscheidung darüber, WANN eine begrenzte Ressource eingesetzt wird.

**Rundenstruktur (ersetzt 4.1 Punkte 1–2 für diesen Automaten):** Ein Lauf besteht aus einer festen Anzahl Wellen (Richtwert 5, NICHT upgradebar — Aufwand pro Lauf bleibt konstant, siehe Design-Prinzip unten). Jede Welle läuft automatisch und live ab, keine gesonderte Planungsphase davor nötig. Direkt danach folgt die nächste Welle, bis die feste Wellenanzahl erreicht ist.

**Gegner-Roster (pro Welle fest generiert):**

- **Scout** — häufigster Typ, schwach, vom Autopiloten zuverlässig getroffen, niedriger Punktwert. Trägt allein schon die Blind-Erwartungswert-Garantie (siehe unten).
- **Bomber** — selten, robuster. Lädt einen Flächenangriff auf, sichtbar signalisiert (Blink-Warnung) bevor er auslöst. Trifft der Angriff, kostet das Schaden/Ertrag.
- **Elite** — selten, hoher Punktwert, aber evasiv — vom Autopiloten allein nur selten zuverlässig getroffen.

**Vier Boosts, jeweils mit eigenem Cooldown und begrenzter Ladungszahl (Start je 1 gleichzeitig verfügbare Ladung):**

1. **Feuerkraft-Boost** (Overcharge) — erhöht Schaden/Feuerrate kurzzeitig. Vorteilhaft z. B. bei mehreren gebündelten Scouts (schnelles Aufräumen vor der nächsten Eskalationsstufe) oder um einen Bomber VOR voller Aufladung zu zerstören.
2. **Schild-Boost** — absorbiert/reduziert eingehenden Schaden kurzzeitig. Vorteilhaft z. B. wenn ein Bomber kurz vor Auslösung steht und nicht mehr rechtzeitig zerstörbar ist, oder generell in der aggressiveren Spätphase einer Welle.
3. **Ausweich-Boost** — weicht einem Angriff vollständig aus, Autopilot pausiert dafür kurz die eigene Offensive. Vorteilhaft z. B. wenn der Schild bereits verbraucht ist oder zwei Angriffe gleichzeitig eintreffen.
4. **Fokus-Boost** (Zielerfassung) — garantiert Treffer auf ein gewähltes Ziel kurzzeitig. Vorteilhaft v. a. gegen Elite-Gegner, die der Autopilot sonst kaum zuverlässig träfe.

**Eskalation innerhalb einer Welle:** Je mehr Gegner einer Formation zerstört wurden, desto aggressiver/schneller agieren die verbleibenden (klassischer Space-Invaders-Effekt). Das erzeugt einen echten Trade-off zwischen frühem Aufräumen (Feuerkraft) und dem Aufsparen von Schild/Ausweichen für die gefährlichere Spätphase.

**Vorschau/Vorwarnzeit:** Baseline zeigt eine Bedrohung (v. a. Bomber-Aufladung) erst kurz bevor sie eintritt (Richtwert 1 Sekunde) — reicht für reaktives Kontern. Das Vorschau-Upgrade verlängert diese Vorwarnzeit graduell (z. B. bis zu 3 Sekunden), was zunehmend proaktives statt nur reaktives Boost-Timing erlaubt.

**Drei unabhängige, ticket-finanzierte Upgrade-Achsen:**

1. **Vorschau/Vorwarnzeit** — proaktives statt nur reaktives Timing.
2. **Boost-Stärke** — mehr Wirkung pro Aktivierung, bei gleichbleibendem Aufwand (gleiche Anzahl Wellen, gleiche Anzahl Aktivierungsmöglichkeiten).
3. **Ladungen/Cooldown** — häufigere Boost-Nutzung pro Welle, ohne dass die Welle selbst länger würde.

**Bewusstes Design-Prinzip (Konsequenz aus vorheriger Diskussion, verbindlich):** Die Wellenanzahl pro Lauf ist NICHT upgradebar. Alle drei Achsen erhöhen ausschließlich den erwarteten Ertrag PRO Welle, nicht deren Anzahl — der Spieler soll mit gleichem manuellem Aufwand mehr erreichen, nicht mehr Aufwand für mehr Ertrag betreiben müssen. Das weicht bewusst von Automat 1s Aktionsbudget-Achse ab (dort erhöht mehr Budget sowohl die mögliche Reichweite als auch den nötigen Aufwand); hier NICHT rückwirkend angleichen, nur als bewusste Abweichung dokumentiert.

**Blind-Erwartungswert-Garantie (automatisiert zu prüfen, gleiches Prinzip wie bei den anderen Automaten):** Auch ganz ohne jeden Boost-Einsatz (reiner Autopilot) muss eine Welle im Schnitt positiv bleiben — getragen v. a. durch die zuverlässig getroffenen Scouts. Boosts erhöhen den Ertrag darüber hinaus, sind aber keine Voraussetzung für Netto-Fortschritt.

**Barrierefreiheit (gilt dauerhaft, siehe CLAUDE.md):** Scout/Bomber/Elite sowie die vier Boost-Typen unterscheiden sich jeweils durch Form/Symbol UND Farbe, niemals nur durch Farbe allein. Die Bomber-Aufladewarnung ist zusätzlich zur Farbänderung durch ein Blink-Muster/Symbol erkennbar.

**Attendant-Automatisierung:** Wie bei den anderen Automaten eine grob vereinfachte Platzhalter-Schätzung (angenommene durchschnittliche Boost-Nutzung basierend auf Musterkenntnis, keine echte Timing-Simulation durch den Attendant) — bitte in STATUS.md klar als bewusste Vereinfachung dokumentieren.

**Ökonomie-Anbindung, Architektur, Speicherstand:** Tickets-/Automaten-Punkte-Ausschüttung, Meilenstein-Schwellen und Speicherstand-Mechanik technisch wie bei den anderen Automaten (`EconomyStore`, `milestonePips.ts` geteilt). Eigene Szene (`BoostBarrageScene.ts` o. ä.), da die Mechanik strukturell vom gemeinsamen Zyklus-Modell abweicht (siehe CLAUDE.md Architektur-Kurzregel). `CURRENT_SAVE_VERSION` erneut erhöhen, alte Spielstände beim Laden ablehnen statt migrieren (etabliertes Vorgehen).

**Ausdrücklich noch nicht Teil dieser Version:** Loadout-Wahl (welche Boost-Typen pro Lauf aktiv sind), weitere Boost-Typen (z. B. EMP/Crowd-Control), echte optionale manuelle Steuerung als Experten-Extra. Als möglicher Backlog vorgemerkt, nicht jetzt bauen.

- **Warum stimmiger Ersatz für den verworfenen Beat-Ledger-Ansatz:** Space-Shooter ist archetypisch für "Arcade-Automat", braucht keine Musik-Abwechslung zum Funktionieren, und die Autopilot-plus-Boost-Struktur überträgt das Attendant-Prinzip (Baukasten 1.9) besonders natürlich, da die manuelle Kernmechanik selbst schon aus zeitlich großzügigen Aktivierungs-Entscheidungen statt Dauersteuerung besteht.

**Visuelle Umsetzung (Korrektur nach zwei Playtest-Runden, 2026-07-11, verbindlich):** Die erste Umsetzung (Phase 7m) erfüllte die Mechanik korrekt, vermittelte aber visuell keinen Weltraum-Shooter — eine flache horizontale Icon-Reihe mit Textfeedback darunter, ohne erkennbares Spielerschiff, Anflugrichtung, Kampf-Feedback oder Weltraum-Kulisse. Ein erster Korrekturversuch (weiterhin reine Phaser-Grafik-Primitive: Formation-Layout, Sternfeld, Schuss-/Explosions-Effekte) reichte laut zweitem Playtest IMMER NOCH NICHT, um "Shooter" statt "Icon-Liste" zu vermitteln. Entscheidung: Ausnahme von der Asset-Regel NUR für diesen Automaten (siehe CLAUDE.md "Ausnahme Automat 3", 2026-07-11) — ein kleines, selbst erzeugtes Sprite-/Textur-Set statt weiterer Primitiv-Verfeinerung. Die Mechanik selbst bleibt dabei bewusst unverändert: Boosts sind weiterhin optionale Buffs (kein zwingender Korrekt-Konter pro Gegnertyp — das wurde als Alternative erwogen, aber verworfen, weil es strukturell zu stark mit dem für Automat 4 geplanten Stance-Konter-Modell kollidiert hätte, siehe design-toolbox.md Abschnitt 3 Redundanz-Check).

1. **Spielerschiff:** Eigene Silhouette am unteren Bildschirmrand statt Primitiv-Dreieck.
2. **Formation statt Liste:** Gegner-Silhouetten (Scout/Bomber/Elite je eigene Form, weiterhin zusätzlich per Buchstabe unterschieden, Barrierefreiheits-Grundsatz bleibt unangetastet) in einer echten Formation (mehrere Reihen/Spalten) statt einer flachen Reihe.
3. **Kampf-Feedback:** Sichtbarer Schuss-/Laser-Effekt beim Auflösen eines Gefechts, Explosions-Sprite bei Zerstörung, sichtbar unterschiedliche Effekte für "zerstört"/"Bomber trifft"/"Elite entkommt".
4. **Weltraum-Kulisse:** Sternfeld-Hintergrund (aus der ersten Korrektur übernehmbar, falls es bereits überzeugt hat).

**Bewusst unverändert:** `BoostBarrageEngine.ts`, alle drei Upgrade-Achsen, die Blind-Erwartungswert-Garantie und das "Boosts sind optional, nie zwingend"-Prinzip — reine Überarbeitung von `BoostBarrageScene.ts`s Darstellungsschicht plus neuer Sprite-/Textur-Erzeugung. Technik zur Sprite-Erzeugung (z. B. zur Laufzeit generierte Canvas-Texturen vs. mitgelieferte einfache SVG-Dateien) im Ermessen von Claude Code, siehe CLAUDE.md.

### 4.5 Automat 4 — "Champion's Ledger" (Street-Fighter-Twist)

- **Thema:** Angriffs-/Block-/Konter-Tokens werden vorab gegen einen Gegner mit rotierendem Verhaltens-Zyklus geplant
- **Pattern-Basis:** Gegner rotiert durch Stances (aggressiv/defensiv/Finte) mit probabilistischen Übergängen, gelegentliche klar angekündigte Spezialmoves
- **Risiko-Achse:** Sichere Konter mit Grundschaden vs. riskante Kombo-Ketten mit hohem Schadenspotenzial bei Fehlschlagsrisiko
- **Hinweis:** Letzter Automat vor Hallen-Abschluss – bewusst als komplexester der vier positioniert (kombiniert Timing- und Vorhersage-Elemente der vorherigen drei)

---

## 5. Explizit nicht Teil dieser Spezifikation

- Layer 2 (Stadt, mehrere Hallen) – separates Dokument nach Abschluss von Layer 1
- Echtgeld-Monetarisierung jeder Art (siehe Baukasten 2: Bezahlpflicht für Macht/Tempo ist ausgeschlossen)
- Mehrspieler/PvP (siehe Baukasten 3: PvP + Chill-Solo schließt sich aus)
- Sound-/Art-Design-Details (separates Dokument)
- **Prestige-/Reset-Mechanismus (vorgemerkt, 2026-07-09):** Als Werkzeug gegen "früherer Automat wird irrelevant" erwogen, aber bewusst nicht in Layer 1 eingebaut (das Problem wird stattdessen durch gleichzeitig laufende Attendants aller Automaten gelöst, siehe 3.2). Ein "alles zurücksetzen, dafür mit dauerhaftem Multiplikator neu starten"-Mechanismus passt inhaltlich zum in 3.3 angedeuteten Übergang zu Layer 2 und sollte dort geplant werden.

## 6. Offene Design-Fragen

- ~~Welcher Automat startet Layer 0~~ – entschieden: "Greed Run" (Automat 1)
- Exakte Zahlenbalance (Payout-Tabellen, Schwellenwerte) – wird während Implementierung/Playtesting iterativ getunt, nicht vorab fixiert
- Visueller Stil / Art Direction – nicht Teil dieser Spezifikation
