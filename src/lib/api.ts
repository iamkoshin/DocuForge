import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** Wrap a route handler so thrown errors become clear JSON errors instead of opaque 500s. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ZodError) return json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api]", msg);
      return json({ error: msg }, 500);
    }
  };
}

export type Params<T> = { params: Promise<T> };
