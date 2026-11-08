import {test} from "node:test";
import assert from "node:assert/strict";
import {parseHost,sshFingerprint} from "./host_adoption.mjs";

test("Host adoption accepts SSH host, port and OS service identity",()=>{
 assert.deepEqual(parseHost("192.168.22.41","builduser"),{host:"192.168.22.41",port:22,username:"builduser"});
 assert.deepEqual(parseHost("ssh://builder.example:2222","dev"),{host:"builder.example",port:2222,username:"dev"});
});
test("Host adoption rejects URL credentials, paths, bad ports and root SSH",()=>{
 for(const address of ["https://builder.example","ssh://user@builder.example","ssh://builder.example/etc","ssh://builder.example:99999","ssh://builder.example?x=1"]){
  assert.throws(()=>parseHost(address,"dev"),{status:422});
 }
 assert.throws(()=>parseHost("192.168.22.41","root"),{status:422});
});
test("SSH fingerprint is deterministic SHA256 of the host public key",()=>{
 const key=Buffer.from("trusted-test-host-public-key");
 assert.match(sshFingerprint(key),/^SHA256:[A-Za-z0-9+/]{43}$/);
 assert.equal(sshFingerprint(key),sshFingerprint(key));
 assert.notEqual(sshFingerprint(key),sshFingerprint(Buffer.from("other-key")));
});
