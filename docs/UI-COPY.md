# Come si scrive nell'app e nei messaggi

Regole per i testi visibili. Tutti stanno in `src/copy.ts`: la sezione `ui` per la web UI, la
sezione `telegram` per i messaggi. La guardia è `tests/copy-style.test.ts`.

## Registro e forma

- **Impersonale**: mai "tu", "noi" o "io". Si scrive `Posti liberati`, non `Si sono liberati dei posti per te`.
- **Niente punti esclamativi.** La severità la danno il colore e la parola.
- **Emoji**: mai nella web UI. Su Telegram una sola, all'inizio del messaggio, per riconoscerlo
  mentre si scorre.
- **Numeri in cifre**, con l'unità attaccata: `3 posti`, `44 liberi`.
- **Prezzi** solo da `formatEur` (`14,90 €`).
- **Date e ore** solo dai formatter di `src/format.ts`: `mar 15/12`, `20:30`.
- **Titoli in sentence case**, senza `&`.
- **Stati vuoti**: `Nessuna <cosa>.` e, solo se c'è un rimedio, dove si rimedia.

## Lunghezze

| Dove | Massimo |
|---|---|
| descrizione di pagina | 12 parole, una frase col punto |
| hint di un campo | 8 parole, senza punto |
| `title` e `aria-label` | 15 parole, senza punto |
| riga di un messaggio Telegram | 1 informazione |

## Vocabolario

| Concetto | Parola | Non |
|---|---|---|
| una ricerca sorvegliata | **caccia** | ricerca, alert, monitoraggio |
| una proiezione con data e ora | **spettacolo** | proiezione, show, replica |
| il tipo di sala (IMAX, XL…) | **formato** | tecnologia, tipo |
| la parte di sala desiderata | **zona buona** | zona preferita, area |
| posti adiacenti nella stessa fila | **posti vicini** | consecutivi, attaccati |
| posti non presi | **liberi** | disponibili |
| posti nel carrello di altri | **nel carrello** | bloccati |
| comprare sul sito UCI | **Acquista** | Compra, Prenota |
| controllo fatto a mano | **Aggiorna ora** | Controlla, Ricarica |
| fermare gli avvisi per un po' | **Silenzia** | Muta, Pausa |
| chiudere una caccia riuscita | **Acquistato** | Fatto, Comprato |
| aggiungere a un elenco | **Aggiungi** | Crea, Nuova |
| salvare modifiche | **Salva** | Conferma, Applica |
| eliminare | **Elimina** | Cancella, Rimuovi |
| riattivare dopo Silenzia | **Riattiva** | Riprendi |
