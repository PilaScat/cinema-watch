# Backlog

Cosa resta da decidere o da fare nei prossimi rilasci. Una voce fatta si toglie da qui e va nel
[CHANGELOG](../CHANGELOG.md).

## Da fare

| Voce | Cosa serve |
|---|---|
| Altri circuiti | Coperti UCI, Webtic, The Space (v2026.10.9) e 18Tickets (v2026.10.10). Restano gli altri della ricognizione del 19/10: Liveticket (programmazione JSON, posto unico), Eplanet (8 cinema in Sicilia) e la coda lunga con captcha. Per ognuno serve la ricognizione delle API pubbliche (cinema, programmazione, pianta, posti presi) e poi la scelta di Filippo. |
| Cinema 18Tickets senza regione | 20 su 83 al 20/10, quasi tutti arene e sedi di Lab80 senza programmazione: la home non ha l'indirizzo. Serve un'altra fonte dell'indirizzo (per esempio la pagina informazioni del cinema), da verificare su qualche dominio. |
| Pagina del film limitata a 12 spettacoli | A Verona gli Avengers Infinity Vision cadono dopo il dodicesimo e non si vedono. Serve un "mostra tutti" o un filtro per formato nella pagina. |
| Mutation dei circuiti | Il 20/10 `legacy`, `the-space` e `t18` sono entrati nell'elenco di Stryker sul ramo `chore/mutation-circuits`: la mutation completa va chiusa con i risultati e la PR. |
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
