import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

/**
 * Centraliza o tratamento de erros inesperados da aplicação.
 */
export function errorHandler(
  error: Error,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    response.status(400).json({ message: error.issues[0]?.message ?? "Dados inválidos." });
    return;
  }

  logger.error("Erro não tratado na API", {
    nome: error.name,
    mensagem: error.message,
    stack: error.stack,
  });

  response.status(500).json({ message: "Ocorreu um erro interno no servidor." });
}
