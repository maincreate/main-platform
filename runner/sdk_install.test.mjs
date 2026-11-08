import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ARDUINO_CLI_RELEASE,recipeFor,validateArchiveEntry,installArduinoCli,download,isExactArduinoVersion} from './sdk_install.mjs';

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
test('version verification is exact, not merely a product-name check',()=>{
 assert.equal(isExactArduinoVersion('arduino-cli 1.5.1\n'),true);
 assert.equal(isExactArduinoVersion('arduino-cli  Version: 1.5.1 Commit: 01f3d4f Date: 2026-06-05T10:22:17Z'),true);
 assert.equal(isExactArduinoVersion('arduino-cli Version: 1.5.1 Commit: 01f3d4f'),true);
 assert.equal(isExactArduinoVersion('arduino-cli 1.5.10\n'),false);
 assert.equal(isExactArduinoVersion('arduino-cli nightly\n'),false);
});
test('installer refuses a mismatched immutable digest',async()=>{
 await assert.rejects(()=>installArduinoCli({os:'linux',architecture:'x64',root:'/tmp/maincreate-sdk-test',downloadFn:async()=>Buffer.from('not the release')}),/checksum mismatch/);
});
test('download follows only bounded approved HTTPS redirects',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,opts)=>{calls++;assert.equal(opts.redirect,'manual');return calls===1?new Response(null,{status:302,headers:{location:'https://objects.githubusercontent.com/a'}}):new Response('ok',{status:200})};
 try{assert.equal((await download(ARDUINO_CLI_RELEASE.targets['linux/x64'].url)).toString(),'ok');assert.equal(calls,2);}
 finally{globalThis.fetch=original;}
});
test('download rejects non-approved redirect hosts',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://evil.example/a'}});
 try{await assert.rejects(()=>download(ARDUINO_CLI_RELEASE.targets['linux/x64'].url),/approved HTTPS GitHub asset/);}finally{globalThis.fetch=original;}
});
