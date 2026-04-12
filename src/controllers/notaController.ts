import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import PDFDocument from "pdfkit";
import XLSX from "xlsx";
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

/**
 * Normaliza valores vindos da query string para evitar que campos vazios,
 * arrays ou a string literal "undefined" quebrem a validacao.
 */
function normalizarValorQuery(valor: unknown) {
  if (Array.isArray(valor)) {
    return valor[0];
  }

  if (typeof valor === "string") {
    const valorLimpo = valor.trim();

    if (!valorLimpo || valorLimpo.toLowerCase() === "undefined" || valorLimpo.toLowerCase() === "null") {
      return undefined;
    }

    return valorLimpo;
  }

  return valor;
}

const notaSchema = z
  .object({
    numero: z.string().min(1, "Informe o número da nota fiscal."),
    cliente: z.string().min(2, "Informe a cidade."),
    destinatario: z.string().min(2, "Informe o destinatário final."),
    observacoes: z.string().max(2000, "As observações devem ter no máximo 2000 caracteres.").optional(),
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
  status: z.preprocess(normalizarValorQuery, z.string().optional()),
  periodo: z.preprocess(normalizarValorQuery, z.string().optional()),
  visao: z.preprocess(normalizarValorQuery, z.enum(["ativas", "arquivadas"]).default("ativas")),
  busca: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(1000).default(1000),
  sortBy: z.preprocess(
    normalizarValorQuery,
    z.enum(["urgencia", "prazo", "cliente", "chegada"]).default("urgencia"),
  ),
  sortOrder: z.preprocess(normalizarValorQuery, z.enum(["asc", "desc"]).default("asc")),
});

const exportacaoSchema = filtrosSchema.extend({
  formato: z.enum(["pdf", "csv", "excel"]).default("pdf"),
});

/**
 * Define o escopo de acesso às notas conforme o perfil autenticado.
 */
function obterEscopoNotas(userId: string, userRole?: string) {
  if (userRole === "ADMIN") {
    return {};
  }

  return { userId };
}

/**
 * Define se a busca deve considerar notas ativas ou arquivadas.
 */
function obterFiltroArquivamento(visao: "ativas" | "arquivadas") {
  return visao === "arquivadas" ? { NOT: { entregueEm: null } } : { entregueEm: null };
}

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
 * Aplica os mesmos filtros operacionais usados no dashboard para reaproveitar na exportação.
 */
function aplicarFiltrosNotas(
  notas: ReturnType<typeof formatarNotaFiscal>[],
  filtros: z.infer<typeof filtrosSchema>,
) {
  let formatadas = ordenarNotas(notas, filtros.sortBy, filtros.sortOrder);

  if (filtros.periodo === "7" || filtros.periodo === "30") {
    const hoje = normalizarData(new Date());
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + Number(filtros.periodo));
    formatadas = formatadas.filter((nota) => normalizarData(new Date(nota.dataLimite)) <= limite);
  }

  if (filtros.status && filtros.status !== "todos") {
    formatadas = formatadas.filter((nota) => nota.status === filtros.status);
  }

  return formatadas;
}

/**
 * Converte as notas para uma estrutura tabular reutilizável entre CSV, Excel e PDF.
 */
function montarLinhasExportacao(notas: ReturnType<typeof formatarNotaFiscal>[]) {
  return notas.map((nota) => ({
    Numero: nota.numero,
    Cidade: nota.cliente,
    CadastradaPor: nota.criadoPorNome,
    Destinatario: nota.destinatario,
    Observacoes: nota.observacoes ?? "",
    Emissao: nota.dataEmissao,
    Chegada: nota.dataChegada,
    Prazo: nota.dataLimite,
    Status: nota.status,
    DiasRestantes: nota.diasRestantes,
  }));
}

/**
 * Gera um CSV textual com escape de aspas para abrir corretamente em planilhas.
 */
