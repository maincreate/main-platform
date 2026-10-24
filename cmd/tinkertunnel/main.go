package main

import (
 "log"
 "os"

 "github.com/TinkerTunnel/tinkertunnel/internal/mcp"
)

func main() {
 if err := mcp.Serve(os.Stdin, os.Stdout); err != nil {
  log.Printf("tinkertunnel: %v", err)
  os.Exit(1)
 }
}
