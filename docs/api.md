# APIs used and exposed

This document describes the external APIs that cinema-watch reads and the APIs the app exposes. The data traps (showing key, cinema day, `BLOCCATO` seats, row axis) are in [MEMORY.md](MEMORY.md) and are not repeated here.

## External APIs

They are public, need no login, and are not official: the circuits can change them without notice. Responses are validated with zod; a missing field or a field of the wrong type discards that item or gives a typed error, never a crash of the app.

### UCI backend

Base: `https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api`. Requests carry the header `Referer: https://ucicinemas.it`. All of them answer with `{ "data": ... }`.

| Call | What it is for | Fields used |
|---|---|---|
| `GET /theatres` | List of cinemas | `slug`, `name`, `city`, `province`, `region`, `is_luxe`, `screens` (hall formats of the cinema) |
| `GET /theatres/{slug}/programming/{AAAA-MM-GG}` | Programme of one day | see below |
| `GET /theatres/{slug}/programming` | Programme of all days, about 2 MB: `data` is a list of `{ day: [film] }` objects. Used only by the UI | as above |
| `GET /movies` | Catalogue of all films, about 450 KB. Used by the Search page, with a one-hour cache | `slug`, `title`, `poster`, `first_performance`, `last_performance`, `screens[].name` |
| `GET /movies/{slug}` | Detail of a film | `slug`, `title`, `poster` |
| `GET /movies/{slug}/theatres` | Cinemas where the film is showing | `slug`, `name`, `movie_variants` |

Each film in the programme carries `slug`, `title`, `poster` and `screens`, a list of objects whose key is the format (`IMAX`, `XL - INFINITY VISION`, `2D`) and whose value is the versions. A version has:

- `language.name` and `duration` (`HH:MM`);
- `performances`, with `day` (cinema day), `starts_at` (`AAAA-MM-GG HH:MM:SS`), `actual_start_at` (`HH:MM`), `room` and `cart_link`.

From `cart_link` (`/movies/{film}/acquista/{LocalId}/{EventId}/{PerformanceId}`) the app gets the three identifiers and the purchase link on `ucicinemas.it`. A showing without a `cart_link` in this format is discarded. The allowed slugs are `[a-z0-9-]` and the days are ISO dates: anything else is not sent as a request.

### Webtic proxy

Base: `https://uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app/Api2`. Requests are `POST` with a JSON body and carry `Origin: https://ucicinemas.it` and `Referer: https://ucicinemas.it/`. Identifiers must be positive integers. Every response has the form `{ "Status": { "Success", "Message", "ReasonCode" }, "Data": ... }`; when `Success` is false the app treats it as an error and reports the `ReasonCode`.

| Call | Body | Fields used |
|---|---|---|
| `POST /Performance` | `{ LocalId, PerformanceId }` | `Performance` (`LocalId`, `EventId`, `PerformanceId`, `ScreenId`, `ScreenName`, `StartTime`), `Event.Title`, and from the prices in `Tickets.ShoppingModes[].PaymentModes[].SectorPrices[]` the minimum of `PriceStartFrom` or, if missing, `Prices[].TotalPrice` |
| `POST /Screen` | `{ LocalId, ScreenId }` | `Screen.Seats[]` with `SeatId` (for example `F/12`), `SeatType`, `SectorId`, `Row`, `Column` |
| `POST /Occupancy` | `{ LocalId, PerformanceId }` | `Occupancy.Seats[]` with `SeatId` and `SeatStatus`: `ACQUISTO` is sold, `BLOCCATO` is in a basket, any other value counts as taken |

The seat map of a hall (`/Screen`) rarely changes: the app keeps it in `screens/` for 7 days and downloads it earlier if the occupancy contains seats that the seat map does not have.

The proxy answers only for UCI cinemas: for any other venue it gives `Unauthorized` (`ReasonCode` 1).

### Webtic direct

Base: `https://secure.webtic.it/api/wtjsonservices.ashx`, with the method in the `wtid` parameter. It is used for the cinemas that are not UCI (Notorious, Cinelandia, Movie Planet and the independents). No special headers. Every response has the form `{ "userdata": { "StatusOk", "ReasonCode", "Message" }, "DS": ... }`; when `StatusOk` is false the app treats it as an error. A closed venue answers with `StatusOk` false after about 12 seconds.

