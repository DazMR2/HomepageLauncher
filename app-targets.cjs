const path = require('node:path');

const OFFICE_APP_TARGETS = Object.freeze({
  'app-outlook': {
    executable: 'OUTLOOK.EXE',
    fallback: 'https://outlook.office.com/mail/'
  },
  'app-word': {
    executable: 'WINWORD.EXE',
    fallback: 'https://word.office.com'
  },
  'app-excel': {
    executable: 'EXCEL.EXE',
    fallback: 'https://excel.office.com'
  },
  'app-powerpoint': {
    executable: 'POWERPNT.EXE',
    fallback: 'https://powerpoint.office.com'
  }
});

const OFFICE_INSTALL_FOLDERS = [
  path.win32.join('Microsoft Office', 'root', 'Office16'),
  path.win32.join('Microsoft Office', 'Office16'),
  path.win32.join('Microsoft Office', 'root', 'Office15'),
  path.win32.join('Microsoft Office', 'Office15'),
  path.win32.join('Microsoft Office', 'Office14')
];

function officeExecutableCandidates(appId, environment = process.env) {
  const target = OFFICE_APP_TARGETS[appId];
  if (!target) {
    return [];
  }

  const programFiles = [environment.ProgramFiles, environment['ProgramFiles(x86)']].filter(Boolean);
  return [...new Set(programFiles.flatMap((base) => OFFICE_INSTALL_FOLDERS.map((folder) =>
    path.win32.join(base, folder, target.executable)
  )))];
}

module.exports = { OFFICE_APP_TARGETS, officeExecutableCandidates };
