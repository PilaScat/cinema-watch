# Memoria del progetto: decisioni e trappole

Quello che non si capisce leggendo il codice. Le API sono descritte in [api.md](api.md).

## Dati UCI e Webtic

- **Chiave di uno spettacolo**: `{LocalId}-{PerformanceId}`. Il PerformanceId di Webtic è unico
  solo dentro un cinema (LocalId), quindi da solo non basta come chiave.
- **Giorno del cinema**: `performances[].day` è il giorno di programmazione. Lo spettacolo delle
  00:01 del 16 ha `day` 15. Date e giorni della settimana usano `day`; i filtri "dalle/alle"
  usano l'ora reale.
- **Posti presi**: l'occupazione elenca solo i posti presi. `ACQUISTO` è venduto, `BLOCCATO` è nel
  carrello di qualcuno e si libera in pochi minuti: conta come preso, altrimenti gli avvisi dei posti
  liberati oscillano.
- **Posti vendibili**: `SeatType` fra quelli vendibili (default `STANDARD`) e settore diverso da
  `UN`, che è quello dei disabili. Il settore `HA` (VIP nelle sale XL e 2D di Verona) è vendibile.
  `RISERVATO` non si vende.
- **Asse della sala**: `Row` più basso è la fila più vicina allo schermo (fila A = `Row` 2 in tutte
  le sale viste). Due posti sono vicini se hanno lo stesso `Row` e `Column` consecutive.
- **Numeri dei posti**: non seguono sempre la posizione. A Campi Bisenzio la fila A parte da
  `A/20` sulla colonna più bassa. La centralità si calcola sulle colonne; il ritocco a mano della
  zona usa i numeri, perché sono quelli che si leggono in sala.
- **Formati**: i nomi in programmazione (`XL - INFINITY VISION`, `2D - INFINITY VISION`) e quelli
  dei cinema (`XL`, `2D`) si allineano con `normalizeFormat`. La parte dopo il trattino è
  un'**edizione** (`formatEdition`, oggi solo `INFINITY VISION`): un formato della caccia
  combacia col gruppo (`XL`), col nome intero o con l'edizione. Così "XL" prende anche l'XL
  Infinity Vision, e "INFINITY VISION" prende tutte le sale Infinity Vision ma non l'XL normale.
- **Distanza**: le coordinate dei cinema vengono da `/theatres` di UCI (`latitude`/`longitude`,
  stringhe); 0 o valori mancanti valgono "senza coordinate" e vanno in fondo all'ordine. La
  posizione del browser (`navigator.geolocation`) c'è solo in un contesto sicuro, quindi il
  pulsante "Usa la mia posizione" compare solo via HTTPS.
- **Login UCI**: Cloudflare e captcha. L'app non fa login e non compra: legge solo dati pubblici.

## Cinema Webtic

- **Due strade per Webtic**: i `LocalId` di UCI sono `LocalId` Webtic, ma il proxy UCI risponde solo per le sedi UCI. Gli altri cinema passano da `secure.webtic.it` diretto, con slug `webtic-<LocalId>`; i cinema UCI restano sul proxy perché dà anche il prezzo. Nel giro si smista per slug, nella pagina dello spettacolo per `LocalId`.
- **Stessi dati di UCI**: la pianta diretta coincide posto per posto con quella del proxy (Verona, sala 2, verificato il 17/10/2026), quindi asse delle file, posti vendibili e `BLOCCATO` valgono uguali. Anche `Day` è il giorno del cinema: lo spettacolo delle 00:10 del 16 sta nel giorno 15.
- **Quali sedi sono cinema**: Webtic non lo dice. L'elenco dei titoli per sede di `getLocalsTitles` è fermo al 2024 (mancano 4 Notorious su 9), e fra le 1171 sedi ci sono teatri, discoteche e acquapark. Le candidate sono le sedi con titoli non teatrali in quell'elenco più quelle con un nome da cinema, tolte UCI e TEST: circa 400. Una volta a settimana il watcher chiede la programmazione di ciascuna, in background e una richiesta alla volta, e tiene quelle con film. Ci vogliono 20-30 minuti, perché le sedi chiuse rispondono dopo 12 secondi. Il risultato sta in `/data/webtic-venues.json`; se il controllo fallisce o non trova nulla resta l'elenco di prima e si riprova dopo un'ora. Scelta di Filippo del 17/10/2026.
- **Il controllo ha un client HTTP suo**: coda e backoff separati da quelli delle cacce, così una sede lenta non ferma i giri e un errore di una caccia non tronca il controllo. Timeout di 30 secondi (le sedi chiuse rispondono a 12) e nessun backoff: una sede che va in timeout si salta, un errore di rete o un 5xx ferma il controllo, che altrimenti salverebbe un elenco troncato per una settimana. `close()` lo interrompe e non salva nulla.
- **Ricerca e film Webtic**: nella pagina Cerca i film Webtic vengono dal controllo settimanale, quindi un film uscito in settimana compare nei cinema Webtic solo al controllo dopo. Il giro delle cacce invece legge la programmazione vera ogni volta.
- **Titoli Webtic**: un film ha un titolo per versione ("(Lingua Orig) Avengers: Doomsday", "Avengers: Doomsday Infinity Vision", "Dune - Parte Tre Anteprima"). Lo slug si ricava dal titolo senza i tag fra parentesi, senza "Anteprima" e senza l'edizione, così coincide con quello UCI e una caccia per slug vale per tutti e due i circuiti. "Infinity Vision" diventa il formato `2D - INFINITY VISION`. La lingua viene dalla proprietà `LANGUAGE` (`EN` diventa `ENG` come in UCI; senza la proprietà è `ITA`).
- **Coordinate**: 179 sedi candidate su 409 hanno le coordinate a 0, compresi 5 Notorious, e stanno in fondo all'ordine per distanza (scelta di Filippo del 17/10/2026). La regione si ricava dalla sigla della provincia (`src/regions.ts`).

