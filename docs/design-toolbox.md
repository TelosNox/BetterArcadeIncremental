# Incremental-Game Design-Baukasten

Dieses Dokument ist **spielunabhängig**. Es fasst zusammen, welche Mechaniken bei Incremental-/Idle-Spielen nachweislich gut funktionieren, welche schlecht ankommen, und wie man neue Mechanik-Ideen dagegen prüft. Jede neue Feature-Idee für unser Spiel sollte gegen die Checkliste am Ende laufen, bevor sie umgesetzt wird.

---

## 1. Was gut funktioniert (und warum)

### 1.1 Sichtbarer Fortschritt auf mehreren Zeitskalen gleichzeitig
Fortschritt sollte auf Sekunden- (Aktion), Minuten- (Upgrade), Stunden- (Freischaltung) und Tage-Ebene (Prestige/Meilenstein) gleichzeitig sichtbar sein. So lohnt sich sowohl eine 5-Minuten- als auch eine 5-Stunden-Session.

### 1.2 Reset/Prestige als aktive, einschätzbare Wahl
Ein Reset funktioniert nur, wenn der Spieler die Beschleunigung vorher abschätzen kann und selbst entscheidet, wann er zurücksetzt – nicht wenn er dazu gezwungen wird.

### 1.3 Verdiente Automatisierung
Automatisierung sollte nicht von Anfang an da sein (fehlendes Kompetenzgefühl) und auch nicht nie kommen (wird zur Arbeit). Der Spieler muss ein System zuerst manuell verstehen/meistern, bevor es sich automatisiert – und aktives Spielen sollte der Automatisierung weiterhin überlegen sein, damit sich niemand zum Zusehen gezwungen fühlt.

### 1.4 Strukturell unterschiedliche Layer/Systeme
Jede neue Ebene (neue Mechanik, neue Währung, neuer Bereich) muss sich **strukturell** von der vorherigen unterscheiden, nicht nur im Namen/Skin. Eine Kopie mit anderem Präfix ("Anti-X" statt "X") wirkt nach ein bis zwei Wiederholungen wie Content-Streckung.

### 1.5 Echte Entscheidungen statt reinem Zusehen
Systeme mit tatsächlichem Entscheidungsraum (Build wählen, Ressourcen priorisieren, Risiko vs. Sicherheit abwägen) fühlen sich als Spiel an statt als Bildschirmschoner.

### 1.6 Ein erkennbares Ende oder klare Zyklen
Menschen brauchen ein Abschlussgefühl. Ein System, das "durchgespielt" werden kann, schlägt tendenziell das unendliche Fließband – danach optional ein Score-Attack-/Endlos-Modus für Optimierer, aber die Basisrunde hat ein echtes Ende.

### 1.7 Belohnung, die verdient wirkt
Fortschritt durch Zeit oder Geschick fühlt sich fundamental anders an als gekaufter oder abgewarteter Fortschritt – auch bei identischer Zahl am Ende.

### 1.8 Reveal-/Mystery-Hook
Spiele, die ihre wahre Tiefe erst nach und nach zeigen, erzeugen Neugier als zusätzlichen Antrieb neben reinem Fortschrittsgefühl. Wichtig: **Der große Überraschungseffekt funktioniert nur einmal richtig gut** – nachfolgende Ebenen brauchen eigene, kleinere Haken statt denselben Trick zu wiederholen.

### 1.9 "Plan → Zusehen"-Schleifen als Automatisierungs-Brücke
Wenn die Kernmechanik ohnehin "vorab planen, dann Ergebnis beobachten" ist, lässt sich Automatisierung elegant lösen: Ein NPC/Attendant übernimmt exakt dieselbe Planungslogik, nur mit geringerer Erfolgsquote – kein separates Auto-Klick-System pro Mechanik nötig.

