import { Router } from "express";
import {
  atualizarNota,
  criarNota,
  excluirNota,
  exportarNotas,
  listarAlertas,
  listarNotas,
  obterNota,
  obterSugestoes,
} from "../controllers/notaController";
import { authMiddleware } from "../middlewares/auth";

const notasRouter = Router();

notasRouter.use(authMiddleware);
notasRouter.get("/", listarNotas);
notasRouter.get("/alertas", listarAlertas);
notasRouter.get("/sugestoes", obterSugestoes);
notasRouter.get("/exportar", exportarNotas);
notasRouter.get("/:id", obterNota);
notasRouter.post("/", criarNota);
notasRouter.put("/:id", atualizarNota);
notasRouter.delete("/:id", excluirNota);

export { notasRouter };