| Call | What it is for | Fields used |
|---|---|---|
| `GET ?wtid=getLocalsTitles` | All 1171 venues, about 1.3 MB | `LocalsTitles.Locals` (`LocalId`, `Description`, `Town`, `District`, `DistrictAbbreviation`, `Latitude`, `Longitude`) and `LocalsTitles.Titles[]` (`Category`, `Locals[].LocalId`) |
| `GET ?wtid=getFullScheduling&localid=N` | Programme of all days of a venue, about 100 KB | `Scheduling.LocalId` and `Events[]` with `EventId`, `Title`, `Type` (`CINEMA` for films), `Is3D`, `Duration`, `Picture`, `EventProperties[]` (`EventProperty`, `EventPropertyCategory`: `SCREEN`, `LANGUAGE`), `Days[]` with `Day` (cinema day) and `Performances[]` (`PerformanceId`, `Time`, `ScreenName`, `StartTime`) |
| `GET ?wtid=getPerformanceInfo&localid=N&performanceid=P` | Showing, without prices | `Performance` (`LocalId`, `EventId`, `PerformanceId`, `ScreenId`, `Screen`, `StartTime`, `Title`) |
| `POST ?wtid=getMapSeats` with `{ data: { LocalId, ScreenId } }` | Seat map | `MapSeats.posti[]` with `idposto`, `fila`, `colonna`, `settore`, `tipologia`: the same values as `SeatId`, `Row`, `Column`, `SectorId` and `SeatType` of the proxy |
| `POST ?wtid=getOccupancy` with `{ data: { LocalId, PerformanceId } }` | Taken seats | `Occupancy.posti[]` with `idposto` and `status` (`ACQUISTO`, `BLOCCATO`) |

The posters are `https://secure.webtic.it/api/` followed by the relative `Picture`. The "Buy" link is `https://secure.webtic.it/angwt/webtic.aspx?lid={LocalId}&lng=it#/shoppingmode/it/0/{LocalId}/{EventId}/{PerformanceId}`: it opens the Webtic login and then the showing.

### The Space

Base: `https://www.thespacecinema.it/api/microservice`. Without a token almost every call answers 401. Responses have the form `{ "result": ..., "responseCode", "errorMessage" }`.

| Call | What it is for | Fields used |
|---|---|---|
| `POST /auth/token` | Guest token, without login | the cookies of the response: `microservicesToken` (12 hours), `microservicesRefreshToken` and Cloudflare's `__cflb` |
| `GET /showings/cinemas` | List of the 35 cinemas | `cinemaId`, `cinemaName`, `whatsOnUrl` (the page of the cinema) |
| `GET /showings/cinemas/{id}/films?minEmbargoLevel=1&includesSession=true` | Programme of all days of a cinema, 450-600 KB | `filmId`, `filmTitle`, `posterImageSrc`, `showingGroups[]` with `date` (cinema day) and `sessions[]` (`sessionId`, `startTime`, `screenName`, `duration`, `bookingUrl`, `attributes[]`) |
| `GET /showings/films` | Catalogue of films, for the Search page, with a one-hour cache | `filmId`, `filmTitle`, `posterImageSrc`, `releaseDate`, `showingInCinemas` |
| `GET /booking/Session/{cinemaId}/{sessionId}/seats` | Seat map and taken seats in one call | `seatingData.screenLabel`, `seatRows[]` (`rowLabel`, `columns[]` with `name`, `seatStatus`, `areaCategoryCode`), `areaCategories[]` (`areaCategoryCode`, `areaMainPriceInCents`) |

The `attributes` give the format (`Session` "2D"; `Session_Special` "3D", "INFINITY VISION", "ANTEPRIMA") and the language (`Language` "ITALIANO" or "LINGUA ORIGINALE"). Coordinates and province of a cinema come from its HTML page: `q=lat, lon` in the map link and the abbreviation at the end of `<address>`. The posters are on `www.thespacecinema.it`. The "Buy" link is `https://www.thespacecinema.it/prenotare-il-biglietto/summary/{cinemaId}/{filmId}/{sessionId}`.

### 18Tickets

Each cinema has its own domain, `<cinema>.<operator>.18tickets.it` or `<cinema>.18tickets.it`; operators with several cinemas (Circuito Cinema in Rome, Genoa and Turin, Andromeda, Pop Up Cinema…) also have a group page. The pages are HTML with attributes in single quotes; only the seats are JSON.

