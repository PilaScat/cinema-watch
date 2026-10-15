# Sicurezza

## Versioni supportate

Riceve correzioni solo l'ultima release pubblicata.

## Come segnalare una vulnerabilità

Non aprire una issue pubblica. Usa la segnalazione privata di GitHub:
**Security → Report a vulnerability** in questo repository.

Nella segnalazione servono la versione, i passi per riprodurre il problema e l'impatto. La
prima risposta arriva entro 7 giorni.

## Cosa rientra

- l'app e l'immagine Docker `ghcr.io/pilascat/cinema-watch`;
- la gestione del token Telegram e della password della web UI;
- le chiamate verso UCI, Webtic, Telegram e GitHub.

Le API di UCI e Webtic non sono di questo progetto: i loro problemi vanno segnalati a UCI Cinemas.
