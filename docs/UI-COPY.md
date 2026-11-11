# How to write in the app and in the messages

Rules for the visible texts. They live in `src/i18n/`: `en.ts` is the source and defines the `Copy` type,
`it.ts` must satisfy it, so a key missing in Italian does not compile. The `ui` section is
for the web UI, the `telegram` section for the messages. The guards are `tests/copy-style.test.ts` and
`tests/i18n.test.ts`.

## Languages

- The web UI follows the browser language (`Accept-Language`): Italian if it asks for it, English
  otherwise. The selector in the footer (Automatic, English, Italiano) fixes it in a cookie.
- The pages take texts and formats from `src/web/i18n.ts` (`copy`, `localized`, `formatDay`…), which
  chooses them for the current request. Outside a function a page prepares them with
  `localized((all) => all.ui.…)`, it does not read them.
- A new text is written first in `en.ts`, then in `it.ts`. A text that is the same in the two languages goes
  in the `SHARED` list of `tests/copy-style.test.ts`.
- Telegram messages, log and errors have no browser: they follow the Language of the messages
  setting (`settings.language`). The modules outside `src/web/` read `copy` from `src/copy.ts` and the
  formats from `src/format.ts`, which follow that setting.

## Register and form

- **Impersonal**: never "you", "we" or "I". Write `Posti liberati`, not `Si sono liberati dei posti per te`.
- **No exclamation marks.** Severity is given by colour and word.
- **Emoji**: never in the web UI. On Telegram only one, at the start of the message, to recognise it
  while scrolling.
- **Numbers in digits**, with the unit attached: `3 posti`, `44 liberi`.
- **Prices** only from `formatEur` (`14,90 €`, in English `€14.90`).
- **Dates and times** only from the formatters in `src/format.ts`: `mar 15/12`, `20:30` (in English `Tue 15/12`).
  The time stays Rome time in both languages.
- **Titles in sentence case**, without `&`.
- **Empty states**: `Nessuna <cosa>.` and, only if there is a remedy, where to remedy it.

## Lengths

| Where | Maximum |
|---|---|
| page description | 12 words, one sentence with a full stop |
| hint of a field | 8 words, no full stop |
| `title` and `aria-label` | 15 words, no full stop |
| line of a Telegram message | 1 piece of information |

## Vocabulary

| Concept | Italiano | English | Not |
|---|---|---|---|
| a watched search | **caccia** | **hunt** | ricerca, alert, monitoraggio |
| a screening with date and time | **spettacolo** | **showing** | proiezione, show, replica |
| the type of hall (IMAX, XL…) | **formato** | **format** | tecnologia, tipo |
| the drawing of the seats of a hall | **pianta** | **seat map** | mappa, piantina |
| the wanted part of the hall | **zona buona** | **good zone** | zona preferita, area |
| adjacent seats in the same row | **posti vicini** | **seats together** | consecutivi, attaccati |
| seats not taken | **liberi** | **free** | disponibili |
| seats in the basket of others | **nel carrello** | **in a basket** | bloccati |
| one check pass over the hunts | **giro** | **round** | ciclo, scansione |
| buying on the cinema's site | **Acquista** | **Buy** | Compra, Prenota |
| a check done by hand | **Aggiorna ora** | **Refresh now** | Controlla, Ricarica |
| stopping alerts for a while | **Silenzia** | **Mute** | Muta, Pausa |
| closing a successful hunt | **Acquistato** | **Bought** | Fatto, Comprato |
| adding to a list | **Aggiungi** | **Add** | Crea, Nuova |
| saving changes | **Salva** | **Save** | Conferma, Applica |
| removing | **Elimina** | **Delete** | Cancella, Rimuovi |
| reactivating after Mute | **Riattiva** | **Resume** | Riprendi |

In English, write English (`cinema`, `film`, `centre`, `programme`), like the dates.
