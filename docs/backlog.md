# Backlog

Cosa resta da decidere o da fare nei prossimi rilasci. Una voce fatta si toglie da qui e va nel
[CHANGELOG](../CHANGELOG.md).

## Da fare

| Voce | Cosa serve |
|---|---|
| Tutti i cinema italiani | Richiesta di Filippo del 19/10: descrizione e scopo dello strumento orientati a tutti i cinema italiani, non a UCI con l'aggiunta di Webtic. Descrizione del progetto (README, GitHub, `package.json`), testi della UI e docs sono fatti il 19/10; restano i circuiti che mancano, a partire da The Space Cinemas, che non vende con Webtic. Per ogni circuito serve prima una ricognizione delle API pubbliche (elenco dei cinema, programmazione, pianta, posti presi) e poi la scelta con Filippo. |
| Punteggio OpenSSF Scorecard (7,7 al 19/10) | Dal repo è fatto quello che si poteva: License, Signed-Releases, Security-Policy e CI-Tests sono a 10, CII-Best-Practices a 5 (badge passing). Maintained sale da sola da metà gennaio 2027, quando il repo ha 90 giorni: è l'unico avviso aperto in Security. Code-Review e Branch-Protection restano bassi (vedi sotto) e Contributors resta a 0. |

## Scelte confermate dopo le revisioni

Le revisioni le hanno segnalate. Restano così e sono scritte qui perché non tornino come problemi.

- "Posti liberati" scatta anche quando la pianta diventa leggibile per la prima volta con posti buoni: il primo avviso era solo testo, con la zona "non disponibile".
- "Spostato" vale anche per uno spettacolo sparito nel giro prima e non ancora annullato, e per un cambio d'ora o di sala sulla stessa chiave.
- Lo stato di uno spettacolo esce all'inizio dello spettacolo; l'andamento resta 30 giorni. Il registro ruota a 500 eventi, quindi non si pulisce per spettacolo.
- Il confronto della password usa `scrypt` con un sale per processo: non si conserva nessun hash.
- Le piante per giro restano impostabili da 1 a 10 (predefinito 3).
- Telegram non usa il client JSON di `http.ts` (le code per host bloccherebbero gli invii durante il long polling): condivide la guardia `createGuardedFetch`, cioè solo https verso gli host consentiti e niente redirect.
- Scorecard Code-Review (0) e Branch-Protection (3): dal 19/10 su `main` si entra solo con una pull request e la CI verde, anche per gli admin, ma per salire servono le approvazioni di un revisore diverso dall'autore, che un unico maintainer non ha. I due avvisi in Security sono chiusi come "won't fix" con questo motivo.
