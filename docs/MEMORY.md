# Memoria del progetto: decisioni e trappole

Quello che non si capisce leggendo il codice. Le API sono descritte in [api.md](api.md) (fase 2).

## Dati UCI e Webtic

- **Chiave di uno spettacolo**: `{LocalId}-{PerformanceId}`. Il PerformanceId di Webtic è unico
  solo dentro un cinema (LocalId), quindi da solo non basta come chiave.
- **Giorno del cinema**: `performances[].day` è il giorno di programmazione. Lo spettacolo delle
  00:01 del 16 ha `day` 15. Date e giorni della settimana usano `day`; i filtri "dalle/alle"
  usano l'ora reale.
- **Posti presi**: l'occupazione elenca solo i posti presi. `ACQUISTO` è venduto, `BLOCCATO` è nel
  carrello di qualcuno e si libera in pochi minuti: conta come preso, altrimenti gli avvisi dei posti
  liberati oscillano.
- **Posti vendibili**: `SeatType` fra quelli vendibili (default `STANDARD`) e settore diverso da
  `UN`, che è quello dei disabili. Il settore `HA` (VIP nelle sale XL e 2D di Verona) è vendibile.
  `RISERVATO` non si vende.
- **Asse della sala**: `Row` più basso è la fila più vicina allo schermo (fila A = `Row` 2 in tutte
  le sale viste). Due posti sono vicini se hanno lo stesso `Row` e `Column` consecutive.
- **Numeri dei posti**: non seguono sempre la posizione. A Campi Bisenzio la fila A parte da
  `A/20` sulla colonna più bassa. La centralità si calcola sulle colonne; il ritocco a mano della
  zona usa i numeri, perché sono quelli che si leggono in sala.
- **Formati**: i nomi in programmazione (`XL - INFINITY VISION`, `2D - INFINITY VISION`) e quelli
  dei cinema (`XL`, `2D`) si allineano con `normalizeFormat`.
- **Login UCI**: Cloudflare e captcha. L'app non fa login e non compra: legge solo dati pubblici.