function gerarCsv(linhas: Record<string, string | number>[]) {
  if (linhas.length === 0) {
    return "Numero,Cidade,CadastradaPor,Destinatario,Observacoes,Emissao,Chegada,Prazo,Status,DiasRestantes";
  }

  const cabecalho = Object.keys(linhas[0]).join(",");
  const conteudo = linhas.map((linha) =>
    Object.values(linha)
      .map((campo) => `"${String(campo).replace(/"/g, '""')}"`)
      .join(","),
  );

  return [cabecalho, ...conteudo].join("\n");
}

/**
 * Gera um arquivo Excel simples a partir das linhas filtradas.
 */
function gerarExcelBuffer(linhas: Record<string, string | number>[]) {
  const workbook = XLSX.utils.book_new();
  const cabecalho = [
    "Numero",
    "Cidade",
    "CadastradaPor",
    "Destinatario",
    "Observacoes",
    "Emissao",
    "Chegada",
    "Prazo",
    "Status",
    "DiasRestantes",
  ];
  const dados = linhas.map((linha) => [
    linha.Numero,
    linha.Cidade,
    linha.CadastradaPor,
    linha.Destinatario,
    linha.Observacoes,
    linha.Emissao,
    linha.Chegada,
    linha.Prazo,
    linha.Status,
    linha.DiasRestantes,
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([cabecalho, ...dados]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Notas");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

/**
 * Monta um PDF operacional com resumo e listagem principal das notas exportadas.
 */
function gerarPdfBuffer(
  linhas: Record<string, string | number>[],
  resumo: DashboardResumo,
  filtros: z.infer<typeof exportacaoSchema>,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({ margin: 40, size: "A4" });

    pdf.on("data", (chunk) => chunks.push(chunk as Buffer));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const larguraUtil = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;

    /**
     * Define a cor principal de acordo com o status operacional da nota.
     */
    function obterCorStatus(status: string) {
      if (status === "atrasada") return "#fee2e2";
      if (status === "venceHoje" || status === "venceAmanha") return "#ffedd5";
      if (status === "venceEm3Dias") return "#fef3c7";
      return "#dcfce7";
    }

    /**
     * Desenha um pequeno card de resumo colorido no topo do PDF.
     */
    function desenharCardResumo(x: number, y: number, titulo: string, valor: number, cor: string) {
      pdf.roundedRect(x, y, 120, 46, 10).fill(cor);
      pdf.fillColor("#0f172a").fontSize(9).text(titulo, x + 10, y + 9, { width: 100 });
      pdf.fontSize(16).text(String(valor), x + 10, y + 22, { width: 100 });
    }

    pdf.roundedRect(40, 36, larguraUtil, 74, 16).fill("#0f172a");
    pdf.fillColor("#ffffff").fontSize(18).text("Relatorio de Notas Fiscais", 56, 54);
    pdf
      .fontSize(10)
      .fillColor("#cbd5e1")
      .text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, 56, 78)
      .text(
        `Periodo: ${filtros.periodo ?? "todos"} | Status: ${filtros.status ?? "todos"} | Busca: ${filtros.busca ?? "-"}`,
        56,
        92,
        { width: larguraUtil - 32 },
      );

    desenharCardResumo(40, 128, "Total", resumo.total, "#e2e8f0");
    desenharCardResumo(172, 128, "Atrasadas", resumo.atrasadas, "#fecaca");
    desenharCardResumo(304, 128, "Vencendo", resumo.vencendo, "#fed7aa");
    desenharCardResumo(436, 128, "No prazo", resumo.noPrazo, "#bbf7d0");

    pdf.y = 196;

    if (linhas.length === 0) {
      pdf.fillColor("#334155").fontSize(11).text("Nenhuma nota encontrada para os filtros selecionados.");
      pdf.end();
      return;
    }

    linhas.forEach((linha, index) => {
      if (pdf.y > 730) {
        pdf.addPage();
        pdf.y = 40;
      }

      const topo = pdf.y;
      const altura = 108;
      pdf.roundedRect(40, topo, larguraUtil, altura, 12).fill("#ffffff");
      pdf.roundedRect(40, topo, 14, altura, 12).fill(obterCorStatus(String(linha.Status)));

      pdf.fillColor("#0f172a").fontSize(11).text(`${index + 1}. Nota ${linha.Numero}`, 66, topo + 10);
      pdf.fontSize(10).fillColor("#1e293b").text(String(linha.Cidade), 66, topo + 26, { width: 240 });
      pdf.fontSize(9).fillColor("#475569").text(`Cadastrada por: ${linha.CadastradaPor}`, 66, topo + 44, {
        width: 250,
      });
      pdf.text(`Destinatario: ${linha.Destinatario}`, 66, topo + 62, {
        width: 250,
      });
      pdf.text(`Prazo: ${linha.Prazo} | Status: ${linha.Status}`, 320, topo + 10, { width: 220 });
      pdf.text(`Dias restantes: ${linha.DiasRestantes}`, 320, topo + 34, { width: 220 });
      pdf.text(`Observacoes: ${linha.Observacoes || "-"}`, 320, topo + 58, { width: 220, ellipsis: true });

      pdf.y = topo + altura + 10;
    });

    pdf.end();
  });
}

/**
 * Busca e formata todas as notas necessárias para exportação com base nos filtros informados.
 */
async function carregarNotasParaExportacao(
  userId: string,
  filtros: z.infer<typeof filtrosSchema>,
  userRole?: string,
) {
  const notas = await prisma.notaFiscal.findMany({
    where: {
      ...obterEscopoNotas(userId, userRole),
      ...obterFiltroArquivamento(filtros.visao),
      OR: filtros.busca
        ? [
            { numero: { contains: filtros.busca, mode: "insensitive" } },
            { cliente: { contains: filtros.busca, mode: "insensitive" } },
            { destinatario: { contains: filtros.busca, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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

  return aplicarFiltrosNotas(notas.map(formatarNotaFiscal), filtros);
}

/**
 * Busca as sugestões mais usadas para acelerar o preenchimento do formulário.
 */
export async function obterSugestoes(request: Request, response: Response): Promise<void> {
  const userId = request.userId;
  const userRole = request.userRole;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const [clientes, destinatarios] = await Promise.all([
    prisma.notaFiscal.groupBy({
      by: ["cliente"],
      where: obterEscopoNotas(userId, userRole),
      _count: { cliente: true },
      orderBy: { _count: { cliente: "desc" } },
      take: 8,
    }),
    prisma.notaFiscal.groupBy({
      by: ["destinatario"],
      where: obterEscopoNotas(userId, userRole),
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
  const userRole = request.userRole;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const notas = await prisma.notaFiscal.findMany({
    where: obterEscopoNotas(userId, userRole),
    include: {
      user: {
        select: { id: true, nome: true },
      },
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
 * Exporta as notas filtradas em PDF, CSV ou Excel.
 */
export async function exportarNotas(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const filtros = exportacaoSchema.parse(request.query);
  const formatadas = await carregarNotasParaExportacao(userId, filtros, request.userRole);
  const linhas = montarLinhasExportacao(formatadas);
  const resumo = montarResumo(formatadas);

  if (filtros.formato === "excel") {
    const excel = gerarExcelBuffer(linhas);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader("Content-Disposition", "attachment; filename=notas-fiscais.xlsx");
    response.send(excel);
    return;
  }

  if (filtros.formato === "csv") {
    const csv = gerarCsv(linhas);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", "attachment; filename=notas-fiscais.csv");
    response.send(csv);
    return;
  }

  const pdf = await gerarPdfBuffer(linhas, resumo, filtros);
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=notas-fiscais.pdf");
  response.send(pdf);
}

/**
 * Lista as notas fiscais do usuário autenticado com filtros, busca, paginação e ordenação.
 */
export async function listarNotas(request: Request, response: Response): Promise<void> {
  const userId = request.userId;
  const userRole = request.userRole;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const filtros = filtrosSchema.parse(request.query);
  const hoje = normalizarData(new Date());

  const notas = await prisma.notaFiscal.findMany({
    where: {
      ...obterEscopoNotas(userId, userRole),
      ...obterFiltroArquivamento(filtros.visao),
      OR: filtros.busca
        ? [
            { numero: { contains: filtros.busca, mode: "insensitive" } },
            { cliente: { contains: filtros.busca, mode: "insensitive" } },
            { destinatario: { contains: filtros.busca, mode: "insensitive" } },
          ]
        : undefined,
    },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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

  let notasFormatadas = aplicarFiltrosNotas(notas.map(formatarNotaFiscal), filtros);

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
      visao: filtros.visao,
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
  const userRole = request.userRole;
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;

  if (!id) {
    response.status(400).json({ message: "Identificador da nota fiscal não informado." });
    return;
  }

  const nota = await prisma.notaFiscal.findFirst({
    where: { id, ...obterEscopoNotas(userId ?? "", userRole) },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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
      observacoes: dados.observacoes?.trim() ? dados.observacoes.trim() : null,
      dataEmissao: new Date(dados.dataEmissao),
      dataChegada: new Date(dados.dataChegada),
      dataLimite: new Date(dados.dataLimite),
      userId,
    },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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
      observacoes: nota.observacoes,
      dataLimite: nota.dataLimite.toISOString(),
    },
  });

  logger.info("Nota criada", { notaId: nota.id, userId, numero: nota.numero });
  const notaAtualizada = await prisma.notaFiscal.findUniqueOrThrow({
    where: { id: nota.id },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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
  const userRole = request.userRole;
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
    where: { id, ...obterEscopoNotas(userId, userRole) },
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

  if ((notaExistente.observacoes ?? "") !== (dados.observacoes?.trim() ?? "")) {
    alteracoes.observacoes = {
      de: notaExistente.observacoes,
      para: dados.observacoes?.trim() ?? null,
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
      observacoes: dados.observacoes?.trim() ? dados.observacoes.trim() : null,
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
      user: {
        select: { id: true, nome: true },
      },
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
  const userRole = request.userRole;
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
    where: { id, ...obterEscopoNotas(userId, userRole) },
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
      observacoes: notaExistente.observacoes,
      dataLimite: notaExistente.dataLimite.toISOString(),
    },
  });

  await prisma.notaFiscal.delete({
    where: { id },
  });

  response.status(204).send();
}

/**
 * Marca uma nota fiscal como entregue e a move para a lista de arquivadas.
 */
export async function marcarNotaComoEntregue(request: Request, response: Response): Promise<void> {
  const userId = request.userId;
  const userRole = request.userRole;
  const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;

  if (!userId) {
    response.status(401).json({ message: "UsuÃ¡rio nÃ£o autenticado." });
    return;
  }

  if (!id) {
    response.status(400).json({ message: "Identificador da nota fiscal nÃ£o informado." });
    return;
  }

  const notaExistente = await prisma.notaFiscal.findFirst({
    where: { id, ...obterEscopoNotas(userId, userRole) },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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

  if (!notaExistente) {
    response.status(404).json({ message: "Nota fiscal nÃ£o encontrada." });
    return;
  }

  if (notaExistente.entregueEm) {
    response.status(400).json({ message: "Essa nota jÃ¡ foi marcada como entregue." });
    return;
  }

  const notaAtualizada = await prisma.notaFiscal.update({
    where: { id },
    data: {
      entregueEm: new Date(),
    },
    include: {
      user: {
        select: { id: true, nome: true },
      },
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
    notaId: notaAtualizada.id,
    numeroNota: notaAtualizada.numero,
    userId,
    acao: "ENTREGUE",
    descricao: "Nota fiscal marcada como entregue e arquivada.",
    alteracoes: {
      entregueEm: notaAtualizada.entregueEm?.toISOString() ?? null,
    },
  });

  response.json(formatarNotaFiscal(notaAtualizada));
}
