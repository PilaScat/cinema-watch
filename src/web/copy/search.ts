export const search = {
  title: "Cerca",
  description: "Un film anche da una parte del titolo, con i cinema che lo proiettano.",
  label: "Titolo del film",
  placeholder: "avengers, dune parte tre",
  button: "Cerca",
  resultsTitle: "Film",
  dates: (from: string | null, to: string | null): string => [from === null ? "" : `dal ${from}`, to === null ? "" : `al ${to}`].filter((part) => part !== "").join(" "),
  theatresTitle: (title: string): string => `Cinema con ${title}`,
  noTheatres: "Nessun cinema lo proietta per ora.",
  empty: "Nessun film trovato.",
  emptyHint: "Basta una parte del titolo, e un piccolo errore di battitura va bene.",
  catalogUnavailable: "Catalogo UCI non disponibile: la ricerca vale solo per il titolo esatto.",
} as const;
