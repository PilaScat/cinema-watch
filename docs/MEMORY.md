# Memoria del progetto: decisioni e trappole

Quello che non si capisce leggendo il codice. Le API sono descritte in [api.md](api.md).

## Dati UCI e Webtic

- **Chiave di uno spettacolo**: `{LocalId}-{PerformanceId}`. Il PerformanceId di Webtic è unico
  solo dentro un cinema (LocalId), quindi da solo non basta come chiave. La chiave di una sala è
  `{LocalId}-{ScreenId}`. Fuori dai client di UCI e Webtic l'app usa solo queste chiavi, come
  stringhe: i circuiti che verranno avranno chiavi con un prefisso (per esempio `space-…`), così
  non si scontrano con i LocalId. Le chiavi di UCI e Webtic sono rimaste uguali nel cambio del
  19/10/2026: stato, storico, zone delle cacce e piante salvate non sono cambiati.
- **Circuiti**: runner e watcher passano da `src/circuits/` (un adapter per circuito, scelto dallo
  slug del cinema). Per una chiave vecchia senza cinema, come quella di un link Telegram, il
  circuito si ricava dallo stato delle cacce o dall'elenco dei cinema Webtic.
- **Giorno del cinema**: `performances[].day` è il giorno di programmazione. Lo spettacolo delle
  00:01 del 16 ha `day` 15. Date e giorni della settimana usano `day`; i filtri "dalle/alle"
  usano l'ora reale. L'orario di un giorno (`dayTimes`, chiave = giorno della settimana di `day`)
  sostituisce del tutto Dalle e Alle generali: un suo Alle vuoto vuol dire senza limite, non
  "quello generale" (scelta di Filippo del 20/10/2026).
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
- **Ricerca e film Webtic**: nella pagina Cerca i film di un cinema Webtic vengono dal controllo settimanale, e si aggiornano (solo in memoria) ogni volta che il giro di una caccia legge la programmazione di quel cinema. Un film uscito in settimana in un cinema che nessuna caccia segue compare quindi solo al controllo dopo. Scelta di Filippo del 17/10/2026: una rilettura quotidiana di tutti i cinema non serve, perché le cacce leggono già la programmazione vera a ogni giro.
- **Titoli Webtic**: un film ha un titolo per versione ("(Lingua Orig) Avengers: Doomsday", "Avengers: Doomsday Infinity Vision", "Dune - Parte Tre Anteprima"). Lo slug si ricava dal titolo senza i tag fra parentesi, senza "Anteprima" e senza l'edizione, così coincide con quello UCI e una caccia per slug vale per tutti e due i circuiti. "Infinity Vision" diventa il formato `2D - INFINITY VISION`. La lingua viene dalla proprietà `LANGUAGE` (`EN` diventa `ENG` come in UCI; senza la proprietà è `ITA`).
- **Coordinate**: 179 sedi candidate su 409 hanno le coordinate a 0, compresi 5 Notorious, e stanno in fondo all'ordine per distanza (scelta di Filippo del 17/10/2026). La regione si ricava dalla sigla della provincia (`src/regions.ts`).

## Cinema The Space

- **Chiavi**: cinema `space-<cinemaId>`, spettacolo `space-<cinemaId>-<sessionId>`, sala `space-<cinemaId>-<slug del nome della sala>` (per esempio `space-1028-sala-7`). Il prefisso evita lo scontro coi `LocalId` di Webtic, che hanno numeri simili.
- **Token ospite**: va chiesto a `/auth/token` e rimandato con **tutti** i cookie della risposta. Il token vale solo sul server che l'ha emesso, e `__cflb` è il cookie di Cloudflare che tiene le richieste su quel server: senza, la programmazione risponde a volte 401 e i posti sempre (verificato il 20/10/2026). Si rinnova dopo 11 ore o al primo 401; due richieste insieme aspettano lo stesso rinnovo.
- **Asse delle file**: `seatRows` arriva nell'ordine della sala, fila A per prima e schermo in alto, come sul sito (verificato a vista il 19/10/2026). `rowIndex` non serve: la fila A ha 15 in una sala e 10 in un'altra. La fila è la posizione nell'elenco più uno, la colonna la posizione nella fila più uno.
- **Stati dei posti**: 0 libero; 1, 9 e 11 venduto; 4, 8 e 10 nel carrello di qualcuno, che conta come preso come `BLOCCATO` di Webtic; 3 carrozzina e 7 accompagnatore vanno nel settore `UN` e non sono vendibili; 12 non è un posto e si salta; gli altri sono `RISERVATO`. Il prezzo "da" è il minimo delle aree che hanno posti `STANDARD`.
- **Giorno del cinema**: gli spettacoli dopo mezzanotte (`isMidnightSession`) stanno già nel gruppo del giorno prima, come in UCI.
- **Orario dello spettacolo**: la pianta non lo porta. Il circuito lo prende dalla programmazione letta dal giro o, se lo spettacolo non è noto, rilegge la programmazione del cinema; uno spettacolo che non c'è più dà "Pianta non disponibile".
- **Regione**: dalla sigla della provincia in fondo a `<address>`; 6 cinema su 35 hanno solo il CAP, e allora la regione viene dalle prime due cifre del CAP, che indicano la provincia del capoluogo (`regionOfPostalCode`).
- **Elenco dei cinema**: un controllo settimanale legge i 35 cinema e le loro pagine e salva `/data/space-venues.json`; se fallisce resta l'elenco di prima e si riprova dopo un'ora. Una richiesta di programmazione per cinema a giro dà tutti i giorni.
- **Cloudflare**: dal server di casa le richieste passano (prova dal container del 19/10/2026).

