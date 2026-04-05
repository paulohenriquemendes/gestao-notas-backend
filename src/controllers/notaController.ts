import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma/client";
import { calcularStatus, formatarNotaFiscal, normalizarData } from "../utils/dateHelpers";

const notaSchema = z.object({
  numero: z.string().min(1, "Informe o número da nota fiscal."),
  cliente: z.string().min(2, "Informe o cliente."),
  destinatario: z.string().min(2, "Informe o destinatário final."),
  dataEmissao: z.string().min(1, "Informe a data de emissão."),
  dataChegada: z.string().min(1, "Informe a data de chegada."),
  dataLimite: z.string().min(1, "Informe a data limite."),
});

/**
 * Lista as notas fiscais do usuário autenticado com filtros opcionais por período e status.
 */
export async function listarNotas(request: Request, response: Response): Promise<void> {
  try {
    const userId = request.userId;

    if (!userId) {
      response.status(401).json({ message: "Usuário não autenticado." });
      return;
    }

    const statusFiltro = typeof request.query.status === "string" ? request.query.status : "todos";
    const periodoFiltro = typeof request.query.periodo === "string" ? request.query.periodo : "todos";
    const hoje = normalizarData(new Date());

    const notas = await prisma.notaFiscal.findMany({
      where: { userId },
      orderBy: { dataLimite: "asc" },
    });

    let notasFormatadas = notas.map(formatarNotaFiscal);

    if (periodoFiltro === "7" || periodoFiltro === "30") {
      const limite = new Date(hoje);
      limite.setDate(limite.getDate() + Number(periodoFiltro));

      notasFormatadas = notasFormatadas.filter((nota) => {
        const dataLimite = normalizarData(new Date(nota.dataLimite));
        return dataLimite <= limite;
      });
    }

    if (statusFiltro !== "todos") {
      notasFormatadas = notasFormatadas.filter((nota) => nota.status === statusFiltro);
    }

    const resumo = notasFormatadas.reduce(
      (acc, nota) => {
        const status = calcularStatus(new Date(nota.dataLimite), hoje);

        if (status === "atrasada") {
          acc.atrasadas += 1;
        } else if (status === "dentroPrazo") {
          acc.noPrazo += 1;
        } else {
          acc.vencendo += 1;
        }

        acc.total += 1;
        return acc;
      },
      { atrasadas: 0, vencendo: 0, noPrazo: 0, total: 0 },
    );

    response.json({
      resumo,
      notas: notasFormatadas,
    });
  } catch {
    response.status(500).json({ message: "Não foi possível listar as notas fiscais." });
  }
}

/**
 * Busca uma nota fiscal específica pertencente ao usuário autenticado.
 */
export async function obterNota(request: Request, response: Response): Promise<void> {
  try {
    const userId = request.userId;
    const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;

    if (!id) {
      response.status(400).json({ message: "Identificador da nota fiscal não informado." });
      return;
    }

    const nota = await prisma.notaFiscal.findFirst({
      where: { id, userId },
    });

    if (!nota) {
      response.status(404).json({ message: "Nota fiscal não encontrada." });
      return;
    }

    response.json(formatarNotaFiscal(nota));
  } catch {
    response.status(500).json({ message: "Não foi possível buscar a nota fiscal." });
  }
}

/**
 * Cria uma nova nota fiscal para o usuário autenticado.
 */
export async function criarNota(request: Request, response: Response): Promise<void> {
  try {
    const userId = request.userId;

    if (!userId) {
      response.status(401).json({ message: "Usuário não autenticado." });
      return;
    }

    const dados = notaSchema.parse(request.body);

    const nota = await prisma.notaFiscal.create({
      data: {
        ...dados,
        dataEmissao: new Date(dados.dataEmissao),
        dataChegada: new Date(dados.dataChegada),
        dataLimite: new Date(dados.dataLimite),
        userId,
      },
    });

    response.status(201).json(formatarNotaFiscal(nota));
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({ message: error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }

    response.status(500).json({ message: "Não foi possível criar a nota fiscal." });
  }
}

/**
 * Atualiza uma nota fiscal do usuário autenticado.
 */
export async function atualizarNota(request: Request, response: Response): Promise<void> {
  try {
    const userId = request.userId;
    const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const dados = notaSchema.parse(request.body);

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

    const nota = await prisma.notaFiscal.update({
      where: { id },
      data: {
        ...dados,
        dataEmissao: new Date(dados.dataEmissao),
        dataChegada: new Date(dados.dataChegada),
        dataLimite: new Date(dados.dataLimite),
      },
    });

    response.json(formatarNotaFiscal(nota));
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({ message: error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }

    response.status(500).json({ message: "Não foi possível atualizar a nota fiscal." });
  }
}

/**
 * Exclui uma nota fiscal pertencente ao usuário autenticado.
 */
export async function excluirNota(request: Request, response: Response): Promise<void> {
  try {
    const userId = request.userId;
    const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;

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

    await prisma.notaFiscal.delete({
      where: { id },
    });

    response.status(204).send();
  } catch {
    response.status(500).json({ message: "Não foi possível excluir a nota fiscal." });
  }
}
