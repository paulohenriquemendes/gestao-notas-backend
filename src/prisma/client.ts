import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * Reaproveita a instância do Prisma em desenvolvimento para evitar múltiplas conexões.
 */
export const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}
