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

/**
 * `public/` 下的运行时资源（scriptError.js / scriptStyle.css）不参与打包，
 * Vite 会把 html 里 `/xxx` 的写法**原样保留**，不跟着 `base` 一起改写。
 *
 * 项目已经用 `base: "./"`，整包允许部署在任意子目录；
 * 这两个绝对路径留在产物里，一放到子目录就会 404 —— 错误兜底脚本丢了，
 * 控制台还会多两条红字。这里统一改成相对当前 html 的写法。
 */
export function toRelativePublicAssets(html: string): string {
  return html.replace(/(\s(?:src|href)=")\/(?:\.\/)?(scriptError\.js|scriptStyle\.css)"/g, "$1./$2\"");
}

/**
 * 打一次 zip：先写 `<名字>.zip.tmp`，成功后再改名 —— 中途失败不会在目标文件名上留下半个包。
 *
 * 之前只 `pipe` 了输出流、没挂 `error` 监听：Windows 上磁盘写入被中断
 * （文件被解压软件 / 网盘 / 杀毒软件占用，或写入被拒绝）时底层会报 `UNKNOWN`，
 * 未处理的 `'error'` 事件直接把构建进程打断，现场只留一个坏 zip。
 * 这里统一收集 output / archive 的错误，失败时清掉临时文件再抛出。
 */
async function createZipOnce(outDir: string, zipPath: string): Promise<void> {
  const tempPath = `${zipPath}.tmp`;
  await fs.rm(tempPath, { force: true });

  const output = createWriteStream(tempPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const errors: Error[] = [];
  output.on("error", error => errors.push(error));
  archive.on("error", error => errors.push(error));
  archive.on("warning", (error) => {
    if (error.code !== "ENOENT") {
      console.warn(`[h5-post-build] 压缩警告：${error.message}`);
    }
  });

  archive.pipe(output);
  archive.directory(outDir, path.basename(outDir));
  await archive.finalize().catch(error => errors.push(error));
  // output 出错时 finished 会 reject，这里统一看上面的 errors，避免再抛一次
  await finished(output).catch(() => {});
  if (errors.length) {
    output.destroy();
    await fs.rm(tempPath, { force: true });
    throw errors[0];
  }

  await fs.rm(zipPath, { force: true });
  await fs.rename(tempPath, zipPath);
}

async function createZip(outDir: string): Promise<string> {
  const zipName = path.basename(outDir);
  const zipPath = path.join(path.dirname(outDir), `${zipName}.zip`);

  let lastError: unknown;
  // 写盘失败多半是瞬时占用（预览 / 同步 / 扫描），重试一次基本都能过
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await createZipOnce(outDir, zipPath);
      return zipPath;
    }
    catch (error) {
      lastError = error;
      console.warn(`[h5-post-build] 第 ${attempt} 次打包 ${zipName}.zip 失败：${String((error as Error)?.message || error)}`);
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 800));
    }
  }

  const code = (lastError as NodeJS.ErrnoException)?.code || "写入失败";
  throw new Error(
    `打包 ${zipName}.zip 失败（${code}）。请按顺序排查：`
    + `1) 关闭解压软件 / 压缩包预览 / 网盘同步 / 杀毒软件对该文件的占用；`
    + `2) 手动删除 dist/${zipName}.zip 与 dist/${zipName}.zip.tmp 后重试；`
    + `3) 仍报 EPERM / UNKNOWN 时重启电脑，或对该磁盘执行 chkdsk /f，再重试`,
  );
}

interface H5PostBuildOptions {
  outDirName?: string;
}

/** 防止把尚未下载的 Git LFS 指针当成图片打进离线包。 */
async function assertMaterializedAssets(directory: string): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertMaterializedAssets(filePath);
    } else if (entry.isFile()) {
      const file = await fs.open(filePath, "r");
      try {
        const prefix = Buffer.alloc(64);
        await file.read(prefix, 0, prefix.length, 0);
        if (prefix.toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
          throw new Error(`资源尚未从 Git LFS 下载：${filePath}。请先执行 git lfs pull，再重新构建。`);
        }
      } finally {
        await file.close();
      }
    }
  }
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
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    configureServer(server) {
      const staticFiles = {
        "/scriptError.js": {
          filePath: path.resolve(config.root, "public/scriptError.js"),
          contentType: "application/javascript; charset=utf-8",
        },
        "/scriptStyle.css": {
          filePath: path.resolve(config.root, "public/scriptStyle.css"),
          contentType: "text/css; charset=utf-8",
        },
      };

      for (const [url, file] of Object.entries(staticFiles)) {
        server.middlewares.use(url, async (_request, response, next) => {
          try {
            response.setHeader("Content-Type", file.contentType);
            response.end(await fs.readFile(file.filePath));
          } catch {
            next();
          }
        });
      }
    },
    async buildStart() {
      if (process.env.UNI_PLATFORM === "h5") {
        await assertMaterializedAssets(path.resolve(config.root, "src/assets"));
        await assertMaterializedAssets(path.resolve(config.root, "public"));
        const distDir = path.resolve(config.root, "dist");
        await fs.mkdir(distDir, { recursive: true });
        // 清空 dist：保证每次构建只留下本次产物，避免旧版本混进包里。
        // 个别文件可能被解压软件 / 网盘 / 杀毒软件占着（Windows 上直接 EPERM），
        // 删不掉就跳过并告警 —— 不能因为一个旧文件挡住整次构建。
        const entries = await fs.readdir(distDir);
        await Promise.all(entries.map(async (entry) => {
          try {
            await fs.rm(path.join(distDir, entry), { recursive: true, force: true });
          }
          catch (error) {
            console.warn(
              `[h5-post-build] 旧产物删不掉，已跳过：${entry}（${String((error as Error)?.message || error)}）。`
              + `请关闭占用它的程序后手动删除`,
            );
          }
        }));
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

      // 先按原始 html 判断哪些标签要挂 onerror（依赖 `/scriptError.js` 这类绝对写法），
      // 再把 public 资源的绝对路径改成相对，避免子目录部署时 404
      const html = await fs.readFile(sourceHtmlPath, "utf8");
      await fs.writeFile(sourceHtmlPath, toRelativePublicAssets(addResourceErrorHandlers(html)), "utf8");
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