| Call | What it is for | Fields used |
|---|---|---|
| `GET /` on the domain of a cinema | Programme of all published days, 100 KB-1.2 MB | `<title>`; for each film (`div.movie--preview`) the link `a.movie__title` (`/film/<id>`), the poster, `film-label` (INFINITY VISION, INGLESE, LINGUA ORIGINALE…), "Lingua:", and for each day the `fa-calendar` heading ("Mercoledì 16/12/2026") with the screenings `<a data-time='<ms>' href='…/film/<id>/<uuid>#theater-init'>` (time and hall in the text); the place in `time-select__place` and the address in the `maps.google.com/?q=` link |
| `GET /` on the domain of a group | List of the cinemas of the group | the links `<a href="https://<cinema>.<gruppo>.18tickets.it" class="dropdown-item">`; some groups answer 302 to `/select_cinema?mandatory=true`, which has the same links |
| `GET /film/<id>` | Hall of each screening of the film | `film-projection` with `data-id` (uuid of the screening) and `data-theater` (uuid of the hall) |
| `GET /theater/<uuid della sala>.svg` | Seat map | `<g class='posto' data-row data-seat data-area id='g_<fila>_<colonna>'>`; `userhide` is a hidden seat |
| `GET /seats/<uuid della proiezione>` | Taken seats, JSON | `bought`, `locked`, `reserved`, `quarantined`, `preemption`, `mine`: lists of `{x, y}` (`x` column, `y` row); `total` |

The seats answer only from the domain of the cinema or of its group: from other domains the same call gives `{}`. The "Buy" link is the one of the screening, `https://<cinema>/film/<id>/<uuid>#theater-init`.

### How the app calls them

All calls to UCI, Webtic, The Space and GitHub go through `src/http.ts`:

- `https` only, only the allowed hosts listed below, on the default port and with no credentials in the address; redirects are not followed;
- a response over 10 MB is discarded without reading it to the end (this also applies to the pages of The Space and 18Tickets);
- 15-second timeout per call, one request at a time per host, at most 200 waiting: the extra ones fail at once;
- after a timeout, a network error, a 5xx or 429 response the host goes on hold: 30 seconds, doubling at each error up to 30 minutes, or the `Retry-After` if longer, never beyond 30 minutes;
- the `User-Agent` carries the name of the app.

Calls to 18Tickets go through the client in `src/circuits/t18.ts`: `https` only, only `*.18tickets.it` domains, no redirects followed, 20-second timeout, and at least 10 seconds between two pages of the same operator, one minute after a 429 (the reason is in [MEMORY.md](MEMORY.md)).

### Hosts the app calls out to

| Host | What for | From where |
|---|---|---|
| `myuci---uci-backend-production-nfluwp7wga-oc.a.run.app` | UCI backend | `src/http.ts` |
| `uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app` | Webtic proxy | `src/http.ts` |
| `secure.webtic.it` | Webtic direct, for the cinemas that are not UCI | `src/http.ts` |
| `www.thespacecinema.it` | The Space: guest token, programme, seats and cinema pages | `src/http.ts`, and `src/circuits/the-space.ts` for the token |
| `*.18tickets.it` | 18Tickets: cinema and group pages, seat maps and seats | `src/circuits/t18.ts` |
| `api.github.com` | Latest Release (`/repos/PilaScat/cinema-watch/releases/latest`), once a day, to announce a new version | `src/http.ts` |
| `api.telegram.org` | Sending messages and reading commands, see [telegram.md](telegram.md) | `src/telegram.ts` |
| `oauth2.googleapis.com`, `walletobjects.googleapis.com` | Google Wallet: access token and creation of the pass, only at the click on Add to Google Wallet, see [tickets.md](tickets.md) | `src/tickets/wallet.ts` |

The browser of whoever uses the UI loads the posters from `storage.googleapis.com`, `secure.webtic.it`, `www.thespacecinema.it` and `cdn.18tickets.net`, allowed by the CSP; it is the browser that does this, not the app. The "Buy" links lead to `ucicinemas.it`, to `secure.webtic.it`, to `www.thespacecinema.it` or to the 18Tickets domain of the cinema, and the app does not open them.

## App APIs

### `GET /health`

Always answers `200` with `{"status":"ok"}`. It is the check used by the container `HEALTHCHECK`. It is open even with `UI_PASSWORD`.

### `GET /api/status`

Summary of the state, made for the widget of [homepage.md](homepage.md). It is open even with `UI_PASSWORD` and holds no secrets: no token, chat or password. With `UI_PASSWORD` set and no access, `hunts` is an empty list: the totals remain.

