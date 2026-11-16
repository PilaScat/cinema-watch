# Backlog

What is left to decide or to do in the next releases. A finished item is removed from here and goes in the
[CHANGELOG](../CHANGELOG.md).

## To do

| Item | What is needed |
|---|---|
| Same film still split in the search | Since v2026.11.2 the search and the pages of a cinema merge the versions of a film with a closed list of wordings (`src/movie-groups.ts`): on the catalogue of 12/11/2026, 786 titles became 609 films, with no wrong merge. Left apart on purpose, because merging them needs a guess: titles cut by the cinema (`George Michael: The Fa`, about 9), typos and prepositions (`Il Gatto Con Il Cappello` and `Col Cappello`), added subtitles (`Carlo Acutis - Il Giovane Santo`), a bare `Infinity` or `Energia` without a dash. To decide with Filippo whether any of these is worth a rule. |
| Foreign cinemas | Survey done on 16/11/2026: [foreign-circuits.md](foreign-circuits.md). Vue UK, Vue NL and CinemaxX DE run on the platform of The Space, with the same calls (programme and seat map read on Vue UK); the American circuits and Odeon, Pathé, Kinepolis and Multikino refuse a plain HTTP client. Before any code a registry of the circuits is needed (chain, slug prefix, hosts, country, time zone, currency) in place of the about 8 places where a circuit is wired today. Filippo's choice whether to go on. |
| Other circuits | Survey done on 16/11/2026: [italian-circuits.md](italian-circuits.md). Eplanet, Notorious, Cineplexx, Giometti, Movie Planet and Starplex sell through Webtic and are already in the list. Left: the Anteo and spazioCinema cinemas, on an 18Tickets host the app does not know (`spaziocinema.18tickets.it`); three Eplanet cinemas missing from the Webtic list; Liveticket, which for cinemas gives programme and prices but not the taken seats. Filippo's choice. |
| 18Tickets cinemas without a region | 19 out of 83 on 12/11. Since v2026.11.2 a cinema with no address on its home page takes it from `/impressum` of the same site, where the page lists it by name: checked on the two with films, Cinema Multisala Massimo (Lecce) and Filmclub Cinema Capitol (Bolzano). The others are arenas and Lab80 venues with no programme: to count again after the next weekly check, and to see whether their impressum lists them under another name. |
| Mutation below 80% | Full mutation run of 20/10 on the 13 Stryker files: 83.50% (threshold 75). Below 80%: `the-space.ts` 73.91%, `t18.ts` 76.03%, `watcher.ts` 78.27% (it was 84.28% before The Space and 18Tickets). Mostly conditions and error texts of the parsers and the wiring of the circuits in the watcher survive. Targeted tests on those cases are needed, to decide with Filippo. |
| OpenSSF Scorecard score (7.7 on 19/10) | From the repo everything possible is done: License, Signed-Releases, Security-Policy and CI-Tests are at 10, CII-Best-Practices at 5 (passing badge). Maintained rises on its own from mid January 2027, when the repo is 90 days old: it is the only open alert in Security. Code-Review and Branch-Protection stay low (see below) and Contributors stays at 0. |

## Choices confirmed after the reviews

The reviews flagged them. They stay as they are and are written here so they do not come back as problems.

- "Seats freed" also fires when the seat map becomes readable for the first time with good seats: the first alert was text only, with the zone "not available".
- "Moved" also applies to a showing that disappeared in the previous round and is not yet cancelled, and to a change of time or hall on the same key.
- The state of a showing goes out at the start of the showing; the trend stays 30 days. The log rotates at 500 events, so it is not cleaned per showing.
- The password comparison uses `scrypt` with a per-process salt: no hash is stored.
- The seat maps per round stay configurable from 1 to 10 (default 3).
- Telegram does not use the JSON client of `http.ts` (the per-host queues would block the sends during long polling): it shares the `createGuardedFetch` guard, that is only https towards the allowed hosts and no redirects.
- Scorecard Code-Review (0) and Branch-Protection (3): since 19/10 `main` is entered only with a pull request and green CI, even for admins, but to raise them the approvals of a reviewer other than the author are needed, which a single maintainer does not have. The two alerts in Security are closed as "won't fix" with this reason.
