import { Router } from "express";
import {
  atualizarNota,
  criarNota,
  excluirNota,
  listarNotas,
  obterNota,
} from "../controllers/notaController";
import { authMiddleware } from "../middlewares/auth";

const notasRouter = Router();

notasRouter.use(authMiddleware);
notasRouter.get("/", listarNotas);
notasRouter.get("/:id", obterNota);
notasRouter.post("/", criarNota);
notasRouter.put("/:id", atualizarNota);
notasRouter.delete("/:id", excluirNota);

export { notasRouter };
