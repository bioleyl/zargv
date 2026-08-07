import { defineConfig } from "rollup";
import { swc } from "@rollup/plugin-swc";
import fs from "node:fs";
import path from "node:path";

function resolveRelativeJsToTs() {
    return {
        name: "resolve-relative-js-to-ts",
        resolveId(source, importer) {
            if (!importer || !source.startsWith(".") || !source.endsWith(".js")) {
                return null;
            }

            const tsPath = path.resolve(path.dirname(importer), source.replace(/\.js$/, ".ts"));
            if (fs.existsSync(tsPath)) {
                return tsPath;
            }

            return null;
        },
    };
}

export default defineConfig([
    {
        input: "src/index.ts",
        output: {
            dir: "dist/esm",
            format: "esm",
            entryFileNames: "[name].js",
            chunkFileNames: "[name]-[hash].js",
            sourcemap: true,
        },
        plugins: [
            resolveRelativeJsToTs(),
            swc({
                jsc: {
                    parser: {
                        syntax: "typescript",
                    },
                    target: "es2022",
                },
            }),
        ],
        external: ["zod", "node:path", "node:util"],
    },

    {
        input: "src/index.ts",
        output: {
            dir: "dist/cjs",
            format: "cjs",
            entryFileNames: "[name].cjs",
            chunkFileNames: "[name]-[hash].cjs",
            sourcemap: true,
            exports: "named",
        },
        plugins: [
            resolveRelativeJsToTs(),
            swc({
                jsc: {
                    parser: {
                        syntax: "typescript",
                    },
                    target: "es2022",
                },
            }),
        ],
        external: ["zod", "node:path", "node:util"],
    },
]);