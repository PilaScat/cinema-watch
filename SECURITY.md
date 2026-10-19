# Sicurezza

## Versioni supportate

Riceve correzioni solo l'ultima release pubblicata.

## Come segnalare una vulnerabilità

Non aprire una issue pubblica. Usa la segnalazione privata di GitHub:
**Security → Report a vulnerability** in questo repository, oppure direttamente
<https://github.com/PilaScat/cinema-watch/security/advisories/new>.

Nella segnalazione servono la versione, i passi per riprodurre il problema e l'impatto. La
prima risposta arriva entro 7 giorni.

## Divulgazione coordinata (coordinated disclosure)

1. La segnalazione resta privata finché non esce la correzione.
2. La correzione esce in una release nuova, con una voce nel [CHANGELOG](CHANGELOG.md).
3. Insieme alla release si pubblica un GitHub Security Advisory con la descrizione della
   vulnerabilità, le versioni colpite e quella corretta, e il nome di chi l'ha segnalata, se lo
   desidera.

## Cosa rientra

- l'app e l'immagine Docker `ghcr.io/pilascat/cinema-watch`;
- la gestione del token Telegram e della password della web UI;
- le chiamate verso UCI, Webtic, Telegram e GitHub.

Le API dei circuiti, come UCI e Webtic, non sono di questo progetto: i loro problemi vanno segnalati ai rispettivi gestori.

## Verificare un'immagine

Ogni immagine pubblicata ha un'attestazione di provenienza:

```sh
gh attestation verify oci://ghcr.io/pilascat/cinema-watch:<versione> -R PilaScat/cinema-watch
```
