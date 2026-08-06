import type { Plugin, ResolvedConfig } from "vite";
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { finished } from "node:stream/promises";
import { ZipArchive } from "archiver";

const errorHandler = "handleScriptError(this)";

function shouldAddHandler(tag: string, excludedAsset: string) {
  return (
    !tag.includes(" onerror=") &&
    !tag.includes(`/${excludedAsset}`) &&
    !tag.includes(`\"${excludedAsset}`)
  );
}

export function addResourceErrorHandlers(html: string): string {
  const addScriptHandler = (tag: string) =>
    shouldAddHandler(tag, "scriptError.js")
      ? tag.replace(/>$/, ` onerror="${errorHandler}">`)
      : tag;
  const addStyleHandler = (tag: string) =>
    shouldAddHandler(tag, "scriptStyle.css")
      ? tag.replace(/>$/, ` onerror="${errorHandler}">`)
      : tag;

  return html
    .replace(/<script\b[^>]*\ssrc=[^>]*>/gi, addScriptHandler)
    .replace(
      /<link\b(?=[^>]*\srel=["']stylesheet["'])[^>]*\shref=[^>]*>/gi,
      addStyleHandler,
    );
}

async function createZip(outDir: string): Promise<string> {
  const zipName = path.basename(outDir);
  const zipPath = path.join(path.dirname(outDir), `${zipName}.zip`);
  await fs.rm(zipPath, { force: true });

  const output = createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("warning", (error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });

  archive.pipe(output);
  archive.directory(outDir, path.basename(outDir));
  await archive.finalize();
  await finished(output);

  return zipPath;
}

interface H5PostBuildOptions {
  outDirName?: string;
}

export function h5PostBuild(options: H5PostBuildOptions = {}): Plugin {
  let config: ResolvedConfig;
  let buildFailed = false;
  const outDirName = options.outDirName?.trim() || "h5";

  if (outDirName !== path.basename(outDirName)) {
    throw new Error("VITE_H5_OUT_DIR 只能包含目录名称，不能包含路径。");
  }

  return {
    name: "h5-post-build",
    apply: "build",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      if (process.env.UNI_PLATFORM === "h5") {
        const distDir = path.resolve(config.root, "dist");
        await fs.mkdir(distDir, { recursive: true });
        await Promise.all(
          (await fs.readdir(distDir)).map(entry =>
            fs.rm(path.join(distDir, entry), { recursive: true, force: true }),
          ),
        );
      }
    },
    buildEnd(error) {
      buildFailed = Boolean(error);
    },
    async closeBundle() {
      if (process.env.UNI_PLATFORM !== "h5" || buildFailed) {
        return;
      }

      const sourceOutDir = path.resolve(config.root, config.build.outDir);
      const outDir = path.resolve(config.root, "dist", outDirName);
      const sourceHtmlPath = path.join(sourceOutDir, "index.html");
      if (!existsSync(sourceHtmlPath)) {
        throw new Error(`H5 构建产物不存在: ${sourceHtmlPath}`);
      }

      await Promise.all([
        fs.copyFile(
          path.join(config.root, "public/scriptError.js"),
          path.join(sourceOutDir, "scriptError.js"),
        ),
        fs.copyFile(
          path.join(config.root, "public/scriptStyle.css"),
          path.join(sourceOutDir, "scriptStyle.css"),
        ),
      ]);

      const html = await fs.readFile(sourceHtmlPath, "utf8");
      await fs.writeFile(sourceHtmlPath, addResourceErrorHandlers(html), "utf8");
      if (sourceOutDir !== outDir) {
        await fs.rm(outDir, { recursive: true, force: true });
        await fs.rename(sourceOutDir, outDir);
        await fs.rm(path.dirname(sourceOutDir), { recursive: true, force: true });
      }

      const zipPath = await createZip(outDir);
      console.log(`已生成 ${zipPath}`);
    },
  };
}
