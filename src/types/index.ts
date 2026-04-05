export type NotaStatus =
  | "atrasada"
  | "venceHoje"
  | "venceAmanha"
  | "venceEm3Dias"
  | "dentroPrazo";

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface NotaFiscalRequestBody {
  numero: string;
  cliente: string;
  destinatario: string;
  dataEmissao: string;
  dataChegada: string;
  dataLimite: string;
}

export interface NotaFiscalResponse {
  id: string;
  numero: string;
  cliente: string;
  destinatario: string;
  dataEmissao: string;
  dataChegada: string;
  dataLimite: string;
  userId: string;
  diasDesdeChegada: number;
  diasRestantes: number;
  status: NotaStatus;
}
