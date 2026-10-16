// Reference lists for Brazilian addresses and time zones (IANA identifiers).

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";
export const LOCALE = "pt-BR";

export const BRAZIL_TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (SP, RJ, MG, Sul, GO, DF, BA…)" },
  { value: "America/Fortaleza", label: "Fortaleza (CE, MA, PI, RN, PB)" },
  { value: "America/Recife", label: "Recife (PE)" },
  { value: "America/Maceio", label: "Maceió (AL, SE)" },
  { value: "America/Bahia", label: "Salvador (BA)" },
  { value: "America/Belem", label: "Belém (PA leste, AP)" },
  { value: "America/Santarem", label: "Santarém (PA oeste)" },
  { value: "America/Araguaina", label: "Araguaína (TO)" },
  { value: "America/Cuiaba", label: "Cuiabá (MT)" },
  { value: "America/Campo_Grande", label: "Campo Grande (MS)" },
  { value: "America/Manaus", label: "Manaus (AM leste)" },
  { value: "America/Porto_Velho", label: "Porto Velho (RO)" },
  { value: "America/Boa_Vista", label: "Boa Vista (RR)" },
  { value: "America/Rio_Branco", label: "Rio Branco (AC)" },
  { value: "America/Eirunepe", label: "Eirunepé (AM oeste)" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
] as const;

export const BRAZIL_TIMEZONE_VALUES = BRAZIL_TIMEZONES.map((zone) => zone.value) as [string, ...string[]];

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
