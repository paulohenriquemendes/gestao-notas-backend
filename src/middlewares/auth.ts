import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../types";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Valida o token JWT enviado pelo cliente e injeta o usuário autenticado na requisição.
 */
export function authMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    response.status(401).json({ message: "Token não informado." });
    return;
  }

  const [, token] = authHeader.split(" ");

  try {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      response.status(500).json({ message: "JWT_SECRET não configurado." });
      return;
    }

    const payload = jwt.verify(token, secret) as JwtPayload;
    request.userId = payload.sub;
    next();
  } catch {
    response.status(401).json({ message: "Token inválido ou expirado." });
  }
}
