const test = require('node:test');
const assert = require('node:assert/strict');
const { officeExecutableCandidates } = require('../app-targets.cjs');

test('finds Office executables in standard 64-bit and 32-bit install folders', () => {
  const candidates = officeExecutableCandidates('app-word', {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  });

  assert.equal(candidates[0], 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE');
  assert.ok(candidates.includes('C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE'));
  assert.ok(candidates.every((candidate) => candidate.endsWith('\\WINWORD.EXE')));
});

test('does not infer a local executable for unrelated shortcuts', () => {
  assert.deepEqual(officeExecutableCandidates('app-teams', {
    ProgramFiles: 'C:\\Program Files'
  }), []);
});
