import { NotaFiscal, NotaHistorico, User } from "@prisma/client";
import { NotaFiscalResponse, NotaHistoricoResponse, NotaStatus } from "../types";

const MS_POR_DIA = 1000 * 60 * 60 * 24;

/**
 * Normaliza uma data para o início do dia e evita diferenças de horário ao comparar prazos.
 */
export function normalizarData(data: Date): Date {
  const normalizada = new Date(data);
  normalizada.setHours(0, 0, 0, 0);
  return normalizada;
}

/**
 * Calcula a diferença inteira de dias entre duas datas normalizadas.
 */
export function diferencaEmDias(dataInicial: Date, dataFinal: Date): number {
  const inicio = normalizarData(dataInicial).getTime();
  const fim = normalizarData(dataFinal).getTime();
  return Math.round((fim - inicio) / MS_POR_DIA);
}

/**
 * Determina o status visual da nota fiscal com base na data limite.
 */
export function calcularStatus(dataLimite: Date, hoje = new Date()): NotaStatus {
  const diasRestantes = diferencaEmDias(hoje, dataLimite);

  if (diasRestantes < 0) {
    return "atrasada";
  }

  if (diasRestantes === 0) {
    return "venceHoje";
  }

  if (diasRestantes === 1) {
    return "venceAmanha";
  }

  if (diasRestantes <= 3) {
    return "venceEm3Dias";
  }

  return "dentroPrazo";
}

/**
 * Traduz a distância do prazo em um indicador amigável para o dashboard.
 */
export function gerarIndicadorPrazo(diasRestantes: number): string {
  if (diasRestantes < 0) {
    const diasAtraso = Math.abs(diasRestantes);
    return diasAtraso === 1 ? "Atrasada há 1 dia" : `Atrasada há ${diasAtraso} dias`;
  }

  if (diasRestantes === 0) {
    return "Vence hoje";
  }

  if (diasRestantes === 1) {
    return "Vence em 1 dia";
  }

  return `Vence em ${diasRestantes} dias`;
}

/**
 * Converte o status em peso numérico para ordenação automática por urgência.
 */
export function obterPesoPrioridade(status: NotaStatus): number {
  const pesos: Record<NotaStatus, number> = {
    atrasada: 0,
    venceHoje: 1,
    venceAmanha: 2,
    venceEm3Dias: 3,
    dentroPrazo: 4,
  };

  return pesos[status];
}

/**
 * Formata o histórico da nota para uso direto no frontend.
 */
export function formatarHistorico(
  historico: NotaHistorico & { user: Pick<User, "id" | "nome"> },
): NotaHistoricoResponse {
  return {
    id: historico.id,
    numeroNota: historico.numeroNota,
    acao: historico.acao,
    descricao: historico.descricao,
    alteracoes: (historico.alteracoes as Record<string, unknown> | null) ?? null,
    userId: historico.userId,
    userNome: historico.user.nome,
    createdAt: historico.createdAt.toISOString(),
  };
}

/**
 * Enriquece a nota fiscal com campos calculados usados no dashboard.
 */
export function formatarNotaFiscal(
  nota: NotaFiscal & {
    historicos?: (NotaHistorico & { user: Pick<User, "id" | "nome"> })[];
  },
): NotaFiscalResponse {
  const hoje = new Date();
  const diasDesdeChegada = diferencaEmDias(new Date(nota.dataChegada), hoje);
  const diasRestantes = diferencaEmDias(hoje, new Date(nota.dataLimite));
  const status = calcularStatus(new Date(nota.dataLimite), hoje);

  return {
    id: nota.id,
    numero: nota.numero,
    cliente: nota.cliente,
    destinatario: nota.destinatario,
    dataEmissao: nota.dataEmissao.toISOString(),
    dataChegada: nota.dataChegada.toISOString(),
    dataLimite: nota.dataLimite.toISOString(),
    userId: nota.userId,
    diasDesdeChegada,
    diasRestantes,
    status,
    indicadorPrazo: gerarIndicadorPrazo(diasRestantes),
    prioridadePeso: obterPesoPrioridade(status),
    historicoRecente: (nota.historicos ?? []).map(formatarHistorico),
  };
}
