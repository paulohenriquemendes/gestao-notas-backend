import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Encapsula handlers assíncronos para encaminhar erros ao middleware global.
 */
export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };
}
