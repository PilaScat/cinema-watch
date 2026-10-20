# Operazioni: deploy, aggiornamenti, backup, rilascio e smoke test

Questo documento raccoglie le operazioni per far girare cinema-watch e per rilasciarne le versioni. Per l'avvio di base, le opzioni del container e le variabili d'ambiente c'è il [README](../README.md).

## Deploy con Docker

I comandi `docker run` e `docker compose` sono nel [README](../README.md#avvio-rapido). Valgono questi punti per un'installazione stabile:

- la cartella dei dati è l'unico stato da conservare e deve essere scrivibile dall'utente 99:100;
- l'immagine regge `--read-only`: si scrive solo su `/data` e su `/tmp` (tmpfs);
- per usare una versione precisa al posto di `latest` basta il tag di una Release, per esempio `ghcr.io/pilascat/cinema-watch:v2026.10.1`;
- dietro un reverse proxy conviene impostare `UI_PASSWORD` e `TRUST_PROXY=1`, e inserire l'indirizzo pubblico nelle Impostazioni (URL pubblico). Servito in `https`, il sito si può installare come app dal browser.

## Deploy su Unraid

Il template [deploy/cinema-watch.xml](../deploy/cinema-watch.xml) crea il container con le opzioni di sicurezza e le variabili d'ambiente. Per usarlo, copiarlo in `/boot/config/plugins/dockerMan/templates-user/my-cinema-watch.xml` e aggiungere il container dalla scheda Docker scegliendo il template.

- **Percorso dei dati**: `/mnt/cache/appdata/cinema-watch` e non `/mnt/user/...`. Il FUSE di Unraid sotto `/mnt/user` non applica `chown` e `chmod`, e `config.json` deve restare con permessi `600`. `cache` è il nome del pool: se il pool ha un altro nome, va cambiato il percorso. Una cartella sotto `/mnt` senza pool finisce in RAM e si perde al riavvio.
- **Proprietario**: la cartella va creata prima di avviare il container e data a 99:100 (`mkdir -p /mnt/cache/appdata/cinema-watch && chown 99:100 /mnt/cache/appdata/cinema-watch`). Se la crea Unraid è di root, e l'app non riesce a scriverci.
- **Rete**: il template usa `bridge`; si può scegliere un'altra rete nella scheda del container.
- **Template**: una volta creato il container, Unraid salva i valori inseriti (password compresa) in `my-cinema-watch.xml`. Ricopiare il template del repo sopra quel file li cancella.

[deploy/deploy.sh](../deploy/deploy.sh) è lo script usato dall'autore sul suo server Unraid: copia il template, prepara la cartella dati 99:100 e pubblica il servizio. L'indirizzo del server si passa con `UNRAID_HOST`.

## Aggiornare l'immagine

La web UI mostra "Disponibile la vAAAA.MM.N" quando su GitHub c'è una Release più recente; l'app lo controlla una volta al giorno.

```sh
docker compose pull && docker compose up -d
```

Su Unraid si aggiorna il container dalla scheda Docker. Dati e configurazione stanno nella cartella dei dati e non si perdono. Le versioni nuove migrano da sole `config.json` e `state.json` (la versione 1 dello stato passa alla 2 conservando cacce, spettacoli e storico); se `state.json` ha una versione che l'app non conosce, riparte da uno stato vuoto. Il contrario no: un `config.json` scritto da una versione più recente viene rifiutato ("versione più recente dell'app"), quindi tornare a una versione vecchia richiede il backup della cartella dati.

## Backup

Il backup è la copia della cartella dei dati (`/data` nel container). Le scritture sono atomiche, quindi ogni file copiato è intero.

| Percorso | Contenuto |
|---|---|
| `config.json` | Impostazioni e cacce, token Telegram compreso. È l'unico file davvero necessario |
| `state.json` | Stato dei giri: spettacoli noti, silenzi, prossimo giro |
| `screens/` | Piante delle sale in cache |
| `history/` | Andamento dei posti liberi di ogni spettacolo |
| `events.jsonl` | Registro degli ultimi 500 eventi |
| `webtic-venues.json`, `space-venues.json`, `t18-venues.json` | Elenchi dei cinema Webtic, The Space e 18Tickets dei controlli settimanali; senza, il controllo riparte |
| `secret` | Chiave che firma i cookie di accesso, presente solo con `UI_PASSWORD` |

Le piante si riscaricano da sole; senza `history/` l'andamento ricomincia da zero. Per ripristinare si rimette la cartella al suo posto con proprietario 99:100 e `config.json` con permessi `600`.

`config.json` si può anche esportare dalle Impostazioni, sezione Esporta e importa, con Esporta senza token o Esporta con token. L'importazione valida tutto il file prima di sostituire la configurazione (limite 1 MB); un file senza token mantiene quello attuale. Se `config.json` non è valido all'avvio, l'app non lo sovrascrive: ne fa una copia `config.json.bak-<codice>` e chiede di correggerlo o eliminarlo.

## Spegnere o archiviare una caccia

| Azione | Effetto |
|---|---|
| Togliere "Caccia attiva" nel form della caccia | La caccia è in pausa: nessun giro e nessun avviso. Si riprende rimettendo la spunta |
| Silenzia 24 h (home o avviso su Telegram) | Per 24 ore la caccia continua a leggere ma non manda avvisi, e quelli di quelle ore non si recuperano. Riattiva (home o messaggio del bot) toglie il silenzio prima |
| Acquistato (pagina della caccia o avviso su Telegram) | Archivia la caccia: non è più attiva e compare fra le Archiviate |
| Date finite | Una caccia con date fisse si archivia da sola quando l'ultimo giorno è passato |
| Ripristina (fra le Archiviate, nella pagina della caccia o dal messaggio del bot dopo Acquistato) | Toglie l'archiviazione e apre la caccia. Se le date fisse sono finite, apre il form con un avviso: la caccia torna attiva quando la si salva con date nuove. Da Telegram, con le date finite, il bot non ripristina e rimanda alla pagina della caccia |
| Elimina | Cancella la caccia dalla configurazione |

Gli spettacoli passati escono dallo stato e il loro andamento si toglie dopo 30 giorni. I pulsanti Silenzia e Acquistato sono descritti in [telegram.md](telegram.md#comè-fatto-un-avviso).

## Rilascio

Un rilascio è un tag annotato più una Release su GitHub: un tag senza Release non è un rilascio.

1. Scrivere in `CHANGELOG.md` una sezione `## vAAAA.MM.N` con le note. Va scritta prima del tag: il workflow si ferma se non la trova.
2. Creare il tag annotato e pubblicarlo: `git tag -a vAAAA.MM.N -m "vAAAA.MM.N"` e `git push origin vAAAA.MM.N`. Il formato è `vAAAA.MM.N`, per esempio `v2026.10.1`.
3. `release.yml` parte dal tag. Si può anche lanciare a mano con l'ingresso `tag`, per un tag già pubblicato.

Il workflow `release.yml` esegue in ordine:

1. **Verifica** del codice al tag: test, tipi, lint, build, `npm audit`, firme dei pacchetti, licenze e presenza della sezione nel CHANGELOG.
2. **Trivy** sull'immagine amd64: si ferma su vulnerabilità CRITICAL o HIGH che hanno una correzione.
3. **Immagini** amd64 e arm64, ciascuna su un runner nativo, con SBOM e provenance.
4. **Manifest** che unisce le due immagini sotto `:vAAAA.MM.N` e `:latest`, e **attestazione** di provenienza registrata insieme all'immagine.
5. **Release** su GitHub con il testo della sezione del CHANGELOG, l'elenco dei commit compresi fra il tag precedente e questo, l'indicazione dell'immagine e, allegata, la provenienza firmata `cinema-watch-<tag>.intoto.jsonl` (il bundle Sigstore dell'attestazione). Serve anche al controllo Signed-Releases di OpenSSF Scorecard.

Per verificare l'attestazione di un'immagine:

```sh
gh attestation verify oci://ghcr.io/pilascat/cinema-watch:<tag> -R PilaScat/cinema-watch
```

### Se fallisce solo il job Release

Immagini, manifest e attestazione sono già pubblicati. Il tag non si sposta e non si cancella, e rilanciare il workflow ricostruirebbe le immagini con digest nuovi: `:latest` e il tag non coinciderebbero più. La Release si completa a mano con gli stessi passi del job, da Git Bash nella cartella del repo:

```sh
TAG=vAAAA.MM.N
IMAGE=ghcr.io/pilascat/cinema-watch
DIGEST=$(docker buildx imagetools inspect "$IMAGE:$TAG" --format '{{json .Manifest}}' | jq -r .digest)
git show "$TAG:CHANGELOG.md" | awk -v tag="$TAG" '$1 == "##" { inside = ($2 == tag); next } inside' > notes.md
previous=$(git describe --tags --abbrev=0 "$TAG^")
{ echo; echo "## Commit"; echo; git log --no-merges --format='- %s (%h)' "$previous..$TAG"; echo; echo "Immagine: \`$IMAGE:$TAG\` (amd64, arm64)"; } >> notes.md
gh attestation download "oci://$IMAGE@$DIGEST" -R PilaScat/cinema-watch
mv ./sha256?"${DIGEST#sha256:}.jsonl" "cinema-watch-$TAG.intoto.jsonl"
gh release create "$TAG" --verify-tag --title "$TAG" --notes-file notes.md "cinema-watch-$TAG.intoto.jsonl"
```

Poi si corregge il workflow su `main`, che vale dal rilascio successivo.

## Workflow automatici

Tutti i workflow si possono lanciare anche a mano (`workflow_dispatch`).

| Workflow | Quando parte |
|---|---|
| `ci.yml` | Su ogni pull request. Esegue test, tipi, lint, build, audit, licenze, `actionlint` e `zizmor`. Il suo job "Test, tipi, lint, build e sicurezza" è obbligatorio per entrare in `main` |
| `codeql.yml` | Push su `main`, pull request e ogni settimana |
| `scorecard.yml` | Ogni settimana |
| Dependabot | Ogni settimana, per le dipendenze npm, le GitHub Actions e l'immagine base |
| `release.yml` | Solo da un tag `v*` o a mano |

CodeQL, Scorecard, Dependabot e `ci.yml` sulle pull request partono da soli per scelta dell'autore del 15/10/2026. `release.yml` no: parte solo dal tag o dal lancio manuale.

Dal 19/10/2026 su `main` si entra solo con una pull request (regola "main protetto"): il job di `ci.yml` deve essere verde e il merge si fa con rebase, così i commit restano divisi per feature. Non serve l'approvazione di un revisore, perché il maintainer è uno solo, e la regola vale anche per gli admin. I passi sono in [CLAUDE.md](../CLAUDE.md).

## Smoke test

`sh scripts/smoke.sh` costruisce l'immagine e la prova come in produzione. Servono Docker e `curl`, e la rete: l'ultimo passaggio chiama le API vere. Si controlla che:

- l'immagine sia sotto i 200 MB;
- il container diventi `healthy` in sola lettura e con `--cap-drop=ALL`;
- la home risponda `200` e `/api/status` riporti la versione dell'immagine;
- una caccia aggiunta dal form venga accettata;
- `config.json` sia `600` e `/data` sia di 99:100;
- la RAM a riposo sia sotto i 100 MiB;
- l'arresto su SIGTERM sia pulito e il log non contenga errori;
- un giro completo a secco (`--dry-run`) contro le API vere produca messaggi e piante PNG.

Variabili utili: `PLATFORM` (predefinita `linux/amd64`), `IMAGE`, `SKIP_BUILD=1` per usare un'immagine già costruita e `SMOKE_PORT`. Con `PLATFORM=linux/arm64` su una macchina amd64 l'immagine gira emulata: lo smoke funziona, ma la RAM non si misura e lo script lo dice.
