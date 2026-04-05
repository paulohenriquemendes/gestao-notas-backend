import { Router } from "express";
import {
  forgotPassword,
  login,
  profile,
  register,
  resetPassword,
} from "../controllers/authController";
import { authMiddleware } from "../middlewares/auth";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.get("/profile", authMiddleware, profile);

export { authRouter };
