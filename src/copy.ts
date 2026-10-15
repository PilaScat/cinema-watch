const SEPARATOR = " · ";

export const copy = {
  ui: {},
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
    noNews: { header: "🔄 Nessuna novità" },
  },
} as const;
