package mcp

import (
 "bytes"
 "encoding/json"
 "strings"
 "testing"
)

func TestInitializeAndList(t *testing.T) {
 input := strings.Join([]string{
  `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`,
  `{"jsonrpc":"2.0","method":"notifications/initialized"}`,
  `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
  `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"system_status","arguments":{}}}`,
 },"\n")+"\n"
 var out bytes.Buffer
 if err:=Serve(strings.NewReader(input),&out);err!=nil {t.Fatal(err)}
 lines:=strings.Split(strings.TrimSpace(out.String()),"\n")
 if len(lines)!=3 {t.Fatalf("want 3 responses, got %d: %s",len(lines),out.String())}
 for _,line:=range lines{
  var data map[string]any
  if err:=json.Unmarshal([]byte(line),&data);err!=nil{t.Fatal(err)}
  if data["error"]!=nil{t.Fatalf("unexpected error: %v",data)}
 }
 if !strings.Contains(lines[1],"capabilities_list"){t.Fatal("missing capabilities tool")}
}
func TestRejectsUnsupportedWrites(t *testing.T){
 r:=process(request{JSONRPC:"2.0",ID:json.RawMessage("1"),Method:"tools/call",Params:json.RawMessage(`{"name":"devices_flash"}`)})
 result:=r.Result.(map[string]any)
 if result["isError"]!=true{t.Fatal("unsafe tool was not rejected")}
}
func TestMalformedJSON(t *testing.T) {
 var out bytes.Buffer
 if err:=Serve(strings.NewReader("{bad\n"),&out);err!=nil{t.Fatal(err)}
 if !strings.Contains(out.String(),"-32700"){t.Fatal(out.String())}
}