## Cinema 18Tickets

- **Chiavi**: cinema `t18-<etichette del dominio unite da ->` (per esempio `t18-nuovoolimpia-ccroma`), proiezione `<slug del cinema>-<uuid>`, sala `<slug del cinema>-<uuid della sala>`. Il dominio di un cinema si ricava dall'elenco salvato o dalle Impostazioni, non dallo slug, perché un'etichetta può contenere un trattino.
- **Limite di richieste**: 18Tickets risponde 429 dopo circa 6 pagine HTML in 30 secondi dallo stesso gestore (`ccroma`, `ccgenova`…: l'etichetta prima di `18tickets.it`), per circa un minuto, senza `Retry-After`. Le chiamate JSON `/seats` non contano: 150 di fila passano. Misurato il 20/10/2026; una pagina ogni 10 secondi per gestore ne ha passate 10 su 10, ed è la metà del limite. Dopo un 429 il gestore aspetta un minuto. Un cinema costa una pagina a giro (la home); la pagina del film resta in cache 24 ore e la pianta 7 giorni in `screens/`.
- **Elenco dei cinema**: i 65 domini del censimento del 19/10/2026 in `src/circuits/t18-hosts.ts`, più quelli delle Impostazioni (Altri cinema 18Tickets) e quelli trovati nelle pagine di gruppo. Un dominio è un gruppo se la sua home ha più luoghi o almeno due link a cinema sotto di sé, o se reindirizza a `/select_cinema`. Il controllo è settimanale, e riparte subito se nelle Impostazioni compare un dominio mai controllato; un dominio che risponde 429, 5xx, va in timeout o in errore di rete si riprova una volta in fondo alla coda, e un cinema che non risponde nemmeno allora resta con i dati della volta prima. Salvato in `/data/t18-venues.json`, senza coordinate: in fondo all'ordine per distanza (scelta di Filippo del 19/10/2026). Il 20/10/2026 il controllo ha trovato 82 cinema su 92 domini in 7 minuti; 20 senza regione, quasi tutti arene e sedi di Lab80 senza programmazione, la cui home non ha l'indirizzo.
- **Giorno del cinema**: le proiezioni stanno sotto l'intestazione del giorno della home, che è il giorno del cinema; l'ora vera viene da `data-time` (millisecondi), convertita in Europe/Rome.
- **Formato e lingua**: il formato viene dall'etichetta o dal titolo (3D, IMAX, 4DX; INFINITY VISION è un'edizione del 2D). La lingua è `VO` se l'etichetta dice INGLESE o LINGUA ORIGINALE, se il titolo porta "V.O." o "V.O.S.", o se "Lingua:" non è italiano; l'etichetta conta più del campo, che a volte dice "Italiano" anche per la versione inglese. La durata "(1H50')" si toglie dal titolo e diventa `durationMinutes`.
- **Pianta e posti**: l'id della pianta `g_<fila>_<colonna>` corrisponde a `{x: colonna, y: fila}` dei posti presi (105 su 105 nella sala di prova). Le file crescono dallo schermo (fila A = 2). I posti `userhide` non esistono per la vendita (fuori dal `total`); quelli `special` visibili valgono `RISERVATO`. `bought` è venduto; `locked`, `reserved`, `quarantined`, `preemption` e `mine` contano come presi. Nessun prezzo: `priceFrom` resta vuoto.
- **Sala di una proiezione**: la home non la dice; viene da `data-theater` nella pagina del film, letta solo quando serve la pianta.

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

- **Indietro**: una pagina aperta da un'altra riceve `from` (percorso e query di chi l'ha aperta) e il suo Indietro ci torna; senza `from` resta il genitore fisso (cinema, scheda del cinema, home), e uno spettacolo con `hunt` valido torna a `/hunts/<id>#showings`. `from` vale solo se è un percorso locale (`localPath` in `src/web/parts/navigation.ts`: inizia con `/`, niente `//`, `\` o caratteri di controllo, al massimo 1000 caratteri), così nessun link porta fuori. Richiesta di Filippo del 20/10/2026.

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
- **Nome del file di `gh attestation download`**: su Linux è `sha256:<hex>.jsonl`, su Windows
  `sha256-<hex>.jsonl`. `release.yml` lo prende con `sha256?<hex>.jsonl`. Provarlo solo su Windows
  ha fatto fallire il job Release della v2026.10.7 (19/10/2026), completata poi a mano.
