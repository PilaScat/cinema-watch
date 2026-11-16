# Italian circuits not covered

Survey of 16/11/2026 of the ticketing platforms of Italian cinemas beyond UCI, Webtic, The Space and 18Tickets. No code was written. Requests were few (at most 10 per site), GET only, and none to the four platforms the app already reads.

## Result

| Platform or chain | Cinemas | What it is | Left to do |
|---|---|---|---|
| Eplanet | 8 in Sicily | Sells through Webtic: its showing page loads the Webtic script from `secure.webtic.it`. 5 of the 8 are already in the Webtic list of the app (Eplanet Catania, Eplanet Lopo, La Torre Palermo, King Palermo, Hollywood Gela) | nothing: see why Vasquez (Siracusa), Le Vigne (Agrigento) and Ariston (Catania) are not in the list |
| Notorious Cinemas | 9 | Already in the Webtic list of the app, all 9 | nothing |
| Cineplexx (Bolzano, Lagundo) | 2 | Already in the Webtic list of the app | nothing |
| Giometti | about 12 | 6 are in the Webtic list of the app | see whether the others sell elsewhere |
| Movie Planet | 9 in the list | Already in the Webtic list of the app | nothing |
| Starplex | 4 in the list | Already in the Webtic list of the app | nothing |
| Anteo, spazioCinema | about 12 | Sells on `spaziocinema.18tickets.it`, which is not among the 18Tickets hosts the app knows (checked on the list of 10/11) | add the host in Settings, 18Tickets cinemas, or among the seed hosts |
| Liveticket | about 90 venues with a cinema name, among about 466 organisers | Its own platform. Venue list and programme are public, as HTML. The showing looked at has unnumbered seats: a price table and a "tickets available" notice, no seat map and no taken seats | programme and prices only; seat alerts are not possible where seats are unnumbered |
| Vivaticket | not counted | The cinema page redirects to a Queue-it waiting room | not surveyed |

Platform not found for: Circuito Cinema, MyCinema, Cinebot, Ticketone cinema, ArteVen.

Most Italian chains sell through Webtic, which the app already reads. The only large platform left is Liveticket, and for cinemas it does not say which seats are taken.

## Liveticket

| Call | Answer |
|---|---|
| `GET https://www.liveticket.it/robots.txt` | 200: only the Slurp agent is disallowed |
| `GET https://www.liveticket.it/` | 200: HTML list of about 466 organisers, no JSON |
| `GET https://www.liveticket.it/cinemadianatrapani` | 200: the showings of the venue in HTML, each with a link `evento.aspx?Id=<n>` |
| `GET https://www.liveticket.it/evento.aspx?Id=712710` | 200: sector "Platea A", unnumbered seats, full 8,00 and reduced 6,00, notice of tickets available |
| `GET https://www.liveticket.it/ricerca_eventi.aspx?id=13596` | 200: events of the Cinema category, HTML |

No JSON programme was found, unlike the note of 19/10. The page code has a branch for numbered seats: no cinema showing with numbered seats was seen, one venue was looked at.

## Eplanet

| Call | Answer |
|---|---|
| `GET https://www.eplanetcinemas.it/robots.txt` | 200: only `/admin/` and `/dashboard/` disallowed |
| `GET https://www.eplanetcinemas.it/` | 200: films and cinemas as JSON inside the page |
| `GET https://www.eplanetcinemas.it/king` | 200: showings with links `/eticket/king/<film>/<showing>/` |
| `GET https://www.eplanetcinemas.it/eticket/king/1244/43348/` | 200: loads `secure.webtic.it/angwt/js/webapi/jquery.webtic.api.4.0.js` |

## Not verified

The purchase host of Notorious and Cineplexx was not read: they are in the Webtic list of the app, which is the proof that counts. The count of Liveticket cinemas is an estimate from the names of the links.
