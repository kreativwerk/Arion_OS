// Minimaler Resolver für die Tests: "@/…" → Projektwurzel, endungslose
// relative Imports → ".ts". Damit lassen sich lib/*.ts direkt mit Node testen.
import { register } from "node:module";

const hooks = `
const root = ${JSON.stringify(new URL("../", import.meta.url).href)};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) specifier = root + specifier.slice(2);
  try {
    return await next(specifier, context);
  } catch (e) {
    if ((specifier.startsWith(".") || specifier.startsWith("file:")) && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + ".ts", context);
    }
    throw e;
  }
}`;
register("data:text/javascript," + encodeURIComponent(hooks), import.meta.url);
