const fs = require("node:fs");
const path = require("node:path");
const make = require("./i18nMake");

const csvFilePath = path.join(__dirname, "./i18n.csv");

fs.watchFile(csvFilePath, make);
make();
