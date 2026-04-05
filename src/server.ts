import "dotenv/config";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth";
import { notasRouter } from "./routes/notas";

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
    response.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/notas", notasRouter);
}

configurarMiddlewares();
configurarRotas();

const port = Number(process.env.PORT ?? 3333);

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Servidor backend rodando na porta ${port}`);
  });
}

export default app;
