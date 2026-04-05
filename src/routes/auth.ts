import { Router } from "express";
import {
  forgotPassword,
  login,
  profile,
  register,
  resetPassword,
} from "../controllers/authController";
import { authMiddleware } from "../middlewares/auth";
import { asyncHandler } from "../utils/asyncHandler";

const authRouter = Router();

authRouter.post("/register", asyncHandler(register));
authRouter.post("/login", asyncHandler(login));
authRouter.post("/forgot-password", asyncHandler(forgotPassword));
authRouter.post("/reset-password", asyncHandler(resetPassword));
authRouter.get("/profile", authMiddleware, asyncHandler(profile));

export { authRouter };
