# Changelog

Le versioni seguono il formato `vAAAA.MM.N`. Ogni sezione si scrive prima del tag.

## v2026.10.1

Primo rilascio.

### Cacce

- Più cacce attive insieme, ognuna su uno o più cinema UCI, qualunque formato di sala, date fisse
  o prossimi N giorni, con filtri facoltativi per orario, giorni della settimana e lingua.
- Film scelto dal menu della programmazione, per slug quando non è ancora in programmazione, o per
  parole del titolo con conferma di ogni film trovato.
- Zona buona relativa (file e centro in percentuale) o ritoccata per sala cliccando sulla pianta,
  con il numero di posti vicini richiesti. Se la pianta di una sala cambia, la zona ritoccata va
  riconfermata.
- Intervallo predefinito e per caccia, fascia silenziosa, ritardo casuale, cache condivisa fra le
  cacce.

### Avvisi su Telegram

- Nuovi spettacoli, posti liberati (con pausa di 30 minuti), ultimi posti (con soglia e isteresi),
  spettacoli annullati o spostati, film comparsi, riepilogo giornaliero.
- Le piante dei migliori spettacoli in un album, poi un riepilogo con Acquista, Apri sala,
  Aggiorna ora, Silenzia 24 h e Acquistato. Migliori posti liberi e prezzo da in ogni messaggio.
- Comando `/aggiorna`, chat aggiuntive per caccia, code con i limiti di Telegram.
- "Invia prova" verifica che Telegram accetti l'URL pubblico come pulsante; se no, i link vanno
  nel testo.
- Token e chat dalle Impostazioni o dalle variabili d'ambiente.

### Web UI

- Cacce, cinema, ricerca di un film, programmazione, pagina dello spettacolo con la pianta dal
  vivo e l'andamento dei posti, registro, impostazioni con esporta e importa.
- Tema chiaro, scuro o automatico; installabile come PWA dietro HTTPS; password facoltativa.
- `/api/status` per il widget di Homepage e `/health` per il controllo del container.

### Container e sicurezza

- Immagine `ghcr.io/pilascat/cinema-watch` per amd64 e arm64, utente 99:100, compatibile con
  `--read-only` e `--cap-drop=ALL`, con SBOM, provenance e attestazione.
- CSP con nonce, CSRF, blocco dopo 5 tentativi di accesso, token mai nella pagina, nei log o
  nell'esportazione senza token.