| Field | Type | Meaning |
|---|---|---|
| `status` | `"ok"` | Always `ok` |
| `version` | string | Version of the image (`dev` outside the container) |
| `latestVersion` | string or `null` | Latest Release on GitHub, `null` if not read yet |
| `telegramConfigured` | boolean | Token and main chat are present |
| `activeHunts` | number | Active hunts (enabled and not archived) |
| `showings` | number | Showings followed by the active hunts |
| `withSeats` | number | Of these, the ones with free seats together in the good zone |
| `hunts` | list | One entry per hunt, including inactive ones |

Each entry of `hunts`:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Identifier of 8 characters |
| `name` | string | Name of the hunt |
| `active` | boolean | Enabled and not archived |
| `muted` | boolean | Muted at this moment |
| `showings` | number | Showings followed |
| `withSeats` | number | Showings with free seats together in the good zone |
| `freeInZone` | number | Free seats in the good zone, summed over the showings |
| `lastRunAt` | number or `null` | Last round, in Unix milliseconds |
| `lastRunOk` | boolean or `null` | Result of the last round |
| `nextRunAt` | number or `null` | Next round, in Unix milliseconds |

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

The totals `activeHunts`, `showings` and `withSeats` count only the active hunts; `hunts` lists them all.

### `GET /showings/<chiave>/preview`

HTML fragment with the compact seat map of a showing in both themes, the free seats, the prices by level and the best seats: it is what the UI loads when the seat count in a list is pressed. Optional parameters `theatre` (slug of the cinema) and `hunt` (to use the zone of a hunt). It answers `404` for a malformed key or slug and `502` if the seat map cannot be read. Protected like the rest of the UI.

### `POST /theatres/<slug>/refresh`

Rereads the programme of one cinema and answers `303` to its page. `GET /theatres/<slug>` does the same reread when the page opens, except for a browser prefetch (`Sec-Purpose` or `Purpose` header with `prefetch`). Both reread at most once every 30 seconds for each cinema: within the interval, or when the circuit does not answer, the programme already read is used. The other pages keep the programme for 10 minutes. `404` for a malformed slug. Protected like the rest of the UI.

### Tickets

Protected like the rest of the UI. How they work is in [tickets.md](tickets.md).

| Route | What it does |
|---|---|
| `GET /tickets` | The saved tickets with their cards, and the upload form |
| `POST /tickets/read` | Reads the PDF in the `pdf` field (multipart, up to 10 MB: it is the only route with this limit, the others stop at 1 MiB) and answers with the fields to check; nothing is saved |
| `GET /tickets/new` | The same fields, empty |
| `POST /tickets` | Saves the tickets of the form, up to 20; a ticket with an entry code already saved is skipped |
| `GET /tickets/<id>/card.png` | The card, in the language of the page, never cached |
| `GET /tickets/<id>/wallet` | Creates the pass at Google and redirects to the save link; `404` without the credentials, back to `/tickets?wallet=<reason>` when Google refuses |
| `GET /tickets/<id>/wallet/link` | The same link as JSON (`{ "url": … }`), for the copy and share buttons; `502` with `{ "problem": … }` when Google refuses |
| `POST /tickets/<id>/telegram` | Sends the card to the main chat |
| `POST /tickets/<id>/delete` | Deletes the ticket |

### `POST /language`

Chooses the language of the web UI. Field `language`: `en` or `it` saves it in the `language` cookie; `auto`, or any other value, deletes the cookie and goes back to the browser language. It answers `303` to the page it comes from. It is open even before sign-in, because the selector is also on the login page; like every `POST` it rejects requests from another site.

### `GET /api/movies?theatres=a,b`

Lists the films showing at the given cinemas, to fill the list in the form of a hunt. `theatres` is a list of slugs separated by commas. With `UI_PASSWORD` set the route is protected like the rest of the UI: without a session it answers with a redirect to `/login`.

Answer `200`, sorted by title:

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

| Status | When |
|---|---|
| `400` with `{"error":"invalid theatres"}` | `theatres` is missing, there are more than 3 cinemas or a slug does not match `[a-z0-9-]` |
| `502` with `{"error":"programming unavailable"}` | The programme of none of the given cinemas can be read |

With an empty `theatres=` the answer is an empty list. If only some cinemas do not answer, the films of the others are still returned.
