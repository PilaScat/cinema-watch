# Backlog

Cosa resta da decidere o da fare nei prossimi rilasci. Una voce fatta si toglie da qui e va nel
[CHANGELOG](../CHANGELOG.md).

## Da fare

| Voce | Cosa serve |
|---|---|
| Punteggio OpenSSF Scorecard (7,0 al 16/10) | Dal repo è fatto quello che si poteva: LICENSE col solo testo MIT (License), provenienza firmata allegata alle Release (Signed-Releases, conta dalla prossima Release), link diretto in SECURITY.md (Security-Policy, conta dal giro del 19/10). Maintained sale da sola da metà gennaio 2027, quando il repo ha 90 giorni. Restano bassi per scelta Code-Review, Branch-Protection e CI-Tests (push diretti su main) e Contributors. |
| Badge OpenSSF Best Practices | Le risposte sono pronte in [best-practices.md](best-practices.md). Filippo si iscrive su bestpractices.dev con il suo account GitHub, incolla le risposte e valuta i due criteri sullo sviluppatore; con l'id del progetto il badge va nel README. |

## Scelte confermate dopo le revisioni

Le revisioni le hanno segnalate. Restano così e sono scritte qui perché non tornino come problemi.

- "Posti liberati" scatta anche quando la pianta diventa leggibile per la prima volta con posti buoni: il primo avviso era solo testo, con la zona "non disponibile".
- "Spostato" vale anche per uno spettacolo sparito nel giro prima e non ancora annullato, e per un cambio d'ora o di sala sulla stessa chiave.
- Lo stato di uno spettacolo esce all'inizio dello spettacolo; l'andamento resta 30 giorni. Il registro ruota a 500 eventi, quindi non si pulisce per spettacolo.
- Il confronto della password usa `scrypt` con un sale per processo: non si conserva nessun hash.
- Le piante per giro restano impostabili da 1 a 10 (predefinito 3).
- Telegram non usa il client JSON di `http.ts` (le code per host bloccherebbero gli invii durante il long polling): condivide la guardia `createGuardedFetch`, cioè solo https verso gli host consentiti e niente redirect.
- Scorecard Code-Review e Branch-Protection restano basse per la scelta dei push diretti su main.
