import test from 'node:test';
import assert from 'node:assert/strict';
import {validHost,validUser,parseDnsPacket} from './hosts.mjs';
test('host validation rejects shell and URL input',()=>{
 assert.equal(validHost('builder-01.local'),true);
 assert.equal(validHost('192.168.100.29'),true);
 for(const x of ['http://example.com','host -o ProxyCommand=bad','foo..local','user@local']) assert.equal(validHost(x),false);
 assert.equal(validUser('piadmin'),true);
 for(const x of ['root;id','pi user','-oProxy'])assert.equal(validUser(x),false);
});
test('malformed mDNS packets do not throw',()=>{
 assert.deepEqual(parseDnsPacket(Buffer.from([0,1,2])),[]);
 assert.deepEqual(parseDnsPacket(Buffer.alloc(12)),[]);
});
