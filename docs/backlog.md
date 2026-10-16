# Backlog

Cosa resta da decidere o da fare nei prossimi rilasci. Viene dalle revisioni prima della
v2026.10.1 (code review a due assi, revisione indipendente e avvisi di GitHub). Una voce fatta si
toglie da qui e va nel [CHANGELOG](../CHANGELOG.md).

## Da decidere

| Voce | Cosa serve |
|---|---|
| PR Dependabot #1, TypeScript 7 | Chiuderla o ignorare la major: `typescript-eslint` 8 non lo accetta ancora e la CI è rossa. |
| PR Dependabot #2, Node 25 | Chiuderla: Node 25 non è LTS. Le major di Node sono già ignorate in `dependabot.yml`. |
| `cooldown` in Dependabot | Un numero di giorni di attesa prima di proporre una versione nuova (zizmor lo segnala). Proposta: 7. |
| Messaggio d'errore su Telegram una volta al giorno per caccia | Oggi parte anche a caccia silenziata e il piano non lo chiedeva. Tenerlo, toglierlo o non mandarlo a caccia silenziata. |
| Piante per giro da 1 a 10 | Il piano diceva i migliori 3. Tenere l'impostazione o fissarla a 3. |

## Da fare

| Voce | Cosa serve |
|---|---|
| Ripristinare una caccia archiviata | Un pulsante "Ripristina" fra le Archiviate: oggi dopo Acquistato non si torna indietro, se non importando la configurazione. |
| Trivy sulle immagini pubblicate | Un job in `release.yml` che scansiona il digest di ogni piattaforma; oggi la scansione è su una build amd64 separata e l'arm64 non si scansiona. |
| Telegram attraverso `http.ts` | Far passare anche le chiamate a `api.telegram.org` dal client unico con gli host consentiti. Oggi l'URL è una costante in `telegram.ts`, quindi il guadagno è di coerenza. |
| Dividere `src/watcher.ts` | Scheduler e mutex restano lì; invio Telegram, disegno delle foto, pulizia, controllo versione e riepilogo in moduli loro. Poi rafforzarne i test: è il file con il mutation score più basso (80%, 114 mutanti sopravvissuti, alla v2026.10.1). |
| Dividere `src/web/routes/hunts.tsx` | Mappatura form-caccia, picker e pagina della zona fuori dalle route. |
| Un solo posto per le regex comuni | `SLUG`, `HALL_KEY` e `ISO_DAY` sono definite in `config.ts`, `hunts.tsx` e `browse.tsx`. |
| `huntById` e `telegramConfigured()` nel watcher | Togliere le ricerche ripetute di una caccia per id e il controllo `botToken() !== null` sparso nelle route. |
| Chiave dello spettacolo e della sala in una funzione | `${localId}-${performanceId}` e `${localId}-${screenId}` sono costruite a mano in più file. |

## Scelte confermate dopo le revisioni

Le revisioni le hanno segnalate. Restano così e sono scritte qui perché non tornino come problemi.

- "Posti liberati" scatta anche quando la pianta diventa leggibile per la prima volta con posti buoni: il primo avviso era solo testo, con la zona "non disponibile".
- "Spostato" vale anche per uno spettacolo sparito nel giro prima e non ancora annullato, e per un cambio d'ora o di sala sulla stessa chiave.
- Lo stato di uno spettacolo esce all'inizio dello spettacolo; l'andamento resta 30 giorni. Il registro ruota a 500 eventi, quindi non si pulisce per spettacolo.
- Il confronto della password usa `scrypt` con un sale per processo: non si conserva nessun hash.
