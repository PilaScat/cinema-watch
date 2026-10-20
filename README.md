<p align="center"><img src="assets/logo.svg" alt="" width="96"></p>

<h1 align="center">Cinema Watch</h1>

<p align="center">Cacce ai biglietti dei cinema italiani, con avvisi su Telegram e la pianta della sala.</p>

<p align="center">
  <a href="https://github.com/PilaScat/cinema-watch/releases/latest"><img src="https://img.shields.io/github/v/release/PilaScat/cinema-watch" alt="Versione"></a>
  <a href="https://github.com/PilaScat/cinema-watch/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/PilaScat/cinema-watch/ci.yml" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/PilaScat/cinema-watch" alt="Licenza"></a>
  <a href="https://github.com/PilaScat/cinema-watch/commits/main"><img src="https://img.shields.io/github/last-commit/PilaScat/cinema-watch" alt="Ultimo commit"></a>
  <br>
  <a href="https://github.com/PilaScat/cinema-watch/pkgs/container/cinema-watch"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fipitio.github.io%2Fbackage%2FPilaScat%2Fcinema-watch%2Fcinema-watch.json&amp;query=%24.downloads&amp;label=ghcr%20pulls" alt="Download dell'immagine"></a>
  <a href="https://github.com/PilaScat/cinema-watch/pkgs/container/cinema-watch"><img src="https://ghcr-badge.egpl.dev/pilascat/cinema-watch/size" alt="Dimensione dell'immagine"></a>
  <a href="https://github.com/PilaScat/cinema-watch/pkgs/container/cinema-watch"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED?logo=docker&amp;logoColor=white" alt="Piattaforme"></a>
  <br>
  <a href="https://scorecard.dev/viewer/?uri=github.com/PilaScat/cinema-watch"><img src="https://api.scorecard.dev/projects/github.com/PilaScat/cinema-watch/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/projects/15670"><img src="https://www.bestpractices.dev/projects/15670/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://github.com/sponsors/PilaScat"><img src="https://img.shields.io/badge/sponsor-GitHub-ea4aaa?logo=githubsponsors" alt="Sponsor"></a>
  <a href="https://github.com/PilaScat/cinema-watch/stargazers"><img src="https://img.shields.io/github/stars/PilaScat/cinema-watch?style=social" alt="Stelle su GitHub"></a>
</p>

## Cosa fa

- **Cacce**: un film (anche non ancora in programmazione, cercato per titolo), uno o più cinema, i formati di sala (IMAX, XL, Infinity Vision…) e le date, con filtri facoltativi per orario (anche diverso per ogni giorno della settimana), giorni della settimana e lingua.
- **Avvisi su Telegram**: nuovi spettacoli, posti liberati, ultimi posti, spettacoli annullati o spostati, con la pianta della sala e i migliori posti liberi.
- **Zona buona**: le file e i posti che vanno bene, relativi alla sala o fissati cliccando sulla pianta, con il numero di posti vicini richiesto.
- **Pulsanti nel messaggio**: Acquista, Apri sala, Aggiorna ora, Silenzia 24 h e Acquistato, con Riattiva e Ripristina per tornare indietro; `/aggiorna` rilegge tutte le cacce.
- **Cinema**: UCI Cinemas, i 35 The Space Cinema, circa 300 cinema che vendono con Webtic (Notorious, Cinelandia, Movie Planet e molti indipendenti) e i cinema 18Tickets, ordinabili per distanza da casa; un cinema 18Tickets che manca si aggiunge nelle Impostazioni.
- **Web UI**: cacce, programmazione, pagina dello spettacolo con la pianta dal vivo e l'andamento dei posti, ricerca di un film anche con un errore di battitura; si installa come app dietro HTTPS.

<p align="center">
  <img src="docs/img/pianta.png" width="32%" alt="La pianta della sala come arriva su Telegram">
  <img src="docs/img/home.png" width="32%" alt="Le cacce">
  <img src="docs/img/cinema.png" width="32%" alt="I cinema dal più vicino a casa">
</p>

<p align="center">La pianta su Telegram, le cacce e i cinema per distanza da una casa d'esempio a Milano.</p>

## Stack

- Node 24 e TypeScript
- Hono, con JSX lato server
- Tailwind v4, compilato in fase di build
- resvg per i PNG delle piante
- zod per validare configurazione e risposte delle API
- dati in file JSON e JSONL, nessun database
- immagine `ghcr.io/pilascat/cinema-watch` per amd64 e arm64, circa 157 MB, utente 99:100, compatibile con `--read-only`; a riposo il processo usa circa 50 MiB di memoria propria (misurati su Unraid il 18/10/2026; `docker stats` mostra di più perché conta anche la cache dei file)

## Avvio rapido

### Con Docker

```sh
docker run -d --name cinema-watch \
  -p 8790:8790 \
  -v /percorso/dati:/data \
  --read-only --tmpfs /tmp \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --restart unless-stopped \
  ghcr.io/pilascat/cinema-watch:latest
```

La cartella dei dati deve essere scrivibile dall'utente 99:100: `chown 99:100 /percorso/dati`.

### Con Docker Compose

