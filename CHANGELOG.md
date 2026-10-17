# Changelog

Le versioni seguono il formato `vAAAA.MM.N`. Ogni sezione si scrive prima del tag.

## v2026.10.2

### Correzioni

- I form della web UI aperta da `http://IP:porta` rispondevano "Forbidden": con
  `Referrer-Policy: no-referrer` il browser mandava `Origin: null` e il controllo CSRF li
  rifiutava. Ora la policy è `same-origin`: il referrer resta nascosto ai siti esterni.
- Il messaggio d'errore giornaliero su Telegram rispetta Silenzia 24 h.
- Senza token il riepilogo delle 20:00 non si ritenta più ogni 30 secondi riempiendo il log.
- `Cross-Origin-Opener-Policy` solo quando la pagina arriva in HTTPS: da `http://IP` il browser
  lo ignorava e lo segnalava in console.

### Novità

- **Ripristina** per le cacce archiviate, fra le Archiviate e nella pagina della caccia. Se le
  date fisse sono finite, chiede prima le date nuove.

### Sicurezza

- Anche le chiamate a Telegram passano dalla guardia di uscita: solo HTTPS verso gli host
  consentiti, nessun redirect seguito.
- Il rilascio scansiona con Trivy l'immagine pubblicata di ogni piattaforma, arm64 compresa.
- Dependabot aspetta 7 giorni prima di proporre una versione nuova (gli aggiornamenti di
  sicurezza restano immediati) e non propone le major di TypeScript e di Node.
- `SECURITY.md` con il link diretto alla segnalazione privata e la divulgazione coordinata.

### Interno

- `watcher.ts` diviso: regole, registro, piante e manutenzione in moduli di funzioni pure, con
  test diretti dei casi limite.
- `hunts.tsx` diviso in form, schede di stato e pagina della zona.
- Regex e chiavi comuni in `keys.ts`; `huntById` e `telegramConfigured` nel watcher.

## v2026.10.1

Primo rilascio.

### Cacce

- Più cacce attive insieme, ognuna su uno o più cinema UCI, qualunque formato di sala, date fisse
  o prossimi N giorni, con filtri facoltativi per orario, giorni della settimana e lingua.
- Film scelto dal menu della programmazione, per slug quando non è ancora in programmazione, o per
  parole del titolo con conferma di ogni film trovato.
- Zona buona relativa (file e centro in percentuale) o ritoccata per sala cliccando sulla pianta,
  con il numero di posti vicini richiesti. Se la pianta di una sala cambia, la zona ritoccata va
  riconfermata.
- Intervallo predefinito e per caccia, fascia silenziosa, ritardo casuale, cache condivisa fra le
  cacce.

### Avvisi su Telegram

- Nuovi spettacoli, posti liberati (con pausa di 30 minuti), ultimi posti (con soglia e isteresi),
  spettacoli annullati o spostati, film comparsi, riepilogo giornaliero.
- Le piante dei migliori spettacoli in un album, poi un riepilogo con Acquista, Apri sala,
  Aggiorna ora, Silenzia 24 h e Acquistato. Migliori posti liberi e prezzo da in ogni messaggio.
- Comando `/aggiorna`, chat aggiuntive per caccia, code con i limiti di Telegram.
- "Invia prova" verifica che Telegram accetti l'URL pubblico come pulsante; se no, i link vanno
  nel testo.
- Token e chat dalle Impostazioni o dalle variabili d'ambiente.

### Web UI

- Cacce, cinema, ricerca di un film, programmazione, pagina dello spettacolo con la pianta dal
  vivo e l'andamento dei posti, registro, impostazioni con esporta e importa.
- Tema chiaro, scuro o automatico; installabile come PWA dietro HTTPS; password facoltativa.
- `/api/status` per il widget di Homepage e `/health` per il controllo del container.

### Container e sicurezza

- Immagine `ghcr.io/pilascat/cinema-watch` per amd64 e arm64, utente 99:100, compatibile con
  `--read-only` e `--cap-drop=ALL`, con SBOM, provenance e attestazione.
- CSP con nonce, CSRF, blocco dopo 5 tentativi di accesso, token mai nella pagina, nei log o
  nell'esportazione senza token.
