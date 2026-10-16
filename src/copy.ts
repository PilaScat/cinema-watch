import { ui } from "./web/copy/index.js";

const SEPARATOR = " · ";

export const copy = {
  ui,
  hall: {
    labels: {
      screen: "SCHERMO",
      free: "Liberi",
      sold: "Venduti",
      blocked: "Nel carrello",
      reserved: "Riservati",
      accessible: "Disabili",
      best: "Migliori",
      zone: "Zona buona",
    },
    subtitle: (theatre: string, room: string, day: string, time: string): string =>
      [theatre, room, `${day} ${time}`].join(SEPARATOR),
  },
  callbacks: {
    refreshing: "Aggiornamento in corso",
    tooSoon: "Aggiornata meno di 30 s fa",
    refreshed: "Aggiornato",
    noNews: "Nessuna novità",
    muted: "Silenziata per 24 h",
    bought: "Caccia archiviata",
    primaryOnly: "Solo dalla chat principale",
    notFound: "Caccia non trovata",
    conflict: "Un altro programma legge gli aggiornamenti di questo bot",
  },
  errors: {
    huntFailed: (name: string, detail: string): string => `⚠️ <b>${name}</b>: lettura non riuscita\n${detail}`,
    telegramUnknown: "Errore di Telegram senza descrizione",
    telegramNotConfigured: "Telegram non configurato",
    telegramInvalid: "Risposta di Telegram non valida",
    source: (source: string, reason: string): string => `${source}: ${reason}`,
    reasons: {
      status: (code: number): string => `risposta ${code}`,
      timeout: "nessuna risposta",
      network: "rete non raggiungibile",
      backoff: "in pausa dopo errori ripetuti",
      redirect: "risposta deviata",
      host: "indirizzo non consentito",
      parse: "risposta non leggibile",
      shape: "risposta in formato inatteso",
      refused: (detail: string): string => `richiesta rifiutata (${detail})`,
      unknown: "errore imprevisto",
    },
  },
  telegram: {
    huntHeader: (name: string): string => `🎬 <b>${name}</b>`,
    sections: {
      freed: "Posti liberati",
      created: "Nuovi spettacoli",
      lastSeats: "Ultimi posti",
      moved: "Spostati",
      cancelled: "Annullati",
      movies: "Film comparsi",
    },
    sectionTitle: (title: string): string => `<b>${title}</b>`,
    showingLine: (day: string, time: string, theatre: string, room: string, format: string): string =>
      [`${day} ${time}`, theatre, room, format].join(SEPARATOR),
    seats: (free: number, freeInZone: number): string => `${free} liberi, ${freeInZone} nella zona buona`,
    price: (formattedPrice: string): string => `da ${formattedPrice}`,
    noPlan: "pianta non disponibile",
    best: (groups: string): string => `Migliori: ${groups}`,
    lastSeats: (freeInZone: number): string =>
      freeInZone === 0 ? "zona buona esaurita" : `${freeInZone} liberi nella zona buona`,
    moved: (from: string, to: string, theatre: string, room: string): string =>
      `${from} → ${to}${SEPARATOR}${theatre}${SEPARATOR}${room}`,
    movieAppeared: (title: string, theatre: string): string =>
      `${title} a ${theatre}: da confermare nella pagina della caccia`,
    more: (count: number): string => `e altri ${count}`,
    openHall: (url: string): string => `Apri sala: ${url}`,
    separator: SEPARATOR,
    buttons: {
      buy: (time: string | null): string => (time === null ? "Acquista" : `Acquista ${time}`),
      openHall: "Apri sala",
      refresh: "Aggiorna ora",
      mute: "Silenzia 24 h",
      bought: "Acquistato",
    },
    caption: (title: string, day: string, time: string, room: string, format: string, seats: string): string =>
      `<b>${title}</b>\n${day} ${time}${SEPARATOR}${room}${SEPARATOR}${format}\n${seats}`,
    digest: {
      header: "🗓 Riepilogo delle cacce",
      huntLine: (name: string, showings: number, withSeats: number): string =>
        showings === 0
          ? `<b>${name}</b>: nessuno spettacolo`
          : `<b>${name}</b>: ${showings} ${showings === 1 ? "spettacolo" : "spettacoli"}, ${withSeats} con posti vicini nella zona buona`,
      mutedUntil: (time: string): string => `silenziata fino alle ${time}`,
    },
    test: {
      header: "✅ Prova di cinema-watch",
      body: "Gli avvisi delle cacce arriveranno in questa chat.",
    },
    noNews: {
      header: "🔄 Nessuna novità",
      huntLine: (name: string, showings: number, freeInZone: number): string =>
        showings === 0
          ? `<b>${name}</b>: nessuno spettacolo`
          : `<b>${name}</b>: ${showings} ${showings === 1 ? "spettacolo" : "spettacoli"}, ${freeInZone} liberi nella zona buona`,
    },
  },
  validation: {
    integerFrom: (min: number, max: number): string => `intero da ${min} a ${max}`,
    integerFromOne: "intero da 1",
    slugFormat: "solo minuscole, cifre e trattini",
    timeFormat: "formato HH:MM",
    chatIdFormat: "numero o @nome",
    rowsStartAfterEnd: "le file iniziano dopo che finiscono",
    emptyLabel: "etichetta vuota",
    atLeastOneRow: "almeno una fila",
    firstSeatAfterLast: "il primo posto viene dopo l'ultimo",
    atLeastOneMovie: "almeno un film",
    emptyWord: "parola vuota",
    atLeastOneWord: "almeno una parola",
    invalidDay: "giorno non valido (AAAA-MM-GG)",
    precedesStart: "precede l'inizio",
    idFormat: "8 caratteri tra minuscole e cifre",
    nameLength: "da 1 a 80 caratteri",
    atLeastOneTheatre: "almeno un cinema",
    atLeastOneDay: "almeno un giorno",
    repeatedDays: "giorni ripetuti",
    hallKeyFormat: "chiavi nel formato cinema-sala",
    tokenFormat: "formato del token non valido",
    publicUrlFormat: "URL http o https senza credenziali",
    emptyType: "tipo vuoto",
    atLeastOneType: "almeno un tipo",
    repeatedId: "id ripetuto",
    invalidType: "tipo non valido",
    unknownKey: "chiave sconosciuta",
    valueNotAllowed: "valore non ammesso",
    root: "(radice)",
    newerSchema: "versione più recente dell'app",
    fileTooLarge: "file oltre 1 MB",
    invalidJson: "JSON non valido",
  },
  storage: {
    invalidPath: (name: string): string => `Percorso non valido: ${name}`,
    notJson: (name: string): string => `${name} non è JSON valido`,
    writeFailed: (file: string): string => `Scrittura di ${file} non riuscita`,
    permissionsNotApplied: (file: string): string => `Permessi di ${file} non applicati`,
    appendFailed: (name: string): string => `Aggiunta a ${name} non riuscita`,
    readFailed: (name: string): string => `Lettura di ${name} non riuscita`,
    removeFailed: (name: string): string => `Rimozione di ${name} non riuscita`,
    listFailed: (subdir: string): string => `Elenco di ${subdir} non riuscito`,
    backupFailed: (name: string): string => `Backup di ${name} non riuscito`,
    unreadable: "illeggibile",
    backupNotDone: "non riuscita",
    configInvalid: (file: string, errors: string): string => `${file} non è valido: ${errors}`,
    configRejected: (detail: string, backup: string, file: string): string =>
      `${detail}. Copia di sicurezza: ${backup}. Va corretto ${file}, oppure eliminato per ripartire dalle impostazioni predefinite.`,
  },
} as const;
