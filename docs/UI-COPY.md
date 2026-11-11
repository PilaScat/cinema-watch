# Come si scrive nell'app e nei messaggi

Regole per i testi visibili. Stanno in `src/i18n/`: `en.ts` è la fonte e definisce il tipo `Copy`,
`it.ts` lo deve soddisfare, quindi una chiave che manca in italiano non compila. La sezione `ui` è
per la web UI, la sezione `telegram` per i messaggi. Le guardie sono `tests/copy-style.test.ts` e
`tests/i18n.test.ts`.

## Lingue

- La web UI segue la lingua del browser (`Accept-Language`): italiano se lo chiede, inglese
  altrimenti. Il selettore nel piede (Automatica, English, Italiano) la fissa in un cookie.
- Le pagine prendono testi e formati da `src/web/i18n.ts` (`copy`, `localized`, `formatDay`…), che
  li sceglie per la richiesta in corso. Fuori da una funzione una pagina li prepara con
  `localized((all) => all.ui.…)`, non li legge.
- Un testo nuovo si scrive prima in `en.ts`, poi in `it.ts`. Un testo uguale nelle due lingue va
  nell'elenco `SHARED` di `tests/copy-style.test.ts`.
- Messaggi di Telegram, registro ed errori non hanno un browser: seguono l'impostazione Lingua dei
  messaggi (`settings.language`). I moduli fuori da `src/web/` leggono `copy` da `src/copy.ts` e i
  formati da `src/format.ts`, che seguono quell'impostazione.

## Registro e forma

- **Impersonale**: mai "tu", "noi" o "io". Si scrive `Posti liberati`, non `Si sono liberati dei posti per te`.
- **Niente punti esclamativi.** La severità la danno il colore e la parola.
- **Emoji**: mai nella web UI. Su Telegram una sola, all'inizio del messaggio, per riconoscerlo
  mentre si scorre.
- **Numeri in cifre**, con l'unità attaccata: `3 posti`, `44 liberi`.
- **Prezzi** solo da `formatEur` (`14,90 €`, in inglese `€14.90`).
- **Date e ore** solo dai formatter di `src/format.ts`: `mar 15/12`, `20:30` (in inglese `Tue 15/12`).
  L'ora resta quella di Roma in tutte e due le lingue.
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

| Concetto | Italiano | English | Non |
|---|---|---|---|
| una ricerca sorvegliata | **caccia** | **hunt** | ricerca, alert, monitoraggio |
| una proiezione con data e ora | **spettacolo** | **showing** | proiezione, show, replica |
| il tipo di sala (IMAX, XL…) | **formato** | **format** | tecnologia, tipo |
| il disegno dei posti di una sala | **pianta** | **seat map** | mappa, piantina |
| la parte di sala desiderata | **zona buona** | **good zone** | zona preferita, area |
| posti adiacenti nella stessa fila | **posti vicini** | **seats together** | consecutivi, attaccati |
| posti non presi | **liberi** | **free** | disponibili |
| posti nel carrello di altri | **nel carrello** | **in a basket** | bloccati |
| un passaggio di controllo delle cacce | **giro** | **round** | ciclo, scansione |
| comprare sul sito del cinema | **Acquista** | **Buy** | Compra, Prenota |
| controllo fatto a mano | **Aggiorna ora** | **Refresh now** | Controlla, Ricarica |
| fermare gli avvisi per un po' | **Silenzia** | **Mute** | Muta, Pausa |
| chiudere una caccia riuscita | **Acquistato** | **Bought** | Fatto, Comprato |
| aggiungere a un elenco | **Aggiungi** | **Add** | Crea, Nuova |
| salvare modifiche | **Salva** | **Save** | Conferma, Applica |
| eliminare | **Elimina** | **Delete** | Cancella, Rimuovi |
| riattivare dopo Silenzia | **Riattiva** | **Resume** | Riprendi |

In inglese si scrive all'inglese (`cinema`, `film`, `centre`, `programme`), come le date.
