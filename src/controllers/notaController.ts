import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma/client";
import {
  calcularStatus,
  formatarHistorico,
  formatarNotaFiscal,
  normalizarData,
} from "../utils/dateHelpers";
import { DashboardAlerta, DashboardResumo } from "../types";
import { logger } from "../utils/logger";

const notaSchema = z
  .object({
    numero: z.string().min(1, "Informe o número da nota fiscal."),
    cliente: z.string().min(2, "Informe o cliente."),
    destinatario: z.string().min(2, "Informe o destinatário final."),
    dataEmissao: z.string().min(1, "Informe a data de emissão."),
    dataChegada: z.string().min(1, "Informe a data de chegada."),
    dataLimite: z.string().min(1, "Informe a data limite."),
  })
  .superRefine((dados, ctx) => {
    const dataEmissao = new Date(dados.dataEmissao);
    const dataChegada = new Date(dados.dataChegada);
    const dataLimite = new Date(dados.dataLimite);

    if (dataChegada < dataEmissao) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data de chegada não pode ser anterior à emissão.",
        path: ["dataChegada"],
      });
    }

    if (dataLimite < dataChegada) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data limite não pode ser anterior à chegada.",
        path: ["dataLimite"],
      });
    }
  });

const filtrosSchema = z.object({
  status: z.string().optional(),
  periodo: z.string().optional(),
  busca: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(50).default(10),
  sortBy: z.enum(["urgencia", "prazo", "cliente", "chegada"]).default("urgencia"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Monta o resumo consolidado do dashboard.
 */
function montarResumo(notas: ReturnType<typeof formatarNotaFiscal>[]): DashboardResumo {
  return notas.reduce(
    (acc, nota) => {
      if (nota.status === "atrasada") {
        acc.atrasadas += 1;
      } else if (nota.status === "dentroPrazo") {
        acc.noPrazo += 1;
      } else {
        acc.vencendo += 1;
      }

      acc.total += 1;
      return acc;
    },
    { atrasadas: 0, vencendo: 0, noPrazo: 0, total: 0 },
  );
}

/**
 * Constrói alertas internos de alto impacto para o dashboard.
 */
function montarAlertas(
  notas: ReturnType<typeof formatarNotaFiscal>[],
  limite = 5,
): DashboardAlerta[] {
  return notas
    .filter((nota) => nota.status !== "dentroPrazo")
    .sort((a, b) => a.prioridadePeso - b.prioridadePeso || a.diasRestantes - b.diasRestantes)
    .slice(0, limite)
    .map((nota) => ({
      id: nota.id,
      titulo: `${nota.numero} • ${nota.indicadorPrazo}`,
      descricao: `${nota.cliente} • Destino: ${nota.destinatario}`,
      status: nota.status,
      numero: nota.numero,
    }));
}

/**
 * Registra um evento de histórico de nota fiscal.
 */
async function registrarHistorico(params: {
  notaId?: string;
  numeroNota: string;
  userId: string;
  acao: string;
  descricao: string;
  alteracoes?: Record<string, unknown>;
}) {
  await prisma.notaHistorico.create({
    data: {
      notaId: params.notaId,
      numeroNota: params.numeroNota,
      userId: params.userId,
      acao: params.acao as never,
      descricao: params.descricao,
      alteracoes: (params.alteracoes as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    },
  });
}

/**
 * Ordena as notas conforme o critério escolhido pelo usuário.
 */
function ordenarNotas(
  notas: ReturnType<typeof formatarNotaFiscal>[],
  sortBy: "urgencia" | "prazo" | "cliente" | "chegada",
  sortOrder: "asc" | "desc",
) {
  const fator = sortOrder === "asc" ? 1 : -1;

  return [...notas].sort((a, b) => {
    if (sortBy === "cliente") {
      return a.cliente.localeCompare(b.cliente) * fator;
    }

    if (sortBy === "chegada") {
      return (
        (new Date(a.dataChegada).getTime() - new Date(b.dataChegada).getTime()) * fator
      );
    }

    if (sortBy === "prazo") {
      return (new Date(a.dataLimite).getTime() - new Date(b.dataLimite).getTime()) * fator;
    }

    return (
      (a.prioridadePeso - b.prioridadePeso || a.diasRestantes - b.diasRestantes) * fator
    );
  });
}

/**
 * Busca as sugestões mais usadas para acelerar o preenchimento do formulário.
 */
export async function obterSugestoes(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const [clientes, destinatarios] = await Promise.all([
    prisma.notaFiscal.groupBy({
      by: ["cliente"],
      where: { userId },
      _count: { cliente: true },
      orderBy: { _count: { cliente: "desc" } },
      take: 8,
    }),
    prisma.notaFiscal.groupBy({
      by: ["destinatario"],
      where: { userId },
      _count: { destinatario: true },
      orderBy: { _count: { destinatario: "desc" } },
      take: 8,
    }),
  ]);

  response.json({
    clientes: clientes.map((item) => item.cliente),
    destinatarios: destinatarios.map((item) => item.destinatario),
  });
}

/**
 * Lista alertas internos com foco em notas críticas.
 */
export async function listarAlertas(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const notas = await prisma.notaFiscal.findMany({
    where: { userId },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
  });

  const formatadas = notas.map(formatarNotaFiscal);
  response.json({ alertas: montarAlertas(formatadas, 10) });
}

/**
 * Exporta as notas filtradas em formato CSV.
 */
export async function exportarNotas(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const filtros = filtrosSchema.parse(request.query);

  const notas = await prisma.notaFiscal.findMany({
    where: {
      userId,
      OR: filtros.busca
        ? [
            { numero: { contains: filtros.busca, mode: "insensitive" } },
            { cliente: { contains: filtros.busca, mode: "insensitive" } },
            { destinatario: { contains: filtros.busca, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
  });

  let formatadas = ordenarNotas(notas.map(formatarNotaFiscal), filtros.sortBy, filtros.sortOrder);

  if (filtros.periodo === "7" || filtros.periodo === "30") {
    const hoje = normalizarData(new Date());
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + Number(filtros.periodo));
    formatadas = formatadas.filter((nota) => normalizarData(new Date(nota.dataLimite)) <= limite);
  }

  if (filtros.status && filtros.status !== "todos") {
    formatadas = formatadas.filter((nota) => nota.status === filtros.status);
  }

  const csvLinhas = [
    [
      "Numero",
      "Cliente",
      "Destinatario",
      "DataEmissao",
      "DataChegada",
      "DataLimite",
      "Status",
      "IndicadorPrazo",
    ].join(","),
    ...formatadas.map((nota) =>
      [
        nota.numero,
        nota.cliente,
        nota.destinatario,
        nota.dataEmissao,
        nota.dataChegada,
        nota.dataLimite,
        nota.status,
        nota.indicadorPrazo,
      ]
        .map((campo) => `"${String(campo).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];

  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", "attachment; filename=notas-fiscais.csv");
  response.send(csvLinhas.join("\n"));
}

/**
 * Lista as notas fiscais do usuário autenticado com filtros, busca, paginação e ordenação.
 */
export async function listarNotas(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const filtros = filtrosSchema.parse(request.query);
  const hoje = normalizarData(new Date());

  const notas = await prisma.notaFiscal.findMany({
    where: {
      userId,
      OR: filtros.busca
        ? [
            { numero: { contains: filtros.busca, mode: "insensitive" } },
            { cliente: { contains: filtros.busca, mode: "insensitive" } },
            { destinatario: { contains: filtros.busca, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  let notasFormatadas = notas.map(formatarNotaFiscal);

  if (filtros.periodo === "7" || filtros.periodo === "30") {
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + Number(filtros.periodo));
    notasFormatadas = notasFormatadas.filter(
      (nota) => normalizarData(new Date(nota.dataLimite)) <= limite,
    );
  }

  if (filtros.status && filtros.status !== "todos") {
    notasFormatadas = notasFormatadas.filter((nota) => nota.status === filtros.status);
  }

  notasFormatadas = ordenarNotas(notasFormatadas, filtros.sortBy, filtros.sortOrder);

  const totalItems = notasFormatadas.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / filtros.pageSize));
  const page = Math.min(filtros.page, totalPages);
  const inicio = (page - 1) * filtros.pageSize;
  const paginadas = notasFormatadas.slice(inicio, inicio + filtros.pageSize);

  response.json({
    resumo: montarResumo(notasFormatadas),
    alertas: montarAlertas(notasFormatadas),
    notas: paginadas,
    paginacao: {
      page,
      pageSize: filtros.pageSize,
      totalItems,
      totalPages,
    },
    filtrosAplicados: {
      busca: filtros.busca ?? "",
      periodo: filtros.periodo ?? "todos",
      status: filtros.status ?? "todos",
      sortBy: filtros.sortBy,
      sortOrder: filtros.sortOrder,
    },
  });
}

/**
 * Busca uma nota fiscal específica pertencente ao usuário autenticado com histórico completo.
 */
export async function obterNota(request: Request, response: Response): Promise<void> {
  const userId = request.userId;
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;

  if (!id) {
    response.status(400).json({ message: "Identificador da nota fiscal não informado." });
    return;
  }

  const nota = await prisma.notaFiscal.findFirst({
    where: { id, userId },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!nota) {
    response.status(404).json({ message: "Nota fiscal não encontrada." });
    return;
  }

  response.json({
    ...formatarNotaFiscal(nota),
    historicoCompleto: nota.historicos.map(formatarHistorico),
  });
}

/**
 * Cria uma nova nota fiscal para o usuário autenticado.
 */
export async function criarNota(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const dados = notaSchema.parse(request.body);

  const nota = await prisma.notaFiscal.create({
    data: {
      ...dados,
      numero: dados.numero.trim(),
      cliente: dados.cliente.trim(),
      destinatario: dados.destinatario.trim(),
      dataEmissao: new Date(dados.dataEmissao),
      dataChegada: new Date(dados.dataChegada),
      dataLimite: new Date(dados.dataLimite),
      userId,
    },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
      },
    },
  });

  await registrarHistorico({
    notaId: nota.id,
    numeroNota: nota.numero,
    userId,
    acao: "CRIADA",
    descricao: "Nota fiscal cadastrada no sistema.",
    alteracoes: {
      cliente: nota.cliente,
      destinatario: nota.destinatario,
      dataLimite: nota.dataLimite.toISOString(),
    },
  });

  logger.info("Nota criada", { notaId: nota.id, userId, numero: nota.numero });
  const notaAtualizada = await prisma.notaFiscal.findUniqueOrThrow({
    where: { id: nota.id },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  response.status(201).json(formatarNotaFiscal(notaAtualizada));
}

/**
 * Atualiza uma nota fiscal do usuário autenticado e registra histórico de alterações.
 */
export async function atualizarNota(request: Request, response: Response): Promise<void> {
  const userId = request.userId;
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  const dados = notaSchema.parse(request.body);

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  if (!id) {
    response.status(400).json({ message: "Identificador da nota fiscal não informado." });
    return;
  }

  const notaExistente = await prisma.notaFiscal.findFirst({
    where: { id, userId },
  });

  if (!notaExistente) {
    response.status(404).json({ message: "Nota fiscal não encontrada." });
    return;
  }

  const alteracoes: Record<string, unknown> = {};

  if (notaExistente.destinatario !== dados.destinatario.trim()) {
    alteracoes.destinatario = {
      de: notaExistente.destinatario,
      para: dados.destinatario.trim(),
    };
  }

  if (notaExistente.cliente !== dados.cliente.trim()) {
    alteracoes.cliente = {
      de: notaExistente.cliente,
      para: dados.cliente.trim(),
    };
  }

  if (notaExistente.numero !== dados.numero.trim()) {
    alteracoes.numero = {
      de: notaExistente.numero,
      para: dados.numero.trim(),
    };
  }

  if (notaExistente.dataLimite.toISOString().slice(0, 10) !== dados.dataLimite) {
    alteracoes.dataLimite = {
      de: notaExistente.dataLimite.toISOString(),
      para: new Date(dados.dataLimite).toISOString(),
    };
  }

  const nota = await prisma.notaFiscal.update({
    where: { id },
    data: {
      numero: dados.numero.trim(),
      cliente: dados.cliente.trim(),
      destinatario: dados.destinatario.trim(),
      dataEmissao: new Date(dados.dataEmissao),
      dataChegada: new Date(dados.dataChegada),
      dataLimite: new Date(dados.dataLimite),
    },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  await registrarHistorico({
    notaId: nota.id,
    numeroNota: nota.numero,
    userId,
    acao: "ATUALIZADA",
    descricao: "Nota fiscal atualizada.",
    alteracoes,
  });

  if (alteracoes.dataLimite) {
    await registrarHistorico({
      notaId: nota.id,
      numeroNota: nota.numero,
      userId,
      acao: "PRAZO_ALTERADO",
      descricao: "Prazo da nota fiscal alterado.",
      alteracoes: { dataLimite: alteracoes.dataLimite },
    });
  }

  if (alteracoes.destinatario) {
    await registrarHistorico({
      notaId: nota.id,
      numeroNota: nota.numero,
      userId,
      acao: "DESTINATARIO_ALTERADO",
      descricao: "Destinatário final alterado.",
      alteracoes: { destinatario: alteracoes.destinatario },
    });
  }

  const notaAtualizada = await prisma.notaFiscal.findUniqueOrThrow({
    where: { id: nota.id },
    include: {
      historicos: {
        include: {
          user: {
            select: { id: true, nome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  response.json(formatarNotaFiscal(notaAtualizada));
}

/**
 * Exclui uma nota fiscal pertencente ao usuário autenticado e mantém o histórico para auditoria.
 */
export async function excluirNota(request: Request, response: Response): Promise<void> {
  const userId = request.userId;
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  if (!id) {
    response.status(400).json({ message: "Identificador da nota fiscal não informado." });
    return;
  }

  const notaExistente = await prisma.notaFiscal.findFirst({
    where: { id, userId },
  });

  if (!notaExistente) {
    response.status(404).json({ message: "Nota fiscal não encontrada." });
    return;
  }

  await registrarHistorico({
    notaId: notaExistente.id,
    numeroNota: notaExistente.numero,
    userId,
    acao: "EXCLUIDA",
    descricao: "Nota fiscal excluída do sistema.",
    alteracoes: {
      cliente: notaExistente.cliente,
      destinatario: notaExistente.destinatario,
      dataLimite: notaExistente.dataLimite.toISOString(),
    },
  });

  await prisma.notaFiscal.delete({
    where: { id },
  });

  response.status(204).send();
}
