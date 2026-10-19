# API usate ed esposte

Questo documento descrive le API esterne che cinema-watch legge e le API che l'app espone. Le trappole dei dati (chiave di uno spettacolo, giorno del cinema, posti `BLOCCATO`, asse delle file) sono in [MEMORY.md](MEMORY.md) e qui non si ripetono.

## API esterne

Sono pubbliche, senza login, e non sono ufficiali: i circuiti possono cambiarle senza preavviso. Le risposte si validano con zod; un campo che manca o ha il tipo sbagliato scarta quell'elemento o dà un errore tipizzato, mai un arresto dell'app.

### Backend UCI

Base: `https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api`. Le richieste portano l'header `Referer: https://ucicinemas.it`. Tutte rispondono con `{ "data": ... }`.

| Chiamata | A cosa serve | Campi usati |
|---|---|---|
| `GET /theatres` | Elenco dei cinema | `slug`, `name`, `city`, `province`, `region`, `is_luxe`, `screens` (formati di sala del cinema) |
| `GET /theatres/{slug}/programming/{AAAA-MM-GG}` | Programmazione di un giorno | vedi sotto |
| `GET /theatres/{slug}/programming` | Programmazione di tutti i giorni, circa 2 MB: `data` è un elenco di oggetti `{ giorno: [film] }`. Serve solo alla UI | come sopra |
| `GET /movies` | Catalogo di tutti i film, circa 450 KB. Serve alla pagina Cerca, con una cache di un'ora | `slug`, `title`, `poster`, `first_performance`, `last_performance`, `screens[].name` |
| `GET /movies/{slug}` | Dettaglio di un film | `slug`, `title`, `poster` |
| `GET /movies/{slug}/theatres` | Cinema in cui il film è in programma | `slug`, `name`, `movie_variants` |

Ogni film della programmazione porta `slug`, `title`, `poster` e `screens`, un elenco di oggetti che hanno come chiave il formato (`IMAX`, `XL - INFINITY VISION`, `2D`) e come valore le versioni. Una versione ha:

- `language.name` e `duration` (`HH:MM`);
- `performances`, con `day` (giorno del cinema), `starts_at` (`AAAA-MM-GG HH:MM:SS`), `actual_start_at` (`HH:MM`), `room` e `cart_link`.

Da `cart_link` (`/movies/{film}/acquista/{LocalId}/{EventId}/{PerformanceId}`) l'app ricava i tre identificativi e il link di acquisto su `ucicinemas.it`. Uno spettacolo senza un `cart_link` in questo formato si scarta. Gli slug ammessi sono `[a-z0-9-]` e i giorni sono date ISO: altro non parte come richiesta.

### Proxy Webtic

Base: `https://uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app/Api2`. Le richieste sono `POST` con corpo JSON e portano `Origin: https://ucicinemas.it` e `Referer: https://ucicinemas.it/`. Gli identificativi devono essere interi positivi. Ogni risposta ha la forma `{ "Status": { "Success", "Message", "ReasonCode" }, "Data": ... }`; con `Success` falso l'app lo tratta come errore e ne riporta il `ReasonCode`.

| Chiamata | Corpo | Campi usati |
|---|---|---|
| `POST /Performance` | `{ LocalId, PerformanceId }` | `Performance` (`LocalId`, `EventId`, `PerformanceId`, `ScreenId`, `ScreenName`, `StartTime`), `Event.Title`, e dai prezzi in `Tickets.ShoppingModes[].PaymentModes[].SectorPrices[]` il minimo fra `PriceStartFrom` o, se manca, `Prices[].TotalPrice` |
| `POST /Screen` | `{ LocalId, ScreenId }` | `Screen.Seats[]` con `SeatId` (per esempio `F/12`), `SeatType`, `SectorId`, `Row`, `Column` |
| `POST /Occupancy` | `{ LocalId, PerformanceId }` | `Occupancy.Seats[]` con `SeatId` e `SeatStatus`: `ACQUISTO` è venduto, `BLOCCATO` è nel carrello, qualunque altro valore conta come preso |

La pianta di una sala (`/Screen`) cambia di rado: l'app la tiene in `screens/` per 7 giorni e la scarica prima se l'occupazione contiene posti che la pianta non ha.

Il proxy risponde solo per i cinema UCI: per un'altra sede dà `Unauthorized` (`ReasonCode` 1).

### Webtic diretto

Base: `https://secure.webtic.it/api/wtjsonservices.ashx`, con il metodo nel parametro `wtid`. Serve ai cinema che non sono UCI (Notorious, Cinelandia, Movie Planet e gli indipendenti). Nessun header particolare. Ogni risposta ha la forma `{ "userdata": { "StatusOk", "ReasonCode", "Message" }, "DS": ... }`; con `StatusOk` falso l'app lo tratta come errore. Una sede chiusa risponde con `StatusOk` falso dopo circa 12 secondi.

