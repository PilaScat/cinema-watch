const PROVINCES_BY_REGION: Record<string, string[]> = {
  Abruzzo: ["AQ", "CH", "PE", "TE"],
  Basilicata: ["MT", "PZ"],
  Calabria: ["CS", "CZ", "KR", "RC", "VV"],
  Campania: ["AV", "BN", "CE", "NA", "SA"],
  "Emilia Romagna": ["BO", "FC", "FE", "MO", "PC", "PR", "RA", "RE", "RN"],
  "Friuli Venezia Giulia": ["GO", "PN", "TS", "UD"],
  Lazio: ["FR", "LT", "RI", "RM", "VT"],
  Liguria: ["GE", "IM", "SP", "SV"],
  Lombardia: ["BG", "BS", "CO", "CR", "LC", "LO", "MB", "MI", "MN", "PV", "SO", "VA"],
  Marche: ["AN", "AP", "FM", "MC", "PU"],
  Molise: ["CB", "IS"],
  Piemonte: ["AL", "AT", "BI", "CN", "NO", "TO", "VB", "VC"],
  Puglia: ["BA", "BR", "BT", "FG", "LE", "TA"],
  Sardegna: ["CA", "CI", "NU", "OG", "OR", "OT", "SS", "SU", "VS"],
  Sicilia: ["AG", "CL", "CT", "EN", "ME", "PA", "RG", "SR", "TP"],
  Toscana: ["AR", "FI", "GR", "LI", "LU", "MS", "PI", "PO", "PT", "SI"],
  "Trentino Alto Adige": ["BZ", "TN"],
  Umbria: ["PG", "TR"],
  "Valle d'Aosta": ["AO"],
  Veneto: ["BL", "PD", "RO", "TV", "VE", "VI", "VR"],
};

const REGION_OF_PROVINCE = new Map(Object.entries(PROVINCES_BY_REGION).flatMap(([region, provinces]) => provinces.map((province): [string, string] => [province, region])));

export function regionOfProvince(abbreviation: string): string | null {
  return REGION_OF_PROVINCE.get(abbreviation.trim().toUpperCase()) ?? null;
}
