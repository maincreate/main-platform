// Package mcp implements the minimal, read-only MCP stdio surface.
// Remote HTTP, authentication, Git mutations, builds and hardware writes
// deliberately remain out of scope until authorization is implemented.
package mcp

import (
 "bufio"
 "encoding/json"
 "fmt"
 "io"
 "runtime"
)

const protocolVersion = "2025-06-18"

type request struct {
 JSONRPC string          `json:"jsonrpc"`
 ID      json.RawMessage `json:"id,omitempty"`
 Method  string          `json:"method"`
 Params  json.RawMessage `json:"params,omitempty"`
}
type rpcError struct {
 Code int `json:"code"`
 Message string `json:"message"`
}
type response struct {
 JSONRPC string          `json:"jsonrpc"`
 ID json.RawMessage      `json:"id"`
 Result any               `json:"result,omitempty"`
 Error *rpcError          `json:"error,omitempty"`
}

func process(r request) *response {
 // JSON-RPC notifications never produce a response.
 if len(r.ID)==0 || string(r.ID)=="null" { return nil }
 reply:=&response{JSONRPC:"2.0",ID:r.ID}
 switch r.Method {
 case "initialize":
  reply.Result=map[string]any{
   "protocolVersion":protocolVersion,
   "capabilities":map[string]any{"tools":map[string]any{"listChanged":false}},
   "serverInfo":map[string]string{"name":"tinkertunnel","version":"0.1.0-dev"},
  }
 case "ping":
  reply.Result=map[string]any{}
 case "tools/list":
  reply.Result=map[string]any{"tools":[]any{
   map[string]any{
    "name":"system_status",
    "description":"Read-only health of this local TinkerTunnel MCP process. Does not test relay or runners.",
    "inputSchema":map[string]any{"type":"object","properties":map[string]any{},"additionalProperties":false},
   },
   map[string]any{
    "name":"capabilities_list",
    "description":"List safe capabilities exposed by this initial local server.",
    "inputSchema":map[string]any{"type":"object","properties":map[string]any{},"additionalProperties":false},
   },
  }}
 case "tools/call":
  var p struct {
   Name string `json:"name"`
   Arguments map[string]json.RawMessage `json:"arguments"`
  }
  if err:=json.Unmarshal(r.Params,&p); err!=nil {
   reply.Error=&rpcError{-32602,"Invalid tool parameters"}
   break
  }
  if len(p.Arguments)>0 {
   reply.Error=&rpcError{-32602,"This tool does not accept arguments"}
   break
  }
  var value any
  switch p.Name {
  case "system_status":
   value=map[string]any{"service":"tinkertunnel","state":"ready","transport":"stdio","relay":"not_configured"}
  case "capabilities_list":
   value=map[string]any{"capabilities":[]string{"system_status","capabilities_list"},"runtime_os":runtime.GOOS,"runtime_arch":runtime.GOARCH}
  default:
   reply.Result=map[string]any{"isError":true,"content":[]any{map[string]string{"type":"text","text":"Unknown or unauthorized tool"}}}
   return reply
  }
  payload,_:=json.Marshal(value)
  reply.Result=map[string]any{"content":[]any{map[string]string{"type":"text","text":string(payload)}}}
 default:
  reply.Error=&rpcError{-32601,"Method not found"}
 }
 return reply
}

// Serve processes one JSON-RPC message per line on stdio, as required by MCP.
// Errors and diagnostics must go to stderr; stdout is reserved for MCP.
func Serve(in io.Reader,out io.Writer) error {
 scan:=bufio.NewScanner(in)
 scan.Buffer(make([]byte,4096),4*1024*1024)
 writer:=bufio.NewWriter(out)
 for scan.Scan() {
  var req request
  if err:=json.Unmarshal(scan.Bytes(),&req);err!=nil {
   if err:=write(writer,&response{JSONRPC:"2.0",ID:json.RawMessage("null"),Error:&rpcError{-32700,"Parse error"}});err!=nil{return err}
   continue
  }
  if req.JSONRPC!="2.0" || req.Method=="" {
   if err:=write(writer,&response{JSONRPC:"2.0",ID:json.RawMessage("null"),Error:&rpcError{-32600,"Invalid Request"}});err!=nil{return err}
   continue
  }
  if res:=process(req);res!=nil {
   if err:=write(writer,res);err!=nil{return err}
  }
 }
 if err:=scan.Err();err!=nil{return fmt.Errorf("read MCP request: %w",err)}
 return nil
}
func write(w *bufio.Writer,r *response)error{
 data,err:=json.Marshal(r);if err!=nil{return err}
 if _,err=w.Write(append(data,'\n'));err!=nil{return err}
 return w.Flush()
}
