export const search = {
  title: "Cerca",
  description: "Un film per titolo, con i cinema che lo proiettano.",
  label: "Titolo del film",
  placeholder: "Dune: Parte Tre",
  button: "Cerca",
  theatresTitle: (query: string): string => `Cinema con ${query}`,
  suggestionsTitle: "Film già nelle cacce",
  empty: "Nessun risultato.",
  emptyHint: "Il titolo va scritto per intero, come sul sito UCI.",
} as const;
