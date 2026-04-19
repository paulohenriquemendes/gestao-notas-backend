import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../prisma/client";
import { JwtPayload, UserRole } from "../types";
import { logger } from "../utils/logger";

const registerSchema = z.object({
  nome: z.string().min(2, "Informe o nome."),
  email: z.string().email("Informe um e-mail válido."),
  senha: z
    .string()
    .min(8, "A senha precisa ter pelo menos 8 caracteres.")
    .regex(/[A-Z]/, "A senha precisa ter pelo menos uma letra maiúscula.")
    .regex(/[a-z]/, "A senha precisa ter pelo menos uma letra minúscula.")
    .regex(/[0-9]/, "A senha precisa ter pelo menos um número."),
});

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  senha: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres."),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
});

const resetPasswordSchema = z.object({
  token: z.string().min(10, "Token inválido."),
  novaSenha: z
    .string()
    .min(8, "A nova senha precisa ter pelo menos 8 caracteres.")
    .regex(/[A-Z]/, "A nova senha precisa ter pelo menos uma letra maiúscula.")
    .regex(/[a-z]/, "A nova senha precisa ter pelo menos uma letra minúscula.")
    .regex(/[0-9]/, "A nova senha precisa ter pelo menos um número."),
});

/**
 * Gera um token JWT com os dados mínimos do usuário autenticado.
 */
function gerarToken(userId: string, email: string, role: UserRole): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET não configurado.");
  }

  return jwt.sign({ email, role }, secret, {
    subject: userId,
    expiresIn: "365d",
  });
}

/**
 * Define o papel do usuário na criação de conta.
 */
async function definirRoleInicial(): Promise<UserRole> {
  const totalUsuarios = await prisma.user.count();
  return totalUsuarios === 0 ? "ADMIN" : "OPERADOR";
}

/**
 * Cadastra um novo usuário com senha criptografada.
 */
export async function register(request: Request, response: Response): Promise<void> {
  const { nome, email, senha } = registerSchema.parse(request.body);

  const usuarioExistente = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (usuarioExistente) {
    response.status(409).json({ message: "Já existe um usuário com este e-mail." });
    return;
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const role = await definirRoleInicial();

  const user = await prisma.user.create({
    data: {
      nome,
      email: email.toLowerCase(),
      senhaHash,
      role,
    },
  });

  logger.info("Usuário cadastrado", {
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const token = gerarToken(user.id, user.email, user.role);

  response.status(201).json({
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
    },
    token,
  });
}

/**
 * Autentica um usuário existente e devolve um token JWT válido.
 */
export async function login(request: Request, response: Response): Promise<void> {
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

  const token = gerarToken(user.id, user.email, user.role);

  response.json({
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
    },
    token,
  });
}

/**
 * Retorna os dados do usuário autenticado.
 */
export async function profile(request: Request, response: Response): Promise<void> {
  const userId = request.userId;

  if (!userId) {
    response.status(401).json({ message: "Usuário não autenticado." });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    response.status(404).json({ message: "Usuário não encontrado." });
    return;
  }

  response.json(user);
}

/**
 * Gera um token temporário para redefinição de senha.
 */
export async function forgotPassword(request: Request, response: Response): Promise<void> {
  const { email } = forgotPasswordSchema.parse(request.body);

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    response.json({
      message: "Se existir uma conta com este e-mail, a instrução de redefinição foi gerada.",
    });
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  logger.warn("Token de recuperação gerado", {
    userId: user.id,
    email: user.email,
    token,
  });

  response.json({
    message: "Token de redefinição gerado para uso interno.",
    resetToken: token,
    expiresAt: expiresAt.toISOString(),
  });
}

/**
 * Redefine a senha a partir de um token temporário.
 */
export async function resetPassword(request: Request, response: Response): Promise<void> {
  const { token, novaSenha } = resetPasswordSchema.parse(request.body);

  const registro = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!registro || registro.usedAt || registro.expiresAt < new Date()) {
    response.status(400).json({ message: "Token inválido ou expirado." });
    return;
  }

  const senhaHash = await bcrypt.hash(novaSenha, 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: registro.userId },
      data: { senhaHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: registro.id },
      data: { usedAt: new Date() },
    }),
  ]);

  response.json({ message: "Senha redefinida com sucesso." });
}