| Chiamata | A cosa serve | Campi usati |
|---|---|---|
| `GET ?wtid=getLocalsTitles` | Tutte le 1171 sedi, circa 1,3 MB | `LocalsTitles.Locals` (`LocalId`, `Description`, `Town`, `District`, `DistrictAbbreviation`, `Latitude`, `Longitude`) e `LocalsTitles.Titles[]` (`Category`, `Locals[].LocalId`) |
| `GET ?wtid=getFullScheduling&localid=N` | Programmazione di tutti i giorni di una sede, circa 100 KB | `Scheduling.LocalId` e `Events[]` con `EventId`, `Title`, `Type` (`CINEMA` per i film), `Is3D`, `Duration`, `Picture`, `EventProperties[]` (`EventProperty`, `EventPropertyCategory`: `SCREEN`, `LANGUAGE`), `Days[]` con `Day` (giorno del cinema) e `Performances[]` (`PerformanceId`, `Time`, `ScreenName`, `StartTime`) |
| `GET ?wtid=getPerformanceInfo&localid=N&performanceid=P` | Spettacolo, senza prezzi | `Performance` (`LocalId`, `EventId`, `PerformanceId`, `ScreenId`, `Screen`, `StartTime`, `Title`) |
| `POST ?wtid=getMapSeats` con `{ data: { LocalId, ScreenId } }` | Pianta | `MapSeats.posti[]` con `idposto`, `fila`, `colonna`, `settore`, `tipologia`: gli stessi valori di `SeatId`, `Row`, `Column`, `SectorId` e `SeatType` del proxy |
| `POST ?wtid=getOccupancy` con `{ data: { LocalId, PerformanceId } }` | Posti presi | `Occupancy.posti[]` con `idposto` e `status` (`ACQUISTO`, `BLOCCATO`) |

Le locandine sono `https://secure.webtic.it/api/` seguito dal `Picture` relativo. Il link "Acquista" è `https://secure.webtic.it/angwt/webtic.aspx?lid={LocalId}&lng=it#/shoppingmode/it/0/{LocalId}/{EventId}/{PerformanceId}`: apre il login di Webtic e poi lo spettacolo.

### The Space

Base: `https://www.thespacecinema.it/api/microservice`. Senza token quasi tutte le chiamate rispondono 401. Le risposte hanno la forma `{ "result": ..., "responseCode", "errorMessage" }`.

| Chiamata | A cosa serve | Campi usati |
|---|---|---|
| `POST /auth/token` | Token ospite, senza login | i cookie della risposta: `microservicesToken` (12 ore), `microservicesRefreshToken` e `__cflb` di Cloudflare |
| `GET /showings/cinemas` | Elenco dei 35 cinema | `cinemaId`, `cinemaName`, `whatsOnUrl` (la pagina del cinema) |
| `GET /showings/cinemas/{id}/films?minEmbargoLevel=1&includesSession=true` | Programmazione di tutti i giorni di un cinema, 450-600 KB | `filmId`, `filmTitle`, `posterImageSrc`, `showingGroups[]` con `date` (giorno del cinema) e `sessions[]` (`sessionId`, `startTime`, `screenName`, `duration`, `bookingUrl`, `attributes[]`) |
| `GET /showings/films` | Catalogo dei film, per la pagina Cerca, con una cache di un'ora | `filmId`, `filmTitle`, `posterImageSrc`, `releaseDate`, `showingInCinemas` |
| `GET /booking/Session/{cinemaId}/{sessionId}/seats` | Pianta e posti presi in una chiamata | `seatingData.screenLabel`, `seatRows[]` (`rowLabel`, `columns[]` con `name`, `seatStatus`, `areaCategoryCode`), `areaCategories[]` (`areaCategoryCode`, `areaMainPriceInCents`) |

Gli `attributes` danno il formato (`Session` "2D"; `Session_Special` "3D", "INFINITY VISION", "ANTEPRIMA") e la lingua (`Language` "ITALIANO" o "LINGUA ORIGINALE"). Coordinate e provincia di un cinema vengono dalla sua pagina HTML: `q=lat, lon` nel link della mappa e la sigla in fondo a `<address>`. Le locandine sono su `www.thespacecinema.it`. Il link "Acquista" è `https://www.thespacecinema.it/prenotare-il-biglietto/summary/{cinemaId}/{filmId}/{sessionId}`.

### Come l'app le chiama

Tutte le chiamate a UCI, Webtic, The Space e GitHub passano da `src/http.ts`:

- solo `https` e solo gli host consentiti elencati sotto; i reindirizzamenti non si seguono;
- timeout di 15 secondi per chiamata, una richiesta alla volta per host;
- dopo un timeout, un errore di rete, una risposta 5xx o 429 l'host va in attesa: 30 secondi, che raddoppiano a ogni errore fino a 30 minuti, o il `Retry-After` se più lungo;
- l'`User-Agent` porta il nome dell'app.

### Host verso cui l'app esce