## Avvisi

- **Un avviso non si perde**: se Telegram fallisce o non è configurato, lo stato della caccia non
  avanza e gli stessi eventi si ripresentano al giro dopo.
- **Rischio accettato di un doppione**: su un errore di rete Telegram si riprova una volta. Se la
  risposta si era persa dopo l'invio, il messaggio arriva due volte. È raro e meno grave di un
  avviso perso.
- **Annullato**: solo per uno spettacolo futuro assente per 2 giri da un giorno letto con almeno
  uno spettacolo. Se l'ultimo spettacolo di un giorno sparisce, il giorno torna vuoto e
  l'annullamento non si vede: è il prezzo per non scambiare una risposta vuota di UCI per una
  cancellazione di massa.
- **Giorni nuovi in silenzio**: in una caccia già avviata, gli spettacoli di un giorno controllato per
  la prima volta (finestra "prossimi N giorni" che avanza, cinema aggiunto) si registrano senza
  avvisare. Un giorno conta come controllato appena UCI risponde, **anche se è vuoto**: così gli
  spettacoli che escono in un giorno già nella finestra avvisano. È il caso per cui l'app esiste.
- **Un'operazione alla volta**: giri, Aggiorna ora, Silenzia, Acquistato e conferma dei film passano
  da un solo mutex nel watcher; lo scheduler sta in `watcher.ts` e non in un modulo suo.

## Prestazioni

- **resvg su Windows è lento col testo**: la pianta di Verona si disegna in circa 800 ms su
  Windows e in circa 50 ms su Linux Alpine (misurato il 16/10/2026). Il costo è nella composizione
  dei testi, non nei pixel né nel caricamento dei font. Il test dei 500 ms vale solo su Linux; su
  Windows si salta. Per lo stesso motivo il limite dei test di Vitest è 15 s: con tutti i file in
  parallelo i test che disegnano piante su Windows superano i 5 s predefiniti.
- **Larghezza per Telegram**: le piante si disegnano a 1280 px (`TELEGRAM_PHOTO_WIDTH`), il lato
  che Telegram tiene per le foto.

## Browser e sicurezza

- **`Referrer-Policy: same-origin`, non `no-referrer`**: con `no-referrer` Chrome ed Edge mandano
  `Origin: null` su ogni POST. Su `http://IP` (contesto non sicuro) non mandano nemmeno
  `Sec-Fetch-Site`, quindi il CSRF di Hono rifiuta tutti i form con "Forbidden". Su HTTPS e su
  localhost `Sec-Fetch-Site` arriva e il problema non si vede: per questo l'e2e va lanciato anche
  sull'IP di LAN (`node scripts/e2e-ui.mjs http://<IP>:<porta>`). Trovato il 16/10/2026 alla prima
  installazione.
- **e2e e cinema Webtic**: la caccia su Notorious Merlata (`webtic-5779`) dell'e2e serve l'elenco
  dei cinema Webtic. Su una cartella dati nuova arriva solo a fine del primo controllo, circa mezz'ora;
  prima il controllo "cinema nel form" fallisce con "elenco dei cinema non pronto".

## Strumenti

- **Vitest resta alla 4**: con Vitest 5 Stryker 10 non attiva i mutanti (tutti "sopravvissuti",
  verificato il 16/10/2026). Dependabot ignora Vitest 5 finché Stryker non lo supporta.
- **Stryker fuori da Nextcloud**: dentro `D:\Nextcloud` la cartella `.stryker-tmp` dà `EPERM` sui
  file bloccati, quindi si lancia su un clone fuori dalla cartella sincronizzata.
