import { NotaFiscal } from "@prisma/client";
import { NotaFiscalResponse, NotaStatus } from "../types";

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
 * Enriquece a nota fiscal com campos calculados usados no dashboard.
 */
export function formatarNotaFiscal(nota: NotaFiscal): NotaFiscalResponse {
  const hoje = new Date();
  const diasDesdeChegada = diferencaEmDias(new Date(nota.dataChegada), hoje);
  const diasRestantes = diferencaEmDias(hoje, new Date(nota.dataLimite));

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
    status: calcularStatus(new Date(nota.dataLimite), hoje),
  };
}
