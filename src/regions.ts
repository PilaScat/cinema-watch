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

const CAPITAL_BY_POSTAL_PREFIX = new Map(
  "00 RM 01 VT 02 RI 03 FR 04 LT 05 TR 06 PG 07 SS 08 NU 09 CA 10 TO 11 AO 12 CN 13 VC 14 AT 15 AL 16 GE 17 SV 18 IM 19 SP 20 MI 21 VA 22 CO 23 SO 24 BG 25 BS 26 CR 27 PV 28 NO 29 PC 30 VE 31 TV 32 BL 33 UD 34 TS 35 PD 36 VI 37 VR 38 TN 39 BZ 40 BO 41 MO 42 RE 43 PR 44 FE 45 RO 46 MN 47 FC 48 RA 50 FI 51 PT 52 AR 53 SI 54 MS 55 LU 56 PI 57 LI 58 GR 59 PO 60 AN 61 PU 62 MC 63 AP 64 TE 65 PE 66 CH 67 AQ 70 BA 71 FG 72 BR 73 LE 74 TA 75 MT 76 BT 80 NA 81 CE 82 BN 83 AV 84 SA 85 PZ 86 CB 87 CS 88 CZ 89 RC 90 PA 91 TP 92 AG 93 CL 94 EN 95 CT 96 SR 97 RG 98 ME"
    .split(" ")
    .flatMap((token, index, tokens): Array<[string, string]> => (index % 2 === 0 ? [[token, tokens[index + 1] ?? ""]] : [])),
);

export function regionOfProvince(abbreviation: string): string | null {
  return REGION_OF_PROVINCE.get(abbreviation.trim().toUpperCase()) ?? null;
}

export function regionOfPostalCode(postalCode: string): string | null {
  const capital = /^\d{5}$/.test(postalCode) ? CAPITAL_BY_POSTAL_PREFIX.get(postalCode.slice(0, 2)) : undefined;
  return capital === undefined ? null : regionOfProvince(capital);
}
