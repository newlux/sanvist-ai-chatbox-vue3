const fs = require("node:fs");
const path = require("node:path");
const i18nGenerator = require("i18n-generator");

const csvFilePath = path.join(__dirname, "/i18n.csv");

function ConvertToTable(data, callBack) {
  data = data.toString();
  const table = [];
  let rows = [];
  rows = data.split("\r\n");
  for (let i = 0; i < rows.length; i++) {
    table.push(rows[i].split(","));
  }
  callBack(table);
}

// 检查重复的Key
function checkRepeatKey(_path) {
  fs.readFile(_path, (err, data) => {
    // const table = [];
    if (err) {
      console.log(err.stack);
      return;
    }
    ConvertToTable(data, (_table) => {
      // console.log(_table);
      const _map = {};
      _table.forEach((line) => {
        const key = line[0];
        if (key !== "") {
          // eslint-disable-next-line no-prototype-builtins
          if (_map.hasOwnProperty(key)) {
            console.log(`重复: ${key}`);
          }
          else {
            _map[key] = true;
          }
        }
      });
    });
  });
}

module.exports = (fn) => {
  i18nGenerator(
    csvFilePath,
    path.join(__dirname, "..", "src", "i18n", "lang"),
    {
      watch: false,
    },
    "csv",
  );
  checkRepeatKey(csvFilePath);
  if (fn) {
    console.log("i18n文件生成中...");
    setTimeout(() => {
      console.log("i18n文件生成成功,开始代码打包...");
      fn?.();
    }, 3000);
  }
  else {
    console.log("✅️ i18n文件变更");
  }
};
