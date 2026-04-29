import { jwtVerify } from "jose";
import type { Socket } from "socket.io";
import { createLogger } from "./logger.js";

const log = createLogger("auth");

const isProduction = process.env.NODE_ENV === "production";

/** Builds Socket.IO middleware that validates Supabase JWTs and stores userId on socket data. */
export function createAuthMiddleware() {
  const secret = process.env.SUPABASE_JWT_SECRET;

  if (!secret && isProduction) {
    log.fatal({}, "SUPABASE_JWT_SECRET is required in production");
    process.exit(1);
  }

  if (!secret) {
    log.warn({}, "SUPABASE_JWT_SECRET not set — Socket.IO auth disabled");
    return (_socket: Socket, next: (err?: Error) => void) => {
      next();
    };
  }

  const encodedSecret = new TextEncoder().encode(secret);

  return async (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const { payload } = await jwtVerify(token, encodedSecret, {
        algorithms: ["HS256"],
      });

      if (!payload.sub) {
        return next(new Error("Invalid token: missing sub claim"));
      }

      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  };
}
