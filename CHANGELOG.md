# Changelog

Le versioni seguono il formato `vAAAA.MM.N`. Ogni sezione si scrive prima del tag.

## v2026.10.14

### Sicurezza

- **Node 24.22.1** nell'immagine, al posto della 24.22.0. Corregge le vulnerabilità del [bollettino Node.js di ottobre 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases): fra le alte, la verifica del nome host TLS aggirabile e la scrittura fuori limite nel decoder Brotli, entrambe sulla strada delle richieste HTTPS verso i cinema e Telegram. Aggiornata anche la base `alpine:3.24`. Basta aggiornare il container, dati e configurazione non cambiano.

### Progetto

- Il template Unraid sta in [PilaScat/unraid-templates](https://github.com/PilaScat/unraid-templates), il repo registrato in Community Applications, ed è in inglese. `deploy.sh` lo scarica da lì se sul server manca.
- README: badge "Unraid Community Apps", sezione "Su Unraid" nell'Avvio rapido e `docker-compose.yml` scaricato con `wget`.

## v2026.10.13

### Modifiche incompatibili

Il container ora parte come root, dà la cartella dei dati a `PUID:PGID` (predefiniti 99:100) e fa girare l'app con quell'utente, come le immagini standard di Unraid. Per questo **non parte più con `--cap-drop=ALL` senza `--user`**, cioè con le opzioni consigliate fino alla v2026.10.12 dal template Unraid, dal `docker run` e dal `docker-compose.yml` del README. In quel caso si ferma subito e scrive nel log come correggere. Le strade sono due, e ne basta una:

- **Togliere `--cap-drop=ALL`** e impostare `PUID` e `PGID`. È quello che fanno il template e il Compose nuovi.
  - Unraid: scheda Docker, cinema-watch, Edit. In Extra Parameters cancellare `--cap-drop=ALL`. Con "Add another Path, Port, Variable, Label or Device" aggiungere due Variable, Key `PUID` valore `99` e Key `PGID` valore `100`. Poi Apply.
  - `docker run`: togliere `--cap-drop=ALL` e aggiungere `-e PUID=99 -e PGID=100`, con l'utente che oggi è proprietario della cartella dei dati.
  - Compose: togliere `cap_drop` e aggiungere `PUID` e `PGID` in `environment`.
- **Tenere `--cap-drop=ALL` e aggiungere `--user 99:100`** (in Compose `user: "99:100"`), con lo stesso utente che è già proprietario della cartella dei dati. L'app gira come prima e l'entrypoint non tocca la cartella.

Chi non usa `--cap-drop=ALL` non deve fare niente. Dati e configurazione non cambiano.

### Novità

- **`PUID` e `PGID`**: nessun `chown` a mano prima del primo avvio. Una cartella dei dati creata da Docker o da Unraid (di root) passa da sola a `PUID:PGID`, e lo stesso succede se si cambia utente. Dopo il passaggio l'app gira senza nessuna capability. Template e Compose li hanno fra le variabili.
- **Percorso standard su Unraid**: il template propone `/mnt/user/appdata/cinema-watch`. Su Unraid 7.3.2 il FUSE applica `chown` e `chmod`, quindi `config.json` resta a `600`.

### Progetto

- README con i badge di versione, CI, licenza, ultimo commit, dimensione dell'immagine e piattaforme; immagini scure in una riga e anteprima social dal modello del repo.
- La descrizione dell'immagine su GHCR è quella del repo (tutti i circuiti, non solo UCI).
- Lo smoke del container gira anche nel CI, su `ubuntu-24.04`, e prova `PUID`/`PGID`, una cartella di root, `--user` con `--cap-drop=ALL` e gli errori di avvio.
- Gli adapter dei circuiti (Webtic, The Space, 18Tickets) sono entrati nel mutation test.

## v2026.10.12

### Novità

- **Indietro torna da dove sei venuto**: dallo spettacolo aperto da una caccia si torna alla caccia, sugli spettacoli; dal registro al registro con i suoi filtri; dal film aperto da Cerca alla ricerca; da una caccia nuova aperta da uno spettacolo o da un film a quella pagina. Il pulsante Apri sala di Telegram porta la caccia, quindi anche lì Indietro torna alla caccia e la pianta usa la sua zona buona.
- **Dalle e Alle uguali vuol dire tutto il giorno**, sia nell'orario generale sia in quello di un giorno: con 00:00 e 00:00 il sabato non segue più solo gli spettacoli di mezzanotte.

### Progetto

- README con una testata nuova: icona, nome, una frase e i badge di stelle, download dell'immagine e sponsor; tolta la descrizione inglese. Il repo ha il pulsante Sponsor (`.github/FUNDING.yml`).

## v2026.10.11

### Novità

- **Orario diverso per giorno**: nel form della caccia, sotto i giorni della settimana, ogni giorno può avere un suo Dalle e Alle che in quel giorno vale al posto di quelli generali. Per esempio feriali dalle 19 e sabato e domenica dalle 15. Le cacce esistenti non cambiano.

### Interno

- `config.json` passa alla versione 4 (`dayTimes` nelle cacce), con la migrazione automatica.

## v2026.10.10

### Novità

- **Cinema 18Tickets**: i cinema che vendono con 18Tickets (Circuito Cinema a Roma, Genova e Torino, Andromeda, Pop Up Cinema, Cinema Barberini e altri) entrano nella pagina Cinema, nella ricerca e nelle cacce, con pianta e posti presi. Il pulsante Acquista apre la proiezione sul sito 18Tickets del cinema.
- L'elenco parte dai domini noti e dalle pagine dei gruppi, con un controllo settimanale. Un cinema che manca si aggiunge nelle Impostazioni, sezione Cinema 18Tickets, e compare dopo il controllo che parte subito.

### Interno

- `config.json` passa alla versione 3 (`settings.t18Hosts`), con la migrazione automatica.
- Le pagine di 18Tickets si leggono con almeno 10 secondi fra due pagine dello stesso gestore, che altrimenti risponde 429.

## v2026.10.9

### Novità

- **The Space Cinema**: i 35 cinema del circuito entrano nella pagina Cinema, con regione e distanza, nella ricerca e nelle cacce. Programmazione, pianta e posti presi vengono dalle API del sito di The Space, e il pulsante Acquista apre lo spettacolo su thespacecinema.it. L'elenco dei cinema si aggiorna una volta a settimana.

### Interno

- Ogni circuito ha un adapter in `src/circuits/`; chiavi di spettacolo e di sala portano il circuito (`space-…`), e la pagina di uno spettacolo è `/showings/<chiave>`. I link già inviati su Telegram (`/performances/…`) portano alla pagina nuova; stato e storico passano da soli alla versione 2.

## v2026.10.8

### Progetto

- La descrizione del progetto parla dei cinema italiani, con la copertura di oggi: UCI Cinemas e i cinema che vendono con Webtic.
- I testi della web UI non nominano più un circuito solo: la pagina Cinema dice "I cinema" e l'etichetta di ogni scheda ne indica il circuito; l'avviso della ricerca parla di "catalogo dei film".
- Badge OpenSSF Best Practices, livello passing (progetto 15670). Le risposte stanno in `docs/best-practices.md` e `scripts/best-practices-fill.mjs` compila il modulo.

## v2026.10.7

### Progetto

- Ogni Release allega la provenienza firmata dell'immagine, `cinema-watch-<tag>.intoto.jsonl`.
- `LICENSE` contiene il solo testo MIT; le note delle parti di terzi passano in `NOTICE`, copiato anche nell'immagine.
- README con la sezione "Cosa fa", un riassunto in inglese, screenshot nuovi e la sezione Contribuire; nuovo `CONTRIBUTING.md`.

## v2026.10.6

### Novità

- **Annullo da Telegram**: dopo Silenzia 24 h il bot manda "silenziata fino alle HH:MM" con il pulsante Riattiva, e dopo Acquistato "caccia archiviata" con il pulsante Ripristina. Valgono solo dalla chat principale. Se le date fisse della caccia sono finite, Ripristina non la riattiva e rimanda alla pagina della caccia.

## v2026.10.5

### Novità

- **Cinema Webtic**: oltre a UCI, l'app segue i cinema che vendono con Webtic, fra cui Notorious, Cinelandia, Movie Planet, Starplex e molti indipendenti. Compaiono nella pagina Cinema con l'etichetta Webtic, per regione o per distanza da casa, e si scelgono nel form della caccia come quelli UCI.
- Le cacce sui cinema Webtic funzionano come quelle UCI: nuovi spettacoli, posti liberati, ultimi posti, annullati e spostati, con la pianta della sala su Telegram. "Acquista" apre lo spettacolo su Webtic dopo il login.
- La pagina Cerca trova anche i film proiettati solo nei cinema Webtic, e "Cinema con …" elenca i cinema dei due circuiti. I film dei cinema Webtic seguiti da una caccia si aggiornano a ogni giro.
- Il formato Infinity Vision vale anche per Webtic, dove l'edizione sta nel titolo.
- L'elenco dei cinema Webtic si aggiorna una volta a settimana in background. Al primo avvio la pagina Cinema avvisa che il controllo è in corso e mostra i cinema man mano che li trova.

## v2026.10.4

### Novità

- **Distanza da casa**: nelle Impostazioni, sezione Casa e distanza, si imposta la posizione di
  casa (incollando "lat, lon" da Google Maps, oppure con "Usa la mia posizione" quando l'app è
  aperta in HTTPS) e un raggio massimo facoltativo.
- Con la casa impostata, la pagina Cinema e i cinema di un film nella pagina Cerca sono ordinati
  dal più vicino con i km accanto; quelli oltre il raggio si vedono con "Mostra anche i lontani".
  Nel form della caccia i cinema vicini stanno in un gruppo "Vicino a casa" in cima.
- La configurazione passa alla versione 2: le configurazioni salvate ed esportate prima si
  aggiornano da sole.

## v2026.10.3

### Novità

- **Cerca senza il titolo esatto**: la pagina Cerca usa il catalogo UCI e trova i film anche da
  una parte del titolo ("avenger", "dun parte") o con un piccolo errore di battitura
  ("avangers"). Mostra i risultati con locandina, formati e date; cliccando un film si vedono i
  cinema che lo proiettano. Se il catalogo non risponde, si cerca il titolo esatto come prima.
- **Formato Infinity Vision** nelle cacce: segue tutte le sale Infinity Vision (XL, 2D, iSense,
  ScreenX) e non quelle normali. Il formato XL continua a prendere anche l'XL Infinity Vision.

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
