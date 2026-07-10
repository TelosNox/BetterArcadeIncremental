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

Automaten 2–4 teilen sich weiterhin dieselben Kernsysteme (Details siehe `implementation-plan.md`, Abschnitt Engine):
- **PatternEngine** – probabilistische Zustandsübergänge, progressive Teilaufdeckung durch Upgrades
- **AttendantEngine** – automatisierte Ausführung nach Musterkenntnis-Wert

**Ausnahme Automat 1 ("Greed Run"):** Bekommt ab 2026-07-10 eine eigene, genre-spezifische Mechanik (5×5-Sektorenfeld statt zyklisches Pattern, siehe 4.2) — nutzt `PatternEngine` nicht mehr. Ein bewusstes Genre-Rework-Experiment, siehe CLAUDE.md für die zugehörige Architektur-Konsequenz (eigene Szene statt der bisher einzigen generischen `MachineScene.ts`). Gemeinsam bleibt für alle vier Automaten die Hallen-Ökonomie (`EconomyStore`, Tickets/Automaten-Punkte, Meilensteine, Speicherstand).

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

**Rundenstruktur:** Bleibt im Kern "Planen → Ausführen/Zusehen → Ergebnis" (4.1) — eine Planungsrunde kann 1 bis zu (verbleibendes Aktionsbudget) Schritte umfassen, je nachdem wie weit der Spieler seiner aktuellen Sichtweite vertraut. Weiterhin kein Echtzeit-Reflex nötig, frei einteilbare Bedenkzeit.

**Attendant-Automatisierung:** Die bestehende `AttendantEngine`-Mathematik (Erwartungswert über die stationäre Markov-Verteilung des zyklischen Patterns) passt nicht mehr direkt, da es kein zyklisches Pattern mehr gibt. Für diese Experimentierphase reicht eine grob vereinfachte Platzhalter-Schätzung (z. B. erwarteter Payout pro Zug basierend auf den Kategorien-Grundwahrscheinlichkeiten und dem aktuellen Fokus/Präzision, ohne echte Pfadplanung) — bitte in STATUS.md klar als bewusste Vereinfachung dokumentieren, keine perfekte Nachbildung erzwingen.

**Ökonomie-Anbindung** (Tickets/Automaten-Punkte-Ausschüttung pro Zug, Meilenstein-Pips, Speicherstand-Mechanik) bleibt technisch unverändert (`EconomyStore`, Meilenstein-Logik) — nur die Zug-Auflösung und die Vorschau sind neu.

**Speicherstand:** Da sich die interne Struktur für Automat 1 grundlegend ändert, `CURRENT_SAVE_VERSION` erneut erhöhen, alte Spielstände beim Laden ablehnen statt migrieren (etabliertes Vorgehen aus Phase 7d/7e).

- **Warum Layer-0-Kandidat:** Kernidee (Risiko vs. Gier beim Sammeln) ist ohne Erklärung sofort verständlich — gilt mit dem neuen Feld-Modell unverändert weiter.

### 4.3 Automat 2 — "Trap Tunnels" (Dig-Dug/Q*bert-Twist)

- **Thema:** Fallen werden vorab in einem unterirdischen Raster platziert, Gegner bewegen sich deterministisch entlang ableitbarer Pfade
- **Pattern-Basis:** Am wenigsten Zufall der vier Automaten – nahezu vollständig aus dem Tunnellayout ableitbar, daher der "reinste" Skill-Test
- **Risiko-Achse:** Fallen früh/sicher platzieren vs. auf Ketten-Reaktionen mit mehreren Gegnern warten (höherer Multiplikator, höheres Fehlschlagsrisiko)

### 4.4 Automat 3 — "Beat Ledger" (DDR/Whac-a-Mole-Twist)

- **Thema:** Begrenzte Beat-Tokens werden vorab auf eine Zeitleiste/ein Notenraster gelegt, Runde läuft im Takt automatisch ab
- **Pattern-Basis:** Rhythmus/Pattern ist von Anfang an bekannt (wie Noten) – Herausforderung liegt in der Umsetzung der Planung, nicht im Erraten der Umgebung
- **Risiko-Achse:** Enge Kombo-Fenster (hoher Multiplikator, leicht zu verfehlen) vs. entspannte Abstände (sicher, geringerer Multiplikator)

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
