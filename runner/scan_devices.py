#!/usr/bin/env python3
"""Read-only, OS-portable USB serial inventory via pyserial. No ports are opened."""
import json
import sys
try:
    from serial.tools import list_ports
except ImportError:
    print(json.dumps({"error": "pyserial is required: python -m pip install pyserial"}))
    sys.exit(2)

devices = []
for p in list_ports.comports(include_links=False):
    if p.vid is None or p.pid is None:
        continue
    devices.append({
        "port": p.device,
        "description": p.description or "USB serial device",
        "manufacturer": p.manufacturer,
        "product": p.product,
        "vid": p.vid,
        "pid": p.pid,
        "serialNumber": p.serial_number,
        "location": p.location,
        "interface": p.interface,
    })
print(json.dumps({"devices": devices[:48]}))