### 1.10 Auflösbare Ungewissheit statt echtem Zufall
Es gibt zwei Arten von Ungewissheit: **auflösbar** (Regeln unbekannt, aber lernbar durch Beobachtung) und **echter Zufall** (auch mit perfektem Wissen unvorhersagbar). Strategie-Gefühl entsteht nur aus der ersten Art. Konkrete Umsetzung:
- Verhalten von Gegnern/Umgebung über eine **Wahrscheinlichkeitsverteilung** (z. B. Markov-artige Zustandsübergänge) statt fixem Skript UND statt reinem Würfel
- Upgrades decken die **Verteilung selbst** auf ("nach Block folgt zu 70 % Finte"), nicht das exakte nächste Ereignis
- Verhindert stumpfes Auswendiglernen, belohnt aber trotzdem echtes Lernen

### 1.11 Sichtbare Risiko-Bandbreiten statt versteckter Varianz
Zufall darf würzen, aber nur als klar kommunizierte Spanne ("Schaden 8–10"), nie als versteckte Chance. Mehrere unabhängige versteckte Zufallsebenen gleichzeitig vermeiden – jede weitere Variable multipliziert das Rauschen und begräbt den Skill-Anteil.

### 1.12 Milestone + Banking als natürlicher Strategiewechsel (Push-your-luck)
Statt künstlich neue Dimensionen nachzuschieben, erzeugt ein System aus Meilenstein-Schwellen + freiwilliger "Banking"-Option (bisherigen Lauf sichern vs. weitermachen) den Sicher-oder-Riskant-Strategiewechsel von ganz allein: Wer wenig zu verlieren hat, geht eher Risiko ein; wer viel Polster hat, wird vorsichtiger. Diese Kurve muss nicht gescriptet werden, sie entsteht aus der Situation.

### 1.13 Opt-in-Tiefe
Standardmäßig ein einfaches, qualitatives Signal (z. B. Ampel: sicher/ausgewogen/riskant). Exakte Zahlen/Verteilungen sind ein optionales Tiefen-Upgrade. So bleibt der Einstieg zugänglich, während Optimierer ihre Tiefe bekommen.

### 1.14 Cross-Layer-Feedback
Höhere Ebenen sollten rückwirkend niedrigere verbessern (z. B. eine übergeordnete Ausbildung verbessert die Automatisierungs-Erfolgsquote einer unteren Ebene), damit ältere Systeme nicht zu stillgelegten, ignorierten Zahlen verkommen.

---

## 2. Was schlecht ankommt (und warum)

| Muster | Warum es schadet |
|---|---|
| Künstliche Zeitsperren ohne Interaktion | Fühlt sich wie Strafe fürs Weiterspielen an, nicht wie Fortschritt |
| Bezahlpflicht für Macht/Tempo | Zerstört intrinsische Motivation, auch bei Nicht-Zahlern, sobald "andere kaufen sich vorbei" wahrgenommen wird |
| Genre-Versprechen brechen | Ein "Idle"-Spiel, das plötzlich Dauerklicken erzwingt (oder umgekehrt), bricht den impliziten Vertrag mit dem Spieler |
| Unerklärte Komplexität ohne Einführung | Kontraintuitive Regeln ohne Ankündigung wirken wie Bestrafung statt Rätsel |
| Redundante Layer | Neue Ebene = alte Ebene mit anderem Namen → Enttäuschung nach 1-2 Wiederholungen |
| Verwaiste/instabile Entwicklung | Investierte Zeit in ein System, dessen Abschluss nie kommt, untergräbt Vertrauen unabhängig von der Mechanik-Qualität |
| Nachträgliche Monetarisierungsänderung nach Bindung | Wird als Vertrauensbruch empfunden, stärker als dieselbe Monetarisierung von Anfang an |
| Grind, der nur über FOMO/Sunk-Cost trägt | Sieht wie Engagement aus, führt aber zu Erschöpfung statt echter Bindung |
| Reiner/versteckter Zufall ohne lernbares Muster | Kippt Strategie-Gefühl in Glücksspiel-Gefühl, egal wie viel Planung vorgeschaltet ist |
| Reveal-Trick mehrfach wiederholen | Nutzt sich beim zweiten Mal spürbar ab |
| Sicher-vs-riskant ohne echten Trade-off | Wenn ein Weg objektiv immer besser ist (höherer EV bei gleicher oder geringerer Varianz), gibt es keine echte Entscheidung mehr |
| Künstlich nachgeschobene "neue Dimensionen" nur um Endlosigkeit zu erzwingen | Fühlt sich unehrlicher an als ein System, das sauber endet |

