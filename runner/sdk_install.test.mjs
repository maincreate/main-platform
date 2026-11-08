import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ARDUINO_CLI_RELEASE,recipeFor,validateArchiveEntry,installArduinoCli} from './sdk_install.mjs';

test('Arduino CLI recipe is immutable and architecture-specific',()=>{
 assert.equal(ARDUINO_CLI_RELEASE.version,'1.5.1');
 assert.equal(recipeFor('linux','arm64').sha256,'1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62');
 assert.equal(recipeFor('linux','x64').sha256,'28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b');
 assert.equal(recipeFor('darwin','arm64'),null);
});
test('SDK archive paths reject traversal and absolute entries',()=>{
 assert.equal(validateArchiveEntry('arduino-cli'),true);
 assert.equal(validateArchiveEntry('bin/arduino-cli'),true);
 assert.equal(validateArchiveEntry('../escape'),false);
 assert.equal(validateArchiveEntry('/etc/passwd'),false);
 assert.equal(validateArchiveEntry('..\\escape'),false);
});
test('installer validates platform before any download',async()=>{
 await assert.rejects(()=>installArduinoCli({os:'windows',architecture:'x64',downloadFn:()=>{throw new Error('downloaded')}}),/Linux ARM64 and Linux x64/);
});
test('installer refuses a mismatched immutable digest',async()=>{
 await assert.rejects(()=>installArduinoCli({os:'linux',architecture:'x64',root:'/tmp/maincreate-sdk-test',downloadFn:async()=>Buffer.from('not the release')}),/checksum mismatch/);
});
