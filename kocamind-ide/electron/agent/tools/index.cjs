'use strict';

const { readFileTool } = require('./readFile.cjs');
const { listDirTool } = require('./listDir.cjs');
const { globTool } = require('./glob.cjs');
const { grepTool } = require('./grep.cjs');
const { writeFileTool } = require('./writeFile.cjs');
const { editFileTool } = require('./editFile.cjs');
const { runCommandTool } = require('./runCommand.cjs');
const { updatePlanTool } = require('./updatePlan.cjs');

function createDefaultTools() {
  return [
    readFileTool,
    listDirTool,
    globTool,
    grepTool,
    writeFileTool,
    editFileTool,
    runCommandTool,
    updatePlanTool,
  ];
}

module.exports = { createDefaultTools };