---

## 3. Kombinationsregeln

| Kombination | Verhältnis | Bedingung |
|---|---|---|
| Prestige-Reset + echte Build-Entscheidungen | ✅ Synergie | – |
| Automatisierung + neue manuelle Entscheidungsmomente | ✅ Synergie | Nur Altes automatisieren, Neues bleibt aktiv |
| Endloses Wachstum + Permadeath/Sterblichkeit | ⚠️ bedingt | Nur lösbar mit zwei Ebenen: innerer Zyklus sterblich, äußere Meta-Währung permanent |
| Tiefe Optimierung + Zugänglichkeit | ✅ lösbar | Über Opt-in-Tiefe (einfacher Kern, optionale Tiefe) |
| Zeitlich begrenzte Events + faires F2P | ⚠️ konfliktträchtig | Nur ok, wenn Belohnungen kosmetisch bleiben, nie Kernmacht |
| Kompetitives PvP + entspannter Solo-Chill-Loop | ❌ schließt sich aus | Nicht im selben System kombinierbar |
| Klares Ende + unendliches Optimieren | ✅ lösbar | Zwei Modi: Story/Kampagne mit Ende + optionaler Endlos-/Score-Attack-Modus danach |
| Fixer Zyklus + volle Musterkenntnis | ❌ führt zu Auswendiglernen | – |
| Probabilistischer Zyklus + progressive Teilaufdeckung | ✅ lernbare Tiefe ohne Auswendiglernen | Aufdeckung der Verteilung, nicht des exakten Ereignisses |
| Milestone-Banking + Sicher/Riskant-Wahl | ✅ starke Synergie | Erzeugt Strategiewechsel ohne zusätzliches Scripting |

---

## 4. Prüf-Checkliste für neue Mechanik-Ideen

Vor jeder neuen Feature-Entscheidung:

1. **Skalen-Check:** Auf welcher Zeitskala (Sekunden/Minuten/Stunden/Tage) wirkt diese Mechanik? Deckt sie eine Lücke oder dupliziert sie eine vorhandene Skala?
2. **Redundanz-Check:** Fühlt sich das strukturell anders an als alles, was der Spieler schon kennt – oder ist es ein Reskin?
3. **Zwang-Check:** Zwingt die Mechanik zu einem bestimmten Spielstil (nur aktiv, nur passiv, nur zahlen), oder lässt sie echte Wahl?
4. **Zufalls-Check:** Ist die Ungewissheit lernbar (Muster/Verteilung) oder echter Zufall? Ist die Bandbreite sichtbar?
5. **Trade-off-Check:** Gibt es bei Sicher-vs-Riskant-Entscheidungen einen echten Grund, auch mal "Sicher" zu wählen?
6. **Abschluss-Check:** Hat das System (oder zumindest ein Zyklus davon) ein erreichbares Ende?
7. **Monetarisierungs-Check:** Beeinflusst Bezahlung Tempo oder Macht? Falls ja – stopp.
8. **Automatisierungs-Check:** Wird Automatisierung verdient, bleibt aktives Spielen überlegen, und bricht sie kein Genre-Versprechen?
9. **Cross-Layer-Check:** Bleibt jede bestehende Ebene auch nach Einführung neuer Ebenen relevant?
