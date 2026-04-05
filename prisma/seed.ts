import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma/client";

/**
 * Cria um usuário padrão para facilitar testes locais.
 */
async function criarUsuarioPadrao() {
  const email = "admin@gestaonotas.com";
  const senhaHash = await bcrypt.hash("123456", 10);

  return prisma.user.upsert({
    where: { email },
    update: {
      nome: "Administrador",
      senhaHash,
    },
    create: {
      nome: "Administrador",
      email,
      senhaHash,
    },
  });
}

/**
 * Gera um conjunto inicial de notas fiscais demonstrando todos os estados do dashboard.
 */
async function criarNotasExemplo(userId: string) {
  await prisma.notaFiscal.deleteMany({
    where: { userId },
  });

  const hoje = new Date();

  const criarData = (deslocamento: number) => {
    const data = new Date(hoje);
    data.setDate(data.getDate() + deslocamento);
    return data;
  };

  await prisma.notaFiscal.createMany({
    data: [
      {
        numero: "NF-1001",
        cliente: "Química Alfa",
        destinatario: "Tanque A - Produção",
        dataEmissao: criarData(-8),
        dataChegada: criarData(-6),
        dataLimite: criarData(-1),
        userId,
      },
      {
        numero: "NF-1002",
        cliente: "Indústria Beta",
        destinatario: "Armazém 02",
        dataEmissao: criarData(-5),
        dataChegada: criarData(-3),
        dataLimite: criarData(0),
        userId,
      },
      {
        numero: "NF-1003",
        cliente: "Laboratório Gama",
        destinatario: "Planta Sul",
        dataEmissao: criarData(-4),
        dataChegada: criarData(-2),
        dataLimite: criarData(1),
        userId,
      },
      {
        numero: "NF-1004",
        cliente: "Compostos Delta",
        destinatario: "Expedição Norte",
        dataEmissao: criarData(-3),
        dataChegada: criarData(-1),
        dataLimite: criarData(3),
        userId,
      },
      {
        numero: "NF-1005",
        cliente: "Misturas Épsilon",
        destinatario: "Depósito Central",
        dataEmissao: criarData(-1),
        dataChegada: criarData(0),
        dataLimite: criarData(7),
        userId,
      },
    ],
  });
}

/**
 * Executa o seed principal do banco de dados.
 */
async function main() {
  const usuario = await criarUsuarioPadrao();
  await criarNotasExemplo(usuario.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed executado com sucesso.");
  })
  .catch(async (error) => {
    console.error("Erro ao executar seed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
