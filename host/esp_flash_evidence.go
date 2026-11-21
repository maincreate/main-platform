package main

import (
 "errors"
 "fmt"
)

type flashEvidenceReceipt struct {
 Authorized bool `json:"authorized"`
 Port string `json:"port"`
 MAC string `json:"mac"`
 FlashSize string `json:"flash_size"`
 BackupFullSHA256 string `json:"backup_full_sha256"`
 SecuritySHA256 string `json:"security_sha256"`
}

func verifyControllerFlashEvidence(c config,jobID,backupJobID,securityJobID,port,expectedMAC string)error{
 var receipt flashEvidenceReceipt
 err:=post(c.Controller,"/api/agent/assets",c.Token,map[string]any{
  "id":c.ID,"job_id":jobID,"action":"flash_preflight",
  "backup_job_id":backupJobID,"security_job_id":securityJobID,
  "port":port,"expected_mac":expectedMAC,
 },&receipt)
 if err!=nil{return fmt.Errorf("reviewed flash authorization unavailable: %w",err)}
 if !receipt.Authorized||receipt.Port!=port||receipt.MAC!=expectedMAC||
  receipt.FlashSize!="16MB"||!sha256HexPattern.MatchString(receipt.BackupFullSHA256)||
  !sha256HexPattern.MatchString(receipt.SecuritySHA256){
  return errors.New("controller has not authorized a verified full-device backup and security preflight")
 }
 return nil
}
