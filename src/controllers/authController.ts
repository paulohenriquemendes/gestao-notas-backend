import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma/client";

const registerSchema = z.object({
  nome: z.string().min(2, "Informe o nome."),
  email: z.string().email("Informe um e-mail válido."),
  senha: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres."),
});

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  senha: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres."),
});

/**
 * Gera um token JWT com os dados mínimos do usuário autenticado.
 */
function gerarToken(userId: string, email: string): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET não configurado.");
  }

  return jwt.sign({ email }, secret, {
    subject: userId,
    expiresIn: "7d",
  });
}

/**
 * Cadastra um novo usuário com senha criptografada.
 */
export async function register(request: Request, response: Response): Promise<void> {
  try {
    const { nome, email, senha } = registerSchema.parse(request.body);

    const usuarioExistente = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (usuarioExistente) {
      response.status(409).json({ message: "Já existe um usuário com este e-mail." });
      return;
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const user = await prisma.user.create({
      data: {
        nome,
        email: email.toLowerCase(),
        senhaHash,
      },
    });

    const token = gerarToken(user.id, user.email);

    response.status(201).json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({ message: error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }

    response.status(500).json({ message: "Não foi possível cadastrar o usuário." });
  }
}

/**
 * Autentica um usuário existente e devolve um token JWT válido.
 */
export async function login(request: Request, response: Response): Promise<void> {
  try {
    const { email, senha } = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      response.status(401).json({ message: "Credenciais inválidas." });
      return;
    }

    const senhaCorreta = await bcrypt.compare(senha, user.senhaHash);

    if (!senhaCorreta) {
      response.status(401).json({ message: "Credenciais inválidas." });
      return;
    }

    const token = gerarToken(user.id, user.email);

    response.json({
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
      },
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({ message: error.issues[0]?.message ?? "Dados inválidos." });
      return;
    }

    response.status(500).json({ message: "Não foi possível realizar o login." });
  }
}
