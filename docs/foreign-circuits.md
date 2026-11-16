# Foreign circuits

Survey of 16/11/2026: what the largest circuits outside Italy let read without a login. No code was written. Requests were few (at most 10 per site), from a home connection, with a browser User-Agent, and stopped at the first block.

## Result

| Circuit | Countries | Cinema list | Programme | Seat map and taken seats | Prices | Needed | Block met | Work |
|---|---|---|---|---|---|---|---|---|
| Vue UK (`myvue.com`) | UK, Ireland, 91 cinemas | read | read | read | read, per showing | guest token | none | small: same platform as The Space |
| Vue NL (`vuecinemas.nl`) | Netherlands | read | not tried | not tried | not tried | guest token, read | none | small if it behaves as Vue UK |
| CinemaxX DE (`cinemaxx.de`) | Germany | read | not tried | not tried | not tried | guest token, read | none | small if it behaves as Vue UK |
| Vue DK (`biografenvue.dk`, was `cinemaxx.dk`) | Denmark | not found | not found | not found | not found | unknown | none | another site, the paths of The Space answer "page not found" |
| Multikino (`multikino.pl`) | Poland | blocked | blocked | blocked | blocked | unknown | Cloudflare challenge, 403 on the guest token | not feasible with a plain HTTP client |
| Cineworld UK (`cineworld.co.uk`) | UK, Ireland | not found | not found | not found | not found | unknown | none | the `quickbook` paths known from old libraries answer "not found": to find again in the browser |
| Cinema City (`cinema-city.pl`) | Poland and others | not found | not tried | not tried | not tried | unknown | none | unknown |
| Odeon UK (`odeon.co.uk`) | UK, Ireland | blocked | blocked | blocked | blocked | unknown | Cloudflare challenge, 403 on `robots.txt` | not feasible as tried |
| Pathé FR (`pathe.fr`) | France | blocked | blocked | blocked | blocked | unknown | 403 on `robots.txt` | not feasible as tried |
| Kinepolis BE (`kinepolis.be`) | Belgium and others | blocked | blocked | blocked | blocked | unknown | Cloudflare challenge, 403 on the sitemap | not feasible as tried |
| UGC FR (`ugc.fr`) | France | not read | not read | not read | not read | unknown | none | `robots.txt` disallows the paths of the app pages: left alone |
| AMC (`amctheatres.com`) | USA | blocked | blocked | blocked | blocked | a key of its developer API | Cloudflare block, 403 on `robots.txt` and on the developer portal | only with a key, if AMC gives one |
| Regal (`regmovies.com`) | USA | blocked | blocked | blocked | blocked | a partner key | Cloudflare block, 403 on `robots.txt` | not feasible without a partner agreement |
| Cinemark (`cinemark.com`) | USA | blocked | blocked | blocked | blocked | unknown | Cloudflare block, 403 on `robots.txt` | not feasible as tried |

Not reached: UCI Kinowelt (Germany), Cinesa and Yelmo (Spain), CGR (France), Pathé in the Netherlands and Switzerland, Kinepolis outside Belgium, Cinema City outside Poland.

## Vue is The Space

The Space belongs to the Vue group and its site is the group's platform. On `myvue.com` the same four calls of `src/circuits/the-space.ts` answer, with the same shapes:

| Call | Answer on `myvue.com` |
|---|---|
| `POST /api/microservice/auth/token` | 200, sets the `microservicesToken` cookie and the Cloudflare ones |
| `GET /api/microservice/showings/cinemas` | 200 even without a token: 91 cinemas with `cinemaId`, name, currency |
| `GET /api/microservice/showings/cinemas/{cinemaId}/films?minEmbargoLevel=1&includesSession=true` | 401 without the token; 200 with it: 103 films, each session with `sessionId`, `startTime`, `screenName`, `formattedPrice` |
| `GET /api/microservice/booking/Session/{cinemaId}/{sessionId}/seats` | 200: `areaCategories`, `seatRows`, `seatingData`, `sessionOccupancy`, `singleSeatRule`, `ticketTiers`, and rows with `columns`, `rowIndex`, `rowLabel`, as in the fixture of The Space |

On `vuecinemas.nl` and `cinemaxx.de` the token and the cinema list answer the same way; programme and seat map were not tried there.

`robots.txt` of the three sites disallows the booking pages (`/book-tickets/`, `/bestel/`, `/buchtickets/`, `/order/`) and not `/api/`.

## Calls tried

| Site | Requests | What answered |
|---|---|---|
| `myvue.com` | 6 GET, 2 POST | `robots.txt` 200; token 200 twice; cinemas 200 twice; films 401 without token and 200 with it; seats 200 |
| `vuecinemas.nl` | 2 GET, 1 POST | `robots.txt` 200; token 200; cinemas 200 |
| `cinemaxx.de` | 2 GET, 1 POST | `robots.txt` 200; token 200; cinemas 200 |
| `cinemaxx.dk`, `biografenvue.dk` | 5 GET, 1 POST | redirect to `biografenvue.dk`; token and cinemas paths answer the "page not found" page |
| `multikino.pl` | 1 GET, 1 POST | `robots.txt` 200; token 403 with `Cf-Mitigated: challenge` |
| `cineworld.co.uk` | 3 GET | `robots.txt` 200; two `data-api-service/v1/quickbook` paths answer the "not found" page |
| `cinemacity.pl`, `cinema-city.pl` | 4 GET | redirect; `robots.txt` 404; `/pgm-cinemas/` 301, not followed |
| `odeon.co.uk` | 1 GET | 403, Cloudflare challenge |
| `pathe.fr` | 1 GET | 403 |
| `kinepolis.be` | 3 GET | `robots.txt` 200 with `Allow: /`; sitemap 403, Cloudflare challenge |
| `ugc.fr` | 3 GET | `robots.txt` 200: disallows `/dynamique/` |
| `amctheatres.com`, `developers.amctheatres.com` | 3 GET | 403, Cloudflare "you have been blocked" |
| `regmovies.com` | 1 GET | 403, the same page |
| `cinemark.com` | 1 GET | 403, the same page |

A block on `robots.txt` says nothing about what a browser gets: those sites refuse a plain HTTP client, which is what the app is.

Not verified, from search only: AMC has a developer API with a key (`X-AMC-Vendor-Key`) that covers theatres, showtimes and seating; Regal has a partner API on `api.regmovies.com`; no public API was found for Cinemark.

## Before any code

A circuit is wired today in about eight places: `Chain` in `src/types.ts`, the slug prefix, the construction in `src/watcher.ts`, the allowed hosts, the image hosts of the CSP, the regions, the time zone and the currency. A second country needs first a registry of the circuits (chain, slug prefix, hosts, image hosts, country, time zone, currency), `Theatre.country`, and time zone and currency as parameters of the formatters, with the existing keys left as they are. With that, Vue UK, Vue NL and CinemaxX DE would be a host and a currency each, on the code of The Space.