| Host | Per cosa | Da dove |
|---|---|---|
| `myuci---uci-backend-production-nfluwp7wga-oc.a.run.app` | Backend UCI | `src/http.ts` |
| `uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app` | Proxy Webtic | `src/http.ts` |
| `secure.webtic.it` | Webtic diretto, per i cinema che non sono UCI | `src/http.ts` |
| `www.thespacecinema.it` | The Space: token ospite, programmazione, posti e pagine dei cinema | `src/http.ts`, e `src/circuits/the-space.ts` per il token |
| `api.github.com` | Ultima Release (`/repos/PilaScat/cinema-watch/releases/latest`), una volta al giorno, per avvisare di una versione nuova | `src/http.ts` |
| `api.telegram.org` | Invio dei messaggi e lettura dei comandi, vedi [telegram.md](telegram.md) | `src/telegram.ts` |

Il browser di chi usa la UI carica le locandine da `storage.googleapis.com`, `secure.webtic.it` e `www.thespacecinema.it`, ammessi dalla CSP; è il browser a farlo, non l'app. I link "Acquista" portano a `ucicinemas.it`, a `secure.webtic.it` o a `www.thespacecinema.it` e l'app non li apre.

## API dell'app

### `GET /health`

Risponde sempre `200` con `{"status":"ok"}`. È la verifica usata dall'`HEALTHCHECK` del container. È aperta anche con `UI_PASSWORD`.

### `GET /api/status`

Riepilogo dello stato, pensato per il widget di [homepage.md](homepage.md). È aperta anche con `UI_PASSWORD` e non contiene segreti: niente token, chat o password.

| Campo | Tipo | Significato |
|---|---|---|
| `status` | `"ok"` | Sempre `ok` |
| `version` | stringa | Versione dell'immagine (`dev` fuori dal container) |
| `latestVersion` | stringa o `null` | Ultima Release su GitHub, `null` se non ancora letta |
| `telegramConfigured` | booleano | Token e chat principale sono presenti |
| `activeHunts` | numero | Cacce attive (abilitate e non archiviate) |
| `showings` | numero | Spettacoli seguiti dalle cacce attive |
| `withSeats` | numero | Fra questi, quelli con posti vicini liberi nella zona buona |
| `hunts` | elenco | Una voce per caccia, anche non attiva |

Ogni voce di `hunts`:

| Campo | Tipo | Significato |
|---|---|---|
| `id` | stringa | Identificativo di 8 caratteri |
| `name` | stringa | Nome della caccia |
| `active` | booleano | Abilitata e non archiviata |
| `muted` | booleano | Silenziata in questo momento |
| `showings` | numero | Spettacoli seguiti |
| `withSeats` | numero | Spettacoli con posti vicini liberi nella zona buona |
| `freeInZone` | numero | Posti liberi nella zona buona, sommati sugli spettacoli |
| `lastRunAt` | numero o `null` | Ultimo giro, in millisecondi Unix |
| `lastRunOk` | booleano o `null` | Esito dell'ultimo giro |
| `nextRunAt` | numero o `null` | Prossimo giro, in millisecondi Unix |

```json
{
  "status": "ok",
  "version": "v2026.10.1",
  "latestVersion": "v2026.10.1",
  "telegramConfigured": true,
  "activeHunts": 1,
  "showings": 4,
  "withSeats": 2,
  "hunts": [
    {
      "id": "k3j9x2ab",
      "name": "Dune IMAX Verona",
      "active": true,
      "muted": false,
      "showings": 4,
      "withSeats": 2,
      "freeInZone": 37,
      "lastRunAt": 1792161600000,
      "lastRunOk": true,
      "nextRunAt": 1792161900000
    }
  ]
}
```

I totali `activeHunts`, `showings` e `withSeats` contano solo le cacce attive; `hunts` le elenca tutte.

### `GET /api/movies?theatres=a,b`

Elenca i film in programmazione nei cinema indicati, per riempire l'elenco del form di una caccia. `theatres` è un elenco di slug separati da virgola. Con `UI_PASSWORD` impostata la route è protetta come il resto della UI: senza sessione risponde con un reindirizzamento a `/login`.

Risposta `200`, ordinata per titolo:

```json
[
  {
    "slug": "dune-parte-tre",
    "title": "Dune: Parte Tre",
    "formats": ["IMAX", "XL"],
    "firstDay": "2026-12-15",
    "label": "Dune: Parte Tre · IMAX, XL · dal mar 15/12"
  }
]
```

| Stato | Quando |
|---|---|
| `400` con `{"error":"invalid theatres"}` | Manca `theatres`, ci sono più di 3 cinema o uno slug non rispetta `[a-z0-9-]` |
| `502` con `{"error":"programming unavailable"}` | La programmazione di nessuno dei cinema indicati è leggibile |

Con `theatres=` vuoto la risposta è un elenco vuoto. Se solo alcuni cinema non rispondono, i film degli altri sono comunque restituiti.
