# Project memory: decisions and gotchas

What you cannot tell from reading the code. The APIs are described in [api.md](api.md).

## UCI and Webtic data

- **Key of a showing**: `{LocalId}-{PerformanceId}`. The Webtic PerformanceId is unique only
  within a cinema (LocalId), so on its own it is not enough as a key. The key of a hall is
  `{LocalId}-{ScreenId}`. Outside the UCI and Webtic clients the app uses only these keys, as
  strings: the circuits to come will have keys with a prefix (for example `space-…`), so they
  do not clash with the LocalIds. The UCI and Webtic keys stayed the same in the change of
  19/10/2026: state, history, hunt zones and saved seat maps did not change.
- **Circuits**: runner and watcher go through `src/circuits/` (one adapter per circuit, chosen by the
  slug of the cinema). For an old key without a cinema, such as that of a Telegram link, the
  circuit is derived from the state of the hunts or from the list of Webtic cinemas.
- **Cinema day**: `performances[].day` is the programme day. The 00:01 showing of the 16th has `day`
  15. Dates and days of the week use `day`; the "From/To" filters use the real time. The time of a
  day (`dayTimes`, key = day of the week of `day`) entirely replaces the general From and To: its
  empty To means no limit, not "the general one" (Filippo's choice of 20/10/2026). From and To
  equal (for example 00:00 and 00:00) mean the whole day, both general and per day (`timeInRange`).
- **Limits of a hunt** (review of 11/11/2026): a fixed-date window is read for 120 days at most from today (or from its start), even if the last date is further away: UCI is asked one day at a time, and a hunt "until 2099" held up everything else for hours. Filippo chose the number. The limit is in the reading (`resolveWindow`), not in the schema, so a configuration that already exceeds it still loads. For the same reason quiet hours with From equal to To mean "off" (before, they stopped the app forever) without becoming an error, and an empty list of languages means "all". The schema holds only the maximums of 100 cinemas and 20 extra chats per hunt.
- **Price tiers** (`priceTiers`, since 11/11/2026): the UCI Webtic proxy gives a price per sector (`SectorPrices`: `PT` normal, `HA` VIP), The Space one per area (`areaCategories`); direct Webtic and 18Tickets none. The price of a tier is the whole one (`PriceStartFrom`). The sector name is sometimes empty (Verona, SALA 02): then it is `VIP` if the tickets say so, otherwise only the price remains. The areas of The Space are named with the colours of their site ("Blu", "Rosso"), which on our seat map would be painted as something else: those names are dropped. With at least two sellable tiers the seat map colours the free seats by tier (the cheapest stays green) and puts them in the legend, in the Telegram PNG too; with only one it stays as it was. The three extra colours are chosen with the validator of the `dataviz` skill against the other colours of the seat map, in light and dark; beyond the fourth tier the last one is reused.
- **Taken seats**: the occupancy lists only the taken seats. `ACQUISTO` is sold, `BLOCCATO` is in
  someone's basket and frees up in a few minutes: it counts as taken, otherwise the alerts for
  freed seats oscillate.
- **Sellable seats**: `SeatType` among the sellable ones (default `STANDARD`) and a sector other than
  `UN`, which is the one for disabled people. The `HA` sector (VIP in the XL and 2D halls of Verona) is sellable.
  `RISERVATO` is not sold.
- **Seat map that cannot be drawn**: a Webtic seat map with no seats, or with `Row` or `Column` outside 0-1000, is a format error and does not reach the drawing; before, it produced an SVG with height `-Infinity` or a PNG that failed inside the sending of the alert.
- **Axis of the hall**: the lowest `Row` is the row closest to the screen (row A = `Row` 2 in all
  the halls seen). Two seats are together if they have the same `Row` and consecutive `Column`s.
- **Row and number are not in the id**: the id of a seat is `H/9` only in UCI and Webtic; in The Space it is
  `A22` and in 18Tickets `fila_colonna`. Whoever has to show or choose a seat uses `rowLabel` and
  `number`: the seat groups carry their `numbers`, and the seat map writes `data-row` and
  `data-number` on every seat for the choice of the zone. Before, "Best seats" gave only the row in the
  The Space and 18Tickets cinemas, and a click on the seat map wrote a wrong zone. From the review
  of 11/11/2026.
- **Seat numbers**: they do not always follow the position. At Campi Bisenzio row A starts from
  `A/20` on the lowest column. Centrality is computed on the columns; the manual touch-up of the
  zone uses the numbers, because those are what you read in the hall.
- **Formats**: the names in the programme (`XL - INFINITY VISION`, `2D - INFINITY VISION`) and those
  of the cinemas (`XL`, `2D`) are aligned with `normalizeFormat`. The part after the hyphen is
  an **edition** (`formatEdition`, today only `INFINITY VISION`): a format of the hunt
  matches the group (`XL`), the full name or the edition. So "XL" also takes the XL
  Infinity Vision, and "INFINITY VISION" takes all the Infinity Vision halls but not the normal XL.
- **Distance**: the coordinates of the cinemas come from `/theatres` of UCI (`latitude`/`longitude`,
  strings); 0 or missing values mean "no coordinates" and go to the end of the order. The
  browser position (`navigator.geolocation`) exists only in a secure context, so the
  "Use my position" button appears only over HTTPS.
- **UCI login**: Cloudflare and captcha. The app does not log in and does not buy: it reads only public data.

## Webtic cinemas

- **Two paths for Webtic**: the UCI `LocalId`s are Webtic `LocalId`s, but the UCI proxy answers only for UCI venues. The other cinemas go through `secure.webtic.it` directly, with slug `webtic-<LocalId>`; the UCI cinemas stay on the proxy because it also gives the price. In the round they are sorted by slug, in the showing page by `LocalId`.
- **Same data as UCI**: the direct seat map matches the proxy's seat by seat (Verona, hall 2, verified on 17/10/2026), so row axis, sellable seats and `BLOCCATO` hold the same. `Day` too is the cinema day: the 00:10 showing of the 16th is in day 15.
- **Which venues are cinemas**: Webtic does not say. The list of titles per venue of `getLocalsTitles` stopped in 2024 (4 Notorious out of 9 are missing), and among the 1171 venues there are theatres, discos and water parks. The candidates are the venues with non-theatrical titles in that list plus those with a cinema-like name, minus UCI and TEST: about 400. Once a week the watcher asks for the programme of each, in the background and one request at a time, and keeps those with films. It takes 20-30 minutes, because closed venues answer after 12 seconds. The result is in `/data/webtic-venues.json`; if the check fails or finds nothing the previous list stays and it retries after an hour. Filippo's choice of 17/10/2026.
- **The check has its own HTTP client**: queue and backoff separate from those of the hunts, so a slow venue does not stop the rounds and an error of a hunt does not truncate the check. Timeout of 30 seconds (closed venues answer at 12) and no backoff: a venue that times out is skipped, a network error or a 5xx stops the check, which would otherwise save a truncated list for a week. `close()` interrupts it and saves nothing.
- **Search and Webtic films**: in the Search page the films of a Webtic cinema come from the weekly check, and are updated (in memory only) every time the round of a hunt reads the programme of that cinema. A film released during the week in a cinema that no hunt follows therefore appears only at the next check. Filippo's choice of 17/10/2026: a daily re-read of all the cinemas is not needed, because the hunts already read the real programme at every round.
- **Webtic titles**: a film has one title per version ("(Lingua Orig) Avengers: Doomsday", "Avengers: Doomsday Infinity Vision", "Dune - Parte Tre Anteprima"). The slug is derived from the title without the tags in brackets, without "Anteprima" and without the edition, so it matches the UCI one and a hunt by slug holds for both circuits. "Infinity Vision" becomes the format `2D - INFINITY VISION`. The language comes from the `LANGUAGE` property (`EN` becomes `ENG` as in UCI; without the property it is `ITA`).
- **Coordinates**: 179 candidate venues out of 409 have coordinates at 0, including 5 Notorious, and sit at the end of the order by distance (Filippo's choice of 17/10/2026). The region is derived from the province abbreviation (`src/regions.ts`).

## The Space cinemas

- **Keys**: cinema `space-<cinemaId>`, showing `space-<cinemaId>-<sessionId>`, hall `space-<cinemaId>-<slug of the hall name>` (for example `space-1028-sala-7`). The prefix avoids the clash with the Webtic `LocalId`s, which have similar numbers.
- **Guest token**: it must be requested from `/auth/token` and sent back with **all** the cookies of the response. The token is valid only on the server that issued it, and `__cflb` is the Cloudflare cookie that keeps requests on that server: without it, the programme sometimes answers 401 and the seats always do (verified on 20/10/2026). It is renewed after 11 hours or at the first 401; two simultaneous requests wait for the same renewal.
- **Row axis**: `seatRows` arrives in the order of the hall, row A first and screen at the top, as on the site (verified by eye on 19/10/2026). `rowIndex` is not needed: row A has 15 in one hall and 10 in another. The row is the position in the list plus one, the column the position in the row plus one.
- **Seat states**: 0 free; 1, 9 and 11 sold; 4, 8 and 10 in someone's basket, which counts as taken like Webtic's `BLOCCATO`; 3 wheelchair and 7 companion go in the `UN` sector and are not sellable; 12 is not a seat and is skipped; the others are `RISERVATO`. The "from" price is the minimum of the areas that have `STANDARD` seats.
- **Cinema day**: the showings after midnight (`isMidnightSession`) are already in the group of the day before, as in UCI.
- **Time of the showing**: the seat map does not carry it. The circuit takes it from the programme read by the round or, if the showing is not known, re-reads the programme of the cinema; a showing that is no longer there gives "Seat map not available".
- **Region**: from the province abbreviation at the end of `<address>`; 6 cinemas out of 35 have only the postal code, and then the region comes from the first two digits of the postal code, which indicate the province of the county town (`regionOfPostalCode`).
- **List of cinemas**: a weekly check reads the 35 cinemas and their pages and saves `/data/space-venues.json`; if it fails the previous list stays and it retries after an hour. One programme request per cinema per round gives all the days.
- **Cloudflare**: from the home server the requests go through (test from the container on 19/10/2026).

## 18Tickets cinemas

- **Keys**: cinema `t18-<labels of the domain joined by ->` (for example `t18-nuovoolimpia-ccroma`), screening `<slug of the cinema>-<uuid>`, hall `<slug of the cinema>-<uuid of the hall>`. The domain of a cinema is derived from the saved list or from Settings, not from the slug, because a label can contain a hyphen.
- **Request limit**: 18Tickets answers 429 after about 6 HTML pages in 30 seconds from the same operator (`ccroma`, `ccgenova`…: the label before `18tickets.it`), for about a minute, without `Retry-After`. The JSON `/seats` calls do not count: 150 in a row go through. Measured on 20/10/2026; one page every 10 seconds per operator got 10 out of 10 through, and is half the limit. After a 429 the operator waits a minute. A cinema costs one page per round (the home); the film page stays in cache for 24 hours and the seat map for 7 days in `screens/`.
- **List of cinemas**: the 65 domains of the census of 19/10/2026 in `src/circuits/t18-hosts.ts`, plus those in Settings (Other 18Tickets cinemas) and those found in the group pages. A domain is a group if its home has more venues or at least two links to cinemas under it, or if it redirects to `/select_cinema`. The check is weekly, and restarts at once if a never-checked domain appears in Settings; a domain that answers 429, 5xx, times out or has a network error is retried once at the end of the queue, and a cinema that does not answer even then keeps the data from the time before. Saved in `/data/t18-venues.json`, without coordinates: at the end of the order by distance (Filippo's choice of 19/10/2026). On 20/10/2026 the check found 82 cinemas out of 92 domains in 7 minutes; 20 without a region, almost all arenas and Lab80 venues without a programme, whose home has no address.
- **Anomalous pages**: a numeric entity outside Unicode (`&#x110000;`) stays as written, instead of making the whole cinema page fail; the title and venue regexes have a character limit, because without a limit a 400 KB page of unclosed tags stopped the process for 5 seconds (measured on 11/11/2026).
- **Cinema day**: the screenings are under the heading of the day of the home, which is the cinema day; the real time comes from `data-time` (milliseconds), converted to Europe/Rome.
- **Format and language**: the format comes from the label or the title (3D, IMAX, 4DX; INFINITY VISION is an edition of 2D). The language is `VO` if the label says INGLESE or LINGUA ORIGINALE, if the title carries "V.O." or "V.O.S.", or if "Lingua:" is not Italian; the label counts more than the field, which sometimes says "Italiano" even for the English version. The duration "(1H50')" is removed from the title and becomes `durationMinutes`.
- **Seat map and seats**: the seat map id `g_<fila>_<colonna>` matches `{x: colonna, y: fila}` of the taken seats (105 out of 105 in the test hall). Rows grow from the screen (row A = 2). `userhide` seats do not exist for sale (outside the `total`); visible `special` ones are `RISERVATO`. `bought` is sold; `locked`, `reserved`, `quarantined`, `preemption` and `mine` count as taken. No price: `priceFrom` stays empty.
- **Hall of a screening**: the home does not say; it comes from `data-theater` in the film page, read only when the seat map is needed.

## Alerts

- **An alert is not lost**: if Telegram fails or is not configured, the state of the hunt does not
  advance and the same events come up again at the next round.
- **Accepted risk of a duplicate**: on a network error Telegram is retried once. If the
  response was lost after sending, the message arrives twice. It is rare and less serious than a
  lost alert.
- **Cancelled**: only for a future showing absent for 2 rounds from a day read with at least
  one showing. If the last showing of a day disappears, the day returns empty and the
  cancellation is not seen: it is the price for not mistaking an empty UCI response for a
  mass cancellation.
- **New days in silence**: in a hunt already started, the showings of a day checked for
  the first time ("next N days" window that advances, cinema added) are recorded without
  alerting. A day counts as checked as soon as UCI answers, **even if it is empty**: so the
  showings that come out on a day already in the window alert. It is the case the app exists for.
- **Alert for a failed read after 30 minutes**: a single UCI 502 puts the host on pause
  (30 s backoff) and, since the programme is requested one day at a time on the same queue,
  makes all the following days fail ("paused after repeated errors") and also the hunts that run
  right after: on 27/10/2026 two hunts alerted for an isolated 502. For this reason the HTTP client
  retries once after 2 s on 502, 503 and 504 (without `Retry-After`) and on network errors, before
  the pause; and the alert goes out only if the hunt has had errors for at least 30 minutes in a row
  (`errorSince` in the state, reset by a round without errors), always at most one a day.
  The weekly check of the Webtic cinemas does not retry: at the first error it stops as before.
  Filippo's choice of 27/10/2026.
- **After sending, the state advances anyway**: if the alert went out and then the write of the trend
  or of the log fails (disk full, permissions), the hunt keeps the new state and the round is reported
  with the error; before, it went back to the old state and resent the same alert at every round. For the
  same reason a storage or cleanup error is logged and the rounds start anyway,
  the periodic re-read does not recreate a vanished `config.json` (the configuration in memory stays: the
  default file is created only at startup), and at shutdown the round stops between one hunt and the next.
  From the review of 11/11/2026.
- **Waits with a cap** (review of 11/11/2026): a `Retry-After` from UCI, Webtic or The Space does not put the host on pause beyond the 30 minutes of the backoff (before, a huge value stopped it until restart), and a `retry_after` from Telegram does not make it wait more than a minute per attempt; the wait is interrupted when the bot stops.
- **One operation at a time**: rounds, Refresh now, Mute for 24 h, Bought and confirmation of films go
  through a single mutex in the watcher; the scheduler lives in `watcher.ts` and not in a module of its own.

## Performance

- **Film page over 12 showings**: "Show all" lists them, but the seats are read only for the first 12, because every showing is a seat map request queued one at a time; the others have "Open seat map", which reads it on click (`GET /showings/<chiave>/preview`).
- **resvg on Windows is slow with text**: the Verona seat map is drawn in about 800 ms on
  Windows and in about 50 ms on Linux Alpine (measured on 16/10/2026). The cost is in the layout
  of the texts, not in the pixels or in loading the fonts. The 500 ms test holds only on Linux; on
  Windows it is skipped. For the same reason the Vitest limit is 15 s: with all the files in
  parallel the tests that draw seat maps on Windows exceed the default 5 s.
- **Width for Telegram**: the seat maps are drawn at 1280 px (`TELEGRAM_PHOTO_WIDTH`), the side
  that Telegram keeps for photos.

## Browser and security

- **Style of the pages** (since 12/11/2026): what repeats lives in `src/web/components.tsx` and the pages use it, they do not write the classes again: `TextLink` and `textLinkClass` for red links, `Rows` for lists with a line between rows, `tileClass` and `linkTileClass` for bordered tiles, `displayClass` and `SectionTitle` for titles in the display font, `FilterForm`, `Stat` for a number with its label, `Chips` for a row of labels. Radii: `rounded-xl` for containers, `rounded-lg` for controls and inner boxes, `rounded-md` for small pieces, `rounded-full` for labels. The seat map on a page is the compact one, without the title the page already has; the Telegram photo keeps it. `tests/web-style.test.ts` fails if a page writes one of those classes by hand.
- **Language of the web UI** (since 12/11/2026): English and Italian, texts in `src/i18n/` (`en.ts` is the source). The language is the browser's, or the one chosen with the selector in the footer, saved in the `language` cookie (one year, `SameSite=Strict`, `Secure` only if the page arrived over https, otherwise on `http://IP` it would not be saved). Hono's `languageDetector` is used with `order: ["cookie", "header"]` and `caches: false`: its defaults also read `?lng=` from the address and write an always-`Secure` cookie. The language of the request lives in an `AsyncLocalStorage` (`src/web/i18n.ts`) and not in a parameter passed to every component: the pages read `copy` and the formats from there. Outside a request English applies, so a text read at startup would stay English for everyone: for this reason outside a function `localized(...)` is used, and `tests/i18n.test.ts` checks it. The time stays Rome's and the currency the euro in both languages. The config schema produces keys (`integerFrom|1|10`), translated by `issueLines` where the error is shown. Telegram, log and errors follow instead `settings.language` (Settings, Language of the messages; config v5): whoever receives them has no browser, and a "Send to Telegram now" pressed from an English browser must stay in the language of the chat. The watcher applies it at every read or write of the config (`setMessageLocale`), and it is one per process. The migration from v4 sets `it`, so the messages of those who update do not change; a new config starts from `en`. Before the config is read English applies. The bot command is `/refresh` in both languages; `/aggiorna` no longer answers (Filippo's choice of 11/11/2026).
- **The container starts as root and drops to `PUID:PGID`** (since v2026.10.13), like the standard Unraid images (linuxserver, binhex). With a fixed `USER 99:100`, the data folder created by Docker belongs to root and the app cannot write to it, and whoever installs from Community Apps runs no script beforehand. After `su-exec` node has no capabilities, so the app stays locked down as before. `--cap-drop=ALL` became optional, together with `--user`, because without SETUID and SETGID the entrypoint cannot change user: in that case it stops with a message explaining what to do. Filippo's choice of 21/10/2026.

- **Access** (review of 11/11/2026): without `UI_PASSWORD` the app answers only if the name in the address is an IP, `localhost`, a name without dots, `.local`, `.lan`, `.internal`, `.home.arpa` or the host of the public URL; the others get 403. It guards against DNS rebinding: a site opened from a home browser that gets itself resolved to the IP of the app would read the bot token from `/settings/export`. `/health` answers on any name. With the password the check is not there, because the `SameSite=Strict` cookie does not go to another name. The session cookie carries the expiry and a fingerprint of the password, signed: it really expires after 30 days and drops when the password changes. With `TRUST_PROXY` the IP is the last value of `X-Forwarded-For`, the one the proxy adds; the first is written by the client. `/api/status` without access gives the totals and an empty `hunts` list.

- **Entrypoint and file ownership**: the `chown` also runs when the data folder already belongs to `PUID:PGID` but inside there is a file of someone else's (a backup restored as root left `config.json` not writable), and it uses `-h`, so a link inside `/data` does not change the owner of a file outside. `PUID=0` starts but warns in the log.

- **Back**: a page opened from another receives `from` (path and query of the one that opened it) and its Back returns there; without `from` the fixed parent stays (cinema, cinema card, home), and a showing with a valid `hunt` goes back to `/hunts/<id>#showings`. `from` is valid only if it is a local path (`localPath` in `src/web/parts/navigation.ts`: starts with `/`, no `//`, `\` or control characters, at most 1000 characters), so no link takes you out. Filippo's request of 20/10/2026.

- **`Referrer-Policy: same-origin`, not `no-referrer`**: with `no-referrer` Chrome and Edge send
  `Origin: null` on every POST. On `http://IP` (insecure context) they do not even send
  `Sec-Fetch-Site`, so Hono's CSRF rejects all the forms with "Forbidden". On HTTPS and on
  localhost `Sec-Fetch-Site` arrives and the problem is not seen: for this reason the e2e must also be run
  on the LAN IP (`node scripts/e2e-ui.mjs http://<IP>:<porta>`). Found on 16/10/2026 at the first
  installation.
- **e2e and Webtic cinemas**: the hunt on Notorious Merlata (`webtic-5779`) of the e2e serves the list
  of Webtic cinemas. On a new data folder it arrives only at the end of the first check, about half an hour;
  before that the "cinema nel form" check fails with "elenco dei cinema non pronto".

## Tools

- **README badges from third-party services**: the image pulls come from ipitio/backage (it indexes
  those who star its repo; if after a day it is missing, `PilaScat` is added to its
  `owners.txt` with a PR), the size from ghcr-badge.egpl.dev. The Platforms badge is a fixed
  one: it must be realigned if those of `release.yml` change.
- **Versions that Dependabot does not see**: Trivy (`version:` in `release.yml`), actionlint and zizmor (images inside a `run:` of `ci.yml`) are pinned by hand and no automatic update proposes them. They are checked at every release. From the review of 11/11/2026.
- **`latest` follows the highest tag**: `release.yml` moves `latest` only if the published tag is the highest among the `v*` of the repo (`sort -V`), so an old tag pushed for recovery does not take back those who follow `latest`.
- **Node security releases do not arrive at once from Dependabot**: the `node` and
  `alpine` images are pinned by digest and the Docker update has a `cooldown` of 7 days, so the new
  digest is proposed a week later. With a Node.js bulletin the digests of the `Dockerfile` are updated
  by hand (`docker buildx imagetools inspect node:24-alpine`) and the image's
  `NODE_VERSION` is checked. Done on 22/10/2026 for 24.22.1.
- **Vitest stays at 4**: with Vitest 5 Stryker 10 does not activate the mutants (all "survived",
  verified on 16/10/2026). Dependabot ignores Vitest 5 until Stryker supports it.
- **Stryker outside Nextcloud**: inside `D:\Nextcloud` the `.stryker-tmp` folder gives `EPERM` on
  locked files, so it is run on a clone outside the synced folder.
- **File name of `gh attestation download`**: on Linux it is `sha256:<hex>.jsonl`, on Windows
  `sha256-<hex>.jsonl`. `release.yml` picks it up with `sha256?<hex>.jsonl`. Trying it only on Windows
  made the Release job of v2026.10.7 fail (19/10/2026), completed by hand afterwards.
