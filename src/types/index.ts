export type NotaStatus =
  | "atrasada"
  | "venceHoje"
  | "venceAmanha"
  | "venceEm3Dias"
  | "dentroPrazo";

export type UserRole = "ADMIN" | "OPERADOR";

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface NotaFiscalRequestBody {
  numero: string;
  cliente: string;
  destinatario: string;
  observacoes?: string;
  dataEmissao: string;
  dataChegada: string;
  dataLimite: string;
}

export interface NotaHistoricoResponse {
  id: string;
  numeroNota: string;
  acao: string;
  descricao: string;
  alteracoes: Record<string, unknown> | null;
  userId: string;
  userNome: string;
  createdAt: string;
}

export interface NotaFiscalResponse {
  id: string;
  numero: string;
  cliente: string;
  destinatario: string;
  observacoes: string | null;
  dataEmissao: string;
  dataChegada: string;
  dataLimite: string;
  userId: string;
  diasDesdeChegada: number;
  diasRestantes: number;
  status: NotaStatus;
  indicadorPrazo: string;
  prioridadePeso: number;
  historicoRecente: NotaHistoricoResponse[];
}

export interface DashboardAlerta {
  id: string;
  titulo: string;
  descricao: string;
  status: NotaStatus;
  numero: string;
}

export interface DashboardResumo {
  atrasadas: number;
  vencendo: number;
  noPrazo: number;
  total: number;
}

export interface PaginacaoResponse {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