Il file [docker-compose.yml](docker-compose.yml) è un esempio con le stesse opzioni, con i dati in `./data`:

```sh
mkdir -p data && chown 99:100 data
docker compose up -d
```

### Primi passi

1. Aprire `http://IP:8790`.
2. In Impostazioni, sezione Telegram, inserire il token del bot e la chat principale ([come ottenerli](docs/telegram.md)), salvare e premere Invia prova.
3. Premere Aggiungi caccia e compilare film, cinema, formati e date.
4. Facoltativo: in Impostazioni, sezione Casa e distanza, impostare la posizione di casa ("lat, lon" da Google Maps, oppure "Usa la mia posizione" aprendo l'app in HTTPS) e un raggio massimo. Cinema, ricerca e scelta dei cinema nelle cacce si ordinano allora per distanza.

### Sviluppo in locale

```sh
npm ci
npm run build
DATA_DIR=./data node dist/server.js
```

I quattro controlli da far passare prima di consegnare:

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Altri comandi:

- `node dist/server.js --dry-run` esegue un giro contro le API vere. Messaggi e piante finiscono in `DATA_DIR/dry-run` e non viene inviato nulla a Telegram.
- `sh scripts/smoke.sh` prova il container: immagine, avvio in sola lettura, route, permessi, arresto, giro a secco. Il dettaglio è in [docs/operations.md](docs/operations.md#smoke-test).

## Rilascio e deploy

Un rilascio è un tag annotato `vAAAA.MM.N`, che fa partire `release.yml`: verifica, scansione, immagini amd64 e arm64, attestazione e Release su GitHub. Su Unraid si installa con il template [deploy/cinema-watch.xml](deploy/cinema-watch.xml). Tutti i passaggi sono in [docs/operations.md](docs/operations.md).

## Variabili d'ambiente

| Variabile | Predefinito | Significato |
|---|---|---|
| `PORT` | `8790` | Porta della web UI. |
| `DATA_DIR` | `/data` | Cartella di configurazione, stato, piante, andamento e registro. |
| `UI_PASSWORD` | vuota | Password della web UI. Vuota: nessuna password. |
| `TRUST_PROXY` | vuota | Con `1` l'app si fida di `X-Forwarded-For` per il blocco dei tentativi di accesso per IP. Serve solo con la password. |
| `TELEGRAM_TOKEN` | vuota | Token del bot. Vale solo se il campo nelle Impostazioni è vuoto. |
| `TELEGRAM_CHAT_ID` | vuota | Chat principale. Vale solo se il campo nelle Impostazioni è vuoto. |

Le Impostazioni mostrano quando token o chat arrivano dall'ambiente.

## Limiti

- Funziona con UCI Cinemas, The Space Cinema e i cinema che vendono i biglietti con Webtic o 18Tickets; altri circuiti no.
- I cinema 18Tickets non hanno coordinate e vanno in fondo all'ordine per distanza.
- L'elenco dei cinema Webtic si aggiorna con un controllo settimanale: al primo avvio si completa in circa mezz'ora.
- Le API usate sono pubbliche ma non ufficiali e possono cambiare senza preavviso.
- I posti si leggono senza login.
- L'acquisto resta a mano: il login UCI ha Cloudflare e captcha, Webtic, The Space e 18Tickets chiedono l'account, e l'app non li tocca.

## Documentazione

| File | Argomento |
|---|---|
| [docs/MEMORY.md](docs/MEMORY.md) | Decisioni e trappole del progetto. |
| [docs/api.md](docs/api.md) | API di UCI e Webtic usate, API esposte dall'app. |
| [docs/telegram.md](docs/telegram.md) | Bot, chat, avvisi, pulsanti e limiti di invio. |
| [docs/homepage.md](docs/homepage.md) | Widget per gethomepage. |
| [docs/operations.md](docs/operations.md) | Deploy, aggiornamenti, backup, rilascio e smoke test. |
| [docs/UI-COPY.md](docs/UI-COPY.md) | Regole per i testi visibili. |
| [docs/backlog.md](docs/backlog.md) | Cosa resta da decidere o da fare nei prossimi rilasci. |
| [docs/best-practices.md](docs/best-practices.md) | Risposte al questionario OpenSSF Best Practices. |
| [CHANGELOG.md](CHANGELOG.md) | Note di ogni versione. |
| [SECURITY.md](SECURITY.md) | Come segnalare una vulnerabilità. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Come segnalare un problema e proporre una modifica. |

## Contribuire

Bug e proposte si aprono come issue; le vulnerabilità si segnalano in privato come spiega [SECURITY.md](SECURITY.md). Come preparare una pull request e quali controlli deve passare è in [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenza e crediti

Licenza MIT, vedi [LICENSE](LICENSE); le note delle parti di terzi sono in [NOTICE](NOTICE). Autore: Filippo Scatigna (PilaScat).

- [KiraPC/italian-cinema-mcp](https://github.com/KiraPC/italian-cinema-mcp) (MIT): da qui viene l'API della programmazione UCI.
- Font Bebas Neue e Barlow (OFL).
- Icone Lucide (ISC).

Non affiliato a UCI Cinemas, a Webtic né ai cinema elencati.
