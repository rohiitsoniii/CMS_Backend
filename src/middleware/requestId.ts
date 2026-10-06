import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const reqId = uuidv4();
  req.requestId = reqId; // Attach to the request object
  res.setHeader('X-Request-Id', reqId); // Include in the response
  next();
};
