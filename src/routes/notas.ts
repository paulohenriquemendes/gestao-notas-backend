import { Router } from "express";
import {
  atualizarNota,
  criarNota,
  excluirNota,
  exportarNotas,
  listarAlertas,
  listarNotas,
  listarNotasTvPublicas,
  marcarNotaComoEntregue,
  obterNota,
  obterSugestoes,
} from "../controllers/notaController";
import { authMiddleware } from "../middlewares/auth";
import { asyncHandler } from "../utils/asyncHandler";

const notasRouter = Router();

notasRouter.get("/tv-publica", asyncHandler(listarNotasTvPublicas));
notasRouter.use(authMiddleware);
notasRouter.get("/", asyncHandler(listarNotas));
notasRouter.get("/alertas", asyncHandler(listarAlertas));
notasRouter.get("/sugestoes", asyncHandler(obterSugestoes));
notasRouter.get("/exportar", asyncHandler(exportarNotas));
notasRouter.post("/:id/entregar", asyncHandler(marcarNotaComoEntregue));
notasRouter.get("/:id", asyncHandler(obterNota));
notasRouter.post("/", asyncHandler(criarNota));
notasRouter.put("/:id", asyncHandler(atualizarNota));
notasRouter.delete("/:id", asyncHandler(excluirNota));

export { notasRouter };
