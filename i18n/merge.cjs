/* eslint-disable eqeqeq */
// 将新翻译的语言合并到原有的 i18n 中
// const i18nGenerator = require("i18n-generator");
const fs = require("node:fs");
const path = require("node:path");

const targetPath = path.join(__dirname, "./i18n.csv");
const sourcePath = path.join(__dirname, "./i18n-new.csv");

function magicSplit(data) {
  const output = [];
  let index = 0;
  let tempString = "";
  let isInside = false;

  while (data.length) {
    if (data[0] === "\"") {
      isInside = !isInside;
      data = data.slice(1, data.length);
      continue;
    }
    else if (data[0] === "\\" && isInside) {
      tempString += data[1];
      data = data.slice(2, data.length);
      continue;
    }
    else if (data[0] === "," && !isInside) {
      output[index] = tempString;
      tempString = "";
      index++;
      data = data.slice(1, data.length);
      continue;
    }

    tempString += data[0];
    data = data.slice(1, data.length);
  }

  output[index] = tempString;
  // console.log(output)
  return output;
}
function ConvertToTable(data) {
  data = data.toString();
  const table = [];
  let rows = [];
  rows = data.split("\r\n");
  for (let i = 0; i < rows.length; i++) {
    table.push(magicSplit(rows[i]));
  }
  return table;
}
function readSource(_path) {
  return new Promise((resolve, reject) => {
    fs.readFile(_path, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const table = ConvertToTable(data);
      resolve(table);
    });
  });
}
// 统一格式化文字内容
function formatCell(text) {
  return text.replaceAll("\"", "").trim();
}

function formatColumnNames(names) {
  return names
    .map((t) => {
      return formatCell(t);
    })
    .filter(k => k != "");
}

function findRowByKey(table, key) {
  if (!key || !formatCell(key))
    return;
  return table.find(row => formatCell(row[0]) == formatCell(key));
}

function mergeLangs(tLangs, sLangs) {
  const langs = tLangs.slice();
  const mapIndex = []; // source 中的语种对应 target 中的列索引

  for (let i = 0; i < sLangs.length; i++) {
    const lang = sLangs[i];
    const index = tLangs.findIndex(l => l == lang);
    if (index === -1) {
      langs.push(lang);
      mapIndex.push(langs.length - 1);
      console.log("检测到新语种", lang);
    }
    else {
      mapIndex.push(index);
    }
  }
  return { langs, mapIndex };
}

async function wirte(_path, table) {
  fs.writeFileSync(_path, "");
  return new Promise((resolve) => {
    fs.writeFile(_path, table.map(row => row.join(",")).join("\r\n"), (err) => {
      !err && resolve();
    });
  });
}

async function merge(tPath, sPath) {
  console.time("✅更新完成！");
  const target = await readSource(tPath);
  const source = await readSource(sPath);

  // 获取语种
  const tLangs = formatColumnNames(target[0]);
  const sLangs = formatColumnNames(source[0]);
  const { langs, mapIndex } = mergeLangs(tLangs, sLangs);
  if (langs.length == tLangs.length) {
    console.warn("未检查到新语种");
    // return;
  }
  const newTable = [langs];

  // 从 1 开始去掉第一行的语种
  for (let i = 1; i < target.length; i++) {
    const targetRow = target[i].slice().map((t, i) => (i == 6 || i == 0 ? t : `"${t}"`));
    const key = targetRow[0];
    // 将原有的行添加至新表中
    newTable.push(targetRow);
    if (!key)
      continue;
    const sourceRow = findRowByKey(source, key);
    if (!sourceRow) {
      // console.warn('未找到 key: ', key);
      continue;
    }
    // 添加新翻译的语种到 targetRow 中
    for (let i = 1; i < mapIndex.length; i++) {
      const index = mapIndex[i];
      // if (target.length <= index) targetRow.push('');
      targetRow[index] = index == 6 ? sourceRow[i] : `"${sourceRow[i]}"`;
    }
    // const newTexts = newIndex.map(index => sourceRow[index]);
    // targetRow.push(...newTexts);
  }
  // console.log(newTable.slice(0, 2), newTable.length);
  await wirte(tPath, newTable);
  console.timeEnd("✅更新完成！");
}
merge(targetPath, sourcePath);
