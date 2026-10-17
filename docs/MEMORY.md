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
- **Login UCI**: Cloudflare e captcha. L'app non fa login e non compra: legge solo dati pubblici.

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

## Strumenti

- **Vitest resta alla 4**: con Vitest 5 Stryker 10 non attiva i mutanti (tutti "sopravvissuti",
  verificato il 16/10/2026). Dependabot ignora Vitest 5 finché Stryker non lo supporta.
- **Stryker fuori da Nextcloud**: dentro `D:\Nextcloud` la cartella `.stryker-tmp` dà `EPERM` sui
  file bloccati, quindi si lancia su un clone fuori dalla cartella sincronizzata.
