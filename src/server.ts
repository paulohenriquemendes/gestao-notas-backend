import "dotenv/config";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth";
import { notasRouter } from "./routes/notas";
import { errorHandler } from "./middlewares/errorHandler";
import { logger } from "./utils/logger";

const app = express();

/**
 * Configura os middlewares globais necessários para a API.
 */
function configurarMiddlewares(): void {
  app.use(
    cors({
      origin: "*",
    }),
  );
  app.use(express.json());
}

/**
 * Configura as rotas principais da aplicação.
 */
function configurarRotas(): void {
  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/notas", notasRouter);
  app.use(errorHandler);
}

configurarMiddlewares();
configurarRotas();

const port = Number(process.env.PORT ?? 3333);

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    logger.info("Servidor backend rodando", { port });
  });
}

export default app;
