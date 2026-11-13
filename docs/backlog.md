# Backlog

What is left to decide or to do in the next releases. A finished item is removed from here and goes in the
[CHANGELOG](../CHANGELOG.md).

## To do

| Item | What is needed |
|---|---|
| Identical films merged in the search | Today the catalogue is merged by identical slug (`mergeCatalogs`), so the same film appears once for each different title (version, format, circuit) and the cinemas must be searched item by item. One result per film is needed, with all its cinemas, without merging different films (sequels, remakes, similar titles). Routes to measure on the real catalogue before choosing: a key from the title with only the version wordings removed from a closed list (format, language, hall), not the distance between titles; a circuit datum that identifies the film (original title, year, duration, id), to see who provides it; or leave the items and show under each result the nearby or favourite cinemas. Criterion: zero wrong merges on the test catalogue, and the versions remain selectable inside the film. |
| Foreign cinemas | Survey only, no code: for the largest American and European circuits (pistes to check: Vue and CinemaxX, which share the platform of The Space, Cineworld and Cinema City, Odeon and UCI Germany, Pathé, Kinepolis, UGC, Yelmo, AMC, Regal, Cinemark) what can be read without a login: programme, seat map, taken seats, prices, keys and anti-bot blocks, with the calls tried. The result goes in `docs/foreign-circuits.md`. Before any code a registry of the circuits is needed (chain, slug prefix, hosts, country, time zone, currency) in place of the about 8 places where a circuit is wired today. |
| Other circuits | Covered: UCI, Webtic, The Space (v2026.10.9) and 18Tickets (v2026.10.10). Left are the others from the survey of 19/10: Liveticket (JSON programme, single seat), Eplanet (8 cinemas in Sicily) and the long tail with captcha. For each one a survey of the public APIs is needed (cinemas, programme, seat map, taken seats) and then Filippo's choice. |
| 18Tickets cinemas without a region | 20 out of 83 on 20/10, almost all arenas and Lab80 venues with no programme: the home page has no address. Another source for the address is needed (for example the cinema's information page), to check on a few domains. |
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
